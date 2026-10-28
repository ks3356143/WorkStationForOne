import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import type { AuditLog } from './audit'
import type { NotePage, NoteRecord, NoteSearchHit } from '../../shared/ipc'

interface NoteRow {
  id: string
  body: string
  tag: string | null
  pinned: number
  time_label: string
}

interface SearchRow extends NoteRow {
  snippet: string
  score: number
}

const TRIGRAM_MIN = 3
const SNIPPET_RADIUS = 26

const LIST_SQL = `SELECT id, body, tag, pinned, time_label FROM notes
  ORDER BY pinned DESC, updated_at DESC, rowid DESC
  LIMIT ? OFFSET ?`

const COUNT_SQL = 'SELECT COUNT(*) AS n FROM notes'

const SEARCH_FTS_SQL = `SELECT n.id, n.body, n.tag, n.pinned, n.time_label,
    snippet(notes_fts, 1, '\u0001', '\u0002', '…', 12) AS snippet,
    bm25(notes_fts) AS score
  FROM notes_fts
  JOIN notes n ON n.rowid = notes_fts.rowid
  WHERE notes_fts MATCH ?
  ORDER BY n.pinned DESC, score ASC
  LIMIT ?`

const SEARCH_LIKE_HEAD = `SELECT id, body, tag, pinned, time_label,
    '' AS snippet, 0 AS score
  FROM notes
  WHERE `
const SEARCH_LIKE_CLAUSE = `(body LIKE ? ESCAPE '\\' OR IFNULL(tag, '') LIKE ? ESCAPE '\\')`
const SEARCH_LIKE_TAIL = `
  ORDER BY pinned DESC, updated_at DESC, rowid DESC
  LIMIT ?`

// 短词回退必须保留每个关键词：只用第一个会静默放宽结果。
function likeSql(termCount: number): string {
  const where = Array.from({ length: termCount }, () => SEARCH_LIKE_CLAUSE).join(' AND ')
  return `${SEARCH_LIKE_HEAD}${where}${SEARCH_LIKE_TAIL}`
}

function toRecord(row: NoteRow): NoteRecord {
  return {
    id: row.id,
    text: row.body,
    time: row.time_label,
    tag: row.tag ?? undefined,
    pinned: row.pinned === 1
  }
}

// FTS5 snippet() 用这两个控制字符包住命中区间，读取后换回方括号。
const SNIPPET_MARK_OPEN = '\u0001'
const SNIPPET_MARK_CLOSE = '\u0002'

function normalizeSnippet(snippet: string): string {
  return snippet
    .replaceAll(SNIPPET_MARK_OPEN, '[')
    .replaceAll(SNIPPET_MARK_CLOSE, ']')
    .replace(/\s+/g, ' ')
    .trim()
}

function likeSnippet(body: string, term: string): string {
  const at = body.toLowerCase().indexOf(term.toLowerCase())
  if (at < 0) return body.slice(0, SNIPPET_RADIUS * 2)
  const start = Math.max(0, at - SNIPPET_RADIUS)
  const end = Math.min(body.length, at + term.length + SNIPPET_RADIUS)
  return `${start > 0 ? '…' : ''}${body.slice(start, at)}[${body.slice(at, at + term.length)}]${body.slice(
    at + term.length,
    end
  )}${end < body.length ? '…' : ''}`
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

function ftsPhrase(term: string): string {
  return `"${term.replace(/"/g, '""')}"`
}

export interface SearchPlan {
  mode: 'fts' | 'like'
  value: string
  terms: string[]
}

export function planSearch(raw: string): SearchPlan | null {
  const terms = raw.trim().split(/\s+/).filter(Boolean)
  if (terms.length === 0) return null
  const usesTrigram = terms.every((term) => [...term].length >= TRIGRAM_MIN)
  if (usesTrigram) {
    return { mode: 'fts', value: terms.map(ftsPhrase).join(' '), terms }
  }
  return { mode: 'like', value: terms.map(escapeLike).join(' '), terms }
}

export class NoteRepository {
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

  count(): number {
    const row = this.sql(COUNT_SQL).get() as { n: number }
    return Number(row.n)
  }

  bootstrap(notes: NoteRecord[]): void {
    if (this.count() > 0) return
    const now = Date.now()
    this.transaction(() => {
      notes.forEach((note, index) => {
        this.insert(note.text, note.tag, note.pinned === true, now - index, note.id, note.time)
      })
    })
  }

  page(offset: number, limit: number): NotePage {
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 200)
    const safeOffset = Math.max(0, Math.trunc(offset))
    const rows = this.sql(LIST_SQL).all(safeLimit, safeOffset) as unknown as NoteRow[]
    return { items: rows.map(toRecord), total: this.count() }
  }

  search(raw: string, limit: number): NoteSearchHit[] {
    const plan = planSearch(raw)
    if (!plan) return []
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 100)

    if (plan.mode === 'fts') {
      const rows = this.sql(SEARCH_FTS_SQL).all(plan.value, safeLimit) as unknown as SearchRow[]
      return rows.map((row) => ({ ...toRecord(row), snippet: normalizeSnippet(row.snippet) }))
    }

    const patterns = plan.terms.map((term) => `%${escapeLike(term)}%`)
    const rows = this.sql(likeSql(patterns.length)).all(
      ...patterns.flatMap((pattern) => [pattern, pattern]),
      safeLimit
    ) as unknown as SearchRow[]
    return rows.map((row) => ({
      ...toRecord(row),
      snippet: likeSnippet(row.body, plan.terms[0])
    }))
  }

  create(text: string, tag?: string): NoteRecord {
    const now = Date.now()
    const record = this.insert(text, tag, false, now)
    this.audit?.record({
      at: now,
      domain: 'note',
      action: 'create',
      targetId: record.id,
      title: text.slice(0, 60)
    })
    return record
  }

  togglePin(id: string): void {
    const at = Date.now()
    this.sql('UPDATE notes SET pinned = 1 - pinned, updated_at = ? WHERE id = ?').run(at, id)
    this.audit?.record({ at, domain: 'note', action: 'toggle-pin', targetId: id })
  }

  private insert(
    text: string,
    tag: string | undefined,
    pinned: boolean,
    at: number,
    id: string = randomUUID(),
    timeLabel?: string
  ): NoteRecord {
    const time =
      timeLabel ??
      new Date(at).toLocaleTimeString('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      })
    const title = text.slice(0, 40)
    this.sql(
      `INSERT INTO notes (id, title, body, tag, pinned, created_at, updated_at, time_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, title, text, tag ?? null, pinned ? 1 : 0, at, at, time)
    return { id, text, time, tag, pinned }
  }
}
