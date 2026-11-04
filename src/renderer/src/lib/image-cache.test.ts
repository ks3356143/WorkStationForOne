import { describe, expect, it, vi } from 'vitest'
import type { AgentImageRef } from '../../../shared/ipc'
import { createImageCache } from './image-cache'

const image = (id: string): AgentImageRef => ({ id, name: `${id}.png`, mime: 'image/png', size: 1 })

describe('Agent 图片缓存', () => {
  it('同一图片只读一次，并发请求共享同一个 Promise', async () => {
    const load = vi.fn(() => Promise.resolve('data:image/png;base64,AAAA'))
    const cache = createImageCache(load)

    const [first, second] = await Promise.all([
      cache.get(image('img-1')),
      cache.get(image('img-1'))
    ])
    expect(first).toBe(second)
    expect(load).toHaveBeenCalledTimes(1)

    await cache.get(image('img-1'))
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('超出条目上限时淘汰最久未用的图片', async () => {
    let seq = 0
    const load = vi.fn(() => Promise.resolve(`data-${seq++}`))
    const cache = createImageCache(load, { maxEntries: 2 })

    await cache.get(image('a'))
    await cache.get(image('b'))
    await cache.get(image('a'))
    await cache.get(image('c'))

    expect(cache.size()).toBe(2)
    await cache.get(image('b'))
    expect(load).toHaveBeenCalledTimes(4)
  })

  it('失败不缓存，下一次会重试', async () => {
    let attempts = 0
    const load = vi.fn(() => {
      attempts += 1
      return attempts === 1 ? Promise.reject(new Error('boom')) : Promise.resolve('ok')
    })
    const cache = createImageCache(load)

    await expect(cache.get(image('a'))).rejects.toThrow('boom')
    await expect(cache.get(image('a'))).resolves.toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('超出字符预算时淘汰旧图', async () => {
    const load = vi.fn((item: AgentImageRef) => Promise.resolve(item.id.repeat(10)))
    const cache = createImageCache(load, { maxChars: 15 })

    await cache.get(image('a'))
    await cache.get(image('b'))
    expect(cache.size()).toBe(1)

    await cache.get(image('a'))
    expect(load).toHaveBeenCalledTimes(3)
  })
})
