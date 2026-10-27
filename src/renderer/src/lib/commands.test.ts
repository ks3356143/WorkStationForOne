import { describe, expect, it } from 'vitest'
import type { Session } from '../types'
import { buildPaletteCommands, visiblePaletteCommands } from './commands'

const sessions: Session[] = [
  {
    id: 's-c1',
    agent: 'claude',
    title: '重构 auth 模块',
    meta: '00:42 · 3 个文件',
    status: 'run',
    threadDate: '今天'
  },
  {
    id: 's-x1',
    agent: 'codex',
    title: '周报草稿',
    meta: '00:12 · 只读',
    status: 'idle',
    threadDate: '今天'
  }
]

const base = {
  sessions,
  activeSessionId: 's-c1',
  taskFilter: 'all' as const,
  motionOn: true,
  theme: 'dark' as const,
  query: ''
}

describe('buildPaletteCommands', () => {
  it('每个会话生成一条命令，并标出当前会话', () => {
    const sessionCommands = buildPaletteCommands(base).filter((command) => command.group === '会话')

    expect(sessionCommands).toHaveLength(2)
    expect(sessionCommands[0]).toMatchObject({
      id: 'session:s-c1',
      label: '重构 auth 模块',
      badge: 'C',
      action: { kind: 'session', sessionId: 's-c1' }
    })
    expect(sessionCommands[0].hint).toContain('当前')
    expect(sessionCommands[1]).toMatchObject({
      badge: 'X',
      action: { kind: 'session', sessionId: 's-x1' }
    })
    expect(sessionCommands[1].hint).not.toContain('当前')
  })

  it('导航命令覆盖四个工作区', () => {
    const navigation = buildPaletteCommands(base).filter((command) => command.group === '导航')

    expect(navigation.map((command) => command.id)).toEqual([
      'view:today',
      'view:tasks',
      'view:agent',
      'view:notes'
    ])
    expect(navigation.map((command) => command.action)).toEqual([
      { kind: 'view', view: 'today' },
      { kind: 'view', view: 'tasks' },
      { kind: 'view', view: 'agent' },
      { kind: 'view', view: 'notes' }
    ])
    expect(navigation.every((command) => command.hint === '工作区')).toBe(true)
  })

  it('操作命令包含笔记、任务、专注、动效、主题与三种筛选', () => {
    const ids = buildPaletteCommands(base).map((command) => command.id)

    expect(ids).toEqual(
      expect.arrayContaining([
        'action:note',
        'action:task',
        'action:focus',
        'action:motion',
        'action:theme',
        'filter:all',
        'filter:todo',
        'filter:done'
      ])
    )
  })

  it('主题命令文案跟随当前模式', () => {
    const dark = buildPaletteCommands(base).find((command) => command.id === 'action:theme')
    const light = buildPaletteCommands({ ...base, theme: 'light' }).find(
      (command) => command.id === 'action:theme'
    )

    expect(dark).toMatchObject({ label: '切换到白天模式', action: { kind: 'theme' } })
    expect(light).toMatchObject({ label: '切换到夜间模式', action: { kind: 'theme' } })
  })

  it('动效命令文案跟随开关状态', () => {
    const on = buildPaletteCommands(base).find((command) => command.id === 'action:motion')
    const off = buildPaletteCommands({ ...base, motionOn: false }).find(
      (command) => command.id === 'action:motion'
    )

    expect(on?.label).toBe('暂停动效')
    expect(off?.label).toBe('恢复动效')
  })

  it('筛选命令标出当前筛选', () => {
    const commands = buildPaletteCommands({ ...base, taskFilter: 'todo' })
    const current = commands.find((command) => command.id === 'filter:todo')
    const other = commands.find((command) => command.id === 'filter:done')

    expect(current?.hint).toBe('当前')
    expect(other?.hint).toBe('切换')
  })

  it('输入内容时追加发送命令并去掉首尾空白', () => {
    const commands = buildPaletteCommands({ ...base, query: '  整理今天的任务  ' })
    const send = commands.find((command) => command.id === 'action:send')

    expect(send).toMatchObject({
      group: '交给 Agent',
      label: '发送给 Claude',
      action: { kind: 'send', text: '整理今天的任务' }
    })
  })

  it('空白输入不生成发送命令', () => {
    expect(
      buildPaletteCommands({ ...base, query: '   ' }).some(
        (command) => command.id === 'action:send'
      )
    ).toBe(false)
  })

  it('等待回复时发送命令禁用', () => {
    const send = buildPaletteCommands({ ...base, query: '整理任务', typing: true }).find(
      (command) => command.id === 'action:send'
    )

    expect(send?.disabled).toBe(true)
    expect(send?.hint).toBe('等待回复中')
  })

  it('命令 id 与检索值唯一', () => {
    const commands = buildPaletteCommands({ ...base, query: '整理任务' })
    const ids = commands.map((command) => command.id)
    const values = commands.map((command) => command.value)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(values).size).toBe(values.length)
  })

  it('无会话时不生成发送命令', () => {
    const commands = buildPaletteCommands({
      ...base,
      sessions: [],
      activeSessionId: '',
      query: 'hello'
    })

    expect(commands.some((command) => command.id === 'action:send')).toBe(false)
    expect(visiblePaletteCommands(commands, 'hello')).toEqual([])
  })
})

describe('visiblePaletteCommands', () => {
  it('会话命中时发送项仍排在最后', () => {
    const visible = visiblePaletteCommands(buildPaletteCommands({ ...base, query: 'auth' }), 'auth')

    expect(visible.map((command) => command.id)).toEqual(['session:s-c1', 'action:send'])
  })

  it('操作命中时发送项仍排在最后', () => {
    const visible = visiblePaletteCommands(buildPaletteCommands({ ...base, query: '待办' }), '待办')

    expect(visible[0].id).toBe('filter:todo')
    expect(visible[visible.length - 1].id).toBe('action:send')
  })

  it('命令标题也可用于检索', () => {
    const visible = visiblePaletteCommands(
      buildPaletteCommands({ ...base, query: '打开全部笔记' }),
      '打开全部笔记'
    )

    expect(visible[0].id).toBe('view:notes')
    expect(visible.at(-1)?.id).toBe('action:send')
  })

  it('无匹配时只保留发送项', () => {
    const visible = visiblePaletteCommands(
      buildPaletteCommands({ ...base, query: '完全不存在的命令' }),
      '完全不存在的命令'
    )

    expect(visible.map((command) => command.id)).toEqual(['action:send'])
    expect(visible[0].action).toEqual({ kind: 'send', text: '完全不存在的命令' })
  })

  it('空检索不包含发送项', () => {
    const visible = visiblePaletteCommands(buildPaletteCommands(base), '   ')

    expect(visible.some((command) => command.action.kind === 'send')).toBe(false)
  })
})
