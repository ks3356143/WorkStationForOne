import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { providerValidators } = await import('./providers')

describe('Provider 保存参数', () => {
  it('去掉名称、地址与模型首尾空白', () => {
    expect(
      providerValidators.assertSaveInput({
        name: '  DeepSeek  ',
        target: 'claude',
        wireApi: 'responses',
        baseUrl: '  http://127.0.0.1:23333  ',
        model: '  deepseek-v4-flash  ',
        apiKey: '  sk-test  '
      })
    ).toEqual({
      name: 'DeepSeek',
      target: 'claude',
      wireApi: 'responses',
      baseUrl: 'http://127.0.0.1:23333',
      model: 'deepseek-v4-flash',
      apiKey: 'sk-test'
    })
  })

  it('拒绝非 http(s) 地址、空字段与超长值', () => {
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'a',
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'file:///etc/passwd',
        model: 'm'
      })
    ).toThrow(TypeError)
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'a',
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'http://x',
        model: ' '
      })
    ).toThrow(TypeError)
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'x'.repeat(81),
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'http://x',
        model: 'm'
      })
    ).toThrow(TypeError)
  })
})

describe('Provider 目标与协议', () => {
  it('只接受 claude / codex 与 responses / chat', () => {
    expect(providerValidators.assertTarget('codex')).toBe('codex')
    expect(providerValidators.assertWireApi('chat')).toBe('chat')
    expect(() => providerValidators.assertTarget('other')).toThrow(TypeError)
    expect(() => providerValidators.assertWireApi('grpc')).toThrow(TypeError)
  })

  it('Codex Provider 拒绝已被 CLI 移除的 Chat 协议', () => {
    expect(() =>
      providerValidators.assertSaveInput({
        name: 'DeepSeek',
        target: 'codex',
        wireApi: 'chat',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        apiKey: 'sk-test'
      })
    ).toThrow('当前 Codex CLI 只支持 Responses 协议')
    expect(
      providerValidators.assertSaveInput({
        name: 'DeepSeek',
        target: 'codex',
        wireApi: 'responses',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash',
        apiKey: 'sk-test'
      })
    ).toMatchObject({ target: 'codex', wireApi: 'responses' })
  })
})

describe('Provider 模型列表参数', () => {
  it('不需要模型字段，保留 id 与临时 Key', () => {
    expect(
      providerValidators.assertModelsInput({
        id: 'provider-1',
        target: 'codex',
        wireApi: 'responses',
        baseUrl: ' https://api.deepseek.com ',
        apiKey: ' sk-test '
      })
    ).toEqual({
      id: 'provider-1',
      target: 'codex',
      wireApi: 'responses',
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test'
    })
  })

  it('拒绝 Codex + Chat、非法地址与空 Base URL', () => {
    expect(() =>
      providerValidators.assertModelsInput({
        target: 'codex',
        wireApi: 'chat',
        baseUrl: 'https://api.deepseek.com'
      })
    ).toThrow('当前 Codex CLI 只支持 Responses 协议')
    expect(() =>
      providerValidators.assertModelsInput({
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'file:///tmp/key'
      })
    ).toThrow(TypeError)
    expect(() =>
      providerValidators.assertModelsInput({
        target: 'claude',
        wireApi: 'responses',
        baseUrl: '   '
      })
    ).toThrow(TypeError)
  })
})

describe('Provider 测试连接参数', () => {
  it('不需要名称，保留 id 与临时 Key 并去掉首尾空白', () => {
    expect(
      providerValidators.assertTestInput({
        id: 'provider-1',
        target: 'codex',
        wireApi: 'responses',
        baseUrl: ' https://api.deepseek.com ',
        model: ' deepseek-flash ',
        apiKey: ' sk-test '
      })
    ).toEqual({
      id: 'provider-1',
      target: 'codex',
      wireApi: 'responses',
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'sk-test'
    })
  })

  it('拒绝 Codex + Chat 与非法地址', () => {
    expect(() =>
      providerValidators.assertTestInput({
        target: 'codex',
        wireApi: 'chat',
        baseUrl: 'https://api.deepseek.com',
        model: 'deepseek-flash'
      })
    ).toThrow('当前 Codex CLI 只支持 Responses 协议')
    expect(() =>
      providerValidators.assertTestInput({
        target: 'claude',
        wireApi: 'responses',
        baseUrl: 'file:///tmp/key',
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
