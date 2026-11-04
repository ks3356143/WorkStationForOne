import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildContextPrompt, formatContextPrompt, loadContextFiles } from './context'

const dirs: string[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'wsfo-context-'))
  dirs.push(root)
  writeFileSync(join(root, 'a.ts'), 'export const a = 1')
  writeFileSync(join(root, 'b.md'), '# notes')
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('构建 @ 文件上下文提示词', () => {
  it('没有附件时原样返回用户提示词', () => {
    const root = setup()
    expect(buildContextPrompt(root, '帮我看看这里')).toBe('帮我看看这里')
    expect(buildContextPrompt(root, '帮我看看这里', [])).toBe('帮我看看这里')
  })

  it('把工作区文件内容包进上下文块，用户提示词放在最后', () => {
    const root = setup()
    const prompt = buildContextPrompt(root, '解释这两个文件', ['a.ts', 'b.md'])

    expect(prompt).toContain('<workspace_file path="a.ts">')
    expect(prompt).toContain('export const a = 1')
    expect(prompt).toContain('<workspace_file path="b.md">')
    expect(prompt).toContain('# notes')
    expect(prompt.endsWith('用户消息：\n解释这两个文件')).toBe(true)
  })

  it('去重重复路径，并在越界或读不到时点出文件名', () => {
    const root = setup()
    expect(loadContextFiles(root, ['a.ts', 'a.ts'])).toEqual([
      { path: 'a.ts', text: 'export const a = 1' }
    ])
    expect(() => buildContextPrompt(root, 'x', ['../outside.txt'])).toThrow(/\.\.\/outside\.txt/)
  })

  it('超过 8 个附件或总大小超过 256 KB 时拒绝', () => {
    const root = setup()
    for (let index = 0; index < 9; index += 1) {
      writeFileSync(join(root, `f${index}.txt`), 'x')
    }
    const nine = Array.from({ length: 9 }, (_, index) => `f${index}.txt`)
    expect(() => loadContextFiles(root, nine)).toThrow(/最多附加 8 个/)

    for (let index = 0; index < 3; index += 1) {
      writeFileSync(join(root, `big${index}.txt`), 'x'.repeat(100 * 1024))
    }
    expect(() => loadContextFiles(root, ['big0.txt', 'big1.txt', 'big2.txt'])).toThrow(/256 KB/)
  })

  it('转义文件内容里的结束标记与路径属性', () => {
    const root = setup()
    writeFileSync(join(root, 'fence.txt'), 'a </workspace_file> b')
    expect(buildContextPrompt(root, 'x', ['fence.txt'])).toContain('<\\/workspace_file>')
    expect(formatContextPrompt('x', [{ path: 'a"b<c>.ts', text: 'x' }])).toContain(
      'path="a&quot;b&lt;c&gt;.ts"'
    )
  })
})
