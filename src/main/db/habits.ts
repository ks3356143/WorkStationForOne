import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import { isDateKey } from '../../shared/date-key'
import { runInTransaction } from './transaction'
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
    runInTransaction(this.db, () => {
      habits.forEach((habit, index) => {
        insert.run(habit.id, habit.name, index, now)
        for (const day of habit.checkins) checkin.run(habit.id, day, now)
      })
    })
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

  create(name: string): HabitRecord {
    const id = randomUUID()
    const at = Date.now()
    const order = this.statement(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM habits'
    ).get() as { next: number }
    this.statement(INSERT_HABIT_SQL).run(id, name, Number(order.next), at)
    this.audit?.record({ at, domain: 'habit', action: 'create', targetId: id, title: name })
    return { id, name, checkins: [] }
  }

  rename(id: string, name: string): boolean {
    const at = Date.now()
    const result = this.statement('UPDATE habits SET name = ? WHERE id = ?').run(name, id)
    if (Number(result.changes) === 0) return false
    this.audit?.record({ at, domain: 'habit', action: 'update', targetId: id, title: name })
    return true
  }

  remove(id: string): boolean {
    const row = this.statement('SELECT name FROM habits WHERE id = ?').get(id) as
      | { name: string }
      | undefined
    if (!row) return false
    const at = Date.now()
    runInTransaction(this.db, () => {
      this.statement('DELETE FROM habit_checkins WHERE habit_id = ?').run(id)
      this.statement('DELETE FROM habits WHERE id = ?').run(id)
    })
    this.audit?.record({
      at,
      domain: 'habit',
      action: 'delete',
      targetId: id,
      title: row.name
    })
    return true
  }
}
