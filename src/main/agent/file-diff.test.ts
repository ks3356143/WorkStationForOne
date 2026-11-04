import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildClaudeFileDiffs, buildCodexFileDiffs } from './file-diff'

const roots: string[] = []

function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'wsfo-diff-'))
  roots.push(root)
  return root
}

function write(root: string, path: string, content: string): void {
  const target = join(root, path)
  mkdirSync(join(target, '..'), { recursive: true })
  writeFileSync(target, content, 'utf8')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('buildClaudeFileDiffs', () => {
  it('Write 新文件按新增展示', () => {
    const root = workspace()
    const diff = buildClaudeFileDiffs(
      'Write',
      { file_path: 'src/new.ts', content: 'export const a = 1\n' },
      root
    )?.[0]

    expect(diff).toMatchObject({
      path: 'src/new.ts',
      oldText: '',
      newText: 'export const a = 1\n',
      kind: 'add'
    })
  })

  it('Write 现有文件给出改前改后', () => {
    const root = workspace()
    write(root, 'src/a.ts', 'const a = 1\n')
    const diff = buildClaudeFileDiffs(
      'Write',
      { file_path: 'src/a.ts', content: 'const a = 2\n' },
      root
    )?.[0]

    expect(diff).toMatchObject({
      path: 'src/a.ts',
      oldText: 'const a = 1\n',
      newText: 'const a = 2\n',
      kind: 'update'
    })
  })

  it('Edit 在完整文件上应用替换', () => {
    const root = workspace()
    write(root, 'src/b.ts', 'const a = 1\nconst b = 2\n')
    const diff = buildClaudeFileDiffs(
      'Edit',
      { file_path: 'src/b.ts', old_string: 'const b = 2', new_string: 'const b = 3' },
      root
    )?.[0]

    expect(diff?.oldText).toBe('const a = 1\nconst b = 2\n')
    expect(diff?.newText).toBe('const a = 1\nconst b = 3\n')
  })

  it('只读工作区内的文件，工作区外退回 old/new 文本', () => {
    const root = workspace()
    const outside = join(root, '..', `outside-${Date.now()}.txt`)
    writeFileSync(outside, 'secret\nline two\n', 'utf8')
    try {
      const diff = buildClaudeFileDiffs(
        'Edit',
        { file_path: outside, old_string: 'secret', new_string: 'public' },
        root
      )?.[0]
      expect(diff).toMatchObject({ oldText: 'secret', newText: 'public' })
    } finally {
      rmSync(outside, { force: true })
    }
  })

  it('大文件 Edit 只取目标附近片段并标记 partial', () => {
    const root = workspace()
    const lines = Array.from({ length: 1000 }, (_, index) =>
      index === 900 ? 'const target = 1' : `const value${index} = ${index}`
    )
    write(root, 'src/large.ts', lines.join('\n'))
    const diff = buildClaudeFileDiffs(
      'Edit',
      { file_path: 'src/large.ts', old_string: 'const target = 1', new_string: 'const target = 2' },
      root
    )?.[0]

    expect(diff?.partial).toBe(true)
    expect(diff?.oldText).toContain('const target = 1')
    expect(diff?.oldText).not.toContain('const value0 = 0')
    expect((diff?.oldText.split('\n').length ?? 0) < 300).toBe(true)
  })

  it('超大内容按上限截断并标记', () => {
    const root = workspace()
    const diff = buildClaudeFileDiffs(
      'Write',
      { file_path: 'src/huge.ts', content: 'x'.repeat(30_000) },
      root
    )?.[0]

    expect(diff?.truncated).toBe(true)
    expect(diff?.newText.length).toBeLessThanOrEqual(24_000)
  })
})

describe('buildCodexFileDiffs', () => {
  it('把统一 diff 还原成两侧文本', () => {
    const diffs = buildCodexFileDiffs([
      {
        path: 'src/a.ts',
        kind: { type: 'update' },
        diff: '@@ -1,3 +1,3 @@\n a\n-b\n+B\n c\n'
      }
    ])

    expect(diffs?.[0]).toMatchObject({
      path: 'src/a.ts',
      oldText: 'a\nb\nc',
      newText: 'a\nB\nc',
      kind: 'update',
      partial: true
    })
  })

  it('兼容只有 +/- 行标记的补丁片段', () => {
    const diffs = buildCodexFileDiffs([
      { path: 'note.txt', kind: { type: 'add' }, diff: '+hello\n+world' }
    ])

    expect(diffs?.[0]).toMatchObject({
      path: 'note.txt',
      oldText: '',
      newText: 'hello\nworld',
      kind: 'add'
    })
  })

  it('新增文件与空 diff 的处理', () => {
    const diffs = buildCodexFileDiffs([
      { path: 'new.ts', kind: { type: 'add' }, diff: '@@ -0,0 +1,2 @@\n+hello\n+world\n' },
      { path: 'empty.ts', kind: { type: 'update' }, diff: '' }
    ])

    expect(diffs).toHaveLength(1)
    expect(diffs?.[0]).toMatchObject({
      path: 'new.ts',
      oldText: '',
      newText: 'hello\nworld',
      kind: 'add'
    })
  })

  it('最多返回 6 个文件', () => {
    const changes = Array.from({ length: 8 }, (_, index) => ({
      path: `src/${index}.ts`,
      kind: { type: 'update' },
      diff: `@@ -1 +1 @@\n-old${index}\n+new${index}\n`
    }))
    expect(buildCodexFileDiffs(changes)).toHaveLength(6)
  })
})
