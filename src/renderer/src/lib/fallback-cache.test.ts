import { describe, expect, it } from 'vitest'
import { invalidateFallbackCache, sharedFallbackFor } from './fallback-cache'

const fb = { id: 'p1', name: '备用' }

describe('sharedFallbackFor', () => {
  it('同一 agent 并发调用只触发一次请求并共享结果', async () => {
    invalidateFallbackCache()
    let calls = 0
    let release!: (value: { id: string; name: string } | null) => void
    const fetcher = () => {
      calls += 1
      return new Promise<{ id: string; name: string } | null>((resolve) => {
        release = resolve
      })
    }
    const a = sharedFallbackFor('claude', fetcher)
    const b = sharedFallbackFor('claude', fetcher)
    expect(calls).toBe(1)
    release(fb)
    expect(await a).toEqual(fb)
    expect(await b).toEqual(fb)
  })

  it('成功后缓存结果，再次调用不再请求', async () => {
    invalidateFallbackCache()
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return fb
    }
    await sharedFallbackFor('claude', fetcher)
    await sharedFallbackFor('claude', fetcher)
    expect(calls).toBe(1)
  })

  it('不同 agent 各自请求', async () => {
    invalidateFallbackCache()
    const seen: string[] = []
    const fetcher = async (agent: 'claude' | 'codex') => {
      seen.push(agent)
      return null
    }
    await sharedFallbackFor('claude', fetcher)
    await sharedFallbackFor('codex', fetcher)
    expect(seen).toEqual(['claude', 'codex'])
  })

  it('失效后重新请求', async () => {
    invalidateFallbackCache()
    let calls = 0
    const fetcher = async () => {
      calls += 1
      return fb
    }
    await sharedFallbackFor('claude', fetcher)
    invalidateFallbackCache()
    await sharedFallbackFor('claude', fetcher)
    expect(calls).toBe(2)
  })

  it('请求失败返回 null 且不缓存失败', async () => {
    invalidateFallbackCache()
    let calls = 0
    const fetcher = async () => {
      calls += 1
      throw new Error('ipc')
    }
    expect(await sharedFallbackFor('claude', fetcher)).toBeNull()
    expect(await sharedFallbackFor('claude', fetcher)).toBeNull()
    expect(calls).toBe(2)
  })
})
