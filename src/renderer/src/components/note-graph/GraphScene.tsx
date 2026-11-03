import { memo } from 'react'
import type { NoteGraphLayout } from '../../lib/note-graph'
import { tagTone } from '../../lib/note-graph'

interface GraphSceneProps {
  layout: NoteGraphLayout
  activeId: string | null
  neighbors: ReadonlyMap<string, ReadonlySet<string>>
  activeNeighbors?: ReadonlySet<string>
  onOpen: (id: string) => void
  onActivate: (id: string) => void
  onDeactivate: () => void
}

function GraphSceneView({
  layout,
  activeId,
  neighbors,
  activeNeighbors,
  onOpen,
  onActivate,
  onDeactivate
}: GraphSceneProps) {
  return (
    <>
      <g className="w1-gedges">
        {layout.edges.map((item) => {
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
        {layout.nodes.map((item, index) => {
          const tone = tagTone(item.node.tag)
          return (
            <g
              key={item.node.id}
              className={[
                'w1-gnode',
                tone > 0 ? `w1-gtone-${tone}` : '',
                activeId === item.node.id ? 'active' : '',
                activeNeighbors?.has(item.node.id) ? 'connected' : '',
                item.node.pinned ? 'pinned' : '',
                neighbors.has(item.node.id) ? '' : 'isolated'
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
              onClick={() => onOpen(item.node.id)}
              onMouseEnter={() => onActivate(item.node.id)}
              onMouseLeave={onDeactivate}
              onFocus={() => onActivate(item.node.id)}
              onBlur={onDeactivate}
              onKeyDown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                onOpen(item.node.id)
              }}
            >
              <circle r={item.radius} />
              <text y={item.radius + 16}>
                {item.node.title.length > 14 ? `${item.node.title.slice(0, 14)}…` : item.node.title}
              </text>
            </g>
          )
        })}
      </g>
    </>
  )
}

export const GraphScene = memo(GraphSceneView)
