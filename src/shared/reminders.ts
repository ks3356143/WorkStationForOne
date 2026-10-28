/** 提醒只需要这几个字段，结构类型让 Task 天然可传入，shared 不反向依赖渲染层。 */
export interface ReminderTask {
  id: string
  title: string
  time: string
  done: boolean
  dueDate?: string
  list?: string
}

/** 提醒只对「今天到期」且带具体时间的任务生效。 */
export function reminderKey(taskId: string, day: string): string {
  return `${taskId}@${day}`
}

export function minutesOf(time: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(time)
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

/**
 * 本分钟该提醒哪些任务。
 * 同一任务同一天只提醒一次（fired 记录 key），取消勾选也不会重复弹。
 * 错过的那一分钟不补：宁可漏一条，也不要打开应用时被一串历史提醒刷屏。
 */
export function dueReminders(
  tasks: ReminderTask[],
  today: string,
  nowMinutes: number,
  fired: ReadonlySet<string>
): ReminderTask[] {
  return tasks.filter((task) => {
    if (task.done || task.dueDate !== today) return false
    const at = minutesOf(task.time)
    if (at === null || at !== nowMinutes) return false
    return !fired.has(reminderKey(task.id, today))
  })
}

/** 通知正文：把时间与清单叠在标题后面，一眼能认出来。 */
export function reminderBody(task: ReminderTask): string {
  return [task.time, task.list ? `#${task.list}` : ''].filter(Boolean).join(' · ')
}
