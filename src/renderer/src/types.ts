import type { TaskRecord, Theme } from '../../shared/ipc'

export type AgentId = 'claude' | 'codex'
export type TaskFilter = 'all' | 'todo' | 'done'
export type TaskViewMode = 'inbox' | 'today' | 'upcoming' | 'all' | 'done'
export type TaskScope = TaskViewMode | `list:${string}`
export type SessionStatus = 'run' | 'wait' | 'idle'
export type Resolution = 'allowed' | 'denied'
export type View = 'today' | 'tasks' | 'agent' | 'notes'

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

export interface WorkstationData {
  activeView: View
  tasks: Task[]
  taskFilter: TaskFilter
  taskScope: TaskScope
  taskComposerRequest: number
  habits: Habit[]
  notes: Note[]
  noteTotal: number
  sessions: Session[]
  activeSessionId: string
  threads: Record<string, ChatMessage[]>
  typing: boolean
  pendingReplyTo: string | null
  permission: Permission | null
  resolution: Resolution | null
  motionOn: boolean
  theme: Theme
  focus: FocusSession | null
  quickNoteOpen: boolean
}
