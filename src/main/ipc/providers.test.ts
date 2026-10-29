import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { providerValidators } = await import('./providers')

describe('Provider 保存参数', () => {
  it('去掉名称、地址与模型首尾空白', () => {
    expect(
      providerValidators.assertSaveInput({
        name: '  DeepSeek  ',
        baseUrl: '  http://127.0.0.1:23333  ',
        model: '  deepseek-v4-flash  ',
        apiKey: '  sk-test  '
      })
    ).toEqual({
      name: 'DeepSeek',
      baseUrl: 'http://127.0.0.1:23333',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-test'
    })
  })

  it('拒绝非 http(s) 地址、空字段与超长值', () => {
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'a',
        baseUrl: 'file:///etc/passwd',
        model: 'm'
      })
    ).toThrow(TypeError)
    expect(() =>
      providerValidators.assertSaveInput({ name: 'a', baseUrl: 'http://x', model: ' ' })
    ).toThrow(TypeError)
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'x'.repeat(81),
        baseUrl: 'http://x',
        model: 'm'
      })
    ).toThrow(TypeError)
  })
})

describe('Provider 激活参数', () => {
  it('接受 id 与 null', () => {
    expect(providerValidators.assertActiveId('provider-1')).toBe('provider-1')
    expect(providerValidators.assertActiveId(null)).toBeNull()
  })

  it('拒绝空 id 与其它类型', () => {
    expect(() => providerValidators.assertActiveId('')).toThrow(TypeError)
    expect(() => providerValidators.assertActiveId(1)).toThrow(TypeError)
  })
})
