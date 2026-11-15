import { ipcMain } from 'electron'
import type { MoodRepository } from '../db/mood'
import { isDateKey } from '../../shared/date-key'
import { IPC_CHANNELS, type MoodSaveInput } from '../../shared/ipc'

const IPC = IPC_CHANNELS

function assertDay(value: unknown): string {
  if (!isDateKey(value)) throw new TypeError('日期无效')
  return value
}

function assertLevel(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${label}无效`)
  return value
}

function assertSaveInput(value: unknown): MoodSaveInput {
  const input = (value ?? {}) as Record<string, unknown>
  const note = input.note
  if (note !== undefined && typeof note !== 'string') throw new TypeError('备注无效')
  return {
    day: assertDay(input.day),
    mood: assertLevel(input.mood, '心情'),
    energy: assertLevel(input.energy, '精力'),
    ...(typeof note === 'string' ? { note } : {})
  }
}

/** 每日心情/精力打卡的 IPC。 */
export function registerMoodHandlers(mood: MoodRepository): void {
  ipcMain.handle(IPC.moodGet, (_event, day: unknown) => mood.get(assertDay(day)))
  ipcMain.handle(IPC.moodSave, (_event, value: unknown) => mood.save(assertSaveInput(value)))
  ipcMain.handle(IPC.moodRecent, (_event, days: unknown) => {
    if (typeof days !== 'number' || !Number.isFinite(days)) throw new TypeError('天数无效')
    return mood.recent(days)
  })
}

export const moodHandlerValidators = { assertDay, assertSaveInput }
