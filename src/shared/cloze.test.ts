import { describe, expect, it } from 'vitest'
import {
  clozeFrontText,
  clozePlainText,
  clozePreview,
  hasCloze,
  parseCloze,
  validateCloze
} from './cloze'

describe('parseCloze', () => {
  it('识别单个挖空', () => {
    const result = parseCloze('特征值三性质：{{c1::和、积、特征多项式}}')
    expect(result.ranges).toHaveLength(1)
    expect(result.ranges[0]).toEqual({
      start: 13,
      end: 22,
      markerStart: 7,
      markerEnd: 24,
      index: 1,
      answer: '和、积、特征多项式'
    })
  })

  it('识别多个不同序号的挖空', () => {
    const result = parseCloze('{{c1::TCP}} 是面向连接的，{{c2::UDP}} 不是')
    expect(result.ranges.map((range) => range.answer)).toEqual(['TCP', 'UDP'])
    expect(result.ranges.map((range) => range.index)).toEqual([1, 2])
  })

  it('同序号多个挖空一起隐藏', () => {
    const result = parseCloze('{{c1::幂等}} 与 {{c1::幂等}} 是同组')
    expect(result.ranges.map((range) => range.index)).toEqual([1, 1])
  })

  it('没有挖空时返回空区间', () => {
    expect(parseCloze('普通的卡片正面').ranges).toEqual([])
    expect(hasCloze('普通的卡片正面')).toBe(false)
  })

  it('未闭合的花括号不吞掉整段文本', () => {
    const result = parseCloze('前半 {{c1::没有闭合')
    expect(result.ranges).toEqual([])
    expect(hasCloze('前半 {{c1::没有闭合')).toBe(false)
  })

  it('空的挖空内容被忽略', () => {
    expect(parseCloze('前 {{c1::}} 后').ranges).toEqual([])
    expect(parseCloze('前 {{c1::   }} 后').ranges).toEqual([])
  })

  it('区间下标能映射回原始字符串', () => {
    const text = '先 {{c1::甲}} 后 {{c2::乙}}'
    const result = parseCloze(text)
    for (const range of result.ranges) {
      expect(text.slice(range.start, range.end)).toBe(range.answer)
    }
  })
})

describe('clozeFrontText', () => {
  it('隐藏全部挖空，保留占位标记', () => {
    expect(clozeFrontText('{{c1::TCP}} 面向连接')).toBe('[1] 面向连接')
  })

  it('多个挖空按序号占位', () => {
    expect(clozeFrontText('{{c1::A}} 与 {{c2::B}}')).toBe('[1] 与 [2]')
  })

  it('没有挖空时原样返回', () => {
    expect(clozeFrontText('没有挖空的正面')).toBe('没有挖空的正面')
  })
})

describe('clozePlainText', () => {
  it('去掉标记但保留答案', () => {
    expect(clozePlainText('{{c1::TCP}} 面向连接')).toBe('TCP 面向连接')
  })

  it('没有挖空时原样返回', () => {
    expect(clozePlainText('普通文本')).toBe('普通文本')
  })

  it('未闭合的花括号原样保留', () => {
    expect(clozePlainText('前 {{c1::没闭合')).toBe('前 {{c1::没闭合')
  })
})

describe('clozePreview', () => {
  it('正面取隐藏后的文本', () => {
    expect(clozePreview('{{c1::TCP}} 是面向连接的')).toBe('[1] 是面向连接的')
  })
})

describe('validateCloze', () => {
  it('没有挖空时报错', () => {
    expect(validateCloze('普通文本')).toBe('至少要有一处 {{c1::挖空}}')
  })

  it('有挖空时通过', () => {
    expect(validateCloze('{{c1::TCP}} 面向连接')).toBeNull()
  })

  it('挖空内容为空时报错', () => {
    expect(validateCloze('{{c1::}}')).toBe('挖空内容不能为空')
  })

  it('超长文本被拦下', () => {
    const long = `{{c1::${'甲'.repeat(2001)}}}`
    expect(validateCloze(long)).toBe('卡片内容过长')
  })
})
