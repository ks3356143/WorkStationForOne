import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

const { registerTaskHandlersIPC } = await import('./tasks')

describe('IPC 入参校验', () => {
  it('拒绝非对象任务', () => {
    expect(() => registerTaskHandlersIPC.assertTaskRecord(null)).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskRecord('x')).toThrow(TypeError)
  })

  it('拒绝缺少字段的任务', () => {
    expect(() => registerTaskHandlersIPC.assertTaskRecord({ id: '', title: 'a', time: '—', done: false })).toThrow(
      TypeError
    )
    expect(() => registerTaskHandlersIPC.assertTaskRecord({ id: 'a', title: 'a', time: '—' })).toThrow(TypeError)
  })

  it('拒绝非法色调', () => {
    expect(() =>
      registerTaskHandlersIPC.assertTaskRecord({ id: 'a', title: 'a', time: '—', done: false, tone: 'evil' })
    ).toThrow(TypeError)
  })

  it('接受合法任务并只保留已知字段', () => {
    const record = registerTaskHandlersIPC.assertTaskRecord({
      id: 'a',
      title: 'a',
      time: '—',
      done: true,
      tone: 'agent',
      extra: 'ignored'
    })
    expect(record).toEqual({
      id: 'a',
      title: 'a',
      time: '—',
      done: true,
      tone: 'agent',
      tag: undefined,
      notes: '',
      dueDate: undefined,
      priority: 0,
      list: undefined,
      completedAt: undefined
    })
  })

  it('拒绝非法变更列表', () => {
    expect(() => registerTaskHandlersIPC.assertChanges('x')).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertChanges([{ taskId: '', toTime: '—', toTag: 'x' }])).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertChanges([{ taskId: 'a', toTime: '—' }])).toThrow(TypeError)
  })

  it('接受合法变更列表', () => {
    expect(registerTaskHandlersIPC.assertChanges([{ taskId: 'a', toTime: '22:00', toTag: '明天' }])).toEqual([
      { taskId: 'a', toTime: '22:00', toTag: '明天' }
    ])
  })

  it('接受顺延日期并拒绝非法日期', () => {
    expect(
      registerTaskHandlersIPC.assertChanges([
        { taskId: 'a', toTime: '09:00', toTag: '明天', toDueDate: '2026-10-25' }
      ])
    ).toEqual([{ taskId: 'a', toTime: '09:00', toTag: '明天', toDueDate: '2026-10-25' }])
    expect(() =>
      registerTaskHandlersIPC.assertChanges([
        { taskId: 'a', toTime: '09:00', toTag: '明天', toDueDate: '2026-02-30' }
      ])
    ).toThrow(TypeError)
  })
})

describe('任务草稿校验', () => {
  const valid = {
    title: '  交报告  ',
    time: '15:00',
    dueDate: '2026-10-30',
    priority: 1,
    list: '工作',
    notes: '先写提纲'
  } as const

  it('接受合法草稿并去掉标题空白', () => {
    expect(registerTaskHandlersIPC.assertTaskDraft(valid)).toEqual({ ...valid, title: '交报告' })
  })

  it('接受缺省字段', () => {
    expect(registerTaskHandlersIPC.assertTaskDraft({ title: '买牛奶' })).toEqual({ title: '买牛奶' })
  })

  it('拒绝空标题与非法字段', () => {
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: '   ' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', dueDate: '2026-02-30' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', time: '25:00' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', priority: 4 })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', list: 1 })).toThrow(TypeError)
  })

  it('拒绝超长文本', () => {
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x'.repeat(501) })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', notes: 'y'.repeat(20_001) })).toThrow(
      TypeError
    )
    expect(() => registerTaskHandlersIPC.assertTaskDraft({ title: 'x', list: 'l'.repeat(81) })).toThrow(TypeError)
  })
})

describe('任务补丁校验', () => {
  it('接受部分字段与 null 清空', () => {
    expect(
      registerTaskHandlersIPC.assertTaskPatch({
        title: '  新标题  ',
        dueDate: null,
        list: null,
        tag: null,
        tone: null,
        priority: 3,
        extra: 'ignored'
      })
    ).toEqual({
      title: '新标题',
      dueDate: null,
      list: null,
      tag: null,
      tone: null,
      priority: 3
    })
  })

  it('拒绝空标题、非法值与没有已知字段的补丁', () => {
    expect(() => registerTaskHandlersIPC.assertTaskPatch({ title: ' ' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskPatch({ dueDate: '2026-13-01' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskPatch({ tone: 'evil' })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskPatch({ priority: -1 })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskPatch({ extra: true })).toThrow(TypeError)
    expect(() => registerTaskHandlersIPC.assertTaskPatch(null)).toThrow(TypeError)
  })
})
