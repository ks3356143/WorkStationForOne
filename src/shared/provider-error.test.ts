import { describe, expect, it } from 'vitest'
import { classifyProviderError, classifyProviderStatus } from './provider-error'

describe('Provider / 模型错误分类', () => {
  it('区分认证失败，并提示自定义 Provider 优先', () => {
    const copy = classifyProviderError('Authentication Fails, Your api key is invalid')
    expect(copy?.kind).toBe('auth')
    expect(copy?.hint).toContain('Agent Provider')
    expect(copy?.hint).toContain('claude login')
  })

  it('识别模型不存在与中文模型错误', () => {
    expect(classifyProviderError('API Error: 400 Model Not Exist')?.kind).toBe('model')
    expect(classifyProviderError('模型不存在或不可用')?.kind).toBe('model')
    expect(classifyProviderError('unknown model: deepseek-x')?.kind).toBe('model')
  })

  it('识别上下文超长', () => {
    expect(classifyProviderError("This model's maximum context length is 65536 tokens")?.kind).toBe(
      'context'
    )
    expect(classifyProviderError('上下文超过限制')?.kind).toBe('context')
  })

  it('识别额度、限流与服务过载', () => {
    expect(classifyProviderError('Insufficient Balance')?.kind).toBe('quota')
    expect(classifyProviderError('402 Payment Required')?.kind).toBe('quota')
    expect(classifyProviderError('429 rate limit exceeded')?.kind).toBe('rate-limit')
    expect(classifyProviderError('503 Service Unavailable')?.kind).toBe('overload')
  })

  it('识别图片不支持、内容拦截', () => {
    expect(classifyProviderError('image input not supported by this model')?.kind).toBe('vision')
    expect(classifyProviderError('content filter blocked this request')?.kind).toBe('content')
  })

  it('Codex 指向 Anthropic 地址时提示协议错配', () => {
    const copy = classifyProviderError(
      'unexpected status 404 Not Found: Unknown error, url: https://api.deepseek.com/anthropic/responses',
      'codex'
    )
    expect(copy?.kind).toBe('protocol')
    expect(copy?.hint).toContain('/anthropic')
    expect(classifyProviderStatus(404, 'claude')?.hint).toContain('OpenAI Responses')
  })

  it('未命中时返回 null，让通用错误处理接手', () => {
    expect(classifyProviderError('插件清单格式不对')).toBeNull()
    expect(classifyProviderError('')).toBeNull()
  })

  it('仅状态码也能给出可操作提示', () => {
    expect(classifyProviderStatus(401)?.kind).toBe('auth')
    expect(classifyProviderStatus(429)?.kind).toBe('rate-limit')
    expect(classifyProviderStatus(500)?.kind).toBe('overload')
    expect(classifyProviderStatus(400)?.kind).toBe('request')
    expect(classifyProviderStatus(400)?.hint).toContain('模型名')
  })
})
