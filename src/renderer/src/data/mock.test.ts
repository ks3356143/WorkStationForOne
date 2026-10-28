import { describe, expect, it } from 'vitest'
import { createInitialData } from './mock'

describe('createInitialData', () => {
  it('每次调用返回独立的嵌套数据', () => {
    const first = createInitialData()
    const second = createInitialData()

    expect(first.tasks).not.toBe(second.tasks)
    expect(first.notes).not.toBe(second.notes)
    expect(first.sessions).not.toBe(second.sessions)
    expect(first.habits[0].checkins).not.toBe(second.habits[0].checkins)
    expect(first.threads['s-c1']).not.toBe(second.threads['s-c1'])
    expect(first.permission?.changes[0]).not.toBe(second.permission?.changes[0])

    const original = {
      task: second.tasks[0].title,
      day: second.habits[0].checkins[0],
      message: second.threads['s-c1'][0].text,
      toTime: second.permission?.changes[0].toTime
    }

    first.tasks[0].title = 'changed'
    first.habits[0].checkins[0] = 'mutated'
    first.threads['s-c1'][0].text = 'changed'
    first.permission!.changes[0].toTime = '00:00'

    expect(second.tasks[0].title).toBe(original.task)
    expect(second.habits[0].checkins[0]).toBe(original.day)
    expect(second.threads['s-c1'][0].text).toBe(original.message)
    expect(second.permission?.changes[0].toTime).toBe(original.toTime)
  })
})
