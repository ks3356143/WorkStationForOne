import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { discoverLocalSessions } from './discover'

const roots: string[] = []

function tempRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-discover-'))
  roots.push(dir)
  return dir
}

function makeDir(base: string, ...parts: string[]): string {
  const dir = join(base, ...parts)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeJsonl(file: string, lines: unknown[]): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf8')
}

afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('本机会话扫描', () => {
  it('读取 Claude 会话：摘要优先、跳过元信息、标记已导入', () => {
    const base = tempRoot()
    const work = makeDir(base, 'proj')
    const projects = makeDir(base, '.claude', 'projects', '-encoded-proj')
    const id = '11111111-2222-3333-4444-555555555555'
    writeJsonl(join(projects, `${id}.jsonl`), [
      {
        type: 'user',
        cwd: work,
        isMeta: true,
        message: { content: '<local-command-caveat>命令</local-command-caveat>' }
      },
      {
        type: 'user',
        cwd: work,
        message: {
          content: [
            {
              type: 'text',
              text: '<system-reminder>上下文</system-reminder>把导入按钮接到舰队'
            }
          ]
        }
      },
      { type: 'summary', summary: '接通本机会话导入' }
    ])

    const [item] = discoverLocalSessions(base, new Set([`claude:${id}`]))
    expect(item).toMatchObject({
      agent: 'claude',
      resumeId: id,
      title: '接通本机会话导入',
      workspace: work,
      workspaceExists: true,
      imported: true
    })
  })

  it('没有摘要时用第一条真实用户消息，并剥掉系统提醒', () => {
    const base = tempRoot()
    const work = makeDir(base, 'proj')
    const projects = makeDir(base, '.claude', 'projects', 'x')
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    writeJsonl(join(projects, `${id}.jsonl`), [
      {
        type: 'user',
        cwd: work,
        message: { content: '<system-reminder>上下文</system-reminder>检查工作区文件' }
      }
    ])

    const [item] = discoverLocalSessions(base, new Set())
    expect(item.title).toBe('检查工作区文件')
    expect(item.imported).toBe(false)
  })

  it('读取 Codex rollout：取 session_meta 与首条用户消息', () => {
    const base = tempRoot()
    const work = makeDir(base, 'proj')
    const day = makeDir(base, '.codex', 'sessions', '2026', '10', '30')
    writeJsonl(join(day, 'rollout-1.jsonl'), [
      { type: 'session_meta', payload: { session_id: 'codex-1', cwd: work } },
      {
        type: 'response_item',
        payload: {
          role: 'user',
          content: [{ type: 'input_text', text: '<environment_context>cwd</environment_context>' }]
        }
      },
      {
        type: 'response_item',
        payload: { role: 'user', content: [{ type: 'input_text', text: '跑一遍冒烟' }] }
      }
    ])

    const [item] = discoverLocalSessions(base, new Set(['codex:codex-1']))
    expect(item).toMatchObject({
      agent: 'codex',
      resumeId: 'codex-1',
      title: '跑一遍冒烟',
      workspace: work,
      workspaceExists: true,
      imported: true
    })
  })

  it('目录不存在的会话仍返回，但标记工作区不可用', () => {
    const base = tempRoot()
    const missing = join(base, 'not-there')
    const projects = makeDir(base, '.claude', 'projects', 'x')
    writeJsonl(join(projects, 'dead-beef.jsonl'), [
      { type: 'user', cwd: missing, message: { content: '旧会话' } }
    ])

    const [item] = discoverLocalSessions(base, new Set())
    expect(item.workspaceExists).toBe(false)
  })

  it('同一 resumeId 只保留一条，缺少 id 的文件被忽略', () => {
    const base = tempRoot()
    const work = makeDir(base, 'proj')
    const first = makeDir(base, '.claude', 'projects', 'a')
    const second = makeDir(base, '.claude', 'projects', 'b')
    const line = { type: 'user', cwd: work, message: { content: '重复会话' } }
    writeJsonl(join(first, 'dup-1.jsonl'), [line])
    writeJsonl(join(second, 'dup-1.jsonl'), [line])
    writeJsonl(join(first, 'bad id!.jsonl'), [line])
    writeJsonl(join(first, 'no-workspace.jsonl'), [{ type: 'user', message: { content: 'x' } }])

    const list = discoverLocalSessions(base, new Set())
    expect(list.filter((item) => item.resumeId === 'dup-1')).toHaveLength(1)
    expect(list).toHaveLength(1)
  })

  it('根目录不存在时返回空列表', () => {
    const base = join(tempRoot(), 'empty')
    expect(discoverLocalSessions(base, new Set())).toEqual([])
  })
})
