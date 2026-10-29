import { describe, expect, it, vi } from 'vitest'
import type { McpPermissionRequest } from '../../shared/ipc'
import type { AuditLog } from '../db/audit'
import { McpPermissionBroker } from './permissions'

function setup(timeoutMs = 30) {
  const sent: McpPermissionRequest[] = []
  const audit = { record: vi.fn() }
  const broker = new McpPermissionBroker({
    send: (request) => {
      sent.push(request)
      return true
    },
    audit: audit as unknown as AuditLog,
    timeoutMs
  })
  return { broker, sent, audit }
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
    const { broker, sent } = setup()
    const first = broker.request(input('s1'))
    broker.respond(sent[0].requestId, 'session')
    await expect(first).resolves.toBe('session')

    await expect(broker.request(input('s1'))).resolves.toBe('session')
    expect(sent).toHaveLength(1)

    const otherTool = broker.request(input('s1', 'tasks_update'))
    expect(sent).toHaveLength(2)
    expect(broker.respond(sent[1].requestId, 'deny')).toBe(true)
    await expect(otherTool).resolves.toBe('deny')
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
    expect(broker.isSessionAllowed('s1', 'tasks_create')).toBe(false)
  })
})
