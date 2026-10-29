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
    expect(tables).toEqual(['agent_messages', 'agent_sessions'])
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

  it('更新标题、状态与 Claude resume id', () => {
    const { db, repo } = seedDb()
    repo.createSession({ id: 's1', agent: 'claude', title: '新会话' })

    const updated = repo.updateSession('s1', {
      title: '重构 auth 模块',
      status: 'run',
      resumeId: 'cli-session-1'
    })

    expect(updated).toMatchObject({
      title: '重构 auth 模块',
      status: 'run',
      resumeId: 'cli-session-1'
    })
    expect(repo.updateSession('missing', { title: 'x' })).toBeUndefined()
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

describe('AgentRepository · 消息', () => {
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
