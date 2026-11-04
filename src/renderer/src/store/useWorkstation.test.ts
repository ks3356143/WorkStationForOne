import { beforeEach, describe, expect, it, vi } from 'vitest'
import { dateKey } from '../../../shared/date-key'
import { createInitialData } from '../data/mock'
import { ERROR_DETAIL_SEPARATOR } from '../lib/errors'
import {
  bindAgentPersistence,
  bindReminderPersistence,
  bindTaskPersistence,
  selectPreviewNotes,
  selectVisibleTasks,
  useWorkstation
} from './useWorkstation'

beforeEach(() => {
  useWorkstation.setState(createInitialData())
  bindTaskPersistence(null)
  bindReminderPersistence(null)
  bindAgentPersistence(null)
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

describe('提醒静音', () => {
  it('静音、撤销与恢复全部同步写入仓储', () => {
    const persistence = {
      mute: vi.fn().mockResolvedValue(undefined),
      unmute: vi.fn().mockResolvedValue(undefined),
      unmuteDay: vi.fn().mockResolvedValue(undefined)
    }
    bindReminderPersistence(persistence)
    const day = '2026-11-03'

    useWorkstation.getState().muteReminder('t2', day)
    expect(useWorkstation.getState().reminderMutes).toEqual({ day, taskIds: ['t2'] })
    expect(persistence.mute).toHaveBeenCalledWith('t2', day)

    useWorkstation.getState().muteReminder('t2', day)
    expect(useWorkstation.getState().reminderMutes.taskIds).toEqual(['t2'])

    useWorkstation.getState().unmuteReminder('t2', day)
    expect(useWorkstation.getState().reminderMutes).toEqual({ day, taskIds: [] })
    expect(persistence.unmute).toHaveBeenCalledWith('t2', day)

    useWorkstation.getState().muteReminder('t2', day)
    useWorkstation.getState().clearReminderMutes(day)
    expect(useWorkstation.getState().reminderMutes).toEqual({ day, taskIds: [] })
    expect(persistence.unmuteDay).toHaveBeenCalledWith(day)
  })

  it('换天后的新静音替换旧日期的列表', () => {
    useWorkstation.getState().setReminderMutes('2026-11-02', ['t1', 't2'])
    useWorkstation.getState().muteReminder('t3', '2026-11-03')

    expect(useWorkstation.getState().reminderMutes).toEqual({
      day: '2026-11-03',
      taskIds: ['t3']
    })
  })
})

describe('Agent 真分叉状态', () => {
  const session = (extra: Record<string, unknown> = {}) => ({
    id: 's1',
    agent: 'claude' as const,
    title: '原会话',
    meta: '刚刚 · 1 条',
    status: 'idle' as const,
    threadDate: '今天',
    ...extra
  })

  it('setAgentResume 清除待分叉标记并持久化', () => {
    const updateSession = vi.fn().mockResolvedValue(undefined)
    bindAgentPersistence({
      createSession: vi.fn(),
      updateSession,
      saveMessage: vi.fn()
    })
    useWorkstation.setState({
      sessions: [session({ resumeId: 'source-1', pendingFork: true, forkTurnId: 'turn-1' })],
      activeSessionId: 's1'
    })

    useWorkstation.getState().setAgentResume('s1', 'forked-1')

    expect(useWorkstation.getState().sessions[0]).toMatchObject({
      resumeId: 'forked-1',
      pendingFork: false,
      forkTurnId: undefined
    })
    expect(updateSession).toHaveBeenCalledWith('s1', {
      resumeId: 'forked-1',
      pendingFork: false,
      forkTurnId: null
    })
  })

  it('addForkedSession 保留源 resumeId 与待分叉标记', () => {
    useWorkstation.setState({ sessions: [], threads: {} })

    useWorkstation.getState().addForkedSession({
      mode: 'cli',
      session: {
        id: 's2',
        agent: 'claude',
        title: '原会话 · 分叉',
        status: 'idle',
        resumeId: 'source-1',
        pendingFork: true,
        forkTurnId: 'turn-1',
        createdAt: 1,
        updatedAt: 1
      },
      messages: []
    })

    expect(useWorkstation.getState().sessions[0]).toMatchObject({
      id: 's2',
      resumeId: 'source-1',
      pendingFork: true,
      forkTurnId: 'turn-1'
    })
  })

  it('Codex 回合 id 随助手消息落库', () => {
    const saveMessage = vi.fn().mockResolvedValue(undefined)
    bindAgentPersistence({
      createSession: vi.fn(),
      updateSession: vi.fn().mockResolvedValue(undefined),
      saveMessage
    })
    useWorkstation.setState({
      sessions: [session({ agent: 'codex' })],
      activeSessionId: 's1',
      threads: {}
    })

    const store = useWorkstation.getState()
    store.beginAgentReply('s1', 'run-1')
    store.setAgentTurnId('s1', 'turn-1')
    store.appendAgentText('s1', '答复')
    store.finishAgentReply('s1')

    expect(useWorkstation.getState().threads.s1?.[0]).toMatchObject({
      text: '答复',
      turnId: 'turn-1'
    })
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ turnId: 'turn-1', text: '答复' })
    )
  })
})

describe('习惯', () => {
  it('翻转今日打卡并保持其他日期不变', () => {
    const before = useWorkstation.getState().habits.find((habit) => habit.id === 'h1')!
    const todayKey = dateKey()
    const target = before.checkins.includes(todayKey)

    useWorkstation.getState().toggleHabitToday('h1')

    const after = useWorkstation.getState().habits.find((habit) => habit.id === 'h1')!
    expect(after.checkins.includes(todayKey)).toBe(!target)
    expect(after.checkins.filter((day) => day !== todayKey)).toEqual(
      before.checkins.filter((day) => day !== todayKey)
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

describe('对话', () => {
  const session = (id: string, agent: 'claude' | 'codex', title: string) => ({
    id,
    agent,
    title,
    meta: '刚刚 · 0 条',
    status: 'idle' as const,
    threadDate: '今天'
  })

  beforeEach(() => {
    useWorkstation.setState({
      sessions: [
        session('s-1', 'claude', '会话一'),
        session('s-2', 'claude', '会话二'),
        session('s-x1', 'codex', 'Codex 会话')
      ],
      activeSessionId: 's-1',
      threads: { 's-1': [], 's-2': [], 's-x1': [] }
    })
  })

  it('发送消息后进入等待回复状态', () => {
    useWorkstation.getState().sendMessage('把复习放到晚上')

    const state = useWorkstation.getState()
    const thread = state.threads[state.activeSessionId]
    expect(thread.at(-1)).toMatchObject({ role: 'user', text: '把复习放到晚上' })
    expect(state.typing).toBe(true)
    expect(state.pendingReplyTo).toBe('s-1')
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
    useWorkstation.getState().setActiveSession('s-2')

    const state = useWorkstation.getState()
    expect(state.threads['s-2']).toBeDefined()
    expect(state.threads['s-2']).not.toBe(state.threads['s-1'])
  })

  it('新建 Codex 会话保留 agent 类型', () => {
    useWorkstation.getState().createAgentSession('codex')

    const state = useWorkstation.getState()
    const created = state.sessions[0]
    expect(created).toMatchObject({ agent: 'codex', title: '新会话' })
    expect(state.activeSessionId).toBe(created.id)
    expect(state.threads[created.id]).toEqual([])
  })

  it('重命名会话只改标题，空标题被忽略', () => {
    const store = useWorkstation.getState()
    store.renameAgentSession('s-1', '  重构 auth 模块  ')
    expect(useWorkstation.getState().sessions.find((session) => session.id === 's-1')?.title).toBe(
      '重构 auth 模块'
    )

    useWorkstation.getState().renameAgentSession('s-1', '   ')
    expect(useWorkstation.getState().sessions.find((session) => session.id === 's-1')?.title).toBe(
      '重构 auth 模块'
    )
  })

  it('置顶会话只改标记，取消后恢复', () => {
    useWorkstation.getState().toggleAgentSessionPin('s-2')
    expect(useWorkstation.getState().sessions.find((session) => session.id === 's-2')?.pinned).toBe(
      true
    )

    useWorkstation.getState().toggleAgentSessionPin('s-2')
    expect(
      useWorkstation.getState().sessions.find((session) => session.id === 's-2')?.pinned
    ).toBeUndefined()
  })

  it('归档活跃会话后回选未归档会话，取消归档恢复', () => {
    const store = useWorkstation.getState()
    store.setActiveSession('s-2')
    store.toggleAgentSessionArchive('s-2')

    let state = useWorkstation.getState()
    expect(state.sessions.find((session) => session.id === 's-2')?.archived).toBe(true)
    expect(state.activeSessionId).toBe('s-1')
    expect(state.threads['s-2']).toBeDefined()

    store.toggleAgentSessionArchive('s-2')
    state = useWorkstation.getState()
    expect(state.sessions.find((session) => session.id === 's-2')?.archived).toBeUndefined()
    expect(state.activeSessionId).toBe('s-1')
  })

  it('运行中的会话不允许归档', () => {
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.toggleAgentSessionArchive('s-1')
    expect(
      useWorkstation.getState().sessions.find((session) => session.id === 's-1')?.archived
    ).toBeUndefined()
  })

  it('全局搜索可设置笔记详情与学习卡定位', () => {
    const store = useWorkstation.getState()
    store.openNote({ id: 'n1', text: '特征值三条性质', time: '12:20' })
    let state = useWorkstation.getState()
    expect(state.activeView).toBe('notes')
    expect(state.noteJump).toMatchObject({ id: 'n1', text: '特征值三条性质' })
    store.clearNoteJump()
    expect(useWorkstation.getState().noteJump).toBeNull()

    const learningId = state.learningItems[0]?.id ?? ''
    store.openLearningItem(learningId)
    state = useWorkstation.getState()
    expect(state.activeView).toBe('learning')
    expect(state.learningJumpId).toBe(learningId)
    expect(state.learningScope).toEqual({ kind: 'all' })
    expect(state.learningReviewOpen).toBe(false)
    store.clearLearningJump()
    expect(useWorkstation.getState().learningJumpId).toBeNull()
  })

  it('删除活跃会话后回选下一个并清掉线程状态', () => {
    const store = useWorkstation.getState()
    store.setActiveSession('s-2')
    store.sendMessage('待删除会话的消息')
    store.removeAgentSession('s-2')

    const state = useWorkstation.getState()
    expect(state.sessions.map((session) => session.id)).toEqual(['s-1', 's-x1'])
    expect(state.threads['s-2']).toBeUndefined()
    expect(state.pendingPrompts).toEqual([])
    expect(state.activeSessionId).toBe('s-x1')
    expect(state.typing).toBe(false)
  })

  it('删除非活跃会话保留当前选中', () => {
    useWorkstation.getState().setActiveSession('s-x1')
    useWorkstation.getState().removeAgentSession('s-1')

    const state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-x1')
    expect(state.sessions.map((session) => session.id)).toEqual(['s-2', 's-x1'])
    expect(state.threads['s-1']).toBeUndefined()
  })

  it('导入本机会话会选中它、带出历史并切到 Agent 视图', () => {
    const now = Date.now()
    useWorkstation.getState().importAgentSession({
      session: {
        id: 's-imported',
        agent: 'codex',
        title: '外部会话',
        status: 'idle',
        resumeId: 'codex-9',
        workspace: 'E:\\proj',
        createdAt: now - 1000,
        updatedAt: now
      },
      messages: [
        {
          id: 'import-codex-codex-9-0',
          sessionId: 's-imported',
          role: 'user',
          text: '旧问题',
          timeLabel: '10-01 12:00',
          createdAt: now - 2000,
          origin: 'import'
        }
      ]
    })

    const state = useWorkstation.getState()
    expect(state.activeView).toBe('agent')
    expect(state.activeSessionId).toBe('s-imported')
    expect(state.sessions[0]).toMatchObject({
      id: 's-imported',
      agent: 'codex',
      title: '外部会话',
      resumeId: 'codex-9',
      workspace: 'E:\\proj'
    })
    expect(state.threads['s-imported']).toEqual([
      expect.objectContaining({
        id: 'import-codex-codex-9-0',
        role: 'user',
        text: '旧问题',
        imported: true
      })
    ])
  })

  it('切换会话后回复仍回到发起消息的会话', () => {
    useWorkstation.getState().sendMessage('先只改任务')
    useWorkstation.getState().setActiveSession('s-x1')
    useWorkstation.getState().receiveReply('好的，等待你的确认。')

    const state = useWorkstation.getState()
    expect(state.threads['s-1'].at(-1)).toMatchObject({
      role: 'assistant',
      text: '好的，等待你的确认。'
    })
    expect(state.threads['s-x1'].at(-1)?.text).not.toBe('好的，等待你的确认。')
    expect(state.pendingReplyTo).toBeNull()
  })

  it('两个会话各自持有流，一个完成不结束另一个', () => {
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.beginAgentReply('s-2', 'run-2')
    store.appendAgentText('s-1', '会话一')
    store.appendAgentText('s-2', '会话二')
    store.finishAgentReply('s-1')

    const state = useWorkstation.getState()
    expect(state.streams['s-1']).toBeUndefined()
    expect(state.streams['s-2']).toMatchObject({ runId: 'run-2' })
    expect(state.threads['s-1'].at(-1)?.text).toBe('会话一')
    expect(state.threads['s-2'].at(-1)?.text).toBe('会话二')
    expect(state.sessions.find((session) => session.id === 's-1')?.status).toBe('idle')
    expect(state.sessions.find((session) => session.id === 's-2')?.status).toBe('run')
    expect(state.typing).toBe(true)
  })

  it('待发送提示词按会话排队，不会覆盖前一个会话', () => {
    const store = useWorkstation.getState()
    store.sendMessage('会话一先发')
    store.setActiveSession('s-2')
    store.sendMessage('会话二再发')

    expect(useWorkstation.getState().pendingPrompts).toEqual([
      { sessionId: 's-1', prompt: '会话一先发' },
      { sessionId: 's-2', prompt: '会话二再发' }
    ])
    expect(useWorkstation.getState().takePendingPrompt()).toEqual({
      sessionId: 's-1',
      prompt: '会话一先发'
    })
    expect(useWorkstation.getState().takePendingPrompt()).toEqual({
      sessionId: 's-2',
      prompt: '会话二再发'
    })
    expect(useWorkstation.getState().pendingPrompts).toEqual([])
  })

  it('队列被占用时可以单独取走指定会话的提示词', () => {
    const store = useWorkstation.getState()
    store.sendMessage('会话一先发')
    store.setActiveSession('s-2')
    store.sendMessage('会话二再发')

    expect(useWorkstation.getState().takePendingPrompt('s-2')).toEqual({
      sessionId: 's-2',
      prompt: '会话二再发'
    })
    expect(useWorkstation.getState().pendingPrompts).toEqual([
      { sessionId: 's-1', prompt: '会话一先发' }
    ])
  })

  it('重试只重新排队原提示，不重复写用户消息', () => {
    const store = useWorkstation.getState()
    const before = useWorkstation.getState().threads['s-1']?.length ?? 0
    store.retryMessage('原提示')

    const state = useWorkstation.getState()
    expect(state.threads['s-1']?.length ?? 0).toBe(before)
    expect(state.pendingPrompts).toEqual([{ sessionId: 's-1', prompt: '原提示' }])
    expect(state.sessions.find((session) => session.id === 's-1')?.status).toBe('run')
  })

  it('同一会话有在途回合或排队提示时不重复重试', () => {
    const store = useWorkstation.getState()
    store.retryMessage('原提示')
    store.retryMessage('原提示')

    expect(useWorkstation.getState().pendingPrompts).toEqual([
      { sessionId: 's-1', prompt: '原提示' }
    ])

    useWorkstation.getState().beginAgentReply('s-1', 'run-1')
    useWorkstation.getState().retryMessage('再来一次')
    expect(useWorkstation.getState().pendingPrompts).toHaveLength(1)
  })

  it('发送时带上附件路径并写进用户消息', () => {
    useWorkstation.getState().sendMessage('看这两个文件', ['src/a.ts', 'docs/b.md'])

    const state = useWorkstation.getState()
    expect(state.threads['s-1'].at(-1)).toMatchObject({
      role: 'user',
      text: '看这两个文件',
      contextFiles: ['src/a.ts', 'docs/b.md']
    })
    expect(state.pendingPrompts).toEqual([
      {
        sessionId: 's-1',
        prompt: '看这两个文件',
        contextFiles: ['src/a.ts', 'docs/b.md']
      }
    ])
  })

  it('重试保留原消息的附件路径', () => {
    useWorkstation.getState().retryMessage('看文件', ['src/a.ts'])

    expect(useWorkstation.getState().pendingPrompts).toEqual([
      { sessionId: 's-1', prompt: '看文件', contextFiles: ['src/a.ts'] }
    ])
  })

  it('发送图片引用并随消息落库', () => {
    const saveMessage = vi.fn(() => Promise.resolve())
    bindAgentPersistence({
      updateSession: vi.fn(() => Promise.resolve()),
      saveMessage
    } as never)
    const images = [{ id: 'img-1', name: 'shot.png', mime: 'image/png', size: 70 }]
    useWorkstation.getState().sendMessage('看图', undefined, images)

    const state = useWorkstation.getState()
    expect(state.threads['s-1'].at(-1)).toMatchObject({ role: 'user', images })
    expect(state.pendingPrompts).toEqual([{ sessionId: 's-1', prompt: '看图', images }])
    expect(saveMessage).toHaveBeenCalledWith(expect.objectContaining({ text: '看图', images }))
  })

  it('切换计划模式并持久化', () => {
    const updateSession = vi.fn(() => Promise.resolve())
    bindAgentPersistence({ updateSession, saveMessage: vi.fn() } as never)
    const store = useWorkstation.getState()
    store.toggleAgentPlanMode('s-1')

    expect(useWorkstation.getState().sessions.find((item) => item.id === 's-1')?.planMode).toBe(
      true
    )
    expect(updateSession).toHaveBeenCalledWith('s-1', { planMode: true })

    useWorkstation.getState().toggleAgentPlanMode('s-1')
    expect(
      useWorkstation.getState().sessions.find((item) => item.id === 's-1')?.planMode
    ).toBeUndefined()
    expect(updateSession).toHaveBeenLastCalledWith('s-1', { planMode: false })
  })

  it('失败回复给出可读原因并保留脱敏后的原始详情', () => {
    const saveMessage = vi.fn(() => Promise.resolve())
    bindAgentPersistence({
      updateSession: vi.fn(() => Promise.resolve()),
      saveMessage
    } as never)
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.finishAgentReply('s-1', 'API Error: 400 Model Not Exist key sk-abcdefgh12345678')

    const message = useWorkstation.getState().threads['s-1'].at(-1)
    expect(message?.error).toBe(true)
    expect(message?.text).toContain('模型不可用')
    expect(message?.text).toContain('拉取模型')
    expect(message?.text).toContain(ERROR_DETAIL_SEPARATOR)
    expect(message?.text).not.toContain('sk-abcdefgh12345678')
    expect(message?.text).toContain('[已隐藏]')
    expect(saveMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: expect.stringContaining('Model Not Exist') })
    )
  })

  it('按需加载会话线程并标记已加载', () => {
    useWorkstation
      .getState()
      .setAgentThread('s-1', [{ id: 'u1', role: 'user', text: '按需加载', time: '刚刚' }])
    const state = useWorkstation.getState()
    expect(state.threads['s-1']).toEqual([
      { id: 'u1', role: 'user', text: '按需加载', time: '刚刚' }
    ])
    expect(state.threadsLoaded['s-1']).toBe(true)
  })

  it('两个会话的审批卡互不覆盖，清掉一张不影响另一张', () => {
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.beginAgentReply('s-2', 'run-2')
    store.setToolPermission('s-1', {
      requestId: 'p-1',
      toolName: 'Edit',
      toolUseId: 't-1',
      detail: 'a.ts',
      inputPreview: '{}'
    })
    store.setToolPermission('s-2', {
      requestId: 'p-2',
      toolName: 'Write',
      toolUseId: 't-2',
      detail: 'b.ts',
      inputPreview: '{}'
    })

    expect(useWorkstation.getState().toolPermissions['s-1']?.requestId).toBe('p-1')
    expect(useWorkstation.getState().toolPermissions['s-2']?.requestId).toBe('p-2')

    store.clearToolPermission('s-1')
    const state = useWorkstation.getState()
    expect(state.toolPermissions['s-1']).toBeUndefined()
    expect(state.toolPermissions['s-2']?.requestId).toBe('p-2')
    expect(state.sessions.find((item) => item.id === 's-1')?.status).toBe('run')
    expect(state.sessions.find((item) => item.id === 's-2')?.status).toBe('wait')
  })

  it('同一会话的工具与 MCP 审批都处理完才回到运行态', () => {
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.setToolPermission('s-1', {
      requestId: 'p-1',
      toolName: 'Edit',
      toolUseId: 't-1',
      detail: 'a.ts',
      inputPreview: '{}'
    })
    store.setMcpPermission({
      requestId: 'm-1',
      sessionId: 's-1',
      domain: 'task',
      tool: 'tasks_create',
      detail: '新增任务',
      preview: '写一条任务',
      createdAt: 1
    })
    store.setMcpPermission({
      requestId: 'm-2',
      sessionId: 's-2',
      domain: 'task',
      tool: 'tasks_create',
      detail: '另一个会话',
      preview: '写另一条任务',
      createdAt: 2
    })

    store.clearMcpPermission('s-1')
    expect(useWorkstation.getState().sessions.find((item) => item.id === 's-1')?.status).toBe(
      'wait'
    )
    expect(useWorkstation.getState().mcpPermissions['s-2']?.requestId).toBe('m-2')

    store.clearToolPermission('s-1')
    expect(useWorkstation.getState().sessions.find((item) => item.id === 's-1')?.status).toBe('run')
    expect(useWorkstation.getState().toolPermissions['s-1']).toBeUndefined()
  })

  it('问答卡按会话保存，和工具审批一起等待最后一张卡', () => {
    const store = useWorkstation.getState()
    store.createAgentSession('claude')
    const sessionId = useWorkstation.getState().activeSessionId
    store.beginAgentReply(sessionId, 'run-q')
    store.setAgentQuestion(sessionId, {
      requestId: 'q-1',
      toolUseId: 't-1',
      questions: [
        {
          question: '选哪个？',
          header: '选择',
          options: [{ label: 'A' }, { label: 'B' }]
        }
      ]
    })
    expect(useWorkstation.getState().agentQuestions[sessionId]?.requestId).toBe('q-1')
    expect(useWorkstation.getState().sessions.find((item) => item.id === sessionId)?.status).toBe(
      'wait'
    )

    store.setToolPermission(sessionId, {
      requestId: 'p-1',
      toolName: 'Edit',
      toolUseId: 't-2',
      detail: 'a.ts',
      inputPreview: '{}'
    })
    store.clearToolPermission(sessionId)
    expect(useWorkstation.getState().sessions.find((item) => item.id === sessionId)?.status).toBe(
      'wait'
    )

    store.clearAgentQuestion(sessionId)
    const state = useWorkstation.getState()
    expect(state.agentQuestions[sessionId]).toBeUndefined()
    expect(state.sessions.find((item) => item.id === sessionId)?.status).toBe('run')
  })

  it('结束一个会话的回合只清它自己的审批卡', () => {
    const store = useWorkstation.getState()
    store.beginAgentReply('s-1', 'run-1')
    store.beginAgentReply('s-2', 'run-2')
    store.setToolPermission('s-1', {
      requestId: 'p-1',
      toolName: 'Edit',
      toolUseId: 't-1',
      detail: 'a.ts',
      inputPreview: '{}'
    })
    store.setToolPermission('s-2', {
      requestId: 'p-2',
      toolName: 'Edit',
      toolUseId: 't-2',
      detail: 'b.ts',
      inputPreview: '{}'
    })

    store.finishAgentReply('s-1')

    const state = useWorkstation.getState()
    expect(state.toolPermissions['s-1']).toBeUndefined()
    expect(state.toolPermissions['s-2']?.requestId).toBe('p-2')
    expect(state.sessions.find((item) => item.id === 's-2')?.status).toBe('wait')
    expect(state.streams['s-2']).toMatchObject({ runId: 'run-2' })
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
    // 失败回调挂在 .then 之后，要多等一个节拍才会执行
    await new Promise((resolve) => setTimeout(resolve, 0))

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
  beforeEach(() => {
    useWorkstation.setState({
      sessions: [
        {
          id: 's-c1',
          agent: 'claude',
          title: '会话一',
          meta: '刚刚 · 0 条',
          status: 'idle',
          threadDate: '今天'
        },
        {
          id: 's-x1',
          agent: 'codex',
          title: 'Codex 会话',
          meta: '刚刚 · 0 条',
          status: 'idle',
          threadDate: '今天'
        }
      ],
      activeSessionId: 's-c1',
      threads: { 's-c1': [], 's-x1': [] }
    })
  })

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

  it('后台通知点击后切回会话并记录待聚焦的审批请求', () => {
    useWorkstation.getState().setView('notes')
    useWorkstation.getState().focusAgentAttention('s-x1', 'run-1:req-1')

    let state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-x1')
    expect(state.activeView).toBe('agent')
    expect(state.agentAttentionRequestId).toBe('run-1:req-1')
    expect(state.agentJumpMessageId).toBeNull()

    state.clearAgentAttention()
    state = useWorkstation.getState()
    expect(state.agentAttentionRequestId).toBeNull()
  })

  it('通知指向不存在的会话时保持当前状态', () => {
    useWorkstation.getState().focusAgentAttention('missing', 'run-1:req-1')

    const state = useWorkstation.getState()
    expect(state.activeSessionId).toBe('s-c1')
    expect(state.activeView).toBe('today')
    expect(state.agentAttentionRequestId).toBeNull()
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
