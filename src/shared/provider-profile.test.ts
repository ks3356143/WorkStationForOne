import { describe, expect, it } from 'vitest'
import { providerAuthScheme, providerEndpoint } from './provider-profile'

describe('Provider 鉴权方式推断', () => {
  it('官方 Anthropic 使用 x-api-key', () => {
    expect(providerAuthScheme('claude', 'https://api.anthropic.com')).toBe('api-key')
    expect(providerAuthScheme('claude', 'https://API.ANTHROPIC.COM/v1')).toBe('api-key')
  })

  it('第三方 Anthropic 兼容端点使用 Bearer', () => {
    expect(providerAuthScheme('claude', 'https://api.deepseek.com/anthropic')).toBe('bearer')
    expect(providerAuthScheme('claude', 'http://127.0.0.1:23334')).toBe('bearer')
  })

  it('Codex 无论地址都只走 Bearer', () => {
    expect(providerAuthScheme('codex', 'https://api.anthropic.com')).toBe('bearer')
    expect(providerAuthScheme('codex', 'https://api.deepseek.com')).toBe('bearer')
  })

  it('地址无法解析时回退 Bearer', () => {
    expect(providerAuthScheme('claude', '')).toBe('bearer')
    expect(providerAuthScheme('claude', 'not a url')).toBe('bearer')
  })
})

describe('Provider 请求端点', () => {
  it('Claude 拼接 /v1/messages，Codex 拼接 /responses', () => {
    expect(providerEndpoint('claude', 'https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1/messages'
    )
    expect(providerEndpoint('claude', 'https://api.deepseek.com/anthropic/')).toBe(
      'https://api.deepseek.com/anthropic/v1/messages'
    )
    expect(providerEndpoint('codex', 'https://api.deepseek.com')).toBe(
      'https://api.deepseek.com/responses'
    )
  })

  it('空地址返回空串，避免界面展示半截路径', () => {
    expect(providerEndpoint('claude', '')).toBe('')
    expect(providerEndpoint('claude', '   ')).toBe('')
  })
})
