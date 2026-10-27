import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { planDay } from './planner'

const TODAY = '2026-10-27'
const at = (hour: number, minute = 0) => hour * 60 + minute

function task(id: string, overrides: Partial<Task> = {}): Task {
  return { id, title: id, time: '—', done: false, plannedFor: TODAY, ...overrides }
}

describe('planDay', () => {
  it('从当前时刻开始按顺序排入', () => {
    const plan = planDay(
      [task('a', { estimateMinutes: 60 }), task('b', { estimateMinutes: 30 })],
      TODAY,
      at(10)
    )

    expect(plan.blocks).toEqual([
      { taskId: 'a', start: at(10), end: at(11) },
      { taskId: 'b', start: at(11), end: at(11, 30) }
    ])
  })

  it('9 点前从 9 点开始', () => {
    const plan = planDay([task('a', { estimateMinutes: 60 })], TODAY, at(7))

    expect(plan.blocks[0]).toMatchObject({ start: at(9), end: at(10) })
  })

  it('避开已经定了时间的任务', () => {
    const plan = planDay(
      [task('anchor', { time: '10:00', estimateMinutes: 60 }), task('a', { estimateMinutes: 60 })],
      TODAY,
      at(9, 45)
    )

    expect(plan.blocks).toEqual([{ taskId: 'a', start: at(11), end: at(12) }])
  })

  it('先排截止更早的，再按优先级', () => {
    const plan = planDay(
      [
        task('later', { estimateMinutes: 30, dueDate: '2026-10-29' }),
        task('soon', { estimateMinutes: 30, dueDate: '2026-10-27' }),
        task('high', { estimateMinutes: 30, dueDate: '2026-10-29', priority: 1 })
      ],
      TODAY,
      at(9)
    )

    expect(plan.blocks.map((block) => block.taskId)).toEqual(['soon', 'high', 'later'])
  })

  it('未估时的任务进入 unplaced', () => {
    const plan = planDay([task('a')], TODAY, at(9))

    expect(plan.blocks).toEqual([])
    expect(plan.unplaced).toEqual([{ taskId: 'a', reason: 'no-estimate' }])
  })

  it('放不下时标记 no-room', () => {
    const plan = planDay([task('a', { estimateMinutes: 120 })], TODAY, at(21))

    expect(plan.unplaced).toEqual([{ taskId: 'a', reason: 'no-room' }])
  })

  it('只处理计划在今天且未完成的任务', () => {
    const plan = planDay(
      [
        task('other-day', { plannedFor: '2026-10-28', estimateMinutes: 30 }),
        task('done', { done: true, estimateMinutes: 30 }),
        task('here', { estimateMinutes: 30 })
      ],
      TODAY,
      at(9)
    )

    expect(plan.blocks.map((block) => block.taskId)).toEqual(['here'])
  })

  it('开始时间按 15 分钟对齐', () => {
    const plan = planDay([task('a', { estimateMinutes: 30 })], TODAY, at(9, 7))

    expect(plan.blocks[0].start).toBe(at(9, 15))
  })
})
