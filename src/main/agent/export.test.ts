import { describe, expect, it } from 'vitest'
import type { AgentMessageRecord, AgentSessionRecord } from '../../shared/ipc'
import { buildSessionMarkdown } from './export'

const session: AgentSessionRecord = {
  id: 's-1',
  agent: 'claude',
  title: '重构 auth 模块',
  status: 'idle',
  createdAt: new Date('2026-11-03T10:00:00').getTime(),
  updatedAt: new Date('2026-11-03T10:05:00').getTime()
}

const user: AgentMessageRecord = {
  id: 'm-1',
  sessionId: 's-1',
  role: 'user',
  text: '先看 auth 入口',
  timeLabel: '10:00',
  createdAt: 0
}

const assistant: AgentMessageRecord = {
  id: 'm-2',
  sessionId: 's-1',
  role: 'assistant',
  text: '我先读入口文件。',
  timeLabel: '10:01',
  createdAt: 1,
  tools: [{ id: 't-1', name: 'Read', meta: 'src/main/index.ts', status: '完成' }]
}

describe('会话导出 Markdown', () => {
  it('包含标题、双方正文与工具摘要', () => {
    const text = buildSessionMarkdown(session, [user, assistant])
    expect(text).toContain('# 重构 auth 模块')
    expect(text).toContain('Claude Code · 2026-11-03 10:00 · 2 条消息')
    expect(text).toContain('## 我 · 10:00')
    expect(text).toContain('## Claude Code · 10:01')
    expect(text).toContain('我先读入口文件。')
    expect(text).toContain('> 工具：Read · src/main/index.ts · 完成')
  })

  it('空会话给出明确占位，不包含内部 id', () => {
    const text = buildSessionMarkdown(session, [])
    expect(text).toContain('（还没有消息）')
    expect(text).not.toContain('s-1')
    expect(text).not.toContain('m-1')
  })

  it('导出用户消息附带的文件路径', () => {
    const text = buildSessionMarkdown(session, [
      { ...user, contextFiles: ['src/a.ts', 'docs/b.md'] }
    ])
    expect(text).toContain('> 附件：src/a.ts、docs/b.md')
  })

  it('导出用户消息附带的图片名称', () => {
    const text = buildSessionMarkdown(session, [
      {
        ...user,
        images: [{ id: 'img-1', name: 'shot.png', mime: 'image/png', size: 70 }]
      }
    ])
    expect(text).toContain('> 图片：shot.png')
    expect(text).not.toContain('img-1')
  })
})
