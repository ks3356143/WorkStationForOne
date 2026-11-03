import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteGraph, NoteRecord } from '../../../shared/ipc'
import {
  isolatedNodeCount,
  layoutNoteGraph,
  NOTE_GRAPH_DEFAULT_VIEW,
  NOTE_GRAPH_HEIGHT,
  NOTE_GRAPH_WIDTH,
  type NoteGraphViewport,
  panGraphView,
  screenToGraphPoint,
  tagStats,
  tagTone,
  withoutIsolatedNodes,
  zoomGraphView
} from '../lib/note-graph'

interface NoteGraphViewProps {
  revision: number
  onOpenNote: (note: NoteRecord) => void
}

const ZOOM_STEP = 1.2
const LEGEND_LIMIT = 4

export function NoteGraphView({ revision, onOpenNote }: NoteGraphViewProps) {
  const [graph, setGraph] = useState<NoteGraph | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [view, setView] = useState<NoteGraphViewport>(NOTE_GRAPH_DEFAULT_VIEW)
  const [hideIsolated, setHideIsolated] = useState(false)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const dragRef = useRef<{
    pointerId: number
    clientX: number
    clientY: number
    view: NoteGraphViewport
    scale: number
  } | null>(null)
  const detachWheel = useRef<(() => void) | null>(null)

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
        setView(NOTE_GRAPH_DEFAULT_VIEW)
        setActiveId(null)
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

  // React 的 onWheel 在根节点上是 passive，必须原生监听才能阻止外层滚动。
  const attachCanvas = useCallback((element: HTMLDivElement | null) => {
    detachWheel.current?.()
    detachWheel.current = null
    if (!element) return
    const handleWheel = (event: WheelEvent) => {
      const svg = svgRef.current
      if (!svg) return
      event.preventDefault()
      if (event.deltaY === 0) return
      const point = screenToGraphPoint(event.clientX, event.clientY, svg.getBoundingClientRect())
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      setView((current) => zoomGraphView(current, point, current.zoom * factor))
    }
    element.addEventListener('wheel', handleWheel, { passive: false })
    detachWheel.current = () => element.removeEventListener('wheel', handleWheel)
  }, [])

  useEffect(() => () => detachWheel.current?.(), [])

  const isolatedCount = useMemo(() => (graph ? isolatedNodeCount(graph) : 0), [graph])
  const visibleGraph = useMemo(
    () => (graph && hideIsolated ? withoutIsolatedNodes(graph) : graph),
    [graph, hideIsolated]
  )
  const layout = useMemo(
    () => (visibleGraph ? layoutNoteGraph(visibleGraph) : null),
    [visibleGraph]
  )
  const tags = useMemo(() => (visibleGraph ? tagStats(visibleGraph.nodes) : []), [visibleGraph])
  const legend = tags.slice(0, LEGEND_LIMIT)
  const linkedIds = useMemo(() => {
    const linked = new Set<string>()
    for (const edge of graph?.edges ?? []) {
      linked.add(edge.sourceId)
      linked.add(edge.targetId)
    }
    return linked
  }, [graph])

  const open = (id: string) => {
    const api = typeof window === 'undefined' ? undefined : window.ws?.notes
    if (!api?.get) return
    void api.get(id).then((note) => {
      if (note) onOpenNote(note)
    })
  }

  const zoomBy = (factor: number) => {
    setView((current) =>
      zoomGraphView(
        current,
        { x: NOTE_GRAPH_WIDTH / 2, y: NOTE_GRAPH_HEIGHT / 2 },
        current.zoom * factor
      )
    )
  }

  const toggleIsolated = () => {
    setHideIsolated((current) => !current)
    setView(NOTE_GRAPH_DEFAULT_VIEW)
    setActiveId(null)
  }

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const target = event.target as Element | null
    if (target?.closest('.w1-gnode')) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scale = Math.min(rect.width / NOTE_GRAPH_WIDTH, rect.height / NOTE_GRAPH_HEIGHT) || 1
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view,
      scale
    }
    try {
      svg.setPointerCapture(event.pointerId)
    } catch {
      // 合成指针事件没有活动 pointerId，移动事件仍由 svg 接收。
    }
    setDragging(true)
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = (event.clientX - drag.clientX) / drag.scale
    const dy = (event.clientY - drag.clientY) / drag.scale
    setView(panGraphView(drag.view, dx, dy))
  }

  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(false)
    try {
      svgRef.current?.releasePointerCapture(drag.pointerId)
    } catch {
      // 同上：合成事件没有可释放的指针捕获。
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault()
      zoomBy(ZOOM_STEP)
      return
    }
    if (event.key === '-') {
      event.preventDefault()
      zoomBy(1 / ZOOM_STEP)
      return
    }
    if (event.key === '0') {
      event.preventDefault()
      setView(NOTE_GRAPH_DEFAULT_VIEW)
      return
    }
    let delta: [number, number] | null = null
    if (event.key === 'ArrowLeft') delta = [-40, 0]
    else if (event.key === 'ArrowRight') delta = [40, 0]
    else if (event.key === 'ArrowUp') delta = [0, -40]
    else if (event.key === 'ArrowDown') delta = [0, 40]
    if (!delta) return
    event.preventDefault()
    setView((current) => panGraphView(current, delta[0], delta[1]))
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
        <b>{visibleGraph?.nodes.length ?? 0}</b>
        <span>节点</span>
        <i>·</i>
        <b>{visibleGraph?.edges.length ?? 0}</b>
        <span>条双链</span>
        {isolatedCount > 0 ? (
          <>
            <i>·</i>
            <span>{isolatedCount} 个孤立</span>
          </>
        ) : null}
        {legend.length > 0 ? (
          <div className="w1-gtags" role="group" aria-label="标签图例">
            {legend.map((item) => (
              <span className="w1-gtag" key={item.tag} title={`${item.tag} · ${item.count} 条笔记`}>
                <i className={`w1-gtagdot w1-gtone-${item.tone}`} />
                <span>{item.tag}</span>
              </span>
            ))}
            {tags.length > LEGEND_LIMIT ? (
              <span className="w1-gtagmore">+{tags.length - LEGEND_LIMIT}</span>
            ) : null}
          </div>
        ) : null}
        <div className="w1-gtools">
          <button
            type="button"
            className="w1-gtool"
            aria-label="缩小图谱"
            title="缩小（-）"
            onClick={() => zoomBy(1 / ZOOM_STEP)}
          >
            −
          </button>
          <button
            type="button"
            className="w1-gtool w1-gzoom"
            aria-label="重置图谱视图"
            title="重置视图（0）"
            onClick={() => setView(NOTE_GRAPH_DEFAULT_VIEW)}
          >
            {Math.round(view.zoom * 100)}%
          </button>
          <button
            type="button"
            className="w1-gtool"
            aria-label="放大图谱"
            title="放大（+）"
            onClick={() => zoomBy(ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            className="w1-gtool w1-gfit"
            title="复位缩放与平移（0）"
            onClick={() => setView(NOTE_GRAPH_DEFAULT_VIEW)}
          >
            复位
          </button>
          <button
            type="button"
            className={`w1-gtool w1-gtoggle${hideIsolated ? ' on' : ''}`}
            aria-pressed={hideIsolated}
            disabled={isolatedCount === 0}
            title={hideIsolated ? '恢复显示孤立笔记' : '只显示有双链的笔记'}
            onClick={toggleIsolated}
          >
            {hideIsolated ? '显示全部' : '只看相连'}
          </button>
        </div>
      </div>
      <div className="w1-notegraphcanvas" ref={attachCanvas}>
        {layout && layout.nodes.length === 0 ? (
          <div className="w1-notegraphstate">
            <b>没有相连的笔记</b>
            <span>当前笔记都没有双链。用 [[笔记首行]] 建立关系。</span>
            <button type="button" className="w1-reminderrestore" onClick={toggleIsolated}>
              显示全部
            </button>
          </div>
        ) : (
          <svg
            ref={svgRef}
            className={dragging ? 'dragging' : ''}
            viewBox={`0 0 ${NOTE_GRAPH_WIDTH} ${NOTE_GRAPH_HEIGHT}`}
            role="group"
            aria-label="笔记关系图谱，可滚轮缩放、拖拽平移"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onDoubleClick={() => setView(NOTE_GRAPH_DEFAULT_VIEW)}
            onKeyDown={onKeyDown}
          >
            <g
              className="w1-gview"
              transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}
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
                  const tone = tagTone(item.node.tag)
                  return (
                    <g
                      key={item.node.id}
                      className={[
                        'w1-gnode',
                        tone > 0 ? `w1-gtone-${tone}` : '',
                        activeId === item.node.id ? 'active' : '',
                        connected ? 'connected' : '',
                        item.node.pinned ? 'pinned' : '',
                        linkedIds.has(item.node.id) ? '' : 'isolated'
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      transform={`translate(${item.x} ${item.y})`}
                      style={{ animationDelay: `${Math.min(index * 22, 400)}ms` }}
                      role="button"
                      tabIndex={0}
                      aria-label={`打开笔记：${item.node.title}${
                        item.node.tag ? `（${item.node.tag}）` : ''
                      }`}
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
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
