import { describe, expect, it } from 'vitest'
import {
  assembleBudgeted,
  clampSystemPrefix,
  compactTurns,
  SYSTEM_PREFIX_MAX,
  type ContextBlock
} from './context-budget'

const block = (label: string, text: string, priority: number): ContextBlock => ({
  label,
  text,
  priority
})

describe('assembleBudgeted', () => {
  it('按优先级装配并带来源标签', () => {
    const { text, dropped } = assembleBudgeted(
      [
        block('files', 'F'.repeat(10), 2),
        block('digest', 'D'.repeat(10), 0),
        block('memory', 'M'.repeat(10), 1)
      ],
      1000
    )
    expect(dropped).toEqual([])
    expect(text.indexOf('digest')).toBeLessThan(text.indexOf('memory'))
    expect(text.indexOf('memory')).toBeLessThan(text.indexOf('files'))
    expect(text).toContain('D'.repeat(10))
  })

  it('超预算时先丢低优先级，保留高优先级', () => {
    const { text, dropped } = assembleBudgeted(
      [
        block('digest', 'D'.repeat(50), 0),
        block('memory', 'M'.repeat(50), 1),
        block('files', 'F'.repeat(50), 2)
      ],
      120
    )
    expect(text).toContain('D'.repeat(50))
    expect(dropped).toContain('files')
  })

  it('单块超预算时截断并标记', () => {
    const { text } = assembleBudgeted([block('memory', 'M'.repeat(500), 0)], 100)
    expect(text).toContain('已截断')
    expect(text.length).toBeLessThan(500)
  })

  it('空块返回空串', () => {
    expect(assembleBudgeted([], 100).text).toBe('')
  })
})

describe('clampSystemPrefix', () => {
  it('短前缀原样返回', () => {
    expect(clampSystemPrefix('短')).toBe('短')
  })

  it('超长前缀截断并标记，长度不超上限', () => {
    const out = clampSystemPrefix('x'.repeat(SYSTEM_PREFIX_MAX + 500))
    expect(out.length).toBeLessThanOrEqual(SYSTEM_PREFIX_MAX)
    expect(out).toContain('已截断')
  })
})

describe('compactTurns', () => {
  const turns = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      text: `第${i}条内容`.repeat(20)
    }))

  it('短线程不压缩', () => {
    expect(compactTurns(turns(4))).toBe('')
  })

  it('长线程保留首条意图与最近若干条', () => {
    const digest = compactTurns(turns(20), 4)
    expect(digest).toContain('第0条')
    expect(digest).toContain('第19条')
    expect(digest).toContain('省略')
    expect(digest.length).toBeLessThan(4000)
  })

  it('空线程返回空串', () => {
    expect(compactTurns([])).toBe('')
  })
})
