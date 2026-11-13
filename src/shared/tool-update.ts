// 工具更新与来源标注：让用户知道「这是本机 CLI / 外部 MCP / 插件」，以及依赖谁。

export type UpdateSource = 'plugin' | 'mcp' | 'cli'

export function sourceLabel(source?: UpdateSource): string {
  if (source === 'cli') return '本机 CLI'
  if (source === 'mcp') return 'MCP'
  if (source === 'plugin') return '插件'
  return ''
}

export interface McpSourceInfo {
  /** 展示用：本机 · Node / 本机 · uv / 本机 · git / 本机进程 / 外部 · HTTPS */
  label: string
  dependency: string
}

/** 从 transport 与 stdio command 推断 MCP 的来源与本机依赖。 */
export function describeMcpSource(transport: 'stdio' | 'http', command?: string): McpSourceInfo {
  if (transport === 'http') return { label: '外部 · HTTPS', dependency: '' }
  const first = (command ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? ''
  const base = first.replace(/\.(exe|cmd)$/i, '')
  let dependency = ''
  if (base === 'npx' || base === 'node' || base === 'npm') dependency = 'Node'
  else if (base === 'uvx' || base === 'uv') dependency = 'uv'
  else if (base === 'git') dependency = 'git'
  return {
    label: dependency ? `本机 · ${dependency}` : '本机进程',
    dependency
  }
}
