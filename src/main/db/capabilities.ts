import type { DatabaseSync } from 'node:sqlite'
import type {
  ExternalMcpServerRecord,
  ExternalMcpToolRecord,
  ExternalMcpTransport,
  McpToolApproval,
  SkillRecord
} from '../../shared/ipc'

interface PluginRow {
  id: string
  name: string
  description: string
  version: string
  marketplace: string
  install_path: string
  components: string
  has_hooks: number
  has_mcp: number
  enabled: number
  trusted: number
  installed_at: number
  updated_at: number
}

interface McpServerRow {
  id: string
  key: string
  name: string
  description: string
  transport: ExternalMcpTransport
  command: string
  args_json: string
  url: string
  source: 'catalog' | 'manual'
  catalog_id: string
  version: string
  enabled: number
  trusted: number
  tools_json: string
  last_test_at: number | null
  last_error: string
  created_at: number
  updated_at: number
}

interface SecretRow {
  kind: 'env' | 'header'
  key: string
  value_encrypted: Uint8Array
}

interface ToolRow {
  name: string
  description: string
  read_only: number
  approval: McpToolApproval
}

export interface McpToolInput {
  name: string
  description: string
  readOnly: boolean
}

export interface StoredPlugin extends SkillRecord {
  installPath: string
}

export interface PluginUpsert {
  id: string
  name: string
  description: string
  version: string
  marketplace: string
  installPath: string
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
  enabled: boolean
  trusted: boolean
}

export interface McpServerInput {
  id: string
  key: string
  name: string
  description: string
  transport: ExternalMcpTransport
  command: string
  args: string[]
  url: string
  source: 'catalog' | 'manual'
  catalogId: string
  version: string
  enabled: boolean
  trusted: boolean
}

export interface McpSecrets {
  env: Map<string, Buffer>
  headers: Map<string, Buffer>
}

function parseComponents(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function parseArgs(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

function toPlugin(row: PluginRow): StoredPlugin {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    marketplace: row.marketplace,
    installPath: row.install_path,
    components: parseComponents(row.components),
    hasHooks: row.has_hooks === 1,
    hasMcp: row.has_mcp === 1,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  }
}

function toServer(row: McpServerRow): ExternalMcpServerRecord {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    description: row.description,
    transport: row.transport,
    command: row.command,
    args: parseArgs(row.args_json),
    url: row.url,
    envKeys: [],
    headerKeys: [],
    source: row.source,
    catalogId: row.catalog_id,
    version: row.version,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    toolNames: parseArgs(row.tools_json),
    tools: [],
    lastTestAt: row.last_test_at ?? null,
    lastError: row.last_error ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export class CapabilityRepository {
  constructor(private readonly db: DatabaseSync) {}

  listPlugins(): StoredPlugin[] {
    const rows = this.db
      .prepare(
        `SELECT id, name, description, version, marketplace, install_path, components,
                has_hooks, has_mcp, enabled, trusted, installed_at, updated_at
         FROM agent_plugins ORDER BY installed_at DESC`
      )
      .all() as unknown as PluginRow[]
    return rows.map(toPlugin)
  }

  findPlugin(id: string): StoredPlugin | undefined {
    const row = this.db
      .prepare(
        `SELECT id, name, description, version, marketplace, install_path, components,
                has_hooks, has_mcp, enabled, trusted, installed_at, updated_at
         FROM agent_plugins WHERE id = ?`
      )
      .get(id) as PluginRow | undefined
    return row ? toPlugin(row) : undefined
  }

  upsertPlugin(input: PluginUpsert): StoredPlugin {
    const now = Date.now()
    const existing = this.db
      .prepare('SELECT installed_at, trusted FROM agent_plugins WHERE id = ?')
      .get(input.id) as { installed_at: number; trusted: number } | undefined
    const installedAt = existing?.installed_at ?? now
    this.db
      .prepare(
        `INSERT INTO agent_plugins
          (id, name, description, version, marketplace, install_path, components,
           has_hooks, has_mcp, enabled, trusted, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           description = excluded.description,
           version = excluded.version,
           marketplace = excluded.marketplace,
           install_path = excluded.install_path,
           components = excluded.components,
           has_hooks = excluded.has_hooks,
           has_mcp = excluded.has_mcp,
           enabled = excluded.enabled,
           trusted = excluded.trusted,
           updated_at = excluded.updated_at`
      )
      .run(
        input.id,
        input.name,
        input.description,
        input.version,
        input.marketplace,
        input.installPath,
        JSON.stringify(input.components),
        input.hasHooks ? 1 : 0,
        input.hasMcp ? 1 : 0,
        input.enabled ? 1 : 0,
        input.trusted ? 1 : 0,
        installedAt,
        now
      )
    const saved = this.findPlugin(input.id)
    if (!saved) throw new Error('插件记录保存失败')
    return saved
  }

  setPluginEnabled(id: string, enabled: boolean, trusted?: boolean): StoredPlugin | undefined {
    const assignments = ['enabled = ?', 'updated_at = ?']
    const values: (string | number)[] = [enabled ? 1 : 0, Date.now()]
    if (trusted !== undefined) {
      assignments.push('trusted = ?')
      values.push(trusted ? 1 : 0)
    }
    values.push(id)
    this.db
      .prepare(`UPDATE agent_plugins SET ${assignments.join(', ')} WHERE id = ?`)
      .run(...values)
    return this.findPlugin(id)
  }

  removePlugin(id: string): void {
    this.db.prepare('DELETE FROM agent_plugins WHERE id = ?').run(id)
  }

  listMcpServers(): ExternalMcpServerRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, key, name, description, transport, command, args_json, url, source,
                catalog_id, version, enabled, trusted, tools_json, last_test_at, last_error,
                created_at, updated_at
         FROM mcp_servers ORDER BY created_at DESC`
      )
      .all() as unknown as McpServerRow[]
    return rows.map((row) => {
      const server = toServer(row)
      const keys = this.secretKeys(server.id)
      server.envKeys = keys.env
      server.headerKeys = keys.headers
      server.tools = this.toolsFor(server.id)
      return server
    })
  }

  findMcpServer(id: string): ExternalMcpServerRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, key, name, description, transport, command, args_json, url, source,
                catalog_id, version, enabled, trusted, tools_json, last_test_at, last_error,
                created_at, updated_at
         FROM mcp_servers WHERE id = ?`
      )
      .get(id) as McpServerRow | undefined
    if (!row) return undefined
    const server = toServer(row)
    const keys = this.secretKeys(server.id)
    server.envKeys = keys.env
    server.headerKeys = keys.headers
    server.tools = this.toolsFor(server.id)
    return server
  }

  toolsFor(serverId: string): ExternalMcpToolRecord[] {
    const rows = this.db
      .prepare(
        `SELECT name, description, read_only, approval
         FROM mcp_server_tools WHERE server_id = ? ORDER BY name ASC`
      )
      .all(serverId) as unknown as ToolRow[]
    return rows.map((row) => ({
      name: row.name,
      description: row.description,
      readOnly: row.read_only === 1,
      approval: row.approval
    }))
  }

  syncTools(serverId: string, tools: McpToolInput[]): void {
    const existing = new Map(this.toolsFor(serverId).map((tool) => [tool.name, tool.approval]))
    this.db.exec('BEGIN')
    try {
      const names = tools.map((tool) => tool.name)
      if (names.length === 0) {
        this.db.prepare('DELETE FROM mcp_server_tools WHERE server_id = ?').run(serverId)
      } else {
        const placeholders = names.map(() => '?').join(', ')
        this.db
          .prepare(
            `DELETE FROM mcp_server_tools WHERE server_id = ? AND name NOT IN (${placeholders})`
          )
          .run(serverId, ...names)
      }
      const now = Date.now()
      for (const tool of tools) {
        this.db
          .prepare(
            `INSERT INTO mcp_server_tools
              (server_id, name, description, read_only, approval, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(server_id, name) DO UPDATE SET
               description = excluded.description,
               read_only = excluded.read_only,
               updated_at = excluded.updated_at`
          )
          .run(
            serverId,
            tool.name,
            tool.description,
            tool.readOnly ? 1 : 0,
            existing.get(tool.name) ?? 'ask',
            now
          )
      }
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  setToolApproval(
    serverId: string,
    toolName: string,
    approval: McpToolApproval
  ): ExternalMcpToolRecord[] {
    this.db
      .prepare(
        'UPDATE mcp_server_tools SET approval = ?, updated_at = ? WHERE server_id = ? AND name = ?'
      )
      .run(approval, Date.now(), serverId, toolName)
    return this.toolsFor(serverId)
  }

  clearTools(serverId: string): void {
    this.db.prepare('DELETE FROM mcp_server_tools WHERE server_id = ?').run(serverId)
  }

  findMcpServerByKey(key: string): ExternalMcpServerRecord | undefined {
    const row = this.db
      .prepare(
        `SELECT id, key, name, description, transport, command, args_json, url, source,
                catalog_id, version, enabled, trusted, tools_json, last_test_at, last_error,
                created_at, updated_at
         FROM mcp_servers WHERE key = ?`
      )
      .get(key) as McpServerRow | undefined
    return row ? toServer(row) : undefined
  }

  createMcpServer(input: McpServerInput): ExternalMcpServerRecord {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO mcp_servers
          (id, key, name, description, transport, command, args_json, url, source,
           catalog_id, version, enabled, trusted, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.id,
        input.key,
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.source,
        input.catalogId,
        input.version,
        input.enabled ? 1 : 0,
        input.trusted ? 1 : 0,
        now,
        now
      )
    const saved = this.findMcpServer(input.id)
    if (!saved) throw new Error('MCP Server 保存失败')
    return saved
  }

  updateMcpServer(
    id: string,
    input: Omit<McpServerInput, 'id' | 'key'>
  ): ExternalMcpServerRecord | undefined {
    this.db
      .prepare(
        `UPDATE mcp_servers SET
           name = ?, description = ?, transport = ?, command = ?, args_json = ?, url = ?,
           source = ?, catalog_id = ?, version = ?, enabled = ?, trusted = ?,
           tools_json = '[]', last_test_at = NULL, last_error = '', updated_at = ?
         WHERE id = ?`
      )
      .run(
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.source,
        input.catalogId,
        input.version,
        input.enabled ? 1 : 0,
        input.trusted ? 1 : 0,
        Date.now(),
        id
      )
    this.clearTools(id)
    return this.findMcpServer(id)
  }

  setMcpEnabled(
    id: string,
    enabled: boolean,
    trusted?: boolean
  ): ExternalMcpServerRecord | undefined {
    const assignments = ['enabled = ?', 'updated_at = ?']
    const values: (string | number)[] = [enabled ? 1 : 0, Date.now()]
    if (trusted !== undefined) {
      assignments.push('trusted = ?')
      values.push(trusted ? 1 : 0)
    }
    values.push(id)
    this.db.prepare(`UPDATE mcp_servers SET ${assignments.join(', ')} WHERE id = ?`).run(...values)
    return this.findMcpServer(id)
  }

  removeMcpServer(id: string): void {
    this.db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(id)
  }

  setMcpTest(id: string, tools: string[], error: string): ExternalMcpServerRecord | undefined {
    this.db
      .prepare(
        'UPDATE mcp_servers SET tools_json = ?, last_test_at = ?, last_error = ? WHERE id = ?'
      )
      .run(JSON.stringify(tools), Date.now(), error.slice(0, 300), id)
    return this.findMcpServer(id)
  }

  secretKeys(serverId: string): { env: string[]; headers: string[] } {
    const rows = this.db
      .prepare('SELECT kind, key FROM mcp_server_secrets WHERE server_id = ? ORDER BY key ASC')
      .all(serverId) as { kind: 'env' | 'header'; key: string }[]
    return {
      env: rows.filter((row) => row.kind === 'env').map((row) => row.key),
      headers: rows.filter((row) => row.kind === 'header').map((row) => row.key)
    }
  }

  secretsFor(serverId: string): McpSecrets {
    const rows = this.db
      .prepare('SELECT kind, key, value_encrypted FROM mcp_server_secrets WHERE server_id = ?')
      .all(serverId) as unknown as SecretRow[]
    const env = new Map<string, Buffer>()
    const headers = new Map<string, Buffer>()
    for (const row of rows) {
      const target = row.kind === 'env' ? env : headers
      target.set(row.key, Buffer.from(row.value_encrypted))
    }
    return { env, headers }
  }

  replaceSecrets(
    serverId: string,
    env: Map<string, Buffer> | undefined,
    headers: Map<string, Buffer> | undefined,
    removeEnv: string[] = [],
    removeHeaders: string[] = []
  ): void {
    const write = (
      kind: 'env' | 'header',
      values: Map<string, Buffer> | undefined,
      remove: string[]
    ) => {
      if (!values && remove.length === 0) return
      for (const key of remove) {
        this.db
          .prepare('DELETE FROM mcp_server_secrets WHERE server_id = ? AND kind = ? AND key = ?')
          .run(serverId, kind, key)
      }
      if (values) {
        for (const [key, value] of values) {
          this.db
            .prepare(
              `INSERT INTO mcp_server_secrets (server_id, kind, key, value_encrypted)
               VALUES (?, ?, ?, ?)
               ON CONFLICT(server_id, kind, key) DO UPDATE SET value_encrypted = excluded.value_encrypted`
            )
            .run(serverId, kind, key, value)
        }
      }
    }
    write('env', env, removeEnv)
    write('header', headers, removeHeaders)
  }
}
