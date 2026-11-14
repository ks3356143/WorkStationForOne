import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase } from './database'
import { PromptTemplateRepository } from './prompt-templates'

const dirs: string[] = []
const dbs: DatabaseSync[] = []
function seed(): PromptTemplateRepository {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-prompt-'))
  dirs.push(dir)
  const db = openDatabase(join(dir, 'workstation.db'))
  dbs.push(db)
  migrate(db)
  return new PromptTemplateRepository(db)
}

afterEach(() => {
  while (dbs.length) dbs.pop()!.close()
  while (dirs.length)
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

describe('PromptTemplateRepository', () => {
  it('新建并列出（按更新时间倒序）', () => {
    const repo = seed()
    const a = repo.save({ name: '审查', body: '审查 {file}' })
    const b = repo.save({ name: '总结', body: '总结正文' })
    expect(a.id).toBeTruthy()
    const list = repo.list()
    expect(list.map((t) => t.id)).toEqual([b.id, a.id])
    expect(list[1].body).toBe('审查 {file}')
  })

  it('带 id 更新已有模板', () => {
    const repo = seed()
    const a = repo.save({ name: '审查', body: '旧正文' })
    const updated = repo.save({ id: a.id, name: '审查改', body: '新正文' })
    expect(updated.id).toBe(a.id)
    expect(updated.name).toBe('审查改')
    expect(repo.list().length).toBe(1)
    expect(repo.find(a.id)?.body).toBe('新正文')
  })

  it('空名称 / 空正文拒绝', () => {
    const repo = seed()
    expect(() => repo.save({ name: '  ', body: 'x' })).toThrow()
    expect(() => repo.save({ name: 'x', body: '  ' })).toThrow()
  })

  it('名称与正文夹住上限', () => {
    const repo = seed()
    const t = repo.save({ name: 'n'.repeat(120), body: 'b'.repeat(25_000) })
    expect(t.name.length).toBe(80)
    expect(t.body.length).toBe(20_000)
  })

  it('remove 删除并返回是否命中', () => {
    const repo = seed()
    const a = repo.save({ name: '审查', body: 'x' })
    expect(repo.remove(a.id)).toBe(true)
    expect(repo.remove(a.id)).toBe(false)
    expect(repo.list().length).toBe(0)
  })
})
