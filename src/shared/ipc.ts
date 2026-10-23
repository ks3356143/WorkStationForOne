export type TaskTone = 'agent' | 'hot'

export interface TaskRecord {
  id: string
  title: string
  time: string
  tag?: string
  tone?: TaskTone
  done: boolean
}

export interface TaskScheduleChange {
  taskId: string
  toTime: string
  toTag: string
}

export interface TaskApi {
  list: () => Promise<TaskRecord[]>
  bootstrap: (tasks: TaskRecord[]) => Promise<void>
  setDone: (id: string, done: boolean) => Promise<void>
  applySchedule: (changes: TaskScheduleChange[]) => Promise<void>
}

export interface WsApi {
  tasks: TaskApi
}

export const IPC_CHANNELS = {
  tasksList: 'tasks:list',
  tasksBootstrap: 'tasks:bootstrap',
  tasksSetDone: 'tasks:set-done',
  tasksApplySchedule: 'tasks:apply-schedule'
} as const
