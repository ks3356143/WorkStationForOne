import type { ExternalMcpCatalogEntry } from '../../shared/ipc'

/**
 * 应用内置的 MCP 目录。只收录不需要额外凭据、可直接运行的服务；
 * 需要目录 / Token 的服务走「自定义服务器」。
 */
export const MCP_CATALOG: ExternalMcpCatalogEntry[] = [
  {
    id: 'memory',
    name: 'Memory',
    description: '基于知识图谱的长期记忆，跨会话保存实体与关系。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    packageName: '@modelcontextprotocol/server-memory',
    registry: 'npm'
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    description: '把复杂问题拆成可回退的多步推理。',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    packageName: '@modelcontextprotocol/server-sequential-thinking',
    registry: 'npm'
  },
  {
    id: 'fetch',
    name: 'Fetch',
    description: '抓取网页并转换为 Markdown，适合读取文档与文章。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    packageName: 'mcp-server-fetch',
    registry: 'pypi'
  },
  {
    id: 'time',
    name: 'Time',
    description: '时区换算与当前时间查询。',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-time'],
    packageName: 'mcp-server-time',
    registry: 'pypi'
  }
]

export function catalogEntry(id: string): ExternalMcpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id)
}
