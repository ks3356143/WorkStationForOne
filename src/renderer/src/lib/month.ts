import { addDaysKey } from '../../../shared/date-key'
import type { Task } from '../types'
import { topLevel } from './subtasks'
import { startOfWeekKey, weekTaskDate } from './week'

export interface MonthCell {
  day: string
  inMonth: boolean
}

export interface MonthDayGroup {
  day: string
  inMonth: boolean
  tasks: Task[]
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** 月历网格：周一起始、固定 6 周 42 格，含前后月补位；month 为 1–12。 */
export function monthGrid(year: number, month: number): MonthCell[] {
  const monthPrefix = `${year}-${pad(month)}`
  const start = startOfWeekKey(`${monthPrefix}-01`)
  return Array.from({ length: 42 }, (_, index) => {
    const day = addDaysKey(start, index)
    return { day, inMonth: day.slice(0, 7) === monthPrefix }
  })
}

/** 按「计划日优先、其次截止日」归入月历各格；子任务不进入。 */
export function groupTasksByMonth(tasks: Task[], cells: MonthCell[]): MonthDayGroup[] {
  const allowed = new Set(cells.map((cell) => cell.day))
  const groups = new Map(cells.map((cell) => [cell.day, [] as Task[]]))
  for (const task of topLevel(tasks)) {
    const date = weekTaskDate(task)
    if (!date || !allowed.has(date)) continue
    groups.get(date)?.push(task)
  }
  return cells.map((cell) => ({
    day: cell.day,
    inMonth: cell.inMonth,
    tasks: groups.get(cell.day) ?? []
  }))
}

/** 负载热力等级 0–4：按当日任务数分档。 */
export function dayLoad(count: number): number {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 4) return 2
  if (count <= 6) return 3
  return 4
}

export function shiftMonth(
  year: number,
  month: number,
  delta: number
): { year: number; month: number } {
  const total = year * 12 + (month - 1) + delta
  return { year: Math.floor(total / 12), month: (total % 12) + 1 }
}

export function monthLabel(year: number, month: number): string {
  return `${year} 年 ${month} 月`
}
