import { ipcMain } from 'electron'
import type { TaskRepository } from '../db/tasks'
import { IPC_CHANNELS, type TaskRecord, type TaskScheduleChange } from '../../shared/ipc'

const IPC = IPC_CHANNELS

function assertTaskRecord(value: unknown): TaskRecord {
  if (typeof value !== 'object' || value === null) throw new TypeError('任务必须是对象')
  const record = value as Record<string, unknown>
  if (typeof record.id !== 'string' || record.id.length === 0) throw new TypeError('任务 id 无效')
  if (typeof record.title !== 'string') throw new TypeError('任务标题无效')
  if (typeof record.time !== 'string') throw new TypeError('任务时间无效')
  if (typeof record.done !== 'boolean') throw new TypeError('任务完成状态无效')
  if (record.tag !== undefined && typeof record.tag !== 'string') throw new TypeError('任务标签无效')
  if (record.tone !== undefined && record.tone !== 'agent' && record.tone !== 'hot') {
    throw new TypeError('任务色调无效')
  }
  return {
    id: record.id,
    title: record.title,
    time: record.time,
    done: record.done,
    tag: record.tag,
    tone: record.tone
  }
}

function assertChanges(value: unknown): TaskScheduleChange[] {
  if (!Array.isArray(value)) throw new TypeError('变更必须是数组')
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('变更项无效')
    const change = item as Record<string, unknown>
    if (typeof change.taskId !== 'string' || change.taskId.length === 0) throw new TypeError('变更任务 id 无效')
    if (typeof change.toTime !== 'string') throw new TypeError('变更时间无效')
    if (typeof change.toTag !== 'string') throw new TypeError('变更标签无效')
    return { taskId: change.taskId, toTime: change.toTime, toTag: change.toTag }
  })
}

export const registerTaskHandlersIPC = {
  assertTaskRecord,
  assertChanges
} as const

export function registerTaskHandlers(repository: TaskRepository): void {
  ipcMain.handle(IPC.tasksList, () => repository.list())

  ipcMain.handle(IPC.tasksBootstrap, (_event, value: unknown) => {
    repository.bootstrap((Array.isArray(value) ? value : []).map(assertTaskRecord))
  })

  ipcMain.handle(IPC.tasksSetDone, (_event, id: unknown, done: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('任务 id 无效')
    if (typeof done !== 'boolean') throw new TypeError('完成状态无效')
    repository.setDone(id, done)
  })

  ipcMain.handle(IPC.tasksApplySchedule, (_event, value: unknown) => {
    repository.applySchedule(assertChanges(value))
  })
}
