import { useMemo } from 'react'
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued'
import type { AgentFileDiff } from '../../../../shared/agent-stream'
import { useWorkstation } from '../../store/useWorkstation'

const LANGUAGES: Record<string, string> = {
  bash: 'bash',
  cjs: 'javascript',
  css: 'css',
  go: 'go',
  htm: 'markup',
  html: 'markup',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'tsx',
  yaml: 'yaml',
  yml: 'yaml'
}

const DIFF_STYLES = {
  variables: {
    dark: {
      diffViewerBackground: 'transparent',
      diffViewerColor: 'var(--fs)',
      diffViewerTitleBackground: 'transparent',
      diffViewerTitleColor: 'var(--fs)',
      diffViewerTitleBorderColor: 'rgb(var(--bd-rgb) / 0.65)',
      addedBackground: 'rgb(var(--ok-rgb) / 0.12)',
      addedColor: 'var(--fs)',
      removedBackground: 'rgb(var(--dg-rgb) / 0.12)',
      removedColor: 'var(--fs)',
      changedBackground: 'rgb(var(--ac-rgb) / 0.12)',
      wordAddedBackground: 'rgb(var(--ok-rgb) / 0.28)',
      wordRemovedBackground: 'rgb(var(--dg-rgb) / 0.28)',
      addedGutterBackground: 'rgb(var(--ok-rgb) / 0.16)',
      removedGutterBackground: 'rgb(var(--dg-rgb) / 0.16)',
      gutterBackground: 'rgb(var(--field-rgb) / 0.75)',
      gutterBackgroundDark: 'rgb(var(--field-rgb) / 0.75)',
      highlightBackground: 'rgb(var(--ac-rgb) / 0.14)',
      highlightGutterBackground: 'rgb(var(--ac-rgb) / 0.18)',
      codeFoldGutterBackground: 'rgb(var(--panel-hi-rgb) / 0.5)',
      codeFoldBackground: 'rgb(var(--panel-hi-rgb) / 0.35)',
      emptyLineBackground: 'transparent',
      gutterColor: 'var(--su)',
      addedGutterColor: 'var(--ok-fg)',
      removedGutterColor: 'var(--dg-fg)',
      codeFoldContentColor: 'var(--su)'
    },
    light: {
      diffViewerBackground: 'transparent',
      diffViewerColor: 'var(--fs)',
      diffViewerTitleBackground: 'transparent',
      diffViewerTitleColor: 'var(--fs)',
      diffViewerTitleBorderColor: 'rgb(var(--bd-rgb) / 0.65)',
      addedBackground: 'rgb(var(--ok-rgb) / 0.12)',
      addedColor: 'var(--fs)',
      removedBackground: 'rgb(var(--dg-rgb) / 0.12)',
      removedColor: 'var(--fs)',
      changedBackground: 'rgb(var(--ac-rgb) / 0.12)',
      wordAddedBackground: 'rgb(var(--ok-rgb) / 0.28)',
      wordRemovedBackground: 'rgb(var(--dg-rgb) / 0.28)',
      addedGutterBackground: 'rgb(var(--ok-rgb) / 0.16)',
      removedGutterBackground: 'rgb(var(--dg-rgb) / 0.16)',
      gutterBackground: 'rgb(var(--field-rgb) / 0.75)',
      gutterBackgroundDark: 'rgb(var(--field-rgb) / 0.75)',
      highlightBackground: 'rgb(var(--ac-rgb) / 0.14)',
      highlightGutterBackground: 'rgb(var(--ac-rgb) / 0.18)',
      codeFoldGutterBackground: 'rgb(var(--panel-hi-rgb) / 0.5)',
      codeFoldBackground: 'rgb(var(--panel-hi-rgb) / 0.35)',
      emptyLineBackground: 'transparent',
      gutterColor: 'var(--su)',
      addedGutterColor: 'var(--ok-fg)',
      removedGutterColor: 'var(--dg-fg)',
      codeFoldContentColor: 'var(--su)'
    }
  },
  diffContainer: {
    minWidth: '0',
    border: 'none',
    borderRadius: 0,
    background: 'transparent',
    boxShadow: 'none'
  },
  contentText: {
    fontFamily: 'var(--mono)',
    fontSize: '12.5px',
    lineHeight: 1.55
  },
  gutter: { fontFamily: 'var(--mono)' },
  lineNumber: { fontFamily: 'var(--mono)', fontSize: '11px' },
  summary: { fontFamily: 'var(--mono)' },
  codeFold: { fontFamily: 'var(--mono)' }
}

function languageOf(path: string): string | undefined {
  const extension = path.split('.').pop()?.toLowerCase()
  return extension ? LANGUAGES[extension] : undefined
}

function kindLabel(diff: AgentFileDiff): string {
  if (diff.kind === 'add') return '新增'
  if (diff.kind === 'delete') return '删除'
  return '修改'
}

interface FileDiffViewProps {
  diffs: AgentFileDiff[]
  maxHeight?: number
}

export function FileDiffView({ diffs, maxHeight = 340 }: FileDiffViewProps) {
  const theme = useWorkstation((state) => state.theme)
  const rendered = useMemo(
    () =>
      diffs.map((diff, index) => ({
        key: `${diff.path}-${index}`,
        diff,
        language: languageOf(diff.path),
        wordDiff: diff.oldText.length + diff.newText.length <= 12_000
      })),
    [diffs]
  )

  if (rendered.length === 0) return null

  return (
    <div className="w1-diffview">
      {rendered.map(({ key, diff, language, wordDiff }) => (
        <section className="w1-diffview-file" key={key}>
          <header className="w1-diffview-head">
            <span className="w1-diffview-kind" data-kind={diff.kind ?? 'update'}>
              {kindLabel(diff)}
            </span>
            <b title={diff.path}>{diff.path}</b>
            {diff.partial ? <span className="w1-diffview-badge">片段</span> : null}
            {diff.truncated ? <span className="w1-diffview-badge warn">已截断</span> : null}
          </header>
          <div className="w1-diffview-body" style={{ maxHeight }}>
            <ReactDiffViewer
              oldValue={diff.oldText}
              newValue={diff.newText}
              splitView={false}
              useDarkTheme={theme === 'dark'}
              hideSummary
              disableWorker
              disableWordDiff={!wordDiff}
              compareMethod={DiffMethod.WORDS}
              extraLinesSurroundingDiff={3}
              highlightLanguage={language}
              styles={DIFF_STYLES}
            />
          </div>
        </section>
      ))}
    </div>
  )
}
