import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerMcpHandlersIPC } = await import('./mcp')

describe('MCP 权限与审计参数', () => {
  it('只接受四个域与两档模式', () => {
    expect(registerMcpHandlersIPC.assertDomain('task')).toBe('task')
    expect(registerMcpHandlersIPC.assertMode('write')).toBe('write')
    expect(() => registerMcpHandlersIPC.assertDomain('system')).toThrow(TypeError)
    expect(() => registerMcpHandlersIPC.assertMode('ask')).toThrow(TypeError)
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
