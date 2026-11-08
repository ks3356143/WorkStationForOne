import type {
  AgentFileDiff,
  AgentPermissionRequest,
  AgentQuestionRequest
} from '../../shared/agent-stream'
import type {
  AgentImageRef,
  LearningItemRecord,
  McpPermissionRequest,
  Skin,
  TaskRecord,
  Theme
} from '../../shared/ipc'

export type AgentId = 'claude' | 'codex'
export type TaskFilter = 'all' | 'todo' | 'done'
export type TaskViewMode = 'inbox' | 'today' | 'upcoming' | 'all' | 'done'
export type TaskScope = TaskViewMode | `list:${string}`
export type SessionStatus = 'run' | 'wait' | 'idle'
export type Resolution = 'allowed' | 'denied'
export type View = 'today' | 'tasks' | 'agent' | 'notes' | 'learning'

export type Task = TaskRecord
export type LearningItem = LearningItemRecord

export type LearningScope =
  | { kind: 'all' }
  | { kind: 'inactive' }
  | { kind: 'subject'; subject: string }

export interface Habit {
  id: string
  name: string
  /** 打卡日期键（YYYY-MM-DD）。存日期而不是本周七格，跨周才有意义 */
  checkins: string[]
}

export interface Note {
  id: string
  text: string
  time: string
  tag?: string
  pinned?: boolean
}

export interface Session {
  id: string
  agent: AgentId
  title: string
  meta: string
  status: SessionStatus
  threadDate: string
  /** 会话自己的工作目录；空表示尚未选择 */
  workspace?: string
  /** Claude CLI 自己的会话 id；重启后用于 --resume */
  resumeId?: string
  /** 下一次续接用 --fork-session；init 后清除 */
  pendingFork?: boolean
  /** Codex 真分叉要截到的 turn id；init 后清除 */
  forkTurnId?: string
  /** 置顶会话在同 Agent 分组内排在前面 */
  pinned?: boolean
  /** 归档会话从会话栏隐藏，可在舰队控制台恢复 */
  archived?: boolean
  /** 计划模式：只读调查并给方案，不执行写入 */
  planMode?: boolean
}

export interface AgentStream {
  runId: string | null
  messageId: string
  turnId?: string
}

export interface PendingAgentPrompt {
  sessionId: string
  prompt: string
  /** 用户 @ 附加的工作区相对路径；发送时由主进程读取内容 */
  contextFiles?: string[]
  /** 用户输入的图片引用；图片本体在应用私有目录 */
  images?: AgentImageRef[]
}

export interface ToolCall {
  /** CLI 的 tool_use id；种子数据没有 id，key 退回 name */
  id?: string
  name: string
  meta: string
  status: string
  /** 文件写入工具的改动预览 */
  diffs?: AgentFileDiff[]
}

export interface ToolPermission extends AgentPermissionRequest {
  sessionId: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
  tools?: ToolCall[]
  /** 这一轮失败时的提示，渲染层用危险色标出，不与正常回复混在一起 */
  error?: boolean
  /** 从本机 CLI 历史导入的消息，只读展示 */
  imported?: boolean
  /** Codex 回合 id，用于从该条回复真分叉 */
  turnId?: string
  /** 产生这条回复的应用运行 id，用于匹配回合检查点 */
  runId?: string
  /** 用户 @ 附加的工作区相对路径；只存路径，文件内容不落库 */
  contextFiles?: string[]
  /** 用户输入的图片引用；图片本体在应用私有目录 */
  images?: AgentImageRef[]
}

export interface PermissionChange {
  taskId: string
  fromLabel: string
  toLabel: string
  toTime: string
  toTag: string
  toDueDate?: string | null
}

export interface Permission {
  id: string
  sessionId: string
  source: string
  body: string
  requestedAt: string
  changes: PermissionChange[]
}

export interface FocusSession {
  label: string
  minutes: number
}

export interface ResolutionRecord {
  sessionId: string
  decision: Resolution
}

export interface ReviewTallyData {
  reviewed: number
  again: number
  startedAt: number
}

export interface NoteJump {
  id: string
  text: string
  time: string
  tag?: string
  pinned?: boolean
}

export interface ReminderMuteState {
  /** 静音所属的本地日期；换天后旧记录自动失效，不需要清理状态。 */
  day: string
  taskIds: string[]
}

export interface WorkstationData {
  activeView: View
  tasks: Task[]
  reminderMutes: ReminderMuteState
  learningItems: LearningItem[]
  learningReady: boolean
  /**
   * 各域首次读库是否已结束（成功或失败都算）。
   * 读库前内存里是种子/空数组，直接渲染会把「还没有」这类空态闪一下，
   * 视图据此先显示占位再切换到真实内容。
   */
  tasksReady: boolean
  notesReady: boolean
  sessionsReady: boolean
  learningScope: LearningScope
  learningReviewOpen: boolean
  learningReviewSession: string[] | null
  learningReviewTally: ReviewTallyData
  /** 每日新卡上限；0 表示不限 */
  learningNewPerDay: number
  /** 今天已经首次复习的卡片数 */
  learningNewIntroduced: number
  taskFilter: TaskFilter
  taskScope: TaskScope
  /** 全局搜索/提醒中心要求打开的任务详情；消费后清空 */
  taskJumpId: string | null
  /** 全局搜索命中笔记时要直接打开的详情 */
  noteJump: NoteJump | null
  /** 全局搜索命中学习卡时要定位并高亮的卡片 */
  learningJumpId: string | null
  taskComposerRequest: number
  /** 任务 / 笔记「交给 Agent」时预填到输入栏的提示词 */
  agentDraftText: string
  agentDraftRequest: number
  /** 预填草稿属于哪个会话；切会话不会串提示词 */
  agentDraftSessionId: string | null
  lastAddedTaskId: string | null
  lastRemovedTask: { task: Task; index: number } | null
  habits: Habit[]
  notes: Note[]
  noteTotal: number
  noteRevision: number
  sessions: Session[]
  activeSessionId: string
  /** 会话搜索点进去后要定位的消息；滚动完成后清空 */
  agentJumpMessageId: string | null
  /** 点击后台通知后要聚焦的审批 / 追问卡；滚动完成后清空 */
  agentAttentionRequestId: string | null
  threads: Record<string, ChatMessage[]>
  /** 会话线程是否已从数据库按需读取；未加载时显示骨架 */
  threadsLoaded: Record<string, boolean>
  /** 每个会话各自的流；同一会话串行，不同会话可并行 */
  streams: Record<string, AgentStream>
  /** 待启动的提示词按发起会话排队 */
  pendingPrompts: PendingAgentPrompt[]
  typing: boolean
  pendingReplyTo: string | null
  permission: Permission | null
  /** 工具审批按会话保存，后台会话也能保有自己的卡片 */
  toolPermissions: Record<string, ToolPermission>
  /** 同会话并发审批排队；当前卡应答后提升队首 */
  toolPermissionQueues: Record<string, ToolPermission[]>
  /** MCP 审批按会话保存 */
  mcpPermissions: Record<string, McpPermissionRequest>
  /** Agent 追问按会话保存；问答卡与工具审批互斥但各自独立 */
  agentQuestions: Record<string, AgentQuestionRequest>
  resolution: ResolutionRecord | null
  motionOn: boolean
  theme: Theme
  skin: Skin
  focus: FocusSession | null
  quickNoteOpen: boolean
  persistenceError: string | null
}
