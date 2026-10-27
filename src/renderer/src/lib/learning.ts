import { addDaysKey } from '../../../shared/date-key'
import type { LearningItem, LearningScope } from '../types'

export const REVIEW_QUEUE_LIMIT = 50
export const MINUTES_PER_CARD = 1.5

export interface SubjectDue {
  subject: string
  count: number
}

/** 到期队列：启用且复习日不晚于今天；难的（ease 低）先来。 */
export function dueQueue(items: LearningItem[], today: string): LearningItem[] {
  return items
    .filter((item) => item.active && item.nextReviewOn <= today)
    .sort(
      (a, b) =>
        a.nextReviewOn.localeCompare(b.nextReviewOn) ||
        a.ease - b.ease ||
        a.title.localeCompare(b.title, 'zh-CN')
    )
    .slice(0, REVIEW_QUEUE_LIMIT)
}

export function estimatedMinutes(dueCount: number): number {
  return Math.ceil(dueCount * MINUTES_PER_CARD)
}

/** 到期分布：按张数降序、科目名次之；今日卡只取前三堆。 */
export function subjectBreakdown(items: LearningItem[]): SubjectDue[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    counts.set(item.subject, (counts.get(item.subject) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject, 'zh-CN'))
}

export interface SubjectStack {
  subject: string
  count: number
  share: number
}

export function subjectStacks(items: LearningItem[], max = 3): SubjectStack[] {
  const breakdown = subjectBreakdown(items)
  const total = breakdown.reduce((sum, entry) => sum + entry.count, 0)
  if (total === 0) return []

  const head = breakdown.slice(0, max)
  const restCount = breakdown.slice(max).reduce((sum, entry) => sum + entry.count, 0)
  if (restCount > 0) head.push({ subject: '其他', count: restCount })
  return head.map((entry) => ({ ...entry, share: entry.count / total }))
}

/** 卡片库过滤：停用卡忽略复习日，其余按科目 + 搜索词收窄。 */
export function filterItems(
  items: LearningItem[],
  scope: LearningScope,
  query: string
): LearningItem[] {
  let scoped: LearningItem[]
  if (scope.kind === 'inactive') {
    scoped = items.filter((item) => !item.active)
  } else if (scope.kind === 'subject') {
    scoped = items.filter((item) => item.active && item.subject === scope.subject)
  } else {
    scoped = items.filter((item) => item.active)
  }

  const needle = query.trim().toLowerCase()
  if (!needle) return sortForLibrary(scoped)
  return sortForLibrary(
    scoped.filter((item) =>
      [item.title, item.source ?? '', item.notes ?? ''].some((value) =>
        value.toLowerCase().includes(needle)
      )
    )
  )
}

function sortForLibrary(items: LearningItem[]): LearningItem[] {
  return [...items].sort(
    (a, b) =>
      a.nextReviewOn.localeCompare(b.nextReviewOn) || a.title.localeCompare(b.title, 'zh-CN')
  )
}

/** 左栏科目顺序：按启用卡数量降序，再按名称升序。 */
export function learningSubjects(items: LearningItem[]): SubjectDue[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    if (!item.active) continue
    counts.set(item.subject, (counts.get(item.subject) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([subject, count]) => ({ subject, count }))
    .sort((a, b) => b.count - a.count || a.subject.localeCompare(b.subject, 'zh-CN'))
}

export function learningDueLabel(item: LearningItem, today: string): string {
  if (item.nextReviewOn === today) return '今天'
  if (item.nextReviewOn === addDaysKey(today, 1)) return '明天'
  if (item.nextReviewOn < today) {
    return `逾期 · ${item.nextReviewOn.slice(0, 4) === today.slice(0, 4) ? item.nextReviewOn.slice(5) : item.nextReviewOn}`
  }
  return item.nextReviewOn.slice(0, 4) === today.slice(0, 4)
    ? item.nextReviewOn.slice(5)
    : item.nextReviewOn
}

export function isDue(item: LearningItem, today: string): boolean {
  return item.active && item.nextReviewOn <= today
}

export interface ReviewTally {
  reviewed: number
  again: number
  startedAt: number
}

export function tallyLine(tally: ReviewTally): string {
  const minutes = Math.max(1, Math.round((Date.now() - tally.startedAt) / 60_000))
  return `复习 ${tally.reviewed} 张 · 重来 ${tally.again} 次 · 约 ${minutes} 分钟`
}
