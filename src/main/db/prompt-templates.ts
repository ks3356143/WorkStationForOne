import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { PromptTemplateInput, PromptTemplateRecord } from '../../shared/ipc'

interface PromptTemplateRow {
  id: string
  name: string
  body: string
  created_at: number
  updated_at: number
}

function toRecord(row: PromptTemplateRow): PromptTemplateRecord {
  return {
    id: row.id,
    name: row.name,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

const NAME_MAX = 80
const BODY_MAX = 20_000

/** Composer `/` 提示词模板的持久化。 */
export class PromptTemplateRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): PromptTemplateRecord[] {
    const rows = this.db
      .prepare(
        'SELECT id, name, body, created_at, updated_at FROM prompt_templates ORDER BY updated_at DESC'
      )
      .all() as unknown as PromptTemplateRow[]
    return rows.map(toRecord)
  }

  find(id: string): PromptTemplateRecord | undefined {
    const row = this.db
      .prepare('SELECT id, name, body, created_at, updated_at FROM prompt_templates WHERE id = ?')
      .get(id) as PromptTemplateRow | undefined
    return row ? toRecord(row) : undefined
  }

  save(input: PromptTemplateInput): PromptTemplateRecord {
    const name = input.name.trim().slice(0, NAME_MAX)
    const body = input.body.trim().slice(0, BODY_MAX)
    if (!name) throw new Error('模板名称不能为空')
    if (!body) throw new Error('模板正文不能为空')
    const now = Date.now()
    const existing = input.id ? this.find(input.id) : undefined
    if (existing) {
      this.db
        .prepare('UPDATE prompt_templates SET name = ?, body = ?, updated_at = ? WHERE id = ?')
        .run(name, body, now, existing.id)
      return { ...existing, name, body, updatedAt: now }
    }
    const id = `pt-${randomUUID()}`
    this.db
      .prepare(
        'INSERT INTO prompt_templates (id, name, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
      )
      .run(id, name, body, now, now)
    return { id, name, body, createdAt: now, updatedAt: now }
  }

  remove(id: string): boolean {
    const result = this.db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id)
    return Number(result.changes) > 0
  }
}
