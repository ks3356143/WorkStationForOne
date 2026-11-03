import { describe, expect, it } from 'vitest'
import { createInitialData } from '../data/mock'
import type { Task } from '../types'
import { groupTasksByWeek, shiftWeek, startOfWeekKey, weekBacklog, weekDayKeys } from './week'

const base = createInitialData().tasks[0]!

function task(id: string, extra: Partial<Task> = {}): Task {
  return {
    ...base,
    id,
    title: id,
    time: '—',
    done: false,
    dueDate: undefined,
    plannedFor: undefined,
    parentId: undefined,
    priority: 0,
    ...extra
  }
}

describe('week helpers', () => {
  it('周一为周起点，周日也回到同一周', () => {
    expect(startOfWeekKey('2026-11-02')).toBe('2026-11-02')
    expect(startOfWeekKey('2026-11-04')).toBe('2026-11-02')
    expect(startOfWeekKey('2026-11-08')).toBe('2026-11-02')
    expect(weekDayKeys('2026-11-02')).toEqual([
      '2026-11-02',
      '2026-11-03',
      '2026-11-04',
      '2026-11-05',
      '2026-11-06',
      '2026-11-07',
      '2026-11-08'
    ])
    expect(shiftWeek('2026-11-02', 1)).toBe('2026-11-09')
    expect(shiftWeek('2026-11-02', -1)).toBe('2026-10-26')
  })

  it('计划日期优先于截止日期，并按时间与优先级排序', () => {
    const groups = groupTasksByWeek(
      [
        task('晚', { plannedFor: '2026-11-04', time: '18:00' }),
        task('早', { dueDate: '2026-11-04', time: '09:00' }),
        task('高', { plannedFor: '2026-11-04', time: '09:00', priority: 2 }),
        task('计划优先', { plannedFor: '2026-11-05', dueDate: '2026-11-04' }),
        task('下周', { dueDate: '2026-11-12' })
      ],
      '2026-11-02'
    )
    const wednesday = groups.find((group) => group.date === '2026-11-04')
    expect(wednesday?.tasks.map((item) => item.id)).toEqual(['高', '早', '晚'])
    expect(
      groups.find((group) => group.date === '2026-11-05')?.tasks.map((item) => item.id)
    ).toEqual(['计划优先'])
    expect(groups.find((group) => group.date === '2026-11-03')?.tasks).toEqual([])
  })

  it('跳过子任务与没有日期的任务', () => {
    const groups = groupTasksByWeek(
      [task('子', { plannedFor: '2026-11-04', parentId: 'p' }), task('无日期')],
      '2026-11-02'
    )
    expect(groups.flatMap((group) => group.tasks)).toEqual([])
  })

  it('未排期只收没有日期、未完成且非子任务的任务', () => {
    expect(
      weekBacklog([
        task('无日期'),
        task('有日期', { dueDate: '2026-11-04' }),
        task('完成', { done: true }),
        task('子任务', { parentId: 'p' })
      ]).map((item) => item.id)
    ).toEqual(['无日期'])
  })
})
