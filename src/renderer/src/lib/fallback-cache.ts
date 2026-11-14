import type { AgentId } from '../types'

export interface FallbackProvider {
  id: string
  name: string
}

const cache = new Map<AgentId, Promise<FallbackProvider | null>>()

/** 按 agent 共享备用 Provider 查询：失败行共用一次 IPC；失败不缓存，下次挂载重试。 */
export function sharedFallbackFor(
  agent: AgentId,
  fetch: (agent: AgentId) => Promise<FallbackProvider | null>
): Promise<FallbackProvider | null> {
  const hit = cache.get(agent)
  if (hit) return hit
  const promise = fetch(agent).catch(() => {
    cache.delete(agent)
    return null
  })
  cache.set(agent, promise)
  return promise
}

export function invalidateFallbackCache(): void {
  cache.clear()
}

/** Provider 变更（保存 / 删除 / 切换）后让缓存失效；返回卸载函数。 */
export function installFallbackCacheInvalidation(): () => void {
  if (typeof window === 'undefined') return () => undefined
  window.addEventListener('ws:provider-changed', invalidateFallbackCache)
  return () => window.removeEventListener('ws:provider-changed', invalidateFallbackCache)
}
