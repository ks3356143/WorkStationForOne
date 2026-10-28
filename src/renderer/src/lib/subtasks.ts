import type { Task } from '../types'

/**
 * 顶层任务：子任务不进入任何清单、计数与排程。
 * 只有一个地方能看到它们——父任务的详情。
 */
export function topLevel(tasks: Task[]): Task[] {
  return tasks.filter((task) => !task.parentId)
}

export function childrenOf(tasks: Task[], parentId: string): Task[] {
  return tasks.filter((task) => task.parentId === parentId)
}

/** 父任务行上的进度：已完成 / 总数。 */
export function subtaskProgress(tasks: Task[], parentId: string): { done: number; total: number } {
  const children = childrenOf(tasks, parentId)
  return { done: children.filter((child) => child.done).length, total: children.length }
}
