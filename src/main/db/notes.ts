import { randomUUID } from 'node:crypto'
import type { DatabaseSync, StatementSync } from 'node:sqlite'
import { runInTransaction } from './transaction'
import { noteLinkName, parseNoteLinks } from '../../shared/note-links'
import type {
  NoteLinkRef,
  NoteLinks,
  NotePage,
  NotePatch,
  NoteRecord,
  NoteSearchHit
} from '../../shared/ipc'
import type { AuditLog } from './audit'

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
    return runInTransaction(this.db, run)
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
      // 全部插入后再解析，种子里的链接才能互相看到对方。
      notes.forEach((note, index) => {
        this.rewriteLinks(note.id, note.text, now - index)
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
    const record = this.transaction(() => {
      const created = this.insert(text, tag, false, now)
      this.rewriteLinks(created.id, text, now)
      return created
    })
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

  /**
   * 改正文 / 标签 / 置顶。标签传空字符串表示清除，undefined 表示不动。
   * FTS 索引由 notes_fts_update 触发器同步，这里不需要手动重建。
   */
  update(id: string, patch: NotePatch): NoteRecord | undefined {
    const existing = this.find(id)
    if (!existing) return undefined

    const assignments: string[] = []
    const values: (string | number | null)[] = []

    if (patch.text !== undefined) {
      assignments.push('body = ?', 'title = ?')
      values.push(patch.text, patch.text.slice(0, 40))
    }
    if (patch.tag !== undefined) {
      assignments.push('tag = ?')
      values.push(patch.tag.trim() === '' ? null : patch.tag.trim())
    }
    if (patch.pinned !== undefined) {
      assignments.push('pinned = ?')
      values.push(patch.pinned ? 1 : 0)
    }
    if (assignments.length === 0) return existing

    const at = Date.now()
    this.transaction(() => {
      this.sql(`UPDATE notes SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`).run(
        ...values,
        at,
        id
      )
      if (patch.text !== undefined) this.rewriteLinks(id, patch.text, at)
    })
    const updated = this.find(id)
    if (!updated) return undefined

    this.audit?.record({
      at,
      domain: 'note',
      action: 'update',
      targetId: id,
      title: updated.text.slice(0, 60)
    })
    return updated
  }

  /** 硬删：笔记没有引用关系，留着只是占位；FTS 由触发器清理。 */
  remove(id: string): boolean {
    const at = Date.now()
    const existing = this.find(id)
    if (!existing) return false
    this.sql('DELETE FROM notes WHERE id = ?').run(id)
    this.audit?.record({
      at,
      domain: 'note',
      action: 'delete',
      targetId: id,
      title: existing.text.slice(0, 60)
    })
    return true
  }

  /** 当前笔记的出链（按正文出现顺序）与被引用列表。 */
  links(id: string): NoteLinks {
    const source = this.find(id)
    if (!source) return { outgoing: [], backlinks: [] }

    const stored = this.sql('SELECT title, target_id FROM note_links WHERE source_id = ?').all(
      id
    ) as unknown as { title: string; target_id: string }[]
    const storedByTitle = new Map(stored.map((row) => [row.title, row.target_id]))
    const names = this.nameIndex(id)
    const outgoing: NoteLinkRef[] = []
    const seen = new Set<string>()

    for (const token of parseNoteLinks(source.text)) {
      if (seen.has(token.title)) continue
      seen.add(token.title)
      const targetId = storedByTitle.get(token.title)
      const target = targetId ? this.find(targetId) : undefined
      if (targetId && target) {
        outgoing.push({ title: token.title, status: 'ok', targetId, target })
        continue
      }
      const count = names.get(token.title)?.length ?? 0
      outgoing.push({ title: token.title, status: count > 1 ? 'ambiguous' : 'missing' })
    }

    const rows = this.sql(
      `SELECT n.id, n.body, n.tag, n.pinned, n.time_label
       FROM note_links l JOIN notes n ON n.id = l.source_id
       WHERE l.target_id = ?
       GROUP BY n.id
       ORDER BY MAX(n.updated_at) DESC, MAX(n.rowid) DESC`
    ).all(id) as unknown as NoteRow[]

    return { outgoing, backlinks: rows.map(toRecord) }
  }

  /** 链接名补全：只给唯一命中，重名的不猜。 */
  titles(raw: string, limit: number, excludeId?: string): string[] {
    const query = raw.trim().toLowerCase()
    const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 50)
    const own = excludeId ? noteLinkName(this.find(excludeId)?.text ?? '') : ''
    const rows = this.sql(
      'SELECT id, body FROM notes ORDER BY pinned DESC, updated_at DESC, rowid DESC'
    ).all() as unknown as { id: string; body: string }[]

    const counts = new Map<string, number>()
    for (const row of rows) {
      if (row.id === excludeId) continue
      const name = noteLinkName(row.body)
      if (!name || name === own) continue
      if (query && !name.toLowerCase().startsWith(query)) continue
      counts.set(name, (counts.get(name) ?? 0) + 1)
    }

    return [...counts.entries()]
      .filter(([, count]) => count === 1)
      .map(([name]) => name)
      .slice(0, safeLimit)
  }

  private nameIndex(excludeId: string): Map<string, string[]> {
    const rows = this.sql('SELECT id, body FROM notes WHERE id != ?').all(excludeId) as unknown as {
      id: string
      body: string
    }[]
    const names = new Map<string, string[]>()
    for (const row of rows) {
      const name = noteLinkName(row.body)
      if (!name) continue
      const list = names.get(name)
      if (list) list.push(row.id)
      else names.set(name, [row.id])
    }
    return names
  }

  /** 先删后建：保存后的正文就是当前真相，不保留历史边。 */
  private rewriteLinks(sourceId: string, text: string, at: number): void {
    this.sql('DELETE FROM note_links WHERE source_id = ?').run(sourceId)
    const names = this.nameIndex(sourceId)
    const seen = new Set<string>()
    for (const link of parseNoteLinks(text)) {
      if (seen.has(link.title)) continue
      seen.add(link.title)
      const targets = names.get(link.title)
      if (targets?.length !== 1) continue
      this.sql(
        `INSERT OR REPLACE INTO note_links (source_id, target_id, title, created_at)
         VALUES (?, ?, ?, ?)`
      ).run(sourceId, targets[0], link.title, at)
    }
  }

  find(id: string): NoteRecord | undefined {
    const row = this.sql('SELECT id, body, tag, pinned, time_label FROM notes WHERE id = ?').get(
      id
    ) as NoteRow | undefined
    return row ? toRecord(row) : undefined
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
