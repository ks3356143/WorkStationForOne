import { describe, expect, it } from 'vitest'
import { canForkWithCli } from './fork'

const messages = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a2', role: 'assistant' }
]

describe('canForkWithCli', () => {
  it('Claude / Codex 有 resumeId 且选中最新助手回复时真分叉', () => {
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, messages, 'a2')).toBe(true)
    expect(canForkWithCli({ agent: 'codex', resumeId: 'thread-1' }, messages, 'a2')).toBe(true)
  })

  it('Codex 较早的助手回合有 turnId 时也能真分叉', () => {
    const withTurn = messages.map((message) =>
      message.id === 'a1' ? { ...message, turnId: 'turn-1' } : message
    )
    expect(canForkWithCli({ agent: 'codex', resumeId: 'thread-1' }, withTurn, 'a1')).toBe(true)
    expect(canForkWithCli({ agent: 'codex', resumeId: 'thread-1' }, messages, 'a1')).toBe(false)
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, withTurn, 'a1')).toBe(false)
  })

  it('缺少 resumeId、未知 Agent 或最新消息不是助手回复时只能复制', () => {
    expect(canForkWithCli({ agent: 'claude' }, messages, 'a2')).toBe(false)
    expect(canForkWithCli({ agent: 'codex' }, messages, 'a2')).toBe(false)
    expect(canForkWithCli({ agent: 'gemini', resumeId: 'x' }, messages, 'a2')).toBe(false)
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, messages, 'u2')).toBe(false)
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, [], 'a2')).toBe(false)
  })
})
