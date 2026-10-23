import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { migrate, openDatabase, userVersion } from './database'
import { NoteRepository, planSearch } from './notes'
import type { NoteRecord } from '../../shared/ipc'

const dirs: string[] = []

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
  dirs.push(dir)
  return openDatabase(join(dir, 'workstation.db'))
}

function seedDb() {
  const db = tempDb()
  migrate(db)
  return { db, repo: new NoteRepository(db) }
}

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

const notes: NoteRecord[] = [
  {
    id: 'n1',
    text: '工作台不是聊天窗口，是把 agent 的产出沉淀成可检索的记忆。',
    time: '今天 13:58',
    tag: '产品思考',
    pinned: true
  },
  { id: 'n2', text: '线代 · 特征值三条性质', time: '12:20' },
  { id: 'n3', text: 'Codex 周报提示词 v2', time: '昨天' },
  { id: 'n4', text: '登录 500 的修复思路：session 过期分支未捕获异常', time: '周二' }
]

describe('迁移', () => {
  it('笔记迁移把库版本推进到 2 并建立 FTS 表', () => {
    const { db } = seedDb()
    expect(userVersion(db)).toBe(2)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger') AND name LIKE 'notes%'")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual(expect.arrayContaining(['notes', 'notes_fts', 'notes_fts_insert', 'notes_fts_update']))
    db.close()
  })
})

describe('NoteRepository 列表', () => {
  it('首次启动写入种子，置顶优先', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const page = repo.page(0, 10)
    expect(page.total).toBe(4)
    expect(page.items[0].id).toBe('n1')
    expect(page.items[0].pinned).toBe(true)
    db.close()
  })

  it('已有数据时不再写入种子', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    repo.bootstrap([{ id: 'x', text: '不应写入', time: '—' }])
    expect(repo.count()).toBe(4)
    db.close()
  })

  it('分页只返回请求的条数', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const first = repo.page(0, 2)
    const second = repo.page(2, 2)
    expect(first.items).toHaveLength(2)
    expect(second.items).toHaveLength(2)
    expect(first.total).toBe(4)
    expect(new Set([...first.items, ...second.items].map((note) => note.id)).size).toBe(4)
    db.close()
  })

  it('限制单页上限并修正负数偏移', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(repo.page(-5, 1000).items.length).toBeLessThanOrEqual(200)
    db.close()
  })
})

describe('NoteRepository 搜索', () => {
  it('三字及以上中文走 FTS 并能命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const hits = repo.search('特征值', 10)
    expect(hits.map((hit) => hit.id)).toEqual(['n2'])
    expect(hits[0].snippet).toContain('[特征值]')
    db.close()
  })

  it('两字中文回退 LIKE 仍能命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const hits = repo.search('登录', 10)
    expect(hits.map((hit) => hit.id)).toContain('n4')
    expect(hits[0].snippet).toContain('[登录]')
    db.close()
  })

  it('英文关键词可命中', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    expect(repo.search('agent', 10).map((hit) => hit.id)).toEqual(['n1'])
    db.close()
  })

  it('普通关键词不会被当成 FTS 语法', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    expect(() => repo.search('"(', 10)).not.toThrow()
    expect(() => repo.search('NOT AND OR', 10)).not.toThrow()
    expect(() => repo.search('*', 10)).not.toThrow()
    db.close()
  })

  it('LIKE 回退转义 % 与 _', () => {
    const { db, repo } = seedDb()
    repo.bootstrap([{ id: 'p1', text: '进度 100% 完成', time: '—' }])

    expect(repo.search('100%', 10)).toHaveLength(1)
    expect(repo.search('%', 10)).toHaveLength(1)
    db.close()
  })

  it('空查询返回空数组', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)
    expect(repo.search('   ', 10)).toEqual([])
    db.close()
  })
})

describe('NoteRepository 写入', () => {
  it('新建笔记后排在非置顶项之前并同步进 FTS 索引', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    const created = repo.create('新的检索测试笔记', '想法')
    expect(created.text).toBe('新的检索测试笔记')

    const page = repo.page(0, 10)
    expect(page.items[0].id).toBe('n1')
    expect(page.items[1].id).toBe(created.id)
    expect(repo.search('检索测试', 10).map((hit) => hit.id)).toContain(created.id)
    db.close()
  })

  it('切换置顶状态影响排序', () => {
    const { db, repo } = seedDb()
    repo.bootstrap(notes)

    repo.togglePin('n2')
    expect(repo.page(0, 1).items[0].id).toBe('n2')

    repo.togglePin('n2')
    expect(repo.page(0, 1).items[0].id).toBe('n1')
    db.close()
  })

  it('关闭后重开数据仍在', () => {
    const dir = mkdtempSync(join(tmpdir(), 'wsfo-notes-'))
    dirs.push(dir)
    const file = join(dir, 'workstation.db')

    const first = openDatabase(file)
    migrate(first)
    new NoteRepository(first).bootstrap(notes)
    first.close()

    const second = openDatabase(file)
    migrate(second)
    expect(new NoteRepository(second).count()).toBe(4)
    second.close()
  })
})

describe('planSearch', () => {
  it('三字以上使用 FTS 短语', () => {
    expect(planSearch('特征值')).toMatchObject({ mode: 'fts', value: '"特征值"' })
  })

  it('少于三字回退 LIKE', () => {
    expect(planSearch('登录')?.mode).toBe('like')
  })

  it('转义引号避免语法错误', () => {
    expect(planSearch('abc"def')).toMatchObject({ mode: 'fts', value: '"abc""def"' })
  })

  it('空白输入返回 null', () => {
    expect(planSearch('  ')).toBeNull()
  })
})
