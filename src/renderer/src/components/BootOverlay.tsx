import { m } from 'motion/react'
import { DURATION } from '../lib/motion'

interface BootOverlayProps {
  onSkip: () => void
}

export function BootOverlay({ onSkip }: BootOverlayProps) {
  return (
    <m.div
      className="w1-boot"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.boot }}
      onClick={onSkip}
      role="presentation"
    >
      <div className="w1-boot-grid" />
      <div className="w1-boot-core">
        <div className="w1-boot-mark">W/1</div>
        <div className="w1-boot-name">WorkStationForOne</div>
        <div className="w1-boot-sys">// SYS BOOT · v0.1.0 · 本地模式</div>
        <div className="w1-boot-log">
          <span>
            <b>OK</b> 载入本地会话与看板
          </span>
          <span>
            <b>OK</b> 恢复权限队列
          </span>
          <span>
            <b>OK</b> 渲染 HUD · 60 FPS
          </span>
        </div>
        <div className="w1-boot-progress">
          <i />
        </div>
        <button className="w1-boot-skip" type="button" onClick={onSkip}>
          跳过 <kbd>任何键</kbd>
        </button>
      </div>
      <div className="w1-boot-foot">// LOCAL FIRST · NO CLOUD KEYS · WINDOWS 11</div>
    </m.div>
  )
}
