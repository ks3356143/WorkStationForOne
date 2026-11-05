import { memo, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import type { ToolCall } from '../../types'
import { ArrowIcon } from '../Glyphs'
import { FileDiffView } from './FileDiffViewLazy'

interface ToolCardRowProps {
  tool: ToolCall
  index: number
}

export const ToolCardRow = memo(function ToolCardRow({ tool, index }: ToolCardRowProps) {
  const [open, setOpen] = useState(false)
  const hasDiff = Boolean(tool.diffs?.length)

  return (
    <div className="w1-toolwrap">
      <m.div
        className="w1-tool"
        initial={{ opacity: 0, transform: 'translateY(6px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        transition={{
          duration: DURATION.reveal,
          delay: Math.min(index, 6) * 0.04,
          ease: EASE_OUT
        }}
      >
        <ArrowIcon width={9} height={9} />
        <b>{tool.name}</b>
        <span>{tool.meta}</span>
        {hasDiff ? (
          <button
            type="button"
            className="w1-tooldiff"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起改动' : '查看改动'}
          </button>
        ) : null}
        <m.em
          key={tool.status}
          initial={{ opacity: 0.45, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}
        >
          {tool.status}
        </m.em>
      </m.div>
      {open && tool.diffs?.length ? <FileDiffView diffs={tool.diffs} maxHeight={300} /> : null}
    </div>
  )
})
