import { useState } from 'react'
import { m } from 'motion/react'
import type { Permission, Task } from '../../types'
import { ArrowIcon } from '../Glyphs'

interface PermissionCardProps {
  permission: Permission
  tasks: Task[]
  onResolve: (decision: 'allow' | 'deny') => void
}

export function PermissionCard({ permission, tasks, onResolve }: PermissionCardProps) {
  const [expanded, setExpanded] = useState(false)

  return (
    <m.section
      className="w1-perm"
      aria-label="权限请求"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
    >
      <span className="w1-permglow" aria-hidden="true" />
      <div className="w1-ph">
        <span className="w1-pi">!</span>
        <span>// 权限请求</span>
        <time>{permission.requestedAt} · 待确认</time>
      </div>
      <p>{permission.body}</p>
      <div className="w1-diff" role="list" aria-label="任务时间变更">
        {permission.changes.map((change) => {
          const task = tasks.find((item) => item.id === change.taskId)
          return (
            <div className="w1-dchange" role="listitem" key={change.taskId}>
              <span className="w1-dtask">{task?.title ?? change.taskId}</span>
              <span className="w1-dline del">{change.fromLabel}</span>
              <span className="w1-dline ins">{change.toLabel}</span>
            </div>
          )
        })}
      </div>
      {expanded ? (
        <div className="w1-diffdetail">
          <span>
            <ArrowIcon width={8} height={8} /> patch tasks.set_schedule
          </span>
          <span>scope: domain=tasks · mode=write</span>
          <span>target: {permission.changes.map((change) => change.taskId).join(' / ')}</span>
        </div>
      ) : null}
      <div className="w1-pacts">
        <button className="w1-pb" type="button" onClick={() => onResolve('deny')}>
          拒绝
        </button>
        <button className="w1-pb" type="button" onClick={() => setExpanded((value) => !value)}>
          {expanded ? '收起差异' : '查看差异'}
        </button>
        <button className="w1-pb pri" type="button" onClick={() => onResolve('allow')}>
          允许一次
        </button>
      </div>
    </m.section>
  )
}
