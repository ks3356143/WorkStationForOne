import type { NoteGraph, NoteGraphEdge, NoteGraphNode } from '../../../shared/ipc'

export const NOTE_GRAPH_WIDTH = 1000
export const NOTE_GRAPH_HEIGHT = 620

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
