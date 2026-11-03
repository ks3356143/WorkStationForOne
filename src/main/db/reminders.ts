import type { DatabaseSync } from 'node:sqlite'

/** 按「任务 + 本地日期」记录今天不再提醒；只影响通知与提醒中心，不改任务本身。 */
export class ReminderMuteRepository {
  constructor(private readonly db: DatabaseSync) {}

  mutedIds(day: string): string[] {
    const rows = this.db
      .prepare('SELECT task_id FROM reminder_mutes WHERE day = ? ORDER BY created_at ASC')
      .all(day) as { task_id: string }[]
    return rows.map((row) => row.task_id)
  }

  mute(taskId: string, day: string, at = Date.now()): void {
    this.db
      .prepare(
        `INSERT INTO reminder_mutes (task_id, day, created_at) VALUES (?, ?, ?)
         ON CONFLICT(task_id, day) DO NOTHING`
      )
      .run(taskId, day, at)
  }

  unmute(taskId: string, day: string): void {
    this.db.prepare('DELETE FROM reminder_mutes WHERE task_id = ? AND day = ?').run(taskId, day)
  }

  unmuteDay(day: string): number {
    const result = this.db.prepare('DELETE FROM reminder_mutes WHERE day = ?').run(day)
    return Number(result.changes ?? 0)
  }

  /** 只保留今天及以后；启动和跨天时清理，避免长期运行时表无限增长。 */
  pruneBefore(day: string): number {
    const result = this.db.prepare('DELETE FROM reminder_mutes WHERE day < ?').run(day)
    return Number(result.changes ?? 0)
  }
}
