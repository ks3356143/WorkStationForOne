import { describe, expect, it } from 'vitest'
import { selectFallback, type RoutingCandidate } from './provider-routing'

const c = (id: string, priority: number, createdAt: number): RoutingCandidate => ({
  id,
  priority,
  createdAt
})

describe('selectFallback', () => {
  it('排除当前激活，按优先级再按创建时间选备用', () => {
    const got = selectFallback([c('a', 0, 1), c('b', 1, 2), c('c', 1, 3)], 'a')
    expect(got?.id).toBe('b')
  })

  it('优先级相同取更早创建', () => {
    const got = selectFallback([c('a', 0, 5), c('b', 0, 2)], null)
    expect(got?.id).toBe('b')
  })

  it('只有一个且为激活时返回 null', () => {
    expect(selectFallback([c('a', 0, 1)], 'a')).toBeNull()
  })

  it('空列表返回 null', () => {
    expect(selectFallback([], null)).toBeNull()
  })

  it('无激活时返回优先级最高者', () => {
    expect(selectFallback([c('a', 2, 1), c('b', 0, 9)], null)?.id).toBe('b')
  })
})
