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
  agentEvent: 'agent:event',
  appSetTheme: 'app:set-theme',
  appBackupNow: 'app:backup-now',
  appInfo: 'app:info'
} as const
