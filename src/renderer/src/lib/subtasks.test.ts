import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { childrenOf, subtaskProgress, topLevel } from './subtasks'

const task = (id: string, parentId?: string, done = false): Task => ({
  id,
  title: id,
  time: '—',
  done,
  ...(parentId ? { parentId } : {})
})

describe('topLevel / childrenOf', () => {
  it('拆成顶层与子任务两组', () => {
    const tasks = [task('p'), task('c1', 'p'), task('c2', 'p'), task('q')]
    expect(topLevel(tasks).map((item) => item.id)).toEqual(['p', 'q'])
    expect(childrenOf(tasks, 'p').map((item) => item.id)).toEqual(['c1', 'c2'])
  })

  it('没有子任务时返回空数组', () => {
    expect(childrenOf([task('p')], 'p')).toEqual([])
  })
})

describe('subtaskProgress', () => {
  it('统计完成数与总数', () => {
    const tasks = [task('p'), task('c1', 'p', true), task('c2', 'p'), task('c3', 'p', true)]
    expect(subtaskProgress(tasks, 'p')).toEqual({ done: 2, total: 3 })
  })

  it('没有子任务时是 0/0', () => {
    expect(subtaskProgress([task('p')], 'p')).toEqual({ done: 0, total: 0 })
  })
})
