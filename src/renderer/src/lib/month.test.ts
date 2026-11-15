import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { dayLoad, groupTasksByMonth, monthGrid, monthLabel, shiftMonth } from './month'

function task(partial: Partial<Task> & { id: string }): Task {
  return { title: partial.id, done: false, priority: 0, time: '—', ...partial } as Task
}

describe('monthGrid', () => {
  it('固定 42 格且周一起始', () => {
    const cells = monthGrid(2026, 11)
    expect(cells).toHaveLength(42)
    expect(new Date(cells[0].day).getDay()).toBe(1)
  })
  it('当月格数等于该月天数', () => {
    expect(monthGrid(2026, 11).filter((cell) => cell.inMonth)).toHaveLength(30)
    expect(monthGrid(2026, 2).filter((cell) => cell.inMonth)).toHaveLength(28)
    expect(monthGrid(2024, 2).filter((cell) => cell.inMonth)).toHaveLength(29)
  })
  it('首格不晚于当月 1 号且含 1 号', () => {
    const cells = monthGrid(2026, 11)
    expect(cells[0].day <= '2026-11-01').toBe(true)
    expect(cells.some((cell) => cell.day === '2026-11-01' && cell.inMonth)).toBe(true)
  })
})

describe('groupTasksByMonth', () => {
  it('按计划日优先归组，子任务与越界任务不进入', () => {
    const cells = monthGrid(2026, 11)
    const tasks = [
      task({ id: 'a', plannedFor: '2026-11-05' }),
      task({ id: 'b', dueDate: '2026-11-05' }),
      task({ id: 'c', plannedFor: '2026-11-20', parentId: 'a' }),
      task({ id: 'd', plannedFor: '2026-12-20' }),
      task({ id: 'e' })
    ]
    const groups = groupTasksByMonth(tasks, cells)
    const nov5 = groups.find((group) => group.day === '2026-11-05')
    expect(nov5?.tasks.map((item) => item.id)).toEqual(['a', 'b'])
    expect(groups.every((group) => !group.tasks.some((item) => item.id === 'c'))).toBe(true)
    expect(groups.every((group) => !group.tasks.some((item) => item.id === 'd'))).toBe(true)
  })
})

describe('dayLoad', () => {
  it('按任务数分档 0–4', () => {
    expect(dayLoad(0)).toBe(0)
    expect(dayLoad(1)).toBe(1)
    expect(dayLoad(2)).toBe(1)
    expect(dayLoad(3)).toBe(2)
    expect(dayLoad(4)).toBe(2)
    expect(dayLoad(5)).toBe(3)
    expect(dayLoad(6)).toBe(3)
    expect(dayLoad(7)).toBe(4)
  })
})

describe('shiftMonth / monthLabel', () => {
  it('跨年进退位', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2026, month: 12 })
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 11, 0)).toEqual({ year: 2026, month: 11 })
  })
  it('中文月份标签', () => {
    expect(monthLabel(2026, 11)).toBe('2026 年 11 月')
  })
})
