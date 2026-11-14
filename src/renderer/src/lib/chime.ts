export const CHIME_STORAGE_KEY = 'workstation.chime'

/** 完成提示音偏好：默认开启，'off' 关闭。 */
export function isChimeEnabled(storage?: Pick<Storage, 'getItem'>): boolean {
  if (!storage) return true
  try {
    return storage.getItem(CHIME_STORAGE_KEY) !== 'off'
  } catch {
    return true
  }
}

export function setChimeEnabled(enabled: boolean, storage?: Pick<Storage, 'setItem'>): void {
  if (!storage) return
  try {
    storage.setItem(CHIME_STORAGE_KEY, enabled ? 'on' : 'off')
  } catch {
    // 存储不可用时忽略
  }
}

/** 柔和完成音：两枚正弦音（E5→A5）软包络，本地合成不引文件。 */
export function playChime(): void {
  if (typeof window === 'undefined' || !window.AudioContext) return
  const ctx = new window.AudioContext()
  const now = ctx.currentTime
  const notes = [659.25, 880]
  notes.forEach((freq, index) => {
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.value = freq
    const t = now + index * 0.12
    gain.gain.setValueAtTime(0, t)
    gain.gain.linearRampToValueAtTime(0.12, t + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start(t)
    osc.stop(t + 0.55)
  })
  window.setTimeout(() => {
    void ctx.close()
  }, 800)
}
