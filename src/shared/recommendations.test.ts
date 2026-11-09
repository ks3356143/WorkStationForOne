import { describe, expect, it } from 'vitest'
import { CLI_RECOMMEND_CATEGORIES, RECOMMENDED_CLI_TOOLS } from './recommendations'

describe('CLI 推荐清单', () => {
  it('id 唯一、分类合法、必有仓库与用途', () => {
    const ids = RECOMMENDED_CLI_TOOLS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const tool of RECOMMENDED_CLI_TOOLS) {
      expect(CLI_RECOMMEND_CATEGORIES).toContain(tool.category)
      expect(tool.name.trim()).not.toBe('')
      expect(tool.summary.trim()).not.toBe('')
      expect(tool.why.trim()).not.toBe('')
      expect(tool.repo).toMatch(/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/)
      expect(tool.install.command).toMatch(/^winget install --id \S+ -e$/)
      expect(tool.detect.length).toBeGreaterThan(0)
      for (const name of tool.detect) expect(name).toMatch(/^[a-z0-9-]+$/)
    }
  })

  it('覆盖搜索 / 查看 / 文本 / 文件 / 系统 / 开发流六类', () => {
    for (const category of CLI_RECOMMEND_CATEGORIES) {
      expect(
        RECOMMENDED_CLI_TOOLS.some((tool) => tool.category === category),
        category
      ).toBe(true)
    }
  })
})
