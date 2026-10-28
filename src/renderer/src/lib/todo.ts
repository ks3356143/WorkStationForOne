import { addDaysKey } from '../../../shared/date-key'
import type { Task, TaskScope } from '../types'
import { toMinutes } from './date'
import { topLevel } from './subtasks'

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
  tasks = topLevel(tasks)
  return tasks.filter((task) => task.dueDate === today || isOverdue(task, today))
}

export function taskCounts(tasks: Task[], today: string): TaskCounts {
  tasks = topLevel(tasks)
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
  tasks = topLevel(tasks)
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
  tasks = topLevel(tasks)
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
  tasks = topLevel(tasks)
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

/** 挂了多少天没动才算「过期」：两周。太短会天天报警，太长就没人看。 */
export const STALE_DAYS = 14

/**
 * 任务从创建到今天过了几天。用本地日期零点对齐，
 * 避免「昨晚 23:59 建的、今早看就显示 1 天」这种按小时算出来的误差。
 */
export function staleDays(task: Task, today: string): number {
  if (task.createdAt === undefined) return 0
  const created = new Date(task.createdAt)
  const createdKey = `${created.getFullYear()}-${String(created.getMonth() + 1).padStart(2, '0')}-${String(
    created.getDate()
  ).padStart(2, '0')}`
  const [y1, m1, d1] = createdKey.split('-').map(Number)
  const [y2, m2, d2] = today.split('-').map(Number)
  const diff = Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)
  return Math.max(0, Math.round(diff / 86_400_000))
}

/** 未完成且挂了超过阈值的任务才算 stale；已完成的不再提醒。 */
export function isStale(task: Task, today: string, threshold = STALE_DAYS): boolean {
  if (task.done) return false
  return staleDays(task, today) >= threshold
}

export const LIST_NAME_MAX = 80

/**
 * 清单重命名的校验。返回错误文案，null 表示可以提交。
 * 与已有清单同名会让两个清单静默合并，代价不明显但不可逆，所以直接拦下。
 */
export function listNameError(raw: string, existing: string[], current: string): string | null {
  const name = raw.trim()
  if (!name) return '清单名不能为空'
  if (name.length > LIST_NAME_MAX) return `清单名最多 ${LIST_NAME_MAX} 字`
  if (name !== current && existing.includes(name)) return '已存在同名清单'
  return null
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
