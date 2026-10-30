import type { AgentPermissionRequest } from '../../shared/agent-stream'
import type {
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
}

export interface AgentStream {
  runId: string | null
  messageId: string
}

export interface PendingAgentPrompt {
  sessionId: string
  prompt: string
}

export interface ToolCall {
  /** CLI 的 tool_use id；种子数据没有 id，key 退回 name */
  id?: string
  name: string
  meta: string
  status: string
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

export interface WorkstationData {
  activeView: View
  tasks: Task[]
  learningItems: LearningItem[]
  learningReady: boolean
  learningScope: LearningScope
  learningReviewOpen: boolean
  learningReviewSession: string[] | null
  learningReviewTally: ReviewTallyData
  taskFilter: TaskFilter
  taskScope: TaskScope
  taskComposerRequest: number
  lastAddedTaskId: string | null
  lastRemovedTask: { task: Task; index: number } | null
  habits: Habit[]
  notes: Note[]
  noteTotal: number
  noteRevision: number
  sessions: Session[]
  activeSessionId: string
  threads: Record<string, ChatMessage[]>
  /** 每个会话各自的流；同一会话串行，不同会话可并行 */
  streams: Record<string, AgentStream>
  /** 待启动的提示词按发起会话排队 */
  pendingPrompts: PendingAgentPrompt[]
  typing: boolean
  pendingReplyTo: string | null
  permission: Permission | null
  /** 工具审批按会话保存，后台会话也能保有自己的卡片 */
  toolPermissions: Record<string, ToolPermission>
  /** MCP 审批按会话保存 */
  mcpPermissions: Record<string, McpPermissionRequest>
  resolution: ResolutionRecord | null
  motionOn: boolean
  theme: Theme
  skin: Skin
  focus: FocusSession | null
  quickNoteOpen: boolean
  persistenceError: string | null
}
