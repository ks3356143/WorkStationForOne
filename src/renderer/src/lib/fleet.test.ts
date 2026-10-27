import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { summarizeFleet } from './fleet'

function session(id: string, status: Session['status']): Session {
  return { id, agent: 'claude', title: id, meta: '', status, threadDate: '今天' }
}

describe('summarizeFleet', () => {
  it('按状态统计会话数量', () => {
    const summary = summarizeFleet([
      session('a', 'run'),
      session('b', 'run'),
      session('c', 'wait'),
      session('d', 'idle')
    ])

    expect(summary).toMatchObject({ total: 4, running: 2, waiting: 1, idle: 1 })
  })

  it('返回第一个待确认会话供跳转', () => {
    const summary = summarizeFleet([
      session('a', 'idle'),
      session('b', 'wait'),
      session('c', 'wait')
    ])

    expect(summary.waiting).toBe(2)
    expect(summary.waitingSessionId).toBe('b')
  })

  it('没有待确认或没有会话时给出空值', () => {
    expect(summarizeFleet([session('a', 'run')]).waitingSessionId).toBeNull()
    expect(summarizeFleet([])).toEqual({
      total: 0,
      running: 0,
      waiting: 0,
      idle: 0,
      waitingSessionId: null
    })
  })
})
