export type BreathPhase = 'inhale' | 'hold' | 'exhale'

export interface BreathState {
  phase: BreathPhase
  label: string
  scale: number
}

const INHALE = 4000
const HOLD = 2000
const EXHALE = 4000
const CYCLE = INHALE + HOLD + EXHALE
const MIN_SCALE = 0.6

/** 吸-屏-呼节奏（4s-2s-4s）：返回当前相位、提示与圆球缩放（0.6..1）。 */
export function breathState(elapsedMs: number): BreathState {
  const t = ((elapsedMs % CYCLE) + CYCLE) % CYCLE
  if (t < INHALE) {
    return { phase: 'inhale', label: '吸气', scale: MIN_SCALE + (1 - MIN_SCALE) * (t / INHALE) }
  }
  if (t < INHALE + HOLD) {
    return { phase: 'hold', label: '屏息', scale: 1 }
  }
  const progress = (t - INHALE - HOLD) / EXHALE
  return { phase: 'exhale', label: '呼气', scale: 1 - (1 - MIN_SCALE) * progress }
}
