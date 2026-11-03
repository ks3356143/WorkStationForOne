import type { DatabaseSync } from 'node:sqlite'
import type {
  ExternalMcpAuthMode,
  ExternalMcpServerRecord,
  ExternalMcpTargets,
  ExternalMcpToolRecord,
  ExternalMcpTransport,
  McpToolApproval,
  PluginAgent,
  PluginSourceKind,
  PluginSourceRecord
} from '../../shared/ipc'
import {
  MCP_OAUTH_COLUMNS,
  MCP_SERVER_COLUMNS,
  PLUGIN_COLUMNS,
  SOURCE_COLUMNS,
  toOAuth,
  toOAuthInfo,
  toPlugin,
  toServer,
  toSource,
  type McpOAuthRow,
  type McpServerRow,
  type PluginRow,
  type PluginSourceRow,
  type SecretRow,
  type StoredOAuth,
  type StoredPlugin,
  type ToolRow
} from './capabilities-rows'

export type { StoredPlugin }

export interface McpToolInput {
  name: string
  description: string
  readOnly: boolean
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
  /** 省略按 claude 处理，兼容既有 Claude 插件调用点 */
  agent?: PluginAgent
  sourceId?: string
}

export interface PluginSourceInput {
  id: string
  name: string
  kind: PluginSourceKind
  url: string
  ref: string
  root: string
}

export interface McpServerInput {
  id: string
  auth?: ExternalMcpAuthMode
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
  targets?: ExternalMcpTargets
}

export interface McpSecrets {
  env: Map<string, Buffer>
  headers: Map<string, Buffer>
}

export class CapabilityRepository {
  constructor(private readonly db: DatabaseSync) {}

  listPlugins(agent?: PluginAgent): StoredPlugin[] {
    const sql = `SELECT ${PLUGIN_COLUMNS}
                 FROM agent_plugins ${agent ? 'WHERE agent = ?' : ''}
                 ORDER BY installed_at DESC`
    const rows = (agent
      ? this.db.prepare(sql).all(agent)
      : this.db.prepare(sql).all()) as unknown as PluginRow[]
    return rows.map(toPlugin)
  }

  findPlugin(id: string, agent: PluginAgent = 'claude'): StoredPlugin | undefined {
    const row = this.db
      .prepare(`SELECT ${PLUGIN_COLUMNS}
         FROM agent_plugins WHERE id = ? AND agent = ?`)
      .get(id, agent) as PluginRow | undefined
    return row ? toPlugin(row) : undefined
  }

  upsertPlugin(input: PluginUpsert): StoredPlugin {
    const now = Date.now()
    const agent: PluginAgent = input.agent ?? 'claude'
    const existing = this.db
      .prepare('SELECT installed_at, trusted FROM agent_plugins WHERE id = ? AND agent = ?')
      .get(input.id, agent) as { installed_at: number; trusted: number } | undefined
    const installedAt = existing?.installed_at ?? now
    this.db
      .prepare(
        `INSERT INTO agent_plugins
          (id, name, description, version, marketplace, install_path, components,
           has_hooks, has_mcp, enabled, trusted, agent, source_id, installed_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(agent, id) DO UPDATE SET
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
           source_id = excluded.source_id,
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
        agent,
        input.sourceId ?? '',
        installedAt,
        now
      )
    const saved = this.findPlugin(input.id, agent)
    if (!saved) throw new Error('插件记录保存失败')
    return saved
  }

  setPluginEnabled(
    id: string,
    enabled: boolean,
    trusted?: boolean,
    agent: PluginAgent = 'claude'
  ): StoredPlugin | undefined {
    const assignments = ['enabled = ?', 'updated_at = ?']
    const values: (string | number)[] = [enabled ? 1 : 0, Date.now()]
    if (trusted !== undefined) {
      assignments.push('trusted = ?')
      values.push(trusted ? 1 : 0)
    }
    values.push(id, agent)
    this.db
      .prepare(`UPDATE agent_plugins SET ${assignments.join(', ')} WHERE id = ? AND agent = ?`)
      .run(...values)
    return this.findPlugin(id, agent)
  }

  removePlugin(id: string, agent: PluginAgent = 'claude'): void {
    this.db.prepare('DELETE FROM agent_plugins WHERE id = ? AND agent = ?').run(id, agent)
  }

  listSources(): PluginSourceRecord[] {
    const rows = this.db
      .prepare(`SELECT ${SOURCE_COLUMNS}
         FROM plugin_sources ORDER BY created_at ASC`)
      .all() as unknown as PluginSourceRow[]
    return rows.map(toSource)
  }

  findSource(id: string): PluginSourceRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${SOURCE_COLUMNS}
         FROM plugin_sources WHERE id = ?`)
      .get(id) as PluginSourceRow | undefined
    return row ? toSource(row) : undefined
  }

  findSourceByName(name: string): PluginSourceRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${SOURCE_COLUMNS}
         FROM plugin_sources WHERE name = ?`)
      .get(name) as PluginSourceRow | undefined
    return row ? toSource(row) : undefined
  }

  createSource(input: PluginSourceInput): PluginSourceRecord {
    if (this.findSourceByName(input.name)) throw new Error(`源「${input.name}」已存在`)
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO plugin_sources
          (id, name, kind, url, ref, root, last_synced_at, last_error, plugin_count,
           created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, '', 0, ?, ?)`
      )
      .run(input.id, input.name, input.kind, input.url, input.ref, input.root, now, now)
    const saved = this.findSource(input.id)
    if (!saved) throw new Error('插件源保存失败')
    return saved
  }

  /** 刷新结果：只更新同步时间、错误与插件数。 */
  markSourceSynced(id: string, error: string, pluginCount: number): void {
    this.db
      .prepare(
        `UPDATE plugin_sources SET last_synced_at = ?, last_error = ?, plugin_count = ?,
           updated_at = ? WHERE id = ?`
      )
      .run(Date.now(), error.slice(0, 300), pluginCount, Date.now(), id)
  }

  removeSource(id: string): void {
    this.db.prepare('DELETE FROM plugin_sources WHERE id = ?').run(id)
  }

  listMcpServers(): ExternalMcpServerRecord[] {
    const rows = this.db
      .prepare(`SELECT ${MCP_SERVER_COLUMNS}
         FROM mcp_servers ORDER BY created_at DESC`)
      .all() as unknown as McpServerRow[]
    return rows.map((row) => this.hydrateServer(toServer(row)))
  }

  /** 密钥 key 与工具清单来自两张附表；列表与单条查询共用这一处补全。 */
  private hydrateServer(server: ExternalMcpServerRecord): ExternalMcpServerRecord {
    const keys = this.secretKeys(server.id)
    server.envKeys = keys.env
    server.headerKeys = keys.headers
    server.tools = this.toolsFor(server.id)
    const oauth = this.oauthFor(server.id)
    server.oauth = oauth ? toOAuthInfo(oauth, Date.now()) : null
    return server
  }

  findMcpServer(id: string): ExternalMcpServerRecord | undefined {
    const row = this.db
      .prepare(`SELECT ${MCP_SERVER_COLUMNS}
         FROM mcp_servers WHERE id = ?`)
      .get(id) as McpServerRow | undefined
    return row ? this.hydrateServer(toServer(row)) : undefined
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
      .prepare(`SELECT ${MCP_SERVER_COLUMNS}
         FROM mcp_servers WHERE key = ?`)
      .get(key) as McpServerRow | undefined
    return row ? toServer(row) : undefined
  }

  createMcpServer(input: McpServerInput): ExternalMcpServerRecord {
    const now = Date.now()
    this.db
      .prepare(
        `INSERT INTO mcp_servers
          (id, key, name, description, transport, command, args_json, url, source,
           catalog_id, version, enabled, trusted, targets, auth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
        input.targets ?? 'both',
        input.auth ?? 'headers',
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
           source = ?, catalog_id = ?, version = ?, enabled = ?, trusted = ?, targets = ?,
           auth = ?, tools_json = '[]', last_test_at = NULL, last_error = '', updated_at = ?
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
        input.targets ?? 'both',
        input.auth ?? 'headers',
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

  oauthFor(serverId: string): StoredOAuth | undefined {
    const row = this.db
      .prepare(`SELECT ${MCP_OAUTH_COLUMNS} FROM mcp_oauth WHERE server_id = ?`)
      .get(serverId) as unknown as McpOAuthRow | undefined
    return row ? toOAuth(row) : undefined
  }

  /** 新注册会清掉旧 Token：客户端身份变了，旧凭据不再可信。 */
  saveOAuthRegistration(
    serverId: string,
    input: {
      issuer: string
      resource: string
      clientId: string
      clientSecret: Buffer | null
      authorizationEndpoint: string
      tokenEndpoint: string
      registrationEndpoint: string
      scopes: string
      authMethod: string
    }
  ): void {
    this.db
      .prepare(
        `INSERT INTO mcp_oauth
          (server_id, issuer, resource, client_id, client_secret_encrypted,
           authorization_endpoint, token_endpoint, registration_endpoint, scopes,
           token_endpoint_auth_method, access_token_encrypted, refresh_token_encrypted,
           expires_at, last_error, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '', ?)
         ON CONFLICT(server_id) DO UPDATE SET
           issuer = excluded.issuer,
           resource = excluded.resource,
           client_id = excluded.client_id,
           client_secret_encrypted = excluded.client_secret_encrypted,
           authorization_endpoint = excluded.authorization_endpoint,
           token_endpoint = excluded.token_endpoint,
           registration_endpoint = excluded.registration_endpoint,
           scopes = excluded.scopes,
           token_endpoint_auth_method = excluded.token_endpoint_auth_method,
           access_token_encrypted = NULL,
           refresh_token_encrypted = NULL,
           expires_at = NULL,
           last_error = '',
           updated_at = excluded.updated_at`
      )
      .run(
        serverId,
        input.issuer,
        input.resource,
        input.clientId,
        input.clientSecret,
        input.authorizationEndpoint,
        input.tokenEndpoint,
        input.registrationEndpoint,
        input.scopes,
        input.authMethod,
        Date.now()
      )
  }

  saveOAuthTokens(
    serverId: string,
    tokens: { accessToken: Buffer; refreshToken: Buffer | null; expiresAt: number | null }
  ): void {
    this.db
      .prepare(
        `UPDATE mcp_oauth SET access_token_encrypted = ?, refresh_token_encrypted = ?,
           expires_at = ?, last_error = '', updated_at = ? WHERE server_id = ?`
      )
      .run(tokens.accessToken, tokens.refreshToken, tokens.expiresAt, Date.now(), serverId)
  }

  setOAuthError(serverId: string, message: string): void {
    this.db
      .prepare('UPDATE mcp_oauth SET last_error = ?, updated_at = ? WHERE server_id = ?')
      .run(message.slice(0, 300), Date.now(), serverId)
  }

  clearOAuth(serverId: string): void {
    this.db.prepare('DELETE FROM mcp_oauth WHERE server_id = ?').run(serverId)
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
