import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { testProviderConnection } from './provider-connection'

const servers: ReturnType<typeof createServer>[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

async function withServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器没有端口')
  return `http://127.0.0.1:${address.port}`
}

async function unusedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('测试服务器没有端口')
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return address.port
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
  })
}

describe('Provider 轻量连接测试', () => {
  it('Codex 请求 /responses，并携带 Bearer token 与模型', async () => {
    let seen: { url?: string; auth?: string; body?: Record<string, unknown> } = {}
    const baseUrl = await withServer(async (req, res) => {
      seen = {
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(await readBody(req)) as Record<string, unknown>
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'response', output_text: 'OK' }))
    })

    const result = await testProviderConnection({
      target: 'codex',
      wireApi: 'responses',
      baseUrl,
      model: 'deepseek-flash',
      token: 'secret-token'
    })

    expect(result).toMatchObject({ ok: true, status: 200, message: '连接正常' })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(seen.url).toBe('/responses')
    expect(seen.auth).toBe('Bearer secret-token')
    expect(seen.body).toMatchObject({ model: 'deepseek-flash', stream: false })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('Claude 请求 /v1/messages，并携带 anthropic-version', async () => {
    let seen: { url?: string; auth?: string; version?: string } = {}
    const baseUrl = await withServer(async (req, res) => {
      seen = {
        url: req.url,
        auth: req.headers.authorization,
        version: req.headers['anthropic-version'] as string | undefined
      }
      await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg-1', type: 'message', content: [] }))
    })

    const result = await testProviderConnection({
      target: 'claude',
      wireApi: 'responses',
      baseUrl,
      model: 'claude-sonnet',
      token: 'secret-token'
    })

    expect(result).toMatchObject({ ok: true, status: 200 })
    expect(seen.url).toBe('/v1/messages')
    expect(seen.auth).toBe('Bearer secret-token')
    expect(seen.version).toBe('2023-06-01')
  })

  it('401 返回可读失败原因，且不回显 token', async () => {
    const baseUrl = await withServer(async (_req, res) => {
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'Invalid API key secret-token' } }))
    })

    const result = await testProviderConnection({
      target: 'codex',
      wireApi: 'responses',
      baseUrl,
      model: 'deepseek-flash',
      token: 'secret-token'
    })

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.message).toContain('401')
    expect(result.message).toContain('Invalid API key')
    expect(result.message).not.toContain('secret-token')
  })

  it('200 但返回非 JSON 时明确提示不是兼容接口', async () => {
    const baseUrl = await withServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html>not an api</html>')
    })

    const result = await testProviderConnection({
      target: 'claude',
      wireApi: 'responses',
      baseUrl,
      model: 'claude-sonnet',
      token: 'secret-token'
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('非 JSON')
  })

  it('请求超时返回超时原因', async () => {
    const baseUrl = await withServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end('{}')
      }, 200)
    })

    const result = await testProviderConnection(
      {
        target: 'codex',
        wireApi: 'responses',
        baseUrl,
        model: 'deepseek-flash',
        token: 'secret-token'
      },
      { timeoutMs: 25 }
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('超时')
  })

  it('连接被拒绝时给出可读提示，而不是 fetch failed', async () => {
    const port = await unusedPort()
    const result = await testProviderConnection({
      target: 'codex',
      wireApi: 'responses',
      baseUrl: `http://127.0.0.1:${port}`,
      model: 'deepseek-flash',
      token: 'secret-token'
    })

    expect(result.ok).toBe(false)
    expect(result.message).toContain('连接被拒绝')
    expect(result.message).not.toContain('fetch failed')
  })
})
