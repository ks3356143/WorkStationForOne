import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CapabilityRepository } from './capabilities'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []

function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-cap-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new CapabilityRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

const plugin = {
  id: 'demo@market',
  name: 'Demo',
  description: 'Demo plugin',
  version: '1.0.0',
  marketplace: 'market',
  installPath: 'C:\\data\\plugins\\demo',
  components: ['skills'],
  hasHooks: false,
  hasMcp: false,
  enabled: false,
  trusted: true
}

const server = {
  id: 'mcp-1',
  key: 'memory',
  name: 'Memory',
  description: '',
  transport: 'stdio' as const,
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-memory'],
  url: '',
  source: 'catalog' as const,
  catalogId: 'memory',
  version: '2026.1.0',
  enabled: false,
  trusted: false
}

describe('能力中心 DB v22 / v23 / v24', () => {
  it('建立能力表并推进到最新版本', () => {
    const { db } = seed()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent_plugins', 'mcp_servers', 'mcp_server_secrets', 'mcp_server_tools') ORDER BY name"
      )
      .all() as { name: string }[]
    expect(tables.map((row) => row.name)).toEqual([
      'agent_plugins',
      'mcp_server_secrets',
      'mcp_server_tools',
      'mcp_servers'
    ])
    const columns = db
      .prepare('PRAGMA table_info(mcp_servers)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toEqual(expect.arrayContaining(['tools_json', 'last_test_at', 'last_error']))
    db.close()
  })

  it('插件索引保存组件与启停状态', () => {
    const { db, repo } = seed()
    const saved = repo.upsertPlugin(plugin)
    expect(saved).toMatchObject({ id: plugin.id, components: ['skills'], enabled: false })

    repo.setPluginEnabled(plugin.id, true, true)
    expect(repo.findPlugin(plugin.id)?.enabled).toBe(true)

    repo.removePlugin(plugin.id)
    expect(repo.listPlugins()).toEqual([])
    db.close()
  })

  it('MCP Server 密钥按 env / header 分开保存，列表只回传 key', () => {
    const { db, repo } = seed()
    const saved = repo.createMcpServer(server)
    repo.replaceSecrets(
      saved.id,
      new Map([['TOKEN', Buffer.from('encrypted-token')]]),
      new Map([['Authorization', Buffer.from('encrypted-header')]])
    )

    const listed = repo.listMcpServers()[0]
    expect(listed.envKeys).toEqual(['TOKEN'])
    expect(listed.headerKeys).toEqual(['Authorization'])
    expect(repo.secretsFor(saved.id).env.get('TOKEN')?.toString()).toBe('encrypted-token')

    repo.replaceSecrets(saved.id, undefined, undefined, ['TOKEN'])
    expect(repo.secretKeys(saved.id).env).toEqual([])
    db.close()
  })

  it('测试结果可保存，修改配置后清空重测', () => {
    const { db, repo } = seed()
    const saved = repo.createMcpServer(server)
    const tested = repo.setMcpTest(saved.id, ['echo', 'status'], '')
    expect(tested).toMatchObject({ toolNames: ['echo', 'status'], lastError: '' })
    expect(tested?.lastTestAt).toBeTypeOf('number')

    repo.updateMcpServer(saved.id, {
      name: saved.name,
      description: saved.description,
      transport: saved.transport,
      command: 'node',
      args: ['x.js'],
      url: '',
      source: saved.source,
      catalogId: saved.catalogId,
      version: saved.version,
      enabled: saved.enabled,
      trusted: saved.trusted
    })
    expect(repo.findMcpServer(saved.id)).toMatchObject({
      toolNames: [],
      lastTestAt: null,
      lastError: ''
    })
    db.close()
  })

  it('工具同步保留已有审批并清理已消失工具', () => {
    const { db, repo } = seed()
    const saved = repo.createMcpServer(server)
    repo.syncTools(saved.id, [
      { name: 'echo', description: 'Echo', readOnly: true },
      { name: 'write', description: 'Write', readOnly: false }
    ])
    expect(repo.toolsFor(saved.id).map((tool) => [tool.name, tool.approval])).toEqual([
      ['echo', 'ask'],
      ['write', 'ask']
    ])

    repo.setToolApproval(saved.id, 'echo', 'allow')
    repo.syncTools(saved.id, [
      { name: 'echo', description: 'Echo v2', readOnly: true },
      { name: 'status', description: 'Status', readOnly: true }
    ])
    expect(repo.toolsFor(saved.id).map((tool) => [tool.name, tool.approval])).toEqual([
      ['echo', 'allow'],
      ['status', 'ask']
    ])
    db.close()
  })

  it('删除 Server 时连带删除密钥', () => {
    const { db, repo } = seed()
    const saved = repo.createMcpServer(server)
    repo.replaceSecrets(saved.id, new Map([['TOKEN', Buffer.from('x')]]), undefined)
    repo.removeMcpServer(saved.id)
    const rows = db.prepare('SELECT COUNT(*) AS n FROM mcp_server_secrets').get() as { n: number }
    expect(rows.n).toBe(0)
    db.close()
  })
})
