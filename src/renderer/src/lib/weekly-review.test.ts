import { describe, expect, it } from 'vitest'
import type { AgentRunRecord, LearningReviewRecord } from '../../../shared/ipc'
import type { Habit, Task } from '../types'
import { WEEKLY_REVIEW_NOTE_LIMIT, buildWeeklyReview, buildWeeklyReviewNote } from './weekly-review'

const WEEK_START = '2026-11-02'
const WEEK_END = '2026-11-08'

function task(overrides: Partial<Task> = {}): Task {
  return { id: 't', title: '任务', time: '—', done: false, ...overrides }
}

function habit(overrides: Partial<Habit> = {}): Habit {
  return { id: 'h', name: '阅读', checkins: [], ...overrides }
}

function review(
  rating: LearningReviewRecord['rating'],
  day: string,
  hour = 12
): LearningReviewRecord {
  return { rating, reviewedAt: at(day, hour) }
}

function run(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: 'r',
    sessionId: 's',
    startedAt: at('2026-11-04'),
    finishedAt: at('2026-11-04'),
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

function build(input: {
  tasks?: Task[]
  habits?: Habit[]
  learningReviews?: LearningReviewRecord[]
  agentRuns?: AgentRunRecord[]
}) {
  return buildWeeklyReview({
    tasks: input.tasks ?? [],
    habits: input.habits ?? [],
    learningReviews: input.learningReviews ?? [],
    agentRuns: input.agentRuns ?? [],
    weekStart: WEEK_START
  })
}

describe('buildWeeklyReview', () => {
  it('完成按本地完成时间归入本周，子任务与周外完成不计', () => {
    const result = build({
      tasks: [
        task({ id: 'mon', title: '周一完成', done: true, completedAt: at('2026-11-02') }),
        task({ id: 'sun', title: '周日完成', done: true, completedAt: at('2026-11-08', 20) }),
        task({ id: 'prev', title: '上周完成', done: true, completedAt: at('2026-11-01') }),
        task({ id: 'next', title: '下周完成', done: true, completedAt: at('2026-11-09') }),
        task({
          id: 'child',
          title: '子任务',
          done: true,
          completedAt: at('2026-11-03'),
          parentId: 'mon'
        }),
        task({ id: 'legacy', title: '旧完成', done: true })
      ]
    })

    expect(result.weekEnd).toBe(WEEK_END)
    expect(result.completed.map((item) => item.id)).toEqual(['mon', 'sun'])
    expect(result.days.map((day) => day.completed)).toEqual([1, 0, 0, 0, 0, 0, 1])
  })

  it('未完成收本周到期、本周计划与之前逾期，未来任务不收', () => {
    const result = build({
      tasks: [
        task({ id: 'overdue', title: '逾期', dueDate: '2026-10-30' }),
        task({ id: 'due', title: '本周到期', dueDate: '2026-11-05' }),
        task({ id: 'planned', title: '本周计划', plannedFor: '2026-11-06' }),
        task({ id: 'future', title: '下周到期', dueDate: '2026-11-10' }),
        task({ id: 'late-plan', title: '下周计划', plannedFor: '2026-11-12' }),
        task({ id: 'done', title: '已完成', dueDate: '2026-11-04', done: true }),
        task({ id: 'nodate', title: '无日期' }),
        task({ id: 'child', title: '子任务', dueDate: '2026-11-04', parentId: 'due' })
      ]
    })

    expect(result.open.map((item) => item.id)).toEqual(['overdue', 'due', 'planned'])
    expect(result.open.map((item) => item.reason)).toEqual(['overdue', 'due', 'planned'])
  })

  it('习惯按本周打卡次数汇总，缺卡不算', () => {
    const result = build({
      habits: [
        habit({ id: 'h1', name: '阅读', checkins: ['2026-11-02', '2026-11-04', '2026-11-08'] }),
        habit({ id: 'h2', name: '运动', checkins: ['2026-10-31', '2026-11-03'] }),
        habit({ id: 'h3', name: '冥想' })
      ]
    })

    expect(result.habits).toEqual({
      total: 21,
      checked: 4,
      items: [
        { id: 'h1', name: '阅读', count: 3 },
        { id: 'h2', name: '运动', count: 1 },
        { id: 'h3', name: '冥想', count: 0 }
      ]
    })
  })

  it('学习只统本周复习，并保留四个评分桶', () => {
    const result = build({
      learningReviews: [
        review(1, '2026-11-02'),
        review(3, '2026-11-03'),
        review(3, '2026-11-08'),
        review(4, '2026-11-09'),
        review(2, '2026-11-01')
      ]
    })

    expect(result.learning.reviews).toBe(3)
    expect(result.learning.ratings).toEqual([
      { rating: 1, count: 1 },
      { rating: 2, count: 0 },
      { rating: 3, count: 2 },
      { rating: 4, count: 0 }
    ])
  })

  it('Agent 只汇总本周启动的运行，取消不重复计入失败', () => {
    const result = build({
      agentRuns: [
        run({ id: 'ok', ok: true, costUsd: 0.01 }),
        run({ id: 'fail', ok: false, costUsd: 0.02 }),
        run({ id: 'running', ok: null, finishedAt: null }),
        run({ id: 'cancelled', ok: false, cancelled: true }),
        run({ id: 'prev', startedAt: at('2026-11-01') })
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

describe('buildWeeklyReviewNote', () => {
  it('生成带区间、每日完成与各域汇总的 Markdown', () => {
    const result = build({
      tasks: [
        task({
          id: 'task-secret-id',
          title: '完成的任务',
          done: true,
          completedAt: at('2026-11-02')
        }),
        task({ id: 'open', title: '逾期任务', dueDate: '2026-10-30' })
      ],
      habits: [
        habit({ id: 'h1', name: '阅读', checkins: ['2026-11-02', '2026-11-03'] }),
        habit({ id: 'h2', name: '运动', checkins: ['2026-11-04'] })
      ],
      learningReviews: [review(3, '2026-11-03'), review(1, '2026-11-04')],
      agentRuns: [run({ id: 'ok', ok: true, costUsd: 0.01 })]
    })
    const note = buildWeeklyReviewNote(result)

    expect(note.split('\n')[0]).toBe('2026-11-02 本周回顾')
    expect(note).toContain('统计区间：2026-11-02 至 2026-11-08')
    expect(note).toContain('完成 1 项')
    expect(note).toContain('- 完成的任务')
    expect(note).toContain('未完成 1 项')
    expect(note).toContain('- 逾期任务（逾期）')
    expect(note).toContain('习惯 3 次')
    expect(note).toContain('- 阅读 2/7')
    expect(note).toContain('- 运动 1/7')
    expect(note).toContain('学习：复习 2 次（重来 1 / 困难 0 / 良好 1 / 简单 0）')
    expect(note).toContain('Agent：1 轮，1 成功，0 失败，$0.01')
    expect(note).toContain('- 11-02 周一：1')
    expect(note).not.toContain('task-secret-id')
  })

  it('空的一周也会生成完整结构', () => {
    const note = buildWeeklyReviewNote(build({}))

    expect(note).toContain('完成 0 项')
    expect(note).toContain('未完成 0 项')
    expect(note).toContain('习惯 0 次')
    expect(note).toContain('学习：复习 0 次（重来 0 / 困难 0 / 良好 0 / 简单 0）')
    expect(note).toContain('Agent：本周没有运行')
    expect(note).toContain('- 11-08 周日：0')
  })

  it('超过上限时截断并保留标题', () => {
    const tasks = Array.from({ length: 200 }, (_, index) =>
      task({
        id: `done-${index}`,
        title: `${index} ${'很长的完成任务标题'.repeat(4)}`,
        done: true,
        completedAt: at('2026-11-02')
      })
    )
    const note = buildWeeklyReviewNote(build({ tasks }))

    expect(note.length).toBeLessThanOrEqual(WEEKLY_REVIEW_NOTE_LIMIT)
    expect(note.split('\n')[0]).toBe('2026-11-02 本周回顾')
    expect(note.endsWith('…（已截断）')).toBe(true)
  })
})
