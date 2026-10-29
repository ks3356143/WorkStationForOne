import { useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import type { ToolPermission } from '../../types'

interface ToolApprovalCardProps {
  request: ToolPermission
  onResolve: (allow: boolean) => void
}

export function ToolApprovalCard({ request, onResolve }: ToolApprovalCardProps) {
  const [busy, setBusy] = useState(false)

  const resolve = (allow: boolean) => {
    if (busy) return
    setBusy(true)
    onResolve(allow)
  }

  return (
    <m.section
      className="w1-perm w1-toolperm"
      aria-label="工具审批请求"
      initial={{ opacity: 0, transform: 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(8px)', transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.permissionIn, ease: EASE_OUT }}
    >
      <span className="w1-permglow" aria-hidden="true" />
      <div className="w1-ph">
        <span className="w1-pi">!</span>
        <span>// 工具审批</span>
        <time>{request.toolName} · 待确认</time>
      </div>
      <p>{request.description ?? `Claude 请求使用 ${request.toolName}。`}</p>
      <div className="w1-toolinput">
        <div className="w1-toolrow">
          <span>工具</span>
          <b>{request.toolName}</b>
        </div>
        {request.detail ? (
          <div className="w1-toolrow">
            <span>目标</span>
            <b>{request.detail}</b>
          </div>
        ) : null}
        <pre>{request.inputPreview || '{}'}</pre>
      </div>
      <p className="w1-toolhint">允许只作用于这一次调用；写操作不会自动放行。</p>
      <div className="w1-pacts">
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve(false)}>
          拒绝
        </button>
        <button className="w1-pb pri" type="button" disabled={busy} onClick={() => resolve(true)}>
          允许一次
        </button>
      </div>
    </m.section>
  )
}
