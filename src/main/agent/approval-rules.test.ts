import { describe, expect, it, vi } from 'vitest'
import type { ApprovalRuleRecord } from '../../shared/ipc'
import type { AgentRepository } from '../db/agent'
import type { ApprovalRuleRepository } from '../db/approval-rules'
import type { AuditLog } from '../db/audit'
import { ApprovalRuleService } from './approval-rules'

function rule(overrides: Partial<ApprovalRuleRecord> = {}): ApprovalRuleRecord {
  return {
    id: 'r1',
    agent: 'claude',
    workspace: 'C:\\Work\\Demo',
    toolName: 'mcp__memory__read',
    createdAt: 100,
    lastUsedAt: null,
    ...overrides
  }
}

function session(id: string, agent: 'claude' | 'codex') {
  return {
    id,
    agent,
    title: id,
    status: 'idle' as const,
    workspace: 'C:\\Work\\Demo',
    createdAt: 1,
    updatedAt: 1
  }
}

function setup(seed: ApprovalRuleRecord[] = []) {
  const rules = {
    list: vi.fn(() => seed),
    find: vi.fn((agent: string, key: string, toolName: string) =>
      seed.find(
        (item) => item.agent === agent && item.toolName === toolName && key === 'c:\\work\\demo'
      )
    ),
    upsert: vi.fn((input) => {
      const created: ApprovalRuleRecord = {
        id: input.id,
        agent: input.agent,
        workspace: input.workspace,
        toolName: input.toolName,
        createdAt: input.now,
        lastUsedAt: null
      }
      seed.push(created)
      return created
    }),
    touch: vi.fn(),
    remove: vi.fn(() => true)
  }
  const sessions = {
    findSession: vi.fn((id: string) =>
      id === 's1' ? session('s1', 'claude') : id === 's2' ? session('s2', 'codex') : undefined
    )
  }
  const audit = { record: vi.fn() }
  const service = new ApprovalRuleService({
    rules: rules as unknown as ApprovalRuleRepository,
    sessions: sessions as unknown as Pick<AgentRepository, 'findSession'>,
    audit: audit as unknown as AuditLog,
    now: () => 500
  })
  return { service, rules, audit }
}

const context = { sessionId: 's1', agent: 'claude' as const, workspace: 'C:\\Work\\Demo' }

describe('ApprovalRuleService', () => {
  it('工作区命中时更新最近使用并写 auto:workspace 审计', () => {
    const { service, rules, audit } = setup([rule()])
    expect(service.check(context, 'mcp__memory__read')).toBe('workspace')
    expect(rules.touch).toHaveBeenCalledWith('r1', 500)
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'mcp',
        action: 'approve',
        title: 'mcp__memory__read',
        detail: 'auto:workspace'
      })
    )
  })

  it('会话规则按会话隔离，并写 auto:session 审计', () => {
    const { service, audit } = setup()
    service.grantSession(context, 'Bash')
    expect(service.check(context, 'Bash')).toBe('session')
    expect(service.check({ ...context, sessionId: 'other' }, 'Bash')).toBeNull()
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'system', detail: 'auto:session' })
    )
  })

  it('工作区规则不跨 Agent', () => {
    const { service } = setup([rule({ agent: 'codex' })])
    expect(service.check(context, 'mcp__memory__read')).toBeNull()
  })

  it('不合格工具不能授予工作区规则', () => {
    const { service, rules } = setup()
    expect(() => service.grantWorkspace(context, 'Bash')).toThrow(TypeError)
    expect(rules.upsert).not.toHaveBeenCalled()
  })

  it('授予工作区规则会写设置审计', () => {
    const { service, rules, audit } = setup()
    service.grantWorkspace(context, 'mcp__memory__read')
    expect(rules.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        agent: 'claude',
        workspace: 'C:\\Work\\Demo',
        workspaceKey: 'c:\\work\\demo',
        toolName: 'mcp__memory__read'
      })
    )
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'system',
        action: 'settings',
        detail: expect.stringContaining('approval-rule:create')
      })
    )
  })

  it('桥工具按会话 Agent 还原规范名', () => {
    const { service } = setup([rule({ toolName: 'mcp__workstationforone__tasks_create' })])
    expect(service.resolveBridge('s1', 'tasks_create')).toMatchObject({
      toolName: 'mcp__workstationforone__tasks_create'
    })
    expect(service.checkBridge('s1', 'tasks_create')).toBe(true)
    expect(service.resolveBridge('s2', 'tasks_create')).toMatchObject({
      toolName: 'MCP · workstationforone/tasks_create'
    })
  })

  it('仓储抛错时按未命中处理', () => {
    const { service, rules } = setup([rule()])
    rules.find.mockImplementation(() => {
      throw new Error('db closed')
    })
    expect(service.check(context, 'mcp__memory__read')).toBeNull()
  })

  it('撤销规则写审计，resetSession 清空内存', () => {
    const { service, rules, audit } = setup([rule()])
    service.remove('r1')
    expect(rules.remove).toHaveBeenCalledWith('r1')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ detail: expect.stringContaining('approval-rule:revoke') })
    )
    service.grantSession(context, 'Bash')
    service.resetSession()
    expect(service.check(context, 'Bash')).toBeNull()
  })
})
