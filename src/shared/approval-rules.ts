export type ApprovalAgent = 'claude' | 'codex'
export type ApprovalScope = 'once' | 'session' | 'workspace'
export const APPROVAL_SCOPES = ['once', 'session', 'workspace'] as const

const MCP_PREFIX = 'MCP · '
const BRIDGE_SERVER = 'workstationforone'
const CLAUDE_LOCAL_READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS'])

/**
 * 工作区标识：Windows 路径不区分大小写，`/` 与 `\` 等价，尾部分隔符不算差异。
 * 这里只做比较用的规范化，不解析 `..` 或符号链接——落库路径在主进程已经过校验。
 */
export function workspaceKey(path: string): string {
  return path.trim().replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase()
}

export function isMcpToolName(agent: ApprovalAgent, toolName: string): boolean {
  return agent === 'claude' ? toolName.startsWith('mcp__') : toolName.startsWith(MCP_PREFIX)
}

/** 只有 MCP 工具与 Claude 的只读工具允许「本工作区始终允许」，写入与 Shell 一律逐次审批。 */
export function isWorkspaceScopable(agent: ApprovalAgent, toolName: string): boolean {
  if (isMcpToolName(agent, toolName)) return true
  return agent === 'claude' && CLAUDE_LOCAL_READ_TOOLS.has(toolName)
}

/** 本地桥工具在适配器层的规范名：Claude 用 `mcp__server__tool`，Codex 用 elicitation 的 `MCP · server/tool`。 */
export function bridgeToolName(agent: ApprovalAgent, tool: string): string {
  return agent === 'claude'
    ? `mcp__${BRIDGE_SERVER}__${tool}`
    : `${MCP_PREFIX}${BRIDGE_SERVER}/${tool}`
}
