import { describe, expect, it } from 'vitest'
import { MEM_STARTERS, MEM_SUBJECTS } from '../../../../shared/mem-starters'
import { createSeedLearning } from './learning'

describe('createSeedLearning', () => {
  it('种子为 16 张英语二 + 8 张管综，共 24 张', () => {
    const cards = createSeedLearning()
    expect(cards).toHaveLength(24)
    expect(cards.filter((card) => card.subject === '英语二')).toHaveLength(16)
    expect(cards.filter((card) => card.subject.startsWith('管综'))).toHaveLength(8)
    expect(cards.some((card) => card.subject === '互联网')).toBe(false)
  })

  it('科目都在 MEM 四项内，id 与 MEM 起步卡一致', () => {
    const cards = createSeedLearning()
    const allowed = new Set<string>(MEM_SUBJECTS)
    expect(cards.every((card) => allowed.has(card.subject))).toBe(true)
    const ids = new Set(cards.map((card) => card.id))
    for (const starter of MEM_STARTERS) expect(ids.has(starter.id)).toBe(true)
  })

  it('全部是新卡且复习日不早于今天', () => {
    const cards = createSeedLearning()
    expect(cards.every((card) => card.repetitions === 0 && card.intervalDays === 0)).toBe(true)
    const today = new Date()
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect(cards.every((card) => card.nextReviewOn >= key)).toBe(true)
  })
})
