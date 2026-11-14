import { useEffect, useRef } from 'react'
import { seedParticles, type DustParticle } from '../../lib/dust'
import { useWorkstation } from '../../store/useWorkstation'

/** 全局浮尘：1/4 分辨率渲染 + CSS 放大（省性能），慢漂低透明度；动效关闭/减少动效时不渲染。 */
export function DustField() {
  const motionOn = useWorkstation((state) => state.motionOn)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !motionOn) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    let particles: DustParticle[] = []
    let raf = 0
    let running = false
    let w = 0
    let h = 0
    const resize = () => {
      w = Math.max(1, Math.floor(canvas.clientWidth * 0.25))
      h = Math.max(1, Math.floor(canvas.clientHeight * 0.25))
      canvas.width = w
      canvas.height = h
      particles = seedParticles(90, w, h)
    }
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (const p of particles) {
        p.x += p.vx
        p.y += p.vy
        if (p.x < 0) p.x += w
        if (p.x > w) p.x -= w
        if (p.y < 0) p.y += h
        if (p.y > h) p.y -= h
        ctx.beginPath()
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(180, 200, 255, ${p.a})`
        ctx.fill()
      }
      raf = requestAnimationFrame(draw)
    }
    const start = () => {
      if (running) return
      running = true
      raf = requestAnimationFrame(draw)
    }
    const stop = () => {
      running = false
      cancelAnimationFrame(raf)
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') start()
      else stop()
    }
    resize()
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('resize', resize)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', resize)
    }
  }, [motionOn])

  if (!motionOn) return null
  return <canvas ref={canvasRef} className="w1-dust" />
}
