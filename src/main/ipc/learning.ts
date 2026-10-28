import { ipcMain } from 'electron'
import { clozeFrontText, validateCloze } from '../../shared/cloze'
import { isDateKey } from '../../shared/date-key'
import type { LearningRepository } from '../db/learning'
import {
  IPC_CHANNELS,
  type LearningDraft,
  type LearningItemRecord,
  type LearningKind,
  type LearningPatch,
  type LearningRating
} from '../../shared/ipc'

const IPC = IPC_CHANNELS

const MAX_SUBJECT = 40
const MAX_TITLE = 200
const MAX_TEXT = 2000

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

export const registerLearningHandlersIPC = {
  assertLearningId,
  assertLearningRecord,
  assertLearningDraft,
  assertLearningPatch,
  assertRating,
  assertKind,
  assertClozeSource
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
}
