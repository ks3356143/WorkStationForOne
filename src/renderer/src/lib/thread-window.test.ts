import { describe, expect, it } from 'vitest'
import { threadWindowForMessage, threadWindowStart } from './thread-window'

describe('会话线程窗口', () => {
  it('短会话全部渲染，长会话从尾部截取', () => {
    expect(threadWindowStart(10, 60)).toBe(0)
    expect(threadWindowStart(80, 60)).toBe(20)
    expect(threadWindowStart(80, 120)).toBe(0)
  })

  it('跳转到旧消息时把窗口扩到包含目标并留上下文', () => {
    expect(threadWindowForMessage(80, 60, 70)).toBe(60)
    expect(threadWindowForMessage(200, 60, 100)).toBe(108)
    expect(threadWindowForMessage(80, 60, 10)).toBe(78)
    expect(threadWindowForMessage(80, 60, -1)).toBe(60)
  })
})
