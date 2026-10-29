import { describe, expect, it } from 'vitest'
import {
  AGENT_META,
  agentCommandPreview,
  agentSessionDate,
  agentSessionMeta,
  demoReply
} from './agent'

describe('agentCommandPreview', () => {
  it('Claude 新会话显示真实权限模式与宿主审批', () => {
    expect(agentCommandPreview('claude')).toEqual({
      bin: 'claude',
      args: '--permission-mode manual --permission-prompts host'
    })
  })

  it('Claude 有 resume id 时才显示 --resume', () => {
    expect(agentCommandPreview('claude', 'cli-1')).toEqual({
      bin: 'claude',
      args: '--resume cli-1 --permission-mode manual --permission-prompts host'
    })
  })

  it('Codex 固定为只读沙箱与 JSONL', () => {
    expect(agentCommandPreview('codex')).toEqual({
      bin: 'codex',
      args: 'exec --json --sandbox read-only'
    })
    expect(agentCommandPreview('codex', 'thread-1')).toEqual({
      bin: 'codex',
      args: 'exec resume thread-1 --json'
    })
  })
})

describe('AGENT_META', () => {
  it('为两个 agent 提供稳定的名称、徽标与模型文案', () => {
    expect(AGENT_META.claude).toMatchObject({
      name: 'Claude Code',
      shortName: 'Claude',
      badge: 'C',
      model: 'Sonnet'
    })
    expect(AGENT_META.codex).toMatchObject({
      name: 'Codex',
      shortName: 'Codex',
      badge: 'X',
      model: '本地 CLI',
      cli: 'Codex · read-only 沙箱 · 本地 CLI'
    })
  })
})

describe('会话时间标签', () => {
  const now = new Date(2026, 9, 29, 15, 0).getTime()

  it('今天显示时分，昨天带前缀', () => {
    const today = new Date(2026, 9, 29, 14, 20).getTime()
    const yesterday = new Date(2026, 9, 28, 18, 20).getTime()

    expect(agentSessionMeta(today, 2, now)).toBe('14:20 · 2 条')
    expect(agentSessionDate(today, now)).toBe('今天')
    expect(agentSessionMeta(yesterday, 0, now)).toBe('昨天 18:20 · 0 条')
    expect(agentSessionDate(yesterday, now)).toBe('昨天')
  })

  it('更早的日期用月日，跨年带年份', () => {
    const older = new Date(2026, 9, 20, 9, 5).getTime()
    const lastYear = new Date(2025, 11, 31, 9, 5).getTime()

    expect(agentSessionMeta(older, 3, now)).toBe('10-20 · 3 条')
    expect(agentSessionDate(older, now)).toBe('10-20')
    expect(agentSessionMeta(lastYear, 1, now)).toBe('2025-12-31 · 1 条')
  })
})

describe('demoReply', () => {
  it('按 agent 返回不同回复与工具记录', () => {
    const claude = demoReply('claude')
    const codex = demoReply('codex')

    expect(claude.text).not.toBe(codex.text)
    expect(claude.tools[0]?.name).toBe('day.summary')
    expect(codex.tools[0]?.name).toBe('context.read')
  })
})
