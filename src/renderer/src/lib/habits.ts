import { addDaysKey } from '../../../shared/date-key'
import type { Habit } from '../types'

/** 周一起始的 7 个日期键，覆盖当前这一周。 */
export function weekKeys(today: string): string[] {
  const [year, month, day] = today.split('-').map(Number)
  const mondayIndex = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  const monday = addDaysKey(today, -mondayIndex)
  return Array.from({ length: 7 }, (_, index) => addDaysKey(monday, index))
}

/** 本周七格是否打卡；未来日期恒为 false。 */
export function weekFlags(habit: Habit, today: string): boolean[] {
  const keys = weekKeys(today)
  const done = new Set(habit.checkins)
  return keys.map((key) => key <= today && done.has(key))
}

export function isCheckedOn(habit: Habit, day: string): boolean {
  return habit.checkins.includes(day)
}

/** 今天已完成几条习惯。 */
export function habitsDoneToday(habits: Habit[], today: string): number {
  return habits.filter((habit) => isCheckedOn(habit, today)).length
}

/**
 * 切换某天打卡。只允许今天及以前——未来不该有记录，
 * 这与 weekFlags 把未来留空是同一条规则。
 */
export function toggleCheckin(habit: Habit, day: string, today: string): Habit {
  if (day > today) return habit
  const next = new Set(habit.checkins)
  if (next.has(day)) next.delete(day)
  else next.add(day)
  return { ...habit, checkins: [...next].sort() }
}
