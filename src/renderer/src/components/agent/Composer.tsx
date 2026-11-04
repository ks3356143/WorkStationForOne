import { useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { MAX_CONTEXT_FILES } from '../../../../shared/agent-context'
import type { AgentImageRef, WorkspaceEntry } from '../../../../shared/ipc'
import { AGENT_META } from '../../lib/agent'
import {
  filterWorkspaceFiles,
  matchMention,
  removeMention,
  type MentionMatch
} from '../../lib/mention'
import type { AgentId } from '../../types'
import { Popover } from '../fields/Popover'
import { SendIcon } from '../Glyphs'
import { AgentImageThumb } from './AgentImageThumb'

interface ComposerProps {
  sessionId: string
  agent: AgentId
  typing: boolean
  writeApproval: boolean
  planMode?: boolean
  onTogglePlanMode?: () => void
  /** 有激活 Provider 时显示名称与模型；继承 CLI 时省略 */
  providerLabel?: string
  /** 线程仍在读库时禁用发送，避免和按需加载抢写 */
  threadReady?: boolean
  workspace?: string
  runId?: string | null
  queued?: boolean
  stopping?: boolean
  onSend: (text: string, contextFiles?: string[], images?: AgentImageRef[]) => void
  onStop: () => void
}

function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  return `${Math.round(bytes / 1024)} KB`
}

export function Composer({
  sessionId,
  agent,
  typing,
  writeApproval,
  planMode = false,
  onTogglePlanMode,
  providerLabel,
  threadReady = true,
  workspace,
  runId,
  queued,
  stopping,
  onSend,
  onStop
}: ComposerProps) {
  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<string[]>([])
  const [files, setFiles] = useState<WorkspaceEntry[] | null>(null)
  const [loadingFiles, setLoadingFiles] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [mention, setMention] = useState<MentionMatch | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [attachError, setAttachError] = useState<string | null>(null)
  const [images, setImages] = useState<AgentImageRef[]>([])
  const [imageBusy, setImageBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const composeRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const meta = AGENT_META[agent]
  const missingWorkspace = !workspace
  const blocked = missingWorkspace || !threadReady
  const bridge = typeof window === 'undefined' ? undefined : window.ws?.agent

  const filtered = useMemo(
    () => (mention && files ? filterWorkspaceFiles(files, mention.query) : []),
    [files, mention]
  )

  const loadFiles = () => {
    if (files !== null || loadingFiles) return
    if (!bridge) {
      setFileError('无 preload 桥，无法读取工作区文件')
      return
    }
    setLoadingFiles(true)
    void bridge
      .workspaceTree(sessionId)
      .then((entries) => {
        setFiles(entries.filter((entry) => entry.type === 'file'))
        setFileError(null)
      })
      .catch((error: unknown) => {
        setFileError(error instanceof Error ? error.message : '读取工作区文件失败')
      })
      .finally(() => setLoadingFiles(false))
  }

  const attach = (path: string) => {
    if (!attachments.includes(path)) {
      if (attachments.length >= MAX_CONTEXT_FILES) {
        setAttachError(`一次最多附加 ${MAX_CONTEXT_FILES} 个文件`)
        return
      }
      setAttachments([...attachments, path])
    }
    setAttachError(null)
    if (mention) setDraft(removeMention(draft, mention.start, mention.query))
    setMention(null)
    inputRef.current?.focus()
  }

  const detach = (path: string) => {
    setAttachments(attachments.filter((item) => item !== path))
    setAttachError(null)
  }

  const submit = () => {
    if (!draft.trim() || typing || blocked) return
    onSend(
      draft,
      attachments.length > 0 ? attachments : undefined,
      images.length ? images : undefined
    )
    setDraft('')
    setAttachments([])
    setImages([])
    setMention(null)
    setAttachError(null)
  }

  const addImageFiles = (files: File[]) => {
    const list = files.filter((file) => file.type.startsWith('image/')).slice(0, 6 - images.length)
    if (list.length === 0) return
    setImageBusy(true)
    setAttachError(null)
    Promise.all(
      list.map(
        (file) =>
          new Promise<AgentImageRef>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => {
              const raw = typeof reader.result === 'string' ? reader.result : ''
              const data = raw.slice(raw.indexOf(',') + 1)
              bridge?.saveImage({ mime: file.type, data, name: file.name }).then(resolve, reject)
            }
            reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
            reader.readAsDataURL(file)
          })
      )
    )
      .then((saved) => setImages((current) => [...current, ...saved].slice(0, 6)))
      .catch((error: unknown) =>
        setAttachError(error instanceof Error ? error.message : '图片保存失败')
      )
      .finally(() => setImageBusy(false))
  }

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null)
    if (files.length > 0) {
      event.preventDefault()
      addImageFiles(files)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const composing = event.nativeEvent.isComposing || event.keyCode === 229
    if (mention && !blocked) {
      if (event.key === 'ArrowDown' && filtered.length > 0) {
        event.preventDefault()
        setHighlight((current) => (current + 1) % filtered.length)
        return
      }
      if (event.key === 'ArrowUp' && filtered.length > 0) {
        event.preventDefault()
        setHighlight((current) => (current - 1 + filtered.length) % filtered.length)
        return
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && !composing && filtered.length > 0) {
        event.preventDefault()
        attach(filtered[Math.min(highlight, filtered.length - 1)].path)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !composing) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="w1-compose" ref={composeRef}>
      <div className="w1-perms">
        <span>权限</span>
        <b className="ro">工具 只读</b>
        {planMode ? (
          <b className="plan">计划模式 · 不执行写入</b>
        ) : (
          <b className="ro">{writeApproval ? '写入 需审批' : '沙箱 read-only'}</b>
        )}
        <button
          className={`w1-planmode${planMode ? ' on' : ''}`}
          type="button"
          aria-pressed={planMode}
          disabled={typing}
          title="计划模式只做只读调查并给出方案；切回执行模式后才会写入"
          onClick={onTogglePlanMode}
        >
          {planMode ? '切到执行' : '计划模式'}
        </button>
      </div>
      {attachments.length > 0 || images.length > 0 || attachError ? (
        <div className="w1-ctxchips">
          {attachments.map((path) => (
            <span className="w1-ctxchip" key={path}>
              <span className="w1-ctxchip-path">@{path}</span>
              <button
                className="w1-ctxchip-x"
                type="button"
                aria-label={`移除附件 ${path}`}
                onClick={() => detach(path)}
              >
                ×
              </button>
            </span>
          ))}
          {images.map((image) => (
            <span className="w1-imgchip" key={image.id} title={image.name}>
              <AgentImageThumb image={image} className="w1-imgthumb" />
              <span>{image.name}</span>
              <button
                className="w1-ctxchip-x"
                type="button"
                aria-label={`移除图片 ${image.name}`}
                onClick={() => setImages((list) => list.filter((item) => item.id !== image.id))}
              >
                ×
              </button>
            </span>
          ))}
          {attachError ? <span className="w1-ctxerr">{attachError}</span> : null}
        </div>
      ) : null}
      <div className="w1-input">
        <span className="w1-iprompt">&gt;</span>
        <input
          ref={inputRef}
          id="composer-input"
          className="w1-ifield"
          value={draft}
          disabled={blocked}
          placeholder={
            missingWorkspace
              ? '先选择一个工作区…'
              : !threadReady
                ? '正在读取会话…'
                : `让 ${meta.shortName} 处理今天的任务…`
          }
          aria-label="给 agent 的消息"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={Boolean(mention && !blocked)}
          aria-controls="composer-context-list"
          onPaste={onPaste}
          onChange={(event) => {
            const value = event.target.value
            setDraft(value)
            const caret = event.target.selectionStart ?? value.length
            const hit = matchMention(value, caret)
            setMention(hit)
            setHighlight(0)
            if (hit) loadFiles()
          }}
          onKeyDown={onKeyDown}
        />
      </div>
      <div className="w1-icfoot">
        <span
          className="w1-model"
          title={providerLabel ? `当前 Provider：${providerLabel}` : undefined}
        >
          {missingWorkspace
            ? '工作区未选择'
            : !threadReady
              ? '正在读取会话…'
              : typing
                ? '等待回复 · 完成后可继续输入'
                : (providerLabel ?? meta.cli)}
        </span>
        <div className="w1-icright">
          <input
            ref={fileInputRef}
            className="w1-imgfile"
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              addImageFiles([...(event.target.files ?? [])])
              event.target.value = ''
            }}
          />
          <button
            className="w1-imgpick"
            type="button"
            disabled={blocked || typing || imageBusy || images.length >= 6}
            title="添加图片（也可以直接粘贴）"
            aria-label="添加图片"
            onClick={() => fileInputRef.current?.click()}
          >
            {imageBusy ? '读取中' : '图片'}
          </button>
          <span className="w1-ickey">
            <kbd>@</kbd>引用文件 · <kbd>Enter</kbd>发送
          </span>
          {typing ? (
            <button
              className="w1-stop"
              type="button"
              aria-label="停止当前回复"
              title={queued ? '停止当前回合；排队的提示词会继续发送' : '停止当前回合'}
              disabled={!runId || stopping}
              onClick={onStop}
            >
              {stopping ? '停止中' : '停止'}
            </button>
          ) : null}
          <button
            className="w1-send"
            type="button"
            aria-label="发送"
            disabled={!draft.trim() || typing || blocked}
            onClick={submit}
          >
            <SendIcon width={12} height={12} />
          </button>
        </div>
      </div>
      <Popover
        anchor={composeRef.current}
        focusTarget={inputRef.current}
        open={Boolean(mention && !blocked)}
        onClose={() => setMention(null)}
        label="工作区文件"
        width={420}
      >
        <div className="w1-ctxpick">
          <div className="w1-ctxpick-head">
            <span>// WORKSPACE FILES</span>
            <span>{loadingFiles ? '读取中…' : (fileError ?? `${filtered.length} 个匹配`)}</span>
          </div>
          {fileError ? <div className="w1-ctxpick-empty">{fileError}</div> : null}
          {!fileError && !loadingFiles && filtered.length === 0 ? (
            <div className="w1-ctxpick-empty">没有匹配的文件</div>
          ) : null}
          <div
            className="w1-ctxpick-list"
            id="composer-context-list"
            role="listbox"
            aria-label="工作区文件"
          >
            {filtered.map((entry, index) => (
              <button
                key={entry.path}
                type="button"
                role="option"
                aria-selected={index === highlight}
                className={`w1-ctxpick-row${index === highlight ? ' active' : ''}`}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => attach(entry.path)}
              >
                <span className="w1-ctxpick-path">{entry.path}</span>
                <span className="w1-ctxpick-size">{sizeLabel(entry.size)}</span>
              </button>
            ))}
          </div>
          <div className="w1-ctxpick-foot">↑↓ 选择 · Enter 附加 · Esc 关闭</div>
        </div>
      </Popover>
    </div>
  )
}
