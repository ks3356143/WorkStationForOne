import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { m } from 'motion/react'
import confetti from 'canvas-confetti'
import { isChimeEnabled, playChime } from '../lib/chime'
import { browserStorage } from '../lib/theme'
import { startAmbientAudio, type AmbientKind } from '../lib/ambient-audio'
import { DURATION, EASE_OUT } from '../lib/motion'
import {
  nextPhase,
  phaseLabel,
  phaseMinutes,
  readPomodoroConfig,
  type PomodoroConfig,
  type PomodoroState
} from '../lib/pomodoro'
import type { FocusSession } from '../types'

// 默认导出的 confetti 在首次调用时以 useWorker:true 创建 cannon，会生成 blob worker 被应用 CSP（script-src 'self'）拦截。
// 这里显式建一个主线程 cannon，彩带照常播放且不触发 worker。
const fireConfetti = confetti.create(undefined, { useWorker: false, resize: true })

interface FocusOverlayProps {
  focus: FocusSession
  onClose: () => void
}

function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

/** 自动化快进缝：设置 __WS_FOCUS_FAST__ 后每段按该秒数倒计时；落库仍记真实分钟数。 */
function durationSeconds(minutes: number): number {
  const fast = window.__WS_FOCUS_FAST__
  if (typeof fast === 'number' && fast > 0) return fast
  return minutes * 60
}

export function FocusOverlay({ focus, onClose }: FocusOverlayProps) {
  const isPomodoro = focus.mode === 'pomodoro'
  const config = useMemo<PomodoroConfig>(() => readPomodoroConfig(browserStorage()), [])
  const [pomo, setPomo] = useState<PomodoroState>({ phase: 'focus', completedFocus: 0 })
  const phaseRealMinutes = isPomodoro ? phaseMinutes(pomo.phase, config) : focus.minutes
  const total = durationSeconds(phaseRealMinutes)

  const [remaining, setRemaining] = useState(total)
  const [paused, setPaused] = useState(false)
  const [sound, setSound] = useState<'off' | AmbientKind>('off')
  const boxRef = useRef<HTMLDivElement>(null)
  const pauseRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  // 记截止时间而不是逐 tick 递减：窗口被节流或系统睡眠后，下一次 tick 会立刻校正。
  const endRef = useRef(Date.now() + total * 1000)
  const phaseStartRef = useRef(Date.now())
  const done = !isPomodoro && remaining <= 0

  const celebrate = useCallback(() => {
    if (isChimeEnabled(browserStorage())) playChime()
    if (document.querySelector('.w1.motion-off')) return
    void fireConfetti({
      particleCount: 90,
      spread: 70,
      origin: { y: 0.6 },
      disableForReducedMotion: true
    })
  }, [])

  const logPhase = useCallback(
    (kind: 'focus' | 'break', minutes: number) => {
      void window.ws?.focus.log({
        taskId: focus.taskId ?? null,
        label: focus.label,
        kind,
        minutes,
        startedAt: phaseStartRef.current,
        completedAt: Date.now()
      })
    },
    [focus.taskId, focus.label]
  )

  const advancePhase = (completed: PomodoroState) => {
    const minutes = phaseMinutes(completed.phase, config)
    logPhase(completed.phase === 'focus' ? 'focus' : 'break', minutes)
    if (completed.phase === 'focus') celebrate()
    const next = nextPhase(completed, config)
    const seconds = durationSeconds(phaseMinutes(next.phase, config))
    phaseStartRef.current = Date.now()
    endRef.current = Date.now() + seconds * 1000
    setPomo(next)
    setRemaining(seconds)
  }

  // 用 ref 持有最新阶段与推进函数：tick 闭包读 ref，避免把每次渲染都变的 advancePhase 放进依赖导致计时器反复重置。
  const pomoRef = useRef(pomo)
  pomoRef.current = pomo
  const advanceRef = useRef(advancePhase)
  advanceRef.current = advancePhase

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    pauseRef.current?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (paused || done) return
    const tick = () => {
      const left = Math.max(0, Math.ceil((endRef.current - Date.now()) / 1000))
      setRemaining(left)
      if (left <= 0 && isPomodoro) advanceRef.current(pomoRef.current)
    }
    tick()
    const timer = window.setInterval(tick, 250)
    return () => window.clearInterval(timer)
    // 阶段推进经 pomoRef/advanceRef/endRef 读取最新值，无需把每次渲染都变的函数放进依赖。
  }, [paused, done, isPomodoro])

  // 环境音本地合成；切换音色或退出专注时释放 AudioContext。
  useEffect(() => {
    if (sound === 'off') return
    const handle = startAmbientAudio(sound, 0.35)
    return () => handle?.stop()
  }, [sound])

  // 自由专注完成里程碑：柔和提示音 + 一簇彩带（仅一次）+ 落库；番茄钟在每段专注完成时庆祝。
  const celebratedRef = useRef(false)
  useEffect(() => {
    if (!done || celebratedRef.current) return
    celebratedRef.current = true
    logPhase('focus', focus.minutes)
    celebrate()
  }, [done, celebrate, logPhase, focus.minutes])

  const cycleSound = () =>
    setSound((current) => (current === 'off' ? 'white' : current === 'white' ? 'rain' : 'off'))

  const togglePause = () => {
    if (paused) {
      endRef.current = Date.now() + remaining * 1000
      setPaused(false)
    } else {
      setPaused(true)
    }
  }

  const progress = total === 0 ? 0 : remaining / total
  const status = paused ? 'PAUSED' : isPomodoro ? phaseLabel(pomo.phase) : done ? 'DONE' : 'FOCUS'

  return (
    <m.div
      className="w1-focus"
      role="dialog"
      aria-modal="true"
      aria-label="专注模式"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.focusBackdrop }}
    >
      <div className="w1-focus-aurora" aria-hidden="true" />
      <m.div
        ref={boxRef}
        className={`w1-focus-box${done ? ' done' : ''}`}
        tabIndex={-1}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement
          if (!target.closest('button, a, input, textarea, select, [tabindex]'))
            boxRef.current?.focus()
        }}
        initial={{ opacity: 0, transform: 'translateY(14px)' }}
        animate={{ opacity: 1, transform: 'translateY(0px)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.focus, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onClose()
            return
          }
          if (event.key !== 'Tab') return
          const root = boxRef.current
          if (!root) return
          const nodes = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled])'))
          if (nodes.length === 0) {
            event.preventDefault()
            return
          }
          const first = nodes[0]
          const last = nodes[nodes.length - 1]
          const active = document.activeElement
          if (!root.contains(active)) {
            event.preventDefault()
            const next = event.shiftKey ? last : first
            next.focus()
          } else if (event.shiftKey && active === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && active === last) {
            event.preventDefault()
            first.focus()
          }
        }}
      >
        <span className="w1-focus-glow" aria-hidden="true" />
        <span className="w1-focus-foil" aria-hidden="true" />
        <div className="w1-focus-head">
          <span>// {isPomodoro ? '番茄钟' : '专注模式'}</span>
          <span>{status}</span>
        </div>
        <div className="w1-focus-label">{focus.label}</div>
        <div className={`w1-focus-time${done ? ' done' : ''}`}>{formatCountdown(remaining)}</div>
        <div className="w1-focus-track">
          <i style={{ transform: `scaleX(${progress})` }} />
        </div>
        <div className="w1-focus-meta">
          <span>单任务 · 本地 · 不发送上下文</span>
          <span>
            {isPomodoro
              ? `已完成 ${pomo.completedFocus} 轮 · ${phaseLabel(pomo.phase)} ${phaseRealMinutes} 分钟`
              : done
                ? '本轮完成 · 做得很棒～'
                : `${focus.minutes} 分钟`}
          </span>
        </div>
        <div className="w1-focus-acts">
          <button
            className="w1-pb"
            type="button"
            aria-pressed={sound !== 'off'}
            onClick={cycleSound}
            title="本地合成环境音，不联网"
          >
            {sound === 'off' ? '环境音 关' : sound === 'white' ? '白噪音' : '雨声'}
          </button>
          <button
            ref={pauseRef}
            className="w1-pb"
            type="button"
            onClick={togglePause}
            disabled={done}
          >
            {paused ? '继续' : '暂停'}
          </button>
          <button className="w1-pb pri" type="button" onClick={onClose}>
            {done ? '收下这一轮' : '结束专注'}
          </button>
        </div>
      </m.div>
      <div className="w1-focus-foot">// ESC 退出 · 计时仅在本机运行</div>
    </m.div>
  )
}
