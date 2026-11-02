export type AuditLogDomain = 'task' | 'note' | 'learning' | 'habit' | 'mcp' | 'system'

export interface AuditLogRecord {
  id: number
  at: number
  domain: AuditLogDomain
  action: string
  targetId?: string
  title?: string
  source: string
  detail?: string
}

export interface AuditApi {
  recent: (limit?: number, domain?: AuditLogDomain) => Promise<AuditLogRecord[]>
}
