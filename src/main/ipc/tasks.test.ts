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
    expect(record).toEqual({ id: 'a', title: 'a', time: '—', done: true, tone: 'agent', tag: undefined })
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
})
