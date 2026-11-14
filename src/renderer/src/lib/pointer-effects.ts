const FINE_POINTER = '(hover: hover) and (pointer: fine)'
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const RIPPLE_SELECTOR = '.w1-send, .w1-todoadd, .w1-todosave, .w1-pb.pri'
const MAGNET_SELECTOR = '.w1-send, .w1-todoadd'

function motionDisabled(): boolean {
  return (
    window.matchMedia(REDUCED_MOTION).matches || Boolean(document.querySelector('.w1.motion-off'))
  )
}

/**
 * 全站指针效果：一个文档级监听器同时处理聚光、磁吸与水波纹。
 * 聚光只更新当前一个表面；磁吸只作用于主操作；两者都尊重减少动效 / 动效总闸。
 */
export function installPointerEffects(): () => void {
  const fine = window.matchMedia(FINE_POINTER)
  let activeSpot: HTMLElement | null = null
  let activeMagnet: HTMLElement | null = null
  let frame = 0
  let pointerX = 0
  let pointerY = 0

  const resetMagnet = () => {
    activeMagnet?.style.setProperty('--mag-x', '0px')
    activeMagnet?.style.setProperty('--mag-y', '0px')
  }

  const resetTilt = (el: HTMLElement | null) => {
    el?.style.setProperty('--tilt-x', '0')
    el?.style.setProperty('--tilt-y', '0')
  }

  const update = () => {
    frame = 0
    if (!fine.matches || motionDisabled()) {
      resetMagnet()
      resetTilt(activeSpot)
      return
    }
    if (activeSpot) {
      const rect = activeSpot.getBoundingClientRect()
      const px = pointerX - rect.left
      const py = pointerY - rect.top
      activeSpot.style.setProperty('--spot-x', `${px}px`)
      activeSpot.style.setProperty('--spot-y', `${py}px`)
      const max = 2.5
      const ry = (px / rect.width - 0.5) * 2 * max
      const rx = -(py / rect.height - 0.5) * 2 * max
      activeSpot.style.setProperty('--tilt-x', rx.toFixed(2))
      activeSpot.style.setProperty('--tilt-y', ry.toFixed(2))
    }
    if (activeMagnet) {
      const rect = activeMagnet.getBoundingClientRect()
      const dx = pointerX - (rect.left + rect.width / 2)
      const dy = pointerY - (rect.top + rect.height / 2)
      activeMagnet.style.setProperty('--mag-x', `${Math.max(-5, Math.min(5, dx * 0.18))}px`)
      activeMagnet.style.setProperty('--mag-y', `${Math.max(-5, Math.min(5, dy * 0.18))}px`)
    }
  }

  const schedule = () => {
    if (!frame) frame = window.requestAnimationFrame(update)
  }

  const onPointerOver = (event: PointerEvent) => {
    if (!fine.matches || motionDisabled() || !(event.target instanceof Element)) {
      resetTilt(activeSpot)
      activeSpot = null
      resetMagnet()
      activeMagnet = null
      return
    }
    const nextSpot = event.target.closest<HTMLElement>('[data-spotlight]')
    if (nextSpot !== activeSpot) {
      resetTilt(activeSpot)
      activeSpot = nextSpot
    }
    const magnet = event.target.closest<HTMLElement>(MAGNET_SELECTOR)
    if (magnet !== activeMagnet) {
      resetMagnet()
      activeMagnet = magnet
    }
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!fine.matches) return
    pointerX = event.clientX
    pointerY = event.clientY
    if (activeSpot || activeMagnet) schedule()
  }

  const onPointerOut = (event: PointerEvent) => {
    if (!activeMagnet) return
    const next = event.relatedTarget
    if (!(next instanceof Node) || !activeMagnet.contains(next)) {
      resetMagnet()
      activeMagnet = null
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (motionDisabled() || !(event.target instanceof Element)) return
    const target = event.target.closest<HTMLElement>(RIPPLE_SELECTOR)
    if (!target || (target instanceof HTMLButtonElement && target.disabled)) return
    const rect = target.getBoundingClientRect()
    const size = Math.hypot(rect.width, rect.height) * 2
    if (!size) return
    const ripple = document.createElement('span')
    ripple.className = 'w1-ripple'
    ripple.style.width = `${size}px`
    ripple.style.height = `${size}px`
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`
    const remove = () => ripple.remove()
    ripple.addEventListener('animationend', remove, { once: true })
    // 动效中途被 reduce/motion-off 取消时 animationend 不触发，兼听 cancel 并兜底删除。
    ripple.addEventListener('animationcancel', remove, { once: true })
    window.setTimeout(remove, 800)
    target.append(ripple)
  }

  document.addEventListener('pointerover', onPointerOver, { passive: true })
  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('pointerout', onPointerOut, { passive: true })
  document.addEventListener('pointerdown', onPointerDown, { passive: true })

  return () => {
    document.removeEventListener('pointerover', onPointerOver)
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('pointerout', onPointerOut)
    document.removeEventListener('pointerdown', onPointerDown)
    if (frame) window.cancelAnimationFrame(frame)
    for (const node of document.querySelectorAll('.w1-ripple')) node.remove()
  }
}
