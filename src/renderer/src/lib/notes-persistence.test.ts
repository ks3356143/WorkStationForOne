import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createInitialData } from '../data/mock'
import { useWorkstation } from '../store/useWorkstation'
import { hydrateNotes, type HydrateNoteDeps } from './notes-persistence'

function deps(overrides: Partial<HydrateNoteDeps> = {}): HydrateNoteDeps {
  return {
    bootstrap: vi.fn().mockResolvedValue(undefined),
    page: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn().mockResolvedValue({ id: 'x', text: 'x', time: '刚刚' }),
    ...overrides
  }
}

beforeEach(() => {
  useWorkstation.setState(createInitialData())
})

describe('hydrateNotes', () => {
  it('数据库为空时写入种子笔记', async () => {
    const d = deps()
    await hydrateNotes(d)

    expect(d.bootstrap).toHaveBeenCalledWith(useWorkstation.getState().notes)
  })

  it('已有数据时用数据库内容替换预览列表', async () => {
    const stored = [
      { id: 'a', text: '来自数据库', time: '12:00', pinned: true },
      { id: 'b', text: '第二条', time: '11:00' }
    ]
    await hydrateNotes(deps({ page: vi.fn().mockResolvedValue({ items: stored, total: 9 }) }))

    expect(useWorkstation.getState().notes).toEqual(stored)
  })

  it('没有 preload 桥时保持种子', async () => {
    await hydrateNotes(undefined)
    expect(useWorkstation.getState().notes).toHaveLength(4)
  })

  it('读取失败时保留内存数据', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await hydrateNotes(deps({ page: vi.fn().mockRejectedValue(new Error('db locked')) }))

    expect(useWorkstation.getState().notes).toHaveLength(4)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('hydrate 后新增笔记会调用数据库写入', async () => {
    const d = deps({ create: vi.fn().mockResolvedValue({ id: 'saved', text: '新笔记', time: '刚刚' }) })
    await hydrateNotes(d)

    useWorkstation.getState().addNote('新笔记')
    await Promise.resolve()
    await Promise.resolve()

    expect(d.create).toHaveBeenCalledWith('新笔记', '想法')
  })
})
