import { describe, expect, it } from 'vitest'
import {
  CLI_RECOMMEND_CATEGORIES,
  MCP_RECOMMENDATIONS,
  RECOMMENDED_CLI_TOOLS,
  SKILL_SOURCE_RECOMMENDATIONS
} from './recommendations'

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

  it('覆盖搜索 / 查看 / 文本 / 文件 / 系统 / 开发流 / 环境依赖七类', () => {
    for (const category of CLI_RECOMMEND_CATEGORIES) {
      expect(
        RECOMMENDED_CLI_TOOLS.some((tool) => tool.category === category),
        category
      ).toBe(true)
    }
  })

  it('环境依赖条目带运行时元数据且同包只占一行', () => {
    const runtimes = RECOMMENDED_CLI_TOOLS.filter((tool) => tool.category === 'runtime')
    expect(runtimes.map((tool) => tool.id)).toEqual(['uv', 'bun', 'node'])
    for (const tool of runtimes) {
      expect(tool.runtime).toBeDefined()
      expect(tool.runtime?.binaries.length).toBeGreaterThan(0)
      expect(tool.runtime?.releaseApi).toMatch(
        /^https:\/\/(api\.github\.com|github\.com|nodejs\.org)\//
      )
      expect(tool.runtime?.assetUrl('1.2.3')).toMatch(
        /^https:\/\/github\.com\/|^https:\/\/nodejs\.org\/|^https:\/\/registry\.npmmirror\.com\//
      )
      expect(tool.detect).toContain(tool.id === 'uv' ? 'uvx' : tool.id === 'bun' ? 'bunx' : 'npx')
      if (tool.id !== 'node') expect(tool.runtime?.fallbackVersion).toBeTruthy()
      expect(tool.runtime?.mirrorAsset).toBeDefined()
    }
  })

  it('MCP 推荐端点为实测过的 https 地址且鉴权方式明确', () => {
    expect(MCP_RECOMMENDATIONS.map((entry) => entry.id)).toEqual(['deepwiki', 'context7', 'notion'])
    for (const entry of MCP_RECOMMENDATIONS) {
      expect(entry.url).toMatch(/^https:\/\/mcp\./)
      expect(['none', 'headers', 'oauth']).toContain(entry.auth)
      expect(entry.authNote.trim()).not.toBe('')
      expect(entry.summary.trim()).not.toBe('')
      expect(entry.why.trim()).not.toBe('')
      expect(entry.docs).toMatch(/^https:\/\//)
    }
  })

  it('技能库推荐指向标准插件市场仓库并带亮点技能', () => {
    expect(SKILL_SOURCE_RECOMMENDATIONS).toHaveLength(1)
    const source = SKILL_SOURCE_RECOMMENDATIONS[0]
    expect(source.url).toBe('https://github.com/anthropics/skills')
    expect(source.highlights.length).toBeGreaterThan(2)
    expect(source.why.trim()).not.toBe('')
  })
})
