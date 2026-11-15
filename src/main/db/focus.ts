import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import type { FocusLogInput, FocusRecord } from '../../shared/ipc'

interface FocusRow {
  id: string
  task_id: string | null
  label: string
  kind: string
  minutes: number
  started_at: number
  completed_at: number | null
}

const MINUTES_MAX = 1440
const LABEL_MAX = 120
const RECENT_MAX = 366

function toRecord(row: FocusRow): FocusRecord {
  return {
    id: row.id,
    taskId: row.task_id,
    label: row.label,
    kind: row.kind === 'break' ? 'break' : 'focus',
    minutes: row.minutes,
    startedAt: row.started_at,
    completedAt: row.completed_at
  }
}

/** 专注/番茄钟工时的持久化；任务实际工时按 task_id 汇总派生，不给 tasks 加列。 */
export class FocusRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit?: AuditLog
  ) {}

  log(input: FocusLogInput): FocusRecord {
    if (input.kind !== 'focus' && input.kind !== 'break') throw new TypeError('专注类型无效')
    const minutes = Math.min(MINUTES_MAX, Math.max(1, Math.round(input.minutes)))
    const label = (input.label ?? '').trim().slice(0, LABEL_MAX) || '专注'
    const taskId = input.taskId ?? null
    const id = `fs-${randomUUID()}`
    const startedAt = input.startedAt
    const completedAt = input.completedAt ?? null
    this.db
      .prepare(
        `INSERT INTO focus_sessions (id, task_id, label, kind, minutes, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, taskId, label, input.kind, minutes, startedAt, completedAt)
    this.audit?.record({
      at: Date.now(),
      domain: 'system',
      action: 'focus-log',
      targetId: taskId ?? id,
      detail: `${input.kind === 'break' ? '休息' : '专注'} ${minutes} 分钟`
    })
    return { id, taskId, label, kind: input.kind, minutes, startedAt, completedAt }
  }

  recent(days: number): FocusRecord[] {
    const window = Math.min(RECENT_MAX, Math.max(1, Math.floor(days)))
    const cutoff = Date.now() - window * 86_400_000
    const rows = this.db
      .prepare(
        `SELECT id, task_id, label, kind, minutes, started_at, completed_at
         FROM focus_sessions WHERE started_at >= ? ORDER BY started_at DESC`
      )
      .all(cutoff) as unknown as FocusRow[]
    return rows.map(toRecord)
  }

  taskMinutes(taskId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(SUM(minutes), 0) AS total FROM focus_sessions WHERE task_id = ? AND kind = 'focus'"
      )
      .get(taskId) as { total?: number }
    return Number(row?.total ?? 0)
  }
}
