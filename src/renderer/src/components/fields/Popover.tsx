import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'

interface PopoverProps {
  anchor: HTMLElement | null
  open: boolean
  onClose: () => void
  label: string
  width: number
  children: ReactNode
}

const GAP = 8
const EDGE = 12

interface Position {
  left: number
  top: number
}

/**
 * 挂在 `.w1` 根节点上的弹层：锚点下方优先，空间不足翻到上方，两侧夹在视口内。
 * 视图层带 transform，直接 fixed 会被当作相对祖先定位，所以走 portal。
 */
export function Popover({ anchor, open, onClose, label, width, children }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<Position | null>(null)
  const [host] = useState<HTMLElement | null>(() =>
    typeof document === 'undefined' ? null : document.querySelector<HTMLElement>('.w1')
  )

  const place = useCallback(() => {
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const height = panelRef.current?.offsetHeight ?? 0
    const below = rect.bottom + GAP
    const above = rect.top - height - GAP
    const flip = height > 0 && below + height > window.innerHeight - EDGE && above > EDGE
    const maxLeft = Math.max(EDGE, window.innerWidth - width - EDGE)
    const left = Math.min(Math.max(EDGE, rect.left), maxLeft)
    setPosition({ left, top: flip ? above : below })
  }, [anchor, width])

  useLayoutEffect(() => {
    if (open) place()
  }, [open, place])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (panelRef.current?.contains(target) || anchor?.contains(target)) return
      onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        // Esc 属于最上层弹层：截断到本层，不要让外层表单同时收起
        event.stopImmediatePropagation()
        onClose()
        anchor?.focus()
      }
    }
    const onReflow = () => place()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onReflow)
    window.addEventListener('scroll', onReflow, true)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onReflow)
      window.removeEventListener('scroll', onReflow, true)
    }
  }, [anchor, onClose, open, place])

  const panel = (
    <AnimatePresence>
      {open ? (
        <m.div
          ref={panelRef}
          className="w1-pop"
          role="dialog"
          aria-label={label}
          initial={{ opacity: 0, transform: 'translateY(-6px) scale(0.985)' }}
          animate={{ opacity: 1, transform: 'translateY(0) scale(1)' }}
          exit={{ opacity: 0, transform: 'translateY(-4px) scale(0.99)' }}
          transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
          style={{
            width,
            left: position?.left ?? 0,
            top: position?.top ?? 0,
            visibility: position ? 'visible' : 'hidden'
          }}
        >
          {children}
        </m.div>
      ) : null}
    </AnimatePresence>
  )

  return host ? createPortal(panel, host) : panel
}
