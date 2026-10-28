import type { DatabaseSync } from 'node:sqlite'

export type AuditDomain = 'task' | 'note' | 'learning' | 'habit'
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'restore'
  | 'complete'
  | 'rename-list'
  | 'bootstrap'
  | 'checkin'
  | 'review'
  | 'toggle-pin'

export interface AuditEntry {
  at: number
  domain: AuditDomain
  action: AuditAction
  targetId?: string
  /** 标题快照：目标改名或删除之后，仍然看得出这条记录说的是谁 */
  title?: string
  /** 写入来源：ui / capture / agent，MCP 接入后还会用它区分外部改动 */
  source?: 'ui' | 'capture' | 'agent' | 'system'
  detail?: string
}

export interface AuditRecord extends AuditEntry {
  id: number
  source: NonNullable<AuditEntry['source']>
}

const INSERT_SQL = `INSERT INTO audit_log (at, domain, action, target_id, title, source, detail)
  VALUES (?, ?, ?, ?, ?, ?, ?)`

const LIST_SQL = `SELECT id, at, domain, action, target_id, title, source, detail
  FROM audit_log ORDER BY id DESC LIMIT ?`

interface AuditRow {
  id: number
  at: number
  domain: AuditDomain
  action: AuditAction
  target_id: string | null
  title: string | null
  source: NonNullable<AuditEntry['source']>
  detail: string | null
}

/**
 * 写入审计。挂在整个仓储层而不是各个 IPC handler：
 * 未来接 MCP 或定时任务时，只要走仓储就一定留痕，不会因为新入口漏记。
 */
export class AuditLog {
  private readonly insert
  private readonly list

  constructor(private readonly db: DatabaseSync) {
    this.insert = db.prepare(INSERT_SQL)
    this.list = db.prepare(LIST_SQL)
  }

  record(entry: AuditEntry): void {
    try {
      this.insert.run(
        entry.at,
        entry.domain,
        entry.action,
        entry.targetId ?? null,
        entry.title ?? null,
        entry.source ?? 'ui',
        entry.detail ?? null
      )
    } catch (error) {
      // 审计失败不该让业务写入回滚：数据是主角，记录是证据
      console.error('[audit] 写入失败', error)
    }
  }

  recent(limit = 50): AuditRecord[] {
    return (this.list.all(limit) as unknown as AuditRow[]).map((row) => ({
      id: row.id,
      at: row.at,
      domain: row.domain,
      action: row.action,
      ...(row.target_id ? { targetId: row.target_id } : {}),
      ...(row.title ? { title: row.title } : {}),
      source: row.source,
      ...(row.detail ? { detail: row.detail } : {})
    }))
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM audit_log').get() as { n?: number }
    return Number(row?.n ?? 0)
  }
}
