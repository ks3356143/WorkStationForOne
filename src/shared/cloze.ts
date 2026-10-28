/**
 * 挖空卡片：`{{c1::答案}}` 形式，正面把答案替换成 `[1]` 占位。
 * 解析结果带区间下标，界面据此给挖空上色；与任务解析器同一套「区间映射回原文」的做法。
 */

export interface ClozeRange {
  /** 答案在原文中的起止（不含 end），用于高亮 */
  start: number
  end: number
  /** 整段 `{{c1::…}}` 的起止，用于正面替换 */
  markerStart: number
  markerEnd: number
  /** 分组序号：同序号的挖空一起隐藏 */
  index: number
  answer: string
}

export interface ClozeParseResult {
  ranges: ClozeRange[]
}

export const CLOZE_MAX = 2000

const CLOZE_PATTERN = /\{\{c(\d+)::(.*?)\}\}/gs

export function parseCloze(text: string): ClozeParseResult {
  const ranges: ClozeRange[] = []
  // 每次解析都重置 lastIndex：正则带 g 标志，复用会从上一次的末尾继续扫。
  CLOZE_PATTERN.lastIndex = 0
  let match = CLOZE_PATTERN.exec(text)
  while (match) {
    const answer = match[2].trim()
    if (answer.length > 0) {
      const leading = match[2].length - match[2].trimStart().length
      const start = match.index + match[0].indexOf('::') + 2 + leading
      ranges.push({
        start,
        end: start + answer.length,
        markerStart: match.index,
        markerEnd: match.index + match[0].length,
        index: Number(match[1]),
        answer
      })
    }
    match = CLOZE_PATTERN.exec(text)
  }
  return { ranges }
}

export function hasCloze(text: string): boolean {
  return parseCloze(text).ranges.length > 0
}

/** 正面：整段标记换成 [序号] 占位。 */
export function clozeFrontText(text: string): string {
  const { ranges } = parseCloze(text)
  if (ranges.length === 0) return text
  let result = ''
  let cursor = 0
  for (const range of ranges) {
    result += text.slice(cursor, range.markerStart)
    result += `[${range.index}]`
    cursor = range.markerEnd
  }
  return result + text.slice(cursor)
}

/** 纯文本：去掉花括号标记，答案保留。用于库列表与搜索。 */
export function clozePlainText(text: string): string {
  const { ranges } = parseCloze(text)
  if (ranges.length === 0) return text
  let result = ''
  let cursor = 0
  for (const range of ranges) {
    result += text.slice(cursor, range.markerStart)
    result += range.answer
    cursor = range.markerEnd
  }
  return result + text.slice(cursor)
}

export function clozePreview(text: string): string {
  return clozeFrontText(text)
}

/** 保存前的校验：返回中文错误文案，null 表示通过。 */
export function validateCloze(text: string): string | null {
  if (text.length > CLOZE_MAX) return '卡片内容过长'
  const { ranges } = parseCloze(text)
  if (ranges.length > 0) return null
  // 有标记语法但解析不出内容，说明写了空挖空
  if (/\{\{c\d+::/s.test(text)) return '挖空内容不能为空'
  return '至少要有一处 {{c1::挖空}}'
}
