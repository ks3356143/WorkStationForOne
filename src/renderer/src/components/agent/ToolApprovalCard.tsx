import { useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import type { ToolPermission } from '../../types'

type ToolDecision = 'once' | 'session' | 'workspace' | 'deny'

interface ToolApprovalCardProps {
  request: ToolPermission
  onResolve: (decision: ToolDecision) => void
}

export function ToolApprovalCard({ request, onResolve }: ToolApprovalCardProps) {
  const [busy, setBusy] = useState(false)

  const resolve = (decision: ToolDecision) => {
    if (busy) return
    setBusy(true)
    onResolve(decision)
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
      <p>{request.description ?? `Agent 请求使用 ${request.toolName}。`}</p>
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
      <p className="w1-toolhint">
        {request.workspaceScope
          ? '本会话允许只在应用运行期间有效；此工作区允许会记住该工具，对该工作区里同 Agent 的会话都生效，可在设置里撤销。'
          : request.toolName === 'Permissions'
            ? 'Bash、写入类工具与额外权限只能本会话允许或单次允许，不会写入持久规则。本会话允许会让本会话之后的额外权限请求自动通过。'
            : 'Bash、写入类工具与额外权限只能本会话允许或单次允许，不会写入持久规则。'}
      </p>
      <div className="w1-pacts">
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('deny')}>
          拒绝
        </button>
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('session')}>
          本会话允许
        </button>
        {request.workspaceScope ? (
          <button
            className="w1-pb"
            type="button"
            disabled={busy}
            onClick={() => resolve('workspace')}
          >
            此工作区允许
          </button>
        ) : null}
        <button className="w1-pb pri" type="button" disabled={busy} onClick={() => resolve('once')}>
          允许一次
        </button>
      </div>
    </m.section>
  )
}
