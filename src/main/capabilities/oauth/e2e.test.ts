import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRepository } from '../../db/capabilities'
import { migrate, openDatabase } from '../../db/database'
import { McpServerService } from '../mcp-servers'
import { codeChallenge } from './pkce'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace('enc:', ''))
  }
}))

const dirs: string[] = []
const servers: Server[] = []

async function startMock(): Promise<{ base: string; authorized: string[] }> {
  let challenge = ''
  let code = ''
  const authorized: string[] = []
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers })
      response.end(JSON.stringify(body))
    }
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`

    if (
      url.pathname === '/.well-known/oauth-protected-resource' ||
      url.pathname === '/.well-known/oauth-protected-resource/mcp'
    ) {
      json({
        resource: `${base}/mcp`,
        authorization_servers: [base],
        scopes_supported: ['read']
      })
      return
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      json({
        issuer: base,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['read']
      })
      return
    }
    if (url.pathname === '/register' && request.method === 'POST') {
      json({ client_id: 'client-1', token_endpoint_auth_method: 'none' }, 201)
      return
    }
    if (url.pathname === '/authorize') {
      const redirect = url.searchParams.get('redirect_uri') ?? ''
      const state = url.searchParams.get('state') ?? ''
      challenge = url.searchParams.get('code_challenge') ?? ''
      code = 'code-1'
      response.writeHead(302, {
        location: `${redirect}?code=${code}&state=${encodeURIComponent(state)}`
      })
      response.end()
      return
    }
    if (url.pathname === '/token' && request.method === 'POST') {
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        const form = new URLSearchParams(body)
        if (form.get('grant_type') === 'authorization_code') {
          if (form.get('code') !== code) {
            json({ error: 'invalid_grant' }, 400)
            return
          }
          if (codeChallenge(form.get('code_verifier') ?? '') !== challenge) {
            json({ error: 'invalid_grant', error_description: 'PKCE mismatch' }, 400)
            return
          }
          json({
            access_token: 'token-1',
            refresh_token: 'refresh-1',
            expires_in: 3600,
            token_type: 'Bearer'
          })
          return
        }
        if (form.get('grant_type') === 'refresh_token') {
          json({ access_token: 'token-2', expires_in: 3600 })
          return
        }
        json({ error: 'unsupported_grant_type' }, 400)
      })
      return
    }
    if (url.pathname === '/mcp') {
      const auth = request.headers.authorization ?? ''
      if (auth !== 'Bearer token-1' && auth !== 'Bearer token-2') {
        json({}, 401, {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource"`
        })
        return
      }
      authorized.push(auth)
      let body = ''
      request.on('data', (chunk) => {
        body += String(chunk)
      })
      request.on('end', () => {
        const message = JSON.parse(body) as { id?: number; method?: string }
        if (message.method === 'notifications/initialized') {
          response.writeHead(202)
          response.end()
          return
        }
        if (message.method === 'initialize') {
          json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              protocolVersion: '2025-06-18',
              capabilities: { tools: {} },
              serverInfo: { name: 'oauth-mock', version: '1.0.0' }
            }
          })
          return
        }
        if (message.method === 'tools/list') {
          json({
            jsonrpc: '2.0',
            id: message.id,
            result: {
              tools: [
                {
                  name: 'echo',
                  description: 'Echo input',
                  inputSchema: { type: 'object' },
                  annotations: { readOnlyHint: true }
                }
              ]
            }
          })
          return
        }
        json({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'no method' } })
      })
      return
    }
    response.writeHead(404)
    response.end('not found')
  })
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return {
    base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    authorized
  }
}

afterEach(() => {
  for (const server of servers.splice(0)) server.close()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('OAuth 远程 MCP 全链路（本地 mock）', () => {
  it('发现 → DCR → PKCE → 回调 → Token → 测试连接 → 运行时 Bearer', async () => {
    const mock = await startMock()
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-oauth-e2e-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(db)
    const service = new McpServerService(new CapabilityRepository(db), '0.0.0', {
      fetch: globalThis.fetch.bind(globalThis) as never,
      openExternal: async (url) => {
        const authorize = await fetch(url, { redirect: 'manual' })
        const location = authorize.headers.get('location')
        if (!location) throw new Error('mock 授权页没有重定向')
        await fetch(location)
      },
      now: () => Date.now(),
      ports: [0]
    })
    const server = service.add({
      name: 'OAuth Mock',
      transport: 'http',
      url: `${mock.base}/mcp`,
      auth: 'oauth'
    })
    service.setEnabled(server.id, true, true)

    const login = await service.login(server.id)
    expect(login.ok).toBe(true)
    expect(service.list().find((item) => item.id === server.id)?.oauth).toMatchObject({
      state: 'connected',
      scopes: 'read'
    })
    expect(JSON.stringify(service.list())).not.toContain('token-1')

    const tested = await service.test(server.id)
    expect(tested.lastError).toBe('')
    expect(tested.toolNames).toEqual(['echo'])
    expect(mock.authorized).toContain('Bearer token-1')

    const runtime = await service.runtimeServers()
    expect(runtime[0]).toMatchObject({
      name: server.key,
      type: 'http',
      url: `${mock.base}/mcp`,
      headers: { Authorization: 'Bearer token-1' }
    })

    service.logout(server.id)
    expect(service.list().find((item) => item.id === server.id)?.oauth).toBeNull()
    db.close()
  })
})
