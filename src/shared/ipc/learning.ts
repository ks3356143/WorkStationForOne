export type LearningKind = 'basic' | 'cloze'

export interface LearningItemRecord {
  id: string
  subject: string
  title: string
  source?: string
  notes?: string
  repetitions: number
  intervalDays: number
  ease: number
  nextReviewOn: string
  lastReviewedAt?: number
  /** FSRS 稳定度（天）；旧卡为 undefined，首次评分时建立 */
  stability?: number
  /** FSRS 难度（1–10） */
  difficulty?: number
  /** FSRS 累计失误次数 */
  lapses?: number
  /** 上次复习的本地日期键，用于计算 elapsed */
  lastReviewOn?: string
  active: boolean
  /** 卡型：basic 是普通问答，cloze 用 {{c1::…}} 挖空 */
  kind?: LearningKind
  /** 挖空原文（只有 kind=cloze 时有意义） */
  clozeSource?: string
  /** 来源笔记 id：从笔记转出来的卡片会记住出处 */
  noteId?: string
}

export interface LearningDraft {
  subject: string
  title: string
  source?: string
  notes?: string
  nextReviewOn?: string
  kind?: LearningKind
  clozeSource?: string
  noteId?: string
}

export interface LearningPatch {
  subject?: string
  title?: string
  source?: string
  notes?: string
  nextReviewOn?: string
  active?: boolean
  clozeSource?: string
}

export type LearningRating = 1 | 2 | 3 | 4

export interface LearningReviewRecord {
  rating: LearningRating
  reviewedAt: number
}

export interface LearningImportResult {
  created: LearningItemRecord[]
  /** 与现有卡或文件内重复而跳过的张数 */
  skipped: number
  /** 逐张校验失败的原因（第 N 张：…） */
  errors: string[]
}

export interface LearningExportResult {
  canceled: boolean
  path?: string
  count?: number
}

export interface LearningApi {
  list: () => Promise<LearningItemRecord[]>
  bootstrap: (items: LearningItemRecord[]) => Promise<void>
  create: (draft: LearningDraft) => Promise<LearningItemRecord>
  update: (id: string, patch: LearningPatch) => Promise<void>
  review: (id: string, rating: LearningRating) => Promise<LearningItemRecord>
  createMany: (drafts: LearningDraft[]) => Promise<LearningImportResult>
  exportCards: (subject?: string) => Promise<LearningExportResult>
  reviewHistory: (days: number) => Promise<LearningReviewRecord[]>
}
