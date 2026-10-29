import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerMcpHandlersIPC } = await import('./mcp')

describe('MCP 权限与审计参数', () => {
  it('只接受四个域与两档模式', () => {
    expect(registerMcpHandlersIPC.assertDomain('task')).toBe('task')
    expect(registerMcpHandlersIPC.assertMode('write')).toBe('write')
    expect(registerMcpHandlersIPC.assertMode('ask')).toBe('ask')
    expect(() => registerMcpHandlersIPC.assertDomain('system')).toThrow(TypeError)
    expect(() => registerMcpHandlersIPC.assertMode('auto')).toThrow(TypeError)
  })

  it('审批响应只接受三种决定', () => {
    expect(
      registerMcpHandlersIPC.assertPermissionResponse({
        requestId: 'p1',
        decision: 'session'
      })
    ).toEqual({ requestId: 'p1', decision: 'session' })
    expect(() =>
      registerMcpHandlersIPC.assertPermissionResponse({ requestId: '', decision: 'once' })
    ).toThrow(TypeError)
    expect(() =>
      registerMcpHandlersIPC.assertPermissionResponse({ requestId: 'p1', decision: 'always' })
    ).toThrow(TypeError)
  })

  it('审计只接受已知域与 1–200 条', () => {
    expect(registerMcpHandlersIPC.assertAuditDomain(undefined)).toBeUndefined()
    expect(registerMcpHandlersIPC.assertAuditDomain('mcp')).toBe('mcp')
    expect(() => registerMcpHandlersIPC.assertAuditDomain('agent')).toThrow(TypeError)
    expect(registerMcpHandlersIPC.assertLimit(undefined)).toBe(50)
    expect(registerMcpHandlersIPC.assertLimit(30)).toBe(30)
    expect(() => registerMcpHandlersIPC.assertLimit(0)).toThrow(TypeError)
    expect(() => registerMcpHandlersIPC.assertLimit(201)).toThrow(TypeError)
  })
})
