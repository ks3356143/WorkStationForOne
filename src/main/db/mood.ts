import type { DatabaseSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import { addDaysKey, dateKey, isDateKey } from '../../shared/date-key'
import type { MoodRecord, MoodSaveInput } from '../../shared/ipc'

interface MoodRow {
  day: string
  mood: number
  energy: number
  note: string
  updated_at: number
}

const NOTE_MAX = 500
const RECENT_MAX = 366

function toRecord(row: MoodRow): MoodRecord {
  return {
    day: row.day,
    mood: row.mood,
    energy: row.energy,
    note: row.note,
    updatedAt: row.updated_at
  }
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 3
  return Math.min(5, Math.max(1, Math.round(value)))
}

/** 每日心情/精力打卡的持久化；一天一条 upsert。 */
export class MoodRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit?: AuditLog
  ) {}

  get(day: string): MoodRecord | null {
    const row = this.db
      .prepare('SELECT day, mood, energy, note, updated_at FROM mood_entries WHERE day = ?')
      .get(day) as MoodRow | undefined
    return row ? toRecord(row) : null
  }

  save(input: MoodSaveInput): MoodRecord {
    if (!isDateKey(input.day)) throw new TypeError('日期无效')
    const mood = clampLevel(input.mood)
    const energy = clampLevel(input.energy)
    const note = (input.note ?? '').trim().slice(0, NOTE_MAX)
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO mood_entries (day, mood, energy, note, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (day) DO UPDATE SET mood = excluded.mood, energy = excluded.energy,
           note = excluded.note, updated_at = excluded.updated_at`
      )
      .run(input.day, mood, energy, note, now)
    this.audit?.record({
      at: now,
      domain: 'system',
      action: 'mood-save',
      targetId: input.day,
      detail: `心情 ${mood} · 精力 ${energy}`
    })
    return { day: input.day, mood, energy, note, updatedAt: now }
  }

  /** 最近 days 天（含今天）的记录，按日期倒序。 */
  recent(days: number): MoodRecord[] {
    const window = Math.min(RECENT_MAX, Math.max(1, Math.floor(days)))
    const cutoff = addDaysKey(dateKey(), -(window - 1))
    const rows = this.db
      .prepare(
        'SELECT day, mood, energy, note, updated_at FROM mood_entries WHERE day >= ? ORDER BY day DESC'
      )
      .all(cutoff) as unknown as MoodRow[]
    return rows.map(toRecord)
  }
}
