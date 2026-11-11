// 专家交换格式：Claude 子代理 .md（YAML frontmatter + 人设正文）。
// 只解析最小 YAML 子集（字符串 / 数组），不引重型 YAML 库。
// 原生 tools 行仅作展示提示，不参与★激活；激活键只有 mcp:<id> / skill:<id>。

export interface ExpertDef {
  id: string
  name: string
  description: string
  persona: string
  tools: string[]
  builtin?: boolean
}

function unquote(value: string): string {
  const v = value.trim()
  if (v.length >= 2) {
    const first = v[0]
    const last = v[v.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      const inner = v.slice(1, -1)
      return first === '"' ? inner.replace(/\\"/g, '"').replace(/\\\\/g, '\\') : inner
    }
  }
  return v
}

function parseList(value: string | undefined): string[] {
  if (!value) return []
  let v = value.trim()
  if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1)
  return v
    .split(',')
    .map((item) => unquote(item))
    .filter(Boolean)
}

function formatScalar(value: string): string {
  if (value === '' || /[:#[\]{}"'&*!|>%@`]/.test(value) || /^\s|\s$/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return value
}

export function parseExpertMarkdown(text: string): ExpertDef | null {
  const normalized = text.replace(/\r\n/g, '\n').replace(/^/, '')
  const match = normalized.match(/^---\n([\s\S]*?)\n---[ \t]*\n?([\s\S]*)$/)
  if (!match) return null
  const [, frontmatter, body] = match
  const fields: Record<string, string> = {}
  for (const line of frontmatter.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf(':')
    if (idx < 0) continue
    fields[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim()
  }
  const name = unquote(fields.name ?? '')
  const persona = body.trim()
  if (!name || !persona) return null
  const tools = [
    ...parseList(fields.mcp).map((id) => `mcp:${id}`),
    ...parseList(fields.skills).map((id) => `skill:${id}`)
  ]
  return { id: name, name, description: unquote(fields.description ?? ''), persona, tools }
}

export function serializeExpertMarkdown(def: ExpertDef): string {
  const mcp = def.tools.filter((t) => t.startsWith('mcp:')).map((t) => t.slice(4))
  const skills = def.tools.filter((t) => t.startsWith('skill:')).map((t) => t.slice(6))
  const lines = [
    '---',
    `name: ${formatScalar(def.id)}`,
    `description: ${formatScalar(def.description)}`
  ]
  if (mcp.length) lines.push(`mcp: [${mcp.join(', ')}]`)
  if (skills.length) lines.push(`skills: [${skills.join(', ')}]`)
  lines.push('---', def.persona)
  return `${lines.join('\n')}\n`
}
