import type { Session, TaskFilter } from '../types'
import { AGENT_META } from './agent'

export type PaletteGroup = '会话' | '操作' | '交给 Agent'

export type PaletteAction =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new-note' }
  | { kind: 'focus' }
  | { kind: 'filter'; filter: TaskFilter }
  | { kind: 'motion' }
  | { kind: 'send'; text: string }

export interface PaletteCommand {
  id: string
  group: PaletteGroup
  label: string
  hint: string
  value: string
  badge?: string
  disabled?: boolean
  action: PaletteAction
}

interface PaletteInput {
  sessions: Session[]
  activeSessionId: string
  taskFilter: TaskFilter
  motionOn: boolean
  query: string
  typing?: boolean
}

const STATUS_LABEL: Record<Session['status'], string> = {
  run: '运行中',
  wait: '待确认',
  idle: '空闲'
}

const FILTER_LABEL: Record<TaskFilter, string> = {
  all: '全部',
  todo: '待办',
  done: '已完成'
}

export function buildPaletteCommands(input: PaletteInput): PaletteCommand[] {
  const commands: PaletteCommand[] = input.sessions.map((session) => {
    const meta = AGENT_META[session.agent]
    const status = STATUS_LABEL[session.status]
    const current = session.id === input.activeSessionId

    return {
      id: `session:${session.id}`,
      group: '会话',
      label: session.title,
      hint: `${meta.shortName} · ${status}${current ? ' · 当前' : ''}`,
      value: `${session.title} ${meta.name} ${meta.shortName} ${status} ${session.id}`,
      badge: meta.badge,
      action: { kind: 'session', sessionId: session.id }
    }
  })

  commands.push(
    {
      id: 'action:note',
      group: '操作',
      label: '新建快速笔记',
      hint: '^N',
      value: '新建快速笔记 记笔记 note',
      action: { kind: 'new-note' }
    },
    {
      id: 'action:focus',
      group: '操作',
      label: '开始 25 分钟专注',
      hint: '深度工作',
      value: '开始专注 深度工作 focus',
      action: { kind: 'focus' }
    },
    {
      id: 'action:motion',
      group: '操作',
      label: input.motionOn ? '暂停动效' : '恢复动效',
      hint: '外观',
      value: `动效 motion ${input.motionOn ? '暂停 关闭' : '恢复 开启'}`,
      action: { kind: 'motion' }
    }
  )

  for (const filter of ['all', 'todo', 'done'] as const) {
    const current = input.taskFilter === filter
    commands.push({
      id: `filter:${filter}`,
      group: '操作',
      label: `任务筛选 · ${FILTER_LABEL[filter]}`,
      hint: current ? '当前' : '切换',
      value: `任务筛选 ${FILTER_LABEL[filter]} ${filter}`,
      action: { kind: 'filter', filter }
    })
  }

  const text = input.query.trim()
  const active = input.sessions.find((session) => session.id === input.activeSessionId) ?? input.sessions[0]
  if (text && active) {
    const meta = AGENT_META[active.agent]
    commands.push({
      id: 'action:send',
      group: '交给 Agent',
      label: `发送给 ${meta.shortName}`,
      hint: input.typing ? '等待回复中' : '回车发送',
      value: `${text} ↵ 发送给 ${meta.shortName}`,
      disabled: input.typing,
      action: { kind: 'send', text }
    })
  }

  return commands
}

export function visiblePaletteCommands(commands: PaletteCommand[], query: string): PaletteCommand[] {
  const needle = query.trim().toLowerCase()
  const base = commands.filter((command) => command.action.kind !== 'send')
  const send = commands.filter((command) => command.action.kind === 'send')

  if (!needle) return base

  const tokens = needle.split(/\s+/)
  return [
    ...base.filter((command) => tokens.every((token) => command.value.toLowerCase().includes(token))),
    ...send
  ]
}
