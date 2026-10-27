import { describe, expect, it } from 'vitest'
import type { LearningItem } from '../types'
import {
  dueQueue,
  estimatedMinutes,
  filterItems,
  isDue,
  learningDueLabel,
  learningSubjects,
  subjectBreakdown,
  subjectStacks,
  tallyLine
} from './learning'

function card(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: 'l1',
    subject: '英语二',
    title: 'analyze',
    source: '',
    notes: '',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: '2026-10-27',
    active: true,
    ...overrides
  }
}

const today = '2026-10-27'

describe('dueQueue', () => {
  it('只收今天与逾期的启用卡片', () => {
    const items = [
      card({ id: 'due-today', nextReviewOn: today }),
      card({ id: 'overdue', nextReviewOn: '2026-10-20' }),
      card({ id: 'future', nextReviewOn: '2026-10-30' }),
      card({ id: 'inactive', nextReviewOn: '2026-10-01', active: false })
    ]

    expect(dueQueue(items, today).map((item) => item.id)).toEqual(['overdue', 'due-today'])
  })

  it('同一天里 ease 低的排前面', () => {
    const items = [
      card({ id: 'easy', ease: 2.8 }),
      card({ id: 'hard', ease: 1.6 }),
      card({ id: 'mid', ease: 2.2 })
    ]

    expect(dueQueue(items, today).map((item) => item.id)).toEqual(['hard', 'mid', 'easy'])
  })

  it('日期优先于难度', () => {
    const items = [
      card({ id: 'today-hard', ease: 1.3 }),
      card({ id: 'overdue-easy', nextReviewOn: '2026-10-26', ease: 3 })
    ]

    expect(dueQueue(items, today).map((item) => item.id)).toEqual(['overdue-easy', 'today-hard'])
  })

  it('上限 50 张', () => {
    const items = Array.from({ length: 60 }, (_, index) => card({ id: `c${index}` }))
    expect(dueQueue(items, today)).toHaveLength(50)
  })

  it('不修改传入数组', () => {
    const items = [card({ id: 'b', ease: 2.8 }), card({ id: 'a', ease: 2.1 })]
    dueQueue(items, today)
    expect(items.map((item) => item.id)).toEqual(['b', 'a'])
  })
})

describe('estimatedMinutes', () => {
  it('每张 1.5 分钟向上取整', () => {
    expect(estimatedMinutes(0)).toBe(0)
    expect(estimatedMinutes(1)).toBe(2)
    expect(estimatedMinutes(7)).toBe(11)
    expect(estimatedMinutes(12)).toBe(18)
  })
})

describe('subjectBreakdown / subjectStacks', () => {
  const items = [
    card({ id: 'a1', subject: '英语二' }),
    card({ id: 'a2', subject: '英语二' }),
    card({ id: 'a3', subject: '英语二' }),
    card({ id: 'b1', subject: '互联网' }),
    card({ id: 'b2', subject: '互联网' }),
    card({ id: 'c1', subject: '政治' }),
    card({ id: 'd1', subject: '数学' })
  ]

  it('按张数降序、科目名次之', () => {
    expect(subjectBreakdown(items)).toEqual([
      { subject: '英语二', count: 3 },
      { subject: '互联网', count: 2 },
      { subject: '数学', count: 1 },
      { subject: '政治', count: 1 }
    ])
  })

  it('今日卡最多三堆，其余并成其他', () => {
    expect(subjectStacks(items, 3)).toEqual([
      { subject: '英语二', count: 3, share: 3 / 7 },
      { subject: '互联网', count: 2, share: 2 / 7 },
      { subject: '数学', count: 1, share: 1 / 7 },
      { subject: '其他', count: 1, share: 1 / 7 }
    ])
  })

  it('没有卡片时返回空', () => {
    expect(subjectStacks([])).toEqual([])
  })
})

describe('filterItems', () => {
  const items = [
    card({ id: 'a', title: 'analyze', source: '2021 Text 2', notes: '分析' }),
    card({ id: 'b', title: 'decline', notes: '下降' }),
    card({ id: 'c', title: 'DNS', subject: '互联网' }),
    card({ id: 'd', title: 'issue', active: false })
  ]

  it('全部只列启用卡片', () => {
    expect(filterItems(items, { kind: 'all' }, '').map((item) => item.id)).toEqual(['a', 'b', 'c'])
  })

  it('按科目收窄', () => {
    expect(
      filterItems(items, { kind: 'subject', subject: '互联网' }, '').map((item) => item.id)
    ).toEqual(['c'])
  })

  it('已停用只列停用卡片', () => {
    expect(filterItems(items, { kind: 'inactive' }, '').map((item) => item.id)).toEqual(['d'])
  })

  it('搜索匹配标题、来源与备注，大小写不敏感', () => {
    expect(filterItems(items, { kind: 'all' }, 'TEXT').map((item) => item.id)).toEqual(['a'])
    expect(filterItems(items, { kind: 'all' }, '下降').map((item) => item.id)).toEqual(['b'])
    expect(filterItems(items, { kind: 'all' }, 'dns').map((item) => item.id)).toEqual(['c'])
    expect(filterItems(items, { kind: 'all' }, '   ').map((item) => item.id)).toHaveLength(3)
  })

  it('搜索无结果返回空', () => {
    expect(filterItems(items, { kind: 'all' }, '不存在')).toEqual([])
  })

  it('结果按复习日升序', () => {
    const dated = [
      card({ id: 'late', nextReviewOn: '2026-11-05' }),
      card({ id: 'soon', nextReviewOn: '2026-10-28' })
    ]
    expect(filterItems(dated, { kind: 'all' }, '').map((item) => item.id)).toEqual(['soon', 'late'])
  })
})

describe('learningSubjects', () => {
  it('只统计启用卡片并按数量降序', () => {
    const items = [
      card({ id: 'a', subject: '英语二' }),
      card({ id: 'b', subject: '互联网' }),
      card({ id: 'c', subject: '互联网' }),
      card({ id: 'd', subject: '政治', active: false })
    ]

    expect(learningSubjects(items)).toEqual([
      { subject: '互联网', count: 2 },
      { subject: '英语二', count: 1 }
    ])
  })
})

describe('learningDueLabel', () => {
  it('今天、明天、逾期与具体日期', () => {
    expect(learningDueLabel(card({ nextReviewOn: today }), today)).toBe('今天')
    expect(learningDueLabel(card({ nextReviewOn: '2026-10-28' }), today)).toBe('明天')
    expect(learningDueLabel(card({ nextReviewOn: '2026-10-24' }), today)).toBe('逾期 · 10-24')
    expect(learningDueLabel(card({ nextReviewOn: '2026-11-03' }), today)).toBe('11-03')
    expect(learningDueLabel(card({ nextReviewOn: '2027-01-09' }), today)).toBe('2027-01-09')
  })
})

describe('isDue', () => {
  it('停用卡片永不到期', () => {
    expect(isDue(card({ nextReviewOn: '2026-10-01' }), today)).toBe(true)
    expect(isDue(card({ nextReviewOn: '2026-10-01', active: false }), today)).toBe(false)
    expect(isDue(card({ nextReviewOn: '2026-11-01' }), today)).toBe(false)
  })
})

describe('tallyLine', () => {
  it('汇总张数、重来次数与耗时', () => {
    const line = tallyLine({ reviewed: 12, again: 2, startedAt: Date.now() - 3 * 60_000 })
    expect(line).toBe('复习 12 张 · 重来 2 次 · 约 3 分钟')
  })
})
