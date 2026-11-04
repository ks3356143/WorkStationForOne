/** 没有 Clipboard API 时的退路；只用于用户主动点击的复制动作。 */
export function fallbackCopy(text: string, done: () => void): void {
  const area = document.createElement('textarea')
  area.value = text
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    document.execCommand('copy')
  } finally {
    area.remove()
  }
  done()
}
