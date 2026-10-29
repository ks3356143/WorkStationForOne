import { flushSync } from 'react-dom'

export interface ViewTransitionEnv {
  hasApi: boolean
  reducedMotion: boolean
  motionOff: boolean
}

export function shouldUseViewTransition(env: ViewTransitionEnv): boolean {
  return env.hasApi && !env.reducedMotion && !env.motionOff
}

function currentEnv(): ViewTransitionEnv {
  if (typeof document === 'undefined') {
    return { hasApi: false, reducedMotion: false, motionOff: false }
  }
  return {
    hasApi: typeof document.startViewTransition === 'function',
    reducedMotion: window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    motionOff: Boolean(document.querySelector('.w1.motion-off'))
  }
}

/**
 * 用浏览器原生的 View Transitions 包住一次状态更新：列表重排时行会平滑归位，
 * 且动画天然可中断。降级时直接同步更新，行为不变。
 */
export function withViewTransition(update: () => void): void {
  if (!shouldUseViewTransition(currentEnv())) {
    update()
    return
  }
  const transition = document.startViewTransition(() => flushSync(update))
  // 新过渡会打断旧过渡；这是预期行为，吞掉 AbortError，别让冒烟把它当控制台错误。
  transition.ready.catch(() => {})
  transition.finished.catch(() => {})
}
