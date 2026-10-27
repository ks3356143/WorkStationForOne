import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { dayCapacity } from './capacity'

const TODAY = '2026-10-27'

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't', title: '任务', time: '—', done: false, ...overrides }
}

describe('dayCapacity', () => {
  it('只统计计划在今天且未完成的任务', () => {
    const tasks = [
      task({ id: 'a', plannedFor: TODAY, estimateMinutes: 60 }),
      task({ id: 'b', plannedFor: TODAY, estimateMinutes: 30, done: true }),
      task({ id: 'c', plannedFor: '2026-10-28', estimateMinutes: 120 }),
      task({ id: 'd', estimateMinutes: 45 })
    ]

    const capacity = dayCapacity(tasks, TODAY, 10 * 60)

    expect(capacity.planned).toBe(60)
    expect(capacity.available).toBe(12 * 60)
  })

  it('9 点前按完整工作窗口计算', () => {
    expect(dayCapacity([], TODAY, 8 * 60).available).toBe(13 * 60)
  })

  it('22 点后可用时间为 0，已计划即视为超载', () => {
    const capacity = dayCapacity([task({ plannedFor: TODAY, estimateMinutes: 30 })], TODAY, 23 * 60)

    expect(capacity.available).toBe(0)
    expect(capacity.state).toBe('over')
  })

  it('85% 起进入紧张，超过 100% 才是超载', () => {
    const tasks = [task({ plannedFor: TODAY, estimateMinutes: 663 })]
    const tight = dayCapacity(tasks, TODAY, 9 * 60)
    const over = dayCapacity([task({ plannedFor: TODAY, estimateMinutes: 781 })], TODAY, 9 * 60)

    expect(tight.state).toBe('tight')
    expect(over.state).toBe('over')
  })

  it('未估时的任务计入数量但不计入已排时长', () => {
    const capacity = dayCapacity(
      [
        task({ id: 'a', plannedFor: TODAY, estimateMinutes: 0 }),
        task({ id: 'b', plannedFor: TODAY, estimateMinutes: 30 })
      ],
      TODAY,
      10 * 60
    )

    expect(capacity.planned).toBe(30)
    expect(capacity.unestimated).toBe(1)
  })

  it('空白一天返回零占用与宽松状态', () => {
    expect(dayCapacity([], TODAY, 10 * 60)).toMatchObject({
      planned: 0,
      unestimated: 0,
      ratio: 0,
      state: 'ok'
    })
  })
})
