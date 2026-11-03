import { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { m } from 'motion/react'
import type { AgentSessionSearchHit, NoteSearchHit } from '../../../shared/ipc'
import { DURATION, EASE_OUT } from '../lib/motion'
import { AGENT_META } from '../lib/agent'
import { searchTasks } from '../lib/todo'
import type { LearningItem } from '../types'
import {
  buildPaletteCommands,
  visiblePaletteCommands,
  type PaletteCommand,
  type PaletteGroup
} from '../lib/commands'
import { selectActiveSession, useWorkstation } from '../store/useWorkstation'

interface CommandPaletteProps {
  onClose: () => void
  notify: (text: string) => void
  onShortcuts: () => void
  onSettings: () => void
  onFleet: () => void
  onReminders: () => void
}

const GROUPS: readonly PaletteGroup[] = ['会话', '导航', '操作', '交给 Agent']

interface SearchItem {
  id: string
  group: '任务' | '笔记' | '会话' | '学习'
  label: string
  hint: string
  badge: string
  run: () => void
}

const ACTION_GLYPH: Record<PaletteCommand['action']['kind'], string> = {
  session: '›',
  view: '▦',
  'new-note': '+',
  'new-task': '+',
  focus: '▶',
  filter: '▤',
  motion: '◐',
  shortcuts: '?',
  backup: '⌸',
  settings: '⚙',
  fleet: '▦',
  reminders: '◷',
  theme: '◑',
  review: '◈',
  send: '↵'
}

export function CommandPalette({
  onClose,
  notify,
  onShortcuts,
  onSettings,
  onFleet,
  onReminders
}: CommandPaletteProps) {
  const sessions = useWorkstation((state) => state.sessions)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const activeSession = useWorkstation(selectActiveSession)
  const tasks = useWorkstation((state) => state.tasks)
  const learningItems = useWorkstation((state) => state.learningItems)
  const taskFilter = useWorkstation((state) => state.taskFilter)
  const motionOn = useWorkstation((state) => state.motionOn)
  const theme = useWorkstation((state) => state.theme)
  // 只针对当前会话：别的会话在跑时仍可以把输入交给这里
  const typing = useWorkstation(
    (state) =>
      Boolean(state.streams[state.activeSessionId]) ||
      state.pendingPrompts.some((prompt) => prompt.sessionId === state.activeSessionId)
  )
  const setView = useWorkstation((state) => state.setView)
  const openAgentSession = useWorkstation((state) => state.openAgentSession)
  const openAgentMessage = useWorkstation((state) => state.openAgentMessage)
  const openTask = useWorkstation((state) => state.openTask)
  const openNote = useWorkstation((state) => state.openNote)
  const openLearningItem = useWorkstation((state) => state.openLearningItem)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)
  const composeTask = useWorkstation((state) => state.composeTask)
  const startFocus = useWorkstation((state) => state.startFocus)
  const setFilter = useWorkstation((state) => state.setFilter)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const startLearningReview = useWorkstation((state) => state.startLearningReview)
  const sendMessage = useWorkstation((state) => state.sendMessage)

  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<{
    notes: NoteSearchHit[]
    sessions: AgentSessionSearchHit[]
  }>({ notes: [], sessions: [] })
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const closingRef = useRef(false)
  const searchSeq = useRef(0)
  const trimmed = query.trim()

  useEffect(() => {
    const seq = ++searchSeq.current
    if (!trimmed) {
      setRemote({ notes: [], sessions: [] })
      setSearching(false)
      return
    }
    setSearching(true)
    const timer = window.setTimeout(() => {
      const notesApi = window.ws?.notes
      const agentApi = window.ws?.agent
      void Promise.all([
        notesApi?.search ? notesApi.search(trimmed, 6) : Promise.resolve([]),
        agentApi?.searchSessions ? agentApi.searchSessions(trimmed) : Promise.resolve([])
      ])
        .then(([notes, sessionHits]) => {
          if (seq !== searchSeq.current) return
          setRemote({
            notes,
            sessions: sessionHits.filter((hit) => !hit.session.archived).slice(0, 6)
          })
        })
        .catch(() => {
          if (seq === searchSeq.current) setRemote({ notes: [], sessions: [] })
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false)
        })
    }, 160)
    return () => window.clearTimeout(timer)
  }, [trimmed])

  const commands = buildPaletteCommands({
    sessions,
    activeSessionId,
    taskFilter,
    motionOn,
    theme,
    query,
    typing
  })
  const visibleCommands = visiblePaletteCommands(commands, query)
  const taskHits = trimmed ? searchTasks(tasks, trimmed).slice(0, 6) : []
  const learningHits = trimmed
    ? learningItems
        .filter(
          (item: LearningItem) =>
            item.active !== false &&
            `${item.title} ${item.subject} ${item.notes ?? ''} ${item.source ?? ''}`
              .toLowerCase()
              .includes(trimmed.toLowerCase())
        )
        .slice(0, 6)
    : []
  const noteLabel = (text: string) => {
    const first = text.trim().split(/\r?\n/)[0]?.trim() ?? ''
    return first.length > 48 ? `${first.slice(0, 48)}…` : first || '笔记'
  }
  const searchItems: SearchItem[] = [
    ...taskHits.map((task) => ({
      id: `search-task-${task.id}`,
      group: '任务' as const,
      label: task.title,
      hint: task.time !== '—' ? task.time : (task.list ?? '任务'),
      badge: '✓',
      run: () => {
        openTask(task.id)
        onClose()
      }
    })),
    ...remote.notes.map((hit) => ({
      id: `search-note-${hit.id}`,
      group: '笔记' as const,
      label: noteLabel(hit.text),
      hint: hit.tag ?? '笔记',
      badge: '▤',
      run: () => {
        openNote({
          id: hit.id,
          text: hit.text,
          time: hit.time,
          tag: hit.tag,
          pinned: hit.pinned
        })
        onClose()
      }
    })),
    ...remote.sessions.map((hit) => ({
      id: `search-session-${hit.session.id}-${hit.messageId ?? 'title'}`,
      group: '会话' as const,
      label: hit.session.title,
      hint: hit.matchedIn === 'message' ? hit.snippet : AGENT_META[hit.session.agent].shortName,
      badge: AGENT_META[hit.session.agent].badge,
      run: () => {
        openAgentMessage(hit.session.id, hit.messageId)
        onClose()
      }
    })),
    ...learningHits.map((item) => ({
      id: `search-learning-${item.id}`,
      group: '学习' as const,
      label: item.title,
      hint: item.subject,
      badge: '◈',
      run: () => {
        openLearningItem(item.id)
        onClose()
      }
    }))
  ]
  const showSearchFirst = trimmed.length > 0 && visibleCommands.length === 0
  const renderSearchGroups = () =>
    (['任务', '笔记', '会话', '学习'] as const).map((group) => {
      const items = searchItems.filter((item) => item.group === group)
      if (items.length === 0) return null
      return (
        <Command.Group key={group} heading={`搜索 · ${group}`} className="w1-palettegroup">
          {items.map((item) => (
            <Command.Item
              key={item.id}
              value={`${item.group} ${item.label} ${item.hint}`}
              className="w1-paletteitem"
              onSelect={item.run}
            >
              <span className="w1-palettebadge">{item.badge}</span>
              <span className="w1-palettelabel">{item.label}</span>
              <span className="w1-palettehint">{item.hint}</span>
            </Command.Item>
          ))}
        </Command.Group>
      )
    })

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = (command: PaletteCommand) => {
    if (command.disabled || closingRef.current) return
    closingRef.current = true

    switch (command.action.kind) {
      case 'session':
        openAgentSession(command.action.sessionId)
        break
      case 'view':
        setView(command.action.view)
        notify(command.label)
        break
      case 'new-note':
        openQuickNote()
        break
      case 'new-task':
        composeTask()
        notify('任务输入已就绪')
        break
      case 'focus':
        startFocus('深度工作', 25)
        break
      case 'filter':
        setFilter(command.action.filter)
        notify(command.label)
        break
      case 'motion':
        toggleMotion()
        notify(motionOn ? '动效已暂停' : '动效已恢复')
        break
      case 'theme':
        toggleTheme()
        notify(theme === 'dark' ? '已切换到白天模式' : '已切换到夜间模式')
        break
      case 'shortcuts':
        onShortcuts()
        break
      case 'settings':
        onSettings()
        break
      case 'fleet':
        onFleet()
        break
      case 'reminders':
        onReminders()
        break
      case 'backup': {
        const bridge = window.ws?.app
        if (!bridge?.backupNow) {
          notify('当前环境不支持备份')
          break
        }
        void bridge
          .backupNow()
          .then((result) => {
            const size = (result.bytes / 1024).toFixed(0)
            notify(`已备份 ${size} KB · ${result.file.split(/[/]/).pop() ?? ''}`)
          })
          .catch((error: unknown) => {
            notify(error instanceof Error ? `备份失败：${error.message}` : '备份失败')
          })
        break
      }
      case 'review':
        startLearningReview()
        notify('已进入复习')
        break
      case 'send':
        if (!activeSession) break
        setView('agent')
        sendMessage(command.action.text)
        notify(`已发送给 ${AGENT_META[activeSession.agent].shortName}`)
        break
    }

    onClose()
  }

  return (
    <m.div
      className="w1-paletteback"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.paletteBackdrop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closingRef.current) onClose()
      }}
    >
      <m.div
        className="w1-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        initial={{ opacity: 0, transform: 'translateY(-12px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(-8px)' }}
        transition={{ duration: DURATION.palette, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Tab') event.preventDefault()
        }}
      >
        <Command label="命令面板" loop shouldFilter={false} className="w1-cmdroot">
          <div className="w1-paletterow">
            <span className="w1-paletteprompt">&gt;</span>
            <Command.Input
              ref={inputRef}
              className="w1-paletteinput"
              value={query}
              onValueChange={setQuery}
              placeholder="搜索任务、笔记、会话与学习卡，或执行操作…"
              aria-label="命令搜索"
            />
            <kbd>ESC</kbd>
          </div>

          <Command.List label="命令结果" className="w1-palettelist">
            <Command.Empty className="w1-paletteempty">
              没有匹配项 · 输入内容后可直接交给 Agent
            </Command.Empty>

            {showSearchFirst ? renderSearchGroups() : null}

            {GROUPS.map((group) => {
              const items = visibleCommands.filter((command) => command.group === group)
              if (items.length === 0) return null

              return (
                <Command.Group key={group} heading={group} className="w1-palettegroup">
                  {items.map((command) => (
                    <Command.Item
                      key={command.id}
                      value={command.value}
                      disabled={command.disabled}
                      className="w1-paletteitem"
                      onSelect={() => run(command)}
                    >
                      <span className={`w1-palettebadge${command.badge ? ' agent' : ''}`}>
                        {command.badge ?? ACTION_GLYPH[command.action.kind]}
                      </span>
                      <span className="w1-palettelabel">{command.label}</span>
                      <span className="w1-palettehint">{command.hint}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              )
            })}

            {!showSearchFirst ? renderSearchGroups() : null}
            {searching && trimmed ? (
              <p className="w1-palettehintline" role="status">
                正在搜索笔记与会话…
              </p>
            ) : null}
          </Command.List>

          <div className="w1-palettefoot">
            <span>
              <kbd>↑↓</kbd> 选择
            </span>
            <span>
              <kbd>↵</kbd> 执行
            </span>
            <span>
              <kbd>Esc</kbd> 关闭
            </span>
            <b>本地数据</b>
          </div>
        </Command>
      </m.div>
    </m.div>
  )
}
