import type { AgentRunEvent } from './agent-stream'
import type { RepeatRule } from './repeat'

export type TaskTone = 'agent' | 'hot'

export type { RepeatRule } from './repeat'

export type TaskPriority = 0 | 1 | 2 | 3

export type Theme = 'dark' | 'light'

export type Skin = 'prism' | 'classic'

export interface TaskRecord {
  id: string
  title: string
  time: string
  tag?: string
  tone?: TaskTone
  done: boolean
  notes?: string
  dueDate?: string
  priority?: TaskPriority
  list?: string
  completedAt?: number
  plannedFor?: string
  estimateMinutes?: number
  /** 重复规则；完成时自动生成下一条 */
  repeat?: RepeatRule
  /** 父任务 id；子任务不出现在任何清单里，只在父任务详情下展示 */
  parentId?: string
  /** 创建时间戳（毫秒），用于判断任务挂了多久没动 */
  createdAt?: number
}

export interface TaskDraft {
  title: string
  time?: string
  tag?: string
  tone?: TaskTone
  notes?: string
  dueDate?: string
  priority?: TaskPriority
  list?: string
  plannedFor?: string
  estimateMinutes?: number
  repeat?: RepeatRule | null
  parentId?: string
}

export interface TaskPatch {
  title?: string
  time?: string
  tag?: string | null
  tone?: TaskTone | null
  notes?: string
  dueDate?: string | null
  priority?: TaskPriority
  list?: string | null
  plannedFor?: string | null
  estimateMinutes?: number
  repeat?: RepeatRule | null
}

export interface TaskScheduleChange {
  taskId: string
  toTime: string
  toTag: string
  toDueDate?: string | null
}

export interface TaskApi {
  list: () => Promise<TaskRecord[]>
  onChanged: (callback: () => void) => () => void
  bootstrap: (tasks: TaskRecord[]) => Promise<void>
  /** 完成重复任务时返回自动生成的下一实例 */
  setDone: (id: string, done: boolean) => Promise<TaskRecord | null>
  applySchedule: (changes: TaskScheduleChange[]) => Promise<void>
  create: (draft: TaskDraft) => Promise<TaskRecord>
  update: (id: string, patch: TaskPatch) => Promise<void>
  remove: (id: string) => Promise<void>
  restore: (id: string) => Promise<void>
  renameList: (from: string, to: string) => Promise<void>
}

export interface NoteRecord {
  id: string
  text: string
  time: string
  tag?: string
  pinned?: boolean
}

export interface NotePage {
  items: NoteRecord[]
  total: number
}

export interface NoteSearchHit extends NoteRecord {
  snippet: string
}

/** 笔记编辑补丁：字段缺省表示不改；tag 传空字符串表示清除。 */
export interface NotePatch {
  text?: string
  tag?: string
  pinned?: boolean
}

export type NoteLinkStatus = 'ok' | 'missing' | 'ambiguous'

export interface NoteLinkRef {
  /** 正文里写的链接名（保存时的快照）。 */
  title: string
  status: NoteLinkStatus
  targetId?: string
  target?: NoteRecord
}

export interface NoteLinks {
  outgoing: NoteLinkRef[]
  backlinks: NoteRecord[]
}

export interface NoteApi {
  bootstrap: (notes: NoteRecord[]) => Promise<void>
  page: (offset: number, limit: number) => Promise<NotePage>
  search: (query: string, limit: number) => Promise<NoteSearchHit[]>
  create: (text: string, tag?: string) => Promise<NoteRecord>
  togglePin: (id: string) => Promise<void>
  update: (id: string, patch: NotePatch) => Promise<NoteRecord | undefined>
  remove: (id: string) => Promise<boolean>
  links: (id: string) => Promise<NoteLinks>
  titles: (query: string, limit: number, excludeId?: string) => Promise<string[]>
}

export interface CaptureApi {
  open: () => Promise<void>
  close: () => Promise<void>
  create: (draft: TaskDraft) => Promise<TaskRecord>
}

export type LearningKind = 'basic' | 'cloze'

export interface LearningItemRecord {
  id: string
  subject: string
  title: string
  source?: string
  notes?: string
  repetitions: number
  intervalDays: number
  ease: number
  nextReviewOn: string
  lastReviewedAt?: number
  /** FSRS 稳定度（天）；旧卡为 undefined，首次评分时建立 */
  stability?: number
  /** FSRS 难度（1–10） */
  difficulty?: number
  /** FSRS 累计失误次数 */
  lapses?: number
  /** 上次复习的本地日期键，用于计算 elapsed */
  lastReviewOn?: string
  active: boolean
  /** 卡型：basic 是普通问答，cloze 用 {{c1::…}} 挖空 */
  kind?: LearningKind
  /** 挖空原文（只有 kind=cloze 时有意义） */
  clozeSource?: string
  /** 来源笔记 id：从笔记转出来的卡片会记住出处 */
  noteId?: string
}

export interface LearningDraft {
  subject: string
  title: string
  source?: string
  notes?: string
  nextReviewOn?: string
  kind?: LearningKind
  clozeSource?: string
  noteId?: string
}

export interface LearningPatch {
  subject?: string
  title?: string
  source?: string
  notes?: string
  nextReviewOn?: string
  active?: boolean
  clozeSource?: string
}

export type LearningRating = 1 | 2 | 3 | 4

export interface LearningReviewRecord {
  rating: LearningRating
  reviewedAt: number
}

export interface LearningImportResult {
  created: LearningItemRecord[]
  /** 与现有卡或文件内重复而跳过的张数 */
  skipped: number
  /** 逐张校验失败的原因（第 N 张：…） */
  errors: string[]
}

export interface LearningExportResult {
  canceled: boolean
  path?: string
  count?: number
}

export interface LearningApi {
  list: () => Promise<LearningItemRecord[]>
  bootstrap: (items: LearningItemRecord[]) => Promise<void>
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
  createMany: (drafts: LearningDraft[]) => Promise<LearningImportResult>
  exportCards: (subject?: string) => Promise<LearningExportResult>
  reviewHistory: (days: number) => Promise<LearningReviewRecord[]>
}

export interface HabitRecord {
  id: string
  name: string
  /** 打卡日期键，仅保留今天及以前 */
  checkins: string[]
}

export interface HabitApi {
  list: () => Promise<HabitRecord[]>
  bootstrap: (habits: HabitRecord[]) => Promise<void>
  setCheckin: (id: string, day: string, done: boolean) => Promise<void>
}

export type AgentKind = 'claude' | 'codex'
export type AgentSessionStatus = 'run' | 'wait' | 'idle'

export interface AgentToolRecord {
  id?: string
  name: string
  meta: string
  status: string
}

export interface AgentSessionRecord {
  id: string
  agent: AgentKind
  title: string
  status: AgentSessionStatus
  /** Claude CLI 自己的 session id；重启后用于 --resume */
  resumeId?: string
  /** 会话自己的工作目录；空表示尚未选择 */
  workspace?: string
  createdAt: number
  updatedAt: number
}

export interface AgentMessageRecord {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  text: string
  timeLabel: string
  error?: boolean
  tools?: AgentToolRecord[]
  createdAt: number
  /** app = 应用内产生；import = 从本机 CLI JSONL 只读导入 */
  origin?: 'app' | 'import'
}

export interface AgentThreadBundle {
  sessions: AgentSessionRecord[]
  messages: AgentMessageRecord[]
}

export interface AgentCreateInput {
  id: string
  agent: AgentKind
  title: string
}

export interface AgentSessionPatch {
  title?: string
  status?: AgentSessionStatus
  resumeId?: string
  workspace?: string
}

export interface AgentSendInput {
  /** 应用内的会话 id（s-c1），用于把事件归到正确的线程 */
  sessionId: string
  /** 决定主进程启动哪个 CLI；只读/审批策略各自独立 */
  agent: AgentKind
  prompt: string
  /** 续接上一轮时传 CLI 自己的会话 id */
  resumeId?: string
}

export interface AgentRunStart {
  runId: string
}

export type ProviderTarget = 'claude' | 'codex'
export type ProviderWireApi = 'responses' | 'chat'

export interface ProviderProfileRecord {
  id: string
  name: string
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  model: string
  hasToken: boolean
  active: boolean
  createdAt: number
  updatedAt: number
}

export interface ProviderSaveInput {
  id?: string
  name: string
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  model: string
  /** 只写不读；省略表示保留旧 token */
  apiKey?: string
}

export interface ProviderTestInput {
  /** 编辑已保存配置时可省略 apiKey，由主进程解密旧 token */
  id?: string
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  model: string
  /** 只用于本次探测，不落库、不回显 */
  apiKey?: string
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number
  status?: number
  message: string
}

export interface ProviderApi {
  list: () => Promise<ProviderProfileRecord[]>
  save: (input: ProviderSaveInput) => Promise<ProviderProfileRecord>
  setActive: (target: ProviderTarget, id: string | null) => Promise<void>
  test: (input: ProviderTestInput) => Promise<ProviderTestResult>
}

export interface AgentPermissionResponse {
  requestId: string
  allow: boolean
  /** 拒绝时回给 CLI 的原因，省略时用“用户拒绝” */
  message?: string
}

export interface AgentEventEnvelope {
  runId: string
  event: AgentRunEvent
}

export interface DiscoveredAgentSession {
  agent: 'claude' | 'codex'
  resumeId: string
  title: string
  workspace: string
  workspaceExists: boolean
  updatedAt: number
  imported: boolean
}

export interface AgentImportInput {
  agent: 'claude' | 'codex'
  resumeId: string
  title: string
  workspace: string
}

export interface AgentImportResult {
  session: AgentSessionRecord
  /** 从本机 JSONL 导入的历史；只读展示，不重新喂给模型 */
  messages: AgentMessageRecord[]
}

export interface AgentPresetRecord {
  id: string
  name: string
  agent: 'claude' | 'codex'
  workspace: string
  createdAt: number
  updatedAt: number
}

export interface AgentPresetInput {
  name: string
  agent: 'claude' | 'codex'
  workspace: string
}

export interface AgentRunRecord {
  id: string
  sessionId: string
  startedAt: number
  finishedAt: number | null
  ok: boolean | null
  cancelled: boolean
  costUsd: number | null
  durationMs: number | null
  turns: number | null
}

export interface WorkspaceEntry {
  path: string
  type: 'file' | 'dir'
  size: number
}

export interface WorkspaceFile {
  path: string
  text: string
}

export interface AgentApi {
  send: (input: AgentSendInput) => Promise<AgentRunStart>
  cancel: (runId: string) => Promise<void>
  respondPermission: (response: AgentPermissionResponse) => Promise<boolean>
  onEvent: (listener: (payload: AgentEventEnvelope) => void) => () => void
  threads: () => Promise<AgentThreadBundle>
  createSession: (input: AgentCreateInput) => Promise<AgentSessionRecord>
  updateSession: (id: string, patch: AgentSessionPatch) => Promise<void>
  saveMessage: (message: AgentMessageRecord) => Promise<void>
  /** 打开原生目录选择器；取消返回 null */
  pickWorkspace: (current?: string) => Promise<string | null>
  workspaceTree: (sessionId: string) => Promise<WorkspaceEntry[]>
  readWorkspaceFile: (sessionId: string, path: string) => Promise<WorkspaceFile>
  openWorkspace: (sessionId: string) => Promise<void>
  presets: () => Promise<AgentPresetRecord[]>
  savePreset: (input: AgentPresetInput) => Promise<AgentPresetRecord>
  removePreset: (id: string) => Promise<void>
  usage: (days: number) => Promise<AgentRunRecord[]>
  discoverSessions: () => Promise<DiscoveredAgentSession[]>
  importSession: (input: AgentImportInput) => Promise<AgentImportResult>
}

export const MCP_DOMAINS = ['task', 'habit', 'learning', 'note'] as const
export type McpDomain = (typeof MCP_DOMAINS)[number]
export type McpMode = 'read' | 'ask' | 'write'
export const MCP_DEFAULT_MODES: Record<McpDomain, McpMode> = {
  task: 'write',
  habit: 'read',
  learning: 'read',
  note: 'read'
}

export interface McpPolicyRecord {
  domain: McpDomain
  mode: McpMode
}

export interface McpPermissionRequest {
  requestId: string
  sessionId: string
  domain: McpDomain
  tool: string
  detail: string
  preview: string
  createdAt: number
}

export type McpPermissionDecision = 'once' | 'session' | 'deny'

export interface McpPermissionResponse {
  requestId: string
  decision: McpPermissionDecision
}

export interface McpApi {
  policy: () => Promise<McpPolicyRecord[]>
  setPolicy: (domain: McpDomain, mode: McpMode) => Promise<void>
  respondPermission: (response: McpPermissionResponse) => Promise<boolean>
  onPermission: (listener: (request: McpPermissionRequest) => void) => () => void
  /** MCP 写入成功后广播受影响的域，渲染层据此重新读库 */
  onChanged: (listener: (domains: McpDomain[]) => void) => () => void
}

export interface BuiltinToolRecord {
  name: string
  description: string
  domain: McpDomain
  write: boolean
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
  installedAt: number
  updatedAt: number
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

export interface ExternalMcpToolRecord {
  name: string
  description: string
  readOnly: boolean
  approval: McpToolApproval
}

export interface ExternalMcpServerRecord {
  id: string
  key: string
  name: string
  description: string
  transport: ExternalMcpTransport
  command: string
  args: string[]
  url: string
  envKeys: string[]
  headerKeys: string[]
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
  description?: string
  transport: ExternalMcpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  removeEnvKeys?: string[]
  removeHeaderKeys?: string[]
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

export interface CapabilityApi {
  builtinTools: () => Promise<BuiltinToolRecord[]>
  environment: (force?: boolean) => Promise<EnvironmentCheckRecord[]>
  skills: SkillApi
  mcp: ExternalMcpApi
}

export type AuditLogDomain = 'task' | 'note' | 'learning' | 'habit' | 'mcp' | 'system'

export interface AuditLogRecord {
  id: number
  at: number
  domain: AuditLogDomain
  action: string
  targetId?: string
  title?: string
  source: string
  detail?: string
}

export interface AuditApi {
  recent: (limit?: number, domain?: AuditLogDomain) => Promise<AuditLogRecord[]>
}

export interface BackupResult {
  file: string
  dir: string
  bytes: number
  at: number
}

export interface AppInfo {
  version: string
  dataDir: string
  backupDir: string
  backupCount: number
}

export interface AppApi {
  setTheme: (theme: Theme) => Promise<void>
  backupNow: () => Promise<BackupResult>
  info: () => Promise<AppInfo>
}

export interface WsApi {
  provider: ProviderApi
  tasks: TaskApi
  notes: NoteApi
  capture: CaptureApi
  learning: LearningApi
  habits: HabitApi
  agent: AgentApi
  mcp: McpApi
  capability: CapabilityApi
  audit: AuditApi
  app: AppApi
}

export const IPC_CHANNELS = {
  tasksList: 'tasks:list',
  tasksBootstrap: 'tasks:bootstrap',
  tasksSetDone: 'tasks:set-done',
  tasksApplySchedule: 'tasks:apply-schedule',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksRemove: 'tasks:remove',
  tasksRenameList: 'tasks:rename-list',
  tasksRestore: 'tasks:restore',
  notesBootstrap: 'notes:bootstrap',
  notesPage: 'notes:page',
  notesSearch: 'notes:search',
  notesCreate: 'notes:create',
  notesTogglePin: 'notes:toggle-pin',
  notesUpdate: 'notes:update',
  notesRemove: 'notes:remove',
  notesLinks: 'notes:links',
  notesTitles: 'notes:titles',
  tasksChanged: 'tasks:changed',
  captureOpen: 'capture:open',
  captureClose: 'capture:close',
  captureCreate: 'capture:create',
  learningList: 'learning:list',
  learningBootstrap: 'learning:bootstrap',
  learningCreate: 'learning:create',
  learningUpdate: 'learning:update',
  learningReview: 'learning:review',
  learningCreateMany: 'learning:create-many',
  learningExport: 'learning:export',
  learningReviewHistory: 'learning:review-history',
  habitsList: 'habits:list',
  habitsBootstrap: 'habits:bootstrap',
  habitsSetCheckin: 'habits:set-checkin',
  agentSend: 'agent:send',
  agentCancel: 'agent:cancel',
  agentPermissionResponse: 'agent:permission-response',
  agentEvent: 'agent:event',
  agentThreads: 'agent:threads',
  agentCreateSession: 'agent:create-session',
  agentUpdateSession: 'agent:update-session',
  agentSaveMessage: 'agent:save-message',
  agentPickWorkspace: 'agent:pick-workspace',
  agentWorkspaceTree: 'agent:workspace-tree',
  agentWorkspaceFile: 'agent:workspace-file',
  agentOpenWorkspace: 'agent:open-workspace',
  agentPresets: 'agent:presets',
  agentSavePreset: 'agent:save-preset',
  agentRemovePreset: 'agent:remove-preset',
  agentUsage: 'agent:usage',
  agentDiscoverSessions: 'agent:discover-sessions',
  agentImportSession: 'agent:import-session',
  mcpPolicyList: 'mcp:policy-list',
  mcpPolicySet: 'mcp:policy-set',
  mcpChanged: 'mcp:changed',
  mcpPermission: 'mcp:permission',
  mcpPermissionResponse: 'mcp:permission-response',
  capabilityBuiltinTools: 'capability:builtin-tools',
  capabilitySkillsList: 'capability:skills-list',
  capabilitySkillsMarket: 'capability:skills-market',
  capabilitySkillsInstall: 'capability:skills-install',
  capabilitySkillsUpdate: 'capability:skills-update',
  capabilitySkillsRemove: 'capability:skills-remove',
  capabilitySkillsSetEnabled: 'capability:skills-set-enabled',
  capabilitySkillsImportLocal: 'capability:skills-import-local',
  capabilitySkillsInspect: 'capability:skills-inspect',
  capabilitySkillsOpenFolder: 'capability:skills-open-folder',
  capabilityMcpList: 'capability:mcp-list',
  capabilityMcpCatalog: 'capability:mcp-catalog',
  capabilityMcpAdd: 'capability:mcp-add',
  capabilityMcpUpdate: 'capability:mcp-update',
  capabilityMcpRemove: 'capability:mcp-remove',
  capabilityMcpSetEnabled: 'capability:mcp-set-enabled',
  capabilityMcpTest: 'capability:mcp-test',
  capabilityMcpSetToolPolicy: 'capability:mcp-set-tool-policy',
  capabilityMcpImport: 'capability:mcp-import',
  capabilityMcpExport: 'capability:mcp-export',
  capabilityEnvironment: 'capability:environment',
  capabilityMcpCheckUpdates: 'capability:mcp-check-updates',
  capabilityMcpApplyUpdate: 'capability:mcp-apply-update',
  auditRecent: 'audit:recent',
  providerList: 'provider:list',
  providerSave: 'provider:save',
  providerSetActive: 'provider:set-active',
  providerTest: 'provider:test',
  appSetTheme: 'app:set-theme',
  appBackupNow: 'app:backup-now',
  appInfo: 'app:info'
} as const
