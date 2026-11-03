import { describe, expect, it } from 'vitest'
import type { NoteGraph, NoteGraphEdge } from '../../../shared/ipc'
import {
  clampGraphZoom,
  graphKeyAction,
  isolatedNodeCount,
  layoutNoteGraph,
  neighborIds,
  NOTE_GRAPH_DEFAULT_VIEW,
  NOTE_GRAPH_HEIGHT,
  NOTE_GRAPH_MAX_ZOOM,
  NOTE_GRAPH_MIN_ZOOM,
  NOTE_GRAPH_PAN_MARGIN,
  NOTE_GRAPH_PAN_STEP,
  NOTE_GRAPH_WIDTH,
  NOTE_GRAPH_ZOOM_STEP,
  panGraphView,
  sameGraphViewport,
  screenToGraphPoint,
  tagStats,
  tagTone,
  wheelZoomFactor,
  withoutIsolatedNodes,
  zoomGraphView
} from './note-graph'

const graph: NoteGraph = {
  nodes: [
    { id: 'a', title: 'A', time: '刚刚' },
    { id: 'b', title: 'B', time: '刚刚' },
    { id: 'c', title: 'C', time: '刚刚', pinned: true }
  ],
  edges: [
    { sourceId: 'a', targetId: 'b', title: 'B' },
    { sourceId: 'b', targetId: 'c', title: 'C' }
  ]
}

describe('layoutNoteGraph', () => {
  it('为每个节点生成确定且在边界内的坐标', () => {
    const first = layoutNoteGraph(graph)
    const second = layoutNoteGraph(graph)

    expect(first.nodes).toHaveLength(3)
    expect(first.edges).toHaveLength(2)
    for (const item of first.nodes) {
      expect(Number.isFinite(item.x)).toBe(true)
      expect(Number.isFinite(item.y)).toBe(true)
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.x).toBeLessThanOrEqual(NOTE_GRAPH_WIDTH)
      expect(item.y).toBeGreaterThanOrEqual(0)
      expect(item.y).toBeLessThanOrEqual(NOTE_GRAPH_HEIGHT)
    }
    expect(second).toEqual(first)
  })

  it('空图谱不产生布局', () => {
    expect(layoutNoteGraph({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] })
  })
})

describe('note graph viewport', () => {
  it('以指针为锚点缩放并夹住倍率', () => {
    const zoomed = zoomGraphView(NOTE_GRAPH_DEFAULT_VIEW, { x: 500, y: 310 }, 2)

    expect(zoomed.zoom).toBe(2)
    expect(zoomed.panX + 500 * zoomed.zoom).toBe(500)
    expect(zoomed.panY + 310 * zoomed.zoom).toBe(310)
    expect(clampGraphZoom(10)).toBe(NOTE_GRAPH_MAX_ZOOM)
    expect(clampGraphZoom(0.1)).toBe(NOTE_GRAPH_MIN_ZOOM)
    expect(zoomGraphView(NOTE_GRAPH_DEFAULT_VIEW, { x: 0, y: 0 }, 99).zoom).toBe(
      NOTE_GRAPH_MAX_ZOOM
    )
  })

  it('平移时夹取到精确边界', () => {
    const far = panGraphView(NOTE_GRAPH_DEFAULT_VIEW, 5000, 5000)
    const back = panGraphView({ zoom: 2, panX: 0, panY: 0 }, -5000, -5000)

    expect(far.panX).toBe(NOTE_GRAPH_WIDTH - NOTE_GRAPH_PAN_MARGIN)
    expect(far.panY).toBe(NOTE_GRAPH_HEIGHT - NOTE_GRAPH_PAN_MARGIN)
    expect(back.panX).toBe(NOTE_GRAPH_PAN_MARGIN - NOTE_GRAPH_WIDTH * 2)
    expect(back.panY).toBe(NOTE_GRAPH_PAN_MARGIN - NOTE_GRAPH_HEIGHT * 2)
  })

  it('已有平移时缩放仍把指针下的图坐标固定住', () => {
    const start = { zoom: 1.5, panX: -200, panY: -120 }
    const pointer = { x: 400, y: 260 }
    const graphX = (pointer.x - start.panX) / start.zoom
    const graphY = (pointer.y - start.panY) / start.zoom
    const next = zoomGraphView(start, pointer, 2.2)

    expect(next.zoom).toBe(2.2)
    expect(next.panX + graphX * next.zoom).toBeCloseTo(pointer.x, 6)
    expect(next.panY + graphY * next.zoom).toBeCloseTo(pointer.y, 6)
  })

  it('非有限倍率回到默认缩放', () => {
    expect(clampGraphZoom(Number.NaN)).toBe(1)
    expect(clampGraphZoom(Number.POSITIVE_INFINITY)).toBe(1)
  })

  it('把屏幕坐标换算到 viewBox 并兼容留白', () => {
    expect(screenToGraphPoint(500, 310, { left: 0, top: 0, width: 1000, height: 620 })).toEqual({
      x: 500,
      y: 310
    })
    expect(screenToGraphPoint(600, 310, { left: 0, top: 0, width: 1200, height: 620 })).toEqual({
      x: 500,
      y: 310
    })
    expect(screenToGraphPoint(650, 360, { left: 50, top: 50, width: 1000, height: 620 })).toEqual({
      x: 600,
      y: 310
    })
  })
})

describe('note graph filtering and tags', () => {
  it('过滤没有双链的节点与相关边', () => {
    const isolated: NoteGraph = {
      nodes: [...graph.nodes, { id: 'd', title: 'D', time: '刚刚' }],
      edges: graph.edges
    }
    const filtered = withoutIsolatedNodes(isolated)

    expect(filtered.nodes.map((node) => node.id)).toEqual(['a', 'b', 'c'])
    expect(filtered.edges).toHaveLength(2)
    expect(isolatedNodeCount(isolated)).toBe(1)
    expect(isolatedNodeCount({ nodes: graph.nodes, edges: [] })).toBe(3)
  })

  it('标签颜色只由标签名决定', () => {
    expect(tagTone()).toBe(0)
    expect(tagTone('   ')).toBe(0)
    expect(tagTone('工作')).toBeGreaterThanOrEqual(1)
    expect(tagTone('工作')).toBeLessThanOrEqual(6)
    expect(tagTone('工作')).toBe(tagTone('工作'))
  })

  it('标签统计按出现次数排序并可截断', () => {
    const stats = tagStats([
      { id: '1', title: '1', time: '', tag: '工作' },
      { id: '2', title: '2', time: '', tag: '工作' },
      { id: '3', title: '3', time: '', tag: '灵感' },
      { id: '4', title: '4', time: '' }
    ])

    expect(stats[0]).toMatchObject({ tag: '工作', count: 2 })
    expect(stats[1]).toMatchObject({ tag: '灵感', count: 1 })
    expect(tagStats([{ id: '1', title: '1', time: '', tag: '工作' }], 0)).toEqual([])
  })

  it('同频标签按名称稳定排序', () => {
    const stats = tagStats([
      { id: '1', title: '1', time: '', tag: '乙' },
      { id: '2', title: '2', time: '', tag: '甲' }
    ])

    expect(stats.map((item) => item.tag)).toEqual(['乙', '甲'])
  })
})

describe('note graph interaction helpers', () => {
  it('建立双向邻居索引并忽略自环', () => {
    const selfLoop: NoteGraphEdge = { sourceId: 'a', targetId: 'a', title: 'A' }
    const neighbors = neighborIds([...graph.edges, selfLoop])

    expect([...neighbors.get('a')!]).toEqual(['b'])
    expect([...neighbors.get('b')!].sort()).toEqual(['a', 'c'])
    expect(neighbors.get('a')?.has('a')).toBe(false)
    expect(neighbors.has('d')).toBe(false)
  })

  it('滚轮步长随 deltaY 变化并夹住极端值', () => {
    expect(wheelZoomFactor(0)).toBe(1)
    expect(wheelZoomFactor(Number.NaN)).toBe(1)
    expect(wheelZoomFactor(-120)).toBeCloseTo(1.1972, 3)
    expect(wheelZoomFactor(-1000)).toBe(wheelZoomFactor(-120))
    expect(wheelZoomFactor(120)).toBeCloseTo(1 / wheelZoomFactor(-120), 6)
    expect(wheelZoomFactor(-2)).toBeLessThan(1.01)
  })

  it('键盘映射只覆盖缩放、复位与平移', () => {
    expect(graphKeyAction('+')).toEqual({ kind: 'zoom', factor: NOTE_GRAPH_ZOOM_STEP })
    expect(graphKeyAction('=')).toEqual({ kind: 'zoom', factor: NOTE_GRAPH_ZOOM_STEP })
    expect(graphKeyAction('-')).toEqual({ kind: 'zoom', factor: 1 / NOTE_GRAPH_ZOOM_STEP })
    expect(graphKeyAction('0')).toEqual({ kind: 'reset' })
    expect(graphKeyAction('ArrowLeft')).toEqual({
      kind: 'pan',
      dx: -NOTE_GRAPH_PAN_STEP,
      dy: 0
    })
    expect(graphKeyAction('ArrowDown')).toEqual({
      kind: 'pan',
      dx: 0,
      dy: NOTE_GRAPH_PAN_STEP
    })
    expect(graphKeyAction('Enter')).toBeNull()
  })

  it('视图相等时跳过无变化更新', () => {
    expect(sameGraphViewport(NOTE_GRAPH_DEFAULT_VIEW, { ...NOTE_GRAPH_DEFAULT_VIEW })).toBe(true)
    expect(sameGraphViewport(NOTE_GRAPH_DEFAULT_VIEW, { zoom: 1, panX: 1, panY: 0 })).toBe(false)
  })
})
