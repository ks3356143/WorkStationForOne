export const MCP_DOMAINS = ['task', 'habit', 'learning', 'note'] as const
export type McpDomain = (typeof MCP_DOMAINS)[number]
export type McpMode = 'read' | 'ask' | 'write'
export const MCP_DEFAULT_MODES: Record<McpDomain, McpMode> = {
  task: 'write',
  habit: 'read',
  learning: 'read',
  note: 'read'
}

export interface McpPolicyRecord {
  domain: McpDomain
  mode: McpMode
}

export interface McpPermissionRequest {
  requestId: string
  sessionId: string
  domain: McpDomain
  tool: string
  detail: string
  preview: string
  createdAt: number
}

export type McpPermissionDecision = 'once' | 'session' | 'workspace' | 'deny'

export interface McpPermissionResponse {
  requestId: string
  decision: McpPermissionDecision
}

export interface McpApi {
  policy: () => Promise<McpPolicyRecord[]>
  setPolicy: (domain: McpDomain, mode: McpMode) => Promise<void>
  respondPermission: (response: McpPermissionResponse) => Promise<boolean>
  onPermission: (listener: (request: McpPermissionRequest) => void) => () => void
  /** MCP 写入成功后广播受影响的域，渲染层据此重新读库 */
  onChanged: (listener: (domains: McpDomain[]) => void) => () => void
}
