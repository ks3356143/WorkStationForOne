import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { safeStorage } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CapabilityRepository } from '../db/capabilities'
import { migrate, openDatabase } from '../db/database'
import { McpServerService } from './mcp-servers'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace('enc:', ''))
  }
}))

const STUB = join(process.cwd(), 'scripts', 'stub-mcp-server.cjs')
const dirs: string[] = []

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-mcp-service-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, service: new McpServerService(new CapabilityRepository(db)) }
}

beforeEach(() => {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('McpServerService', () => {
  it('内置目录添加后默认停用且未信任，重复添加会被拒绝', () => {
    const { db, service } = setup()
    const created = service.add({ name: 'Memory', transport: 'stdio', catalogId: 'memory' })
    expect(created).toMatchObject({
      name: 'Memory',
      source: 'catalog',
      catalogId: 'memory',
      enabled: false,
      trusted: false
    })
    expect(() => service.add({ name: 'Memory', transport: 'stdio', catalogId: 'memory' })).toThrow(
      /已经安装/
    )
    db.close()
  })

  it('启用必须显式信任，信任后 runtime 生成 stdio 配置并解密 env', () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Custom',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'secret' }
    })
    expect(() => service.setEnabled(created.id, true)).toThrow(/信任/)
    const enabled = service.setEnabled(created.id, true, true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.trusted).toBe(true)

    const runtime = service.runtimeServers()
    expect(runtime).toHaveLength(1)
    expect(runtime[0]).toMatchObject({
      name: created.key,
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'secret' }
    })
    db.close()
  })

  it('已信任的 stdio Server 可测试连接并保存工具清单', async () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Stub',
      transport: 'stdio',
      command: process.execPath,
      args: [STUB]
    })
    await expect(service.test(created.id)).rejects.toThrow(/信任/)
    service.setEnabled(created.id, true, true)
    const tested = await service.test(created.id)
    expect(tested.lastError).toBe('')
    expect(tested.toolNames).toEqual(['echo', 'stub_status'])
    expect(tested.tools.map((tool) => [tool.name, tool.readOnly, tool.approval])).toEqual([
      ['echo', true, 'ask'],
      ['stub_status', true, 'ask']
    ])
    expect(tested.lastTestAt).toBeTypeOf('number')

    const allowed = service.setToolPolicy(tested.id, 'echo', 'allow')
    expect(allowed.tools.find((tool) => tool.name === 'echo')?.approval).toBe('allow')
    service.setToolPolicy(tested.id, 'stub_status', 'deny')
    expect(service.claudeToolPolicy()).toEqual({
      allowed: [`mcp__${tested.key}__echo`],
      denied: [`mcp__${tested.key}__stub_status`]
    })
    db.close()
  })

  it('Codex 运行时带密钥环境变量名与工具策略，不下发停用 Server', async () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Stub',
      transport: 'stdio',
      command: process.execPath,
      args: [STUB],
      env: { API_KEY: 'secret' }
    })
    service.setEnabled(created.id, true, true)
    const tested = await service.test(created.id)
    service.setToolPolicy(tested.id, 'echo', 'allow')
    service.setToolPolicy(tested.id, 'stub_status', 'deny')
    service.add({ name: 'Off', transport: 'stdio', command: 'node' })

    const runtime = service.codexRuntime()
    expect(runtime.servers).toHaveLength(1)
    expect(runtime.servers[0]).toMatchObject({
      key: tested.key,
      transport: 'stdio',
      command: process.execPath,
      args: [STUB],
      envVars: [`WS_MCP_${tested.key.toUpperCase()}_E_API_KEY`],
      allowedTools: ['echo'],
      disabledTools: ['stub_status']
    })
    expect(runtime.env).toEqual({
      [`WS_MCP_${tested.key.toUpperCase()}_E_API_KEY`]: 'secret'
    })
    expect(runtime.policies[tested.key]).toEqual({
      echo: 'allow',
      stub_status: 'deny'
    })
    db.close()
  })

  it('MCP JSON 导入跳过重名，导出不泄露密钥值', () => {
    const { db, service } = setup()
    const imported = service.importConfig(
      JSON.stringify({
        mcpServers: {
          Remote: {
            url: 'https://example.com/mcp',
            headers: { Authorization: 'Bearer secret' }
          },
          Local: {
            command: 'node',
            args: ['x.js'],
            env: { TOKEN: 'secret' }
          },
          'Bad Name': {}
        }
      })
    )
    expect(imported.added.map((item) => item.name)).toEqual(['Remote', 'Local'])
    expect(imported.errors).toHaveLength(1)
    expect(imported.added.every((item) => !item.enabled && !item.trusted)).toBe(true)

    const duplicate = service.importConfig(
      JSON.stringify({ mcpServers: { Remote: { command: 'node', args: ['y.js'] } } })
    )
    expect(duplicate.added).toHaveLength(0)
    expect(duplicate.skipped).toEqual(['Remote'])

    const exported = JSON.parse(service.exportConfig()) as {
      mcpServers: Record<string, { headers?: Record<string, string>; env?: Record<string, string> }>
    }
    expect(exported.mcpServers.Remote.headers).toEqual({ Authorization: '' })
    expect(exported.mcpServers.Local.env).toEqual({ TOKEN: '' })
    expect(service.exportConfig()).not.toContain('Bearer secret')
    expect(service.exportConfig()).not.toContain('"secret"')
    db.close()
  })

  it('测试失败时保存可读错误，不抛出到 UI', async () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Missing',
      transport: 'stdio',
      command: 'definitely-not-a-command-wsfo',
      args: []
    })
    service.setEnabled(created.id, true, true)
    const tested = await service.test(created.id)
    expect(tested.toolNames).toEqual([])
    expect(tested.lastError).toMatch(/找不到 MCP 命令/)
    db.close()
  })

  it('HTTP Server 保存 header 加密值，列表不回传值', () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Remote',
      transport: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret' }
    })
    expect(created.headerKeys).toEqual(['Authorization'])
    expect(JSON.stringify(service.list())).not.toContain('Bearer secret')
    service.setEnabled(created.id, true, true)
    expect(service.runtimeServers()[0]).toMatchObject({
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer secret' }
    })
    db.close()
  })

  it('修改命令会重新停用并清掉信任', () => {
    const { db, service } = setup()
    const created = service.add({
      name: 'Custom',
      transport: 'stdio',
      command: 'node',
      args: ['a.js']
    })
    service.setEnabled(created.id, true, true)
    const updated = service.update(created.id, {
      name: 'Custom',
      transport: 'stdio',
      command: 'node',
      args: ['b.js']
    })
    expect(updated.enabled).toBe(false)
    expect(updated.trusted).toBe(false)
    db.close()
  })

  it('检查更新并应用内置目录的新版本命令', async () => {
    const { db, service } = setup()
    const created = service.add({ name: 'Memory', transport: 'stdio', catalogId: 'memory' })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ version: '9.9.9' })
      }))
    )

    const updates = await service.checkUpdates()
    expect(updates).toHaveLength(1)
    expect(updates[0]).toMatchObject({ id: created.id, latestVersion: '9.9.9', hasUpdate: true })

    const updated = await service.applyUpdate(created.id)
    expect(updated.version).toBe('9.9.9')
    expect(updated.args).toEqual(['-y', '@modelcontextprotocol/server-memory@9.9.9'])
    db.close()
  })

  it('拒绝非法 HTTP 地址与空命令', () => {
    const { db, service } = setup()
    expect(() => service.add({ name: 'Bad', transport: 'http', url: 'file:///x' })).toThrow()
    expect(() => service.add({ name: 'Bad', transport: 'stdio', command: '' })).toThrow()
    db.close()
  })
})
