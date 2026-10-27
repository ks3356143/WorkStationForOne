import { AGENT_META } from '../../lib/agent'
import type { AgentId, SessionStatus } from '../../types'
import { ClaudeGlyph, CodexGlyph } from '../Glyphs'

interface DockHeaderProps {
  agent: AgentId
  counts: Record<AgentId, number>
  status: SessionStatus
  onSwitch: (agent: AgentId) => void
}

const STATUS_LABEL: Record<SessionStatus, string> = {
  run: '运行中',
  wait: '待确认',
  idle: '空闲'
}

export function DockHeader({ agent, counts, status, onSwitch }: DockHeaderProps) {
  return (
    <div className="w1-dhead">
      <div className="w1-tabs">
        <button
          className={`w1-tab${agent === 'claude' ? ' on' : ''}`}
          type="button"
          onClick={() => onSwitch('claude')}
        >
          <ClaudeGlyph width={10} height={10} />
          {AGENT_META.claude.name}
          <i>[{counts.claude}]</i>
        </button>
        <button
          className={`w1-tab${agent === 'codex' ? ' on' : ''}`}
          type="button"
          onClick={() => onSwitch('codex')}
        >
          <CodexGlyph width={10} height={10} />
          {AGENT_META.codex.name}
          <i>[{counts.codex}]</i>
        </button>
      </div>
      <span className={`w1-live${status === 'run' ? '' : ' idle'}`}>
        <i />
        {STATUS_LABEL[status]}
      </span>
    </div>
  )
}
