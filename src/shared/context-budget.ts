// 预算化上下文装配与抽取式压缩：纯函数，供主进程上下文构建与单测共用。
// 优先级数字越小越重要；超预算先丢低优先级块，单块放不下时截断并标记。

export interface ContextBlock {
  label: string
  text: string
  priority: number
}

const MIN_TRUNCATE = 40

const wrap = (label: string, body: string): string =>
  `<context label="${label}">\n${body}\n</context>`

export function assembleBudgeted(
  blocks: ContextBlock[],
  budget: number
): { text: string; dropped: string[] } {
  const sorted = [...blocks].sort((a, b) => a.priority - b.priority)
  const parts: string[] = []
  const dropped: string[] = []
  let used = 0
  for (const block of sorted) {
    if (!block.text.trim()) continue
    const overhead = wrap(block.label, '').length
    const avail = budget - used - overhead
    if (avail >= block.text.length) {
      const piece = wrap(block.label, block.text)
      parts.push(piece)
      used += piece.length
    } else if (avail >= MIN_TRUNCATE) {
      const piece = wrap(block.label, `${block.text.slice(0, avail - 6)}…已截断`)
      parts.push(piece)
      used += piece.length
    } else {
      dropped.push(block.label)
    }
  }
  return { text: parts.join('\n\n'), dropped }
}

export interface TurnLike {
  role: 'user' | 'assistant'
  text: string
}

/** 系统提示前缀上限：Windows 命令行总长约 32k，留出其它参数与余量。 */
export const SYSTEM_PREFIX_MAX = 12_000

/** 超长系统前缀截断并标记，避免 spawn 因命令行过长直接失败。 */
export function clampSystemPrefix(text: string, max = SYSTEM_PREFIX_MAX): string {
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 12))}…已截断`
}

const trunc = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text

/** 长线程抽取式压缩：保留首条意图 + 最近 keepLast 条，中间计数省略。短线程返回空串。 */
export function compactTurns(turns: TurnLike[], keepLast = 6, maxChars = 4000): string {
  if (turns.length === 0 || turns.length <= keepLast + 1) return ''
  const first = turns[0]
  const last = turns.slice(-keepLast)
  const omitted = turns.length - 1 - keepLast
  const lines = [
    `[会话摘要] 首条意图：${trunc(first.text, 200)}`,
    `…省略 ${omitted} 条中间回合…`,
    ...last.map((turn) => `${turn.role}: ${trunc(turn.text, 200)}`)
  ]
  const digest = lines.join('\n')
  return digest.length > maxChars ? `${digest.slice(0, maxChars)}…已截断` : digest
}
