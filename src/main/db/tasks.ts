import type { DatabaseSync } from 'node:sqlite'
import type { TaskRecord, TaskScheduleChange } from '../../shared/ipc'
interface TaskRow {
  id: string
  title: string
  time_label: string
  tag: string | null
  tone: 'agent' | 'hot' | null
  done: number
}

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
  constructor(private readonly db: DatabaseSync) {}

  list(): TaskRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, time_label, tag, tone, done
         FROM tasks
         ORDER BY sort_order ASC, created_at ASC`
      )
      .all() as unknown as TaskRow[]
    return rows.map(toRecord)
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM tasks').get() as { n: number }
    return Number(row.n)
  }

  bootstrap(tasks: TaskRecord[]): void {
    if (this.count() > 0) return

    const now = Date.now()
    const insert = this.db.prepare(
      `INSERT INTO tasks (id, title, time_label, tag, tone, done, sort_order, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )

    this.db.exec('BEGIN')
    try {
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
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  setDone(id: string, done: boolean): void {
    const now = Date.now()
    this.db
      .prepare('UPDATE tasks SET done = ?, completed_at = ?, updated_at = ? WHERE id = ?')
      .run(done ? 1 : 0, done ? now : null, now, id)
  }

  applySchedule(changes: TaskScheduleChange[]): void {
    if (changes.length === 0) return

    const now = Date.now()
    const update = this.db.prepare('UPDATE tasks SET time_label = ?, tag = ?, updated_at = ? WHERE id = ?')

    this.db.exec('BEGIN')
    try {
      for (const change of changes) update.run(change.toTime, change.toTag, now, change.taskId)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}
