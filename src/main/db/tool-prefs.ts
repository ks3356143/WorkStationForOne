import type { DatabaseSync } from 'node:sqlite'
import type { AgentKind } from '../../shared/ipc'

export interface ToolPrefRow {
  agent: AgentKind
  key: string
  enabled: boolean
  sortOrder: number
  /** 首选：提示词里单独成组，并要求优先于 CLI 原生工具 */
  preferred: boolean
}

interface Row {
  agent: AgentKind
  tool_key: string
  enabled: number
  sort_order: number
  preferred: number
}

const NATIVE_PREFIX = 'native:'

export class ToolPrefRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(agent: AgentKind): ToolPrefRow[] {
    const rows = this.db
      .prepare(
        `SELECT agent, tool_key, enabled, sort_order, preferred
           FROM agent_tool_prefs WHERE agent = ? ORDER BY sort_order ASC`
      )
      .all(agent) as unknown as Row[]
    return rows.map((row) => ({
      agent: row.agent,
      key: row.tool_key,
      enabled: row.enabled === 1,
      sortOrder: row.sort_order,
      preferred: row.preferred === 1
    }))
  }

  /** 没有行的原生工具默认启用；只返回显式关闭的组 id。 */
  disabledNative(agent: AgentKind): string[] {
    const rows = this.db
      .prepare(
        "SELECT tool_key FROM agent_tool_prefs WHERE agent = ? AND enabled = 0 AND tool_key LIKE 'native:%'"
      )
      .all(agent) as unknown as { tool_key: string }[]
    return rows.map((row) => row.tool_key.slice(NATIVE_PREFIX.length))
  }

  setNative(agent: AgentKind, id: string, enabled: boolean): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_tool_prefs (agent, tool_key, enabled, sort_order, updated_at)
         VALUES (?, ?, ?, 0, ?)
         ON CONFLICT(agent, tool_key) DO UPDATE SET enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(agent, `${NATIVE_PREFIX}${id}`, enabled ? 1 : 0, now)
  }

  order(agent: AgentKind): Map<string, number> {
    const rows = this.db
      .prepare(
        'SELECT tool_key, sort_order FROM agent_tool_prefs WHERE agent = ? AND tool_key NOT LIKE ?'
      )
      .all(agent, `${NATIVE_PREFIX}%`) as unknown as { tool_key: string; sort_order: number }[]
    return new Map(rows.map((row) => [row.tool_key, row.sort_order]))
  }

  /** 显式标为首选的 MCP / 技能键；没有行的项一律不是首选。 */
  preferred(agent: AgentKind): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT tool_key FROM agent_tool_prefs
          WHERE agent = ? AND preferred = 1 AND tool_key NOT LIKE ?`
      )
      .all(agent, `${NATIVE_PREFIX}%`) as unknown as { tool_key: string }[]
    return new Set(rows.map((row) => row.tool_key))
  }

  setPreferred(agent: AgentKind, key: string, preferred: boolean): void {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO agent_tool_prefs (agent, tool_key, enabled, sort_order, preferred, updated_at)
         VALUES (?, ?, 1, 0, ?, ?)
         ON CONFLICT(agent, tool_key) DO UPDATE SET preferred = excluded.preferred,
           updated_at = excluded.updated_at`
      )
      .run(agent, key, preferred ? 1 : 0, now)
  }

  /** 只改顺序：保留已有 enabled / preferred，不要把首选顺手清掉。 */
  setOrder(agent: AgentKind, keys: string[]): void {
    if (keys.length === 0) return
    const now = Date.now()
    const statement = this.db.prepare(
      `INSERT INTO agent_tool_prefs (agent, tool_key, enabled, sort_order, updated_at)
       VALUES (?, ?, 1, ?, ?)
       ON CONFLICT(agent, tool_key) DO UPDATE SET sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`
    )
    this.db.exec('BEGIN')
    try {
      keys.forEach((key, index) => {
        statement.run(agent, key, index, now)
      })
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  remove(agent: AgentKind, key: string): void {
    this.db.prepare('DELETE FROM agent_tool_prefs WHERE agent = ? AND tool_key = ?').run(agent, key)
  }
}
