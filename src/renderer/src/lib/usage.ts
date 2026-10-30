import type { AgentRunRecord } from '../../../shared/ipc'
import { dateKey } from '../../../shared/date-key'

export interface UsageSummary {
  runs: number
  completed: number
  failures: number
  cancelled: number
  costUsd: number
  durationMs: number
  turns: number
}

export interface UsageDay {
  key: string
  runs: number
  costUsd: number
  durationMs: number
}

export function summarizeUsage(runs: AgentRunRecord[]): UsageSummary {
  let completed = 0
  let failures = 0
  let cancelled = 0
  let costUsd = 0
  let durationMs = 0
  let turns = 0
  for (const run of runs) {
    if (run.cancelled) cancelled += 1
    else if (run.ok === true) completed += 1
    else if (run.ok === false) failures += 1
    costUsd += run.costUsd ?? 0
    durationMs += run.durationMs ?? 0
    turns += run.turns ?? 0
  }
  return { runs: runs.length, completed, failures, cancelled, costUsd, durationMs, turns }
}

export function usageByDay(runs: AgentRunRecord[], days = 7, now = Date.now()): UsageDay[] {
  const span = Math.min(90, Math.max(1, Math.trunc(days)))
  const result: UsageDay[] = []
  const index = new Map<string, UsageDay>()
  for (let offset = span - 1; offset >= 0; offset -= 1) {
    const day = new Date(now - offset * 24 * 60 * 60 * 1000)
    const key = dateKey(day)
    const entry = { key, runs: 0, costUsd: 0, durationMs: 0 }
    result.push(entry)
    index.set(key, entry)
  }
  for (const run of runs) {
    const entry = index.get(dateKey(new Date(run.startedAt)))
    if (!entry) continue
    entry.runs += 1
    entry.costUsd += run.costUsd ?? 0
    entry.durationMs += run.durationMs ?? 0
  }
  return result
}

export function formatCost(value: number): string {
  if (!value) return '$0'
  if (value < 0.01) return `$${value.toFixed(4)}`
  return `$${value.toFixed(2)}`
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}
