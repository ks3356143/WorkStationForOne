import { randomUUID } from 'node:crypto'
import type { McpDomain, McpPermissionRequest } from '../../shared/ipc'
import type { AuditLog } from '../db/audit'

export type McpPermissionOutcome = 'once' | 'session' | 'workspace' | 'deny' | 'timeout'

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
  /** 与桥钩子同义：本会话已允许或命中工作区规则 */
  isPreApproved?: (sessionId: string, tool: string) => boolean
  grantSession?: (sessionId: string, tool: string) => void
  grantWorkspace?: (request: McpPermissionRequest) => void
}

const DEFAULT_TIMEOUT = 60_000

/**
 * MCP 写入询问队列：一次只展示一张卡。
 * 会话 / 工作区规则由 ApprovalRuleService 持有；这里只负责排队、超时与审计。
 * 超时、窗口不可用、回合取消都按拒绝处理，绝不默认放行。
 */
export class McpPermissionBroker {
  private readonly pending = new Map<string, PendingPermission>()
  private readonly queue: string[] = []
  private current: string | null = null
  private readonly timeoutMs: number

  constructor(private readonly options: McpPermissionBrokerOptions) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT
  }

  request(input: McpPermissionInput): Promise<McpPermissionOutcome> {
    if (this.options.isPreApproved?.(input.sessionId, input.tool)) {
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

  respond(requestId: string, decision: 'once' | 'session' | 'workspace' | 'deny'): boolean {
    const entry = this.pending.get(requestId)
    if (!entry) return false
    try {
      if (decision === 'session') {
        this.options.grantSession?.(entry.request.sessionId, entry.request.tool)
      }
      if (decision === 'workspace') {
        this.options.grantWorkspace?.(entry.request)
      }
    } catch (error) {
      // 规则落库失败不能让当前审批悬挂
      console.error('[mcp] 保存审批规则失败', error)
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
}
