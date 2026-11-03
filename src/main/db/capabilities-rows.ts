import type {
  ExternalMcpAuthMode,
  ExternalMcpOAuthInfo,
  ExternalMcpServerRecord,
  ExternalMcpTargets,
  ExternalMcpTransport,
  McpToolApproval,
  PluginAgent,
  PluginSourceKind,
  PluginSourceRecord,
  SkillRecord
} from '../../shared/ipc'

/** 数据库行 → 领域对象。只做形状转换，不查别的表。 */

export interface PluginRow {
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
  agent: PluginAgent
  source_id: string
  installed_at: number
  updated_at: number
}

export interface PluginSourceRow {
  id: string
  name: string
  kind: PluginSourceKind
  url: string
  ref: string
  root: string
  last_synced_at: number | null
  last_error: string
  plugin_count: number
  created_at: number
  updated_at: number
}

export interface McpServerRow {
  id: string
  auth: ExternalMcpAuthMode
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
  targets: ExternalMcpTargets
  last_test_at: number | null
  last_error: string
  created_at: number
  updated_at: number
}

export interface SecretRow {
  kind: 'env' | 'header'
  key: string
  value_encrypted: Uint8Array
}

export interface ToolRow {
  name: string
  description: string
  read_only: number
  approval: McpToolApproval
}

/** 三张表的列清单只写一遍：遗漏一列就是运行时字段丢失。 */
export const PLUGIN_COLUMNS = `id, name, description, version, marketplace, install_path, components,
  has_hooks, has_mcp, enabled, trusted, agent, source_id, installed_at, updated_at`

export const SOURCE_COLUMNS = `id, name, kind, url, ref, root, last_synced_at, last_error,
  plugin_count, created_at, updated_at`

export const MCP_SERVER_COLUMNS = `id, key, name, description, transport, command, args_json, url,
  source, catalog_id, version, enabled, trusted, tools_json, targets, last_test_at, last_error,
  auth, created_at, updated_at`

export interface StoredPlugin extends SkillRecord {
  installPath: string
}

export interface McpOAuthRow {
  server_id: string
  issuer: string
  resource: string
  client_id: string
  client_secret_encrypted: Uint8Array | null
  authorization_endpoint: string
  token_endpoint: string
  registration_endpoint: string
  scopes: string
  token_endpoint_auth_method: string
  access_token_encrypted: Uint8Array | null
  refresh_token_encrypted: Uint8Array | null
  expires_at: number | null
  last_error: string
  updated_at: number
}

export const MCP_OAUTH_COLUMNS = `server_id, issuer, resource, client_id,
  client_secret_encrypted, authorization_endpoint, token_endpoint, registration_endpoint,
  scopes, token_endpoint_auth_method, access_token_encrypted, refresh_token_encrypted,
  expires_at, last_error, updated_at`

/** 加密 BLOB 保持 Buffer；只有主进程的 OAuth 服务负责解密。 */
export interface StoredOAuth {
  serverId: string
  issuer: string
  resource: string
  clientId: string
  clientSecret: Buffer | null
  authorizationEndpoint: string
  tokenEndpoint: string
  registrationEndpoint: string
  scopes: string
  authMethod: string
  accessToken: Buffer | null
  refreshToken: Buffer | null
  expiresAt: number | null
  lastError: string
  updatedAt: number
}

export function toOAuth(row: McpOAuthRow): StoredOAuth {
  return {
    serverId: row.server_id,
    issuer: row.issuer,
    resource: row.resource,
    clientId: row.client_id,
    clientSecret: row.client_secret_encrypted ? Buffer.from(row.client_secret_encrypted) : null,
    authorizationEndpoint: row.authorization_endpoint,
    tokenEndpoint: row.token_endpoint,
    registrationEndpoint: row.registration_endpoint,
    scopes: row.scopes,
    authMethod: row.token_endpoint_auth_method,
    accessToken: row.access_token_encrypted ? Buffer.from(row.access_token_encrypted) : null,
    refreshToken: row.refresh_token_encrypted ? Buffer.from(row.refresh_token_encrypted) : null,
    expiresAt: row.expires_at ?? null,
    lastError: row.last_error ?? '',
    updatedAt: row.updated_at
  }
}

/** 只给渲染层的状态摘要，永远不含 Token。 */
export function toOAuthInfo(oauth: StoredOAuth, now: number): ExternalMcpOAuthInfo | null {
  if (!oauth.accessToken && !oauth.refreshToken) return null
  const expired = oauth.expiresAt !== null && oauth.expiresAt <= now
  return {
    state: oauth.lastError ? 'error' : expired ? 'expired' : 'connected',
    issuer: oauth.issuer,
    scopes: oauth.scopes,
    expiresAt: oauth.expiresAt,
    lastError: oauth.lastError
  }
}

export function parseStringArray(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : []
  } catch {
    return []
  }
}

export function toPlugin(row: PluginRow): StoredPlugin {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    version: row.version,
    marketplace: row.marketplace,
    installPath: row.install_path,
    components: parseStringArray(row.components),
    hasHooks: row.has_hooks === 1,
    hasMcp: row.has_mcp === 1,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    agent: row.agent ?? 'claude',
    sourceId: row.source_id ?? '',
    installedAt: row.installed_at,
    updatedAt: row.updated_at
  }
}

export function toSource(row: PluginSourceRow): PluginSourceRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    url: row.url,
    ref: row.ref,
    root: row.root,
    lastSyncedAt: row.last_synced_at ?? null,
    lastError: row.last_error ?? '',
    pluginCount: row.plugin_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}

export function toServer(row: McpServerRow): ExternalMcpServerRecord {
  return {
    id: row.id,
    auth: row.auth ?? 'headers',
    oauth: null,
    key: row.key,
    name: row.name,
    description: row.description,
    transport: row.transport,
    command: row.command,
    args: parseStringArray(row.args_json),
    url: row.url,
    envKeys: [],
    headerKeys: [],
    source: row.source,
    catalogId: row.catalog_id,
    version: row.version,
    enabled: row.enabled === 1,
    trusted: row.trusted === 1,
    toolNames: parseStringArray(row.tools_json),
    tools: [],
    targets: row.targets ?? 'both',
    lastTestAt: row.last_test_at ?? null,
    lastError: row.last_error ?? '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  }
}
