import { addDaysKey } from '../../../shared/date-key'
import type { TaskPatch } from '../../../shared/ipc'
import type { TaskScope } from '../types'

export const TASK_DRAG_TYPE = 'application/x-wos-task'

export const TIMELINE_START = 9 * 60
export const TIMELINE_END = 22 * 60
export const TIMELINE_STEP = 15

/** 拖到智能清单/自定义清单时的字段变更；全部任务与已完成不是投放目标。 */
export function scopeDropPatch(scope: TaskScope, today: string): TaskPatch | null {
  if (scope === 'today') return { dueDate: today }
  if (scope === 'upcoming') return { dueDate: addDaysKey(today, 1) }
  if (scope === 'inbox') return { list: null }
  if (scope.startsWith('list:')) return { list: scope.slice('list:'.length) }
  return null
}

/** 时间轴横坐标比例 → 15 分钟对齐的分钟数，夹在 09:00–22:00。 */
export function minutesFromRatio(ratio: number): number {
  const clamped = Math.min(1, Math.max(0, ratio))
  const raw = TIMELINE_START + clamped * (TIMELINE_END - TIMELINE_START)
  const snapped = Math.round(raw / TIMELINE_STEP) * TIMELINE_STEP
  return Math.min(TIMELINE_END, Math.max(TIMELINE_START, snapped))
}

export function timeFromRatio(ratio: number): string {
  const minutes = minutesFromRatio(ratio)
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}
