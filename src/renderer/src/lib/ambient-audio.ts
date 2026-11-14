export type AmbientKind = 'white' | 'rain'

/** 填充噪声缓冲：white 为均匀白噪音；rain 为积分棕噪音（更柔和）。可注入 random 便于测试。 */
export function fillNoiseBuffer(
  data: Float32Array,
  kind: AmbientKind,
  random: () => number = Math.random
): void {
  if (kind === 'white') {
    for (let i = 0; i < data.length; i++) data[i] = random() * 2 - 1
    return
  }
  let last = 0
  for (let i = 0; i < data.length; i++) {
    const white = random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = Math.max(-1, Math.min(1, last * 3.5))
  }
}

export interface AmbientHandle {
  stop: () => void
  setVolume: (volume: number) => void
}

/** 本地合成环境音（不引外部音频文件）：循环噪声缓冲 + 雨声低通 + 音量。无 AudioContext 时返回 null。 */
export function startAmbientAudio(kind: AmbientKind, volume = 0.4): AmbientHandle | null {
  if (typeof window === 'undefined' || !window.AudioContext) return null
  const ctx = new window.AudioContext()
  const buffer = ctx.createBuffer(1, Math.floor(2 * ctx.sampleRate), ctx.sampleRate)
  fillNoiseBuffer(buffer.getChannelData(0), kind)
  const source = ctx.createBufferSource()
  source.buffer = buffer
  source.loop = true
  const gain = ctx.createGain()
  gain.gain.value = Math.max(0, Math.min(1, volume))
  let node: AudioNode = source
  if (kind === 'rain') {
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 1200
    source.connect(filter)
    node = filter
  }
  node.connect(gain)
  gain.connect(ctx.destination)
  source.start()
  void ctx.resume()
  return {
    stop: () => {
      try {
        source.stop()
      } catch {
        // 已停止
      }
      void ctx.close()
    },
    setVolume: (v) => {
      gain.gain.value = Math.max(0, Math.min(1, v))
    }
  }
}
