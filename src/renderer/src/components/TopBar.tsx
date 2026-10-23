import { formatClock } from '../lib/date'
import { useNow } from '../lib/useNow'

interface TopBarProps {
  onCommand: () => void
}

export function TopBar({ onCommand }: TopBarProps) {
  const now = useNow()

  return (
    <header className="w1-bar">
      <div className="w1-brand">
        <span className="w1-mark">W/1</span>
        <div className="w1-ws">
          WorkStationForOne
          <small>// 个人 AGENT 工作站</small>
        </div>
      </div>

      <button className="w1-cmd" type="button" onClick={onCommand}>
        <span className="w1-prompt">&gt;</span>
        <span>搜索、跳转，或直接问 agent</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="w1-sys">
        <i />
        SYS {formatClock(now)}
      </div>
    </header>
  )
}
