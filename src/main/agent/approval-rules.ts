import { randomUUID } from 'node:crypto'
import {
  bridgeToolName,
  isMcpToolName,
  isWorkspaceScopable,
  workspaceKey,
  type ApprovalAgent
} from '../../shared/approval-rules'
import type { ApprovalRuleRecord } from '../../shared/ipc'
import type { AgentRepository } from '../db/agent'
import type { ApprovalRuleRepository } from '../db/approval-rules'
import type { AuditLog } from '../db/audit'

export interface ApprovalRuleContext {
  sessionId: string
  agent: ApprovalAgent
  workspace: string
}

export type ApprovalRuleMatch = 'session' | 'workspace'

export interface ApprovalRuleServiceOptions {
  rules: ApprovalRuleRepository
  sessions: Pick<AgentRepository, 'findSession'>
  audit?: AuditLog
  now?: () => number
}

export class ApprovalRuleService {
  private readonly sessionAllowed = new Map<string, Set<string>>()
  private readonly now: () => number

  constructor(private readonly options: ApprovalRuleServiceOptions) {
    this.now = options.now ?? Date.now
  }

  isWorkspaceEligible(agent: ApprovalAgent, toolName: string): boolean {
    return isWorkspaceScopable(agent, toolName)
  }

  check(context: ApprovalRuleContext, toolName: string): ApprovalRuleMatch | null {
    try {
      if (this.sessionAllowed.get(context.sessionId)?.has(toolName)) {
        this.recordAuto(context, toolName, 'session')
        return 'session'
      }
      if (!isWorkspaceScopable(context.agent, toolName)) return null
      const rule = this.options.rules.find(context.agent, workspaceKey(context.workspace), toolName)
      if (!rule) return null
      this.options.rules.touch(rule.id, this.now())
      this.recordAuto(context, toolName, 'workspace')
      return 'workspace'
    } catch (error) {
      console.error('[approval-rules] 规则查询失败，按未命中处理', error)
      return null
    }
  }

  grantSession(context: ApprovalRuleContext, toolName: string): void {
    const set = this.sessionAllowed.get(context.sessionId) ?? new Set<string>()
    set.add(toolName)
    this.sessionAllowed.set(context.sessionId, set)
  }

  grantWorkspace(context: ApprovalRuleContext, toolName: string): void {
    if (!isWorkspaceScopable(context.agent, toolName)) {
      throw new TypeError('该工具不支持工作区持久规则')
    }
    const now = this.now()
    const rule = this.options.rules.upsert({
      id: `rule-${randomUUID()}`,
      agent: context.agent,
      workspace: context.workspace,
      workspaceKey: workspaceKey(context.workspace),
      toolName,
      now
    })
    this.options.audit?.record({
      at: now,
      domain: 'system',
      action: 'settings',
      targetId: rule.id,
      title: toolName,
      source: 'ui',
      detail: `approval-rule:create agent=${context.agent} workspace=${context.workspace}`
    })
  }

  resolveBridge(
    sessionId: string,
    tool: string
  ): { context: ApprovalRuleContext; toolName: string } | null {
    const session = this.options.sessions.findSession(sessionId)
    if (!session?.workspace) return null
    return {
      context: { sessionId, agent: session.agent, workspace: session.workspace },
      toolName: bridgeToolName(session.agent, tool)
    }
  }

  checkBridge(sessionId: string, tool: string): boolean {
    const resolved = this.resolveBridge(sessionId, tool)
    return resolved ? this.check(resolved.context, resolved.toolName) !== null : false
  }

  grantBridgeSession(sessionId: string, tool: string): void {
    const resolved = this.resolveBridge(sessionId, tool)
    if (resolved) this.grantSession(resolved.context, resolved.toolName)
  }

  grantBridgeWorkspace(sessionId: string, tool: string): void {
    const resolved = this.resolveBridge(sessionId, tool)
    if (resolved) this.grantWorkspace(resolved.context, resolved.toolName)
  }

  list(): ApprovalRuleRecord[] {
    return this.options.rules.list()
  }

  remove(id: string): void {
    const rule = this.options.rules.list().find((item) => item.id === id)
    if (!rule) return
    if (!this.options.rules.remove(id)) return
    this.options.audit?.record({
      at: this.now(),
      domain: 'system',
      action: 'settings',
      targetId: rule.id,
      title: rule.toolName,
      source: 'ui',
      detail: `approval-rule:revoke agent=${rule.agent} workspace=${rule.workspace}`
    })
  }

  resetSession(): void {
    this.sessionAllowed.clear()
  }

  private recordAuto(
    context: ApprovalRuleContext,
    toolName: string,
    scope: ApprovalRuleMatch
  ): void {
    this.options.audit?.record({
      at: this.now(),
      domain: isMcpToolName(context.agent, toolName) ? 'mcp' : 'system',
      action: 'approve',
      targetId: context.sessionId,
      title: toolName,
      source: 'agent',
      detail: `auto:${scope}`
    })
  }
}
