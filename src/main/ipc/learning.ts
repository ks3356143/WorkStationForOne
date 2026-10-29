import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain } from 'electron'
import { clozeFrontText, validateCloze } from '../../shared/cloze'
import { dateKey, isDateKey } from '../../shared/date-key'
import { LEARNING_LIMITS, serializeLearningCsv } from '../../shared/learning-csv'
import type { LearningRepository } from '../db/learning'
import {
  IPC_CHANNELS,
  type LearningDraft,
  type LearningImportResult,
  type LearningItemRecord,
  type LearningKind,
  type LearningPatch,
  type LearningRating
} from '../../shared/ipc'

const IPC = IPC_CHANNELS

const MAX_SUBJECT = LEARNING_LIMITS.subject
const MAX_TITLE = LEARNING_LIMITS.title
const MAX_TEXT = LEARNING_LIMITS.text

function assertText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string') throw new TypeError(`${label}无效`)
  if (value.length > max) throw new TypeError(`${label}过长`)
  return value
}

function assertSubject(value: unknown): string {
  const subject = assertText(value, '科目', MAX_SUBJECT).trim()
  if (subject.length === 0) throw new TypeError('科目无效')
  return subject
}

function assertTitle(value: unknown): string {
  const title = assertText(value, '卡片正面', MAX_TITLE).trim()
  if (title.length === 0) throw new TypeError('卡片正面无效')
  return title
}

function assertFreeText(value: unknown, label: string): string {
  return assertText(value, label, MAX_TEXT).trim()
}

function assertDate(value: unknown): string {
  if (!isDateKey(value)) throw new TypeError('复习日期无效')
  return value
}

function assertKind(value: unknown): LearningKind {
  if (value !== 'basic' && value !== 'cloze') throw new TypeError('卡片类型无效')
  return value
}

function assertClozeSource(value: unknown): string {
  const text = assertText(value, '挖空原文', MAX_TEXT)
  const error = validateCloze(text)
  if (error) throw new TypeError(error)
  return text
}

export function assertLearningId(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new TypeError('卡片 id 无效')
  return value
}

function assertRating(value: unknown): LearningRating {
  if (value !== 1 && value !== 2 && value !== 3 && value !== 4) throw new TypeError('评分无效')
  return value
}

export function assertLearningRecord(value: unknown): LearningItemRecord {
  if (typeof value !== 'object' || value === null) throw new TypeError('卡片必须是对象')
  const record = value as Record<string, unknown>
  if (typeof record.active !== 'boolean') throw new TypeError('卡片启用状态无效')
  if (typeof record.repetitions !== 'number' || record.repetitions < 0)
    throw new TypeError('卡片复习次数无效')
  if (
    typeof record.intervalDays !== 'number' ||
    record.intervalDays < 0 ||
    record.intervalDays > 365
  )
    throw new TypeError('卡片间隔无效')
  if (typeof record.ease !== 'number' || record.ease < 1.3 || record.ease > 3)
    throw new TypeError('卡片难度系数无效')
  return {
    id: assertLearningId(record.id),
    subject: assertSubject(record.subject),
    title: assertTitle(record.title),
    source: record.source === undefined ? '' : assertFreeText(record.source, '来源'),
    notes: record.notes === undefined ? '' : assertFreeText(record.notes, '卡片背面'),
    repetitions: Math.trunc(record.repetitions),
    intervalDays: Math.trunc(record.intervalDays),
    ease: record.ease,
    nextReviewOn: assertDate(record.nextReviewOn),
    lastReviewedAt:
      record.lastReviewedAt === undefined
        ? undefined
        : (() => {
            if (
              typeof record.lastReviewedAt !== 'number' ||
              !Number.isFinite(record.lastReviewedAt)
            )
              throw new TypeError('卡片最近复习时间无效')
            return record.lastReviewedAt
          })(),
    active: record.active,
    ...(record.kind === 'cloze' ? { kind: assertKind(record.kind) } : {}),
    ...(record.kind === 'cloze'
      ? {
          clozeSource:
            record.clozeSource === undefined
              ? ''
              : assertText(record.clozeSource, '挖空原文', MAX_TEXT)
        }
      : {}),
    ...(typeof record.noteId === 'string' && record.noteId.length > 0
      ? { noteId: record.noteId }
      : {})
  }
}

export function assertLearningDraft(value: unknown): LearningDraft {
  if (typeof value !== 'object' || value === null) throw new TypeError('卡片草稿必须是对象')
  const draft = value as Record<string, unknown>
  const kind = draft.kind === undefined ? 'basic' : assertKind(draft.kind)
  const result: LearningDraft = {
    subject: assertSubject(draft.subject),
    title: assertTitle(draft.title)
  }
  if (draft.source !== undefined) result.source = assertFreeText(draft.source, '来源')
  if (draft.notes !== undefined) result.notes = assertFreeText(draft.notes, '卡片背面')
  if (draft.nextReviewOn !== undefined) result.nextReviewOn = assertDate(draft.nextReviewOn)
  if (kind === 'cloze') {
    if (draft.clozeSource === undefined) throw new TypeError('挖空卡缺少原文')
    result.kind = 'cloze'
    result.clozeSource = assertClozeSource(draft.clozeSource)
    // 正面由挖空原文推导，避免两处不一致
    result.title = clozeFrontText(result.clozeSource).slice(0, MAX_TITLE)
  }
  if (typeof draft.noteId === 'string' && draft.noteId.length > 0) result.noteId = draft.noteId
  return result
}

export function assertLearningPatch(value: unknown): LearningPatch {
  if (typeof value !== 'object' || value === null) throw new TypeError('卡片补丁必须是对象')
  const patch = value as Record<string, unknown>
  const result: LearningPatch = {}

  if (patch.subject !== undefined) result.subject = assertSubject(patch.subject)
  if (patch.title !== undefined) result.title = assertTitle(patch.title)
  if (patch.source !== undefined) result.source = assertFreeText(patch.source, '来源')
  if (patch.notes !== undefined) result.notes = assertFreeText(patch.notes, '卡片背面')
  if (patch.nextReviewOn !== undefined) result.nextReviewOn = assertDate(patch.nextReviewOn)
  if (patch.active !== undefined) {
    if (typeof patch.active !== 'boolean') throw new TypeError('卡片启用状态无效')
    result.active = patch.active
  }
  if (patch.clozeSource !== undefined) {
    result.clozeSource = assertClozeSource(patch.clozeSource)
    // 挖空原文改了，正面必须跟着改，否则库里的标题和复习时看到的对不上
    result.title = clozeFrontText(result.clozeSource).slice(0, MAX_TITLE)
  }

  if (Object.keys(result).length === 0) throw new TypeError('卡片补丁没有可更新字段')
  return result
}

export function assertHistoryDays(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('天数无效')
  const days = Math.trunc(value)
  if (days < 1 || days > 365) throw new TypeError('天数必须在 1–365 之间')
  return days
}

export function collectLearningDrafts(value: unknown): {
  drafts: LearningDraft[]
  errors: string[]
} {
  if (!Array.isArray(value)) throw new TypeError('导入内容必须是数组')
  if (value.length > LEARNING_LIMITS.maxRows) {
    throw new TypeError(`一次最多导入 ${LEARNING_LIMITS.maxRows} 张`)
  }

  const drafts: LearningDraft[] = []
  const errors: string[] = []
  value.forEach((raw, index) => {
    try {
      drafts.push(assertLearningDraft(raw))
    } catch (error) {
      const message = error instanceof Error ? error.message : '校验失败'
      errors.push(`第 ${index + 1} 张：${message}`)
    }
  })
  return { drafts, errors }
}

function cardKey(subject: string, title: string): string {
  return `${subject.trim()}\u0000${title.trim()}`
}

export const registerLearningHandlersIPC = {
  assertLearningId,
  assertLearningRecord,
  assertLearningDraft,
  assertLearningPatch,
  assertRating,
  assertKind,
  assertClozeSource,
  assertHistoryDays,
  collectLearningDrafts
} as const

export function registerLearningHandlers(repository: LearningRepository): void {
  ipcMain.handle(IPC.learningList, () => repository.list())

  ipcMain.handle(IPC.learningBootstrap, (_event, value: unknown) => {
    repository.bootstrap((Array.isArray(value) ? value : []).map(assertLearningRecord))
  })

  ipcMain.handle(IPC.learningCreate, (_event, value: unknown) =>
    repository.create(assertLearningDraft(value))
  )

  ipcMain.handle(IPC.learningUpdate, (_event, id: unknown, value: unknown) => {
    repository.update(assertLearningId(id), assertLearningPatch(value))
  })

  ipcMain.handle(IPC.learningReview, (_event, id: unknown, rating: unknown) =>
    repository.review(assertLearningId(id), assertRating(rating))
  )

  ipcMain.handle(IPC.learningCreateMany, (_event, value: unknown): LearningImportResult => {
    const { drafts, errors } = collectLearningDrafts(value)
    const seen = new Set(repository.list().map((card) => cardKey(card.subject, card.title)))
    const accepted: LearningDraft[] = []
    let skipped = 0
    for (const draft of drafts) {
      const key = cardKey(draft.subject, draft.title)
      if (seen.has(key)) {
        skipped += 1
        continue
      }
      seen.add(key)
      accepted.push(draft)
    }

    return { created: repository.createMany(accepted), skipped, errors }
  })

  ipcMain.handle(IPC.learningReviewHistory, (_event, days: unknown) =>
    repository.reviewHistory(assertHistoryDays(days))
  )

  ipcMain.handle(IPC.learningExport, async (_event, subject: unknown) => {
    if (subject !== undefined && typeof subject !== 'string') throw new TypeError('科目无效')
    const target = typeof subject === 'string' ? subject.trim() : ''
    if (target.length > MAX_SUBJECT) throw new TypeError('科目过长')

    const cards = repository
      .list()
      .filter((card) => card.active && (target.length === 0 || card.subject === target))
    if (cards.length === 0) return { canceled: false, count: 0 }

    const stamp = dateKey().replaceAll('-', '')
    const picked = await dialog.showSaveDialog({
      title: '导出学习卡片',
      defaultPath: `workstation-learning-${stamp}.csv`,
      filters: [{ name: 'CSV 文件', extensions: ['csv'] }]
    })
    if (picked.canceled || !picked.filePath) return { canceled: true }

    await writeFile(picked.filePath, serializeLearningCsv(cards), 'utf8')
    return { canceled: false, path: picked.filePath, count: cards.length }
  })
}
