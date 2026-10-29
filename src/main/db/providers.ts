import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { ProviderProfileRecord, ProviderSaveInput } from '../../shared/ipc'

interface ProviderRow {
  id: string
  name: string
  base_url: string
  model: string
  token_encrypted: Uint8Array | null
  active: number
  created_at: number
  updated_at: number
}

function toRecord(row: ProviderRow): ProviderProfileRecord {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    model: row.model,
    hasToken: Boolean(row.token_encrypted && row.token_encrypted.length > 0),
    active: row.active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export interface ActiveProvider {
  profile: ProviderProfileRecord
  token?: Buffer
}

export class ProviderRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): ProviderProfileRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, base_url, model, token_encrypted, active, created_at, updated_at
         FROM provider_profiles ORDER BY created_at ASC`
      )
      .all() as unknown as ProviderRow[]
    return rows.map(toRecord)
  }

  /**
   * 保存非密钥字段。token 传 undefined 表示保留旧值，传 null 表示清除。
   * 新配置默认不激活，由调用方显式 setActive。
   */
  save(input: ProviderSaveInput, token?: Buffer | null): ProviderProfileRecord {
    const now = Date.now()
    const existing = input.id
      ? (this.db
          .prepare('SELECT id, token_encrypted, created_at FROM provider_profiles WHERE id = ?')
          .get(input.id) as
          | { id: string; token_encrypted: Uint8Array | null; created_at: number }
          | undefined)
      : undefined
    const id = existing?.id ?? input.id ?? `provider-${randomUUID()}`
    const createdAt = existing?.created_at ?? now

    if (existing) {
      const assignments = ['name = ?', 'base_url = ?', 'model = ?', 'updated_at = ?']
      const values: (string | number | Uint8Array | null)[] = [
        input.name,
        input.baseUrl,
        input.model,
        now
      ]
      if (token !== undefined) {
        assignments.push('token_encrypted = ?')
        values.push(token)
      }
      values.push(id)
      this.db
        .prepare(`UPDATE provider_profiles SET ${assignments.join(', ')} WHERE id = ?`)
        .run(...values)
    } else {
      this.db
        .prepare(
          `INSERT INTO provider_profiles
            (id, name, base_url, model, token_encrypted, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(id, input.name, input.baseUrl, input.model, token ?? null, createdAt, now)
    }

    const row = this.db
      .prepare(
        `SELECT id, name, base_url, model, token_encrypted, active, created_at, updated_at
         FROM provider_profiles WHERE id = ?`
      )
      .get(id) as unknown as ProviderRow
    return toRecord(row)
  }

  /** null 表示回到「继承 Claude CLI」。 */
  setActive(id: string | null): void {
    this.db.exec('BEGIN')
    try {
      this.db.prepare('UPDATE provider_profiles SET active = 0').run()
      if (id) {
        this.db.prepare('UPDATE provider_profiles SET active = 1 WHERE id = ?').run(id)
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  activeSecret(): ActiveProvider | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, base_url, model, token_encrypted, active, created_at, updated_at
         FROM provider_profiles WHERE active = 1`
      )
      .get() as ProviderRow | undefined
    if (!row) return undefined
    const token = row.token_encrypted ? Buffer.from(row.token_encrypted) : undefined
    return {
      profile: toRecord(row),
      ...(token && token.length > 0 ? { token } : {})
    }
  }
}
