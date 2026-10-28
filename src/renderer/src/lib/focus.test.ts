import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import { topThree } from './focus'

const TODAY = '2026-10-28'

function task(partial: Partial<Task> & { id: string }): Task {
  return { title: partial.id, time: '—', done: false, ...partial }
}

const ids = (tasks: Task[]) => tasks.map((item) => item.id)

describe('topThree', () => {
  it('逾期排在最前，其次今天到期', () => {
    const list = [
      task({ id: 'later', dueDate: '2026-11-05' }),
      task({ id: 'today', dueDate: TODAY }),
      task({ id: 'overdue', dueDate: '2026-10-20' })
    ]
    expect(ids(topThree(list, TODAY))).toEqual(['overdue', 'today', 'later'])
  })

  it('「计划今天」优先于只有高优先级的任务', () => {
    const list = [task({ id: 'high', priority: 1 }), task({ id: 'planned', plannedFor: TODAY })]
    expect(ids(topThree(list, TODAY))).toEqual(['planned', 'high'])
  })

  it('已完成的不参与挑选', () => {
    const list = [
      task({ id: 'done', dueDate: '2026-10-01', done: true }),
      task({ id: 'a', dueDate: TODAY })
    ]
    expect(ids(topThree(list, TODAY))).toEqual(['a'])
  })

  it('同档内按优先级，再按创建时间', () => {
    const list = [
      task({ id: 'old-low', dueDate: TODAY, priority: 3, createdAt: 1 }),
      task({ id: 'new-high', dueDate: TODAY, priority: 1, createdAt: 9 }),
      task({ id: 'old-high', dueDate: TODAY, priority: 1, createdAt: 2 })
    ]
    expect(ids(topThree(list, TODAY))).toEqual(['old-high', 'new-high', 'old-low'])
  })

  it('只取三条，且结果稳定（同数据同顺序）', () => {
    const list = [
      task({ id: 'd', dueDate: TODAY }),
      task({ id: 'c', dueDate: TODAY }),
      task({ id: 'b', dueDate: TODAY }),
      task({ id: 'a', dueDate: TODAY })
    ]
    const first = ids(topThree(list, TODAY))
    const second = ids(topThree([...list].reverse(), TODAY))
    expect(first).toEqual(second)
    expect(first).toHaveLength(3)
  })

  it('不足三条时全部返回，空列表返回空', () => {
    expect(topThree([task({ id: 'only' })], TODAY)).toHaveLength(1)
    expect(topThree([], TODAY)).toEqual([])
  })

  it('自定义上限生效', () => {
    const list = ['a', 'b', 'c', 'd'].map((id) => task({ id, dueDate: TODAY }))
    expect(topThree(list, TODAY, 2)).toHaveLength(2)
  })
})
