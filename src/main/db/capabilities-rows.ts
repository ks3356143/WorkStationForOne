import type {
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
  created_at, updated_at`

export interface StoredPlugin extends SkillRecord {
  installPath: string
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
