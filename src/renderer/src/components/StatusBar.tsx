import { selectActiveSession, useWorkstation } from '../store/useWorkstation'
import { useNow } from '../lib/useNow'
import { formatHM } from '../lib/date'
import { skinLabel, themeLabel } from '../lib/theme'

interface StatusBarProps {
  notify: (text: string) => void
  onShortcuts: () => void
  onFleet: () => void
}

export function StatusBar({ notify, onShortcuts, onFleet }: StatusBarProps) {
  const sessionCount = useWorkstation((state) => state.sessions.length)
  const session = useWorkstation(selectActiveSession)
  // 审批卡按会话分开保存；状态栏汇总，点击跳到第一个有卡的会话
  const approvalCount = useWorkstation((state) =>
    state.sessions.reduce(
      (count, item) =>
        count +
        (state.permission?.sessionId === item.id ? 1 : 0) +
        (state.toolPermissions[item.id] ? 1 : 0) +
        (state.mcpPermissions[item.id] ? 1 : 0),
      0
    )
  )
  const pendingSessionId = useWorkstation((state) => {
    const pending = state.sessions.find(
      (item) =>
        state.permission?.sessionId === item.id ||
        Boolean(state.toolPermissions[item.id] || state.mcpPermissions[item.id])
    )
    return pending?.id ?? ''
  })
  const motionOn = useWorkstation((state) => state.motionOn)
  const theme = useWorkstation((state) => state.theme)
  const skin = useWorkstation((state) => state.skin)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const toggleSkin = useWorkstation((state) => state.toggleSkin)
  const openAgentSession = useWorkstation((state) => state.openAgentSession)
  const now = useNow(30_000)

  const agentName = session ? (session.agent === 'claude' ? 'Claude Code' : 'Codex') : null
  const stateLabel = session
    ? session.status === 'run'
      ? '运行中'
      : session.status === 'wait'
        ? '待确认'
        : '空闲'
    : null

  return (
    <footer className="w1-status">
      <span>
        <i className={`w1-sdot${session?.status === 'run' ? '' : ' idle'}`} />
        {session ? `${agentName} ${stateLabel} · ${session.meta.split(' · ')[0]}` : '无活动会话'}
      </span>
      <i className="w1-sdiv" aria-hidden="true" />
      <button
        className="w1-sbtn w1-st-mcp"
        type="button"
        title="本地 MCP 数据桥"
        onClick={() => notify('MCP 桥：任务 / 笔记 / 学习 / 习惯；写权限按域设置在设置里')}
      >
        <i className="w1-sdot" />
        MCP 桥
      </button>
      <button
        className="w1-sbtn w1-st-fleet"
        type="button"
        title="打开舰队控制台"
        onClick={onFleet}
      >
        舰队 {sessionCount}
      </button>
      {approvalCount > 0 ? (
        <button
          className="w1-sbtn pending"
          type="button"
          onClick={() => openAgentSession(pendingSessionId)}
        >
          待审批 {approvalCount}
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
      <button
        className="w1-motion w1-skin"
        type="button"
        aria-pressed={skin === 'classic'}
        aria-label={`当前${skinLabel(skin)}皮肤，切换皮肤`}
        onClick={() => {
          toggleSkin()
          notify(skin === 'prism' ? '已切换到经典皮肤' : '已切换到棱镜皮肤')
        }}
        title="切换棱镜与经典皮肤"
      >
        <i />
        {skinLabel(skin)}
      </button>
      <i className="w1-sdiv" aria-hidden="true" />
      <span className="w1-status-ver">v{__APP_VERSION__}</span>
      <span className="w1-st-keys">
        <span className="w1-st-key">
          <kbd>^K</kbd>聚焦
        </span>
        <span className="w1-st-key">
          <kbd>^N</kbd>笔记
        </span>
        <button
          className="w1-st-key w1-st-shortcuts"
          type="button"
          onClick={onShortcuts}
          title="键盘快捷键速查"
        >
          <kbd>?</kbd>快捷键
        </button>
      </span>
      <span>{formatHM(now)} 本地</span>
    </footer>
  )
}
