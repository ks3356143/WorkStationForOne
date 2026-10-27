import { describe, expect, it } from 'vitest'
import {
  formatDateLabel,
  formatLongDate,
  formatMonthTitle,
  formatTime,
  monthGrid,
  nextMonday,
  parseMonth,
  parseTime,
  shiftMonth,
  snapMinute,
  weekdayIndex,
  weekdayLabel
} from './pickers'

const TODAY = '2026-10-27'

describe('shiftMonth', () => {
  it('跨年向前与向后归一', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 })
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 })
    expect(shiftMonth(2026, 10, 0)).toEqual({ year: 2026, month: 10 })
  })

  it('跨多年仍然正确', () => {
    expect(shiftMonth(2026, 10, 15)).toEqual({ year: 2028, month: 1 })
    expect(shiftMonth(2026, 3, -27)).toEqual({ year: 2023, month: 12 })
  })
})

describe('monthGrid', () => {
  it('始终 42 格，周一起始', () => {
    const grid = monthGrid({ year: 2026, month: 10 })
    expect(grid).toHaveLength(42)
    expect(weekdayIndex(grid[0].key)).toBe(0)
    expect(weekdayIndex(grid[41].key)).toBe(6)
  })

  it('2034 年 10 月 1 日是周日，网格首格是 9 月 25 日（周一）', () => {
    const grid = monthGrid({ year: 2034, month: 10 })
    expect(grid[0].key).toBe('2034-09-25')
    expect(grid[6].key).toBe('2034-10-01')
    expect(grid[6].inMonth).toBe(true)
  })

  it('当月天数与标记正确，前后补位标记为外月', () => {
    const grid = monthGrid({ year: 2026, month: 10 })
    const inMonth = grid.filter((cell) => cell.inMonth)
    expect(inMonth).toHaveLength(31)
    expect(inMonth[0]).toMatchObject({ key: '2026-10-01', day: 1 })
    expect(inMonth.at(-1)).toMatchObject({ key: '2026-10-31', day: 31 })
    expect(grid[0].inMonth).toBe(false)
  })

  it('闰年二月有 29 天', () => {
    const inMonth = monthGrid({ year: 2028, month: 2 }).filter((cell) => cell.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth.at(-1)?.key).toBe('2028-02-29')
  })
})

describe('日期与星期文案', () => {
  it('星期下标以周一为 0', () => {
    expect(weekdayIndex('2026-10-26')).toBe(0)
    expect(weekdayIndex('2026-10-27')).toBe(1)
    expect(weekdayIndex('2026-11-01')).toBe(6)
  })

  it('周几标签与月份标题', () => {
    expect(weekdayLabel(TODAY)).toBe('周二')
    expect(formatMonthTitle({ year: 2026, month: 10 })).toBe('2026年10月')
  })

  it('今天与明天优先展示相对词', () => {
    expect(formatDateLabel(TODAY, TODAY)).toBe('今天')
    expect(formatDateLabel('2026-10-28', TODAY)).toBe('明天')
    expect(formatDateLabel('2026-10-26', TODAY)).toBe('昨天')
    expect(formatDateLabel('2026-11-03', TODAY)).toBe('11月3日')
    expect(formatDateLabel('2027-01-09', TODAY)).toBe('2027年1月9日')
  })

  it('长日期带星期', () => {
    expect(formatLongDate(TODAY)).toBe('10月27日 周二')
  })

  it('parseMonth 容忍非法输入', () => {
    expect(parseMonth('2026-10-27')).toEqual({ year: 2026, month: 10 })
    expect(parseMonth('nope')).toEqual({ year: 0, month: 0 })
  })
})

describe('nextMonday', () => {
  it('跳过本周剩余天数，落在下一个周一', () => {
    // 2026-10-27 是周二
    expect(nextMonday(TODAY)).toBe('2026-11-02')
    // 周日 → 次日周一
    expect(nextMonday('2026-11-01')).toBe('2026-11-02')
  })

  it('今天就是周一时返回今天', () => {
    expect(nextMonday('2026-10-26')).toBe('2026-10-26')
  })
})

describe('时间', () => {
  it('解析与格式化', () => {
    expect(parseTime('09:05')).toEqual({ hour: 9, minute: 5 })
    expect(parseTime('23:59')).toEqual({ hour: 23, minute: 59 })
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('9:05')).toBeNull()
    expect(parseTime('—')).toBeNull()
    expect(formatTime(7, 5)).toBe('07:05')
  })

  it('分钟吸附到一刻钟，且不越界', () => {
    expect(snapMinute(0)).toBe(0)
    expect(snapMinute(7)).toBe(0)
    expect(snapMinute(8)).toBe(15)
    expect(snapMinute(38)).toBe(45)
    expect(snapMinute(59)).toBe(45)
  })
})
