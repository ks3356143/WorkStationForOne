import { describe, expect, it } from 'vitest'
import { shouldUseViewTransition } from './view-transition'

describe('shouldUseViewTransition', () => {
  it('API 可用且未降级时启用', () => {
    expect(shouldUseViewTransition({ hasApi: true, reducedMotion: false, motionOff: false })).toBe(
      true
    )
  })

  it('没有 View Transitions API 时退回直接更新', () => {
    expect(shouldUseViewTransition({ hasApi: false, reducedMotion: false, motionOff: false })).toBe(
      false
    )
  })

  it('系统减少动效或应用内关闭动效时不使用', () => {
    expect(shouldUseViewTransition({ hasApi: true, reducedMotion: true, motionOff: false })).toBe(
      false
    )
    expect(shouldUseViewTransition({ hasApi: true, reducedMotion: false, motionOff: true })).toBe(
      false
    )
  })
})
