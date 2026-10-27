import type { Task } from '../types'

/** 与今日时间轴保持一致的工作窗口。 */
export const DAY_WINDOW = { start: 9 * 60, end: 22 * 60 } as const

export type CapacityState = 'ok' | 'tight' | 'over'

export interface DayCapacity {
  available: number
  planned: number
  ratio: number
  state: CapacityState
  unestimated: number
}

export function dayCapacity(tasks: Task[], today: string, nowMinutes: number): DayCapacity {
  let planned = 0
  let unestimated = 0

  for (const task of tasks) {
    if (task.done || task.plannedFor !== today) continue
    const estimate = task.estimateMinutes ?? 0
    if (estimate > 0) planned += estimate
    else unestimated += 1
  }

  const available = Math.max(0, DAY_WINDOW.end - Math.max(nowMinutes, DAY_WINDOW.start))
  const ratio = available === 0 ? (planned > 0 ? 1 : 0) : planned / available
  const state: CapacityState = planned > available ? 'over' : ratio >= 0.85 ? 'tight' : 'ok'

  return { available, planned, ratio, state, unestimated }
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h${String(minutes).padStart(2, '0')}m`
}
