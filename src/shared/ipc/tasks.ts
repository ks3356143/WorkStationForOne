import type { RepeatRule } from '../repeat'

export type TaskTone = 'agent' | 'hot'

export type { RepeatRule } from '../repeat'

export type TaskPriority = 0 | 1 | 2 | 3

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
