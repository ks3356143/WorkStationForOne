import type { AgentImageRef } from '../../../shared/ipc'

interface CacheOptions {
  maxEntries?: number
  /** data URL 的总字符预算；图片挂在消息里，缓存不能无限增长 */
  maxChars?: number
}

interface Entry {
  promise: Promise<string>
  chars: number
}

export interface ImageCache {
  get: (image: AgentImageRef) => Promise<string>
  size: () => number
}

/**
 * 图片文件按 id 不可变，渲染层可以安全缓存 data URL。
 * 并发读取共享同一个 Promise；失败立即移除，允许下次重试。
 */
export function createImageCache(
  load: (image: AgentImageRef) => Promise<string>,
  options: CacheOptions = {}
): ImageCache {
  const maxEntries = options.maxEntries ?? 32
  const maxChars = options.maxChars ?? 12 * 1024 * 1024
  const entries = new Map<string, Entry>()
  let totalChars = 0

  const evict = () => {
    while (entries.size > maxEntries || totalChars > maxChars) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      totalChars -= entries.get(oldest)?.chars ?? 0
      entries.delete(oldest)
    }
  }

  return {
    get: (image) => {
      const existing = entries.get(image.id)
      if (existing) {
        // LRU：重新插入到队尾
        entries.delete(image.id)
        entries.set(image.id, existing)
        return existing.promise
      }
      const entry: Entry = { chars: 0, promise: Promise.resolve('') }
      entry.promise = load(image).then(
        (value) => {
          const current = entries.get(image.id)
          if (current === entry) {
            entry.chars = value.length
            totalChars += value.length
            evict()
          }
          return value
        },
        (error) => {
          if (entries.get(image.id) === entry) {
            entries.delete(image.id)
            totalChars -= entry.chars
          }
          throw error
        }
      )
      entries.set(image.id, entry)
      evict()
      return entry.promise
    },
    size: () => entries.size
  }
}

const defaultCache = createImageCache((image) => {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  if (!api) return Promise.reject(new Error('当前环境没有 preload 桥'))
  return api.imageData(image)
})

export function loadAgentImage(image: AgentImageRef): Promise<string> {
  return defaultCache.get(image)
}
