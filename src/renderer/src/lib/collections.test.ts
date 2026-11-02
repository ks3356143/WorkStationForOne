import { describe, expect, it } from 'vitest'
import { replaceById } from './collections'

describe('replaceById', () => {
  it('替换同 id 的记录并保留顺序', () => {
    const list = [
      { id: 'a', v: 1 },
      { id: 'b', v: 2 }
    ]
    expect(replaceById(list, { id: 'b', v: 9 })).toEqual([
      { id: 'a', v: 1 },
      { id: 'b', v: 9 }
    ])
  })

  it('找不到 id 时返回等值的新数组', () => {
    const list = [{ id: 'a', v: 1 }]
    const next = replaceById(list, { id: 'z', v: 0 })
    expect(next).toEqual(list)
    expect(next).not.toBe(list)
  })
})
