import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { blockMinutes, findNextBlock, findNextTask } from './schedule'

function task(id: string, time: string, overrides: Partial<Task> = {}): Task {
  return { id, time, title: id, done: false, ...overrides }
}

describe('findNextTask', () => {
  it('跳过已完成、明天、无效时间与已过去任务，返回最近的未来任务', () => {
    const tasks = [
      task('done', '10:00', { done: true }),
      task('tomorrow', '10:30', { tag: '明天 09:00' }),
      task('invalid', '—'),
      task('past', '09:00'),
      task('next', '10:30'),
      task('later', '14:30')
    ]

    expect(findNextTask(tasks, 10 * 60)?.id).toBe('next')
  })

  it('当前时刻与任务时间相等时不算未来', () => {
    expect(findNextTask([task('now', '10:30')], 10 * 60 + 30)).toBeUndefined()
  })

  it('同一时间保留先出现的任务', () => {
    const tasks = [task('first', '10:30'), task('second', '10:30')]

    expect(findNextTask(tasks, 9 * 60)?.id).toBe('first')
  })

  it('没有未来任务时返回 undefined', () => {
    expect(findNextTask([task('past', '09:00')], 21 * 60)).toBeUndefined()
  })
})

describe('blockMinutes', () => {
  it('用下一个时间块计算时长', () => {
    expect(blockMinutes({ time: '10:30', label: '深度工作' }, { time: '11:30', label: '站会' })).toBe(60)
  })

  it('时长限制在 5–90 分钟', () => {
    expect(blockMinutes({ time: '10:30', label: '短' }, { time: '10:32', label: '下一段' })).toBe(5)
    expect(blockMinutes({ time: '09:00', label: '长' }, { time: '18:00', label: '下一段' })).toBe(90)
  })

  it('缺少下一块或时间无效时使用回退值', () => {
    expect(blockMinutes({ time: '21:00', label: '周报' }, undefined)).toBe(25)
    expect(blockMinutes({ time: '—', label: '无时间' }, { time: '22:00', label: '下一段' })).toBe(25)
  })

  it('下一块时间不在未来时使用回退值', () => {
    expect(blockMinutes({ time: '14:30', label: '线代' }, { time: '14:30', label: '同上' })).toBe(25)
  })
})

describe('findNextBlock', () => {
  const blocks = [
    { time: '09:00', label: '站会' },
    { time: '10:30', label: '深度工作' },
    { time: '14:30', label: '线代' }
  ]

  it('返回第一个晚于当前时间的块', () => {
    expect(findNextBlock(blocks, 10 * 60)?.label).toBe('深度工作')
  })

  it('块时间等于当前时刻时不算未来', () => {
    expect(findNextBlock([{ time: '10:30', label: '现在' }], 10 * 60 + 30)).toBeUndefined()
  })

  it('忽略无效时间并继续查找', () => {
    const mixed = [
      { time: '—', label: '无效' },
      { time: '10:30', label: '有效' }
    ]

    expect(findNextBlock(mixed, 9 * 60)?.label).toBe('有效')
  })

  it('所有块都已过去时返回 undefined', () => {
    expect(findNextBlock(blocks, 22 * 60)).toBeUndefined()
  })
})
