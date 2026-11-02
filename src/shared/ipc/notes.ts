import type { TaskDraft, TaskRecord } from './tasks'

export interface NoteRecord {
  id: string
  text: string
  time: string
  tag?: string
  pinned?: boolean
}

export interface NotePage {
  items: NoteRecord[]
  total: number
}

export interface NoteSearchHit extends NoteRecord {
  snippet: string
}

/** 笔记编辑补丁：字段缺省表示不改；tag 传空字符串表示清除。 */
export interface NotePatch {
  text?: string
  tag?: string
  pinned?: boolean
}

export type NoteLinkStatus = 'ok' | 'missing' | 'ambiguous'

export interface NoteLinkRef {
  /** 正文里写的链接名（保存时的快照）。 */
  title: string
  status: NoteLinkStatus
  targetId?: string
  target?: NoteRecord
}

export interface NoteLinks {
  outgoing: NoteLinkRef[]
  backlinks: NoteRecord[]
}

export interface NoteApi {
  bootstrap: (notes: NoteRecord[]) => Promise<void>
  page: (offset: number, limit: number) => Promise<NotePage>
  search: (query: string, limit: number) => Promise<NoteSearchHit[]>
  create: (text: string, tag?: string) => Promise<NoteRecord>
  togglePin: (id: string) => Promise<void>
  update: (id: string, patch: NotePatch) => Promise<NoteRecord | undefined>
  remove: (id: string) => Promise<boolean>
  links: (id: string) => Promise<NoteLinks>
  titles: (query: string, limit: number, excludeId?: string) => Promise<string[]>
}

export interface CaptureApi {
  open: () => Promise<void>
  close: () => Promise<void>
  create: (draft: TaskDraft) => Promise<TaskRecord>
}
