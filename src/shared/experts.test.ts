import { describe, expect, it } from 'vitest'
import { BUILTIN_EXPERTS, resolveExpertTools } from './experts'
import { parseExpertMarkdown, serializeExpertMarkdown } from './expert-format'

describe('BUILTIN_EXPERTS', () => {
  it('内置四个且 id 唯一、人设非空', () => {
    expect(BUILTIN_EXPERTS).toHaveLength(4)
    const ids = BUILTIN_EXPERTS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of BUILTIN_EXPERTS) {
      expect(e.persona.trim()).not.toBe('')
      expect(e.builtin).toBe(true)
    }
  })

  it('内置专家可序列化为合法子代理 markdown', () => {
    for (const e of BUILTIN_EXPERTS) {
      const parsed = parseExpertMarkdown(serializeExpertMarkdown(e))
      expect(parsed?.name).toBe(e.id)
      expect(parsed?.persona).toBe(e.persona)
    }
  })

  it('工具键只含 mcp:/skill: 前缀', () => {
    for (const e of BUILTIN_EXPERTS) {
      for (const key of e.tools) {
        expect(key.startsWith('mcp:') || key.startsWith('skill:')).toBe(true)
      }
    }
  })
})

describe('resolveExpertTools', () => {
  it('已装的进 apply，未装的进 missing', () => {
    const { apply, missing } = resolveExpertTools(
      ['mcp:context7', 'mcp:deepwiki', 'skill:document-skills', 'skill:agent-desktop'],
      ['context7'],
      ['document-skills']
    )
    expect(apply.map((a) => a.key)).toEqual(['mcp:context7', 'skill:document-skills'])
    expect(missing).toEqual(['mcp:deepwiki', 'skill:agent-desktop'])
  })

  it('去重且忽略非法前缀', () => {
    const { apply, missing } = resolveExpertTools(
      ['mcp:context7', 'mcp:context7', 'native:Read', 'bogus'],
      ['context7'],
      []
    )
    expect(apply).toHaveLength(1)
    expect(missing).toEqual([])
  })

  it('kind 与 id 正确拆分', () => {
    const { apply } = resolveExpertTools(['skill:document-skills'], [], ['document-skills'])
    expect(apply[0]).toEqual({ key: 'skill:document-skills', kind: 'skill', id: 'document-skills' })
  })
})
