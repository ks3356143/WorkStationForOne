import { describe, expect, it } from 'vitest'
import { defaultSource, effectiveSource } from './runtime-source'

describe('CLI 生效源', () => {
  it('默认优先系统，系统缺失时落到托管', () => {
    expect(defaultSource({ systemAvailable: true, managedInstalled: true })).toBe('system')
    expect(defaultSource({ systemAvailable: false, managedInstalled: true })).toBe('managed')
    expect(defaultSource({ systemAvailable: true, managedInstalled: false })).toBe('system')
  })

  it('显式选择锁定该源，缺失时回退另一侧而不是失效', () => {
    const both = { systemAvailable: true, managedInstalled: true }
    expect(effectiveSource('managed', both)).toBe('managed')
    expect(effectiveSource('system', both)).toBe('system')
    expect(effectiveSource('managed', { systemAvailable: true, managedInstalled: false })).toBe(
      'system'
    )
    expect(effectiveSource('system', { systemAvailable: false, managedInstalled: true })).toBe(
      'managed'
    )
  })

  it('两侧都没有时返回 null，未显式选择时走默认规则', () => {
    expect(
      effectiveSource('system', { systemAvailable: false, managedInstalled: false })
    ).toBeNull()
    expect(effectiveSource(null, { systemAvailable: false, managedInstalled: true })).toBe(
      'managed'
    )
    expect(effectiveSource(undefined, { systemAvailable: true, managedInstalled: false })).toBe(
      'system'
    )
  })
})
