import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { MCP_DEFAULT_MODES, type McpDomain, type McpMode } from '../../shared/ipc'
import { MCP_TOOLS, runMcpTool, type McpData, type McpToolResult } from './tools'

export interface McpEndpoint {
  url: string
  token: string
}

export interface McpHooks {
  /** 当前域权限；缺省使用默认模式 */
  mode?: (domain: McpDomain) => McpMode
  /** 写入成功后通知渲染层重新读库 */
  notifyChanged?: (domains: McpDomain[]) => void
}

const MAX_BODY = 256 * 1024
const RATE_WINDOW_MS = 60 * 1000
const RATE_LIMIT = 120
const PROTOCOL_VERSION = '2025-06-18'

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

function rpcResult(id: unknown, result: unknown): unknown {
  return { jsonrpc: '2.0', id, result }
}

function rpcError(id: unknown, code: number, message: string): unknown {
  return { jsonrpc: '2.0', id, error: { code, message } }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      size += Buffer.byteLength(chunk)
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        return
      }
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

/**
 * 本地 MCP 只读桥：随机端口 + 每轮会话一个 Bearer Token。
 * 只绑定 127.0.0.1；token 只存在内存与传给 CLI 的临时配置文件里，
 * 不写日志、不写审计、不进命令行参数。
 */
export class McpBridge {
  private server: Server | null = null
  private port = 0
  private readonly tokens = new Map<string, string>()
  private readonly limits = new Map<string, { count: number; resetAt: number }>()
  private readonly idempotency = new Map<string, McpToolResult>()

  constructor(
    private readonly data: McpData,
    private readonly version = '0.0.0',
    private readonly hooks: McpHooks = {}
  ) {}

  async start(): Promise<number> {
    if (this.server && this.port) return this.port
    const server = createServer((req, res) => {
      void this.handle(req, res).catch(() => {
        if (!res.headersSent) res.statusCode = 500
        res.end()
      })
    })
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen(0, '127.0.0.1')
    })
    const address = server.address()
    if (!address || typeof address === 'string') {
      server.close()
      throw new Error('MCP 服务没有拿到端口')
    }
    this.server = server
    this.port = address.port
    return this.port
  }

  issue(sessionId: string): McpEndpoint | null {
    if (!this.server || !this.port) return null
    const token = randomBytes(24).toString('hex')
    this.tokens.set(token, sessionId)
    return { url: `http://127.0.0.1:${this.port}/mcp`, token }
  }

  revoke(token: string): void {
    this.tokens.delete(token)
  }

  close(): void {
    this.tokens.clear()
    this.limits.clear()
    this.idempotency.clear()
    this.server?.close()
    this.server = null
    this.port = 0
  }

  /** 常量时间比较；token 少，遍历成本可以忽略。 */
  private sessionFor(token: string): string | undefined {
    const provided = Buffer.from(token)
    for (const [candidate, sessionId] of this.tokens) {
      const expected = Buffer.from(candidate)
      if (expected.length === provided.length && timingSafeEqual(expected, provided)) {
        return sessionId
      }
    }
    return undefined
  }

  private allow(sessionId: string): boolean {
    const now = Date.now()
    const entry = this.limits.get(sessionId)
    if (!entry || now >= entry.resetAt) {
      this.limits.set(sessionId, { count: 1, resetAt: now + RATE_WINDOW_MS })
      return true
    }
    if (entry.count >= RATE_LIMIT) return false
    entry.count += 1
    return true
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.setHeader('Cache-Control', 'no-store')
    const path = new URL(req.url ?? '/', 'http://127.0.0.1').pathname
    if (path !== '/mcp') {
      res.statusCode = 404
      res.end()
      return
    }
    if (req.method === 'GET') {
      res.statusCode = 405
      res.setHeader('Allow', 'POST')
      res.end()
      return
    }
    if (req.method === 'DELETE') {
      res.statusCode = 204
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.statusCode = 405
      res.setHeader('Allow', 'POST')
      res.end()
      return
    }

    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const sessionId = token ? this.sessionFor(token) : undefined
    if (!sessionId) {
      res.statusCode = 401
      res.setHeader('WWW-Authenticate', 'Bearer')
      res.end()
      return
    }
    if (!this.allow(sessionId)) {
      res.statusCode = 429
      res.setHeader('Retry-After', '60')
      res.end()
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(await readBody(req))
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(rpcError(null, -32700, 'JSON 解析失败')))
      return
    }

    const messages = Array.isArray(payload) ? payload : [payload]
    const responses: unknown[] = []
    for (const message of messages) {
      const response = await this.dispatch(message, sessionId)
      if (response) responses.push(response)
    }

    if (responses.length === 0) {
      res.statusCode = 202
      res.end()
      return
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify(Array.isArray(payload) ? responses : responses[0]))
  }

  private async dispatch(message: unknown, sessionId: string): Promise<unknown | null> {
    const record = asRecord(message)
    const hasId = Object.hasOwn(record, 'id')
    const id = hasId ? record.id : undefined
    const method = typeof record.method === 'string' ? record.method : ''

    if (record.jsonrpc !== '2.0' || !method) {
      return hasId ? rpcError(id, -32600, '无效的 JSON-RPC 请求') : null
    }
    // initialized / cancelled 等通知不需要响应
    if (!hasId) return null

    if (method === 'initialize') {
      const params = asRecord(record.params)
      const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : ''
      return rpcResult(id, {
        protocolVersion: requested || PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'workstation-for-one', version: this.version }
      })
    }
    if (method === 'ping') return rpcResult(id, {})
    if (method === 'tools/list') return rpcResult(id, { tools: MCP_TOOLS })
    if (method === 'tools/call') {
      const params = asRecord(record.params)
      const name = typeof params.name === 'string' ? params.name : ''
      if (!name) return rpcError(id, -32602, '缺少工具名')
      const def = MCP_TOOLS.find((tool) => tool.name === name)
      if (!def) {
        return rpcResult(id, toolResponse({ text: `未知工具：${name}`, isError: true }))
      }
      const args = asRecord(params.arguments)
      let cacheKey = ''
      if (def.write) {
        const mode = this.hooks.mode?.(def.domain) ?? MCP_DEFAULT_MODES[def.domain]
        if (mode !== 'write') {
          this.data.audit.record({
            at: Date.now(),
            domain: 'mcp',
            action: 'write',
            targetId: sessionId,
            title: name,
            source: 'agent',
            detail: `denied_by_policy (mode=${mode})`
          })
          return rpcResult(id, toolResponse({ text: 'denied_by_policy', isError: true }))
        }
        const key = typeof args.idempotency_key === 'string' ? args.idempotency_key.trim() : ''
        if (!key) {
          return rpcResult(id, toolResponse({ text: 'idempotency_key 不能为空', isError: true }))
        }
        cacheKey = `${sessionId}:${name}:${key}`
        const cached = this.idempotency.get(cacheKey)
        if (cached) return rpcResult(id, toolResponse(cached))
      }
      try {
        const output = runMcpTool(name, params.arguments, this.data, {
          sessionId,
          ...(def.write ? { write: true } : {})
        })
        if (def.write && !output.isError) {
          this.idempotency.set(cacheKey, output)
          this.hooks.notifyChanged?.([def.domain])
        }
        return rpcResult(id, toolResponse(output))
      } catch {
        return rpcResult(id, toolResponse({ text: '工具执行失败', isError: true }))
      }
    }
    return rpcError(id, -32601, `未知方法：${method}`)
  }
}

function toolResponse(output: McpToolResult): unknown {
  return {
    content: [{ type: 'text', text: output.text }],
    ...(output.isError ? { isError: true } : {})
  }
}
