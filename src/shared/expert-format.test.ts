import { describe, expect, it } from 'vitest'
import { parseExpertMarkdown, serializeExpertMarkdown } from './expert-format'

const SAMPLE = `---
name: backend-go-rust
description: Go/Rust 后端专家
tools: Read, Grep, Glob, Bash
mcp: [context7, deepwiki]
skills: [document-skills]
---
你是 Go/Rust 后端专家。优先使用本机 go/cargo CLI。
`

describe('parseExpertMarkdown', () => {
  it('解析 frontmatter 与人设正文', () => {
    const def = parseExpertMarkdown(SAMPLE)
    expect(def).not.toBeNull()
    expect(def?.name).toBe('backend-go-rust')
    expect(def?.description).toBe('Go/Rust 后端专家')
    expect(def?.persona).toContain('Go/Rust 后端专家')
    expect(def?.tools).toEqual(['mcp:context7', 'mcp:deepwiki', 'skill:document-skills'])
  })

  it('原生 tools 行不进入激活键', () => {
    const def = parseExpertMarkdown(SAMPLE)
    expect(def?.tools.some((t) => t.startsWith('native:'))).toBe(false)
  })

  it('缺少 frontmatter 或 name 或正文返回 null', () => {
    expect(parseExpertMarkdown('没有 frontmatter')).toBeNull()
    expect(parseExpertMarkdown('---\ndescription: x\n---\n正文')).toBeNull()
    expect(parseExpertMarkdown('---\nname: x\n---\n')).toBeNull()
  })

  it('支持 CRLF 与引号字符串', () => {
    const def = parseExpertMarkdown('---\r\nname: "a-b"\r\ndescription: \'d\'\r\n---\r\n正文\r\n')
    expect(def?.name).toBe('a-b')
    expect(def?.description).toBe('d')
  })

  it('序列化后再解析往返一致', () => {
    const def = parseExpertMarkdown(SAMPLE)
    if (!def) throw new Error('parse failed')
    const again = parseExpertMarkdown(serializeExpertMarkdown(def))
    expect(again?.name).toBe(def.name)
    expect(again?.description).toBe(def.description)
    expect(again?.persona).toBe(def.persona)
    expect(again?.tools).toEqual(def.tools)
  })
})
