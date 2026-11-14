import { useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { breathState } from '../lib/breathing'
import { DURATION } from '../lib/motion'

/** 呼吸引导：吸-屏-呼节奏球，放松肩颈；减少动效时显示静态节奏说明。 */
export function BreathingGuide({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState(() => breathState(0))
  const boxRef = useRef<HTMLDivElement>(null)
  const reduce =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (reduce) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      setState(breathState(now - start))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [reduce])

  useEffect(() => {
    boxRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <m.div
      className="w1-breath"
      role="dialog"
      aria-modal="true"
      aria-label="呼吸引导"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.focusBackdrop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w1-breath-box" ref={boxRef} tabIndex={-1}>
        <div className="w1-breath-head">
          <span>// 呼吸引导</span>
          <button type="button" className="w1-fleetclose" onClick={onClose}>
            <kbd>Esc</kbd> 关闭
          </button>
        </div>
        <div className="w1-breath-stage">
          <div
            className={`w1-breath-orb ${state.phase}`}
            style={{ transform: `scale(${state.scale})` }}
            aria-hidden="true"
          />
          <div className="w1-breath-label" aria-live="polite">
            {reduce ? '跟随节奏放松' : state.label}
          </div>
        </div>
        <div className="w1-breath-foot">吸气 4s · 屏息 2s · 呼气 4s · 放松肩颈</div>
      </div>
    </m.div>
  )
}
