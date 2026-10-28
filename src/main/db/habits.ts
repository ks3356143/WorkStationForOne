import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import { isDateKey } from '../../shared/date-key'
import type { HabitRecord } from '../../shared/ipc'

interface HabitRow {
  id: string
  name: string
  checkins: string | null
}

// 一次查完习惯与打卡，避免每条习惯再查一次（N+1）
const LIST_SQL = `
  SELECT h.id, h.name,
    (SELECT group_concat(c.day, ',') FROM (
       SELECT day FROM habit_checkins WHERE habit_id = h.id ORDER BY day
     ) AS c
    ) AS checkins
  FROM habits h
  ORDER BY h.sort_order ASC, h.created_at ASC`

const INSERT_HABIT_SQL = 'INSERT INTO habits (id, name, sort_order, created_at) VALUES (?, ?, ?, ?)'

const CHECKIN_SQL =
  'INSERT INTO habit_checkins (habit_id, day, created_at) VALUES (?, ?, ?) ON CONFLICT (habit_id, day) DO NOTHING'

const UNCHECK_SQL = 'DELETE FROM habit_checkins WHERE habit_id = ? AND day = ?'

function toRecord(row: HabitRow): HabitRecord {
  return {
    id: row.id,
    name: row.name,
    checkins: row.checkins ? row.checkins.split(',').filter((day) => isDateKey(day)) : []
  }
}

export class HabitRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit?: AuditLog
  ) {}

  private statement(sql: string): StatementSync {
    return this.db.prepare(sql)
  }

  list(): HabitRecord[] {
    return (this.statement(LIST_SQL).all() as unknown as HabitRow[]).map(toRecord)
  }

  /** 仅空库播种：有习惯就跳过，避免覆盖用户数据。 */
  bootstrap(habits: HabitRecord[]): void {
    const count = this.statement('SELECT COUNT(*) AS n FROM habits').get() as { n?: number }
    if (Number(count?.n ?? 0) > 0) return

    const insert = this.statement(INSERT_HABIT_SQL)
    const checkin = this.statement(CHECKIN_SQL)
    const now = Date.now()
    this.db.exec('BEGIN')
    try {
      habits.forEach((habit, index) => {
        insert.run(habit.id, habit.name, index, now)
        for (const day of habit.checkins) checkin.run(habit.id, day, now)
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  setCheckin(id: string, day: string, done: boolean): void {
    const at = Date.now()
    if (done) this.statement(CHECKIN_SQL).run(id, day, at)
    else this.statement(UNCHECK_SQL).run(id, day)
    this.audit?.record({
      at,
      domain: 'habit',
      action: 'checkin',
      targetId: id,
      detail: `${day} ${done ? '打卡' : '取消'}`
    })
  }
}
