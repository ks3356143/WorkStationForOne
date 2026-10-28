import type { AgentRunEvent } from './agent-stream'

export type TaskTone = 'agent' | 'hot'

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
  setDone: (id: string, done: boolean) => Promise<void>
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

export interface NoteApi {
  bootstrap: (notes: NoteRecord[]) => Promise<void>
  page: (offset: number, limit: number) => Promise<NotePage>
  search: (query: string, limit: number) => Promise<NoteSearchHit[]>
  create: (text: string, tag?: string) => Promise<NoteRecord>
  togglePin: (id: string) => Promise<void>
}

export interface CaptureApi {
  open: () => Promise<void>
  close: () => Promise<void>
  create: (draft: TaskDraft) => Promise<TaskRecord>
}

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
  active: boolean
}

export interface LearningDraft {
  subject: string
  title: string
  source?: string
  notes?: string
  nextReviewOn?: string
}

export interface LearningPatch {
  subject?: string
  title?: string
  source?: string
  notes?: string
  nextReviewOn?: string
  active?: boolean
}

export type LearningRating = 1 | 2 | 3 | 4

export interface LearningApi {
  list: () => Promise<LearningItemRecord[]>
  bootstrap: (items: LearningItemRecord[]) => Promise<void>
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
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

export interface AgentSendInput {
  /** 应用内的会话 id（s-c1），用于把事件归到正确的线程 */
  sessionId: string
  prompt: string
  /** 续接上一轮时传 Claude 自己的会话 id */
  resumeId?: string
}

export interface AgentRunStart {
  runId: string
}

export interface AgentEventEnvelope {
  runId: string
  event: AgentRunEvent
}

export interface AgentApi {
  send: (input: AgentSendInput) => Promise<AgentRunStart>
  cancel: (runId: string) => Promise<void>
  onEvent: (listener: (payload: AgentEventEnvelope) => void) => () => void
}

export interface BackupResult {
  file: string
  bytes: number
  at: number
}

export interface AppApi {
  setTheme: (theme: Theme) => Promise<void>
  backupNow: () => Promise<BackupResult>
}

export interface WsApi {
  tasks: TaskApi
  notes: NoteApi
  capture: CaptureApi
  learning: LearningApi
  habits: HabitApi
  agent: AgentApi
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
  tasksChanged: 'tasks:changed',
  captureOpen: 'capture:open',
  captureClose: 'capture:close',
  captureCreate: 'capture:create',
  learningList: 'learning:list',
  learningBootstrap: 'learning:bootstrap',
  learningCreate: 'learning:create',
  learningUpdate: 'learning:update',
  learningReview: 'learning:review',
  habitsList: 'habits:list',
  habitsBootstrap: 'habits:bootstrap',
  habitsSetCheckin: 'habits:set-checkin',
  agentSend: 'agent:send',
  agentCancel: 'agent:cancel',
  agentEvent: 'agent:event',
  appSetTheme: 'app:set-theme',
  appBackupNow: 'app:backup-now'
} as const
