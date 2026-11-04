import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  captureFiles,
  filePathsFromInput,
  restoreFiles,
  toCheckpointView,
  type FileSnapshot
} from './checkpoints'

const dirs: string[] = []

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-checkpoint-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('文件检查点', () => {
  it('保存原内容并恢复修改', () => {
    const root = workspace()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 1')
    writeFileSync(join(root, 'src', 'b.ts'), 'const b = 2')

    const snapshots = captureFiles(root, ['src/a.ts', 'src/b.ts'])
    writeFileSync(join(root, 'src', 'a.ts'), 'const a = 99')

    expect(restoreFiles(root, snapshots)).toEqual({ restored: 2, removed: 0, failed: [] })
    expect(readFileSync(join(root, 'src', 'a.ts'), 'utf8')).toBe('const a = 1')
    expect(readFileSync(join(root, 'src', 'b.ts'), 'utf8')).toBe('const b = 2')
  })

  it('原本不存在的文件在回退时删除', () => {
    const root = workspace()
    const snapshots = captureFiles(root, ['new.ts'])
    expect(snapshots[0]).toMatchObject({ path: 'new.ts', existed: false })

    writeFileSync(join(root, 'new.ts'), '临时文件')
    expect(restoreFiles(root, snapshots)).toEqual({ restored: 0, removed: 1, failed: [] })
    expect(() => readFileSync(join(root, 'new.ts'))).toThrow()
  })

  it('去重并拒绝越界路径', () => {
    const root = workspace()
    writeFileSync(join(root, 'a.ts'), 'a')
    const snapshots = captureFiles(root, ['a.ts', './a.ts', '../outside.ts', 'C:/Windows/win.ini'])
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.path).toBe('a.ts')
  })

  it('超大文件标记截断且拒绝回退', () => {
    const root = workspace()
    writeFileSync(join(root, 'big.bin'), Buffer.alloc(600 * 1024))
    const snapshots = captureFiles(root, ['big.bin'])
    expect(snapshots[0]).toMatchObject({ existed: true, truncated: true, content: null })

    const result = restoreFiles(root, snapshots)
    expect(result.failed).toEqual(['big.bin'])
  })

  it('从工具输入提取文件路径', () => {
    expect(filePathsFromInput({ file_path: 'src/a.ts' })).toEqual(['src/a.ts'])
    expect(filePathsFromInput({ path: 'docs/b.md', edits: [{ file_path: 'c.ts' }] })).toEqual([
      'docs/b.md',
      'c.ts'
    ])
    expect(filePathsFromInput({ file_path: 'src/a.ts', notebook_path: 'src/a.ts' })).toEqual([
      'src/a.ts'
    ])
    expect(filePathsFromInput({ command: 'Set-Content a.txt' })).toEqual([])
    expect(filePathsFromInput(null)).toEqual([])
  })

  it('列表视图只保留路径，不把文件正文发给渲染层', () => {
    const view = toCheckpointView({
      id: 'c1',
      sessionId: 's1',
      runId: 'run-1',
      summary: 'Write',
      createdAt: 1,
      files: [{ path: 'src/a.ts', existed: true, content: 'SECRET-CONTENT' }]
    })
    expect(view.files).toEqual([{ path: 'src/a.ts', existed: true }])
    expect(JSON.stringify(view)).not.toContain('SECRET-CONTENT')
  })

  it('重复回退保持幂等', () => {
    const root = workspace()
    writeFileSync(join(root, 'a.ts'), '原内容')
    const snapshots: FileSnapshot[] = captureFiles(root, ['a.ts'])
    writeFileSync(join(root, 'a.ts'), '改过')
    restoreFiles(root, snapshots)
    expect(restoreFiles(root, snapshots)).toEqual({ restored: 1, removed: 0, failed: [] })
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('原内容')
  })
})
