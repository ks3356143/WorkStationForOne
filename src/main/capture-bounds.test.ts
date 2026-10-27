import { describe, expect, it } from 'vitest'
import { captureWindowBounds } from './capture-bounds'

const SIZE = { width: 560, height: 168 }

describe('captureWindowBounds', () => {
  it('在光标所在显示器的上半部分水平居中', () => {
    const bounds = captureWindowBounds({ x: 0, y: 0, width: 1920, height: 1080 }, SIZE)

    expect(bounds).toEqual({ x: 680, y: 194, width: 560, height: 168 })
  })

  it('工作区比窗口小时收缩并贴住左上角', () => {
    const bounds = captureWindowBounds({ x: 0, y: 0, width: 480, height: 200 }, SIZE)

    expect(bounds).toEqual({ x: 0, y: 32, width: 480, height: 168 })
  })

  it('多显示器时按工作区原点偏移', () => {
    const bounds = captureWindowBounds({ x: 1920, y: 0, width: 1920, height: 1080 }, SIZE)

    expect(bounds.x).toBe(1920 + 680)
    expect(bounds.y).toBe(194)
  })
})
