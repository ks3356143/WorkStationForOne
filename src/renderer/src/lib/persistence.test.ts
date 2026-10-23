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
})
