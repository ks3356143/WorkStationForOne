import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { CheckpointAccumulator } from './checkpoint-accumulator'

const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-accumulator-'))
  dirs.push(dir)
  return dir
}

describe('回合检查点累积', () => {
  it('同一路径只保留写入前内容', () => {
    const root = workspace()
    mkdirSync(join(root, 'src'))
    writeFileSync(join(root, 'src', 'a.ts'), 'v1')
    const acc = new CheckpointAccumulator(root)

    acc.capture(['src/a.ts'], 'Edit')
    writeFileSync(join(root, 'src', 'a.ts'), 'v2')
    acc.capture(['src/a.ts'], 'Edit')

    expect(acc.size).toBe(1)
    expect(acc.summary()).toBe('Edit')
    expect(acc.take()).toEqual([{ path: 'src/a.ts', existed: true, content: 'v1' }])
    expect(acc.size).toBe(0)
  })

  it('没有工具名时给出通用摘要，空路径忽略', () => {
    const root = workspace()
    const acc = new CheckpointAccumulator(root)
    acc.capture([], 'Write')
    expect(acc.size).toBe(0)
    expect(acc.summary()).toBe('文件改动')
    expect(acc.take()).toEqual([])
  })
})
