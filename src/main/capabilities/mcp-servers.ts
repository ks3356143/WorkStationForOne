import { randomUUID } from 'node:crypto'
import { safeStorage } from 'electron'
import type {
  ExternalMcpCatalogEntry,
  ExternalMcpSaveInput,
  ExternalMcpServerRecord,
  ExternalMcpUpdateInfo,
  McpImportResult,
  McpToolApproval
} from '../../shared/ipc'
import type { CapabilityRepository } from '../db/capabilities'
import { catalogEntry, MCP_CATALOG } from './catalog'
import { buildCodexMcpRuntime, type CodexMcpRuntime } from './codex-mcp'
import { probeMcpServer } from './mcp-client'
import { exportMcpConfig, parseMcpConfig } from './mcp-config'

const MAX_NAME = 60
const MAX_DESCRIPTION = 240
const MAX_COMMAND = 500
const MAX_ARG = 500
const MAX_ARGS = 40
const MAX_SECRET = 4000
const MAX_SECRETS = 40
const UPDATE_TIMEOUT = 8_000

export interface McpServerRuntime {
  name: string
  type: 'stdio' | 'http'
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
}

function trimmed(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function keyName(value: string, kind: 'env' | 'header'): string {
  const pattern = kind === 'env' ? /^[A-Za-z_][A-Za-z0-9_]*$/ : /^[A-Za-z0-9-]+$/
  if (!pattern.test(value)) throw new Error(kind === 'env' ? '环境变量名无效' : 'Header 名无效')
  return value
}

function slug(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return base || 'mcp'
}

function assertName(value: unknown): string {
  const name = trimmed(value, MAX_NAME)
  if (!name) throw new Error('名称不能为空')
  return name
}

function assertDescription(value: unknown): string {
  return trimmed(value, MAX_DESCRIPTION)
}

function normalizeArgs(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error('参数必须是数组')
  if (value.length > MAX_ARGS) throw new Error('参数过多')
  return value.map((item) => {
    if (typeof item !== 'string') throw new Error('参数必须是字符串')
    if (item.length > MAX_ARG) throw new Error('单个参数过长')
    return item
  })
}

function secretMap(value: unknown, kind: 'env' | 'header'): Map<string, Buffer> | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(kind === 'env' ? '环境变量格式无效' : 'Header 格式无效')
  }
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length > MAX_SECRETS) throw new Error('密钥项过多')
  if (entries.length > 0 && !safeStorage.isEncryptionAvailable()) {
    throw new Error('系统加密不可用，无法保存密钥')
  }
  const result = new Map<string, Buffer>()
  for (const [rawKey, rawValue] of entries) {
    const key = keyName(trimmed(rawKey, 120), kind)
    const value = trimmed(rawValue, MAX_SECRET)
    if (!value) continue
    result.set(key, safeStorage.encryptString(value))
  }
  return result
}

function secretKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => trimmed(item, 120))
    .filter(Boolean)
}

function uniqueKey(repository: CapabilityRepository, base: string, id: string): string {
  const root = slug(base)
  let candidate = root === 'workstationforone' ? `${root}-local` : root
  let index = 2
  while (true) {
    const existing = repository.findMcpServerByKey(candidate)
    if (!existing || existing.id === id) return candidate
    candidate = `${root}-${index}`
    index += 1
  }
}

function latestArgs(entry: ExternalMcpCatalogEntry, version: string): string[] {
  if (!entry.packageName) return entry.args
  if (!version) return entry.args
  if (entry.registry === 'npm') return ['-y', `${entry.packageName}@${version}`]
  if (entry.registry === 'pypi') return [`${entry.packageName}==${version}`]
  return entry.args
}

async function latestVersion(entry: ExternalMcpCatalogEntry): Promise<string> {
  if (!entry.packageName || !entry.registry) return entry.version ?? ''
  const url =
    entry.registry === 'npm'
      ? `https://registry.npmjs.org/${encodeURIComponent(entry.packageName)}/latest`
      : `https://pypi.org/pypi/${encodeURIComponent(entry.packageName)}/json`
  const response = await fetch(url, {
    signal: AbortSignal.timeout(UPDATE_TIMEOUT),
    headers: { accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`版本查询失败：HTTP ${response.status}`)
  const data = (await response.json()) as Record<string, unknown>
  if (entry.registry === 'npm') return trimmed(data.version, 60)
  const info = typeof data.info === 'object' && data.info !== null ? data.info : {}
  return trimmed((info as Record<string, unknown>).version, 60)
}

/**
 * 应用私有的外部 MCP Server 管理：配置与密钥只落本机库，
 * 启动 Claude 时解密成临时配置，从不碰 ~/.claude、~/.codex。
 */
export class McpServerService {
  constructor(
    private readonly repository: CapabilityRepository,
    private readonly appVersion = '0.0.0'
  ) {}

  catalog(): ExternalMcpCatalogEntry[] {
    return MCP_CATALOG.map((entry) => ({ ...entry, args: [...entry.args] }))
  }

  list(): ExternalMcpServerRecord[] {
    return this.repository.listMcpServers()
  }

  add(input: ExternalMcpSaveInput): ExternalMcpServerRecord {
    const catalog = input.catalogId ? catalogEntry(input.catalogId) : undefined
    if (input.catalogId && !catalog) throw new Error('内置 MCP 条目不存在')
    if (
      catalog &&
      this.repository.listMcpServers().some((server) => server.catalogId === catalog.id)
    ) {
      throw new Error('这个内置 MCP 已经安装')
    }
    const name = assertName(catalog?.name ?? input.name)
    const description = assertDescription(catalog?.description ?? input.description)
    const transport = catalog?.transport ?? input.transport
    if (transport !== 'stdio' && transport !== 'http') throw new Error('传输方式无效')
    const command = trimmed(catalog?.command ?? input.command, MAX_COMMAND)
    const args = normalizeArgs(catalog?.args ?? input.args)
    const url = trimmed(catalog?.url ?? input.url, 2000)
    if (transport === 'stdio' && !command) throw new Error('stdio 服务器必须填写命令')
    if (transport === 'http' && !/^https?:\/\//i.test(url)) throw new Error('HTTP 地址无效')
    const id = `mcp-${randomUUID()}`
    const env = secretMap(input.env, 'env')
    const headers = secretMap(input.headers, 'header')
    const created = this.repository.createMcpServer({
      id,
      key: uniqueKey(this.repository, catalog?.id ?? name, id),
      name,
      description,
      transport,
      command,
      args,
      url,
      source: catalog ? 'catalog' : 'manual',
      catalogId: catalog?.id ?? '',
      version: catalog ? (input.version ?? catalog.version ?? '') : '',
      enabled: false,
      trusted: false
    })
    this.repository.replaceSecrets(
      id,
      env,
      headers,
      secretKeys(input.removeEnvKeys),
      secretKeys(input.removeHeaderKeys)
    )
    return this.repository.findMcpServer(created.id) ?? created
  }

  update(id: string, input: ExternalMcpSaveInput): ExternalMcpServerRecord {
    const existing = this.repository.findMcpServer(id)
    if (!existing) throw new Error('MCP Server 不存在')
    const catalog = existing.catalogId ? catalogEntry(existing.catalogId) : undefined
    const name = assertName(input.name || existing.name)
    const description = assertDescription(input.description ?? existing.description)
    const transport = input.transport ?? existing.transport
    if (transport !== 'stdio' && transport !== 'http') throw new Error('传输方式无效')
    const command = trimmed(input.command ?? existing.command, MAX_COMMAND)
    const args = input.args === undefined ? existing.args : normalizeArgs(input.args)
    const url = trimmed(input.url ?? existing.url, 2000)
    if (transport === 'stdio' && !command) throw new Error('stdio 服务器必须填写命令')
    if (transport === 'http' && !/^https?:\/\//i.test(url)) throw new Error('HTTP 地址无效')
    const endpointChanged =
      transport !== existing.transport ||
      command !== existing.command ||
      args.join('\n') !== existing.args.join('\n') ||
      url !== existing.url
    const env = secretMap(input.env, 'env')
    const headers = secretMap(input.headers, 'header')
    const updated = this.repository.updateMcpServer(id, {
      name,
      description,
      transport,
      command,
      args,
      url,
      source: catalog ? 'catalog' : 'manual',
      catalogId: existing.catalogId,
      version: input.version ?? existing.version,
      enabled: endpointChanged ? false : existing.enabled,
      trusted: endpointChanged ? false : existing.trusted
    })
    this.repository.replaceSecrets(
      id,
      env,
      headers,
      secretKeys(input.removeEnvKeys),
      secretKeys(input.removeHeaderKeys)
    )
    if (!updated) throw new Error('MCP Server 保存失败')
    return this.repository.findMcpServer(id) ?? updated
  }

  remove(id: string): void {
    this.repository.removeMcpServer(id)
  }

  setEnabled(id: string, enabled: boolean, trust = false): ExternalMcpServerRecord {
    const server = this.repository.findMcpServer(id)
    if (!server) throw new Error('MCP Server 不存在')
    if (enabled && !server.trusted && !trust) {
      throw new Error('启用外部 MCP 前需要先确认信任其命令与参数')
    }
    const updated = this.repository.setMcpEnabled(id, enabled, enabled ? true : undefined)
    if (!updated) throw new Error('MCP Server 状态保存失败')
    return updated
  }

  async test(id: string): Promise<ExternalMcpServerRecord> {
    const server = this.repository.findMcpServer(id)
    if (!server) throw new Error('MCP Server 不存在')
    if (!server.trusted) throw new Error('先确认信任这个 MCP Server，再测试连接')
    try {
      const secrets = this.repository.secretsFor(id)
      const env: Record<string, string> = {}
      for (const [key, encrypted] of secrets.env) {
        env[key] = safeStorage.decryptString(encrypted)
      }
      const headers: Record<string, string> = {}
      for (const [key, encrypted] of secrets.headers) {
        headers[key] = safeStorage.decryptString(encrypted)
      }
      const result = await probeMcpServer({
        transport: server.transport,
        ...(server.transport === 'stdio'
          ? {
              command: server.command,
              args: server.args,
              ...(Object.keys(env).length ? { env } : {})
            }
          : { url: server.url, ...(Object.keys(headers).length ? { headers } : {}) }),
        version: this.appVersion
      })
      this.repository.syncTools(id, result.tools)
      return (
        this.repository.setMcpTest(
          id,
          result.tools.map((tool) => tool.name),
          ''
        ) ?? server
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : '连接测试失败'
      // 测试失败保留已知工具与既有审批策略，改配置时才清空
      return this.repository.setMcpTest(id, server.toolNames, message) ?? server
    }
  }

  importConfig(text: string): McpImportResult {
    const parsed = parseMcpConfig(text)
    const existing = new Set(
      this.repository.listMcpServers().map((server) => server.name.trim().toLowerCase())
    )
    const added: ExternalMcpServerRecord[] = []
    const skipped: string[] = []
    const errors = [...parsed.errors]
    for (const input of parsed.inputs) {
      const key = input.name.trim().toLowerCase()
      if (existing.has(key)) {
        skipped.push(input.name)
        continue
      }
      try {
        added.push(this.add(input))
        existing.add(key)
      } catch (error) {
        errors.push({
          name: input.name,
          message: error instanceof Error ? error.message : '导入失败'
        })
      }
    }
    return { added, skipped, errors }
  }

  exportConfig(): string {
    return exportMcpConfig(this.repository.listMcpServers())
  }

  setToolPolicy(id: string, toolName: string, approval: McpToolApproval): ExternalMcpServerRecord {
    const server = this.repository.findMcpServer(id)
    if (!server) throw new Error('MCP Server 不存在')
    if (!server.trusted) throw new Error('先确认信任这个 MCP Server，再配置工具权限')
    if (!server.tools.some((tool) => tool.name === toolName)) {
      throw new Error('工具不存在，请先测试连接')
    }
    this.repository.setToolApproval(id, toolName, approval)
    return this.repository.findMcpServer(id) ?? server
  }

  /**
   * Codex Provider 会话用的外部 Server 配置：密钥只以环境变量名下发，
   * 值与工具策略留给调用方注入子进程 / 审批。
   */
  codexRuntime(): CodexMcpRuntime {
    const live = new Map(this.runtimeServers().map((server) => [server.name, server]))
    return buildCodexMcpRuntime(
      this.repository
        .listMcpServers()
        .filter((server) => server.enabled && server.trusted)
        .map((server) => {
          const runtime = live.get(server.key)
          return {
            key: server.key,
            transport: server.transport,
            command: server.command,
            args: [...server.args],
            url: server.url,
            ...(runtime?.env ? { env: runtime.env } : {}),
            ...(runtime?.headers ? { headers: runtime.headers } : {}),
            tools: server.tools.map((tool) => ({
              name: tool.name,
              approval: tool.approval
            }))
          }
        })
    )
  }

  /** Claude 启动时只自动批准用户显式设为 allow 的外部工具。 */
  claudeToolPolicy(): { allowed: string[]; denied: string[] } {
    const allowed: string[] = []
    const denied: string[] = []
    for (const server of this.repository.listMcpServers()) {
      if (!server.enabled || !server.trusted) continue
      for (const tool of server.tools) {
        if (tool.approval === 'ask') continue
        const name = `mcp__${server.key}__${tool.name}`
        if (tool.approval === 'allow') allowed.push(name)
        else denied.push(name)
      }
    }
    return { allowed, denied }
  }

  async checkUpdates(): Promise<ExternalMcpUpdateInfo[]> {
    const servers = this.repository.listMcpServers().filter((server) => server.catalogId)
    const results = await Promise.all(
      servers.map(async (server) => {
        const entry = catalogEntry(server.catalogId)
        if (!entry) {
          return {
            id: server.id,
            name: server.name,
            currentVersion: server.version,
            latestVersion: server.version,
            hasUpdate: false
          }
        }
        try {
          const latest = await latestVersion(entry)
          return {
            id: server.id,
            name: server.name,
            currentVersion: server.version,
            latestVersion: latest,
            hasUpdate: Boolean(latest) && latest !== server.version
          }
        } catch {
          return {
            id: server.id,
            name: server.name,
            currentVersion: server.version,
            latestVersion: server.version,
            hasUpdate: false
          }
        }
      })
    )
    return results
  }

  async applyUpdate(id: string): Promise<ExternalMcpServerRecord> {
    const server = this.repository.findMcpServer(id)
    if (!server) throw new Error('MCP Server 不存在')
    const entry = server.catalogId ? catalogEntry(server.catalogId) : undefined
    if (!entry?.packageName) throw new Error('这个 Server 没有可更新的内置来源')
    const latest = await latestVersion(entry)
    if (!latest) throw new Error('没有查到新版本')
    const args = latestArgs(entry, latest)
    const updated = this.repository.updateMcpServer(id, {
      name: server.name,
      description: server.description,
      transport: server.transport,
      command: entry.command,
      args,
      url: server.url,
      source: server.source,
      catalogId: server.catalogId,
      version: latest,
      enabled: server.enabled,
      trusted: server.trusted
    })
    if (!updated) throw new Error('MCP Server 更新失败')
    return updated
  }

  /** 启动 Claude 前取启用的 Server；密钥只在主进程解密，进临时配置。 */
  runtimeServers(): McpServerRuntime[] {
    const servers = this.repository
      .listMcpServers()
      .filter((server) => server.enabled && server.trusted)
    return servers.map((server) => {
      if (server.transport === 'stdio') {
        const secrets = this.repository.secretsFor(server.id)
        const env: Record<string, string> = {}
        for (const [key, encrypted] of secrets.env) {
          env[key] = safeStorage.decryptString(encrypted)
        }
        return {
          name: server.key,
          type: 'stdio' as const,
          command: server.command,
          args: [...server.args],
          ...(Object.keys(env).length > 0 ? { env } : {})
        }
      }
      const secrets = this.repository.secretsFor(server.id)
      const headers: Record<string, string> = {}
      for (const [key, encrypted] of secrets.headers) {
        headers[key] = safeStorage.decryptString(encrypted)
      }
      return {
        name: server.key,
        type: 'http' as const,
        url: server.url,
        ...(Object.keys(headers).length > 0 ? { headers } : {})
      }
    })
  }
}
