import { addDaysKey, dateKey } from '../../../shared/date-key'
import type { AgentId, ToolCall } from '../types'

export interface AgentMeta {
  name: string
  shortName: string
  badge: string
  model: string
  cli: string
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  claude: {
    name: 'Claude Code',
    shortName: 'Claude',
    badge: 'C',
    model: 'Sonnet',
    cli: 'Claude Code · Sonnet · 本地 CLI'
  },
  codex: {
    name: 'Codex',
    shortName: 'Codex',
    badge: 'X',
    model: '本地 CLI',
    cli: 'Codex · workspace-write · 本地 CLI'
  }
}

function clockOf(at: number): string {
  const date = new Date(at)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

/** 会话列表的日期标签：今天 / 昨天 / 月日（跨年带年份）。 */
export function agentSessionDate(updatedAt: number, now: number): string {
  const day = dateKey(new Date(updatedAt))
  const today = dateKey(new Date(now))
  if (day === today) return '今天'
  if (day === addDaysKey(today, -1)) return '昨天'
  return day.slice(0, 4) === today.slice(0, 4) ? day.slice(5) : day
}

/** 会话列表的副标题：时间 + 消息条数。 */
export function agentSessionMeta(updatedAt: number, messageCount: number, now: number): string {
  const day = dateKey(new Date(updatedAt))
  const today = dateKey(new Date(now))
  let label: string
  if (day === today) label = clockOf(updatedAt)
  else if (day === addDaysKey(today, -1)) label = `昨天 ${clockOf(updatedAt)}`
  else label = agentSessionDate(updatedAt, now)
  return `${label} · ${messageCount} 条`
}

export function agentCommandPreview(
  agent: AgentId,
  resumeId?: string
): { bin: string; args: string } {
  if (agent === 'codex') return { bin: 'codex', args: '--sandbox workspace-write' }
  return {
    bin: 'claude',
    args: resumeId ? `--resume ${resumeId} --permission-mode default` : '--permission-mode default'
  }
}

export function demoReply(agent: AgentId): { text: string; tools: ToolCall[] } {
  if (agent === 'codex') {
    return {
      text: '收到。按只读模式先分析，给你方案后再执行；不会直接改文件。',
      tools: [{ name: 'context.read', meta: '只读 · 12 条提交', status: '完成' }]
    }
  }
  return {
    text: '收到。我先读取今天的看板，涉及写入时会再向你确认。',
    tools: [{ name: 'day.summary', meta: '任务 · 习惯 · 复习', status: '完成' }]
  }
}
