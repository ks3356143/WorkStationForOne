import { describe, expect, it } from 'vitest'
import { minutesFromRatio, scopeDropPatch, timeFromRatio } from './dnd'

const TODAY = '2026-10-27'

describe('scopeDropPatch', () => {
  it('今天与即将到来分别把截止日期设为今天和明天', () => {
    expect(scopeDropPatch('today', TODAY)).toEqual({ dueDate: TODAY })
    expect(scopeDropPatch('upcoming', TODAY)).toEqual({ dueDate: '2026-10-28' })
  })

  it('收集箱清空清单，自定义清单写入清单名', () => {
    expect(scopeDropPatch('inbox', TODAY)).toEqual({ list: null })
    expect(scopeDropPatch('list:工作', TODAY)).toEqual({ list: '工作' })
  })

  it('全部任务与已完成不是有效投放目标', () => {
    expect(scopeDropPatch('all', TODAY)).toBeNull()
    expect(scopeDropPatch('done', TODAY)).toBeNull()
  })
})

describe('minutesFromRatio', () => {
  it('把时间轴比例映射到 09:00–22:00', () => {
    expect(minutesFromRatio(0)).toBe(9 * 60)
    expect(minutesFromRatio(0.5)).toBe(15 * 60 + 30)
    expect(minutesFromRatio(1)).toBe(22 * 60)
  })

  it('按 15 分钟对齐并夹在窗口内', () => {
    expect(minutesFromRatio(0.5005)).toBe(15 * 60 + 30)
    expect(minutesFromRatio(-1)).toBe(9 * 60)
    expect(minutesFromRatio(2)).toBe(22 * 60)
  })
})

describe('timeFromRatio', () => {
  it('输出 HH:MM', () => {
    expect(timeFromRatio(0)).toBe('09:00')
    expect(timeFromRatio(0.5)).toBe('15:30')
    expect(timeFromRatio(1)).toBe('22:00')
  })
})
