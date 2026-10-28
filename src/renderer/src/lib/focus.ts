import type { Task } from '../types'

export const THREE_LIMIT = 3

/**
 * 一件任务在「今天该先做谁」这件事上的优先级档位。数字越小越靠前：
 * 已经逾期 > 今天到期 > 计划今天 > 高优先级 > 其它。
 * 分档而不是打总分，是为了让排序理由说得清——用户能看懂为什么是这三件。
 */
function rank(task: Task, today: string): number {
  if (task.dueDate && task.dueDate < today) return 0
  if (task.dueDate === today) return 1
  if (task.plannedFor === today) return 2
  if (task.priority === 1) return 3
  return 4
}

const farFuture = '9999-12-31'

/**
 * 只做三件事：从全部未完成任务里挑出最该动手的三件。
 * 同档内按截止日期 → 优先级 → 创建时间（早的优先）→ id 排序，
 * 保证同样的数据每次得到同样的结果，不会一刷新就换个名单。
 */
export function topThree(tasks: Task[], today: string, limit = THREE_LIMIT): Task[] {
  return tasks
    .filter((task) => !task.done && !task.parentId)
    .sort((a, b) => {
      const byRank = rank(a, today) - rank(b, today)
      if (byRank !== 0) return byRank
      const dueA = a.dueDate ?? farFuture
      const dueB = b.dueDate ?? farFuture
      if (dueA !== dueB) return dueA < dueB ? -1 : 1
      const priA = a.priority ?? 4
      const priB = b.priority ?? 4
      if (priA !== priB) return priA - priB
      const createdA = a.createdAt ?? Number.MAX_SAFE_INTEGER
      const createdB = b.createdAt ?? Number.MAX_SAFE_INTEGER
      if (createdA !== createdB) return createdA - createdB
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .slice(0, limit)
}
