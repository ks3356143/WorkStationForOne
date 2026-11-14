import { describe, expect, it } from 'vitest'
import { accentTokens, hexToRgb, rotateHue } from './accent'

describe('hexToRgb', () => {
  it('解析 6 位 hex', () => {
    expect(hexToRgb('#ff0000')).toEqual([255, 0, 0])
    expect(hexToRgb('#a78bfa')).toEqual([167, 139, 250])
  })
  it('非法输入返回 null', () => {
    expect(hexToRgb('zzz')).toBeNull()
    expect(hexToRgb('#fff')).toBeNull()
    expect(hexToRgb('')).toBeNull()
  })
})

describe('rotateHue', () => {
  it('红转 120° 得绿', () => {
    expect(rotateHue([255, 0, 0], 120)).toEqual([0, 255, 0])
  })
  it('转 360° 回到自身（容差 1）', () => {
    const back = rotateHue([167, 139, 250], 360)
    ;[167, 139, 250].forEach((v, i) => {
      expect(Math.abs(back[i] - v)).toBeLessThanOrEqual(1)
    })
  })
  it('灰色（无饱和）旋转不变', () => {
    expect(rotateHue([128, 128, 128], 90)).toEqual([128, 128, 128])
  })
})

describe('accentTokens', () => {
  it('主色为原色，副色为色相旋转', () => {
    const t = accentTokens('#ff0000')
    expect(t?.ac).toBe('255 0 0')
    expect(t?.ac2).toBe('0 255 0')
  })
  it('非法 hex 返回 null', () => {
    expect(accentTokens('nope')).toBeNull()
  })
})
