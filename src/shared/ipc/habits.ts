export interface HabitRecord {
  id: string
  name: string
  /** 打卡日期键，仅保留今天及以前 */
  checkins: string[]
}

export interface HabitApi {
  list: () => Promise<HabitRecord[]>
  bootstrap: (habits: HabitRecord[]) => Promise<void>
  setCheckin: (id: string, day: string, done: boolean) => Promise<void>
  create: (name: string) => Promise<HabitRecord>
  rename: (id: string, name: string) => Promise<boolean>
  remove: (id: string) => Promise<boolean>
}
