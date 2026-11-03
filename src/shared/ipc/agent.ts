import type { AgentRunEvent } from '../agent-stream'
import type { ApprovalAgent, ApprovalScope } from '../approval-rules'

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
  /** 下一次续接要用 --fork-session；init 拿到新 session id 后清除 */
  pendingFork?: boolean
  /** Codex 真分叉要截到的 turn id；init 后清除 */
  forkTurnId?: string
  /** 会话自己的工作目录；空表示尚未选择 */
  workspace?: string
  /** 置顶会话在列表里排在同 Agent 分组前面 */
  pinned?: boolean
  /** 归档会话从会话栏隐藏，可在舰队控制台恢复 */
  archived?: boolean
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
  /** Codex app-server 的回合 id，用于从该条回复真分叉 */
  turnId?: string
  /** app = 应用内产生；import = 从本机 CLI JSONL 只读导入 */
  origin?: 'app' | 'import'
}

export interface AgentThreadBundle {
  sessions: AgentSessionRecord[]
  messages: AgentMessageRecord[]
}

export interface AgentExportResult {
  canceled: boolean
  path?: string
  count?: number
}

export interface AgentSessionSearchHit {
  session: AgentSessionRecord
  /** 命中的消息片段；标题命中时为空 */
  snippet: string
  /** 最新一条命中消息的 id，供跳转定位；标题命中时为 null */
  messageId: string | null
  matchedIn: 'title' | 'message'
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
  pendingFork?: boolean
  forkTurnId?: string | null
  workspace?: string
  pinned?: boolean
  archived?: boolean
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

export interface ProviderModelsInput {
  /** 编辑已保存配置时可省略 apiKey，由主进程解密旧 token */
  id?: string
  target: ProviderTarget
  wireApi: ProviderWireApi
  baseUrl: string
  /** 只用于本次拉取，不落库、不回显 */
  apiKey?: string
}

export interface ProviderModelsResult {
  ok: boolean
  models: string[]
  latencyMs: number
  status?: number
  message: string
}

export interface ProviderApi {
  list: () => Promise<ProviderProfileRecord[]>
  save: (input: ProviderSaveInput) => Promise<ProviderProfileRecord>
  setActive: (target: ProviderTarget, id: string | null) => Promise<void>
  test: (input: ProviderTestInput) => Promise<ProviderTestResult>
  listModels: (input: ProviderModelsInput) => Promise<ProviderModelsResult>
}

/** 工作区级审批规则；会话级放行只存在内存，不落库。 */
export interface ApprovalRuleRecord {
  id: string
  agent: ApprovalAgent
  workspace: string
  toolName: string
  createdAt: number
  lastUsedAt: number | null
}

export interface AgentPermissionResponse {
  requestId: string
  allow: boolean
  /** 允许时的作用域；省略按 once。拒绝时忽略 */
  scope?: ApprovalScope
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

export interface AgentForkInput {
  sessionId: string
  messageId: string
}

export interface AgentForkResult {
  session: AgentSessionRecord
  /** 到此消息为止的对话副本；cli 模式会继承源 resumeId，并在首轮用 CLI 的分叉能力 */
  messages: AgentMessageRecord[]
  /** cli：真分叉（Claude --fork-session / Codex thread/fork）；copy：只能复制对话 */
  mode: 'cli' | 'copy'
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
  searchSessions: (query: string) => Promise<AgentSessionSearchHit[]>
  createSession: (input: AgentCreateInput) => Promise<AgentSessionRecord>
  updateSession: (id: string, patch: AgentSessionPatch) => Promise<void>
  /** 只删应用内会话与消息；不触碰外部 CLI 的 JSONL。运行中拒绝。 */
  deleteSession: (id: string) => Promise<boolean>
  saveMessage: (message: AgentMessageRecord) => Promise<void>
  exportSession: (id: string) => Promise<AgentExportResult>
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
  forkSession: (input: AgentForkInput) => Promise<AgentForkResult>
  approvalRules: () => Promise<ApprovalRuleRecord[]>
  removeApprovalRule: (id: string) => Promise<void>
}
