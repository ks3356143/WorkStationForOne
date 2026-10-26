import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialData } from '../data/mock'
import { useWorkstation } from '../store/useWorkstation'
import { hydrateTasks, type HydrateDeps } from './persistence'

function deps(overrides: Partial<HydrateDeps> = {}): HydrateDeps {
  return {
    list: vi.fn().mockResolvedValue([]),
    bootstrap: vi.fn().mockResolvedValue(undefined),
    setDone: vi.fn().mockResolvedValue(undefined),
    applySchedule: vi.fn().mockResolvedValue(undefined),
    create: vi.fn().mockResolvedValue({ id: 'saved', title: '任务', time: '—', done: false }),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    restore: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

beforeEach(() => {
  useWorkstation.setState(createInitialData())
})

describe('hydrateTasks', () => {
  it('数据库为空时写入种子任务', async () => {
    const d = deps()
    await hydrateTasks(d)

    expect(d.bootstrap).toHaveBeenCalledWith(useWorkstation.getState().tasks)
    expect(useWorkstation.getState().tasks).toHaveLength(8)
  })

  it('已有数据时用数据库覆盖界面', async () => {
    const stored = [
      { id: 'x1', title: '来自数据库', time: '08:00', done: true },
      { id: 'x2', title: '第二条', time: '—', done: false, tag: '明天' }
    ]
    await hydrateTasks(deps({ list: vi.fn().mockResolvedValue(stored) }))

    expect(useWorkstation.getState().tasks).toEqual(stored)
  })

  it('没有 preload 桥时保持种子数据', async () => {
    await hydrateTasks(undefined)
    expect(useWorkstation.getState().tasks).toHaveLength(8)
  })

  it('hydrate 后勾选会写回数据库', async () => {
    const d = deps()
    await hydrateTasks(d)

    useWorkstation.getState().toggleTask('t3')

    expect(d.setDone).toHaveBeenCalledWith('t3', true)
  })

  it('hydrate 后新增任务写库并替换为数据库 id', async () => {
    const saved = { id: 'saved', title: '买牛奶', time: '—', done: false, notes: '', priority: 0 }
    const d = deps({ create: vi.fn().mockResolvedValue(saved) })
    await hydrateTasks(d)

    useWorkstation.getState().addTask({ title: '买牛奶' })

    expect(d.create).toHaveBeenCalledWith({ title: '买牛奶' })
    expect(useWorkstation.getState().tasks[0].title).toBe('买牛奶')
    await vi.waitFor(() => expect(useWorkstation.getState().tasks[0].id).toBe('saved'))
  })

  it('hydrate 后更新与删除会写库', async () => {
    const d = deps()
    await hydrateTasks(d)

    useWorkstation.getState().updateTask('t3', { title: '线代第 4 章' })
    expect(d.update).toHaveBeenCalledWith('t3', { title: '线代第 4 章' })

    useWorkstation.getState().removeTask('t3')
    expect(d.remove).toHaveBeenCalledWith('t3')
    expect(useWorkstation.getState().tasks.some((task) => task.id === 't3')).toBe(false)
  })

  it('新增写库失败时保留内存任务并记录错误', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const d = deps({ create: vi.fn().mockRejectedValue(new Error('disk full')) })
    await hydrateTasks(d)

    useWorkstation.getState().addTask({ title: '离线任务' })
    await vi.waitFor(() => expect(spy).toHaveBeenCalled())

    expect(useWorkstation.getState().tasks[0].title).toBe('离线任务')
    spy.mockRestore()
  })

  it('读库失败时保留种子数据并记录错误', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await hydrateTasks(deps({ list: vi.fn().mockRejectedValue(new Error('db locked')) }))

    expect(useWorkstation.getState().tasks).toHaveLength(8)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
