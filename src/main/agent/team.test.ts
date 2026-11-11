import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AgentRepository } from '../db/agent'
import { migrate, openDatabase, userVersion } from '../db/database'
import { TeamService } from './team'

const dirs: string[] = []
function seed() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-team-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  migrate(db)
  let n = 0
  const svc = new TeamService(new AgentRepository(db), () => `s-${++n}`)
  return { db, svc }
}
afterEach(() => {
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('TeamService', () => {
  it('迁移 v52 建黑板表', () => {
    const { db } = seed()
    expect(userVersion(db)).toBe(52)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_team_notes'")
      .all()
    expect(tables.length).toBe(1)
    db.close()
  })

  it('建团队：负责人 + worker 共享 teamId、工作区与人设', () => {
    const { db, svc } = seed()
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-ws-'))
    dirs.push(dir)
    const team = svc.create({
      name: '前端小队',
      workspace: dir,
      workers: [{ title: '前端专家 worker', persona: '你是前端专家' }, { title: '测试 worker' }]
    })
    expect(team.sessions.length).toBe(3)
    expect(new Set(team.sessions.map((s) => s.teamId))).toEqual(new Set([team.teamId]))
    expect(team.sessions.every((s) => s.workspace === dir)).toBe(true)
    expect(team.sessions.find((s) => s.title === '前端专家 worker')?.persona).toBe('你是前端专家')
    const listed = svc.list()
    expect(listed.length).toBe(1)
    expect(listed[0].sessions.length).toBe(3)
    db.close()
  })

  it('黑板写入与按时间读回', () => {
    const { db, svc } = seed()
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-ws-'))
    dirs.push(dir)
    const team = svc.create({ name: 't', workspace: dir, workers: [{ title: 'w' }] })
    const leader = team.sessions[0]
    svc.post(team.teamId, leader.id, 'user', '第一条')
    svc.post(team.teamId, team.sessions[1].id, 'assistant', '第二条')
    const notes = svc.notes(team.teamId)
    expect(notes.map((n) => n.text)).toEqual(['第一条', '第二条'])
    expect(notes[1].role).toBe('assistant')
    db.close()
  })
})
