import { describe, expect, it } from 'vitest'
import { ROW_HEIGHT, computeWindow } from '../components/NoteList'

describe('computeWindow', () => {
  it('顶部时从 0 开始，并按可视高度限制渲染数量', () => {
    const range = computeWindow(0, 740, 10_000)
    expect(range.start).toBe(0)
    expect(range.offset).toBe(0)
    expect(range.totalHeight).toBe(10_000 * ROW_HEIGHT)
    expect(range.end).toBeLessThan(30)
  })

  it('滚动后只渲染窗口内的行', () => {
    const range = computeWindow(ROW_HEIGHT * 500, 740, 10_000)
    expect(range.start).toBeGreaterThan(480)
    expect(range.end - range.start).toBeLessThan(30)
    expect(range.offset).toBe(range.start * ROW_HEIGHT)
  })

  it('末尾不越界', () => {
    const range = computeWindow(ROW_HEIGHT * 9_990, 740, 10_000)
    expect(range.end).toBe(10_000)
  })

  it('空列表返回零范围', () => {
    expect(computeWindow(0, 740, 0)).toEqual({ start: 0, end: 0, offset: 0, totalHeight: 0 })
  })

  it('窗口大小与总数无关，保持常量级', () => {
    const small = computeWindow(0, 740, 100)
    const huge = computeWindow(0, 740, 100_000)
    expect(huge.end - huge.start).toBe(small.end - small.start)
  })
})
