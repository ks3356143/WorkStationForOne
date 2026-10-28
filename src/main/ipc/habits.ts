import { ipcMain } from 'electron'
import { isDateKey } from '../../shared/date-key'
import { IPC_CHANNELS, type HabitRecord } from '../../shared/ipc'
import type { HabitRepository } from '../db/habits'

const IPC = IPC_CHANNELS
const MAX_NAME = 40
const MAX_HABITS = 200

function assertId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) {
    throw new TypeError('习惯 id 无效')
  }
  return value
}

function assertName(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('习惯名无效')
  const name = value.trim()
  if (!name) throw new TypeError('习惯名不能为空')
  if (name.length > MAX_NAME) throw new TypeError(`习惯名最多 ${MAX_NAME} 字`)
  return name
}

export function assertHabits(value: unknown): HabitRecord[] {
  if (!Array.isArray(value)) throw new TypeError('习惯列表必须是数组')
  if (value.length > MAX_HABITS) throw new TypeError('习惯数量过多')
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new TypeError('习惯条目无效')
    const record = item as Record<string, unknown>
    if (!Array.isArray(record.checkins)) throw new TypeError('打卡记录无效')
    for (const day of record.checkins) {
      if (!isDateKey(day)) throw new TypeError('打卡日期无效')
    }
    return {
      id: assertId(record.id),
      name: assertName(record.name),
      checkins: [...(record.checkins as string[])].sort()
    }
  })
}

export function registerHabitHandlers(repository: HabitRepository): void {
  ipcMain.handle(IPC.habitsList, () => repository.list())

  ipcMain.handle(IPC.habitsBootstrap, (_event, value: unknown) => {
    repository.bootstrap(assertHabits(value))
  })

  ipcMain.handle(IPC.habitsSetCheckin, (_event, id: unknown, day: unknown, done: unknown) => {
    if (!isDateKey(day)) throw new TypeError('打卡日期无效')
    if (typeof done !== 'boolean') throw new TypeError('打卡状态无效')
    repository.setCheckin(assertId(id), day, done)
  })
}
