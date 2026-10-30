import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listWorkspaceEntries, readWorkspaceText } from './workspace'

const dirs: string[] = []

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'wsfo-workspace-'))
  dirs.push(root)
  mkdirSync(join(root, 'src'))
  writeFileSync(join(root, 'src', 'main.ts'), 'console.log(1)')
  writeFileSync(join(root, 'notes.txt'), 'hello workspace')
  writeFileSync(join(root, 'binary.bin'), Buffer.from([0, 1, 2]))
  mkdirSync(join(root, 'node_modules'))
  writeFileSync(join(root, 'node_modules', 'ignored.js'), 'x')
  return root
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  }
})

describe('工作区只读浏览', () => {
  it('列出目录优先的文件树并跳过依赖目录', () => {
    const root = setup()
    const entries = listWorkspaceEntries(root)
    expect(entries.map((entry) => entry.path)).toEqual([
      'src',
      'src/main.ts',
      'binary.bin',
      'notes.txt'
    ])
    expect(entries.find((entry) => entry.path === 'src')?.type).toBe('dir')
    expect(entries.find((entry) => entry.path === 'notes.txt')?.size).toBe(15)
  })

  it('读取工作区文本并拒绝越界、二进制与过大文件', () => {
    const root = setup()
    expect(readWorkspaceText(root, 'src/main.ts').text).toBe('console.log(1)')
    expect(() => readWorkspaceText(root, '../outside.txt')).toThrow(/无效/)
    expect(() => readWorkspaceText(root, 'binary.bin')).toThrow(/二进制/)
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(129 * 1024))
    expect(() => readWorkspaceText(root, 'big.txt')).toThrow(/128 KB/)
  })
})
