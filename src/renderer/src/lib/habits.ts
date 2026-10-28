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

/**
 * 当前连续天数。今天还没打卡时从昨天往前数——
 * 一天还没过完就把连续清零，会让人为了保住数字而被迫提前打卡。
 */
export function currentStreak(habit: Habit, today: string): number {
  const done = new Set(habit.checkins)
  let cursor = done.has(today) ? today : addDaysKey(today, -1)
  let count = 0
  while (done.has(cursor)) {
    count += 1
    cursor = addDaysKey(cursor, -1)
  }
  return count
}

/** 历史上最长的一段连续，用来跟当前值对比「是不是最好状态」。 */
export function bestStreak(habit: Habit): number {
  const days = [...new Set(habit.checkins)].sort()
  let best = 0
  let run = 0
  let previous: string | null = null
  for (const day of days) {
    run = previous && addDaysKey(previous, 1) === day ? run + 1 : 1
    best = Math.max(best, run)
    previous = day
  }
  return best
}
