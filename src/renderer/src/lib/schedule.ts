import type { Task } from '../types'
import { toMinutes } from './date'

export interface TimeBlock {
  time: string
  label: string
}

export function blockMinutes(
  block: TimeBlock,
  nextBlock: TimeBlock | undefined,
  fallback = 25
): number {
  const start = toMinutes(block.time)
  const end = nextBlock ? toMinutes(nextBlock.time) : null
  if (start === null || end === null || end <= start) return fallback
  return Math.min(90, Math.max(5, end - start))
}

export function findNextTask(tasks: Task[], nowMinutes: number): Task | undefined {
  let nextTask: Task | undefined
  let nextMinutes = Number.POSITIVE_INFINITY

  for (const task of tasks) {
    if (task.done || task.tag?.includes('明天')) continue
    const minutes = toMinutes(task.time)
    if (minutes === null || minutes <= nowMinutes || minutes >= nextMinutes) continue
    nextTask = task
    nextMinutes = minutes
  }

  return nextTask
}

export function findNextBlock<T extends { time: string }>(
  blocks: readonly T[],
  nowMinutes: number
): T | undefined {
  for (const block of blocks) {
    const minutes = toMinutes(block.time)
    if (minutes !== null && minutes > nowMinutes) return block
  }
  return undefined
}
