import type { McpDomain } from './mcp'
import type { AgentKind } from './agent'

export interface BuiltinToolRecord {
  name: string
  description: string
  domain: McpDomain
  write: boolean
  enabled: boolean
}

export interface ToolSurfaceNativeRecord {
  id: string
  name: string
  description: string
  enabled: boolean
  warning?: string
  /** CLI 未提供关闭手段：只展示，不给开关 */
  alwaysOn?: boolean
}

export interface ToolSurfaceMcpRecord {
  id: string
  name: string
  enabled: boolean
  /** 首选：提示词里单独成组，并要求优先于 CLI 原生工具 */
  preferred: boolean
  /** 首选时的使用场景说明，最多 80 字；非首选不注入 */
  note: string
  tools: string[]
}

export interface ToolSurfaceSkillRecord {
  id: string
  name: string
  enabled: boolean
  preferred: boolean
  note: string
}

export interface ToolSurfaceRecord {
  agent: AgentKind
  native: ToolSurfaceNativeRecord[]
  mcp: ToolSurfaceMcpRecord[]
  skills: ToolSurfaceSkillRecord[]
  /** 应用内置数据桥工具，不是 CLI 原生工具 */
  builtin: BuiltinToolRecord[]
}

export interface ToolSurfaceBundle {
  claude: ToolSurfaceRecord
  codex: ToolSurfaceRecord
}

export interface SkillRecord {
  id: string
  name: string
  description: string
  version: string
  marketplace: string
  enabled: boolean
  trusted: boolean
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
  /** 属于哪个 Agent；同一插件可在两边各装一次 */
  agent: PluginAgent
  /** 来源源 id；空字符串表示来源未知（旧库或本机导入） */
  sourceId: string
  installedAt: number
  updatedAt: number
}

export type PluginAgent = 'claude' | 'codex'
export type PluginSourceKind = 'official' | 'git'

export interface PluginSourceRecord {
  id: string
  name: string
  kind: PluginSourceKind
  url: string
  ref: string
  root: string
  lastSyncedAt: number | null
  lastError: string
  pluginCount: number
  createdAt: number
  updatedAt: number
}

export interface UpdateCandidateRecord {
  kind: 'plugin' | 'mcp'
  id: string
  name: string
  agent?: PluginAgent
  current: string
  latest: string
  sourceName?: string
}

/** 批量更新的结果：失败项带原因，方便逐条重试。 */
export interface ApplyUpdatesResultRecord {
  updated: Array<{ kind: 'plugin' | 'mcp'; id: string; name: string; version: string }>
  failed: Array<{ kind: 'plugin' | 'mcp'; id: string; name: string; reason: string }>
}

export interface LocalMarketplaceRecord {
  name: string
  source: string
  kind: 'git' | 'local' | 'unknown'
}

export interface LocalPluginRecord {
  id: string
  name: string
  market: string
  version: string
  enabled: boolean
  installPath: string
}

export interface InstalledPluginRecord {
  id: string
  name: string
  market: string
  version: string
  agent: PluginAgent
  enabled: boolean
  trusted: boolean
  /** 库里有记录但磁盘上找不到 */
  missingOnDisk: boolean
  /** 磁盘上有但库里没有，自动补录 */
  adopted: boolean
  components: string[]
  hasHooks: boolean
  hasMcp: boolean
  installPath: string
  /** Codex 侧同步到 skills 目录的 skill 名 */
  syncedSkills: string[]
}

export interface LocalScanRecord {
  agent: PluginAgent
  detected: boolean
  marketplaces: LocalMarketplaceRecord[]
  plugins: LocalPluginRecord[]
  errors: string[]
}

export interface SkillMarketEntry {
  pluginId: string
  name: string
  description: string
  marketplace: string
  source: string
  installed: boolean
  installCount: number
}

export interface SkillMarketSnapshot {
  entries: SkillMarketEntry[]
  fetchedAt: number
  stale: boolean
  error?: string
}

export interface SkillInspection {
  files: string[]
  docs: { path: string; content: string }[]
}

export interface SkillApi {
  list: () => Promise<SkillRecord[]>
  importLocal: () => Promise<SkillRecord | null>
  inspect: (pluginId: string) => Promise<SkillInspection>
  openFolder: (pluginId: string) => Promise<void>
  market: (force?: boolean) => Promise<SkillMarketSnapshot>
  install: (pluginId: string) => Promise<SkillRecord>
  update: (pluginId: string) => Promise<SkillRecord>
  remove: (pluginId: string) => Promise<void>
  setEnabled: (pluginId: string, enabled: boolean, trust?: boolean) => Promise<SkillRecord>
}

export type ExternalMcpTransport = 'stdio' | 'http'
export type McpToolApproval = 'allow' | 'ask' | 'deny'
/** 外部 MCP 下发到哪些 Agent：both 为 Claude 与 Codex 都可用。 */
export type ExternalMcpTargets = 'both' | 'claude' | 'codex'
export const EXTERNAL_MCP_TARGETS = ['both', 'claude', 'codex'] as const

export interface ExternalMcpToolRecord {
  name: string
  description: string
  readOnly: boolean
  approval: McpToolApproval
}

export type ExternalMcpAuthMode = 'headers' | 'oauth'

export type ExternalMcpOAuthState = 'connected' | 'expired' | 'error'

export interface ExternalMcpOAuthInfo {
  state: ExternalMcpOAuthState
  issuer: string
  scopes: string
  expiresAt: number | null
  lastError: string
}

export interface ExternalMcpServerRecord {
  id: string
  auth: ExternalMcpAuthMode
  oauth: ExternalMcpOAuthInfo | null
  key: string
  name: string
  description: string
  transport: ExternalMcpTransport
  command: string
  args: string[]
  url: string
  envKeys: string[]
  headerKeys: string[]
  targets: ExternalMcpTargets
  source: 'catalog' | 'manual'
  catalogId: string
  version: string
  enabled: boolean
  trusted: boolean
  toolNames: string[]
  tools: ExternalMcpToolRecord[]
  lastTestAt: number | null
  lastError: string
  createdAt: number
  updatedAt: number
}

export interface McpImportResult {
  added: ExternalMcpServerRecord[]
  skipped: string[]
  errors: { name: string; message: string }[]
}

export interface ExternalMcpSaveInput {
  name: string
  auth?: ExternalMcpAuthMode
  description?: string
  transport: ExternalMcpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  removeEnvKeys?: string[]
  removeHeaderKeys?: string[]
  /** 省略时按 both 处理；改归属不影响启用与信任状态 */
  targets?: ExternalMcpTargets
  catalogId?: string
  version?: string
}

export interface ExternalMcpCatalogEntry {
  id: string
  name: string
  description: string
  transport: ExternalMcpTransport
  command: string
  args: string[]
  url?: string
  packageName?: string
  registry?: 'npm' | 'pypi'
  version?: string
  requiredEnv?: string[]
}

export interface ExternalMcpUpdateInfo {
  id: string
  name: string
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
}

export interface ExternalMcpApi {
  list: () => Promise<ExternalMcpServerRecord[]>
  catalog: () => Promise<ExternalMcpCatalogEntry[]>
  add: (input: ExternalMcpSaveInput) => Promise<ExternalMcpServerRecord>
  update: (id: string, input: ExternalMcpSaveInput) => Promise<ExternalMcpServerRecord>
  remove: (id: string) => Promise<void>
  setEnabled: (id: string, enabled: boolean, trust?: boolean) => Promise<ExternalMcpServerRecord>
  test: (id: string) => Promise<ExternalMcpServerRecord>
  login: (id: string) => Promise<{ ok: boolean; message: string }>
  logout: (id: string) => Promise<void>
  setToolPolicy: (
    id: string,
    toolName: string,
    approval: McpToolApproval
  ) => Promise<ExternalMcpServerRecord>
  importConfig: (text: string) => Promise<McpImportResult>
  exportConfig: () => Promise<string>
  checkUpdates: () => Promise<ExternalMcpUpdateInfo[]>
  applyUpdate: (id: string) => Promise<ExternalMcpServerRecord>
}

export interface EnvironmentCheckRecord {
  id: 'node' | 'npx' | 'uvx' | 'git' | 'claude' | 'codex'
  label: string
  command: string
  available: boolean
  version: string
  path: string
}

/** 环境依赖 CLI 的双源状态；effective 为最终生效源（两侧都无时为 null）。 */
export interface CliRuntimeState {
  id: string
  system: { available: boolean; version: string; path: string }
  managed: { installed: boolean; version: string; binDir: string }
  preference: 'system' | 'managed' | null
  effective: 'system' | 'managed' | null
}

export interface CliRuntimeUpdate {
  id: string
  installedVersion: string
  latestVersion: string
  hasUpdate: boolean
}

export interface CapabilityApi {
  builtinTools: () => Promise<BuiltinToolRecord[]>
  /** 切换单个内置工具；关闭后桥不再列出也不执行它 */
  setBuiltinTool: (name: string, enabled: boolean) => Promise<BuiltinToolRecord[]>
  /** 环境依赖 CLI 的系统 / 托管状态与生效源 */
  cliRuntimes: () => Promise<CliRuntimeState[]>
  setCliSource: (id: string, source: 'system' | 'managed') => Promise<CliRuntimeState[]>
  installCliRuntime: (id: string) => Promise<CliRuntimeState[]>
  uninstallCliRuntime: (id: string) => Promise<CliRuntimeState[]>
  /** 只识别有无新版并提示；不自动更新 */
  cliRuntimeUpdates: () => Promise<CliRuntimeUpdate[]>
  /** 按 Agent 的统一工具面：原生工具、MCP、技能与数据桥工具 */
  toolSurface: () => Promise<ToolSurfaceBundle>
  setNativeTool: (agent: AgentKind, id: string, enabled: boolean) => Promise<ToolSurfaceBundle>
  moveTool: (agent: AgentKind, key: string, direction: 'up' | 'down') => Promise<ToolSurfaceBundle>
  /** 标记首选：提示词里单独成组并要求优先于 CLI 原生工具 */
  setPreferredTool: (
    agent: AgentKind,
    key: string,
    preferred: boolean
  ) => Promise<ToolSurfaceBundle>
  /** 首选工具的使用场景说明；空字符串表示清空 */
  setToolNote: (agent: AgentKind, key: string, note: string) => Promise<ToolSurfaceBundle>
  environment: (force?: boolean) => Promise<EnvironmentCheckRecord[]>
  /** 推荐 CLI 在本机 PATH 的安装状态；只读扫描，不 spawn、不联网 */
  cliRecommend: () => Promise<Record<string, boolean>>
  skills: SkillApi
  mcp: ExternalMcpApi
  pluginSources: () => Promise<PluginSourceRecord[]>
  addPluginSource: (input: {
    name: string
    url: string
    ref?: string
  }) => Promise<PluginSourceRecord>
  refreshPluginSource: (id: string) => Promise<PluginSourceRecord>
  removePluginSource: (id: string) => Promise<void>
  scanLocalPlugins: () => Promise<LocalScanRecord[]>
  installedPlugins: () => Promise<InstalledPluginRecord[]>
  importLocalPlugins: (input: {
    agent: PluginAgent
    markets: string[]
    plugins: string[]
  }) => Promise<{
    importedMarkets: string[]
    importedPlugins: string[]
    skipped: Array<{ id: string; reason: string }>
  }>
  setPluginEnabled: (input: {
    id: string
    agent: PluginAgent
    enabled: boolean
  }) => Promise<SkillRecord | undefined>
  removePlugin: (input: { id: string; agent: PluginAgent }) => Promise<void>
  checkUpdates: () => Promise<UpdateCandidateRecord[]>
  /** 逐条应用候选更新；返回成功与失败明细，不整体失败 */
  applyUpdates: (candidates: UpdateCandidateRecord[]) => Promise<ApplyUpdatesResultRecord>
  onUpdateAvailable: (listener: (list: UpdateCandidateRecord[]) => void) => () => void
}
