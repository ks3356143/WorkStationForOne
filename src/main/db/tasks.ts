import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { dateKey } from '../../shared/date-key'
import { nextDueDate } from '../../shared/repeat'
import type {
  TaskDraft,
  TaskPatch,
  TaskPriority,
  TaskRecord,
  TaskScheduleChange
} from '../../shared/ipc'

interface TaskRow {
  id: string
  title: string
  time_label: string
  tag: string | null
  tone: 'agent' | 'hot' | null
  done: number
  notes: string
  due_date: string | null
  priority: number
  list: string | null
  completed_at: number | null
  planned_for: string | null
  estimate_minutes: number
  repeat: 'daily' | 'weekly' | 'monthly' | null
  created_at: number
}

const COLUMNS = `id, title, time_label, tag, tone, done, notes, due_date, priority, list, completed_at, planned_for, estimate_minutes, repeat, created_at`

const LIST_SQL = `SELECT ${COLUMNS}
  FROM tasks
  WHERE deleted_at IS NULL
  ORDER BY sort_order ASC, created_at ASC`

const FIND_SQL = `SELECT ${COLUMNS} FROM tasks WHERE id = ? AND deleted_at IS NULL`

const INSERT_SQL = `INSERT INTO tasks
  (id, title, time_label, tag, tone, done, notes, due_date, priority, list, completed_at, planned_for, estimate_minutes, repeat, sort_order, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const SET_DONE_SQL =
  'UPDATE tasks SET done = ?, completed_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
const APPLY_SCHEDULE_SQL =
  'UPDATE tasks SET time_label = ?, tag = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
const APPLY_SCHEDULE_DUE_SQL =
  'UPDATE tasks SET time_label = ?, tag = ?, due_date = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
const RENAME_LIST_SQL =
  'UPDATE tasks SET list = ?, updated_at = ? WHERE list = ? AND deleted_at IS NULL'
const NEXT_SORT_SQL = 'SELECT COALESCE(MIN(sort_order), 0) - 1 AS n FROM tasks'
const SOFT_DELETE_SQL =
  'UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL'
const RESTORE_SQL =
  'UPDATE tasks SET deleted_at = NULL, updated_at = ? WHERE id = ? AND deleted_at IS NOT NULL'
const PURGE_SQL = 'DELETE FROM tasks WHERE deleted_at IS NOT NULL AND deleted_at < ?'

const PATCH_COLUMNS: Record<keyof TaskPatch, string> = {
  title: 'title',
  time: 'time_label',
  tag: 'tag',
  tone: 'tone',
  notes: 'notes',
  dueDate: 'due_date',
  priority: 'priority',
  list: 'list',
  plannedFor: 'planned_for',
  estimateMinutes: 'estimate_minutes',
  repeat: 'repeat'
}

function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    time: row.time_label,
    tag: row.tag ?? undefined,
    tone: row.tone ?? undefined,
    done: row.done === 1,
    notes: row.notes,
    dueDate: row.due_date ?? undefined,
    priority: row.priority as TaskPriority,
    list: row.list ?? undefined,
    completedAt: row.completed_at ?? undefined,
    plannedFor: row.planned_for ?? undefined,
    estimateMinutes: row.estimate_minutes,
    ...(row.repeat ? { repeat: row.repeat } : {}),
    createdAt: row.created_at
  }
}

export class TaskRepository {
  private readonly statements = new Map<string, StatementSync>()

  constructor(private readonly db: DatabaseSync) {}

  private sql(query: string): StatementSync {
    let statement = this.statements.get(query)
    if (!statement) {
      statement = this.db.prepare(query)
      this.statements.set(query, statement)
    }
    return statement
  }

  private transaction<T>(run: () => T): T {
    this.db.exec('BEGIN')
    try {
      const result = run()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  list(): TaskRecord[] {
    const rows = this.sql(LIST_SQL).all() as unknown as TaskRow[]
    return rows.map(toRecord)
  }

  find(id: string): TaskRecord | undefined {
    const row = this.sql(FIND_SQL).get(id) as TaskRow | undefined
    return row ? toRecord(row) : undefined
  }

  bootstrap(tasks: TaskRecord[]): void {
    const row = this.sql('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }
    if (Number(row.n) > 0) return

    const now = Date.now()
    const insert = this.sql(INSERT_SQL)

    this.transaction(() => {
      tasks.forEach((task, index) => {
        insert.run(
          task.id,
          task.title,
          task.time,
          task.tag ?? null,
          task.tone ?? null,
          task.done ? 1 : 0,
          task.notes ?? '',
          task.dueDate ?? null,
          task.priority ?? 0,
          task.list ?? null,
          task.done ? now : null,
          task.plannedFor ?? null,
          task.estimateMinutes ?? 0,
          task.repeat ?? null,
          index,
          now,
          now
        )
      })
    })
  }

  create(draft: TaskDraft): TaskRecord {
    const id = randomUUID()
    const now = Date.now()
    const next = this.sql(NEXT_SORT_SQL).get() as { n: number }

    this.sql(INSERT_SQL).run(
      id,
      draft.title,
      draft.time ?? '—',
      draft.tag ?? null,
      draft.tone ?? null,
      0,
      draft.notes ?? '',
      draft.dueDate ?? null,
      draft.priority ?? 0,
      draft.list ?? null,
      null,
      draft.plannedFor ?? null,
      draft.estimateMinutes ?? 0,
      draft.repeat ?? null,
      Number(next.n),
      now,
      now
    )

    const created = this.find(id)
    if (!created) throw new Error('任务写入失败')
    return created
  }

  update(id: string, patch: TaskPatch): void {
    const entries = (Object.keys(PATCH_COLUMNS) as (keyof TaskPatch)[])
      .filter((key) => patch[key] !== undefined)
      .map((key) => [PATCH_COLUMNS[key], patch[key] as string | number | null] as const)
    if (entries.length === 0) return

    const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
    this.sql(
      `UPDATE tasks SET ${assignments}, updated_at = ? WHERE id = ? AND deleted_at IS NULL`
    ).run(...entries.map(([, value]) => value), Date.now(), id)
  }

  remove(id: string): void {
    const now = Date.now()
    this.sql(SOFT_DELETE_SQL).run(now, now, id)
  }

  restore(id: string): void {
    this.sql(RESTORE_SQL).run(Date.now(), id)
  }

  /** 清理过了保留期的已删任务，返回清理条数。 */
  purgeDeleted(olderThan: number): number {
    const result = this.sql(PURGE_SQL).run(olderThan)
    return Number(result.changes ?? 0)
  }

  setDone(id: string, done: boolean): void {
    const now = Date.now()
    this.sql(SET_DONE_SQL).run(done ? 1 : 0, done ? now : null, now, id)
  }

  /**
   * 勾选完成。重复任务在同一事务里生成下一轮：先落完成态，再插入新条目，
   * 任一步失败就整体回滚，不会出现「完成了但没生成下一次」的半截状态。
   */
  completeTask(id: string): TaskRecord | null {
    const current = this.find(id)
    if (!current || current.done) {
      this.setDone(id, true)
      return null
    }

    let created: TaskRecord | null = null
    this.transaction(() => {
      this.setDone(id, true)
      if (!current.repeat) return
      // 以本次到期日为基准推下一次；没有截止日期就从今天算
      const base = current.dueDate ?? dateKey()
      const dueDate = nextDueDate(current.repeat, base)
      created = this.create({
        title: current.title,
        time: current.time === '—' ? undefined : current.time,
        tag: current.tag,
        tone: current.tone,
        notes: current.notes,
        dueDate,
        priority: current.priority,
        list: current.list,
        repeat: current.repeat,
        estimateMinutes: current.estimateMinutes
      })
    })
    return created
  }

  /** 一次 UPDATE 改完整组任务，不逐条走 update，避免半途失败留下两个清单。 */
  renameList(from: string, to: string): number {
    const result = this.sql(RENAME_LIST_SQL).run(to, Date.now(), from)
    return Number(result.changes ?? 0)
  }

  applySchedule(changes: TaskScheduleChange[]): void {
    if (changes.length === 0) return

    const now = Date.now()
    const update = this.sql(APPLY_SCHEDULE_SQL)
    const updateDue = this.sql(APPLY_SCHEDULE_DUE_SQL)
    this.transaction(() => {
      for (const change of changes) {
        if (change.toDueDate === undefined) {
          update.run(change.toTime, change.toTag, now, change.taskId)
        } else {
          updateDue.run(change.toTime, change.toTag, change.toDueDate, now, change.taskId)
        }
      }
    })
  }
}
