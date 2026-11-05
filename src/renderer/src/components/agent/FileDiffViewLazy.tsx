import { lazy, Suspense } from 'react'
import type { AgentFileDiff } from '../../../../shared/agent-stream'

const DiffView = lazy(() =>
  import('./FileDiffView').then((module) => ({ default: module.FileDiffView }))
)

interface FileDiffViewProps {
  diffs: AgentFileDiff[]
  maxHeight?: number
}

export function FileDiffView({ diffs, maxHeight = 340 }: FileDiffViewProps) {
  return (
    <Suspense fallback={<div className="w1-diffview-loading">正在加载改动预览…</div>}>
      <DiffView diffs={diffs} maxHeight={maxHeight} />
    </Suspense>
  )
}
