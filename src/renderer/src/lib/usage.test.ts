import { describe, expect, it } from 'vitest'
import type { AgentRunRecord } from '../../../shared/ipc'
import { formatCost, formatDuration, summarizeUsage, usageByDay } from './usage'

const run = (
  id: string,
  startedAt: number,
  over: Partial<AgentRunRecord> = {}
): AgentRunRecord => ({
  id,
  sessionId: 's-1',
  startedAt,
  finishedAt: startedAt + 1000,
  ok: true,
  cancelled: false,
  costUsd: 0.002,
  durationMs: 1200,
  turns: 2,
  ...over
})

describe('Agent 用量统计', () => {
  it('汇总运行、成功、失败、取消、成本与时长', () => {
    const summary = summarizeUsage([
      run('a', 1),
      run('b', 2, { ok: false, costUsd: 0.001, durationMs: 800, turns: 1 }),
      run('c', 3, { ok: false, cancelled: true, costUsd: null, durationMs: null, turns: null })
    ])
    expect(summary).toEqual({
      runs: 3,
      completed: 1,
      failures: 1,
      cancelled: 1,
      costUsd: 0.003,
      durationMs: 2000,
      turns: 3
    })
  })

  it('按本地日期分桶，未来日期留空', () => {
    const now = new Date(2026, 9, 30, 12).getTime()
    const days = usageByDay(
      [
        run('a', new Date(2026, 9, 30, 9).getTime()),
        run('b', new Date(2026, 9, 29, 9).getTime()),
        run('c', new Date(2026, 9, 20, 9).getTime())
      ],
      3,
      now
    )
    expect(days.map((day) => [day.key, day.runs])).toEqual([
      ['2026-10-28', 0],
      ['2026-10-29', 1],
      ['2026-10-30', 1]
    ])
  })

  it('成本和时长格式化', () => {
    expect(formatCost(0)).toBe('$0')
    expect(formatCost(0.002)).toBe('$0.0020')
    expect(formatCost(1.234)).toBe('$1.23')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(65_000)).toBe('1m 5s')
  })
})
