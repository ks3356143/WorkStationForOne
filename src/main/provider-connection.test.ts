import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { testProviderConnection, listProviderModels } from './provider-connection'

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

describe('Provider 模型列表', () => {
  it('OpenAI 兼容接口请求 /models，去重并保留 Bearer', async () => {
    let seen: { url?: string; auth?: string } = {}
    const baseUrl = await withServer(async (req, res) => {
      seen = { url: req.url, auth: req.headers.authorization }
      await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 'model-a' }]
        })
      )
    })

    const result = await listProviderModels({
      target: 'codex',
      wireApi: 'responses',
      baseUrl,
      token: 'secret-token'
    })

    expect(result).toMatchObject({
      ok: true,
      status: 200,
      models: ['model-a', 'model-b'],
      message: '找到 2 个模型'
    })
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
    expect(seen.url).toBe('/models')
    expect(seen.auth).toBe('Bearer secret-token')
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })

  it('Base URL 已带 /v1 时只请求 /v1/models', async () => {
    let seen = ''
    const baseUrl = await withServer(async (req, res) => {
      seen = req.url ?? ''
      await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'gpt-model' }] }))
    })

    const result = await listProviderModels({
      target: 'codex',
      wireApi: 'responses',
      baseUrl: `${baseUrl}/v1`,
      token: 'secret-token'
    })

    expect(result).toMatchObject({ ok: true, models: ['gpt-model'] })
    expect(seen).toBe('/v1/models')
  })

  it('根路径 /models 404 时回退到 /v1/models', async () => {
    const seen: string[] = []
    const baseUrl = await withServer(async (req, res) => {
      seen.push(req.url ?? '')
      await readBody(req)
      if (req.url === '/models') {
        res.writeHead(404, { 'content-type': 'application/json' })
        res.end('{}')
        return
      }
      if (req.url === '/v1/models') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'fallback-model' }] }))
        return
      }
      res.writeHead(500)
      res.end('{}')
    })

    const result = await listProviderModels({
      target: 'codex',
      wireApi: 'responses',
      baseUrl,
      token: 'secret-token'
    })

    expect(result).toMatchObject({ ok: true, models: ['fallback-model'] })
    expect(seen).toEqual(['/models', '/v1/models'])
  })

  it('Anthropic 使用 /v1/models、x-api-key 与 anthropic-version', async () => {
    let seen: {
      url?: string
      key?: string
      auth?: string
      version?: string
    } = {}
    const baseUrl = await withServer(async (req, res) => {
      seen = {
        url: req.url,
        key: req.headers['x-api-key'] as string | undefined,
        auth: req.headers.authorization,
        version: req.headers['anthropic-version'] as string | undefined
      }
      await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-haiku-4-5' }]
        })
      )
    })

    const result = await listProviderModels({
      target: 'claude',
      wireApi: 'responses',
      baseUrl,
      token: 'secret-token'
    })

    expect(result).toMatchObject({
      ok: true,
      models: ['claude-sonnet-4-5', 'claude-haiku-4-5']
    })
    expect(seen).toMatchObject({
      url: '/v1/models',
      key: 'secret-token',
      version: '2023-06-01'
    })
    expect(seen.auth).toBeUndefined()
  })

  it('Anthropic 兼容代理拒绝 x-api-key 时回退 Bearer', async () => {
    const auths: Array<string | undefined> = []
    const baseUrl = await withServer(async (req, res) => {
      auths.push(req.headers.authorization)
      await readBody(req)
      if (req.headers['x-api-key']) {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ error: { message: 'use bearer' } }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'proxy-model' }] }))
    })

    const result = await listProviderModels({
      target: 'claude',
      wireApi: 'responses',
      baseUrl,
      token: 'secret-token'
    })

    expect(result).toMatchObject({ ok: true, models: ['proxy-model'] })
    expect(auths).toEqual([undefined, 'Bearer secret-token'])
  })

  it('空列表与错误都不回显 token', async () => {
    const emptyBase = await withServer(async (req, res) => {
      await readBody(req)
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
    })
    const empty = await listProviderModels({
      target: 'codex',
      wireApi: 'responses',
      baseUrl: emptyBase,
      token: 'secret-token'
    })
    expect(empty.ok).toBe(false)
    expect(empty.models).toEqual([])
    expect(empty.message).toContain('模型')

    const deniedBase = await withServer(async (req, res) => {
      await readBody(req)
      res.writeHead(401, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: 'bad secret-token' } }))
    })
    const denied = await listProviderModels({
      target: 'codex',
      wireApi: 'responses',
      baseUrl: deniedBase,
      token: 'secret-token'
    })
    expect(denied).toMatchObject({ ok: false, status: 401 })
    expect(denied.message).not.toContain('secret-token')
    expect(denied.message).toContain('401')
  })

  it('模型列表请求超时返回超时原因', async () => {
    const baseUrl = await withServer((_req, res) => {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: [{ id: 'late' }] }))
      }, 200)
    })

    const result = await listProviderModels(
      {
        target: 'codex',
        wireApi: 'responses',
        baseUrl,
        token: 'secret-token'
      },
      { timeoutMs: 25 }
    )

    expect(result.ok).toBe(false)
    expect(result.message).toContain('超时')
  })
})
