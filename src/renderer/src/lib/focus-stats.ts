import type { FocusRecord } from '../../../shared/ipc'
import { addDaysKey, dateKey } from '../../../shared/date-key'

export interface FocusDayBar {
  day: string
  minutes: number
}

export interface FocusTaskTotal {
  taskId: string
  minutes: number
}

export interface FocusSummary {
  todayMinutes: number
  todayCycles: number
  totalMinutes: number
  dayBars: FocusDayBar[]
  byTask: FocusTaskTotal[]
}

/** 从专注记录派生今日工时/轮次、近 N 天柱与按任务汇总；休息段不计入工时。 */
export function summarizeFocus(records: FocusRecord[], today: string, days: number): FocusSummary {
  const focus = records.filter((item) => item.kind === 'focus')
  const dayOf = (item: FocusRecord) => dateKey(new Date(item.startedAt))

  let todayMinutes = 0
  let todayCycles = 0
  let totalMinutes = 0
  const byDay = new Map<string, number>()
  const byTask = new Map<string, number>()

  for (const item of focus) {
    const day = dayOf(item)
    totalMinutes += item.minutes
    byDay.set(day, (byDay.get(day) ?? 0) + item.minutes)
    if (day === today) {
      todayMinutes += item.minutes
      todayCycles += 1
    }
    if (item.taskId) byTask.set(item.taskId, (byTask.get(item.taskId) ?? 0) + item.minutes)
  }

  const dayBars: FocusDayBar[] = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const day = addDaysKey(today, -offset)
    dayBars.push({ day, minutes: byDay.get(day) ?? 0 })
  }

  const taskTotals = [...byTask.entries()]
    .map(([taskId, minutes]) => ({ taskId, minutes }))
    .sort((a, b) => b.minutes - a.minutes)

  return { todayMinutes, todayCycles, totalMinutes, dayBars, byTask: taskTotals }
}
