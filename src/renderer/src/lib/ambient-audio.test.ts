import { describe, expect, it } from 'vitest'
import { fillNoiseBuffer } from './ambient-audio'

describe('fillNoiseBuffer', () => {
  it('白噪音：按 random 线性映射到 [-1,1]', () => {
    const data = new Float32Array(4)
    fillNoiseBuffer(data, 'white', () => 0.75)
    expect(Array.from(data)).toEqual([0.5, 0.5, 0.5, 0.5])
  })

  it('雨声（棕噪音）：有界且非零', () => {
    const data = new Float32Array(2000)
    fillNoiseBuffer(data, 'rain', () => 0.75)
    let nonZero = 0
    for (const v of data) {
      expect(v).toBeGreaterThanOrEqual(-1)
      expect(v).toBeLessThanOrEqual(1)
      if (v !== 0) nonZero++
    }
    expect(nonZero).toBeGreaterThan(1000)
  })

  it('雨声比白噪音更平滑（相邻差更小）', () => {
    const white = new Float32Array(4000)
    const rain = new Float32Array(4000)
    let seed = 1
    const rng = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }
    fillNoiseBuffer(white, 'white', rng)
    seed = 1
    fillNoiseBuffer(rain, 'rain', rng)
    const roughness = (a: Float32Array) => {
      let sum = 0
      for (let i = 1; i < a.length; i++) sum += Math.abs(a[i] - a[i - 1])
      return sum / a.length
    }
    expect(roughness(rain)).toBeLessThan(roughness(white))
  })
})
