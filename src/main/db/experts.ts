import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { BUILTIN_EXPERTS } from '../../shared/experts'
import type { ExpertRecord, ExpertSaveInput, ExpertSourceRecord } from '../../shared/ipc'

interface ExpertRow {
  id: string
  name: string
  description: string
  persona: string
  tools_json: string
  builtin: number
  created_at: number
  updated_at: number
}

interface ExpertSourceRow {
  id: string
  name: string
  url: string
  ref: string
  root: string
  last_synced_at: number | null
  last_error: string
  created_at: number
  updated_at: number
}

export interface ExpertSourceUpsert {
  id: string
  name: string
  url: string
  ref: string
  root: string
}

function parseTools(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value)) return []
    return value.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function toExpert(row: ExpertRow): ExpertRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    persona: row.persona,
    tools: parseTools(row.tools_json),
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

function toSource(row: ExpertSourceRow): ExpertSourceRecord {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    ref: row.ref,
    root: row.root,
    lastSyncedAt: row.last_synced_at,
    lastError: row.last_error,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

/** 自定义专家与市场源的持久化；内置专家不入库，由服务层合并。 */
export class ExpertRepository {
  constructor(private readonly db: DatabaseSync) {}

  listExperts(): ExpertRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, persona, tools_json, builtin, created_at, updated_at
         FROM agent_experts WHERE builtin = 0 ORDER BY updated_at DESC`
      )
      .all() as unknown as ExpertRow[]
    return rows.map(toExpert)
  }

  findExpert(id: string): ExpertRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, description, persona, tools_json, builtin, created_at, updated_at
         FROM agent_experts WHERE id = ?`
      )
      .get(id) as ExpertRow | undefined
    return row ? toExpert(row) : undefined
  }

  saveExpert(input: ExpertSaveInput): ExpertRecord {
    const now = Date.now()
    const name = input.name.trim()
    const description = input.description.trim()
    // 仓储层再兜一次上限：市场导入与自进化绕过 IPC 校验时也不能无限注入系统提示。
    const persona = input.persona.slice(0, 20_000)
    const tools = input.tools.slice(0, 50)
    const toolsJson = JSON.stringify(tools)
    const existing = input.id ? this.findExpert(input.id) : undefined
    // 内置 id 保留给内置项；同 id 的自定义行会让 find() 静默遮蔽其中一个。
    if (!existing && input.id && BUILTIN_EXPERTS.some((def) => def.id === input.id)) {
      throw new Error('内置专家 id 不可占用')
    }
    if (existing) {
      if (existing.builtin) throw new Error('内置专家不可覆盖')
      this.db
        .prepare(
          `UPDATE agent_experts SET name = ?, description = ?, persona = ?, tools_json = ?, updated_at = ?
           WHERE id = ?`
        )
        .run(name, description, persona, toolsJson, now, existing.id)
      return {
        ...existing,
        name,
        description,
        persona,
        tools,
        updatedAt: now
      }
    }
    const id = input.id ?? `expert-${randomUUID()}`
    this.db
      .prepare(
        `INSERT INTO agent_experts (id, name, description, persona, tools_json, builtin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(id, name, description, persona, toolsJson, now, now)
    return {
      id,
      name,
      description,
      persona,
      tools,
      builtin: false,
      createdAt: now,
      updatedAt: now
    }
  }

  removeExpert(id: string): boolean {
    const result = this.db.prepare('DELETE FROM agent_experts WHERE id = ? AND builtin = 0').run(id)
    return Number(result.changes) > 0
  }

  listSources(): ExpertSourceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, url, ref, root, last_synced_at, last_error, created_at, updated_at
         FROM expert_sources ORDER BY created_at ASC`
      )
      .all() as unknown as ExpertSourceRow[]
    return rows.map(toSource)
  }

  findSource(id: string): ExpertSourceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, url, ref, root, last_synced_at, last_error, created_at, updated_at
         FROM expert_sources WHERE id = ?`
      )
      .get(id) as ExpertSourceRow | undefined
    return row ? toSource(row) : undefined
  }

  findSourceByName(name: string): ExpertSourceRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, url, ref, root, last_synced_at, last_error, created_at, updated_at
         FROM expert_sources WHERE name = ?`
      )
      .get(name) as ExpertSourceRow | undefined
    return row ? toSource(row) : undefined
  }

  saveSource(input: ExpertSourceUpsert): ExpertSourceRecord {
    if (this.findSourceByName(input.name)) throw new Error(`源「${input.name}」已存在`)
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO expert_sources (id, name, url, ref, root, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, '', ?, ?)`
      )
      .run(input.id, input.name, input.url, input.ref, input.root, now, now)
    const saved = this.findSource(input.id)
    if (!saved) throw new Error('专家源保存失败')
    return saved
  }

  updateSourceSync(id: string, patch: { lastSyncedAt: number | null; lastError: string }): void {
    this.db
      .prepare(
        'UPDATE expert_sources SET last_synced_at = ?, last_error = ?, updated_at = ? WHERE id = ?'
      )
      .run(patch.lastSyncedAt, patch.lastError, Date.now(), id)
  }

  removeSource(id: string): void {
    this.db.prepare('DELETE FROM expert_sources WHERE id = ?').run(id)
  }
}
