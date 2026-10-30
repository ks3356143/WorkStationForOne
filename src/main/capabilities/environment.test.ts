import { describe, expect, it } from 'vitest'
import { checkEnvironment } from './environment'

describe('能力中心环境自检', () => {
  it('至少能识别当前 Node，并保留缺失项而不是抛错', async () => {
    const list = await checkEnvironment(true)
    expect(list.map((item) => item.id)).toEqual(['node', 'npx', 'uvx', 'git', 'claude', 'codex'])
    expect(list.find((item) => item.id === 'node')?.available).toBe(true)
    expect(list.every((item) => typeof item.version === 'string')).toBe(true)
  }, 15_000)
})
