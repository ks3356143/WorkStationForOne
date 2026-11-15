export interface MoodRecord {
  /** 本地日期键 YYYY-MM-DD，一天一条 */
  day: string
  /** 心情 1–5 */
  mood: number
  /** 精力 1–5 */
  energy: number
  note: string
  updatedAt: number
}

export interface MoodSaveInput {
  day: string
  mood: number
  energy: number
  note?: string
}

export interface MoodApi {
  get: (day: string) => Promise<MoodRecord | null>
  save: (input: MoodSaveInput) => Promise<MoodRecord>
  recent: (days: number) => Promise<MoodRecord[]>
}
