import type { DatabaseSync } from 'node:sqlite'
import {
  MCP_DEFAULT_MODES,
  MCP_DOMAINS,
  type McpDomain,
  type McpMode,
  type McpPolicyRecord
} from '../../shared/ipc'
import { MCP_TOOLS } from '../mcp/tools'
import type { AuditLog } from './audit'

interface PolicyRow {
  domain: McpDomain
  mode: McpMode
}

const BUILTIN_NAMES = new Set(MCP_TOOLS.map((tool) => tool.name))

export class McpPolicyRepository {
  constructor(
    private readonly db: DatabaseSync,
    private readonly audit?: AuditLog
  ) {}

  list(): McpPolicyRecord[] {
    const rows = this.db
      .prepare('SELECT domain, mode FROM mcp_domain_modes')
      .all() as unknown as PolicyRow[]
    const stored = new Map(rows.map((row) => [row.domain, row.mode]))
    return MCP_DOMAINS.map((domain) => ({
      domain,
      mode: stored.get(domain) ?? MCP_DEFAULT_MODES[domain]
    }))
  }

  mode(domain: McpDomain): McpMode {
    const row = this.db.prepare('SELECT mode FROM mcp_domain_modes WHERE domain = ?').get(domain) as
      | { mode?: McpMode }
      | undefined
    return row?.mode ?? MCP_DEFAULT_MODES[domain]
  }

  set(domain: McpDomain, mode: McpMode): McpPolicyRecord {
    const at = Date.now()
    this.db
      .prepare(
        `INSERT INTO mcp_domain_modes (domain, mode, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(domain) DO UPDATE SET mode = excluded.mode, updated_at = excluded.updated_at`
      )
      .run(domain, mode, at)
    this.audit?.record({
      at,
      domain: 'system',
      action: 'settings',
      targetId: domain,
      title: 'MCP 数据权限',
      source: 'system',
      detail: `${domain} → ${mode}`
    })
    return { domain, mode }
  }

  /** 被关闭的内置工具名；缺行即启用，因此只查 disabled=0 的行。 */
  disabledTools(known: readonly string[] = [...BUILTIN_NAMES]): string[] {
    const rows = this.db
      .prepare('SELECT name FROM builtin_tool_settings WHERE enabled = 0')
      .all() as { name: string }[]
    const knownSet = new Set(known)
    return rows.map((row) => row.name).filter((name) => knownSet.has(name))
  }

  isToolEnabled(name: string): boolean {
    const row = this.db
      .prepare('SELECT enabled FROM builtin_tool_settings WHERE name = ?')
      .get(name) as { enabled?: number } | undefined
    return row?.enabled !== 0
  }

  setToolEnabled(name: string, enabled: boolean): void {
    if (!BUILTIN_NAMES.has(name)) throw new Error('未知的内置工具')
    const at = Date.now()
    this.db
      .prepare(
        `INSERT INTO builtin_tool_settings (name, enabled, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`
      )
      .run(name, enabled ? 1 : 0, at)
    this.audit?.record({
      at,
      domain: 'system',
      action: 'settings',
      targetId: name,
      title: '内置工具开关',
      source: 'system',
      detail: `builtin-tool → ${enabled ? 'enabled' : 'disabled'}`
    })
  }
}
