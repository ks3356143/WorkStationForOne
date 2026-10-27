import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { Task } from '../types'

export interface HeatmapDay {
  key: string
  count: number
}

export interface HeatmapWeek {
  days: (HeatmapDay | null)[]
}

export interface CompletionHeatmap {
  weeks: HeatmapWeek[]
  total: number
  max: number
  activeDays: number
  start: string
  end: string
}

function weekdayIndex(key: string): number {
  const [year, month, day] = key.split('-').map(Number)
  return (new Date(year, month - 1, day).getDay() + 6) % 7
}

/** 近 N 周的完成热力图：周一起始、列为一周，未来日期用 null 占位。 */
export function completionHeatmap(tasks: Task[], today: string, weeks = 26): CompletionHeatmap {
  const start = addDaysKey(today, -(weeks - 1) * 7 - weekdayIndex(today))
  const counts = new Map<string, number>()

  for (const task of tasks) {
    if (!task.done || task.completedAt === undefined) continue
    const key = dateKey(new Date(task.completedAt))
    if (key < start || key > today) continue
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const columns: HeatmapWeek[] = []
  let total = 0
  let max = 0
  let activeDays = 0

  for (let week = 0; week < weeks; week += 1) {
    const days: (HeatmapDay | null)[] = []
    for (let offset = 0; offset < 7; offset += 1) {
      const key = addDaysKey(start, week * 7 + offset)
      if (key > today) {
        days.push(null)
        continue
      }
      const count = counts.get(key) ?? 0
      days.push({ key, count })
      total += count
      max = Math.max(max, count)
      if (count > 0) activeDays += 1
    }
    columns.push({ days })
  }

  return { weeks: columns, total, max, activeDays, start, end: today }
}

export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count <= 4) return 3
  return 4
}
