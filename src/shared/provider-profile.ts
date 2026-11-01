import type { ProviderTarget } from './ipc'

export type ProviderAuthScheme = 'api-key' | 'bearer'

/**
 * 官方 Anthropic 用 x-api-key（ANTHROPIC_API_KEY），第三方 Anthropic 兼容端点
 * 普遍用 Bearer（ANTHROPIC_AUTH_TOKEN）。Codex 的两条路径都只走 Bearer。
 */
export function providerAuthScheme(target: ProviderTarget, baseUrl: string): ProviderAuthScheme {
  if (target !== 'claude') return 'bearer'
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'api.anthropic.com' || host.endsWith('.anthropic.com') ? 'api-key' : 'bearer'
  } catch {
    return 'bearer'
  }
}

/** 实际请求端点；与主进程发请求的拼接规则保持一致，空地址返回空串。 */
export function providerEndpoint(target: ProviderTarget, baseUrl: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) return ''
  return target === 'codex' ? `${base}/responses` : `${base}/v1/messages`
}
