import { describe, expect, it } from 'vitest'
import { seedParticles } from './dust'

describe('seedParticles', () => {
  it('生成指定数量粒子', () => {
    expect(seedParticles(50, 800, 600)).toHaveLength(50)
  })
  it('坐标在画布范围内、半径与透明度为正', () => {
    const particles = seedParticles(200, 800, 600)
    for (const p of particles) {
      expect(p.x).toBeGreaterThanOrEqual(0)
      expect(p.x).toBeLessThanOrEqual(800)
      expect(p.y).toBeGreaterThanOrEqual(0)
      expect(p.y).toBeLessThanOrEqual(600)
      expect(p.r).toBeGreaterThan(0)
      expect(p.a).toBeGreaterThan(0)
      expect(p.a).toBeLessThanOrEqual(0.4)
    }
  })
  it('注入 random 可复现', () => {
    const a = seedParticles(5, 100, 100, () => 0.5)
    const b = seedParticles(5, 100, 100, () => 0.5)
    expect(a).toEqual(b)
  })
  it('数量夹住上限', () => {
    expect(seedParticles(9999, 100, 100).length).toBeLessThanOrEqual(120)
  })
})
