import { describe, expect, it } from 'vitest'
import type { NoteGraph } from '../../../shared/ipc'
import { layoutNoteGraph, NOTE_GRAPH_HEIGHT, NOTE_GRAPH_WIDTH } from './note-graph'

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
