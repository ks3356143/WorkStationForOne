import { describe, expect, it } from 'vitest'
import { createInitialData } from '../data/mock'
import type { Task } from '../types'
import { reminderBuckets, snoozeTime } from './reminder-center'

const base = createInitialData().tasks[0]!

function task(id: string, time: string, extra: Partial<Task> = {}): Task {
  return {
    ...base,
    id,
    title: id,
    time,
    done: false,
    dueDate: '2026-11-03',
    parentId: undefined,
    priority: 0,
    ...extra
  }
}

describe('reminderBuckets', () => {
  const now = new Date(2026, 10, 3, 15, 30)

  it('按当前时刻分出已错过与稍后', () => {
    const buckets = reminderBuckets(
      [task('九点', '09:00'), task('十五点半', '15:30'), task('十八点', '18:00')],
      now
    )
    expect(buckets.missed.map((item) => item.id)).toEqual(['九点'])
    expect(buckets.upcoming.map((item) => item.id)).toEqual(['十五点半', '十八点'])
  })

  it('跳过已完成、子任务、其他日期与没有具体时间的任务', () => {
    const buckets = reminderBuckets(
      [
        task('完成', '09:00', { done: true }),
        task('子任务', '09:00', { parentId: 'p' }),
        task('明天', '09:00', { dueDate: '2026-11-04' }),
        task('无时间', '—'),
        task('今天', '20:00')
      ],
      now
    )
    expect(buckets.missed).toEqual([])
    expect(buckets.upcoming.map((item) => item.id)).toEqual(['今天'])
  })

  it('延后 10 分钟并在跨日时收敛到 23:59', () => {
    expect(snoozeTime('10:30')).toBe('10:40')
    expect(snoozeTime('23:55')).toBe('23:59')
    expect(snoozeTime('—')).toBeNull()
  })
})
