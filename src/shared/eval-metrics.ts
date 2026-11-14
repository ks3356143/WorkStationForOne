// 智能体评估的纯函数度量：从运行记录与工具落痕算评分卡，供 scripts/eval.mjs 与单测共用。

export interface EvalRun {
  id: string
  ok: boolean
  cancelled: boolean
  costUsd: number | null
  turns: number | null
}

export interface EvalToolCall {
  runId: string
  seq: number
  toolName: string
  kind: 'native' | 'mcp' | 'skill' | 'approval'
  /** observed = 工具调用落痕；allow / deny = 用户审批决策 */
  decision: 'observed' | 'allow' | 'deny'
}

export interface EvalScore {
  runs: number
  okRate: number
  avgTurns: number
  avgCostPerTurn: number
  approvalPerTurn: number
  preferredHitRate: number
  preferredFirstRate: number
}

export function toolKind(name: string): 'native' | 'mcp' {
  return name.startsWith('mcp__') || name.startsWith('MCP · ') ? 'mcp' : 'native'
}

function matchesPreferred(toolName: string, preferred: string[]): boolean {
  // 边界匹配：'Read' 不能命中 'NotebookRead'，但要命中 'mcp__server__echo' / 'MCP · s/echo'。
  return preferred.some(
    (p) =>
      toolName === p ||
      toolName.endsWith(`__${p}`) ||
      toolName.endsWith(`/${p}`) ||
      toolName.endsWith(`· ${p}`)
  )
}

const ZERO: EvalScore = {
  runs: 0,
  okRate: 0,
  avgTurns: 0,
  avgCostPerTurn: 0,
  approvalPerTurn: 0,
  preferredHitRate: 0,
  preferredFirstRate: 0
}

export function summarizeEval(
  runs: EvalRun[],
  calls: EvalToolCall[],
  preferredTools: string[]
): EvalScore {
  if (runs.length === 0) return { ...ZERO }
  const totalTurns = runs.reduce((sum, r) => sum + (r.turns ?? 0), 0)
  const totalCost = runs.reduce((sum, r) => sum + (r.costUsd ?? 0), 0)
  const okCount = runs.filter((r) => r.ok).length
  const approvals = calls.filter((c) => c.kind === 'approval' && c.decision !== 'observed').length

  const traceByRun = new Map<string, EvalToolCall[]>()
  for (const c of calls) {
    if (c.kind === 'approval') continue
    const list = traceByRun.get(c.runId) ?? []
    list.push(c)
    traceByRun.set(c.runId, list)
  }
  let hit = 0
  let first = 0
  if (preferredTools.length > 0) {
    for (const r of runs) {
      const trace = (traceByRun.get(r.id) ?? []).sort((a, b) => a.seq - b.seq)
      if (trace.some((c) => matchesPreferred(c.toolName, preferredTools))) hit += 1
      if (trace.length > 0 && matchesPreferred(trace[0].toolName, preferredTools)) first += 1
    }
  }

  return {
    runs: runs.length,
    okRate: okCount / runs.length,
    avgTurns: totalTurns / runs.length,
    avgCostPerTurn: totalTurns > 0 ? totalCost / totalTurns : 0,
    approvalPerTurn: totalTurns > 0 ? approvals / totalTurns : 0,
    preferredHitRate: hit / runs.length,
    preferredFirstRate: first / runs.length
  }
}
