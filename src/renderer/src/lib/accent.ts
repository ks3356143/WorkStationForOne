export const ACCENT_STORAGE_KEY = 'workstation.accent'

export type Rgb = [number, number, number]

/** 解析 #rrggbb 为 RGB；非法返回 null。 */
export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const n = Number.parseInt(match[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function rgbToHsl([r, g, b]: Rgb): [number, number, number] {
  const rr = r / 255
  const gg = g / 255
  const bb = b / 255
  const max = Math.max(rr, gg, bb)
  const min = Math.min(rr, gg, bb)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h: number
  if (max === rr) h = (gg - bb) / d + (gg < bb ? 6 : 0)
  else if (max === gg) h = (bb - rr) / d + 2
  else h = (rr - gg) / d + 4
  return [h * 60, s, l]
}

function hue2rgb(p: number, q: number, t: number): number {
  let tt = t
  if (tt < 0) tt += 1
  if (tt > 1) tt -= 1
  if (tt < 1 / 6) return p + (q - p) * 6 * tt
  if (tt < 1 / 2) return q
  if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
  return p
}

function hslToRgb([h, s, l]: [number, number, number]): Rgb {
  const hh = (((h % 360) + 360) % 360) / 360
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  return [
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255)
  ]
}

/** 色相旋转 deg 度（保持饱和度/亮度）。 */
export function rotateHue(rgb: Rgb, deg: number): Rgb {
  const [h, s, l] = rgbToHsl(rgb)
  return hslToRgb([h + deg, s, l])
}

const triplet = (rgb: Rgb): string => `${rgb[0]} ${rgb[1]} ${rgb[2]}`

/** 由主强调色派生主/副令牌（副色色相 +120°）；非法 hex 返回 null。 */
export function accentTokens(hex: string): { ac: string; ac2: string } | null {
  const rgb = hexToRgb(hex)
  if (!rgb) return null
  return { ac: triplet(rgb), ac2: triplet(rotateHue(rgb, 120)) }
}

/** 把自定义强调色写入根节点令牌；null 清除（回退主题默认）。 */
export function applyAccent(hex: string | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const tokens = hex ? accentTokens(hex) : null
  if (tokens) {
    root.style.setProperty('--ac-rgb', tokens.ac)
    root.style.setProperty('--ac2-rgb', tokens.ac2)
  } else {
    root.style.removeProperty('--ac-rgb')
    root.style.removeProperty('--ac2-rgb')
  }
}

export function readStoredAccent(storage?: Pick<Storage, 'getItem'>): string | null {
  if (!storage) return null
  try {
    const value = storage.getItem(ACCENT_STORAGE_KEY)
    return value && hexToRgb(value) ? value : null
  } catch {
    return null
  }
}

export function persistAccent(
  hex: string | null,
  storage?: Pick<Storage, 'setItem' | 'removeItem'>
): void {
  if (storage) {
    try {
      if (hex) storage.setItem(ACCENT_STORAGE_KEY, hex)
      else storage.removeItem(ACCENT_STORAGE_KEY)
    } catch {
      // 存储不可用时仍应用，只是不跨启动保留。
    }
  }
  applyAccent(hex)
}
