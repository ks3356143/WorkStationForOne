import { describe, expect, it } from 'vitest'
import { AGENT_META, agentCommandPreview, demoReply } from './agent'

describe('agentCommandPreview', () => {
  it('Claude 使用会话续接参数', () => {
    expect(agentCommandPreview('claude', 's-c1')).toEqual({
      bin: 'claude',
      args: '--resume c1 --perm ask'
    })
  })

  it('Codex 固定为 workspace-write 沙箱', () => {
    expect(agentCommandPreview('codex', 's-x1')).toEqual({
      bin: 'codex',
      args: '--sandbox workspace-write'
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
      model: '本地 CLI'
    })
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
