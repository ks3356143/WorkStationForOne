import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from '../../../shared/ipc'

export const NOTE_GRAPH_WIDTH = 1000
export const NOTE_GRAPH_HEIGHT = 620
export const NOTE_GRAPH_MIN_ZOOM = 0.45
export const NOTE_GRAPH_MAX_ZOOM = 2.4

const NOTE_GRAPH_PAN_MARGIN = 120

export interface NoteGraphViewport {
  zoom: number
  panX: number
  panY: number
}

export const NOTE_GRAPH_DEFAULT_VIEW: NoteGraphViewport = Object.freeze({
  zoom: 1,
  panX: 0,
  panY: 0
})

export interface ScreenRect {
  left: number
  top: number
  width: number
  height: number
}

export interface GraphNodeLayout {
  node: NoteGraphNode
  x: number
  y: number
  radius: number
}

export interface GraphEdgeLayout {
  edge: NoteGraphEdge
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface NoteGraphLayout {
  nodes: GraphNodeLayout[]
  edges: GraphEdgeLayout[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export function clampGraphZoom(value: number): number {
  return clamp(Number.isFinite(value) ? value : 1, NOTE_GRAPH_MIN_ZOOM, NOTE_GRAPH_MAX_ZOOM)
}

function clampPan(view: NoteGraphViewport): NoteGraphViewport {
  return {
    zoom: view.zoom,
    panX: clamp(
      view.panX,
      NOTE_GRAPH_PAN_MARGIN - NOTE_GRAPH_WIDTH * view.zoom,
      NOTE_GRAPH_WIDTH - NOTE_GRAPH_PAN_MARGIN
    ),
    panY: clamp(
      view.panY,
      NOTE_GRAPH_PAN_MARGIN - NOTE_GRAPH_HEIGHT * view.zoom,
      NOTE_GRAPH_HEIGHT - NOTE_GRAPH_PAN_MARGIN
    )
  }
}

/** 屏幕坐标 → 未变换的 viewBox 坐标，兼容 preserveAspectRatio 留下的留白。 */
export function screenToGraphPoint(
  clientX: number,
  clientY: number,
  rect: ScreenRect
): { x: number; y: number } {
  const scale = Math.min(rect.width / NOTE_GRAPH_WIDTH, rect.height / NOTE_GRAPH_HEIGHT) || 1
  const offsetX = (rect.width - NOTE_GRAPH_WIDTH * scale) / 2
  const offsetY = (rect.height - NOTE_GRAPH_HEIGHT * scale) / 2
  return {
    x: (clientX - rect.left - offsetX) / scale,
    y: (clientY - rect.top - offsetY) / scale
  }
}

/** 保持指针下的图坐标不动，缩放后反推新的平移量。 */
export function zoomGraphView(
  view: NoteGraphViewport,
  pointer: { x: number; y: number },
  zoom: number
): NoteGraphViewport {
  const next = clampGraphZoom(zoom)
  const graphX = (pointer.x - view.panX) / view.zoom
  const graphY = (pointer.y - view.panY) / view.zoom
  return clampPan({
    zoom: next,
    panX: pointer.x - graphX * next,
    panY: pointer.y - graphY * next
  })
}

export function panGraphView(view: NoteGraphViewport, dx: number, dy: number): NoteGraphViewport {
  return clampPan({ zoom: view.zoom, panX: view.panX + dx, panY: view.panY + dy })
}

export function withoutIsolatedNodes(graph: NoteGraph): NoteGraph {
  const linked = new Set<string>()
  for (const edge of graph.edges) {
    linked.add(edge.sourceId)
    linked.add(edge.targetId)
  }
  return {
    nodes: graph.nodes.filter((node) => linked.has(node.id)),
    edges: graph.edges.filter((edge) => linked.has(edge.sourceId) && linked.has(edge.targetId))
  }
}

export function isolatedNodeCount(graph: NoteGraph): number {
  return graph.nodes.length - withoutIsolatedNodes(graph).nodes.length
}

export interface GraphTagStat {
  tag: string
  tone: number
  count: number
}

export function tagTone(tag?: string): number {
  const value = tag?.trim()
  if (!value) return 0
  let hash = 0
  for (const char of value) {
    hash = (hash * 31 + (char.codePointAt(0) ?? 0)) | 0
  }
  return (((hash % 6) + 6) % 6) + 1
}

export function tagStats(nodes: readonly NoteGraphNode[], limit = 50): GraphTagStat[] {
  const counts = new Map<string, number>()
  for (const node of nodes) {
    const tag = node.tag?.trim()
    if (!tag) continue
    counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, tone: tagTone(tag), count }))
    .sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0))
    .slice(0, Math.max(0, limit))
}

/**
 * 轻量确定性力导向布局：圆环初始化 + 斥力 / 边弹簧 / 向心，重复跑固定轮次。
 * 不引入随机数，同一份笔记每次打开位置一致，也方便测试。
 */
export function layoutNoteGraph(
  graph: NoteGraph,
  width = NOTE_GRAPH_WIDTH,
  height = NOTE_GRAPH_HEIGHT
): NoteGraphLayout {
  const count = graph.nodes.length
  if (count === 0) return { nodes: [], edges: [] }

  const degree = new Map<string, number>()
  for (const edge of graph.edges) {
    degree.set(edge.sourceId, (degree.get(edge.sourceId) ?? 0) + 1)
    degree.set(edge.targetId, (degree.get(edge.targetId) ?? 0) + 1)
  }
  const radii = graph.nodes.map((node) => 14 + Math.min(8, (degree.get(node.id) ?? 0) * 1.8))
  const padding = 42
  const cx = width / 2
  const cy = height / 2
  const spread = Math.min(width, height) * 0.3

  const positions = graph.nodes.map((_, index) => {
    if (count === 1) return { x: cx, y: cy }
    const angle = (index / count) * Math.PI * 2 - Math.PI / 2
    const ring = spread * (0.66 + (index % 3) * 0.17)
    return { x: cx + Math.cos(angle) * ring, y: cy + Math.sin(angle) * ring }
  })
  const velocities = graph.nodes.map(() => ({ x: 0, y: 0 }))
  const indexOf = new Map(graph.nodes.map((node, index) => [node.id, index]))
  const links = graph.edges
    .map((edge) => {
      const source = indexOf.get(edge.sourceId)
      const target = indexOf.get(edge.targetId)
      return source === undefined || target === undefined || source === target
        ? null
        : { source, target }
    })
    .filter((link): link is { source: number; target: number } => Boolean(link))

  for (let iteration = 0; iteration < 150; iteration += 1) {
    const forces = graph.nodes.map(() => ({ x: 0, y: 0 }))

    for (let i = 0; i < count; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        let dx = positions[i].x - positions[j].x
        let dy = positions[i].y - positions[j].y
        let distance = Math.hypot(dx, dy)
        if (distance < 1) {
          dx = 1
          dy = 0
          distance = 1
        }
        const repel = 820 / Math.max(160, distance * distance)
        forces[i].x += (dx / distance) * repel
        forces[i].y += (dy / distance) * repel
        forces[j].x -= (dx / distance) * repel
        forces[j].y -= (dy / distance) * repel
      }
    }

    for (const link of links) {
      const a = positions[link.source]
      const b = positions[link.target]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.max(1, Math.hypot(dx, dy))
      const spring = (distance - 118) * 0.006
      forces[link.source].x += (dx / distance) * spring
      forces[link.source].y += (dy / distance) * spring
      forces[link.target].x -= (dx / distance) * spring
      forces[link.target].y -= (dy / distance) * spring
    }

    for (let i = 0; i < count; i += 1) {
      forces[i].x += (cx - positions[i].x) * 0.0018
      forces[i].y += (cy - positions[i].y) * 0.0018
      velocities[i].x = (velocities[i].x + forces[i].x) * 0.82
      velocities[i].y = (velocities[i].y + forces[i].y) * 0.82
      positions[i].x = clamp(positions[i].x + velocities[i].x, padding, width - padding)
      positions[i].y = clamp(positions[i].y + velocities[i].y, padding, height - padding)
    }
  }

  const nodes = graph.nodes.map((node, index) => ({
    node,
    x: positions[index].x,
    y: positions[index].y,
    radius: radii[index]
  }))
  const nodeById = new Map(nodes.map((item) => [item.node.id, item]))
  const edges = graph.edges
    .map((edge) => {
      const source = nodeById.get(edge.sourceId)
      const target = nodeById.get(edge.targetId)
      if (!source || !target) return null
      return {
        edge,
        x1: source.x,
        y1: source.y,
        x2: target.x,
        y2: target.y
      }
    })
    .filter((edge): edge is GraphEdgeLayout => Boolean(edge))

  return { nodes, edges }
}
