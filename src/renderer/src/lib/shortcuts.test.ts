import { describe, expect, it } from 'vitest'
import { SHORTCUT_GROUPS, isTypingTarget } from './shortcuts'

describe('SHORTCUT_GROUPS', () => {
  it('每个分组都有标题和条目', () => {
    expect(SHORTCUT_GROUPS.length).toBeGreaterThan(0)
    for (const group of SHORTCUT_GROUPS) {
      expect(group.title.trim()).not.toBe('')
      expect(group.items.length).toBeGreaterThan(0)
    }
  })

  it('分组标题不重复', () => {
    const titles = SHORTCUT_GROUPS.map((group) => group.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  it('每个条目都有键位与说明，且没有空键', () => {
    for (const group of SHORTCUT_GROUPS) {
      for (const item of group.items) {
        expect(item.label.trim()).not.toBe('')
        expect(item.keys.length).toBeGreaterThan(0)
        for (const key of item.keys) expect(key.trim()).not.toBe('')
      }
    }
  })

  it('同一分组内不重复列出同一组键位', () => {
    for (const group of SHORTCUT_GROUPS) {
      const combos = group.items.map((item) => `${item.combine ?? 'plus'}:${item.keys.join('+')}`)
      expect(new Set(combos).size).toBe(combos.length)
    }
  })

  it('任选其一的键位显式标注 or，组合键默认按顺序', () => {
    const rating = SHORTCUT_GROUPS.flatMap((group) => group.items).find(
      (item) => item.keys.join('') === '1234'
    )
    expect(rating?.combine).toBe('or')
  })

  // 这组断言锁住「速查表不能漏掉主键位」，改键位时测试会先失败
  it('覆盖所有实际生效的主键位', () => {
    const combos = new Set(
      SHORTCUT_GROUPS.flatMap((group) =>
        group.items.map((item) => `${item.combine === 'or' ? 'or:' : ''}${item.keys.join('+')}`)
      )
    )
    for (const required of [
      'Ctrl+K',
      'Ctrl+N',
      'Ctrl+Shift+N',
      'Ctrl+Alt+Space',
      'Enter',
      'Ctrl+Enter',
      'Space',
      'or:1+2+3+4',
      'Esc',
      'Shift+Enter'
    ]) {
      expect(combos.has(required), `缺少键位 ${required}`).toBe(true)
    }
  })
})

describe('isTypingTarget', () => {
  it('没有目标或不是元素时不算输入场景', () => {
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({} as EventTarget)).toBe(false)
  })
})
