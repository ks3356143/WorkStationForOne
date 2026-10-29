import type { DatabaseSync } from 'node:sqlite'
import {
  MCP_DEFAULT_MODES,
  MCP_DOMAINS,
  type McpDomain,
  type McpMode,
  type McpPolicyRecord
} from '../../shared/ipc'
import type { AuditLog } from './audit'

interface PolicyRow {
  domain: McpDomain
  mode: McpMode
}

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
}
