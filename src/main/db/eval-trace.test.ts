import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { summarizeEval } from '../../shared/eval-metrics'
import { AgentRepository } from './agent'
import { migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-eval-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new AgentRepository(db) }
}
afterEach(() => {
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('评估落痕 DB v49', () => {
  it('建立 agent_tool_calls 表', () => {
    const { db } = seed()
    expect(userVersion(db)).toBe(53)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agent_tool_calls'")
      .all()
    expect(tables.length).toBe(1)
    db.close()
  })

  it('落痕可按运行读回并喂给评分函数', () => {
    const { db, repo } = seed()
    repo.recordRunStart('run-1', 's-1', Date.now())
    repo.finishRun('run-1', { ok: true, cancelled: false, costUsd: 0.2, turns: 2 })
    repo.recordToolCall({
      runId: 'run-1',
      sessionId: 's-1',
      seq: 1,
      toolName: 'mcp__probe__echo',
      kind: 'mcp',
      decision: 'observed',
      at: Date.now()
    })
    repo.recordToolCall({
      runId: 'run-1',
      sessionId: 's-1',
      seq: 2,
      toolName: 'Write',
      kind: 'approval',
      decision: 'allow',
      at: Date.now()
    })
    const calls = repo.listToolCalls('run-1')
    expect(calls.map((c) => c.toolName)).toEqual(['mcp__probe__echo', 'Write'])
    const score = summarizeEval(
      [{ id: 'run-1', ok: true, cancelled: false, costUsd: 0.2, turns: 2 }],
      calls.map((c) => ({
        runId: 'run-1',
        seq: c.seq,
        toolName: c.toolName,
        kind: c.kind as 'mcp',
        decision: c.decision as 'allow'
      })),
      ['echo']
    )
    expect(score.preferredFirstRate).toBe(1)
    expect(score.approvalPerTurn).toBeCloseTo(0.5)
    db.close()
  })
})
