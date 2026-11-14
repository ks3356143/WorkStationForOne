import { describe, expect, it } from 'vitest'
import { breathState } from './breathing'

describe('breathState', () => {
  it('起点为吸气最小缩放', () => {
    const s = breathState(0)
    expect(s.phase).toBe('inhale')
    expect(s.label).toBe('吸气')
    expect(s.scale).toBeCloseTo(0.6, 5)
  })
  it('吸气中点缩放 0.8', () => {
    expect(breathState(2000).scale).toBeCloseTo(0.8, 5)
  })
  it('4s 进入屏息满缩放', () => {
    const s = breathState(4000)
    expect(s.phase).toBe('hold')
    expect(s.label).toBe('屏息')
    expect(s.scale).toBe(1)
  })
  it('6s 进入呼气', () => {
    const s = breathState(6000)
    expect(s.phase).toBe('exhale')
    expect(s.label).toBe('呼气')
    expect(s.scale).toBeCloseTo(1, 5)
  })
  it('10s 循环回到吸气', () => {
    const s = breathState(10000)
    expect(s.phase).toBe('inhale')
    expect(s.scale).toBeCloseTo(0.6, 5)
  })
  it('负值取模安全', () => {
    expect(breathState(-1000).phase).toBe('exhale')
  })
})
