import { describe, expect, it } from 'vitest'
import { MEM_STARTERS, MEM_SUBJECTS } from './mem-starters'

describe('MEM 科目', () => {
  it('初试四科固定为英语二与管综三科', () => {
    expect([...MEM_SUBJECTS]).toEqual(['英语二', '管综数学', '管综逻辑', '管综写作'])
  })
})

describe('MEM 起步卡', () => {
  it('共 8 张，覆盖管综三科，不再包含互联网', () => {
    expect(MEM_STARTERS).toHaveLength(8)
    const subjects = new Set(MEM_STARTERS.map((card) => card.subject))
    expect(subjects).toEqual(new Set(['管综数学', '管综逻辑', '管综写作']))
  })

  it('id、正面与背面都非空且唯一', () => {
    expect(new Set(MEM_STARTERS.map((card) => card.id)).size).toBe(8)
    expect(new Set(MEM_STARTERS.map((card) => card.title)).size).toBe(8)
    for (const card of MEM_STARTERS) {
      expect(card.title.trim().length).toBeGreaterThan(0)
      expect(card.notes.trim().length).toBeGreaterThan(0)
      expect(card.dayOffset).toBeGreaterThanOrEqual(0)
      expect(card.dayOffset).toBeLessThanOrEqual(14)
    }
  })
})
