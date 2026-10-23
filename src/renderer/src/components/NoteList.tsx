import { useEffect, useMemo, useRef, useState } from 'react'

export interface NoteListRow {
  id: string
  text: string
  time: string
  tag?: string
  pinned: boolean
  snippet?: string
}

interface NoteListProps {
  rows: NoteListRow[]
  loading: boolean
  mode: 'browse' | 'search'
}

export const ROW_HEIGHT = 64
const OVERSCAN = 6

export interface WindowRange {
  start: number
  end: number
  offset: number
  totalHeight: number
}

export function computeWindow(
  scrollTop: number,
  viewportHeight: number,
  count: number,
  rowHeight = ROW_HEIGHT,
  overscan = OVERSCAN
): WindowRange {
  const totalHeight = count * rowHeight
  if (count === 0) return { start: 0, end: 0, offset: 0, totalHeight: 0 }

  const visible = Math.ceil(viewportHeight / rowHeight)
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(count, start + visible + overscan * 2)
  return { start, end, offset: start * rowHeight, totalHeight }
}

function highlight(text: string, snippet?: string): string {
  return snippet && snippet.length > 0 ? snippet : text
}

export function NoteList({ rows, loading, mode }: NoteListProps) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(420)

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (entry) setHeight(entry.contentRect.height)
    })
    observer.observe(node)
    setHeight(node.clientHeight)
    return () => observer.disconnect()
  }, [])

  const range = useMemo(
    () => computeWindow(scrollTop, height, rows.length),
    [scrollTop, height, rows.length]
  )
  const slice = rows.slice(range.start, range.end)

  if (rows.length === 0 && !loading) {
    return (
      <div className="w1-nvempty">
        {mode === 'search' ? '没有匹配的笔记。换个关键词试试。' : '还没有笔记。按 ^N 记下第一条。'}
      </div>
    )
  }

  return (
    <div
      ref={viewportRef}
      className="w1-nvlist"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      role="list"
      aria-label="笔记列表"
    >
      <div className="w1-nvspacer" style={{ height: range.totalHeight }}>
        <div style={{ transform: `translateY(${range.offset}px)` }}>
          {slice.map((row, index) => (
            <article className="w1-nvrow" role="listitem" key={row.id} data-index={range.start + index}>
              <div className="w1-nvrowtop">
                {row.pinned ? <span className="w1-nvpin">置顶</span> : null}
                {row.tag ? <span className="w1-nvtag">{row.tag}</span> : null}
                <time>{row.time}</time>
              </div>
              <p className="w1-nvtext">{highlight(row.text, row.snippet)}</p>
            </article>
          ))}
        </div>
      </div>
      {loading ? <div className="w1-nvloading">载入中…</div> : null}
    </div>
  )
}

export function NoteListFooter({
  loading,
  visible,
  total,
  onMore
}: {
  loading: boolean
  visible: number
  total: number
  onMore: () => void
}) {
  if (visible >= total) return null
  return (
    <button className="w1-nvmore" type="button" disabled={loading} onClick={onMore}>
      {loading ? '载入中…' : `载入更多（剩余 ${total - visible}）`}
    </button>
  )
}
