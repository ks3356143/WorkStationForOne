export interface ReminderApi {
  /** 今天已静音的任务 id；按本地日期键查询。 */
  muted: (day: string) => Promise<string[]>
  mute: (taskId: string, day: string) => Promise<void>
  unmute: (taskId: string, day: string) => Promise<void>
  unmuteDay: (day: string) => Promise<void>
}
