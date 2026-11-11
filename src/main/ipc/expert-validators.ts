import type { ExpertSaveInput, ExpertSourceInput } from '../../shared/ipc'
import { assertId, assertRecord } from '../validate'

const MAX_NAME = 80
const MAX_DESC = 240
const MAX_PERSONA = 20_000
const MAX_TOOLS = 50
const MAX_KEY = 120
const MAX_ID = 120
const MAX_MARKDOWN = 200_000
const MAX_RELPATH = 1000

export const assertExpertId = (value: unknown, label: string): string =>
  assertId(value, label, MAX_ID)

/** 激活键只接受 mcp: / skill: 前缀；原生工具名不参与专家激活。 */
function assertToolKeys(value: unknown): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MAX_TOOLS) throw new TypeError('工具组合无效')
  return value.map((raw) => {
    if (typeof raw !== 'string') throw new TypeError('工具键无效')
    const key = raw.trim()
    if (!key || key.length > MAX_KEY) throw new TypeError('工具键过长')
    if (!/^(mcp|skill):[A-Za-z0-9._@-]+$/.test(key)) {
      throw new TypeError('工具键需为 mcp: 或 skill: 前缀')
    }
    return key
  })
}

export function assertExpertSaveInput(value: unknown): ExpertSaveInput {
  const input = assertRecord(value, '专家参数')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new TypeError('专家名称不能为空')
  if (name.length > MAX_NAME) throw new TypeError('专家名称过长')
  const description = typeof input.description === 'string' ? input.description.trim() : ''
  if (description.length > MAX_DESC) throw new TypeError('专家描述过长')
  const persona = typeof input.persona === 'string' ? input.persona : ''
  if (!persona.trim()) throw new TypeError('人设不能为空')
  if (persona.length > MAX_PERSONA) throw new TypeError('人设过长')
  const result: ExpertSaveInput = {
    name,
    description,
    persona,
    tools: assertToolKeys(input.tools)
  }
  if (input.id !== undefined) result.id = assertExpertId(input.id, '专家 id')
  return result
}

export function assertExpertSourceInput(value: unknown): ExpertSourceInput {
  const input = assertRecord(value, '专家源参数')
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) throw new TypeError('源名称不能为空')
  const url = typeof input.url === 'string' ? input.url.trim() : ''
  if (!url) throw new TypeError('源地址不能为空')
  const result: ExpertSourceInput = { name, url }
  if (input.ref !== undefined) {
    if (typeof input.ref !== 'string') throw new TypeError('ref 无效')
    result.ref = input.ref.trim()
  }
  return result
}

export function assertExpertActivateInput(value: unknown): {
  agent: 'claude' | 'codex'
  id: string
} {
  const input = assertRecord(value, '专家激活参数')
  const agent = input.agent === 'codex' ? 'codex' : input.agent === 'claude' ? 'claude' : null
  if (!agent) throw new TypeError('Agent 无效')
  return { agent, id: assertExpertId(input.id, '专家 id') }
}

export function assertExpertMarketImportInput(value: unknown): {
  sourceId: string
  relPath: string
} {
  const input = assertRecord(value, '市场导入参数')
  const sourceId = assertExpertId(input.sourceId, '源 id')
  const relPath = typeof input.relPath === 'string' ? input.relPath.trim() : ''
  if (!relPath || relPath.length > MAX_RELPATH) throw new TypeError('条目路径无效')
  return { sourceId, relPath }
}

export function assertExpertMarkdown(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Markdown 无效')
  if (!value.trim()) throw new TypeError('Markdown 不能为空')
  if (value.length > MAX_MARKDOWN) throw new TypeError('Markdown 过长')
  return value
}
