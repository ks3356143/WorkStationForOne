import type { Theme } from '../../../shared/ipc'
import type { Session, TaskFilter, View } from '../types'
import { AGENT_META } from './agent'

export type PaletteGroup = '会话' | '导航' | '操作' | '交给 Agent'

export type PaletteAction =
  | { kind: 'session'; sessionId: string }
  | { kind: 'view'; view: View }
  | { kind: 'new-note' }
  | { kind: 'new-task' }
  | { kind: 'focus' }
  | { kind: 'filter'; filter: TaskFilter }
  | { kind: 'motion' }
  | { kind: 'theme' }
  | { kind: 'review' }
  | { kind: 'shortcuts' }
  | { kind: 'backup' }
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
  theme: Theme
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
      id: 'view:today',
      group: '导航',
      label: '打开今日看板',
      hint: '工作区',
      value: '今日 看板 任务 习惯 today dashboard',
      action: { kind: 'view', view: 'today' }
    },
    {
      id: 'view:tasks',
      group: '导航',
      label: '打开任务工作区',
      hint: '工作区',
      value: '任务 工作区 清单 todo task',
      action: { kind: 'view', view: 'tasks' }
    },
    {
      id: 'view:agent',
      group: '导航',
      label: '打开 Agent 工作区',
      hint: '工作区',
      value: 'Agent 工作区 会话 对话 agent',
      action: { kind: 'view', view: 'agent' }
    },
    {
      id: 'view:notes',
      group: '导航',
      label: '打开全部笔记',
      hint: '工作区',
      value: '全部笔记 笔记 搜索 notes',
      action: { kind: 'view', view: 'notes' }
    },
    {
      id: 'view:learning',
      group: '导航',
      label: '打开学习卡片库',
      hint: '工作区',
      value: '学习 卡片库 复习 闪卡 learning cards',
      action: { kind: 'view', view: 'learning' }
    },
    {
      id: 'action:backup',
      group: '操作',
      label: '立即备份数据',
      hint: 'VACUUM INTO',
      value: '备份 导出 backup 快照 数据安全',
      action: { kind: 'backup' }
    },
    {
      id: 'action:shortcuts',
      group: '操作',
      label: '快捷键速查',
      hint: '按 ? 打开',
      value: '快捷键 键位 速查 帮助 shortcuts keys help',
      action: { kind: 'shortcuts' }
    },
    {
      id: 'action:review',
      group: '操作',
      label: '开始复习',
      hint: '间隔重复',
      value: '开始复习 闪卡 学习 review study',
      action: { kind: 'review' }
    },
    {
      id: 'action:note',
      group: '操作',
      label: '新建快速笔记',
      hint: '^N',
      value: '新建快速笔记 记笔记 note',
      action: { kind: 'new-note' }
    },
    {
      id: 'action:task',
      group: '操作',
      label: '新建任务',
      hint: '^⇧N',
      value: '新建任务 添加任务 捕获 todo task',
      action: { kind: 'new-task' }
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
    },
    {
      id: 'action:theme',
      group: '操作',
      label: input.theme === 'light' ? '切换到夜间模式' : '切换到白天模式',
      hint: '外观',
      value: `主题 白天 夜间 浅色 深色 theme ${input.theme}`,
      action: { kind: 'theme' }
    }
  )

  for (const filter of ['all', 'todo', 'done'] as const) {
    const current = input.taskFilter === filter
    commands.push({
      id: `filter:${filter}`,
      group: '操作',
      label: `今日卡筛选 · ${FILTER_LABEL[filter]}`,
      hint: current ? '当前' : '切换',
      value: `今日卡筛选 任务 看板 ${FILTER_LABEL[filter]} ${filter}`,
      action: { kind: 'filter', filter }
    })
  }

  const text = input.query.trim()
  const active =
    input.sessions.find((session) => session.id === input.activeSessionId) ?? input.sessions[0]
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

export function visiblePaletteCommands(
  commands: PaletteCommand[],
  query: string
): PaletteCommand[] {
  const needle = query.trim().toLowerCase()
  const base = commands.filter((command) => command.action.kind !== 'send')
  const send = commands.filter((command) => command.action.kind === 'send')

  if (!needle) return base

  const tokens = needle.split(/\s+/)
  return [
    ...base.filter((command) =>
      tokens.every((token) =>
        `${command.label} ${command.hint} ${command.value}`.toLowerCase().includes(token)
      )
    ),
    ...send
  ]
}
