import { dateKey } from '../../../shared/date-key'
import { formatDateLine, formatHM, getTimeMarkerPercent, toMinutes } from '../lib/date'
import { summarizeFleet } from '../lib/fleet'
import { blockMinutes, findNextBlock, findNextTask } from '../lib/schedule'
import { tasksForTodayCard } from '../lib/todo'
import { useNow } from '../lib/useNow'
import { useWorkstation } from '../store/useWorkstation'
import { HabitCard } from './HabitCard'
import { NoteCard } from './NoteCard'
import { PlayIcon, PlusIcon } from './Glyphs'
import { ReviewCard } from './ReviewCard'
import { TaskCard } from './TaskCard'

const TIMELINE = [
  { time: '09:00', label: '站会', left: 7.1, width: 6.5 },
  { time: '10:30', label: '深度工作', left: 17.9, width: 11.5 },
  { time: '14:30', label: '线代', left: 46.4, width: 8.6 },
  { time: '19:00', label: '跑步', left: 78.6, width: 9.2 },
  { time: '21:00', label: '周报', left: 91.4, width: 8.4 }
] as const

export function TodayDashboard() {
  const tasks = useWorkstation((state) => state.tasks)
  const sessions = useWorkstation((state) => state.sessions)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)
  const startFocus = useWorkstation((state) => state.startFocus)
  const now = useNow(30_000)

  const fleet = summarizeFleet(sessions)
  const todayTasks = tasksForTodayCard(tasks, dateKey(now))
  const todo = todayTasks.filter((task) => !task.done).length
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const next = findNextTask(todayTasks, nowMinutes)
  const nextBlockTime = findNextBlock(TIMELINE, nowMinutes)?.time
  const marker = getTimeMarkerPercent(now)

  return (
    <div className="w1-main">
      <div className="w1-thead">
        <div>
          <div className="w1-date">
            <i>//</i> {formatDateLine(now)}
          </div>
          <h1 className="w1-h1">
            今天<span>.</span>
          </h1>
          <div className="w1-sub">
            <span className="w1-subtag">状态</span>
            <b>{fleet.running}</b> 个在跑 · <b>{fleet.waiting}</b> 个待确认 · <b>{todo}</b> 项待办
            {next ? (
              <span className="w1-sub-next">
                {' '}
                · 下一段 <b>{next.time}</b> {next.title.split(' · ')[0]}
              </span>
            ) : (
              <span className="w1-sub-next"> · 今日已无后续日程</span>
            )}
          </div>
        </div>
        <div className="w1-acts">
          <button className="w1-btn" type="button" onClick={openQuickNote}>
            <PlusIcon width={12} height={12} />
            快速笔记 <kbd>^N</kbd>
          </button>
          <button
            className="w1-btn pri"
            type="button"
            onClick={() => startFocus('深度工作 · 重构 auth 模块', 25)}
          >
            <PlayIcon width={11} height={11} />
            开始专注
          </button>
        </div>
      </div>

      <div
        className="w1-tl"
        role="group"
        aria-label={`今日时间轴：当前 ${formatHM(now)}，下一段 ${next?.time ?? '待定'} ${next?.title ?? ''}`}
      >
        {TIMELINE.map((block, index) => {
          const minutes = blockMinutes(block, TIMELINE[index + 1])
          const start = toMinutes(block.time)
          const past = start !== null && start + minutes <= nowMinutes
          return (
            <button
              key={block.time}
              type="button"
              className={`w1-tlblk${block.time === nextBlockTime ? ' next' : ''}${past ? ' past' : ''}`}
              style={{ left: `${block.left}%`, width: `${block.width}%` }}
              title={`${block.time} · ${block.label} · ${minutes} 分钟，点击开始专注`}
              aria-label={`${block.time} ${block.label}，${minutes} 分钟，开始专注`}
              onClick={() => startFocus(`${block.label} · ${block.time}`, minutes)}
            >
              {block.label}
            </button>
          )
        })}
        {[7.1, 21.4, 35.7, 50, 64.3, 78.6, 92.9].map((left, index) => (
          <span key={left} className="w1-tlhour" style={{ left: `${left}%` }}>
            {String(9 + index * 2).padStart(2, '0')}
          </span>
        ))}
        <span
          className={`w1-tlnow${marker < 0.18 ? ' flip' : ''}`}
          style={{ left: `${(marker * 100).toFixed(2)}%` }}
        >
          <span>{formatHM(now)} 现在</span>
        </span>
      </div>

      <div className="w1-bento">
        <TaskCard nextTaskId={next?.id} />
        <NoteCard />
        <HabitCard />
        <ReviewCard />
      </div>
    </div>
  )
}
