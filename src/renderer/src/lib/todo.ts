import { addDaysKey } from '../../../shared/date-key'
import type { Task, TaskScope } from '../types'
import { toMinutes } from './date'

export interface TaskCounts {
  inbox: number
  today: number
  upcoming: number
  all: number
  done: number
}

export interface TaskList {
  name: string
  count: number
}

export function isOverdue(task: Task, today: string): boolean {
  if (task.done || !task.dueDate) return false
  return task.dueDate < today
}

export function isInToday(task: Task, today: string): boolean {
  if (!task.dueDate) return false
  return task.dueDate === today || isOverdue(task, today)
}

export function tasksForTodayCard(tasks: Task[], today: string): Task[] {
  return tasks.filter((task) => task.dueDate === today || isOverdue(task, today))
}

export function taskCounts(tasks: Task[], today: string): TaskCounts {
  return tasks.reduce<TaskCounts>(
    (counts, task) => {
      if (task.done) {
        counts.done += 1
        return counts
      }
      counts.all += 1
      if (!task.list) counts.inbox += 1
      if (task.dueDate && task.dueDate <= today) counts.today += 1
      if (task.dueDate && task.dueDate > today) counts.upcoming += 1
      return counts
    },
    { inbox: 0, today: 0, upcoming: 0, all: 0, done: 0 }
  )
}

function dueSort(a: Task, b: Task): number {
  const dateA = a.dueDate ?? '9999-12-31'
  const dateB = b.dueDate ?? '9999-12-31'
  if (dateA !== dateB) return dateA < dateB ? -1 : 1

  const timeA = toMinutes(a.time) ?? Number.POSITIVE_INFINITY
  const timeB = toMinutes(b.time) ?? Number.POSITIVE_INFINITY
  if (timeA !== timeB) return timeA - timeB

  return (a.priority ?? 0) - (b.priority ?? 0)
}

export function filterTasksByScope(tasks: Task[], scope: TaskScope, today: string): Task[] {
  if (scope === 'inbox') return tasks.filter((task) => !task.done && !task.list)
  if (scope === 'today') {
    return tasks
      .filter((task) => !task.done && !!task.dueDate && task.dueDate <= today)
      .sort(dueSort)
  }
  if (scope === 'upcoming') {
    return tasks
      .filter((task) => !task.done && !!task.dueDate && task.dueDate > today)
      .sort(dueSort)
  }
  if (scope === 'done') {
    return tasks
      .filter((task) => task.done)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  }
  if (scope.startsWith('list:')) {
    const name = scope.slice('list:'.length)
    return tasks.filter((task) => !task.done && task.list === name).sort(dueSort)
  }
  return tasks.filter((task) => !task.done).sort(dueSort)
}

export function searchTasks(tasks: Task[], query: string): Task[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []

  const matched = tasks.filter((task) =>
    [task.title, task.notes ?? '', task.list ?? '', task.tag ?? ''].some((value) =>
      value.toLowerCase().includes(needle)
    )
  )

  return [
    ...matched.filter((task) => !task.done).sort(dueSort),
    ...matched
      .filter((task) => task.done)
      .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
  ]
}

export function taskLists(tasks: Task[], activeList?: string): TaskList[] {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    if (task.done || !task.list) continue
    counts.set(task.list, (counts.get(task.list) ?? 0) + 1)
  }
  const lists = [...counts.entries()].map(([name, count]) => ({ name, count }))
  if (activeList && !counts.has(activeList)) lists.push({ name: activeList, count: 0 })
  return lists.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'))
}

function dateText(key: string, today: string): string {
  return key.slice(0, 4) === today.slice(0, 4) ? key.slice(5) : key
}

export function taskDueLabel(task: Task, today: string): string | undefined {
  if (!task.dueDate) return undefined

  let dateLabel: string
  if (task.dueDate === today) dateLabel = '今天'
  else if (task.dueDate === addDaysKey(today, 1)) dateLabel = '明天'
  else if (isOverdue(task, today)) dateLabel = `逾期 · ${dateText(task.dueDate, today)}`
  else dateLabel = dateText(task.dueDate, today)

  return task.time === '—' ? dateLabel : `${dateLabel} ${task.time}`
}

export interface TaskGroup {
  date: string
  tasks: Task[]
}

export function groupTasksByDate(tasks: Task[]): TaskGroup[] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    if (!task.dueDate) continue
    const group = groups.get(task.dueDate)
    if (group) group.push(task)
    else groups.set(task.dueDate, [task])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, grouped]) => ({ date, tasks: grouped }))
}
