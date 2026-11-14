import { describe, expect, it } from 'vitest'
import type { AgentRunRecord } from '../../../shared/ipc'
import { buildTimeline, groupTimelineByDay } from './usage'

const run = (id: string, sessionId: string, startedAt: number): AgentRunRecord => ({
  id,
  sessionId,
  startedAt,
  finishedAt: startedAt + 1000,
  ok: true,
  cancelled: false,
  costUsd: 0.1,
  durationMs: 1000,
  turns: 1
})

const sessions = [
  { id: 's1', title: '前端任务', agent: 'claude' },
  { id: 's2', title: '后端任务', agent: 'codex' }
]

describe('buildTimeline', () => {
  it('join 会话标题与 agent，按时间倒序', () => {
    const runs = [run('r1', 's1', 1000), run('r2', 's2', 3000), run('r3', 's1', 2000)]
    const tl = buildTimeline(runs, sessions)
    expect(tl.map((e) => e.id)).toEqual(['r2', 'r3', 'r1'])
    expect(tl[0].title).toBe('后端任务')
    expect(tl[0].agent).toBe('codex')
  })
  it('已删除会话回退标题', () => {
    const tl = buildTimeline([run('r1', 'gone', 1000)], sessions)
    expect(tl[0].title).toBe('已删除会话')
    expect(tl[0].agent).toBe('')
  })
})

describe('groupTimelineByDay', () => {
  it('按本地日期分组且保持倒序', () => {
    const day1 = new Date(2026, 0, 1, 10, 0, 0).getTime()
    const day1b = new Date(2026, 0, 1, 12, 0, 0).getTime()
    const day2 = new Date(2026, 0, 2, 9, 0, 0).getTime()
    const tl = buildTimeline(
      [run('r1', 's1', day1), run('r2', 's1', day2), run('r3', 's1', day1b)],
      sessions
    )
    const groups = groupTimelineByDay(tl)
    expect(groups.map((g) => g.key)).toEqual(['2026-01-02', '2026-01-01'])
    expect(groups[1].entries.map((e) => e.id)).toEqual(['r3', 'r1'])
  })
})
