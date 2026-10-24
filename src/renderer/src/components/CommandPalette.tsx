import { useEffect, useRef, useState } from 'react'
import { Command } from 'cmdk'
import { m } from 'motion/react'
import { AGENT_META } from '../lib/agent'
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
}

const GROUPS: readonly PaletteGroup[] = ['会话', '操作', '交给 Agent']

const ACTION_GLYPH: Record<PaletteCommand['action']['kind'], string> = {
  session: '›',
  'new-note': '+',
  focus: '▶',
  filter: '▤',
  motion: '◐',
  theme: '◑',
  send: '↵'
}

export function CommandPalette({ onClose, notify }: CommandPaletteProps) {
  const sessions = useWorkstation((state) => state.sessions)
  const activeSessionId = useWorkstation((state) => state.activeSessionId)
  const activeSession = useWorkstation(selectActiveSession)
  const taskFilter = useWorkstation((state) => state.taskFilter)
  const motionOn = useWorkstation((state) => state.motionOn)
  const theme = useWorkstation((state) => state.theme)
  const typing = useWorkstation((state) => state.typing)
  const setActiveSession = useWorkstation((state) => state.setActiveSession)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)
  const startFocus = useWorkstation((state) => state.startFocus)
  const setFilter = useWorkstation((state) => state.setFilter)
  const toggleMotion = useWorkstation((state) => state.toggleMotion)
  const toggleTheme = useWorkstation((state) => state.toggleTheme)
  const sendMessage = useWorkstation((state) => state.sendMessage)

  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const closingRef = useRef(false)

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

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const run = (command: PaletteCommand) => {
    if (command.disabled || closingRef.current) return
    closingRef.current = true

    switch (command.action.kind) {
      case 'session':
        if (command.action.sessionId !== activeSessionId) setActiveSession(command.action.sessionId)
        break
      case 'new-note':
        openQuickNote()
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
      case 'send':
        if (!activeSession) break
        sendMessage(command.action.text)
        notify(`已交给 ${AGENT_META[activeSession.agent].shortName} · 演示回复`)
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
      transition={{ duration: 0.22 }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closingRef.current) onClose()
      }}
    >
      <m.div
        className="w1-palette"
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
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
              placeholder="搜索会话、执行操作，或直接交给 Agent…"
              aria-label="命令搜索"
            />
            <kbd>ESC</kbd>
          </div>

          <Command.List label="命令结果" className="w1-palettelist">
            <Command.Empty className="w1-paletteempty">
              没有匹配项 · 输入内容后可直接交给 Agent
            </Command.Empty>

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
            <b>本地 · 演示数据</b>
          </div>
        </Command>
      </m.div>
    </m.div>
  )
}
