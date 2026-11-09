import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { pathCandidates, scanRecommended } from './recommend'

const dirs: string[] = []
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wsfo-recommend-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('PATH 可执行文件扫描', () => {
  it('按 PATH 目录与扩展名生成候选，跳过空段', () => {
    const candidates = pathCandidates('rg', 'C:\\a;;C:\\b\\')
    expect(candidates).toEqual([
      'C:\\a\\rg.exe',
      'C:\\a\\rg.cmd',
      'C:\\a\\rg.bat',
      'C:\\a\\rg.com',
      'C:\\b\\rg.exe',
      'C:\\b\\rg.cmd',
      'C:\\b\\rg.bat',
      'C:\\b\\rg.com'
    ])
  })

  it('命中任意候选即视为已安装', () => {
    const first = tempDir()
    const second = tempDir()
    writeFileSync(join(first, 'rg.exe'), '')
    writeFileSync(join(second, 'fd.cmd'), '')
    const found = scanRecommended(`${first};${second}`)
    expect(found.ripgrep).toBe(true)
    expect(found.fd).toBe(true)
    expect(found.bat).toBe(false)
    expect(found['ast-grep']).toBe(false)
  })

  it('多个可执行名共用一个工具，任一命中即可', () => {
    const dir = tempDir()
    writeFileSync(join(dir, 'ast-grep.exe'), '')
    expect(scanRecommended(dir)['ast-grep']).toBe(true)
  })
})
