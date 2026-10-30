import { describe, expect, it } from 'vitest'
import type { ExternalMcpServerRecord, SkillMarketEntry } from '../../../shared/ipc'
import {
  filterMarket,
  formatCount,
  installedCatalogIds,
  keyPlaceholders,
  marketLabel,
  mcpTarget,
  parseKeyValueLines,
  sortMarket
} from './capabilities'

const entry = (
  pluginId: string,
  name: string,
  marketplace = 'claude-plugins-official',
  installCount = 0
): SkillMarketEntry => ({
  pluginId,
  name,
  description: `${name} description`,
  marketplace,
  source: './x',
  installed: false,
  installCount
})

const server = (over: Partial<ExternalMcpServerRecord>): ExternalMcpServerRecord => ({
  id: 'mcp-1',
  key: 'memory',
  name: 'Memory',
  description: '',
  transport: 'stdio',
  command: 'npx',
  args: ['-y', 'pkg'],
  url: '',
  envKeys: [],
  headerKeys: [],
  source: 'catalog',
  catalogId: 'memory',
  version: '',
  enabled: false,
  trusted: false,
  toolNames: [],
  tools: [],
  lastTestAt: null,
  lastError: '',
  createdAt: 0,
  updatedAt: 0,
  ...over
})

describe('能力中心表单工具', () => {
  it('解析 KEY=VALUE，跳过注释、空行与空值', () => {
    expect(
      parseKeyValueLines(`
        # 注释
        TOKEN=abc=def
        EMPTY=
        NO_EQUALS
        SPACE = value
      `)
    ).toEqual({ TOKEN: 'abc=def', SPACE: 'value' })
  })

  it('编辑时只显示已保存的 key', () => {
    expect(keyPlaceholders(['A', 'B'])).toBe('A=\nB=')
    expect(keyPlaceholders([])).toBe('')
  })

  it('市场搜索匹配名称、描述与市场名', () => {
    const list = [entry('a@m', 'PDF Tools'), entry('b@m', 'Demo', 'other-market')]
    expect(filterMarket(list, 'pdf')).toHaveLength(1)
    expect(filterMarket(list, 'other')).toHaveLength(1)
    expect(filterMarket(list, '  ')).toHaveLength(2)
  })

  it('内置目录已安装去重，stdio / http 目标可读', () => {
    expect(
      installedCatalogIds([
        server({ id: '1' }),
        server({ id: '2', catalogId: 'fetch' }),
        server({ id: '3', catalogId: '' })
      ])
    ).toEqual(new Set(['memory', 'fetch']))
    expect(mcpTarget(server({}))).toBe('npx -y pkg')
    expect(mcpTarget(server({ transport: 'http', url: 'https://x/mcp' }))).toBe('https://x/mcp')
  })

  it('应用镜像名显示为 Claude 官方', () => {
    expect(marketLabel('wsfo-official')).toBe('Claude 官方')
    expect(marketLabel('claude-plugins-official')).toBe('Claude 官方')
    expect(marketLabel('local')).toBe('本地')
    expect(marketLabel('other')).toBe('other')
  })

  it('市场可按热度或名称排序，安装量可读', () => {
    const list = [entry('b', 'Beta', 'official', 10), entry('a', 'Alpha', 'official', 90)]
    expect(sortMarket(list, 'popular').map((item) => item.name)).toEqual(['Alpha', 'Beta'])
    expect(sortMarket(list, 'name').map((item) => item.name)).toEqual(['Alpha', 'Beta'])
    expect(formatCount(12800)).toBe('12.8k')
    expect(formatCount(42)).toBe('42')
  })
})
