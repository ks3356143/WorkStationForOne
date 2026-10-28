import { bindNotePersistence, replaceNotes, useWorkstation } from '../store/useWorkstation'
import type { NotePatch, NoteRecord } from '../../../shared/ipc'
import type { Note } from '../types'

export interface HydrateNoteDeps {
  bootstrap: (notes: NoteRecord[]) => Promise<void>
  page: (offset: number, limit: number) => Promise<{ items: NoteRecord[]; total: number }>
  create: (text: string, tag?: string) => Promise<NoteRecord>
  search?: (query: string, limit: number) => Promise<unknown>
  togglePin?: (id: string) => Promise<void>
  update?: (id: string, patch: NotePatch) => Promise<NoteRecord | undefined>
  remove?: (id: string) => Promise<boolean>
}

export async function hydrateNotes(
  deps: HydrateNoteDeps | undefined = bridgeNotes()
): Promise<void> {
  if (!deps) return

  // 老桥没有这两个方法时不要绑定空实现，否则 store 会以为写入成功了
  const update = deps.update
  const remove = deps.remove
  bindNotePersistence({
    create: (text, tag) => deps.create(text, tag),
    ...(update ? { update: (id: string, patch: NotePatch) => update(id, patch) } : {}),
    ...(remove ? { remove: (id: string) => remove(id) } : {})
  })

  try {
    const first = await deps.page(0, 3)
    if (first.total === 0) {
      await deps.bootstrap(useWorkstation.getState().notes)
      return
    }
    replaceNotes(first.items satisfies Note[], first.total)
  } catch (error) {
    console.error('[persistence] 笔记读取失败，使用内存种子数据', error)
  }
}

function bridgeNotes(): HydrateNoteDeps | undefined {
  return typeof window === 'undefined' ? undefined : window.ws?.notes
}
