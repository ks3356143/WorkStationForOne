import { useEffect, useRef, useState } from 'react'

function motionDisabled(): boolean {
  return (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    Boolean(document.querySelector('.w1.motion-off'))
  )
}

/** 数字变化时滚动到新值；减少动效或动效关闭时直接跳变。 */
export function Ticker({ value, className }: { value: number; className?: string }) {
  const [shown, setShown] = useState(value)
  const shownRef = useRef(value)
  const frameRef = useRef(0)

  useEffect(() => {
    const from = shownRef.current
    if (from === value) return
    if (motionDisabled()) {
      shownRef.current = value
      setShown(value)
      return
    }
    const started = performance.now()
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / 420)
      const eased = 1 - (1 - progress) ** 3
      const next = Math.round(from + (value - from) * eased)
      shownRef.current = next
      setShown(next)
      if (progress < 1) frameRef.current = window.requestAnimationFrame(tick)
    }
    frameRef.current = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(frameRef.current)
  }, [value])

  return <span className={className}>{shown}</span>
}
