import { describe, expect, it } from 'vitest'
import type { AgentRunRecord } from '../../../shared/ipc'
import type { Habit, LearningItem, Task } from '../types'
import {
  DAILY_REVIEW_NOTE_LIMIT,
  buildDailyReview,
  buildDailyReviewNote,
  carryOverPatch
} from './daily-review'

const TODAY = '2026-11-05'
const TOMORROW = '2026-11-06'

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't', title: '任务', time: '—', done: false, ...overrides }
}

function habit(overrides: Partial<Habit> = {}): Habit {
  return { id: 'h', name: '阅读', checkins: [], ...overrides }
}

function card(overrides: Partial<LearningItem> = {}): LearningItem {
  return {
    id: 'c',
    subject: '英语二',
    title: 'card',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: TODAY,
    active: true,
    ...overrides
  }
}

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: 'r',
    sessionId: 's',
    startedAt: at(TODAY),
    finishedAt: at(TODAY),
    ok: true,
    cancelled: false,
    costUsd: null,
    durationMs: null,
    turns: null,
    ...overrides
  }
}

function at(day: string, hour = 12): number {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(year, month - 1, date, hour).getTime()
}

function review(input: {
  tasks?: Task[]
  habits?: Habit[]
  learningItems?: LearningItem[]
  runs?: AgentRunRecord[]
}) {
  return buildDailyReview({
    tasks: input.tasks ?? [],
    habits: input.habits ?? [],
    learningItems: input.learningItems ?? [],
    runs: input.runs ?? [],
    today: TODAY
  })
}

describe('buildDailyReview', () => {
  it('只统计今天完成与今天/逾期/计划今天的未完成顶层任务', () => {
    const result = review({
      tasks: [
        task({ id: 'done-today', title: '今天完成', done: true, completedAt: at(TODAY) }),
        task({
          id: 'done-yesterday',
          title: '昨天完成',
          done: true,
          completedAt: at('2026-11-04')
        }),
        task({ id: 'done-no-time', title: '旧完成', done: true, dueDate: TODAY }),
        task({ id: 'due-today', title: '今天到期', dueDate: TODAY }),
        task({ id: 'overdue', title: '逾期任务', dueDate: '2026-11-03' }),
        task({ id: 'planned', title: '计划今天', plannedFor: TODAY }),
        task({ id: 'future', title: '以后再说', dueDate: TOMORROW }),
        task({ id: 'nodate', title: '没有日期' }),
        task({ id: 'child', title: '子任务', dueDate: TODAY, parentId: 'due-today' })
      ]
    })

    expect(result.tomorrow).toBe(TOMORROW)
    expect(result.completed.map((item) => item.id)).toEqual(['done-today'])
    expect(result.open.map((item) => item.id)).toEqual(['overdue', 'due-today', 'planned'])
    expect(result.open.map((item) => item.reason)).toEqual(['overdue', 'today', 'planned'])
  })

  it('未完成按逾期、今天到期、计划今天排序，同组按日期再按标题', () => {
    const result = review({
      tasks: [
        task({ id: 'planned', title: '计划今天', plannedFor: TODAY }),
        task({ id: 'today-b', title: 'B 今天', dueDate: TODAY }),
        task({ id: 'today-a', title: 'A 今天', dueDate: TODAY }),
        task({ id: 'overdue-late', title: '晚逾期', dueDate: '2026-11-04' }),
        task({ id: 'overdue-early', title: '早逾期', dueDate: '2026-11-01' })
      ]
    })

    expect(result.open.map((item) => item.id)).toEqual([
      'overdue-early',
      'overdue-late',
      'today-a',
      'today-b',
      'planned'
    ])
  })

  it('习惯只统计今天已打卡的数量', () => {
    const result = review({
      habits: [
        habit({ id: 'h1', name: '阅读', checkins: [TODAY, '2026-11-04'] }),
        habit({ id: 'h2', name: '运动', checkins: ['2026-11-04'] }),
        habit({ id: 'h3', name: '冥想' })
      ]
    })

    expect(result.habits).toEqual({
      total: 3,
      checked: 1,
      items: [
        { id: 'h1', name: '阅读', checked: true },
        { id: 'h2', name: '运动', checked: false },
        { id: 'h3', name: '冥想', checked: false }
      ]
    })
  })

  it('学习统计启用卡的到期数与今天已复习数', () => {
    const result = review({
      learningItems: [
        card({ id: 'due', nextReviewOn: TODAY }),
        card({ id: 'overdue', nextReviewOn: '2026-11-01' }),
        card({ id: 'future', nextReviewOn: TOMORROW }),
        card({ id: 'inactive', nextReviewOn: TODAY, active: false }),
        card({ id: 'reviewed-today', nextReviewOn: TOMORROW, lastReviewOn: TODAY }),
        card({ id: 'reviewed-and-due', nextReviewOn: TODAY, lastReviewOn: TODAY })
      ]
    })

    expect(result.learning).toEqual({ due: 3, reviewed: 2 })
  })

  it('到期数不按复习队列的 50 张上限截断', () => {
    const result = review({
      learningItems: Array.from({ length: 60 }, (_, index) =>
        card({ id: `c${index}`, nextReviewOn: TODAY })
      )
    })

    expect(result.learning.due).toBe(60)
  })

  it('Agent 只汇总今天启动的运行，取消的运行不重复计入失败', () => {
    const result = review({
      runs: [
        run({ id: 'ok', ok: true, costUsd: 0.01 }),
        run({ id: 'fail', ok: false, costUsd: 0.02 }),
        run({ id: 'running', ok: null, finishedAt: null }),
        run({ id: 'cancelled', ok: false, cancelled: true }),
        run({ id: 'yesterday', startedAt: at('2026-11-04') })
      ]
    })

    expect(result.agent).toEqual({
      runs: 4,
      completed: 1,
      failures: 1,
      running: 1,
      cancelled: 1,
      costUsd: 0.03
    })
  })
})

describe('carryOverPatch', () => {
  it('截止与计划都在今天时一起顺延到明天', () => {
    expect(carryOverPatch(task({ dueDate: TODAY, plannedFor: TODAY }), TODAY, TOMORROW)).toEqual({
      dueDate: TOMORROW,
      plannedFor: TOMORROW
    })
  })

  it('只有截止日逾期时同时补上明天的计划日', () => {
    expect(carryOverPatch(task({ dueDate: '2026-11-04' }), TODAY, TOMORROW)).toEqual({
      dueDate: TOMORROW,
      plannedFor: TOMORROW
    })
  })

  it('只有今天的计划日时只移动计划日', () => {
    expect(carryOverPatch(task({ plannedFor: TODAY }), TODAY, TOMORROW)).toEqual({
      plannedFor: TOMORROW
    })
  })

  it('截止今天但计划在未来时以明天为准', () => {
    expect(
      carryOverPatch(task({ dueDate: TODAY, plannedFor: '2026-11-20' }), TODAY, TOMORROW)
    ).toEqual({
      dueDate: TOMORROW,
      plannedFor: TOMORROW
    })
  })

  it('未来任务与已完成任务不产生变更', () => {
    expect(
      carryOverPatch(task({ dueDate: TOMORROW, plannedFor: TOMORROW }), TODAY, TOMORROW)
    ).toBeNull()
    expect(carryOverPatch(task({ dueDate: TODAY, done: true }), TODAY, TOMORROW)).toBeNull()
  })
})

describe('buildDailyReviewNote', () => {
  it('生成带分区与顺延标记的 Markdown 笔记，不包含内部 id', () => {
    const result = review({
      tasks: [
        task({ id: 'task-secret-id', title: '完成的任务', done: true, completedAt: at(TODAY) }),
        task({ id: 'o1', title: '逾期的任务', dueDate: '2026-11-03' }),
        task({ id: 'o2', title: '今天到期的任务', dueDate: TODAY })
      ],
      habits: [
        habit({ id: 'h1', name: '阅读', checkins: [TODAY] }),
        habit({ id: 'h2', name: '运动' })
      ],
      learningItems: [
        card({ id: 'c1', nextReviewOn: TODAY }),
        card({ id: 'c2', nextReviewOn: TODAY, lastReviewOn: TODAY }),
        card({ id: 'c3', nextReviewOn: TOMORROW, lastReviewOn: TODAY })
      ],
      runs: [
        run({ id: 'r1', ok: true, costUsd: 0.01 }),
        run({ id: 'r2', ok: false, costUsd: 0.02 })
      ]
    })

    const note = buildDailyReviewNote(result, new Set(['o1']))

    expect(note.split('\n')[0]).toBe('2026-11-05 今日复盘')
    expect(note).toContain('完成 1 项')
    expect(note).toContain('- 完成的任务')
    expect(note).toContain('未完成 2 项')
    expect(note).toContain('- 逾期的任务（逾期 · 顺延到明天）')
    expect(note).toContain('- 今天到期的任务（今天到期）')
    expect(note).toContain('习惯 1/2')
    expect(note).toContain('- ✓ 阅读')
    expect(note).toContain('- ○ 运动')
    expect(note).toContain('学习：复习 2 张，仍到期 2 张')
    expect(note).toContain('Agent：2 轮，1 成功，1 失败，$0.03')
    expect(note).not.toContain('task-secret-id')
  })

  it('超过上限时截断并保留标题', () => {
    const tasks = Array.from({ length: 200 }, (_, index) =>
      task({
        id: `done-${index}`,
        title: `${index} ${'很长的完成任务标题'.repeat(4)}`,
        done: true,
        completedAt: at(TODAY)
      })
    )
    const note = buildDailyReviewNote(review({ tasks }))

    expect(note.length).toBeLessThanOrEqual(DAILY_REVIEW_NOTE_LIMIT)
    expect(note.split('\n')[0]).toBe('2026-11-05 今日复盘')
    expect(note.endsWith('…（已截断）')).toBe(true)
  })

  it('空白一天也生成完整分区', () => {
    const note = buildDailyReviewNote(review({}))

    expect(note).toContain('完成 0 项')
    expect(note).toContain('未完成 0 项')
    expect(note).toContain('习惯 0/0')
    expect(note).toContain('学习：复习 0 张，仍到期 0 张')
    expect(note).toContain('Agent：今天没有运行')
  })
})
