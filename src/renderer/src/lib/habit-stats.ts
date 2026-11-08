import { addDaysKey } from '../../../shared/date-key'
import type { Habit } from '../types'
import { bestStreak, currentStreak } from './habits'

export interface HabitHeatmapDay {
  key: string
  done: boolean
}

export interface HabitHeatmapWeek {
  days: (HabitHeatmapDay | null)[]
}

export interface HabitHeatmap {
  weeks: HabitHeatmapWeek[]
  total: number
  activeDays: number
  start: string
  end: string
}

export interface HabitStats {
  current: number
  best: number
  total: number
  last30Days: number
  last30Done: number
  rate: number
}

function weekdayIndex(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return (new Date(year, month - 1, day).getDay() + 6) % 7
}

/** 近 N 周打卡热力图：周一起始，列为一周，未来日期用 null 占位。 */
export function habitHeatmap(habit: Habit, today: string, weeks = 26): HabitHeatmap {
  const start = addDaysKey(today, -(weeks - 1) * 7 - weekdayIndex(today))
  const done = new Set(habit.checkins.filter((day) => day <= today))

  const columns: HabitHeatmapWeek[] = []
  let total = 0
  let activeDays = 0

  for (let week = 0; week < weeks; week += 1) {
    const days: (HabitHeatmapDay | null)[] = []
    for (let offset = 0; offset < 7; offset += 1) {
      const key = addDaysKey(start, week * 7 + offset)
      if (key > today) {
        days.push(null)
        continue
      }
      const hit = done.has(key)
      days.push({ key, done: hit })
      if (hit) {
        total += 1
        activeDays += 1
      }
    }
    columns.push({ days })
  }

  return { weeks: columns, total, activeDays, start, end: today }
}

/** 单习惯汇总：连续、历史最佳、累计打卡与近 30 天完成率（0–1）。 */
export function habitStats(habit: Habit, today: string, windowDays = 30): HabitStats {
  const safe = { ...habit, checkins: habit.checkins.filter((day) => day <= today) }
  const done = new Set(safe.checkins)
  const start = addDaysKey(today, -(windowDays - 1))
  let last30Done = 0
  for (const day of done) {
    if (day >= start && day <= today) last30Done += 1
  }
  return {
    current: currentStreak(safe, today),
    best: bestStreak(safe),
    total: done.size,
    last30Days: windowDays,
    last30Done,
    rate: windowDays > 0 ? last30Done / windowDays : 0
  }
}
