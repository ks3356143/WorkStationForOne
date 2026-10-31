import { describe, expect, it } from 'vitest'
import {
  APPROVAL_SCOPES,
  bridgeToolName,
  isMcpToolName,
  isWorkspaceScopable,
  workspaceKey
} from './approval-rules'

describe('workspaceKey', () => {
  it('统一分隔符、去掉尾部斜杠并转小写', () => {
    expect(workspaceKey('C:\\Work\\Demo\\')).toBe('c:\\work\\demo')
    expect(workspaceKey('C:/Work/Demo')).toBe('c:\\work\\demo')
    expect(workspaceKey('  C:\\Work\\Demo  ')).toBe('c:\\work\\demo')
    expect(workspaceKey('C:\\')).toBe('c:')
  })
})

describe('工具资格', () => {
  it('Claude 只允许 MCP 与本地只读工具持久', () => {
    expect(isWorkspaceScopable('claude', 'mcp__memory__read')).toBe(true)
    expect(isWorkspaceScopable('claude', 'mcp__workstationforone__tasks_create')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Read')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Grep')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Glob')).toBe(true)
    expect(isWorkspaceScopable('claude', 'LS')).toBe(true)
    expect(isWorkspaceScopable('claude', 'Bash')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Write')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Edit')).toBe(false)
    expect(isWorkspaceScopable('claude', 'NotebookEdit')).toBe(false)
    expect(isWorkspaceScopable('claude', 'Task')).toBe(false)
    expect(isWorkspaceScopable('claude', 'WebFetch')).toBe(false)
    expect(isWorkspaceScopable('claude', 'WebSearch')).toBe(false)
    expect(isWorkspaceScopable('claude', 'UnknownTool')).toBe(false)
  })

  it('Codex 只允许 MCP elicitation 工具持久', () => {
    expect(isWorkspaceScopable('codex', 'MCP · memory/search')).toBe(true)
    expect(isWorkspaceScopable('codex', 'MCP · workstationforone/tasks_create')).toBe(true)
    expect(isWorkspaceScopable('codex', 'Shell')).toBe(false)
    expect(isWorkspaceScopable('codex', 'Patch')).toBe(false)
    expect(isWorkspaceScopable('codex', 'Permissions')).toBe(false)
    expect(isWorkspaceScopable('codex', 'mcp__memory__read')).toBe(false)
    // Codex elicitation 缺少工具名时的占位卡名不能冒充 MCP 工具，否则会落成整台 Server 的规则
    expect(isWorkspaceScopable('codex', 'MCP 未解析工具 · memory')).toBe(false)
  })

  it('识别 MCP 工具名', () => {
    expect(isMcpToolName('claude', 'mcp__memory__read')).toBe(true)
    expect(isMcpToolName('claude', 'Read')).toBe(false)
    expect(isMcpToolName('codex', 'MCP · memory/search')).toBe(true)
    expect(isMcpToolName('codex', 'Shell')).toBe(false)
  })
})

describe('桥工具规范名', () => {
  it('按 Agent 还原为适配器层的工具名', () => {
    expect(bridgeToolName('claude', 'tasks_create')).toBe('mcp__workstationforone__tasks_create')
    expect(bridgeToolName('codex', 'tasks_create')).toBe('MCP · workstationforone/tasks_create')
  })

  it('作用域常量与规格一致', () => {
    expect(APPROVAL_SCOPES).toEqual(['once', 'session', 'workspace'])
  })
})
