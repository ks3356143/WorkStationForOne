import { ipcMain } from 'electron'
import { isDateKey } from '../../shared/date-key'
import { IPC_CHANNELS } from '../../shared/ipc'
import type { ReminderMuteRepository } from '../db/reminders'
import type { TaskRepository } from '../db/tasks'
import { assertTaskId } from './tasks'

const IPC = IPC_CHANNELS

function assertDay(value: unknown): string {
  if (!isDateKey(value)) throw new TypeError('提醒日期无效')
  return value
}

export function registerReminderHandlers(
  tasks: TaskRepository,
  mutes: ReminderMuteRepository
): void {
  ipcMain.handle(IPC.remindersMuted, (_event, day: unknown) => mutes.mutedIds(assertDay(day)))

  ipcMain.handle(IPC.remindersMute, (_event, id: unknown, day: unknown) => {
    const taskId = assertTaskId(id)
    if (!tasks.find(taskId)) throw new TypeError('任务不存在')
    mutes.mute(taskId, assertDay(day))
  })

  ipcMain.handle(IPC.remindersUnmute, (_event, id: unknown, day: unknown) => {
    mutes.unmute(assertTaskId(id), assertDay(day))
  })

  ipcMain.handle(IPC.remindersUnmuteDay, (_event, day: unknown) => {
    mutes.unmuteDay(assertDay(day))
  })
}
