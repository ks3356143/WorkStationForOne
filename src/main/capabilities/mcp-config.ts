import type { ExternalMcpSaveInput, ExternalMcpServerRecord } from '../../shared/ipc'

export interface McpImportParseResult {
  inputs: ExternalMcpSaveInput[]
  errors: { name: string; message: string }[]
}

const MAX_SERVERS = 20
const MAX_NAME = 60
const MAX_ARGS = 40

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function stringMap(value: unknown): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const record = asRecord(value)
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(record)) {
    if (typeof raw === 'string' && raw.trim()) result[key] = raw.trim()
  }
  return result
}

/**
 * 支持 Claude / Codex / Cherry 常见的 `{ mcpServers: { name: {...} } }` 结构，
 * 也接受直接以 server 名称为键的对象。导入只生成停用、未信任的本地记录。
 */
export function parseMcpConfig(text: string): McpImportParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return { inputs: [], errors: [{ name: 'JSON', message: '不是合法的 JSON' }] }
  }
  const root = asRecord(parsed)
  const servers = asRecord(root.mcpServers ?? parsed)
  const entries = Object.entries(servers)
  if (entries.length === 0) {
    return { inputs: [], errors: [{ name: 'JSON', message: '没有找到 mcpServers 条目' }] }
  }
  if (entries.length > MAX_SERVERS) {
    return {
      inputs: [],
      errors: [{ name: 'JSON', message: `一次最多导入 ${MAX_SERVERS} 个 Server` }]
    }
  }
  const inputs: ExternalMcpSaveInput[] = []
  const errors: { name: string; message: string }[] = []
  for (const [rawName, raw] of entries) {
    const name = rawName.trim().slice(0, MAX_NAME)
    const record = asRecord(raw)
    if (!name) {
      errors.push({ name: rawName, message: '名称不能为空' })
      continue
    }
    const command = typeof record.command === 'string' ? record.command.trim() : ''
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!command && !url) {
      errors.push({ name, message: '必须有 command 或 url' })
      continue
    }
    if (command && url) {
      errors.push({ name, message: 'command 与 url 只能选一个' })
      continue
    }
    const args = Array.isArray(record.args)
      ? record.args.filter((arg): arg is string => typeof arg === 'string').slice(0, MAX_ARGS)
      : []
    const env = stringMap(record.env)
    const headers = stringMap(record.headers)
    const description =
      typeof record.description === 'string' ? record.description.slice(0, 240) : ''
    inputs.push({
      name,
      description,
      transport: command ? 'stdio' : 'http',
      ...(command ? { command, args } : { url }),
      ...(env ? { env } : {}),
      ...(headers ? { headers } : {})
    })
  }
  return { inputs, errors }
}

/** 导出可再次导入的配置，env / header 只保留 key，值永远不导出。 */
export function exportMcpConfig(servers: ExternalMcpServerRecord[]): string {
  const mcpServers: Record<string, unknown> = {}
  for (const [index, server] of servers.entries()) {
    let key = server.name
    if (mcpServers[key]) key = `${server.name}-${index + 1}`
    const entry: Record<string, unknown> = { disabled: !server.enabled }
    if (server.transport === 'stdio') {
      entry.command = server.command
      entry.args = [...server.args]
      if (server.envKeys.length > 0) {
        entry.env = Object.fromEntries(server.envKeys.map((name) => [name, '']))
      }
    } else {
      entry.url = server.url
      if (server.headerKeys.length > 0) {
        entry.headers = Object.fromEntries(server.headerKeys.map((name) => [name, '']))
      }
    }
    mcpServers[key] = entry
  }
  return JSON.stringify({ mcpServers }, null, 2)
}
