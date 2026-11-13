import { memo, useEffect, useRef, useState } from 'react'
import { m } from 'motion/react'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { AGENT_META } from '../../lib/agent'
import { fallbackCopy } from '../../lib/clipboard'
import type { AgentCheckpointView, AgentRollbackResult } from '../../../../shared/ipc'
import type { AgentId, ChatMessage } from '../../types'
import { AgentMarkdown } from './AgentMarkdown'
import { AgentImageThumb } from './AgentImageThumb'
import { ToolCardRow } from './ToolCardRow'
import { TurnChanges } from './TurnChanges'
import { splitErrorText } from '../../lib/errors'

function ErrorDetail({ raw }: { raw: string }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )

  const copy = () => {
    const done = () => {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(raw).then(done, () => fallbackCopy(raw, done))
      return
    }
    fallbackCopy(raw, done)
  }

  return (
    <div className="w1-errdetail">
      <div className="w1-errdetailactions">
        <button
          type="button"
          className="w1-errdetailbtn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起详情' : '查看详情'}
        </button>
        <button type="button" className="w1-errdetailbtn" onClick={copy}>
          {copied ? '已复制' : '复制详情'}
        </button>
      </div>
      {open ? <pre>{raw}</pre> : null}
    </div>
  )
}

function FallbackRetry({
  agent,
  onRetry,
  notify
}: {
  agent: AgentId
  onRetry: () => void
  notify: (text: string) => void
}) {
  const [fb, setFb] = useState<{ id: string; name: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    const api = typeof window === 'undefined' ? undefined : window.ws?.provider
    if (!api) return
    void api
      .fallbackFor(agent)
      .then((result) => {
        if (alive) setFb(result)
      })
      .catch(() => {
        if (alive) setFb(null)
      })
    return () => {
      alive = false
    }
  }, [agent])
  if (!fb) return null
  const switchAndRetry = () => {
    if (busy) return
    const api = window.ws?.provider
    if (!api) return
    setBusy(true)
    void api
      .setActive(agent, fb.id)
      .then(() => {
        notify(`已切换到备用 Provider：${fb.name}`)
        onRetry()
      })
      .catch((error: unknown) => notify(error instanceof Error ? error.message : '切换失败'))
      .finally(() => setBusy(false))
  }
  return (
    <button type="button" className="w1-retry" disabled={busy} onClick={switchAndRetry}>
      {busy ? '切换中…' : `换备用重试（${fb.name}）`}
    </button>
  )
}

interface MessageRowProps {
  message: ChatMessage
  agent: AgentId
  animate?: boolean
  onRetry?: () => void
  onFork?: () => void
  onSaveNote?: () => void
  onSaveTask?: () => void
  /** 本轮有文件改动时提供：一键把「跑验证并修复」预填到输入栏 */
  onVerify?: (paths: string[]) => void
  /** 成功且有工具步骤的回复可提炼为自定义专家 */
  onSaveExpert?: () => void
  turnCheckpoint?: AgentCheckpointView
  turnRollbackEnabled?: boolean
  onRollbackTurn?: (checkpoint: AgentCheckpointView) => Promise<AgentRollbackResult>
  running?: boolean
  notify?: (text: string) => void
  forkTitle?: string
  forking?: boolean
}

export const MessageRow = memo(function MessageRow({
  message,
  agent,
  animate = false,
  onRetry,
  onFork,
  onSaveNote,
  onSaveTask,
  onVerify,
  onSaveExpert,
  turnCheckpoint,
  turnRollbackEnabled = false,
  onRollbackTurn,
  running = false,
  notify = () => {},
  forkTitle = '复制到此消息为止的对话；模型上下文从新会话开始',
  forking = false
}: MessageRowProps) {
  const meta = AGENT_META[agent]
  const changedPaths = Array.from(
    new Set((message.tools ?? []).flatMap((tool) => tool.diffs?.map((diff) => diff.path) ?? []))
  )
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
    },
    []
  )

  const copy = () => {
    const done = () => {
      setCopied(true)
      if (copyTimer.current) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(message.text).then(done, () => fallbackCopy(message.text, done))
      return
    }
    fallbackCopy(message.text, done)
  }

  if (message.role === 'user') {
    return (
      <div className="w1-umsg" data-message-id={message.id}>
        <span className="w1-ulabel">我 · {message.time}</span>
        {message.text}
        {message.images?.length ? (
          <div className="w1-umsgimages">
            {message.images.map((image) => (
              <AgentImageThumb key={image.id} image={image} className="w1-umsgimage" />
            ))}
          </div>
        ) : null}
        {message.contextFiles?.length ? (
          <div className="w1-uctx">
            {message.contextFiles.map((path) => (
              <span className="w1-uctxchip" key={path}>
                @{path}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    )
  }

  const content = (
    <>
      <span className="w1-av">{meta.badge}</span>
      <div className="w1-abody">
        <div className="w1-ameta">
          <b>{meta.name}</b>
          <span>{message.time}</span>
          <span>·</span>
          <span>{message.model ?? meta.model}</span>
          <button type="button" className="w1-copy" aria-label="复制这条回复" onClick={copy}>
            {copied ? '已复制' : '复制'}
          </button>
          {onSaveNote ? (
            <button
              type="button"
              className="w1-copy w1-capture"
              aria-label="把这条回复存为笔记"
              onClick={onSaveNote}
            >
              存为笔记
            </button>
          ) : null}
          {onSaveTask ? (
            <button
              type="button"
              className="w1-copy w1-capture"
              aria-label="用这条回复建一个任务"
              onClick={onSaveTask}
            >
              建任务
            </button>
          ) : null}
          {onSaveExpert ? (
            <button
              type="button"
              className="w1-copy w1-capture"
              aria-label="把这次成功回合提炼为专家"
              onClick={onSaveExpert}
            >
              存为专家
            </button>
          ) : null}
          {onVerify && changedPaths.length > 0 ? (
            <button
              type="button"
              className="w1-copy w1-capture"
              aria-label="预填跑验证并修复"
              onClick={() => onVerify(changedPaths)}
            >
              验证并修复
            </button>
          ) : null}
          {onFork ? (
            <button
              type="button"
              className="w1-copy w1-fork"
              aria-label="从这条回复分叉会话"
              title={forkTitle}
              disabled={forking}
              onClick={onFork}
            >
              {forking ? '分叉中…' : '分叉'}
            </button>
          ) : null}
        </div>
        {message.error ? (
          (() => {
            const errorText = splitErrorText(message.text)
            return (
              <>
                <div className="w1-atext error">{errorText.message}</div>
                {errorText.detail ? <ErrorDetail raw={errorText.detail} /> : null}
              </>
            )
          })()
        ) : (
          <div className="w1-atext">
            <AgentMarkdown text={message.text} />
          </div>
        )}
        {message.error && onRetry ? (
          <button type="button" className="w1-retry" onClick={onRetry}>
            重试
          </button>
        ) : null}
        {message.error && onRetry ? (
          <FallbackRetry agent={agent} onRetry={onRetry} notify={notify} />
        ) : null}
        <TurnChanges
          tools={message.tools}
          checkpoint={turnCheckpoint}
          rollbackEnabled={turnRollbackEnabled}
          running={running}
          notify={notify}
          onRollback={onRollbackTurn}
        />
        {message.tools?.map((tool, index) => (
          <ToolCardRow tool={tool} index={index} key={tool.id ?? tool.name} />
        ))}
      </div>
    </>
  )

  if (!animate) {
    return (
      <div className="w1-amsg" data-message-id={message.id}>
        {content}
      </div>
    )
  }

  return (
    <m.div
      className="w1-amsg"
      data-message-id={message.id}
      initial={{ opacity: 0, transform: 'translateY(4px)' }}
      animate={{ opacity: 1, transform: 'translateY(0px)' }}
      transition={{ duration: DURATION.reveal, ease: EASE_OUT }}
    >
      {content}
    </m.div>
  )
})
