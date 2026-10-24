import { ipcMain } from 'electron'
import { isDateKey } from '../../shared/date-key'
import type { TaskRepository } from '../db/tasks'
import {
  IPC_CHANNELS,
  type TaskDraft,
  type TaskPatch,
  type TaskPriority,
  type TaskRecord,
  type TaskScheduleChange,
  type TaskTone
} from '../../shared/ipc'

const IPC = IPC_CHANNELS

const TIME_LABEL = /^([01]?\d|2[0-3]):[0-5]\d$/
const MAX_TITLE = 500
const MAX_NOTES = 20_000
const MAX_LABEL = 80

function assertText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  if (value.length > max) throw new TypeError(`${label}过长`)
  return value
}

function assertTitle(value: unknown): string {
  const title = assertText(value, '任务标题', MAX_TITLE).trim()
  if (title.length === 0) throw new TypeError('任务标题无效')
  return title
}

function assertTime(value: unknown): string {
  if (value === '—') return value
  if (typeof value !== 'string' || !TIME_LABEL.test(value)) throw new TypeError('任务时间无效')
  return value
}

function assertDate(value: unknown): string {
  if (!isDateKey(value)) throw new TypeError('任务日期无效')
  return value
}

function assertPriority(value: unknown): TaskPriority {
  if (value !== 0 && value !== 1 && value !== 2 && value !== 3) throw new TypeError('任务优先级无效')
  return value
}

function assertTone(value: unknown): TaskTone {
  if (value !== 'agent' && value !== 'hot') throw new TypeError('任务色调无效')
  return value
}

function assertLabel(value: unknown, label: string): string {
  return assertText(value, label, MAX_LABEL).trim()
}

export function assertTaskId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('任务 id 无效')
  return value
}

export function assertTaskRecord(value: unknown): TaskRecord {
  if (typeof value !== 'object' || value === null) throw new TypeError('任务必须是对象')
  const record = value as Record<string, unknown>
  return {
    id: assertTaskId(record.id),
    title: assertText(record.title, '任务标题', MAX_TITLE),
    time: assertTime(record.time),
    done: (() => {
      if (typeof record.done !== 'boolean') throw new TypeError('任务完成状态无效')
      return record.done
    })(),
    tag: record.tag === undefined ? undefined : assertLabel(record.tag, '任务标签'),
    tone: record.tone === undefined ? undefined : assertTone(record.tone),
    notes: record.notes === undefined ? '' : assertText(record.notes, '任务备注', MAX_NOTES),
    dueDate: record.dueDate === undefined ? undefined : assertDate(record.dueDate),
    priority: record.priority === undefined ? 0 : assertPriority(record.priority),
    list: record.list === undefined ? undefined : assertLabel(record.list, '任务清单'),
    completedAt:
      record.completedAt === undefined
        ? undefined
        : (() => {
            if (typeof record.completedAt !== 'number' || !Number.isFinite(record.completedAt)) {
              throw new TypeError('任务完成时间无效')
            }
            return record.completedAt
          })()
  }
}

export function assertTaskDraft(value: unknown): TaskDraft {
  if (typeof value !== 'object' || value === null) throw new TypeError('任务草稿必须是对象')
  const draft = value as Record<string, unknown>
  const result: TaskDraft = { title: assertTitle(draft.title) }

  if (draft.time !== undefined) result.time = assertTime(draft.time)
  if (draft.tag !== undefined) result.tag = assertLabel(draft.tag, '任务标签')
  if (draft.tone !== undefined) result.tone = assertTone(draft.tone)
  if (draft.notes !== undefined) result.notes = assertText(draft.notes, '任务备注', MAX_NOTES)
  if (draft.dueDate !== undefined) result.dueDate = assertDate(draft.dueDate)
  if (draft.priority !== undefined) result.priority = assertPriority(draft.priority)
  if (draft.list !== undefined) result.list = assertLabel(draft.list, '任务清单')

  return result
}

export function assertTaskPatch(value: unknown): TaskPatch {
  if (typeof value !== 'object' || value === null) throw new TypeError('任务补丁必须是对象')
  const patch = value as Record<string, unknown>
  const result: TaskPatch = {}

  if (patch.title !== undefined) result.title = assertTitle(patch.title)
  if (patch.time !== undefined) result.time = assertTime(patch.time)
  if (patch.tag !== undefined) result.tag = patch.tag === null ? null : assertLabel(patch.tag, '任务标签')
  if (patch.tone !== undefined) result.tone = patch.tone === null ? null : assertTone(patch.tone)
  if (patch.notes !== undefined) result.notes = assertText(patch.notes, '任务备注', MAX_NOTES)
  if (patch.dueDate !== undefined) result.dueDate = patch.dueDate === null ? null : assertDate(patch.dueDate)
  if (patch.priority !== undefined) result.priority = assertPriority(patch.priority)
  if (patch.list !== undefined) {
    result.list = patch.list === null ? null : assertLabel(patch.list, '任务清单') || null
  }

  if (Object.keys(result).length === 0) throw new TypeError('任务补丁没有可更新字段')
  return result
}

function assertChanges(value: unknown): TaskScheduleChange[] {
  if (!Array.isArray(value)) throw new TypeError('变更必须是数组')
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('变更项无效')
    const change = item as Record<string, unknown>
    if (typeof change.taskId !== 'string' || change.taskId.length === 0) throw new TypeError('变更任务 id 无效')
    if (typeof change.toTime !== 'string') throw new TypeError('变更时间无效')
    if (typeof change.toTag !== 'string') throw new TypeError('变更标签无效')
    if (change.toDueDate !== undefined) {
      if (change.toDueDate !== null && !isDateKey(change.toDueDate)) throw new TypeError('变更日期无效')
    }
    return {
      taskId: change.taskId,
      toTime: change.toTime,
      toTag: change.toTag,
      ...(change.toDueDate !== undefined ? { toDueDate: change.toDueDate as string | null } : {})
    }
  })
}

export const registerTaskHandlersIPC = {
  assertTaskRecord,
  assertTaskDraft,
  assertTaskPatch,
  assertTaskId,
  assertChanges
} as const

export function registerTaskHandlers(repository: TaskRepository): void {
  ipcMain.handle(IPC.tasksList, () => repository.list())

  ipcMain.handle(IPC.tasksBootstrap, (_event, value: unknown) => {
    repository.bootstrap((Array.isArray(value) ? value : []).map(assertTaskRecord))
  })

  ipcMain.handle(IPC.tasksSetDone, (_event, id: unknown, done: unknown) => {
    const taskId = assertTaskId(id)
    if (typeof done !== 'boolean') throw new TypeError('完成状态无效')
    repository.setDone(taskId, done)
  })

  ipcMain.handle(IPC.tasksApplySchedule, (_event, value: unknown) => {
    repository.applySchedule(assertChanges(value))
  })

  ipcMain.handle(IPC.tasksCreate, (_event, value: unknown) => repository.create(assertTaskDraft(value)))

  ipcMain.handle(IPC.tasksUpdate, (_event, id: unknown, value: unknown) => {
    repository.update(assertTaskId(id), assertTaskPatch(value))
  })

  ipcMain.handle(IPC.tasksRemove, (_event, id: unknown) => {
    repository.remove(assertTaskId(id))
  })
}
