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

export function agentCommandPreview(
  agent: AgentId,
  sessionId: string
): { bin: string; args: string } {
  if (agent === 'codex') return { bin: 'codex', args: '--sandbox workspace-write' }
  return { bin: 'claude', args: `--resume ${sessionId.replace('s-', '')} --perm ask` }
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
