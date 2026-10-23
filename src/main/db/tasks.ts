import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { TaskRecord, TaskScheduleChange } from '../../shared/ipc'

interface TaskRow {
  id: string
  title: string
  time_label: string
  tag: string | null
  tone: 'agent' | 'hot' | null
  done: number
}

const LIST_SQL = `SELECT id, title, time_label, tag, tone, done
  FROM tasks
  ORDER BY sort_order ASC, created_at ASC`

const INSERT_SQL = `INSERT INTO tasks
  (id, title, time_label, tag, tone, done, sort_order, created_at, updated_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const SET_DONE_SQL = 'UPDATE tasks SET done = ?, completed_at = ?, updated_at = ? WHERE id = ?'
const APPLY_SCHEDULE_SQL = 'UPDATE tasks SET time_label = ?, tag = ?, updated_at = ? WHERE id = ?'

function toRecord(row: TaskRow): TaskRecord {
  return {
    id: row.id,
    title: row.title,
    time: row.time_label,
    tag: row.tag ?? undefined,
    tone: row.tone ?? undefined,
    done: row.done === 1
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
          index,
          now,
          now,
          task.done ? now : null
        )
      })
    })
  }

  setDone(id: string, done: boolean): void {
    const now = Date.now()
    this.sql(SET_DONE_SQL).run(done ? 1 : 0, done ? now : null, now, id)
  }

  applySchedule(changes: TaskScheduleChange[]): void {
    if (changes.length === 0) return

    const now = Date.now()
    const update = this.sql(APPLY_SCHEDULE_SQL)
    this.transaction(() => {
      for (const change of changes) update.run(change.toTime, change.toTag, now, change.taskId)
    })
  }
}
