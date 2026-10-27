import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { completionHeatmap, heatLevel } from './heatmap'

const TODAY = '2026-10-27'

function done(id: string, at?: Date): Task {
  return {
    id,
    title: id,
    time: '—',
    done: true,
    ...(at ? { completedAt: at.getTime() } : {})
  }
}

function open(id: string): Task {
  return { id, title: id, time: '—', done: false }
}

describe('completionHeatmap', () => {
  it('按周切分列，周一起始，最后一周只到今天', () => {
    const heatmap = completionHeatmap([], TODAY, 12)

    expect(heatmap.start).toBe('2026-08-10')
    expect(heatmap.weeks).toHaveLength(12)
    expect(heatmap.weeks[0]?.days[0]?.key).toBe('2026-08-10')
    const lastWeek = heatmap.weeks.at(-1)!
    expect(lastWeek.days[1]?.key).toBe(TODAY)
    expect(lastWeek.days[2]).toBeNull()
    expect(lastWeek.days[6]).toBeNull()
  })

  it('把完成时间折算成本地日期并计数', () => {
    const heatmap = completionHeatmap(
      [
        done('a', new Date(2026, 9, 27, 9, 0)),
        done('b', new Date(2026, 9, 27, 21, 30)),
        done('c', new Date(2026, 9, 26, 23, 59))
      ],
      TODAY,
      12
    )
    const days = heatmap.weeks.flatMap((week) => week.days)
    const today = days.find((day) => day?.key === TODAY)
    const yesterday = days.find((day) => day?.key === '2026-10-26')

    expect(today?.count).toBe(2)
    expect(yesterday?.count).toBe(1)
    expect(heatmap.total).toBe(3)
    expect(heatmap.max).toBe(2)
    expect(heatmap.activeDays).toBe(2)
  })

  it('忽略未完成、没有完成时间与窗口之外的任务', () => {
    const heatmap = completionHeatmap(
      [
        open('open'),
        done('unknown'),
        done('old', new Date(2026, 0, 1)),
        done('recent', new Date(2026, 9, 20))
      ],
      TODAY,
      12
    )

    expect(heatmap.total).toBe(1)
  })

  it('窗口按周数伸缩', () => {
    const wide = completionHeatmap([done('a', new Date(2026, 1, 1))], TODAY, 40)

    expect(wide.total).toBe(1)
    expect(wide.start).toBe('2026-01-26')
  })
})

describe('heatLevel', () => {
  it('按完成数分四档', () => {
    expect(heatLevel(0)).toBe(0)
    expect(heatLevel(1)).toBe(1)
    expect(heatLevel(2)).toBe(2)
    expect(heatLevel(3)).toBe(3)
    expect(heatLevel(5)).toBe(4)
  })
})
