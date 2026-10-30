import { randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { runInTransaction } from './transaction'
import type {
  ProviderProfileRecord,
  ProviderSaveInput,
  ProviderTarget,
  ProviderWireApi
} from '../../shared/ipc'

interface ProviderRow {
  id: string
  name: string
  target: ProviderTarget
  wire_api: ProviderWireApi
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
    target: row.target,
    wireApi: row.wire_api,
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
        `SELECT id, name, target, wire_api, base_url, model, token_encrypted, active, created_at, updated_at
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
          .prepare(
            'SELECT id, target, token_encrypted, created_at FROM provider_profiles WHERE id = ?'
          )
          .get(input.id) as
          | {
              id: string
              target: ProviderTarget
              token_encrypted: Uint8Array | null
              created_at: number
            }
          | undefined)
      : undefined
    const id = existing?.id ?? input.id ?? `provider-${randomUUID()}`
    const createdAt = existing?.created_at ?? now

    if (existing) {
      const assignments = [
        'name = ?',
        'wire_api = ?',
        'base_url = ?',
        'model = ?',
        'updated_at = ?'
      ]
      const values: (string | number | Uint8Array | null)[] = [
        input.name,
        input.wireApi,
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
            (id, name, target, wire_api, base_url, model, token_encrypted, active, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        )
        .run(
          id,
          input.name,
          input.target,
          input.wireApi,
          input.baseUrl,
          input.model,
          token ?? null,
          createdAt,
          now
        )
    }

    const row = this.db
      .prepare(
        `SELECT id, name, target, wire_api, base_url, model, token_encrypted, active, created_at, updated_at
         FROM provider_profiles WHERE id = ?`
      )
      .get(id) as unknown as ProviderRow
    return toRecord(row)
  }

  /** null 表示该目标回到「继承 CLI」。 */
  setActive(target: ProviderTarget, id: string | null): void {
    runInTransaction(this.db, () => {
      this.db.prepare('UPDATE provider_profiles SET active = 0 WHERE target = ?').run(target)
      if (id) {
        this.db
          .prepare('UPDATE provider_profiles SET active = 1 WHERE id = ? AND target = ?')
          .run(id, target)
      }
    })
  }

  activeSecret(target: ProviderTarget): ActiveProvider | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, target, wire_api, base_url, model, token_encrypted, active, created_at, updated_at
         FROM provider_profiles WHERE active = 1 AND target = ?`
      )
      .get(target) as ProviderRow | undefined
    if (!row) return undefined
    const token = row.token_encrypted ? Buffer.from(row.token_encrypted) : undefined
    return {
      profile: toRecord(row),
      ...(token && token.length > 0 ? { token } : {})
    }
  }
}
