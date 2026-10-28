import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addDaysKey, dateKey } from '../../../shared/date-key'
import { createInitialData } from '../data/mock'
import { getTodayIndex } from '../lib/date'
import {
  bindTaskPersistence,
  selectPreviewNotes,
  selectVisibleTasks,
  useWorkstation
} from './useWorkstation'

beforeEach(() => {
  useWorkstation.setState(createInitialData())
  bindTaskPersistence(null)
})

describe('任务', () => {
  it('切换完成状态并同步筛选结果', () => {
    const state = useWorkstation.getState()
    expect(selectVisibleTasks(state)).toHaveLength(8)

    state.toggleTask('t2')

    const next = useWorkstation.getState()
    expect(next.tasks.find((task) => task.id === 't2')?.done).toBe(true)
    expect(selectVisibleTasks(next).filter((task) => !task.done)).toHaveLength(5)
  })

  it('可以撤销完成状态', () => {
    useWorkstation.getState().toggleTask('t1')
    useWorkstation.getState().toggleTask('t1')
    expect(useWorkstation.getState().tasks.find((task) => task.id === 't1')?.done).toBe(true)
  })

  it('按待办与已完成筛选', () => {
    useWorkstation.getState().setFilter('done')
    expect(selectVisibleTasks(useWorkstation.getState()).every((task) => task.done)).toBe(true)

    useWorkstation.getState().setFilter('todo')
    expect(selectVisibleTasks(useWorkstation.getState()).every((task) => !task.done)).toBe(true)
    expect(selectVisibleTasks(useWorkstation.getState())).toHaveLength(6)
  })
})

describe('习惯', () => {
  it('翻转今日打卡并保持其他日期不变', () => {
    const before = useWorkstation.getState().habits.find((habit) => habit.id === 'h1')!
    const todayIndex = getTodayIndex()
    const target = before.days[todayIndex]

    useWorkstation.getState().toggleHabitToday('h1')

    const after = useWorkstation.getState().habits.find((habit) => habit.id === 'h1')!
    expect(after.days[todayIndex]).toBe(!target)
    expect(after.days.filter((_, index) => index !== todayIndex)).toEqual(
      before.days.filter((_, index) => index !== todayIndex)
    )
  })
})

describe('任务完成时间', () => {
  it('勾选时记录完成时间，取消时清除', () => {
    const before = Date.now()

    useWorkstation.getState().toggleTask('t2')
    const done = useWorkstation.getState().tasks.find((task) => task.id === 't2')!
    expect(done.done).toBe(true)
    expect(done.completedAt).toBeGreaterThanOrEqual(before)

    useWorkstation.getState().toggleTask('t2')
    const undone = useWorkstation.getState().tasks.find((task) => task.id === 't2')!
    expect(undone.done).toBe(false)
    expect(undone.completedAt).toBeUndefined()
  })
})

describe('计划字段', () => {
  it('计划日期与预计时长可更新并可清空', () => {
    useWorkstation.getState().updateTask('t3', { plannedFor: '2026-10-27', estimateMinutes: 60 })

    const planned = useWorkstation.getState().tasks.find((task) => task.id === 't3')
    expect(planned).toMatchObject({ plannedFor: '2026-10-27', estimateMinutes: 60 })

    useWorkstation.getState().updateTask('t3', { plannedFor: null })
    expect(
      useWorkstation.getState().tasks.find((task) => task.id === 't3')?.plannedFor
    ).toBeUndefined()
  })
})

describe('权限请求', () => {
  it('允许后清空待确认并写入任务变更', () => {
    expect(useWorkstation.getState().permission).not.toBeNull()

    useWorkstation.getState().resolvePermission('allow')

    const state = useWorkstation.getState()
    expect(state.permission).toBeNull()
    expect(state.resolution).toEqual({ sessionId: 's-c1', decision: 'allowed' })
    expect(state.tasks.find((task) => task.id === 't8')?.time).toBe('09:00')
    expect(state.tasks.find((task) => task.id === 't8')?.tag).toBe('明天')
    expect(state.tasks.find((task) => task.id === 't6')?.time).toBe('22:00')
    expect(state.sessions.find((session) => session.id === 's-c1')?.status).toBe('run')
  })

  it('拒绝后保持任务原样', () => {
    const before = useWorkstation.getState().tasks

    useWorkstation.getState().resolvePermission('deny')

    const state = useWorkstation.getState()
    expect(state.permission).toBeNull()
    expect(state.resolution).toEqual({ sessionId: 's-c1', decision: 'denied' })
    expect(state.tasks).toEqual(before)
    expect(state.sessions.find((session) => session.id === 's-c1')?.status).toBe('run')
  })
})

describe('对话', () => {
  it('发送消息后进入等待回复状态', () => {
    useWorkstation.getState().sendMessage('把复习放到晚上')

    const state = useWorkstation.getState()
    const thread = state.threads[state.activeSessionId]
    expect(thread.at(-1)).toMatchObject({ role: 'user', text: '把复习放到晚上' })
    expect(state.typing).toBe(true)
    expect(state.pendingReplyTo).toBe('s-c1')
  })

  it('收到回复后追加助手消息并结束等待', () => {
    useWorkstation.getState().sendMessage('把复习放到晚上')
    useWorkstation
      .getState()
      .receiveReply('已放到 20:30。', [{ name: 'study.plan', meta: '20:30–21:00', status: '完成' }])

    const state = useWorkstation.getState()
    const thread = state.threads[state.activeSessionId]
    expect(thread.at(-1)).toMatchObject({
      role: 'assistant',
      text: '已放到 20:30。'
    })
    expect(thread.at(-1)?.tools?.[0].name).toBe('study.plan')
    expect(state.typing).toBe(false)
    expect(state.pendingReplyTo).toBeNull()
  })

  it('每个会话拥有独立对话', () => {
    useWorkstation.getState().setActiveSession('s-c2')

    const state = useWorkstation.getState()
    expect(state.threads['s-c2']).toBeDefined()
    expect(state.threads['s-c2']).not.toEqual(state.threads['s-c1'])
  })

  it('切换会话后回复仍回到发起消息的会话', () => {
    useWorkstation.getState().sendMessage('先只改任务')
    useWorkstation.getState().setActiveSession('s-x1')
    useWorkstation.getState().receiveReply('好的，等待你的确认。')

    const state = useWorkstation.getState()
    expect(state.threads['s-c1'].at(-1)).toMatchObject({
      role: 'assistant',
      text: '好的，等待你的确认。'
    })
    expect(state.threads['s-x1'].at(-1)?.text).not.toBe('好的，等待你的确认。')
    expect(state.pendingReplyTo).toBeNull()
  })
})

describe('持久化', () => {
  it('勾选任务时写入数据库', () => {
    const setDone = vi.fn().mockResolvedValue(undefined)
    bindTaskPersistence({
      setDone,
      applySchedule: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      renameList: vi.fn()
    })

    useWorkstation.getState().toggleTask('t2')

    expect(setDone).toHaveBeenCalledWith('t2', true)
  })

  it('允许权限变更时批量写入新时间与日期', () => {
    const applySchedule = vi.fn().mockResolvedValue(undefined)
    bindTaskPersistence({
      setDone: vi.fn().mockResolvedValue(undefined),
      applySchedule,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      renameList: vi.fn()
    })

    useWorkstation.getState().resolvePermission('allow')

    const tomorrow = addDaysKey(dateKey(), 1)
    expect(applySchedule).toHaveBeenCalledTimes(1)
    expect(applySchedule.mock.calls[0][0]).toEqual([
      { taskId: 't8', toTime: '09:00', toTag: '明天', toDueDate: tomorrow },
      { taskId: 't6', toTime: '22:00', toTag: '已顺延' },
      { taskId: 't7', toTime: '20:00', toTag: '明天', toDueDate: tomorrow }
    ])
    const tasks = useWorkstation.getState().tasks
    expect(tasks.find((task) => task.id === 't8')?.dueDate).toBe(tomorrow)
    expect(tasks.find((task) => task.id === 't7')?.dueDate).toBe(tomorrow)
    expect(tasks.find((task) => task.id === 't6')?.dueDate).toBe(dateKey())
  })

  it('拒绝权限变更时不写库', () => {
    const applySchedule = vi.fn().mockResolvedValue(undefined)
    bindTaskPersistence({
      setDone: vi.fn().mockResolvedValue(undefined),
      applySchedule,
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      renameList: vi.fn()
    })

    useWorkstation.getState().resolvePermission('deny')

    expect(applySchedule).not.toHaveBeenCalled()
  })

  it('写库失败不阻断界面状态', async () => {
    const setDone = vi.fn().mockRejectedValue(new Error('disk full'))
    bindTaskPersistence({
      setDone,
      applySchedule: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore: vi.fn(),
      renameList: vi.fn()
    })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => useWorkstation.getState().toggleTask('t2')).not.toThrow()
    await Promise.resolve()

    expect(useWorkstation.getState().tasks.find((task) => task.id === 't2')?.done).toBe(true)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('笔记预览选择', () => {
  const note = (id: string, pinned = false) => ({ id, text: id, time: '12:00', pinned })

  it('置顶笔记优先生效，并返回两条其余笔记', () => {
    const result = selectPreviewNotes([note('a'), note('b', true), note('c'), note('d')])

    expect(result.pinned?.id).toBe('b')
    expect(result.rest.map((item) => item.id)).toEqual(['a', 'c'])
  })

  it('没有置顶时取第一条', () => {
    const result = selectPreviewNotes([note('a'), note('b'), note('c')])

    expect(result.pinned?.id).toBe('a')
    expect(result.rest.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('笔记不足时返回可用的部分', () => {
    expect(selectPreviewNotes([note('only')])).toEqual({ pinned: note('only'), rest: [] })
    expect(selectPreviewNotes([])).toEqual({ pinned: undefined, rest: [] })
  })

  it('只遍历到凑够两条，不复制整个数组', () => {
    const many = Array.from({ length: 5000 }, (_, index) => note(`n${index}`, index === 2000))
    const result = selectPreviewNotes(many)

    expect(result.pinned?.id).toBe('n2000')
    expect(result.rest.map((item) => item.id)).toEqual(['n0', 'n1'])
  })
})

describe('视图导航', () => {
  it('默认进入今日看板', () => {
    expect(useWorkstation.getState().activeView).toBe('today')
  })

  it('可在三个工作区之间切换', () => {
    useWorkstation.getState().setView('agent')
    expect(useWorkstation.getState().activeView).toBe('agent')

    useWorkstation.getState().setView('notes')
    expect(useWorkstation.getState().activeView).toBe('notes')

    useWorkstation.getState().setView('today')
    expect(useWorkstation.getState().activeView).toBe('today')
  })

  it('打开会话时同时切换到 Agent 工作区', () => {
    useWorkstation.getState().setView('notes')
    useWorkstation.getState().openAgentSession('s-x1')

    const state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-x1')
    expect(state.activeView).toBe('agent')
  })

  it('忽略不存在的会话', () => {
    useWorkstation.getState().openAgentSession('missing')

    const state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-c1')
    expect(state.activeView).toBe('today')
  })

  it('在 Agent 工作区内切换会话不改变工作区', () => {
    useWorkstation.getState().setView('agent')
    useWorkstation.getState().setActiveSession('s-x1')

    const state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-x1')
    expect(state.activeView).toBe('agent')
  })

  it('打开全部笔记切换到笔记工作区', () => {
    useWorkstation.getState().openNotesView()
    expect(useWorkstation.getState().activeView).toBe('notes')
  })
})

describe('周边状态', () => {
  it('切换动效开关', () => {
    expect(useWorkstation.getState().motionOn).toBe(true)
    useWorkstation.getState().toggleMotion()
    expect(useWorkstation.getState().motionOn).toBe(false)
  })

  it('切换白天与夜间主题', () => {
    expect(useWorkstation.getState().theme).toBe('dark')

    useWorkstation.getState().toggleTheme()
    expect(useWorkstation.getState().theme).toBe('light')

    useWorkstation.getState().toggleTheme()
    expect(useWorkstation.getState().theme).toBe('dark')
  })

  it('新增笔记并置顶', () => {
    const before = useWorkstation.getState().notes.length
    useWorkstation.getState().addNote('把权限队列做成全局的')
    const state = useWorkstation.getState()
    expect(state.notes).toHaveLength(before + 1)
    expect(state.notes[0]).toMatchObject({ text: '把权限队列做成全局的', time: '刚刚' })
    expect(state.quickNoteOpen).toBe(false)
  })

  it('打开与关闭专注', () => {
    useWorkstation.getState().startFocus('复习 · 12 张卡', 18)
    expect(useWorkstation.getState().focus).toEqual({ label: '复习 · 12 张卡', minutes: 18 })
    useWorkstation.getState().closeFocus()
    expect(useWorkstation.getState().focus).toBeNull()
  })
})

describe('删除与撤销', () => {
  it('删除后记住被删任务与位置', () => {
    const state = useWorkstation.getState()
    const target = state.tasks[2]
    state.removeTask(target.id)

    const after = useWorkstation.getState()
    expect(after.tasks.some((task) => task.id === target.id)).toBe(false)
    expect(after.lastRemovedTask).toMatchObject({ index: 2, task: { id: target.id } })
  })

  it('撤销后原位放回并调用持久化 restore', () => {
    const restore = vi.fn().mockResolvedValue(undefined)
    bindTaskPersistence({
      setDone: vi.fn().mockResolvedValue(undefined),
      applySchedule: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore,
      renameList: vi.fn()
    })

    const before = useWorkstation.getState().tasks.map((task) => task.id)
    const target = before[2]
    useWorkstation.getState().removeTask(target)
    useWorkstation.getState().undoRemoveTask()

    const after = useWorkstation.getState()
    expect(after.tasks.map((task) => task.id)).toEqual(before)
    expect(after.lastRemovedTask).toBeNull()
    expect(restore).toHaveBeenCalledWith(target)
  })

  it('没有可撤销任务时撤销是空操作', () => {
    const restore = vi.fn().mockResolvedValue(undefined)
    bindTaskPersistence({
      setDone: vi.fn().mockResolvedValue(undefined),
      applySchedule: vi.fn().mockResolvedValue(undefined),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
      restore,
      renameList: vi.fn()
    })

    const before = useWorkstation.getState().tasks.map((task) => task.id)
    useWorkstation.getState().undoRemoveTask()

    expect(useWorkstation.getState().tasks.map((task) => task.id)).toEqual(before)
    expect(restore).not.toHaveBeenCalled()
  })
})
