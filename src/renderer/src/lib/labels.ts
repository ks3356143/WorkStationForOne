import type { AuditLogDomain, McpDomain, McpMode } from '../../../shared/ipc'

/** 数据域的中文名：能力中心、设置页与 MCP 权限矩阵共用一份。 */
export const MCP_DOMAIN_LABELS: Record<McpDomain, string> = {
  task: '任务',
  habit: '习惯',
  learning: '学习',
  note: '笔记'
}

export const MCP_MODE_LABELS: Record<McpMode, string> = {
  read: '只读',
  ask: '询问',
  write: '可写'
}

/** 审计域比数据域多 mcp 与 system（设置类记录）。 */
export const AUDIT_DOMAIN_LABELS: Record<AuditLogDomain, string> = {
  ...MCP_DOMAIN_LABELS,
  mcp: 'MCP',
  system: '设置'
}

/** 筛选顺序是手工排的：设置类放最后，日常数据域靠前。 */
export const AUDIT_FILTERS: { value: AuditLogDomain | 'all'; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'task', label: '任务' },
  { value: 'note', label: '笔记' },
  { value: 'learning', label: '学习' },
  { value: 'habit', label: '习惯' },
  { value: 'mcp', label: 'MCP' },
  { value: 'system', label: '设置' }
]

/** 审批规则与活动记录里的时间：MM-DD HH:mm，24 小时制。 */
export function auditTime(at: number): string {
  return new Date(at).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  })
}
