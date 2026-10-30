import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { m } from 'motion/react'
import type { WorkspaceEntry } from '../../../../shared/ipc'
import { DURATION, EASE_OUT } from '../../lib/motion'
import { FolderIcon } from '../Glyphs'

interface WorkspaceSheetProps {
  sessionId: string
  workspace: string
  artifacts: { path: string; name: string }[]
  onClose: () => void
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback
}

export function WorkspaceSheet({ sessionId, workspace, artifacts, onClose }: WorkspaceSheetProps) {
  const api = typeof window === 'undefined' ? undefined : window.ws?.agent
  const boxRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const [entries, setEntries] = useState<WorkspaceEntry[]>([])
  const [treeError, setTreeError] = useState<string | null>(null)
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState('')
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [previewBusy, setPreviewBusy] = useState(false)

  useEffect(() => {
    const root = boxRef.current
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    root?.focus()
    return () => {
      const active = document.activeElement
      if (!active || active === document.body || root?.contains(active)) restoreRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    if (!api) {
      setTreeError('当前环境没有 preload 桥')
      return
    }
    let alive = true
    void api
      .workspaceTree(sessionId)
      .then((list) => {
        if (alive) setEntries(list)
      })
      .catch((error: unknown) => {
        if (alive) setTreeError(errorText(error, '工作区读取失败'))
      })
    return () => {
      alive = false
    }
  }, [api, sessionId])

  const openFile = (path: string) => {
    if (!api) return
    setSelected(path)
    setPreview('')
    setPreviewError(null)
    setPreviewBusy(true)
    void api
      .readWorkspaceFile(sessionId, path)
      .then((file) => setPreview(file.text))
      .catch((error: unknown) => setPreviewError(errorText(error, '文件读取失败')))
      .finally(() => setPreviewBusy(false))
  }

  const openFolder = () => {
    if (!api) return
    void api.openWorkspace(sessionId).catch((error: unknown) => {
      setTreeError(errorText(error, '打开工作区失败'))
    })
  }

  const content = (
    <m.div
      className="w1-modalbackdrop"
      role="presentation"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DURATION.modalBackdrop }}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <m.div
        ref={boxRef}
        className="w1-wssheet"
        role="dialog"
        aria-modal="true"
        aria-label="Agent 工作区"
        tabIndex={-1}
        initial={{ opacity: 0, transform: 'translateY(10px) scale(0.99)' }}
        animate={{ opacity: 1, transform: 'translateY(0px) scale(1)' }}
        exit={{ opacity: 0, transform: 'translateY(8px)' }}
        transition={{ duration: DURATION.modal, ease: EASE_OUT }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            onClose()
          }
        }}
      >
        <header className="w1-wshead">
          <div>
            <span className="w1-eyebrow">// WORKSPACE</span>
            <b>工作区文件</b>
            <p title={workspace}>{workspace}</p>
          </div>
          <div className="w1-wsactions">
            <button type="button" className="w1-capmini" onClick={openFolder}>
              <FolderIcon width={10} height={10} />
              打开目录
            </button>
            <button type="button" className="w1-fleetclose" onClick={onClose}>
              <kbd>Esc</kbd> 关闭
            </button>
          </div>
        </header>

        {artifacts.length > 0 ? (
          <div className="w1-wsartifacts">
            <span>本回合产物</span>
            {artifacts.map((artifact) => (
              <button
                key={artifact.path}
                type="button"
                className={selected === artifact.path ? 'on' : ''}
                onClick={() => openFile(artifact.path)}
              >
                {artifact.name}
              </button>
            ))}
          </div>
        ) : null}

        <div className="w1-wsbody">
          <div className="w1-wstree" role="tree" aria-label="工作区文件">
            {treeError ? <p className="w1-capnote">{treeError}</p> : null}
            {entries.length === 0 && !treeError ? (
              <p className="w1-capnote">工作区是空的。</p>
            ) : null}
            {entries.map((entry) => {
              const depth = entry.path.split('/').length - 1
              if (entry.type === 'dir') {
                return (
                  <div
                    key={entry.path}
                    className="w1-wsdir"
                    style={{ paddingLeft: `${6 + depth * 12}px` }}
                  >
                    {entry.path.split('/').at(-1)}
                  </div>
                )
              }
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`w1-wsfile${selected === entry.path ? ' on' : ''}`}
                  style={{ paddingLeft: `${6 + depth * 12}px` }}
                  title={entry.path}
                  onClick={() => openFile(entry.path)}
                >
                  {entry.path.split('/').at(-1)}
                </button>
              )
            })}
          </div>
          <div className="w1-wspreview">
            {previewBusy ? (
              <p className="w1-capnote">读取中…</p>
            ) : previewError ? (
              <p className="w1-capnote">{previewError}</p>
            ) : selected ? (
              <>
                <div className="w1-wspath">{selected}</div>
                <pre>{preview}</pre>
              </>
            ) : (
              <p className="w1-capnote">选择一个文件预览；只读，不超过 128 KB。</p>
            )}
          </div>
        </div>

        <footer className="w1-wsfoot">
          <span>{entries.filter((entry) => entry.type === 'file').length} 个文件 · 只读</span>
          <span>跳过 .git / node_modules / dist</span>
        </footer>
      </m.div>
    </m.div>
  )
  if (typeof document === 'undefined') return null
  return createPortal(content, document.querySelector('.w1') ?? document.body)
}
