import { describe, expect, it } from 'vitest'
import { summarizeEval, toolKind, type EvalRun, type EvalToolCall } from './eval-metrics'

const run = (id: string, over: Partial<EvalRun> = {}): EvalRun => ({
  id,
  ok: true,
  cancelled: false,
  costUsd: 0.1,
  turns: 2,
  ...over
})
const call = (
  runId: string,
  seq: number,
  toolName: string,
  over: Partial<EvalToolCall> = {}
): EvalToolCall => ({
  runId,
  seq,
  toolName,
  kind: 'native',
  decision: 'observed',
  ...over
})

describe('toolKind', () => {
  it('识别 MCP 前缀，其余归原生', () => {
    expect(toolKind('mcp__workstationforone__tasks_list')).toBe('mcp')
    expect(toolKind('MCP · probe/echo')).toBe('mcp')
    expect(toolKind('Read')).toBe('native')
    expect(toolKind('Bash')).toBe('native')
  })
})

describe('summarizeEval', () => {
  it('空输入全零', () => {
    const score = summarizeEval([], [], ['echo'])
    expect(score.runs).toBe(0)
    expect(score.okRate).toBe(0)
    expect(score.avgTurns).toBe(0)
    expect(score.avgCostPerTurn).toBe(0)
    expect(score.approvalPerTurn).toBe(0)
    expect(score.preferredHitRate).toBe(0)
    expect(score.preferredFirstRate).toBe(0)
  })

  it('成功率 / 平均轮次 / 每回合成本', () => {
    const runs = [run('a'), run('b', { ok: false }), run('c', { turns: 4, costUsd: 0.3 })]
    const score = summarizeEval(runs, [], [])
    expect(score.runs).toBe(3)
    expect(score.okRate).toBeCloseTo(2 / 3)
    expect(score.avgTurns).toBeCloseTo((2 + 2 + 4) / 3)
    expect(score.avgCostPerTurn).toBeCloseTo((0.1 + 0.1 + 0.3) / 8)
  })

  it('审批摩擦只计用户决策，不计 observed', () => {
    const runs = [run('a', { turns: 2 })]
    const calls = [
      call('a', 1, 'Read'),
      call('a', 2, 'Write', { kind: 'approval', decision: 'allow' }),
      call('a', 3, 'Bash', { kind: 'approval', decision: 'deny' })
    ]
    const score = summarizeEval(runs, calls, [])
    expect(score.approvalPerTurn).toBeCloseTo(2 / 2)
  })

  it('首选命中与首选先行分开统计', () => {
    const runs = [run('a'), run('b'), run('c')]
    const calls = [
      call('a', 1, 'mcp__probe__echo'),
      call('b', 1, 'Read'),
      call('b', 2, 'mcp__probe__echo'),
      call('c', 1, 'Read')
    ]
    const score = summarizeEval(runs, calls, ['echo'])
    expect(score.preferredHitRate).toBeCloseTo(2 / 3)
    expect(score.preferredFirstRate).toBeCloseTo(1 / 3)
  })

  it('无首选配置时命中率为 0 而非 1', () => {
    const score = summarizeEval([run('a')], [call('a', 1, 'Read')], [])
    expect(score.preferredHitRate).toBe(0)
    expect(score.preferredFirstRate).toBe(0)
  })

  it('首选按边界匹配，不误命中相似工具名', () => {
    const score = summarizeEval([run('a')], [call('a', 1, 'NotebookRead')], ['Read'])
    expect(score.preferredHitRate).toBe(0)
  })
})
