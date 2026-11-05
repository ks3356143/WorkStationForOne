import { lazy, Suspense } from 'react'

/** 笔记预览用：把 [[双链]] 解析到真实笔记并支持点击打开。 */
export interface NoteLinkContext {
  open: (title: string) => void
  state: (title: string) => { ok: boolean; reason?: string }
}

const MarkdownRenderer = lazy(() => import('./AgentMarkdownRenderer'))

export function AgentMarkdown({ text, noteLinks }: { text: string; noteLinks?: NoteLinkContext }) {
  return (
    <Suspense
      fallback={
        <div className="w1-md w1-md-loading" aria-busy="true">
          {text}
        </div>
      }
    >
      <MarkdownRenderer text={text} noteLinks={noteLinks} />
    </Suspense>
  )
}
