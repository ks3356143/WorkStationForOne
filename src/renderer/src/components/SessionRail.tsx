import { useWorkstation } from '../store/useWorkstation'
import { ClaudeGlyph, CodexGlyph, PlusIcon } from './Glyphs'

interface SessionRailProps {
  notify: (text: string) => void
}

export function SessionRail({ notify }: SessionRailProps) {
  const sessions = useWorkstation((state) => state.sessions)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)

  const claudeSessions = sessions.filter((session) => session.agent === 'claude')
  const codexSessions = sessions.filter((session) => session.agent === 'codex')

  const renderGroup = (agent: 'claude' | 'codex', list: typeof sessions) => (
    <div className="w1-agroup">
      <div className="w1-ahead">
        <span className="w1-aglyph">
          {agent === 'claude' ? <ClaudeGlyph width={11} height={11} /> : <CodexGlyph width={11} height={11} />}
        </span>
        <span className="w1-aname">{agent === 'claude' ? 'Claude Code' : 'Codex'}</span>
        <span className="w1-acount">[{list.length}]</span>
      </div>
      {list.map((session) => (
        <button
          key={session.id}
          type="button"
          className={[
            'w1-sess',
            session.status === 'run' ? 'run' : '',
            session.status === 'wait' ? 'wait' : '',
            session.id === activeSessionId ? 'on' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          aria-current={session.id === activeSessionId ? 'true' : undefined}
          onClick={() => setActiveSession(session.id)}
        >
          <span className="w1-st">{session.title}</span>
          <span className="w1-sm">{session.meta}</span>
        </button>
      ))}
    </div>
  )

  return (
    <aside className="w1-rail" aria-label="会话列表">
      <div className="w1-rhead">
        <span className="w1-eyebrow">// 会话</span>
        <span className="w1-acount">{sessions.length}</span>
        <button
          className="w1-plus"
          type="button"
          aria-label="新建会话"
          title="接入 CLI 后可用"
          onClick={() => notify('新建会话将在接入真实 CLI 后开放')}
        >
          <PlusIcon width={10} height={10} />
        </button>
      </div>

      <div className="w1-railscroll">
        {renderGroup('claude', claudeSessions)}
        {renderGroup('codex', codexSessions)}
      </div>
    </aside>
  )
}
