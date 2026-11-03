import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from './agent'
import { MIGRATIONS, migrate, openDatabase, userVersion } from './database'

const dirs: string[] = []

function seedDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  return { db, repo: new AgentRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('迁移 v16', () => {
  it('建立会话与消息表并推进到最新版本', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'agent_%' ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual([
      'agent_messages',
      'agent_plugins',
      'agent_presets',
      'agent_runs',
      'agent_sessions'
    ])
    const columns = db
      .prepare('PRAGMA table_info(agent_sessions)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(columns).toContain('workspace')
    const messageColumns = db
      .prepare('PRAGMA table_info(agent_messages)')
      .all()
      .map((row) => (row as { name: string }).name)
    expect(messageColumns).toContain('origin')
    db.close()
  })

  it('v25 升级到 v26 保留已有消息并默认 origin=app', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-upgrade-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 25)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()
    db.prepare(
      `INSERT INTO agent_messages (id, session_id, role, text, time_label, error, created_at)
       VALUES ('m1', 's1', 'user', '旧消息', '刚刚', 0, 1)`
    ).run()

    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 26)
    )

    expect(userVersion(db)).toBe(26)
    const row = db.prepare('SELECT origin FROM agent_messages WHERE id = ?').get('m1') as {
      origin: string
    }
    expect(row.origin).toBe('app')
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_messages').get()).toMatchObject({ n: 1 })
    db.close()
  })
})

describe('AgentRepository · 会话', () => {
  it('创建、读取并按更新时间倒序排列', () => {
    const { db, repo } = seedDb()
    const first = repo.createSession({ id: 's1', agent: 'claude', title: '第一个会话' })
    const second = repo.createSession({ id: 's2', agent: 'claude', title: '第二个会话' })

    expect(first).toMatchObject({ id: 's1', agent: 'claude', title: '第一个会话', status: 'idle' })
    expect(repo.listSessions().map((session) => session.id)).toEqual(['s2', 's1'])
    expect(repo.listSessions()[0]).toEqual(second)
    db.close()
  })

  it('更新标题、状态、Claude resume id 与工作区', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '新会话' })

    const updated = repo.updateSession('s1', {
      title: '重构 auth 模块',
      status: 'run',
      resumeId: 'cli-session-1',
      workspace: 'C:\\work\\auth'
    })

    expect(updated).toMatchObject({
      title: '重构 auth 模块',
      status: 'run',
      resumeId: 'cli-session-1',
      workspace: 'C:\\work\\auth'
    })
    expect(repo.findSession('s1')?.workspace).toBe('C:\\work\\auth')
    expect(repo.updateSession('missing', { title: 'x' })).toBeUndefined()
    db.close()
  })

  it('v31 升级到 v32 会话默认不置顶', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-pin-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 31)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 32)
    )

    expect(userVersion(db)).toBe(32)
    const row = db.prepare('SELECT pinned FROM agent_sessions WHERE id = ?').get('s1') as {
      pinned: number
    }
    expect(row.pinned).toBe(0)
    db.close()
  })

  it('v32 升级到 v33 会话默认不归档', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-archive-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 32)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 33)
    )

    expect(userVersion(db)).toBe(33)
    const row = db.prepare('SELECT archived FROM agent_sessions WHERE id = ?').get('s1') as {
      archived: number
    }
    expect(row.archived).toBe(0)
    expect(db.prepare('SELECT COUNT(*) AS n FROM agent_sessions').get()).toMatchObject({ n: 1 })
    db.close()
  })

  it('v34 升级到 v35 分叉标记默认关闭且可切换', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-fork-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 34)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'claude', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const repo = new AgentRepository(db)
    expect(repo.findSession('s1')?.pendingFork).toBeUndefined()

    repo.updateSession('s1', { resumeId: 'cli-1', pendingFork: true })
    expect(repo.findSession('s1')).toMatchObject({ resumeId: 'cli-1', pendingFork: true })

    repo.updateSession('s1', { pendingFork: false })
    expect(repo.findSession('s1')?.pendingFork).toBeUndefined()
    db.close()
  })

  it('v35 升级到 v36 保存消息 turn id 与会话分叉回合', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-agent-turn-'))
    dirs.push(dir)
    const db = openDatabase(join(dir, 'workstation.db'))
    migrate(
      db,
      MIGRATIONS.filter((migration) => migration.version <= 35)
    )
    db.prepare(
      `INSERT INTO agent_sessions (id, agent, title, status, created_at, updated_at)
       VALUES ('s1', 'codex', '旧会话', 'idle', 1, 1)`
    ).run()

    migrate(db)

    expect(userVersion(db)).toBe(MIGRATIONS.at(-1)!.version)
    const repo = new AgentRepository(db)
    repo.saveMessage({
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      text: '已有正文',
      timeLabel: '刚刚',
      turnId: 'turn-1',
      createdAt: 2
    })
    expect(repo.listMessagesForSession('s1')[0]?.turnId).toBe('turn-1')

    repo.updateSession('s1', { forkTurnId: 'turn-1' })
    expect(repo.findSession('s1')?.forkTurnId).toBe('turn-1')
    repo.updateSession('s1', { forkTurnId: null })
    expect(repo.findSession('s1')?.forkTurnId).toBeUndefined()
    db.close()
  })

  it('删除会话时连带清理消息，其他会话不受影响', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '要删除' })
    repo.createSession({ id: 's2', agent: 'claude', title: '保留' })
    repo.saveMessage({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      text: '一',
      timeLabel: '刚刚',
      createdAt: 1
    })
    repo.saveMessage({
      id: 'm2',
      sessionId: 's2',
      role: 'user',
      text: '二',
      timeLabel: '刚刚',
      createdAt: 2
    })

    expect(repo.removeSession('s1')).toBe(true)
    expect(repo.findSession('s1')).toBeUndefined()
    expect(repo.listMessagesForSession('s1')).toEqual([])
    expect(repo.listSessions().map((session) => session.id)).toEqual(['s2'])
    expect(repo.listMessagesForSession('s2')).toHaveLength(1)
    expect(repo.removeSession('s1')).toBe(false)
    db.close()
  })

  it('置顶会话排在同组前面并可取消', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '一' })
    repo.createSession({ id: 's2', agent: 'claude', title: '二' })
    repo.createSession({ id: 's3', agent: 'claude', title: '三' })
    db.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(100, 's1')
    db.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(200, 's2')
    db.prepare('UPDATE agent_sessions SET updated_at = ? WHERE id = ?').run(300, 's3')

    expect(repo.updateSession('s2', { pinned: true })).toMatchObject({ pinned: true })
    expect(repo.findSession('s2')?.pinned).toBe(true)
    expect(repo.listSessions().map((session) => session.id)).toEqual(['s2', 's3', 's1'])
    expect(repo.searchSessions('二')[0]?.session.id).toBe('s2')

    repo.updateSession('s2', { pinned: false })
    expect(repo.findSession('s2')?.pinned).toBeUndefined()
    expect(repo.listSessions()).toHaveLength(3)
    db.close()
  })

  it('归档标记可写入且不影响消息', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '归档会话' })
    repo.saveMessage({
      id: 'm1',
      sessionId: 's1',
      role: 'user',
      text: '保留我',
      timeLabel: '刚刚',
      createdAt: 1
    })

    expect(repo.updateSession('s1', { archived: true })).toMatchObject({ archived: true })
    expect(repo.findSession('s1')?.archived).toBe(true)
    expect(repo.listMessagesForSession('s1')).toHaveLength(1)
    expect(repo.listSessions()).toHaveLength(1)

    repo.updateSession('s1', { archived: false })
    expect(repo.findSession('s1')?.archived).toBeUndefined()
    expect(repo.listMessagesForSession('s1')).toHaveLength(1)
    db.close()
  })

  it('从消息分叉只复制到此为止的对话', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '原会话' })
    repo.updateSession('s1', { workspace: 'C:\\work', resumeId: 'cli-1' })
    for (const [id, text] of [
      ['m1', '一'],
      ['m2', '二'],
      ['m3', '三']
    ]) {
      repo.saveMessage({
        id,
        sessionId: 's1',
        role: 'user',
        text,
        timeLabel: '刚刚',
        createdAt: Number(id.slice(1))
      })
    }

    const result = repo.forkSession({
      sourceId: 's1',
      messageId: 'm2',
      id: 's2',
      title: '原会话 · 分叉'
    })
    expect(result?.session).toMatchObject({
      id: 's2',
      title: '原会话 · 分叉',
      workspace: 'C:\\work',
      status: 'idle'
    })
    expect(result?.session.resumeId).toBeUndefined()
    expect(result?.messages.map((message) => message.text)).toEqual(['一', '二'])
    expect(result?.messages[0]?.id).not.toBe('m1')
    expect(repo.listMessagesForSession('s1')).toHaveLength(3)
    expect(repo.listMessagesForSession('s2')).toHaveLength(2)
    expect(
      repo.forkSession({ sourceId: 's1', messageId: 'missing', id: 's3', title: 'x' })
    ).toBeNull()
    db.close()
  })

  it('启动时把残留的 run/wait 状态改回 idle', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '运行中' })
    repo.createSession({ id: 's2', agent: 'claude', title: '等待中' })
    repo.createSession({ id: 's3', agent: 'claude', title: '空闲' })
    repo.updateSession('s1', { status: 'run' })
    repo.updateSession('s2', { status: 'wait' })

    expect(repo.resetTransientStatuses()).toBe(2)
    expect(repo.listSessions().map((session) => session.status)).toEqual(['idle', 'idle', 'idle'])
    db.close()
  })
})

describe('AgentRepository · 搜索', () => {
  const message = (id: string, sessionId: string, text: string) => ({
    id,
    sessionId,
    role: 'user' as const,
    text,
    timeLabel: '10:00',
    createdAt: Date.now()
  })

  it('同搜标题与正文，标题命中标记 title', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '重构 auth 模块' })
    repo.createSession({ id: 's2', agent: 'claude', title: '会议记录' })
    repo.saveMessage(message('m1', 's1', '先看 auth 入口'))
    repo.saveMessage(message('m2', 's1', '再改 auth 中间件'))
    repo.saveMessage(message('m3', 's2', '今天没有关键词'))

    const hits = repo.searchSessions('auth')
    expect(hits.map((hit) => hit.session.id)).toEqual(['s1'])
    expect(hits[0]?.matchedIn).toBe('title')
    expect(hits[0]?.snippet).toContain('中间件')
    expect(hits[0]?.messageId).toBeNull()
    db.close()
  })

  it('正文命中标记 message 并返回片段', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '重构 auth 模块' })
    repo.saveMessage(message('m1', 's1', '  再改\n auth 中间件  '))

    const hits = repo.searchSessions('中间件')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.matchedIn).toBe('message')
    expect(hits[0]?.messageId).toBe('m1')
    expect(hits[0]?.snippet).toBe('再改 auth 中间件')
    db.close()
  })

  it('LIKE 通配符被转义，不会搜出所有会话', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '完成度 100%' })
    repo.createSession({ id: 's2', agent: 'claude', title: 'a_b 命名' })
    repo.createSession({ id: 's3', agent: 'claude', title: '普通会话' })

    expect(repo.searchSessions('%').map((hit) => hit.session.id)).toEqual(['s1'])
    expect(repo.searchSessions('_').map((hit) => hit.session.id)).toEqual(['s2'])
    db.close()
  })

  it('限制返回数量并优先最近更新', () => {
    const { db, repo } = seedDb()
    for (const id of ['s1', 's2', 's3']) {
      repo.createSession({ id, agent: 'claude', title: `项目 ${id}` })
    }
    const hits = repo.searchSessions('项目', 2)
    expect(hits).toHaveLength(2)
    db.close()
  })
})

describe('AgentRepository · 消息', () => {
  it('导入历史标记 origin 且重复导入幂等', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '导入会话' })
    repo.saveMessage({
      id: 'app-1',
      sessionId: 's1',
      role: 'user',
      text: '应用内新消息',
      timeLabel: '刚刚',
      createdAt: 300
    })
    const imported = [
      {
        id: 'import-claude-r1-1',
        sessionId: 's1',
        role: 'user' as const,
        text: '旧问题',
        timeLabel: '10-01 12:00',
        createdAt: 100,
        origin: 'import' as const
      },
      {
        id: 'import-claude-r1-2',
        sessionId: 's1',
        role: 'assistant' as const,
        text: '旧回答',
        timeLabel: '10-01 12:01',
        createdAt: 200,
        origin: 'import' as const,
        tools: [{ id: 't1', name: 'Read', meta: 'src/app.ts', status: '完成' }]
      }
    ]

    repo.importMessages('s1', imported)
    repo.importMessages('s1', [{ ...imported[1], text: '旧回答（更新）' }])

    const messages = repo.listMessagesForSession('s1')
    expect(messages.map((message) => message.id)).toEqual([
      'import-claude-r1-1',
      'import-claude-r1-2',
      'app-1'
    ])
    expect(messages[0]).toMatchObject({ origin: 'import', text: '旧问题' })
    expect(messages[1]).toMatchObject({ origin: 'import', text: '旧回答（更新）' })
    expect(messages[1].tools).toEqual([
      { id: 't1', name: 'Read', meta: 'src/app.ts', status: '完成' }
    ])
    expect(messages[2].origin).toBeUndefined()
    db.close()
  })

  it('按创建顺序读取，并往返工具卡 JSON', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '会话' })
    repo.saveMessage({
      id: 'u1',
      sessionId: 's1',
      role: 'user',
      text: '看一下今天的任务',
      timeLabel: '刚刚',
      createdAt: 100
    })
    repo.saveMessage({
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      text: '看完了。',
      timeLabel: '刚刚',
      createdAt: 200,
      tools: [{ id: 't1', name: 'tasks.read', meta: '6 项', status: '完成' }]
    })

    const messages = repo.listMessages()
    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1'])
    expect(messages[1].tools).toEqual([
      { id: 't1', name: 'tasks.read', meta: '6 项', status: '完成' }
    ])
    expect(messages[0].error).toBeUndefined()
    db.close()
  })

  it('同一 id 再次写入是更新而不是重复插入', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '会话' })
    repo.saveMessage({
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      text: '',
      timeLabel: '刚刚',
      createdAt: 200
    })
    repo.saveMessage({
      id: 'a1',
      sessionId: 's1',
      role: 'assistant',
      text: '最终回复',
      timeLabel: '刚刚',
      createdAt: 200,
      error: true
    })

    expect(repo.listMessages()).toHaveLength(1)
    expect(repo.listMessages()[0]).toMatchObject({ text: '最终回复', error: true })
    db.close()
  })

  it('会话不存在时写入消息触发外键错误', () => {
    const { db, repo } = seedDb()
    expect(() =>
      repo.saveMessage({
        id: 'u1',
        sessionId: 'missing',
        role: 'user',
        text: 'x',
        timeLabel: '刚刚',
        createdAt: 1
      })
    ).toThrow()
    db.close()
  })
})

describe('Agent 预设与用量', () => {
  it('保存、列出并删除工作区预设', () => {
    const { db, repo } = seedDb()
    const saved = repo.savePreset({ name: '周报', agent: 'claude', workspace: 'C:work' })
    expect(saved).toMatchObject({ name: '周报', agent: 'claude', workspace: 'C:work' })
    expect(repo.listPresets()).toHaveLength(1)
    repo.removePreset(saved.id)
    expect(repo.listPresets()).toEqual([])
    db.close()
  })

  it('记录运行开始与结束，并按起始时间查询', () => {
    const { db, repo } = seedDb()
    repo.recordRunStart('run-1', 's-1', 1000)
    repo.finishRun('run-1', {
      ok: true,
      cancelled: false,
      costUsd: 0.002,
      durationMs: 1200,
      turns: 2
    })
    repo.recordRunStart('run-2', 's-1', 2000)
    repo.finishRun('run-2', { ok: false, cancelled: true })

    const runs = repo.listRuns(0)
    expect(runs.map((run) => [run.id, run.ok, run.cancelled])).toEqual([
      ['run-2', false, true],
      ['run-1', true, false]
    ])
    expect(repo.listRuns(1500).map((run) => run.id)).toEqual(['run-2'])
    db.close()
  })
})
