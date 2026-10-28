import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import { dateKey } from '../../shared/date-key'
import type {
  LearningDraft,
  LearningItemRecord,
  LearningPatch,
  LearningRating
} from '../../shared/ipc'
import { scheduleReview } from '../../shared/srs'

interface LearningRow {
  id: string
  subject: string
  title: string
  source: string
  notes: string
  repetitions: number
  interval_days: number
  ease: number
  next_review_on: string
  last_reviewed_at: number | null
  active: number
}

const COLUMNS = `id, subject, title, source, notes, repetitions, interval_days, ease, next_review_on, last_reviewed_at, active`

const LIST_SQL = `SELECT ${COLUMNS} FROM learning_items
  ORDER BY active DESC, next_review_on ASC, title ASC`

const FIND_SQL = `SELECT ${COLUMNS} FROM learning_items WHERE id = ?`

const INSERT_SQL = `INSERT INTO learning_items
  (id, subject, title, source, notes, repetitions, interval_days, ease, next_review_on, last_reviewed_at, active, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`

const REVIEW_SQL = `INSERT INTO learning_reviews (id, item_id, rating, reviewed_at) VALUES (?, ?, ?, ?)`

const PATCH_COLUMNS: Record<keyof LearningPatch, string> = {
  subject: 'subject',
  title: 'title',
  source: 'source',
  notes: 'notes',
  nextReviewOn: 'next_review_on',
  active: 'active'
}

function toRecord(row: LearningRow): LearningItemRecord {
  return {
    id: row.id,
    subject: row.subject,
    title: row.title,
    source: row.source,
    notes: row.notes,
    repetitions: row.repetitions,
    intervalDays: row.interval_days,
    ease: row.ease,
    nextReviewOn: row.next_review_on,
    lastReviewedAt: row.last_reviewed_at ?? undefined,
    active: row.active === 1
  }
}

export class LearningRepository {
  private readonly statements = new Map<string, StatementSync>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly audit?: AuditLog
  ) {}

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

  list(): LearningItemRecord[] {
    const rows = this.sql(LIST_SQL).all() as unknown as LearningRow[]
    return rows.map(toRecord)
  }

  find(id: string): LearningItemRecord | undefined {
    const row = this.sql(FIND_SQL).get(id) as LearningRow | undefined
    return row ? toRecord(row) : undefined
  }

  bootstrap(items: LearningItemRecord[]): void {
    const row = this.sql('SELECT COUNT(*) AS n FROM learning_items').get() as { n: number }
    if (Number(row.n) > 0) return

    const now = Date.now()
    const insert = this.sql(INSERT_SQL)
    this.transaction(() => {
      for (const item of items) {
        insert.run(
          item.id,
          item.subject,
          item.title,
          item.source ?? '',
          item.notes ?? '',
          item.repetitions,
          item.intervalDays,
          item.ease,
          item.nextReviewOn,
          item.lastReviewedAt ?? null,
          item.active ? 1 : 0,
          now,
          now
        )
      }
    })
  }

  create(draft: LearningDraft): LearningItemRecord {
    const id = randomUUID()
    const now = Date.now()
    const created = this.doCreate(id, draft, now)
    this.audit?.record({
      at: now,
      domain: 'learning',
      action: 'create',
      targetId: id,
      title: draft.title
    })
    return created
  }

  private doCreate(id: string, draft: LearningDraft, now: number): LearningItemRecord {
    this.sql(INSERT_SQL).run(
      id,
      draft.subject,
      draft.title,
      draft.source ?? '',
      draft.notes ?? '',
      0,
      0,
      2.5,
      draft.nextReviewOn ?? dateKey(),
      null,
      1,
      now,
      now
    )
    const created = this.find(id)
    if (!created) throw new Error('卡片写入失败')
    return created
  }

  update(id: string, patch: LearningPatch): void {
    const entries = (Object.keys(PATCH_COLUMNS) as (keyof LearningPatch)[])
      .filter((key) => patch[key] !== undefined)
      .map(
        (key) =>
          [PATCH_COLUMNS[key], key === 'active' ? (patch.active ? 1 : 0) : patch[key]] as const
      )
    if (entries.length === 0) return

    const assignments = entries.map(([column]) => `${column} = ?`).join(', ')
    this.sql(`UPDATE learning_items SET ${assignments}, updated_at = ? WHERE id = ?`).run(
      ...entries.map(([, value]) => value as string | number),
      Date.now(),
      id
    )
  }

  /** 评分落库：调度结果与复习记录必须同时写入，否则统计与队列会互相矛盾。 */
  review(id: string, rating: LearningRating, today = dateKey()): LearningItemRecord {
    const current = this.find(id)
    if (!current) throw new Error('卡片不存在')

    const next = scheduleReview(
      {
        repetitions: current.repetitions,
        intervalDays: current.intervalDays,
        ease: current.ease
      },
      rating,
      today
    )
    const now = Date.now()

    this.transaction(() => {
      this.sql(
        `UPDATE learning_items
          SET repetitions = ?, interval_days = ?, ease = ?, next_review_on = ?,
              last_reviewed_at = ?, updated_at = ?
          WHERE id = ?`
      ).run(next.repetitions, next.intervalDays, next.ease, next.nextReviewOn, now, now, id)
      this.sql(REVIEW_SQL).run(randomUUID(), id, rating, now)
    })

    const updated = this.find(id)
    if (!updated) throw new Error('卡片更新失败')
    this.audit?.record({
      at: now,
      domain: 'learning',
      action: 'review',
      targetId: id,
      title: current.title,
      detail: `评分 ${rating} → 下次 ${next.nextReviewOn}`
    })
    return updated
  }

  reviewCount(id: string): number {
    const row = this.sql('SELECT COUNT(*) AS n FROM learning_reviews WHERE item_id = ?').get(
      id
    ) as {
      n: number
    }
    return Number(row.n)
  }
}
