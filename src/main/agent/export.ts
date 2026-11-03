import type { AgentMessageRecord, AgentSessionRecord } from '../../shared/ipc'

const AGENT_LABEL: Record<AgentSessionRecord['agent'], string> = {
  claude: 'Claude Code',
  codex: 'Codex'
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateLabel(ms: number): string {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 会话导出是内容交换：保留正文与工具摘要，不含任何内部 id 或凭据。 */
export function buildSessionMarkdown(
  session: AgentSessionRecord,
  messages: AgentMessageRecord[]
): string {
  const lines = [
    `# ${session.title}`,
    '',
    `> ${AGENT_LABEL[session.agent]} · ${dateLabel(session.createdAt)} · ${messages.length} 条消息`,
    ''
  ]
  if (messages.length === 0) {
    lines.push('（还没有消息）', '')
  }
  for (const message of messages) {
    const who = message.role === 'user' ? '我' : AGENT_LABEL[session.agent]
    lines.push(`## ${who} · ${message.timeLabel}`, '', message.text.trim() || '（空）', '')
    for (const tool of message.tools ?? []) {
      const meta = tool.meta.replace(/\s+/g, ' ').trim().slice(0, 160)
      lines.push(`> 工具：${tool.name}${meta ? ` · ${meta}` : ''} · ${tool.status}`, '')
    }
  }
  return lines.join('\n')
}
