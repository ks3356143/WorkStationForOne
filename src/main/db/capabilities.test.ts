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

describe('外部 MCP 的 Agent 归属（DB v28）', () => {
  it('默认 both，可保存为 claude / codex 并原样读回', () => {
    const { db, repo } = seed()
    const created = repo.createMcpServer(server)
    expect(created.targets).toBe('both')

    const updated = repo.updateMcpServer(created.id, {
      name: created.name,
      description: created.description,
      transport: created.transport,
      command: created.command,
      args: [...created.args],
      url: created.url,
      source: created.source,
      catalogId: created.catalogId,
      version: created.version,
      enabled: created.enabled,
      trusted: created.trusted,
      targets: 'codex'
    })
    expect(updated?.targets).toBe('codex')
    expect(repo.findMcpServer(created.id)?.targets).toBe('codex')
    expect(repo.listMcpServers()[0].targets).toBe('codex')
    db.close()
  })

  it('v27 旧库升级后既有 Server 视为 both', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-cap-v27-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 27)
    )
    db.prepare(
      `INSERT INTO mcp_servers
        (id, key, name, description, transport, command, args_json, url, source,
         catalog_id, version, enabled, trusted, created_at, updated_at)
       VALUES ('old', 'memory', 'Memory', '', 'stdio', 'npx', '[]', '', 'catalog',
         'memory', '1', 0, 0, 1, 1)`
    ).run()
    migrate(db)
    expect(new CapabilityRepository(db).findMcpServer('old')?.targets).toBe('both')
    db.close()
  })

  it('v31 旧库 Server 默认 headers，OAuth 记录随 Server 删除', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-cap-v31-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 30)
    )
    db.prepare(
      `INSERT INTO mcp_servers
        (id, key, name, description, transport, command, args_json, url, source,
         catalog_id, version, enabled, trusted, created_at, updated_at)
       VALUES ('old', 'remote', 'Remote', '', 'http', '', '[]', 'https://example.com/mcp',
         'manual', '', '', 1, 1, 1, 1)`
    ).run()
    migrate(db)
    const repo = new CapabilityRepository(db)
    expect(repo.findMcpServer('old')?.auth).toBe('headers')
    expect(repo.findMcpServer('old')?.oauth).toBeNull()

    repo.saveOAuthRegistration('old', {
      issuer: 'https://auth.example.com',
      resource: 'https://example.com/mcp',
      clientId: 'client-1',
      clientSecret: Buffer.from('secret'),
      authorizationEndpoint: 'https://auth.example.com/authorize',
      tokenEndpoint: 'https://auth.example.com/token',
      registrationEndpoint: 'https://auth.example.com/register',
      scopes: 'mcp.read',
      authMethod: 'none'
    })
    expect(repo.findMcpServer('old')?.oauth).toBeNull()
    repo.saveOAuthTokens('old', {
      accessToken: Buffer.from('encrypted-access'),
      refreshToken: Buffer.from('encrypted-refresh'),
      expiresAt: Date.now() + 60_000
    })
    expect(repo.findMcpServer('old')?.oauth).toMatchObject({
      state: 'connected',
      issuer: 'https://auth.example.com'
    })
    expect(JSON.stringify(repo.findMcpServer('old')?.oauth)).not.toContain('encrypted')

    repo.removeMcpServer('old')
    const row = db.prepare('SELECT COUNT(*) AS n FROM mcp_oauth').get() as { n: number }
    expect(row.n).toBe(0)
    db.close()
  })
})

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
