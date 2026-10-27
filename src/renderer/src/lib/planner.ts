import type { Task } from '../types'
import { toMinutes } from './date'

export const PLAN_WINDOW = { start: 9 * 60, end: 22 * 60, step: 15 } as const

export interface ScheduleBlock {
  taskId: string
  start: number
  end: number
}

export type UnplacedReason = 'no-estimate' | 'no-room'

export interface UnplacedTask {
  taskId: string
  reason: UnplacedReason
}

export interface DayPlan {
  blocks: ScheduleBlock[]
  unplaced: UnplacedTask[]
}

export interface PlanOptions {
  start?: number
  end?: number
  step?: number
}

function align(value: number, step: number): number {
  return Math.ceil(value / step) * step
}

function priorityRank(task: Task): number {
  const priority = task.priority ?? 0
  return priority === 0 ? 9 : priority
}

export function planDay(
  tasks: Task[],
  today: string,
  nowMinutes: number,
  options: PlanOptions = {}
): DayPlan {
  const start = options.start ?? PLAN_WINDOW.start
  const end = options.end ?? PLAN_WINDOW.end
  const step = options.step ?? PLAN_WINDOW.step

  const considered = tasks.filter((task) => task.plannedFor === today && !task.done)
  const occupied: [number, number][] = []
  const pending: Task[] = []

  for (const task of considered) {
    const minutes = toMinutes(task.time)
    if (minutes === null) {
      pending.push(task)
      continue
    }
    // 已经定了时间的任务当作锚点，占住它自己那段，避免排程压上去。
    occupied.push([minutes, minutes + Math.max(task.estimateMinutes ?? 0, step)])
  }

  const ordered = [...pending].sort((a, b) => {
    const dueA = a.dueDate ?? '9999-12-31'
    const dueB = b.dueDate ?? '9999-12-31'
    if (dueA !== dueB) return dueA < dueB ? -1 : 1
    return priorityRank(a) - priorityRank(b)
  })

  const blocks: ScheduleBlock[] = []
  const unplaced: UnplacedTask[] = []

  for (const task of ordered) {
    const duration = task.estimateMinutes ?? 0
    if (duration <= 0) {
      unplaced.push({ taskId: task.id, reason: 'no-estimate' })
      continue
    }

    let cursor = align(Math.max(nowMinutes, start), step)
    let placed = false

    while (cursor + duration <= end) {
      const conflict = occupied.find(([from, to]) => cursor < to && cursor + duration > from)
      if (!conflict) {
        blocks.push({ taskId: task.id, start: cursor, end: cursor + duration })
        occupied.push([cursor, cursor + duration])
        placed = true
        break
      }
      cursor = align(conflict[1], step)
    }

    if (!placed) unplaced.push({ taskId: task.id, reason: 'no-room' })
  }

  return { blocks, unplaced }
}

export function formatClock(minutes: number): string {
  const hour = Math.floor(minutes / 60)
  const minute = minutes % 60
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}
