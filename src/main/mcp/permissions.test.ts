import { describe, expect, it, vi } from 'vitest'
import type { McpPermissionRequest } from '../../shared/ipc'
import type { AuditLog } from '../db/audit'
import { McpPermissionBroker } from './permissions'

function setup(timeoutMs = 30) {
  const sent: McpPermissionRequest[] = []
  const audit = { record: vi.fn() }
  const allowed = new Set<string>()
  const grantSession = vi.fn((sessionId: string, tool: string) => {
    allowed.add(`${sessionId}:${tool}`)
  })
  const grantWorkspace = vi.fn()
  const broker = new McpPermissionBroker({
    send: (request) => {
      sent.push(request)
      return true
    },
    audit: audit as unknown as AuditLog,
    timeoutMs,
    isPreApproved: (sessionId, tool) => allowed.has(`${sessionId}:${tool}`),
    grantSession,
    grantWorkspace
  })
  return { broker, sent, audit, grantSession, grantWorkspace, allowed }
}

function input(sessionId: string, tool = 'tasks_create') {
  return {
    sessionId,
    domain: 'task' as const,
    tool,
    detail: '创建任务',
    preview: '{"title":"x"}'
  }
}

describe('MCP 写入审批队列', () => {
  it('一次只展示一张卡，响应后再展示下一张', async () => {
    const { broker, sent } = setup()
    const first = broker.request(input('s1'))
    const second = broker.request(input('s2'))
    expect(sent.map((request) => request.sessionId)).toEqual(['s1'])

    expect(broker.respond(sent[0].requestId, 'once')).toBe(true)
    await expect(first).resolves.toBe('once')
    await Promise.resolve()
    expect(sent.map((request) => request.sessionId)).toEqual(['s1', 's2'])

    broker.respond(sent[1].requestId, 'deny')
    await expect(second).resolves.toBe('deny')
  })

  it('本会话允许只记住当前会话 + 当前工具', async () => {
    const { broker, sent, grantSession } = setup()
    const first = broker.request(input('s1'))
    broker.respond(sent[0].requestId, 'session')
    await expect(first).resolves.toBe('session')
    expect(grantSession).toHaveBeenCalledWith('s1', 'tasks_create')

    await expect(broker.request(input('s1'))).resolves.toBe('session')
    expect(sent).toHaveLength(1)

    const otherTool = broker.request(input('s1', 'tasks_update'))
    expect(sent).toHaveLength(2)
    broker.respond(sent[1].requestId, 'deny')
    await expect(otherTool).resolves.toBe('deny')
  })

  it('工作区允许会授予持久规则并放行当前请求', async () => {
    const { broker, sent, grantWorkspace } = setup()
    const first = broker.request(input('s1'))
    expect(broker.respond(sent[0].requestId, 'workspace')).toBe(true)
    await expect(first).resolves.toBe('workspace')
    expect(grantWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 's1', tool: 'tasks_create' })
    )
  })

  it('规则保存失败仍放行当前请求', async () => {
    const { broker, sent, grantWorkspace } = setup()
    grantWorkspace.mockImplementation(() => {
      throw new Error('db closed')
    })
    const first = broker.request(input('s1'))
    expect(broker.respond(sent[0].requestId, 'workspace')).toBe(true)
    await expect(first).resolves.toBe('workspace')
  })

  it('预检抛错时按未命中处理，仍走审批卡并正常作答', async () => {
    const sent: McpPermissionRequest[] = []
    const broker = new McpPermissionBroker({
      send: (request) => {
        sent.push(request)
        return true
      },
      isPreApproved: () => {
        throw new Error('db closed')
      },
      timeoutMs: 1000
    })
    const first = broker.request(input('s1'))
    expect(sent).toHaveLength(1)
    expect(broker.respond(sent[0].requestId, 'once')).toBe(true)
    await expect(first).resolves.toBe('once')
  })

  it('超时与回合取消都按拒绝处理并写审计', async () => {
    const { broker, sent, audit } = setup(15)
    const timedOut = broker.request(input('s1'))
    await expect(timedOut).resolves.toBe('timeout')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ domain: 'mcp', action: 'deny', detail: 'task · timeout' })
    )

    const cancelled = broker.request(input('s2'))
    expect(sent.at(-1)?.sessionId).toBe('s2')
    broker.cancelSession('s2')
    await expect(cancelled).resolves.toBe('deny')
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'deny', targetId: 's2' })
    )
  })

  it('没有可用窗口时立刻拒绝，不默认放行', async () => {
    const broker = new McpPermissionBroker({ send: () => false, timeoutMs: 1000 })
    await expect(broker.request(input('s1'))).resolves.toBe('deny')
  })

  it('关闭队列会拒绝所有挂起请求', async () => {
    const { broker } = setup()
    const first = broker.request(input('s1'))
    const second = broker.request(input('s2'))
    broker.close()
    await expect(first).resolves.toBe('deny')
    await expect(second).resolves.toBe('deny')
  })
})
