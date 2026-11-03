import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { NoteGraph, NoteRecord } from '../../../../shared/ipc'
import {
  graphKeyAction,
  isolatedNodeCount,
  layoutNoteGraph,
  neighborIds,
  NOTE_GRAPH_DEFAULT_VIEW,
  NOTE_GRAPH_HEIGHT,
  NOTE_GRAPH_ZOOM_STEP,
  NOTE_GRAPH_WIDTH,
  type NoteGraphViewport,
  panGraphView,
  sameGraphViewport,
  screenToGraphPoint,
  tagStats,
  wheelZoomFactor,
  withoutIsolatedNodes,
  zoomGraphView
} from '../../lib/note-graph'
import { GraphScene } from './GraphScene'

interface NoteGraphViewProps {
  revision: number
  onOpenNote: (note: NoteRecord) => void
}

const LEGEND_LIMIT = 4
const DRAG_THRESHOLD = 4

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
    moved: boolean
  } | null>(null)
  const suppressClick = useRef(false)
  const detachWheel = useRef<(() => void) | null>(null)

  const commitView = useCallback((update: (current: NoteGraphViewport) => NoteGraphViewport) => {
    setView((current) => {
      const next = update(current)
      return sameGraphViewport(current, next) ? current : next
    })
  }, [])

  const resetView = useCallback(() => setView(NOTE_GRAPH_DEFAULT_VIEW), [])

  const zoomBy = useCallback(
    (factor: number) => {
      commitView((current) =>
        zoomGraphView(
          current,
          { x: NOTE_GRAPH_WIDTH / 2, y: NOTE_GRAPH_HEIGHT / 2 },
          current.zoom * factor
        )
      )
    },
    [commitView]
  )

  const zoomIn = useCallback(() => zoomBy(NOTE_GRAPH_ZOOM_STEP), [zoomBy])
  const zoomOut = useCallback(() => zoomBy(1 / NOTE_GRAPH_ZOOM_STEP), [zoomBy])

  const toggleIsolated = useCallback(() => {
    setHideIsolated((current) => !current)
    resetView()
    setActiveId(null)
  }, [resetView])

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
        setHideIsolated((current) => (isolatedNodeCount(next) > 0 ? current : false))
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
  const attachCanvas = useCallback(
    (element: HTMLDivElement | null) => {
      detachWheel.current?.()
      detachWheel.current = null
      if (!element) return
      const handleWheel = (event: WheelEvent) => {
        const svg = svgRef.current
        if (!svg) return
        const factor = wheelZoomFactor(event.deltaY)
        if (factor === 1) return
        event.preventDefault()
        const point = screenToGraphPoint(event.clientX, event.clientY, svg.getBoundingClientRect())
        commitView((current) => zoomGraphView(current, point, current.zoom * factor))
      }
      element.addEventListener('wheel', handleWheel, { passive: false })
      detachWheel.current = () => element.removeEventListener('wheel', handleWheel)
    },
    [commitView]
  )

  useEffect(() => () => detachWheel.current?.(), [])

  const isolatedCount = useMemo(() => (graph ? isolatedNodeCount(graph) : 0), [graph])
  const visibleGraph = useMemo(() => {
    if (!graph) return null
    return hideIsolated && isolatedCount > 0 ? withoutIsolatedNodes(graph) : graph
  }, [graph, hideIsolated, isolatedCount])
  const layout = useMemo(
    () => (visibleGraph ? layoutNoteGraph(visibleGraph) : null),
    [visibleGraph]
  )
  const neighbors = useMemo(() => neighborIds(graph?.edges ?? []), [graph])
  const activeNeighbors = activeId ? neighbors.get(activeId) : undefined
  const tags = useMemo(() => (visibleGraph ? tagStats(visibleGraph.nodes) : []), [visibleGraph])
  const legend = useMemo(() => tags.slice(0, LEGEND_LIMIT), [tags])

  const openNode = useCallback(
    (id: string) => {
      if (suppressClick.current) return
      const api = typeof window === 'undefined' ? undefined : window.ws?.notes
      if (!api?.get) return
      void api.get(id).then((note) => {
        if (note) onOpenNote(note)
      })
    },
    [onOpenNote]
  )

  const activateNode = useCallback((id: string) => setActiveId(id), [])
  const deactivateNode = useCallback(() => setActiveId(null), [])

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return
    const svg = svgRef.current
    if (!svg) return
    const rect = svg.getBoundingClientRect()
    const scale = Math.min(rect.width / NOTE_GRAPH_WIDTH, rect.height / NOTE_GRAPH_HEIGHT) || 1
    suppressClick.current = false
    dragRef.current = {
      pointerId: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      view,
      scale,
      moved: false
    }
  }

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const screenDx = event.clientX - drag.clientX
    const screenDy = event.clientY - drag.clientY
    if (!drag.moved) {
      if (Math.hypot(screenDx, screenDy) < DRAG_THRESHOLD) return
      drag.moved = true
      setDragging(true)
      try {
        svgRef.current?.setPointerCapture(drag.pointerId)
      } catch {
        // 合成指针事件没有活动 pointerId，移动事件仍由 svg 接收。
      }
    }
    const dx = screenDx / drag.scale
    const dy = screenDy / drag.scale
    commitView(() => panGraphView(drag.view, dx, dy))
  }

  const endDrag = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    setDragging(false)
    if (!drag.moved) return
    suppressClick.current = true
    window.setTimeout(() => {
      suppressClick.current = false
    }, 0)
    try {
      svgRef.current?.releasePointerCapture(drag.pointerId)
    } catch {
      // 同上：合成事件没有可释放的指针捕获。
    }
  }

  const onKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    const action = graphKeyAction(event.key)
    if (!action) return
    event.preventDefault()
    if (action.kind === 'zoom') {
      zoomBy(action.factor)
      return
    }
    if (action.kind === 'reset') {
      resetView()
      return
    }
    commitView((current) => panGraphView(current, action.dx, action.dy))
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

  const zoomPercent = Math.round(view.zoom * 100)

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
            onClick={zoomOut}
          >
            −
          </button>
          <button
            type="button"
            className="w1-gtool w1-gzoom"
            aria-label={`重置图谱视图，当前 ${zoomPercent}%`}
            title="重置视图（0）"
            onClick={resetView}
          >
            {zoomPercent}%
          </button>
          <button
            type="button"
            className="w1-gtool"
            aria-label="放大图谱"
            title="放大（+）"
            onClick={zoomIn}
          >
            +
          </button>
          <button
            type="button"
            className={`w1-gtool w1-gtoggle${hideIsolated ? ' on' : ''}`}
            aria-pressed={hideIsolated}
            disabled={!hideIsolated && isolatedCount === 0}
            title={hideIsolated ? '恢复显示孤立笔记' : '只显示有双链的笔记'}
            onClick={toggleIsolated}
          >
            只看相连
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
            onDoubleClick={(event) => {
              if ((event.target as Element).closest('.w1-gnode')) return
              resetView()
            }}
            onKeyDown={onKeyDown}
          >
            <g
              className="w1-gview"
              transform={`translate(${view.panX} ${view.panY}) scale(${view.zoom})`}
            >
              {layout ? (
                <GraphScene
                  layout={layout}
                  activeId={activeId}
                  neighbors={neighbors}
                  activeNeighbors={activeNeighbors}
                  onOpen={openNode}
                  onActivate={activateNode}
                  onDeactivate={deactivateNode}
                />
              ) : null}
            </g>
          </svg>
        )}
      </div>
    </div>
  )
}
