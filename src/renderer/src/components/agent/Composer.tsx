import { useState } from 'react'
import { AGENT_META } from '../../lib/agent'
import type { AgentId } from '../../types'
import { SendIcon } from '../Glyphs'

interface ComposerProps {
  agent: AgentId
  typing: boolean
  onSend: (text: string) => void
}

export function Composer({ agent, typing, onSend }: ComposerProps) {
  const [draft, setDraft] = useState('')
  const meta = AGENT_META[agent]

  const submit = () => {
    if (!draft.trim() || typing) return
    onSend(draft)
    setDraft('')
  }

  return (
    <div className="w1-compose">
      <div className="w1-perms">
        <span>权限</span>
        <b className="ro">工具 只读</b>
        <b className="ro">{agent === 'claude' ? '写入 需审批' : '沙箱 read-only'}</b>
      </div>
      <div className="w1-input">
        <span className="w1-iprompt">&gt;</span>
        <input
          id="composer-input"
          className="w1-ifield"
          value={draft}
          placeholder={`让 ${meta.shortName} 处理今天的任务…`}
          aria-label="给 agent 的消息"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault()
              submit()
            }
          }}
        />
      </div>
      <div className="w1-icfoot">
        <span className="w1-model">{typing ? '等待回复 · 完成后可继续输入' : meta.cli}</span>
        <div className="w1-icright">
          <span className="w1-ickey">
            <kbd>Enter</kbd>发送
          </span>
          <button
            className="w1-send"
            type="button"
            aria-label="发送"
            disabled={!draft.trim() || typing}
            onClick={submit}
          >
            <SendIcon width={12} height={12} />
          </button>
        </div>
      </div>
    </div>
  )
}
