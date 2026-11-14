import { useEffect, useRef, useState } from 'react'

/** 缓出三次方缓动，输入夹在 0..1。 */
export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t))
  return 1 - (1 - x) ** 3
}

/** 从 from 到 to 按缓动插值并取整。 */
export function countUpValue(from: number, to: number, t: number): number {
  return Math.round(from + (to - from) * easeOutCubic(t))
}

/** 数字滚动：目标变化时从当前值缓动到目标；尊重系统减少动效。 */
export function useCountUp(target: number, duration = 600): number {
  const [value, setValue] = useState(0)
  const fromRef = useRef(0)
  const rafRef = useRef(0)

  useEffect(() => {
    const from = fromRef.current
    const reduce =
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (from === target || reduce || duration <= 0 || typeof window === 'undefined') {
      fromRef.current = target
      setValue(target)
      return
    }
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const v = countUpValue(from, target, t)
      fromRef.current = v
      setValue(v)
      if (t < 1) rafRef.current = requestAnimationFrame(tick)
      else fromRef.current = target
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [target, duration])

  return value
}
