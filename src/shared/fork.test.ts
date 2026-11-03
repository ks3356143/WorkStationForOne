import { describe, expect, it } from 'vitest'
import { canForkWithCli } from './fork'

const messages = [
  { id: 'u1', role: 'user' },
  { id: 'a1', role: 'assistant' },
  { id: 'u2', role: 'user' },
  { id: 'a2', role: 'assistant' }
]

describe('canForkWithCli', () => {
  it('只有 Claude 有 resumeId 且选中最新助手回复时真分叉', () => {
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, messages, 'a2')).toBe(true)
  })

  it('较早消息、缺少 resumeId、Codex 或最新消息不是助手回复时只能复制', () => {
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, messages, 'a1')).toBe(false)
    expect(canForkWithCli({ agent: 'claude' }, messages, 'a2')).toBe(false)
    expect(canForkWithCli({ agent: 'codex', resumeId: 'thread-1' }, messages, 'a2')).toBe(false)
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, messages, 'u2')).toBe(false)
    expect(canForkWithCli({ agent: 'claude', resumeId: 'cli-1' }, [], 'a2')).toBe(false)
  })
})
