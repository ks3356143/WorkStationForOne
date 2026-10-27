import { useCallback, useEffect, useRef, useState } from 'react'
import type { NoteRecord, NoteSearchHit } from '../../../shared/ipc'
import { useWorkstation } from '../store/useWorkstation'
import { PlusIcon } from './Glyphs'
import { NoteList, NoteListFooter, type NoteListRow } from './NoteList'

type Mode = 'browse' | 'search'

const PAGE_SIZE = 60
const SEARCH_LIMIT = 60

export function notesToRows(notes: NoteRecord[]): NoteListRow[] {
  return notes.map((note) => ({
    id: note.id,
    text: note.text,
    time: note.time,
    tag: note.tag,
    pinned: note.pinned === true
  }))
}

export function hitsToRows(hits: NoteSearchHit[]): NoteListRow[] {
  return hits.map((hit) => ({
    id: hit.id,
    text: hit.text,
    time: hit.time,
    tag: hit.tag,
    pinned: hit.pinned === true,
    snippet: hit.snippet
  }))
}

export function NotesView() {
  const api = typeof window === 'undefined' ? undefined : window.ws?.notes
  const memoryNotes = useWorkstation((state) => state.notes)
  const noteRevision = useWorkstation((state) => state.noteRevision)
  const openQuickNote = useWorkstation((state) => state.openQuickNote)

  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<Mode>('browse')
  const [rows, setRows] = useState<NoteListRow[]>(() => notesToRows(memoryNotes))
  const [total, setTotal] = useState(memoryNotes.length)
  const [loading, setLoading] = useState(false)
  const [searchRefresh, setSearchRefresh] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const offsetRef = useRef(0)
  const searchSeq = useRef(0)
  const revisionRef = useRef(noteRevision)
  // 用 ref 而不是 state 做互斥：清空搜索时要在同一次提交里取消在途加载，
  // 闭包里的 loading 永远是旧值，会把 loadPage 挡在门外并卡住载入态。
  const loadingRef = useRef(false)

  const loadPage = useCallback(
    async (reset: boolean) => {
      if (!api || loadingRef.current) return
      loadingRef.current = true
      setLoading(true)
      setError(null)
      try {
        const offset = reset ? 0 : offsetRef.current
        const page = await api.page(offset, PAGE_SIZE)
        offsetRef.current = offset + page.items.length
        setRows((current) =>
          reset ? notesToRows(page.items) : [...current, ...notesToRows(page.items)]
        )
        setTotal(page.total)
        setMode('browse')
      } catch (cause) {
        console.error('[notes] 读取失败', cause)
        setError('读取笔记失败')
      } finally {
        loadingRef.current = false
        setLoading(false)
      }
    },
    [api]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies: api 与 loadPage 在挂载后不变，只在挂载时拉第一页
  useEffect(() => {
    if (!api) return
    void loadPage(true)
  }, [])

  useEffect(() => {
    if (revisionRef.current === noteRevision) return
    if (!api || loading) return
    revisionRef.current = noteRevision
    if (query.trim()) {
      setSearchRefresh((value) => value + 1)
      return
    }
    void loadPage(true)
  }, [api, loading, noteRevision, query, loadPage])

  // biome-ignore lint/correctness/useExhaustiveDependencies: 依赖刻意收窄到 query/searchRefresh；loadPage 依赖 loading，展开会重复触发搜索
  useEffect(() => {
    const trimmed = query.trim()

    if (!trimmed) {
      // 清空查询同时作废在途搜索，否则迟到的搜索结果会盖掉浏览列表。
      searchSeq.current += 1
      loadingRef.current = false
      if (api) void loadPage(true)
      else {
        setRows(notesToRows(memoryNotes))
        setTotal(memoryNotes.length)
        setMode('browse')
      }
      return
    }

    if (!api) {
      const needle = trimmed.toLowerCase()
      const hits = memoryNotes.filter((note) => note.text.toLowerCase().includes(needle))
      const rowsFromMemory = notesToRows(hits).map((row) => ({ ...row, snippet: row.text }))
      setRows(rowsFromMemory)
      setTotal(rowsFromMemory.length)
      setMode('search')
      return
    }

    const seq = ++searchSeq.current
    loadingRef.current = true
    setLoading(true)
    setError(null)
    const timer = window.setTimeout(() => {
      void api
        .search(trimmed, SEARCH_LIMIT)
        .then((hits) => {
          if (seq !== searchSeq.current) return
          setRows(hitsToRows(hits))
          setTotal(hits.length)
          setMode('search')
        })
        .catch((cause) => {
          if (seq !== searchSeq.current) return
          console.error('[notes] 搜索失败', cause)
          setError('搜索失败')
        })
        .finally(() => {
          if (seq === searchSeq.current) {
            loadingRef.current = false
            setLoading(false)
          }
        })
    }, 160)

    return () => {
      window.clearTimeout(timer)
      // 被取消的搜索要自己收掉载入态与互斥标记，否则页面会一直停在「载入中」。
      if (seq === searchSeq.current) {
        loadingRef.current = false
        setLoading(false)
      }
    }
  }, [query, searchRefresh])

  const hasMore = mode === 'browse' && rows.length < total

  return (
    <section className="w1-notesview" aria-label="全部笔记">
      <div className="w1-nvbox">
        <header className="w1-nvhead">
          <div className="w1-nvtitle">
            <div className="w1-date">
              <i>//</i> 笔记库
            </div>
            <h1>
              全部笔记<span>.</span>
            </h1>
          </div>
          <div className="w1-nvheadright">
            <span className="w1-nvcount">
              {mode === 'search'
                ? `命中 ${total}${total >= SEARCH_LIMIT ? '+' : ''}`
                : `共 ${total} 条 · 已载入 ${rows.length}`}
            </span>
            <button
              className="w1-nvnew"
              type="button"
              title="新建笔记（Ctrl+N）"
              onClick={openQuickNote}
            >
              <PlusIcon width={10} height={10} />
              新建笔记
              <kbd>^N</kbd>
            </button>
          </div>
        </header>

        <div className="w1-nvsearch">
          <span>&gt;</span>
          <input
            className="w1-nvinput"
            value={query}
            placeholder="搜索笔记内容，支持中文与英文…"
            aria-label="搜索笔记"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.keyCode === 229) return
              if (event.key === 'Escape' && query) setQuery('')
            }}
          />
          {query ? (
            <button className="w1-nvclear" type="button" onClick={() => setQuery('')}>
              清空
            </button>
          ) : (
            <kbd>Esc</kbd>
          )}
        </div>

        {error ? <div className="w1-nverror">{error}</div> : null}

        <NoteList
          rows={rows}
          loading={loading}
          mode={mode}
          resetKey={`${mode}:${query}`}
          endLabel={
            !hasMore && rows.length > 0
              ? `// END · ${mode === 'search' ? '命中' : '共'} ${total} 条`
              : undefined
          }
        />

        {hasMore ? (
          <NoteListFooter
            loading={loading}
            visible={rows.length}
            total={total}
            onMore={() => void loadPage(false)}
          />
        ) : null}

        <div className="w1-nvfoot">
          <span>本地 SQLite · trigram 全文索引</span>
          <span>
            {mode === 'search' ? '两字以内自动回退模糊匹配' : '置顶优先 · 按更新时间排序'}
          </span>
        </div>
      </div>
    </section>
  )
}
