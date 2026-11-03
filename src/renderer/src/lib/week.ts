import { addDaysKey } from '../../../shared/date-key'
import type { Task } from '../types'
import { toMinutes } from './date'
import { topLevel } from './subtasks'

export function startOfWeekKey(day: string): string {
  const [year, month, date] = day.split('-').map(Number)
  const weekday = new Date(year, month - 1, date).getDay()
  const offset = (weekday + 6) % 7
  return addDaysKey(day, -offset)
}

export function weekDayKeys(start: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDaysKey(start, index))
}

export function shiftWeek(start: string, delta: number): string {
  return addDaysKey(start, delta * 7)
}

export function weekTaskDate(task: Task): string | undefined {
  return task.plannedFor ?? task.dueDate
}

/** 周视图顶部「未排期」条：没有计划日期也没有截止日期的未完成顶层任务。 */
export function weekBacklog(tasks: Task[]): Task[] {
  return topLevel(tasks).filter((task) => !task.done && !weekTaskDate(task))
}

export interface WeekGroup {
  date: string
  tasks: Task[]
}

/** 按「计划日期优先、其次截止日期」归入本周；子任务不进入周看板。 */
export function groupTasksByWeek(tasks: Task[], start: string): WeekGroup[] {
  const days = weekDayKeys(start)
  const allowed = new Set(days)
  const groups = new Map(days.map((date) => [date, [] as Task[]]))
  for (const task of topLevel(tasks)) {
    const date = weekTaskDate(task)
    if (!date || !allowed.has(date)) continue
    groups.get(date)?.push(task)
  }
  for (const list of groups.values()) {
    list.sort(
      (a, b) =>
        (toMinutes(a.time) ?? 9999) - (toMinutes(b.time) ?? 9999) ||
        (b.priority ?? 0) - (a.priority ?? 0) ||
        a.title.localeCompare(b.title, 'zh')
    )
  }
  return days.map((date) => ({ date, tasks: groups.get(date) ?? [] }))
}
