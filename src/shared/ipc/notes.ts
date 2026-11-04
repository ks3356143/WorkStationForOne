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

export interface NoteTagCount {
  tag: string
  count: number
}

export interface NoteTags {
  total: number
  tags: NoteTagCount[]
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

export interface NoteGraphNode {
  id: string
  title: string
  time: string
  tag?: string
  pinned?: boolean
}

export interface NoteGraphEdge {
  sourceId: string
  targetId: string
  title: string
}

export interface NoteGraph {
  nodes: NoteGraphNode[]
  edges: NoteGraphEdge[]
}

export interface NoteApi {
  bootstrap: (notes: NoteRecord[]) => Promise<void>
  page: (offset: number, limit: number, tag?: string) => Promise<NotePage>
  search: (query: string, limit: number, tag?: string) => Promise<NoteSearchHit[]>
  tags: () => Promise<NoteTags>
  create: (text: string, tag?: string) => Promise<NoteRecord>
  togglePin: (id: string) => Promise<void>
  update: (id: string, patch: NotePatch) => Promise<NoteRecord | undefined>
  remove: (id: string) => Promise<boolean>
  links: (id: string) => Promise<NoteLinks>
  titles: (query: string, limit: number, excludeId?: string) => Promise<string[]>
  get: (id: string) => Promise<NoteRecord | undefined>
  graph: () => Promise<NoteGraph>
}

export interface CaptureApi {
  open: () => Promise<void>
  close: () => Promise<void>
  create: (draft: TaskDraft) => Promise<TaskRecord>
}
