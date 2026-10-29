import { randomUUID } from 'node:crypto'
import type { McpDomain, McpPermissionRequest } from '../../shared/ipc'
import type { AuditLog } from '../db/audit'

export type McpPermissionOutcome = 'once' | 'session' | 'deny' | 'timeout'

export interface McpPermissionInput {
  sessionId: string
  domain: McpDomain
  tool: string
  detail: string
  preview: string
}

interface PendingPermission {
  request: McpPermissionRequest
  resolve: (outcome: McpPermissionOutcome) => void
  timer: NodeJS.Timeout | null
}

export interface McpPermissionBrokerOptions {
  /** 返回 false 表示没有可用窗口，直接拒绝 */
  send: (request: McpPermissionRequest) => boolean
  audit?: AuditLog
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 60_000

/**
 * MCP 写入询问队列：一次只展示一张卡，按会话 + 工具记住「本会话允许」。
 * 超时、窗口不可用、回合取消都按拒绝处理，绝不默认放行。
 */
export class McpPermissionBroker {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly queue: string[] = []
  private readonly allowed = new Set<string>()
  private current: string | null = null
  private readonly timeoutMs: number

  constructor(private readonly options: McpPermissionBrokerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  }

  isSessionAllowed(sessionId: string, tool: string): boolean {
    return this.allowed.has(this.key(sessionId, tool))
  }

  request(input: McpPermissionInput): Promise<McpPermissionOutcome> {
    if (this.isSessionAllowed(input.sessionId, input.tool)) {
      return Promise.resolve('session')
    }
    const request: McpPermissionRequest = {
      requestId: randomUUID(),
      sessionId: input.sessionId,
      domain: input.domain,
      tool: input.tool,
      detail: input.detail,
      preview: input.preview,
      createdAt: Date.now()
    }
    return new Promise((resolve) => {
      this.pending.set(request.requestId, { request, resolve, timer: null })
      this.queue.push(request.requestId)
      this.pump()
    })
  }

  respond(requestId: string, decision: 'once' | 'session' | 'deny'): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    if (decision === 'session') {
      this.allowed.add(this.key(entry.request.sessionId, entry.request.tool))
    }
    this.finish(requestId, decision)
    return true
  }

  cancelSession(sessionId: string): void {
    const ids = [...this.pending.entries()]
      .filter(([, entry]) => entry.request.sessionId === sessionId)
      .map(([id]) => id)
    for (const id of ids) this.finish(id, 'deny')
  }

  close(): void {
    for (const id of [...this.pending.keys()]) this.finish(id, 'deny')
    this.allowed.clear()
  }

  private pump(): void {
    if (this.current) return
    const id = this.queue.shift()
    if (!id) return
    const entry = this.pending.get(id)
    if (!entry) {
      this.pump()
      return
    }
    this.current = id
    if (!this.options.send(entry.request)) {
      this.finish(id, 'deny')
      return
    }
    entry.timer = setTimeout(() => this.finish(id, 'timeout'), this.timeoutMs)
  }

  private finish(id: string, outcome: McpPermissionOutcome): void {
    const entry = this.pending.get(id)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    this.pending.delete(id)
    const queued = this.queue.indexOf(id)
    if (queued >= 0) this.queue.splice(queued, 1)
    this.options.audit?.record({
      at: Date.now(),
      domain: 'mcp',
      action: outcome === 'deny' || outcome === 'timeout' ? 'deny' : 'approve',
      targetId: entry.request.sessionId,
      title: entry.request.tool,
      source: 'agent',
      detail: `${entry.request.domain} · ${outcome}`
    })
    entry.resolve(outcome)
    if (this.current === id) {
      this.current = null
      this.pump()
    }
  }

  private key(sessionId: string, tool: string): string {
    return `${sessionId}:${tool}`
  }
}
