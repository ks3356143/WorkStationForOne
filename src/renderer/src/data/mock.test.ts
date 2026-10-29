import { describe, expect, it } from 'vitest'
import { createInitialData } from './mock'

describe('createInitialData', () => {
  it('每次调用返回独立的嵌套数据', () => {
    const first = createInitialData()
    const second = createInitialData()

    expect(first.tasks).not.toBe(second.tasks)
    expect(first.notes).not.toBe(second.notes)
    expect(first.sessions).not.toBe(second.sessions)
    expect(first.threads).not.toBe(second.threads)
    expect(first.habits[0].checkins).not.toBe(second.habits[0].checkins)

    const original = {
      task: second.tasks[0].title,
      day: second.habits[0].checkins[0]
    }

    first.tasks[0].title = 'changed'
    first.habits[0].checkins[0] = 'mutated'

    expect(second.tasks[0].title).toBe(original.task)
    expect(second.habits[0].checkins[0]).toBe(original.day)
    expect(first.sessions).toEqual([])
    expect(first.permission).toBeNull()
  })
})
