import { ipcMain } from 'electron'
import type { NoteRepository } from '../db/notes'
import type { NoteRecord } from '../../shared/ipc'
import { IPC_CHANNELS } from '../../shared/ipc'

function assertNote(value: unknown): NoteRecord {
  if (typeof value !== 'object' || value === null) throw new TypeError('笔记必须是对象')
  const note = value as Record<string, unknown>
  if (typeof note.id !== 'string' || note.id.length === 0) throw new TypeError('笔记 id 无效')
  if (typeof note.text !== 'string' || note.text.length === 0) throw new TypeError('笔记正文无效')
  if (typeof note.time !== 'string') throw new TypeError('笔记时间无效')
  if (note.tag !== undefined && typeof note.tag !== 'string') throw new TypeError('笔记标签无效')
  if (note.pinned !== undefined && typeof note.pinned !== 'boolean')
    throw new TypeError('置顶状态无效')
  return {
    id: note.id,
    text: note.text,
    time: note.time,
    tag: note.tag,
    pinned: note.pinned
  }
}

function assertPageArgs(offset: unknown, limit: unknown): { offset: number; limit: number } {
  if (typeof offset !== 'number' || !Number.isFinite(offset)) throw new TypeError('偏移量无效')
  if (typeof limit !== 'number' || !Number.isFinite(limit)) throw new TypeError('每页数量无效')
  return { offset, limit }
}

export const noteValidators = { assertNote, assertPageArgs }

export function registerNoteHandlers(repository: NoteRepository): void {
  ipcMain.handle(IPC_CHANNELS.notesBootstrap, (_event, value: unknown) => {
    repository.bootstrap((Array.isArray(value) ? value : []).map(assertNote))
  })

  ipcMain.handle(IPC_CHANNELS.notesPage, (_event, offset: unknown, limit: unknown) => {
    const args = assertPageArgs(offset, limit)
    return repository.page(args.offset, args.limit)
  })

  ipcMain.handle(IPC_CHANNELS.notesSearch, (_event, query: unknown, limit: unknown) => {
    if (typeof query !== 'string') throw new TypeError('查询必须是字符串')
    if (typeof limit !== 'number' || !Number.isFinite(limit)) throw new TypeError('结果数量无效')
    return repository.search(query, limit)
  })

  ipcMain.handle(IPC_CHANNELS.notesCreate, (_event, text: unknown, tag: unknown) => {
    if (typeof text !== 'string' || text.trim().length === 0) throw new TypeError('笔记正文无效')
    if (tag !== undefined && typeof tag !== 'string') throw new TypeError('笔记标签无效')
    return repository.create(text.trim(), tag)
  })

  ipcMain.handle(IPC_CHANNELS.notesTogglePin, (_event, id: unknown) => {
    if (typeof id !== 'string' || id.length === 0) throw new TypeError('笔记 id 无效')
    repository.togglePin(id)
  })
}
