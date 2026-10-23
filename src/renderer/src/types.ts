import type { TaskRecord } from '../../shared/ipc'

export type AgentId = 'claude' | 'codex'
export type TaskFilter = 'all' | 'todo' | 'done'
export type SessionStatus = 'run' | 'wait' | 'idle'
export type Resolution = 'allowed' | 'denied'

export type Task = TaskRecord

export interface Habit {
  id: string
  name: string
  days: boolean[]
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
}

export interface ToolCall {
  name: string
  meta: string
  status: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  time: string
  tools?: ToolCall[]
}

export interface PermissionChange {
  taskId: string
  fromLabel: string
  toLabel: string
  toTime: string
  toTag: string
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

export interface WorkstationData {
  tasks: Task[]
  taskFilter: TaskFilter
  habits: Habit[]
  notes: Note[]
  sessions: Session[]
  activeSessionId: string
  threads: Record<string, ChatMessage[]>
  typing: boolean
  pendingReplyTo: string | null
  permission: Permission | null
  resolution: Resolution | null
  motionOn: boolean
  focus: FocusSession | null
  quickNoteOpen: boolean
}
