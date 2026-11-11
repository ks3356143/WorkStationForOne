// 智能体评估评分卡：只读打开一个 SQLite 库，从 agent_runs + agent_tool_calls 复算指标。
// 用法：node scripts/eval.mjs --db <path> [--preferred echo,Read] [--min-ok 0.9] [--max-approval 1]
// 不启动应用、不写库；可对着冒烟临时库或真实库复跑，作为提示词 / 专家改动的回归门。
import { DatabaseSync } from 'node:sqlite'
import { summarizeEval } from '../src/shared/eval-metrics.ts'

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : undefined
}
const dbPath =
  flag('--db') ??
  (process.env.WS_DATA_DIR ? `${process.env.WS_DATA_DIR}/db/workstation.db` : undefined)
if (!dbPath) {
  console.error(
    '用法：node scripts/eval.mjs --db <workstation.db 路径> [--preferred a,b] [--min-ok 0.9] [--max-approval 1]'
  )
  process.exit(2)
}
const preferred = (flag('--preferred') ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const minOk = flag('--min-ok') !== undefined ? Number(flag('--min-ok')) : null
const maxApproval = flag('--max-approval') !== undefined ? Number(flag('--max-approval')) : null

const db = new DatabaseSync(dbPath, { readOnly: true })
const runRows = db
  .prepare(
    'SELECT id, ok, cancelled, cost_usd, turns FROM agent_runs WHERE finished_at IS NOT NULL'
  )
  .all()
const callRows = db
  .prepare(
    'SELECT run_id, seq, tool_name, kind, decision FROM agent_tool_calls ORDER BY run_id, seq'
  )
  .all()
db.close()

const runs = runRows.map((r) => ({
  id: r.id,
  ok: r.ok === 1,
  cancelled: r.cancelled === 1,
  costUsd: r.cost_usd,
  turns: r.turns
}))
const calls = callRows.map((c) => ({
  runId: c.run_id,
  seq: c.seq,
  toolName: c.tool_name,
  kind: c.kind,
  decision: c.decision
}))
const score = summarizeEval(runs, calls, preferred)

const pct = (v) => `${(v * 100).toFixed(1)}%`
console.log(
  JSON.stringify(
    {
      db: dbPath,
      runs: score.runs,
      okRate: pct(score.okRate),
      avgTurns: score.avgTurns.toFixed(2),
      avgCostPerTurn: `$${score.avgCostPerTurn.toFixed(4)}`,
      approvalPerTurn: score.approvalPerTurn.toFixed(2),
      preferredHitRate: pct(score.preferredHitRate),
      preferredFirstRate: pct(score.preferredFirstRate),
      preferred
    },
    null,
    2
  )
)

let failed = 0
if (minOk !== null && score.okRate < minOk) {
  console.error(`[eval] 成功率 ${pct(score.okRate)} 低于门槛 ${pct(minOk)}`)
  failed += 1
}
if (maxApproval !== null && score.approvalPerTurn > maxApproval) {
  console.error(`[eval] 每回合审批 ${score.approvalPerTurn.toFixed(2)} 高于门槛 ${maxApproval}`)
  failed += 1
}
if (failed > 0) process.exit(1)
