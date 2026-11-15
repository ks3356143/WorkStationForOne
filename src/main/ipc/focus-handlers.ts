import { ipcMain } from 'electron'
import type { FocusRepository } from '../db/focus'
import { IPC_CHANNELS, type FocusLogInput } from '../../shared/ipc'

const IPC = IPC_CHANNELS

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label}无效`)
  return value
}

function assertLogInput(value: unknown): FocusLogInput {
  const input = (value ?? {}) as Record<string, unknown>
  if (typeof input.label !== 'string') throw new TypeError('专注标题无效')
  if (input.kind !== 'focus' && input.kind !== 'break') throw new TypeError('专注类型无效')
  const taskId = input.taskId
  if (taskId !== undefined && taskId !== null && typeof taskId !== 'string') {
    throw new TypeError('任务 id 无效')
  }
  const completedAt = input.completedAt
  if (completedAt !== undefined && completedAt !== null && typeof completedAt !== 'number') {
    throw new TypeError('完成时间无效')
  }
  return {
    label: input.label,
    kind: input.kind,
    minutes: assertNumber(input.minutes, '分钟数'),
    startedAt: assertNumber(input.startedAt, '开始时间'),
    ...(taskId === undefined ? {} : { taskId }),
    ...(completedAt === undefined ? {} : { completedAt })
  }
}

function assertTaskId(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError('任务 id 无效')
  return value
}

/** 专注/番茄钟工时的 IPC。 */
export function registerFocusHandlers(focus: FocusRepository): void {
  ipcMain.handle(IPC.focusLog, (_event, value: unknown) => focus.log(assertLogInput(value)))
  ipcMain.handle(IPC.focusRecent, (_event, days: unknown) =>
    focus.recent(assertNumber(days, '天数'))
  )
  ipcMain.handle(IPC.focusTaskMinutes, (_event, taskId: unknown) =>
    focus.taskMinutes(assertTaskId(taskId))
  )
}

export const focusHandlerValidators = { assertLogInput, assertTaskId }
