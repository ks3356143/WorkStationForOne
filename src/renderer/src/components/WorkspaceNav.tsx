import { dateKey } from '../../../shared/date-key'
import { summarizeFleet } from '../lib/fleet'
import { dueQueue } from '../lib/learning'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import type { View } from '../types'
import { FleetStrip } from './FleetStrip'
import { AgentIcon, LearningIcon, NotesIcon, SettingsIcon, TasksIcon, TodayIcon } from './Glyphs'

interface WorkspaceNavProps {
  notify: (text: string) => void
}

const VIEWS: { id: View; label: string; index: string; Icon: typeof TodayIcon }[] = [
  { id: 'today', label: '今日', index: '01', Icon: TodayIcon },
  { id: 'tasks', label: '任务', index: '02', Icon: TasksIcon },
  { id: 'agent', label: 'Agent', index: '03', Icon: AgentIcon },
  { id: 'notes', label: '笔记', index: '04', Icon: NotesIcon },
  { id: 'learning', label: '学习', index: '05', Icon: LearningIcon }
]

export function WorkspaceNav({ notify }: WorkspaceNavProps) {
  const activeView = useWorkstation((state) => state.activeView)
  const setView = useWorkstation((state) => state.setView)
  const sessions = useWorkstation((state) => state.sessions)
  const tasks = useWorkstation((state) => state.tasks)
  const learningItems = useWorkstation((state) => state.learningItems)
  const noteCount = useWorkstation((state) => state.noteTotal)
  const now = useNow(60_000)
  const today = dateKey(now)
  const todoCount = tasks.reduce((count, task) => count + (task.done ? 0 : 1), 0)
  const todayCount = tasks.reduce(
    (count, task) => count + (!task.done && task.dueDate && task.dueDate <= today ? 1 : 0),
    0
  )
  const dueCount = dueQueue(learningItems, today).length

  const fleet = summarizeFleet(sessions)
  const meta: Record<View, string> = {
    today: `${todayCount} 项今日`,
    tasks: `${todoCount} 项待办`,
    agent: fleet.waiting > 0 ? `${fleet.waiting} 个待确认` : `${sessions.length} 个会话`,
    notes: `${noteCount} 条记录`,
    learning: dueCount > 0 ? `${dueCount} 张到期` : '今日已完成'
  }

  return (
    <aside className="w1-nav" aria-label="工作区导航">
      <div className="w1-navhead">
        <span className="w1-eyebrow">// 工作区</span>
        <span className="w1-navlocal">本地</span>
      </div>

      <nav className="w1-navlist" aria-label="主导航">
        {VIEWS.map(({ id, label, index, Icon }) => (
          <button
            key={id}
            type="button"
            className={`w1-navitem${activeView === id ? ' on' : ''}`}
            aria-current={activeView === id ? 'page' : undefined}
            onClick={() => setView(id)}
          >
            <span className="w1-navicon">
              <Icon width={16} height={16} />
            </span>
            <span className="w1-navtext">
              <b>{label}</b>
              <small>{meta[id]}</small>
            </span>
            <span className="w1-navindex">{index}</span>
          </button>
        ))}
      </nav>

      <div className="w1-navfleet">
        <div className="w1-rhead">
          <span className="w1-eyebrow">// 舰队</span>
          <span className="w1-acount">{fleet.total} 会话</span>
        </div>
        <FleetStrip summary={fleet} />
      </div>

      <div className="w1-navspacer" />

      <div className="w1-launch">
        <div className="w1-rhead">
          <span className="w1-eyebrow">// 启动</span>
          <span className="w1-acount">外部</span>
        </div>
        <button
          className="w1-lrow"
          type="button"
          onClick={() => notify('Qoder 启动器将在 P2 接入')}
        >
          <span className="w1-lname">Qoder</span>
          <span className="w1-lmeta">独立窗口</span>
        </button>
        <button
          className="w1-lrow"
          type="button"
          onClick={() => notify('DeepSeek Harness 启动器将在 P2 接入')}
        >
          <span className="w1-lname">DeepSeek Harness</span>
          <span className="w1-lmeta">独立窗口</span>
        </button>
      </div>

      <div className="w1-rfoot">
        <button
          className="w1-settings"
          type="button"
          onClick={() => notify('设置面板将在 P1 接入')}
        >
          <SettingsIcon width={12} height={12} />
          设置
        </button>
        <span className="w1-navver">v{__APP_VERSION__}</span>
      </div>
    </aside>
  )
}
