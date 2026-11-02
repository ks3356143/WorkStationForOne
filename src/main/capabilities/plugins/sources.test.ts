import { describe, expect, it } from 'vitest'
import {
  assertSourceName,
  parseMarketplace,
  resolvePluginSource,
  sourceSlug,
  validateSourceUrl
} from './sources'

describe('validateSourceUrl', () => {
  it('接受 owner/repo、HTTPS、SSH 与本地绝对路径', () => {
    expect(validateSourceUrl('owner/repo')).toBe('')
    expect(validateSourceUrl('https://github.com/a/b')).toBe('')
    expect(validateSourceUrl('git@github.com:a/b.git')).toBe('')
    expect(validateSourceUrl('ssh://git@host/a/b')).toBe('')
    expect(validateSourceUrl('D:\\plugins')).toBe('')
  })

  it('拒绝空值、相对路径与带选项的注入', () => {
    expect(validateSourceUrl('')).toContain('不能为空')
    expect(validateSourceUrl('./local')).toContain('绝对路径')
    expect(validateSourceUrl('https://x/y --upload-pack=evil')).toContain('非法字符')
    expect(validateSourceUrl('owner/repo; rm -rf /')).toContain('非法字符')
  })
})

describe('assertSourceName', () => {
  it('限制长度与字符', () => {
    expect(assertSourceName('community')).toBe('community')
    expect(() => assertSourceName('')).toThrow(/不能为空/)
    expect(() => assertSourceName('a'.repeat(61))).toThrow(/过长/)
    expect(() => assertSourceName('bad name!')).toThrow(/字符/)
  })
})

describe('sourceSlug', () => {
  it('生成文件名安全的 slug 并处理保留名', () => {
    expect(sourceSlug('My Market')).toBe('my-market')
    expect(sourceSlug('wsfo-official')).toBe('wsfo-official-local')
    expect(sourceSlug('中文名')).toBe('source')
  })
})

describe('parseMarketplace', () => {
  it('解析标准清单，读取插件名、来源与描述', () => {
    const parsed = parseMarketplace(
      JSON.stringify({
        name: 'community',
        owner: { name: 'me' },
        plugins: [
          { name: 'demo', source: './plugins/demo', description: 'Demo' },
          { name: 'plain' }
        ]
      })
    )
    expect(parsed.name).toBe('community')
    expect(parsed.plugins).toEqual([
      { name: 'demo', source: './plugins/demo', description: 'Demo' },
      { name: 'plain', source: '', description: '' }
    ])
  })

  it('拒绝缺 name、非法 JSON 与越界 source', () => {
    expect(() => parseMarketplace('{')).toThrow(/JSON/)
    expect(() => parseMarketplace(JSON.stringify({ plugins: [] }))).toThrow(/name/)
    expect(() =>
      parseMarketplace(
        JSON.stringify({ name: 'x', plugins: [{ name: 'bad', source: '../../../etc' }] })
      )
    ).toThrow(/仓库外/)
  })

  it('没有 plugins 数组时返回空列表', () => {
    expect(parseMarketplace(JSON.stringify({ name: 'x' })).plugins).toEqual([])
  })
})

describe('resolvePluginSource', () => {
  it('把相对 source 解析到源根目录内', () => {
    expect(resolvePluginSource('D:\\src', './plugins/demo')).toBe('D:\\src\\plugins\\demo')
  })

  it('拒绝越界路径', () => {
    expect(() => resolvePluginSource('D:\\src', '../outside')).toThrow(/仓库外/)
  })
})
