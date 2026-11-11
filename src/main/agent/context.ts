import { MAX_CONTEXT_FILES } from '../../shared/agent-context'
import { assembleBudgeted, type ContextBlock } from '../../shared/context-budget'
import { guardNote, scanUntrusted } from '../../shared/prompt-guard'
import { readWorkspaceText } from './workspace'

export const MAX_CONTEXT_BYTES = 256 * 1024
/** 记忆 / 摘要前缀的字符预算；附件与用户消息不受它挤占。 */
export const MEMORY_BUDGET = 32_000

export interface ContextFile {
  path: string
  text: string
}

const CLOSING_FENCE = '</workspace_file>'

function escapePath(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function formatContextPrompt(prompt: string, files: ContextFile[]): string {
  if (files.length === 0) return prompt
  const blocks = files.map(
    (file) =>
      `<workspace_file path="${escapePath(file.path)}">\n${file.text.replaceAll(CLOSING_FENCE, '<\\/workspace_file>')}\n${CLOSING_FENCE}`
  )
  const risky = files.some((file) => scanUntrusted(file.text).suspicious)
  const note = guardNote(risky)
  const head = `${note ? `${note}\n` : ''}以下是用户随消息附带的工作区文件内容：`
  return `${head}\n\n${blocks.join('\n\n')}\n\n用户消息：\n${prompt}`
}

export function loadContextFiles(workspace: string, paths: string[]): ContextFile[] {
  const unique = Array.from(new Set(paths))
  if (unique.length > MAX_CONTEXT_FILES) {
    throw new Error(`一次最多附加 ${MAX_CONTEXT_FILES} 个文件`)
  }
  const files = unique.map((path) => {
    try {
      return readWorkspaceText(workspace, path)
    } catch (error) {
      const detail = error instanceof Error ? error.message : '读取失败'
      throw new Error(`无法读取附件 ${path}：${detail}`)
    }
  })
  const total = files.reduce((sum, file) => sum + Buffer.byteLength(file.text, 'utf8'), 0)
  if (total > MAX_CONTEXT_BYTES) throw new Error('附件总大小超过 256 KB，请减少文件')
  return files
}

export interface ContextExtras {
  /** 会话滚动摘要（抽取式压缩产物），优先级最高 */
  digest?: string
  /** 检索命中的记忆块（笔记等），带来源标签 */
  memory?: Array<{ label: string; text: string }>
}

/** 记忆 / 摘要装配成系统提示前缀；超预算先丢低优先级块。空输入返回空串。 */
export function buildMemoryPrefix(extras: ContextExtras): string {
  const blocks: ContextBlock[] = []
  if (extras.digest?.trim()) {
    blocks.push({ label: 'session_digest', text: extras.digest, priority: 0 })
  }
  for (const hit of extras.memory ?? []) {
    if (hit.text.trim()) blocks.push({ label: hit.label, text: hit.text, priority: 1 })
  }
  if (blocks.length === 0) return ''
  const risky = (extras.memory ?? []).some((hit) => scanUntrusted(hit.text).suspicious)
  const body = assembleBudgeted(blocks, MEMORY_BUDGET).text
  const note = guardNote(risky)
  return [note, body].filter(Boolean).join('\n')
}

export function buildContextPrompt(
  workspace: string,
  prompt: string,
  paths: string[] = []
): string {
  return formatContextPrompt(prompt, loadContextFiles(workspace, paths))
}
