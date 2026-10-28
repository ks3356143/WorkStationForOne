import { describe, expect, it } from 'vitest'
import { dueReminders, minutesOf, reminderBody, reminderKey } from './reminders'

const TODAY = '2026-10-28'

function task(partial: Partial<Parameters<typeof reminderBody>[0]> & { id: string }) {
  return { title: partial.id, time: '—', done: false, ...partial }
}

describe('minutesOf', () => {
  it('解析 HH:MM，非法值返回 null', () => {
    expect(minutesOf('09:30')).toBe(570)
    expect(minutesOf('00:00')).toBe(0)
    expect(minutesOf('23:59')).toBe(1439)
    expect(minutesOf('—')).toBeNull()
    expect(minutesOf('9:30')).toBeNull()
    expect(minutesOf('24:00')).toBeNull()
  })
})

describe('dueReminders', () => {
  it('只挑今天到期、未完成、且正好到点的任务', () => {
    const tasks = [
      task({ id: 'now', time: '10:30', dueDate: TODAY }),
      task({ id: 'later', time: '11:30', dueDate: TODAY }),
      task({ id: 'done', time: '10:30', dueDate: TODAY, done: true }),
      task({ id: 'other-day', time: '10:30', dueDate: '2026-10-29' }),
      task({ id: 'no-date', time: '10:30' })
    ]
    expect(dueReminders(tasks, TODAY, 630, new Set()).map((item) => item.id)).toEqual(['now'])
  })

  it('已经提醒过的不会重复', () => {
    const tasks = [task({ id: 'now', time: '10:30', dueDate: TODAY })]
    const fired = new Set([reminderKey('now', TODAY)])
    expect(dueReminders(tasks, TODAY, 630, fired)).toEqual([])
  })

  it('换一天后同一个任务的 key 不同，可以再次提醒', () => {
    expect(reminderKey('t1', '2026-10-28')).not.toBe(reminderKey('t1', '2026-10-29'))
  })

  it('错过的时间点不补发', () => {
    const tasks = [task({ id: 'past', time: '08:00', dueDate: TODAY })]
    expect(dueReminders(tasks, TODAY, 630, new Set())).toEqual([])
  })
})

describe('reminderBody', () => {
  it('时间与清单拼成一行，没有就省略', () => {
    expect(reminderBody(task({ id: 'a', time: '10:30', list: '工作' }))).toBe('10:30 · #工作')
    expect(reminderBody(task({ id: 'b', time: '10:30' }))).toBe('10:30')
  })
})
