import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LearningItemRecord } from '../../../shared/ipc'
import { addDaysKey, dateKey } from '../../../shared/date-key'
import { createInitialData } from '../data/mock'
import { useWorkstation } from '../store/useWorkstation'
import { hydrateLearning, type HydrateLearningDeps } from './learning-persistence'

function deps(overrides: Partial<HydrateLearningDeps> = {}): HydrateLearningDeps {
  let stored: LearningItemRecord[] = []
  return {
    list: vi.fn(() => Promise.resolve(stored)),
    bootstrap: vi.fn(async (items) => {
      stored = items
    }),
    create: vi.fn().mockImplementation(async (draft) => ({
      id: 'saved',
      subject: draft.subject,
      title: draft.title,
      source: draft.source ?? '',
      notes: draft.notes ?? '',
      repetitions: 0,
      intervalDays: 0,
      ease: 2.5,
      nextReviewOn: draft.nextReviewOn ?? dateKey(),
      active: true
    })),
    update: vi.fn().mockResolvedValue(undefined),
    review: vi.fn(),
    ...overrides
  }
}

beforeEach(() => {
  useWorkstation.setState(createInitialData())
})

describe('hydrateLearning', () => {
  it('空库写入 24 张种子卡', async () => {
    const d = deps()
    await hydrateLearning(d)

    expect(d.bootstrap).toHaveBeenCalled()
    expect(useWorkstation.getState().learningItems).toHaveLength(24)
    expect(useWorkstation.getState().learningReady).toBe(true)
  })

  it('已有数据时用数据库覆盖种子', async () => {
    const stored: LearningItemRecord[] = [
      {
        id: 'x1',
        subject: '英语二',
        title: 'evidence',
        source: '',
        notes: '',
        repetitions: 2,
        intervalDays: 6,
        ease: 2.5,
        nextReviewOn: '2026-10-30',
        active: true
      }
    ]
    await hydrateLearning(deps({ list: vi.fn().mockResolvedValue(stored) }))

    expect(useWorkstation.getState().learningItems).toEqual(stored)
  })

  it('读库失败时保留种子并记录错误', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await hydrateLearning(deps({ list: vi.fn().mockRejectedValue(new Error('db locked')) }))

    expect(useWorkstation.getState().learningItems).toHaveLength(24)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('没有 preload 桥时保持种子且不写入', async () => {
    await hydrateLearning(undefined)
    expect(useWorkstation.getState().learningItems).toHaveLength(24)
    expect(useWorkstation.getState().learningReady).toBe(false)
  })

  it('hydrate 后新建卡片写库并替换 id', async () => {
    const d = deps()
    await hydrateLearning(d)

    useWorkstation.getState().addLearningItem({ subject: '英语二', title: 'require' })
    await vi.waitFor(() => expect(useWorkstation.getState().learningItems[0].id).toBe('saved'))
    expect(d.create).toHaveBeenCalledWith({ subject: '英语二', title: 'require' })
  })

  it('hydrate 后更新写入数据库', async () => {
    const d = deps()
    await hydrateLearning(d)

    useWorkstation.getState().updateLearningItem('en-analyze', { notes: '改动' })
    expect(d.update).toHaveBeenCalledWith('en-analyze', { notes: '改动' })
  })

  it('评分调用 review 并用返回记录替换内存卡片', async () => {
    const today = dateKey()
    const d = deps({
      list: vi.fn().mockResolvedValue([
        {
          id: 'l1',
          subject: '英语二',
          title: 'analyze',
          source: '',
          notes: '',
          repetitions: 0,
          intervalDays: 0,
          ease: 2.5,
          nextReviewOn: today,
          active: true
        }
      ]),
      review: vi.fn().mockResolvedValue({
        id: 'l1',
        subject: '英语二',
        title: 'analyze',
        source: '',
        notes: '',
        repetitions: 1,
        intervalDays: 1,
        ease: 2.5,
        nextReviewOn: addDaysKey(today, 1),
        active: true
      })
    })
    await hydrateLearning(d)

    useWorkstation.getState().reviewLearningItem('l1', 3)

    await vi.waitFor(() =>
      expect(useWorkstation.getState().learningItems[0].nextReviewOn).toBe(addDaysKey(today, 1))
    )
    expect(d.review).toHaveBeenCalledWith('l1', 3)
  })

  it('评分写库失败仍从队列移除，避免卡死', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const today = dateKey()
    const d = deps({
      list: vi.fn().mockResolvedValue([
        {
          id: 'l1',
          subject: '英语二',
          title: 'analyze',
          source: '',
          notes: '',
          repetitions: 0,
          intervalDays: 0,
          ease: 2.5,
          nextReviewOn: today,
          active: true
        }
      ]),
      review: vi.fn().mockRejectedValue(new Error('disk full'))
    })
    await hydrateLearning(d)
    useWorkstation.getState().startLearningReview()
    expect(useWorkstation.getState().learningReviewSession).toEqual(['l1'])

    useWorkstation.getState().reviewLearningItem('l1', 3)

    await vi.waitFor(() => expect(useWorkstation.getState().learningReviewSession).toEqual([]))
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})
