import { selectActiveSession, useWorkstation } from '../store/useWorkstation'
import { useNow } from '../lib/useNow'
import { formatHM } from '../lib/date'
import { themeLabel } from '../lib/theme'

interface StatusBarProps {
  notify: (text: string) => void
}

export function StatusBar({ notify }: StatusBarProps) {
  const sessionCount = useWorkstation((state) => state.sessions.length)
  const session = useWorkstation(selectActiveSession)
  const permission = useWorkstation((state) => state.permission)
  const motionOn = useWorkstation((state) => state.motionOn)
  const theme = useWorkstation((state) => state.theme)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const openAgentSession = useWorkstation((state) => state.openAgentSession)
  const now = useNow(30_000)

  const agentName = session.agent === 'claude' ? 'Claude Code' : 'Codex'
  const stateLabel = session.status === 'run' ? '运行中' : session.status === 'wait' ? '待确认' : '空闲'

  return (
    <footer className="w1-status">
      <span>
        <i className={`w1-sdot${session.status === 'run' ? '' : ' idle'}`} />
        {agentName} {stateLabel} · {session.meta.split(' · ')[0]}
      </span>
      <button
        className="w1-sbtn w1-st-mcp"
        type="button"
        onClick={() => notify('MCP 服务端将在 P1 接入')}
      >
        <i className="w1-sdot warn" />
        MCP 未接入
      </button>
      <span>会话 {sessionCount}</span>
      {permission ? (
        <button className="w1-sbtn pending" type="button" onClick={() => openAgentSession(permission.sessionId)}>
          待审批 1
        </button>
      ) : (
        <span>无待审批</span>
      )}
      <span className="sp" />
      <button
        className="w1-motion"
        type="button"
        aria-pressed={motionOn}
        onClick={toggleMotion}
        title="暂停或恢复环境动效"
      >
        <i />
        {motionOn ? '动效 开' : '动效 关'}
      </button>
      <button
        className="w1-motion w1-theme"
        type="button"
        aria-pressed={theme === 'light'}
        aria-label={`当前${themeLabel(theme)}模式，切换主题`}
        onClick={() => {
          toggleTheme()
          notify(theme === 'dark' ? '已切换到白天模式' : '已切换到夜间模式')
        }}
        title="切换白天与夜间模式"
      >
        <i />
        {themeLabel(theme)}
      </button>
      <span>v0.1.0</span>
      <span className="w1-st-key">^K 聚焦</span>
      <span className="w1-st-key">^N 笔记</span>
      <span>{formatHM(now)} 本地</span>
    </footer>
  )
}
