import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from './agent'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'
import { ExpertRepository } from './experts'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-experts-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new ExpertRepository(db), agent: new AgentRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('迁移 v48', () => {
  it('建立专家与市场源表，会话增加 persona', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(53)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('agent_experts', 'expert_sources') ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(['agent_experts', 'expert_sources'])
    const columns = db
      .prepare('PRAGMA table_info(agent_sessions)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toContain('persona')
    db.close()
  })

  it('v47 升级保留旧会话并默认 persona 为空', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-experts-upgrade-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 47)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(db)

    expect(userVersion(db)).toBe(53)
    const agent = new AgentRepository(db)
    expect(agent.findSession('s1')?.persona).toBeUndefined()
    db.close()
  })
})

describe('ExpertRepository 专家', () => {
  it('新建自定义专家生成 id 并往返工具键', () => {
    const { db, repo } = seedDb()
    const saved = repo.saveExpert({
      name: '我的专家',
      description: '描述',
      persona: '你是专家。',
      tools: ['mcp:context7', 'skill:document-skills']
    })
    expect(saved.id).toBeTruthy()
    expect(saved.builtin).toBe(false)
    const found = repo.findExpert(saved.id)
    expect(found?.persona).toBe('你是专家。')
    expect(found?.tools).toEqual(['mcp:context7', 'skill:document-skills'])
    db.close()
  })

  it('传入已有 id 即更新而非新增', () => {
    const { db, repo } = seedDb()
    const saved = repo.saveExpert({ name: '甲', description: '', persona: 'v1', tools: [] })
    const updated = repo.saveExpert({
      id: saved.id,
      name: '乙',
      description: 'd',
      persona: 'v2',
      tools: ['mcp:deepwiki']
    })
    expect(updated.id).toBe(saved.id)
    expect(repo.listExperts()).toHaveLength(1)
    expect(repo.findExpert(saved.id)?.name).toBe('乙')
    expect(repo.findExpert(saved.id)?.persona).toBe('v2')
    expect(repo.findExpert(saved.id)?.tools).toEqual(['mcp:deepwiki'])
    db.close()
  })

  it('删除只作用于自定义专家', () => {
    const { db, repo } = seedDb()
    const saved = repo.saveExpert({ name: '甲', description: '', persona: 'p', tools: [] })
    expect(repo.removeExpert(saved.id)).toBe(true)
    expect(repo.removeExpert(saved.id)).toBe(false)
    expect(repo.findExpert(saved.id)).toBeUndefined()
    db.close()
  })

  it('损坏的 tools_json 回退为空数组', () => {
    const { db, repo } = seedDb()
    const saved = repo.saveExpert({ name: '甲', description: '', persona: 'p', tools: [] })
    db.prepare('UPDATE agent_experts SET tools_json = ? WHERE id = ?').run('{bad', saved.id)
    expect(repo.findExpert(saved.id)?.tools).toEqual([])
    db.close()
  })
})

describe('ExpertRepository 市场源', () => {
  it('保存 / 查找 / 同步 / 删除源', () => {
    const { db, repo } = seedDb()
    const saved = repo.saveSource({
      id: 'src-1',
      name: 'community',
      url: 'https://example.com/x.git',
      ref: '',
      root: '/tmp/x'
    })
    expect(repo.findSourceByName('community')?.id).toBe('src-1')
    expect(saved.lastError).toBe('')
    expect(saved.lastSyncedAt).toBeNull()

    repo.updateSourceSync('src-1', { lastSyncedAt: 123, lastError: '' })
    expect(repo.findSource('src-1')?.lastSyncedAt).toBe(123)

    repo.updateSourceSync('src-1', { lastSyncedAt: 123, lastError: '克隆失败' })
    expect(repo.findSource('src-1')?.lastError).toBe('克隆失败')

    expect(repo.listSources()).toHaveLength(1)
    repo.removeSource('src-1')
    expect(repo.listSources()).toHaveLength(0)
    db.close()
  })

  it('同名源拒绝重复保存', () => {
    const { db, repo } = seedDb()
    repo.saveSource({
      id: 'src-1',
      name: 'community',
      url: 'https://example.com/x.git',
      ref: '',
      root: '/tmp/x'
    })
    expect(() =>
      repo.saveSource({
        id: 'src-2',
        name: 'community',
        url: 'https://example.com/y.git',
        ref: '',
        root: '/tmp/y'
      })
    ).toThrow(/已存在/)
    db.close()
  })
})

describe('会话人设', () => {
  it('创建带人设的会话并可读取与更新', () => {
    const { db, agent } = seedDb()
    agent.createSession({ id: 's1', agent: 'claude', title: '专家会话', persona: '你是前端专家。' })
    expect(agent.findSession('s1')?.persona).toBe('你是前端专家。')
    expect(agent.listSessions()[0]?.persona).toBe('你是前端专家。')

    agent.updateSession('s1', { persona: '你是后端专家。' })
    expect(agent.findSession('s1')?.persona).toBe('你是后端专家。')

    agent.updateSession('s1', { persona: '' })
    expect(agent.findSession('s1')?.persona).toBeUndefined()
    db.close()
  })

  it('普通会话没有人设，分叉继承人设', () => {
    const { db, agent } = seedDb()
    agent.createSession({ id: 's1', agent: 'claude', title: '普通' })
    expect(agent.findSession('s1')?.persona).toBeUndefined()

    agent.createSession({ id: 's2', agent: 'claude', title: '专家', persona: '你是运维专家。' })
    agent.saveMessage({
      id: 'm1',
      sessionId: 's2',
      role: 'user',
      text: 'hi',
      timeLabel: '刚刚',
      createdAt: 1
    })
    agent.saveMessage({
      id: 'm2',
      sessionId: 's2',
      role: 'assistant',
      text: 'hello',
      timeLabel: '刚刚',
      createdAt: 2
    })
    const fork = agent.forkSession({ sourceId: 's2', messageId: 'm2', id: 's3', title: '分叉' })
    expect(fork?.session.persona).toBe('你是运维专家。')
    db.close()
  })
})
