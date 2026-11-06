import type { TaskPatch } from '../../../shared/ipc'
import type { Task } from '../types'

/** 顺延：计划日一律改到目标日；截止日在截止线或更早时也改到目标日。 */
export function carryOverPatch(task: Task, cutoff: string, target: string): TaskPatch | null {
  if (task.done) return null
  const due = Boolean(task.dueDate && task.dueDate <= cutoff)
  const planned = Boolean(task.plannedFor && task.plannedFor <= cutoff)
  if (!due && !planned) return null
  return {
    ...(due ? { dueDate: target } : {}),
    plannedFor: target
  }
}
