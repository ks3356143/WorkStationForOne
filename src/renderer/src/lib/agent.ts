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
    cli: 'Codex · 本地 CLI'
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
  resumeId?: string,
  codexApproval = false
): { bin: string; args: string } {
  if (agent === 'codex') {
    if (codexApproval) {
      return {
        bin: 'codex',
        args: resumeId
          ? `app-server --stdio · resume ${resumeId}`
          : 'app-server --stdio · 工作区审批'
      }
    }
    return {
      bin: 'codex',
      args: resumeId ? `exec resume ${resumeId} --json` : 'exec --json --sandbox read-only'
    }
  }
  return {
    bin: 'claude',
    args: resumeId
      ? `--resume ${resumeId} --permission-mode manual --permission-prompts host`
      : '--permission-mode manual --permission-prompts host'
  }
}

export function workspaceName(path?: string): string {
  if (!path) return '选择工作区'
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

export function demoReply(agent: AgentId): { text: string; tools: ToolCall[] } {
  if (agent === 'codex') {
    return {
      text: '收到。按工作区审批模式先分析，涉及写入会再向你确认。',
      tools: [{ name: 'context.read', meta: '只读 · 12 条提交', status: '完成' }]
    }
  }
  return {
    text: '收到。我先读取今天的看板，涉及写入时会再向你确认。',
    tools: [{ name: 'day.summary', meta: '任务 · 习惯 · 复习', status: '完成' }]
  }
}
