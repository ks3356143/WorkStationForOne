import { useState } from 'react'
import { m } from 'motion/react'
import type { McpDomain, McpPermissionDecision, McpPermissionRequest } from '../../../../shared/ipc'
import { DURATION, EASE_OUT } from '../../lib/motion'

interface McpApprovalCardProps {
  request: McpPermissionRequest
  onResolve: (decision: McpPermissionDecision) => void
}

const DOMAIN_LABELS: Record<McpDomain, string> = {
  task: '任务',
  habit: '习惯',
  learning: '学习',
  note: '笔记'
}

export function McpApprovalCard({ request, onResolve }: McpApprovalCardProps) {
  const [busy, setBusy] = useState(false)

  const resolve = (decision: McpPermissionDecision) => {
    if (busy) return
    setBusy(true)
    onResolve(decision)
  }

  return (
    <m.section
      className="w1-perm w1-toolperm w1-mcpapprove"
      aria-label="MCP 数据写入审批"
      initial={{ opacity: 0, transform: 'translateY(8px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      exit={{ opacity: 0, transform: 'translateY(8px)', transition: { duration: DURATION.fast } }}
      transition={{ duration: DURATION.permissionIn, ease: EASE_OUT }}
    >
      <span className="w1-permglow" aria-hidden="true" />
      <div className="w1-ph">
        <span className="w1-pi">!</span>
        <span>// 数据写入</span>
        <time>
          {DOMAIN_LABELS[request.domain]} · {request.tool}
        </time>
      </div>
      <p>{request.detail || `Agent 请求写入${DOMAIN_LABELS[request.domain]}数据。`}</p>
      <div className="w1-toolinput">
        <div className="w1-toolrow">
          <span>域</span>
          <b>{DOMAIN_LABELS[request.domain]}</b>
        </div>
        <div className="w1-toolrow">
          <span>工具</span>
          <b>{request.tool}</b>
        </div>
        <pre>{request.preview || '{}'}</pre>
      </div>
      <p className="w1-toolhint">
        60 秒无操作按拒绝处理。此工作区允许只对这一种工具生效，对该工作区里同 Agent
        的会话都生效，可在设置里撤销。
      </p>
      <div className="w1-pacts">
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('deny')}>
          拒绝
        </button>
        <button className="w1-pb" type="button" disabled={busy} onClick={() => resolve('session')}>
          本会话允许
        </button>
        <button
          className="w1-pb"
          type="button"
          disabled={busy}
          onClick={() => resolve('workspace')}
        >
          此工作区允许
        </button>
        <button className="w1-pb pri" type="button" disabled={busy} onClick={() => resolve('once')}>
          允许一次
        </button>
      </div>
    </m.section>
  )
}
