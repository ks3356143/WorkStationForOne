import { useEffect, useMemo, useState } from 'react'
import type { NoteGraph, NoteRecord } from '../../../shared/ipc'
import { layoutNoteGraph, NOTE_GRAPH_HEIGHT, NOTE_GRAPH_WIDTH } from '../lib/note-graph'

interface NoteGraphViewProps {
  revision: number
  onOpenNote: (note: NoteRecord) => void
}

export function NoteGraphView({ revision, onOpenNote }: NoteGraphViewProps) {
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  // biome-ignore lint/correctness/useExhaustiveDependencies: revision / reload 用于重新拉取图谱
  useEffect(() => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.notes
    if (!api?.graph) {
      setError('关系图谱需要在桌面应用中打开')
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void api
      .graph()
      .then((next) => {
        if (cancelled) return
        setGraph(next)
        setLoading(false)
      })
      .catch((reason: unknown) => {
        if (cancelled) return
        setError(reason instanceof Error ? reason.message : '读取笔记关系失败')
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [revision, reload])

  const layout = useMemo(() => (graph ? layoutNoteGraph(graph) : null), [graph])

  const open = (id: string) => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.notes
    if (!api?.get) return
    void api.get(id).then((note) => {
      if (note) onOpenNote(note)
    })
  }

  if (loading) {
    return (
      <div className="w1-notegraph">
        <div className="w1-notegraphstate">正在连接笔记关系…</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="w1-notegraph">
        <div className="w1-notegraphstate error">
          <b>{error}</b>
          <button
            type="button"
            className="w1-reminderrestore"
            onClick={() => setReload((n) => n + 1)}
          >
            重试
          </button>
        </div>
      </div>
    )
  }

  if (!graph || graph.nodes.length === 0) {
    return (
      <div className="w1-notegraph">
        <div className="w1-notegraphstate">还没有笔记。先写下一条，就会出现在关系图里。</div>
      </div>
    )
  }

  return (
    <div className="w1-notegraph">
      <div className="w1-notegraphbar">
        <span className="w1-eyebrow">// 双链图谱</span>
        <b>{graph.nodes.length}</b>
        <span>个节点</span>
        <i>·</i>
        <b>{graph.edges.length}</b>
        <span>条双链</span>
        <em>点击节点打开笔记</em>
      </div>
      <div className="w1-notegraphcanvas">
        <svg
          viewBox={`0 0 ${NOTE_GRAPH_WIDTH} ${NOTE_GRAPH_HEIGHT}`}
          role="img"
          aria-label="笔记关系图谱"
        >
          <g className="w1-gedges">
            {layout?.edges.map((item) => {
              const active = activeId === item.edge.sourceId || activeId === item.edge.targetId
              return (
                <line
                  key={`${item.edge.sourceId}-${item.edge.targetId}-${item.edge.title}`}
                  className={`w1-gedge${active ? ' active' : ''}`}
                  x1={item.x1}
                  y1={item.y1}
                  x2={item.x2}
                  y2={item.y2}
                />
              )
            })}
          </g>
          <g className="w1-gnodes">
            {layout?.nodes.map((item, index) => {
              const connected = layout.edges.some(
                (edge) =>
                  (edge.edge.sourceId === activeId && edge.edge.targetId === item.node.id) ||
                  (edge.edge.targetId === activeId && edge.edge.sourceId === item.node.id)
              )
              return (
                <g
                  key={item.node.id}
                  className={[
                    'w1-gnode',
                    activeId === item.node.id ? 'active' : '',
                    connected ? 'connected' : '',
                    item.node.pinned ? 'pinned' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  transform={`translate(${item.x} ${item.y})`}
                  style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}
                  role="button"
                  tabIndex={0}
                  aria-label={`打开笔记：${item.node.title}`}
                  onClick={() => open(item.node.id)}
                  onMouseEnter={() => setActiveId(item.node.id)}
                  onMouseLeave={() => setActiveId(null)}
                  onFocus={() => setActiveId(item.node.id)}
                  onBlur={() => setActiveId(null)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return
                    event.preventDefault()
                    open(item.node.id)
                  }}
                >
                  <circle r={item.radius} />
                  <text y={item.radius + 16}>
                    {item.node.title.length > 14
                      ? `${item.node.title.slice(0, 14)}…`
                      : item.node.title}
                  </text>
                </g>
              )
            })}
          </g>
        </svg>
      </div>
    </div>
  )
}
