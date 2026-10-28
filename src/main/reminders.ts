import { appendFileSync } from 'node:fs'
import { app, Notification } from 'electron'
import { dateKey } from '../shared/date-key'
import { dueReminders, reminderBody, reminderKey } from '../shared/reminders'
import type { TaskRepository } from './db/tasks'

interface ReminderOptions {
  /** 检查间隔，默认 20 秒；冒烟里调小以便快速观察 */
  tickMs?: number
  /** 把触发的提醒写进文件，供自动化断言使用 */
  logFile?: string
  notify?: (title: string, body: string) => void
}

/**
 * 每 tick 从库里读一遍今天的任务，命中「正好到点且没提醒过」的就弹系统通知。
 * 用轮询而不是给每条任务排定时器：任务随时会被改时间/删除/完成，
 * 轮询让「当前真相」只有数据库一个来源，不用维护一堆需要撤销的定时器。
 */
function appQuitting(): boolean {
  return typeof app?.isReady === 'function' ? !app.isReady() : false
}

export function startReminderLoop(
  repository: TaskRepository,
  options: ReminderOptions = {}
): () => void {
  const tickMs = options.tickMs ?? 20_000
  const fired = new Set<string>()
  let day = dateKey()

  const deliver =
    options.notify ??
    ((title: string, body: string) => {
      if (!Notification.isSupported()) return
      new Notification({ title, body }).show()
    })

  const tick = () => {
    // 退出阶段数据库已经关掉，轮询再读会抛错并弹原生错误窗，这里直接跳过
    if (!options.logFile && appQuitting()) return
    const today = dateKey()
    if (today !== day) {
      // 换天要清空，否则同一任务第二天永远不会再提醒
      fired.clear()
      day = today
    }
    const now = new Date()
    const nowMinutes = now.getHours() * 60 + now.getMinutes()
    let hits: ReturnType<typeof dueReminders> = []
    try {
      hits = dueReminders(repository.list(), today, nowMinutes, fired)
    } catch (error) {
      console.error('[reminder] 读取任务失败', error)
      return
    }
    for (const task of hits) {
      fired.add(reminderKey(task.id, today))
      const body = reminderBody(task)
      try {
        deliver(task.title, body)
      } catch (error) {
        console.error('[reminder] 通知失败', error)
      }
      if (options.logFile) {
        try {
          appendFileSync(options.logFile, `${today} ${task.time} ${task.id} ${task.title}\n`)
        } catch (error) {
          console.error('[reminder] 写提醒日志失败', error)
        }
      }
    }
  }

  const timer = setInterval(tick, tickMs)
  timer.unref?.()
  tick()
  return () => clearInterval(timer)
}
