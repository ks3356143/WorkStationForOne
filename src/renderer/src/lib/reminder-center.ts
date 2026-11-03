import { dateKey } from '../../../shared/date-key'
import type { Task } from '../types'
import { toMinutes } from './date'

export interface ReminderBuckets {
  missed: Task[]
  upcoming: Task[]
}

/** 只统计今天、带具体时间、未完成的顶层任务；时间相同按优先级与标题稳定排序。 */
export function reminderBuckets(tasks: Task[], now: Date): ReminderBuckets {
  const today = dateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const items = tasks
    .filter((task) => !task.done && !task.parentId && task.dueDate === today)
    .map((task) => ({ task, minutes: toMinutes(task.time) }))
    .filter((item): item is { task: Task; minutes: number } => item.minutes !== null)
    .sort(
      (a, b) =>
        a.minutes - b.minutes ||
        (b.task.priority ?? 0) - (a.task.priority ?? 0) ||
        a.task.title.localeCompare(b.task.title, 'zh')
    )

  return {
    missed: items.filter((item) => item.minutes < nowMinutes).map((item) => item.task),
    upcoming: items.filter((item) => item.minutes >= nowMinutes).map((item) => item.task)
  }
}

export function snoozeTime(time: string, minutes = 10): string | null {
  const at = toMinutes(time)
  if (at === null) return null
  const next = Math.min(23 * 60 + 59, at + minutes)
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`
}
