import type { AgentFileDiff, AgentRunEvent } from '../agent-stream'
import type { ApprovalAgent, ApprovalScope } from '../approval-rules'

export type AgentKind = 'claude' | 'codex'
export type AgentSessionStatus = 'run' | 'wait' | 'idle'

export interface AgentToolRecord {
  id?: string
  name: string
  meta: string
  status: string
  /** 文件写入工具的改动预览；旧记录没有该字段 */
  diffs?: AgentFileDiff[]
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
  /** 计划模式：只读调查并给方案，不执行写入 */
  planMode?: boolean
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
  /** 产生这条助手消息的应用运行 id，用于匹配回合检查点 */
  runId?: string
  /** app = 应用内产生；import = 从本机 CLI JSONL 只读导入 */
  origin?: 'app' | 'import'
  /** 用户 @ 附加的工作区相对路径；只存路径，文件内容不落库 */
  contextFiles?: string[]
  /** 用户输入的图片；只存私有目录里的引用，不存图片内容 */
  images?: AgentImageRef[]
}

export interface AgentThreadBundle {
  sessions: AgentSessionRecord[]
  messages: AgentMessageRecord[]
}

/** 启动时只需要会话与消息数量；正文在切换会话时按需读取。 */
export interface AgentSessionSummary {
  sessions: AgentSessionRecord[]
  counts: Record<string, number>
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
  planMode?: boolean
}

export interface AgentImageRef {
  id: string
  name: string
  mime: string
  size: number
}

export interface AgentImageInput {
  mime: string
  /** base64，不含 data URL 前缀 */
  data: string
  name?: string
}

export interface AgentSendInput {
  /** 应用内的会话 id（s-c1），用于把事件归到正确的线程 */
  sessionId: string
  /** 决定主进程启动哪个 CLI；只读/审批策略各自独立 */
  agent: AgentKind
  prompt: string
  /** 续接上一轮时传 CLI 自己的会话 id */
  resumeId?: string
  /** 用户通过 @ 附加的工作区相对路径；主进程读取内容后再交给 CLI */
  contextFiles?: string[]
  /** 已保存到应用私有目录的图片；发送时按 CLI 能力注入 */
  images?: AgentImageRef[]
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

export interface AgentCheckpointFile {
  /** 工作区相对路径，统一用 / */
  path: string
  existed: boolean
  /** 原文件内容；二进制、超大或读不到时为 null */
  content: string | null
  truncated?: boolean
}

export interface AgentCheckpointRecord {
  id: string
  sessionId: string
  runId: string
  summary: string
  files: AgentCheckpointFile[]
  createdAt: number
  restoredAt?: number
}

/** 渲染层只需要路径与可回退状态；文件原内容不离开主进程。 */
export interface AgentCheckpointFileView {
  path: string
  existed: boolean
  truncated?: boolean
}

export interface AgentCheckpointView extends Omit<AgentCheckpointRecord, 'files'> {
  files: AgentCheckpointFileView[]
}

export interface AgentRollbackResult {
  restored: number
  removed: number
  failed: string[]
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

export interface AgentQuestionResponse {
  requestId: string
  /** 问题文本 → 用户答案；拒绝回答时省略 */
  answers?: Record<string, string>
  deny?: boolean
}

/** 点击后台通知后，渲染层据此切回对应会话。 */
export interface AgentAttention {
  sessionId: string
  requestId: string
  kind: 'permission' | 'question'
}

export interface AgentApi {
  send: (input: AgentSendInput) => Promise<AgentRunStart>
  cancel: (runId: string) => Promise<void>
  respondPermission: (response: AgentPermissionResponse) => Promise<boolean>
  respondQuestion: (response: AgentQuestionResponse) => Promise<boolean>
  onEvent: (listener: (payload: AgentEventEnvelope) => void) => () => void
  /** 后台审批 / 追问通知被点击；切回对应会话 */
  onAttention: (listener: (payload: AgentAttention) => void) => () => void
  threads: () => Promise<AgentThreadBundle>
  /** 只取会话列表与每会话消息数；启动时不再拉全部正文 */
  sessions: () => Promise<AgentSessionSummary>
  /** 按会话读取消息；切换会话时按需调用 */
  thread: (sessionId: string) => Promise<AgentMessageRecord[]>
  searchSessions: (query: string) => Promise<AgentSessionSearchHit[]>
  createSession: (input: AgentCreateInput) => Promise<AgentSessionRecord>
  updateSession: (id: string, patch: AgentSessionPatch) => Promise<void>
  /** 只删应用内会话与消息；不触碰外部 CLI 的 JSONL。运行中拒绝。 */
  deleteSession: (id: string) => Promise<boolean>
  saveMessage: (message: AgentMessageRecord) => Promise<void>
  /** 把剪贴板里的图片写进应用私有目录；只返回引用，不回显路径 */
  saveImage: (input: AgentImageInput) => Promise<AgentImageRef>
  /** 读取已保存图片的 data URL，供消息缩略图使用 */
  imageData: (image: AgentImageRef) => Promise<string>
  /** 丢弃未被任何消息引用的图片文件；已被引用时返回 false */
  discardImage: (image: AgentImageRef) => Promise<boolean>
  exportSession: (id: string) => Promise<AgentExportResult>
  /** 打开原生目录选择器；取消返回 null */
  pickWorkspace: (current?: string) => Promise<string | null>
  workspaceTree: (sessionId: string) => Promise<WorkspaceEntry[]>
  readWorkspaceFile: (sessionId: string, path: string) => Promise<WorkspaceFile>
  openWorkspace: (sessionId: string) => Promise<void>
  presets: () => Promise<AgentPresetRecord[]>
  checkpoints: (sessionId: string) => Promise<AgentCheckpointView[]>
  rollback: (checkpointId: string) => Promise<AgentRollbackResult>
  savePreset: (input: AgentPresetInput) => Promise<AgentPresetRecord>
  removePreset: (id: string) => Promise<void>
  usage: (days: number) => Promise<AgentRunRecord[]>
  discoverSessions: () => Promise<DiscoveredAgentSession[]>
  importSession: (input: AgentImportInput) => Promise<AgentImportResult>
  forkSession: (input: AgentForkInput) => Promise<AgentForkResult>
  approvalRules: () => Promise<ApprovalRuleRecord[]>
  removeApprovalRule: (id: string) => Promise<void>
}
