import { SessionRail } from '../SessionRail'
import { AgentDock } from './AgentDock'

interface AgentWorkspaceProps {
  notify: (text: string, action?: { label: string; run: () => void }, duration?: number) => void
}

export function AgentWorkspace({ notify }: AgentWorkspaceProps) {
  return (
    <section className="w1-workspace w1-agent" aria-label="Agent 工作区">
      <SessionRail />
      <AgentDock notify={notify} />
    </section>
  )
}
