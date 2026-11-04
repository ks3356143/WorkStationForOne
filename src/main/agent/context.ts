import { MAX_CONTEXT_FILES } from '../../shared/agent-context'
import { readWorkspaceText } from './workspace'

export const MAX_CONTEXT_BYTES = 256 * 1024

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
  return `以下是用户随消息附带的工作区文件内容：\n\n${blocks.join('\n\n')}\n\n用户消息：\n${prompt}`
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

export function buildContextPrompt(
  workspace: string,
  prompt: string,
  paths: string[] = []
): string {
  return formatContextPrompt(prompt, loadContextFiles(workspace, paths))
}
