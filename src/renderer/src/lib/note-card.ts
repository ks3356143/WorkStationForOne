/**
 * 笔记转卡片：正文通常是一整段，直接当成正面 + 背面等于什么都没问。
 * 这里按第一句提问、其余作答；单句笔记退化成「自述卡」，正面只留前 40 字。
 */

export interface NoteCardDraft {
  title: string
  notes: string
}

const TITLE_MAX = 200
const HEAD_MAX = 40
const SENTENCE_BREAK = /[。！？；\n]/

export function noteToCard(text: string): NoteCardDraft | null {
  const trimmed = text.trim()
  if (!trimmed) return null

  const at = trimmed.search(SENTENCE_BREAK)
  const firstSentence = at >= 0 ? trimmed.slice(0, at).trim() : trimmed
  const rest = at >= 0 ? trimmed.slice(at + 1).trim() : ''

  if (rest.length > 0) {
    // 以问句形式呈现，翻面才对得上
    return { title: `${firstSentence}？`.slice(0, TITLE_MAX), notes: trimmed }
  }

  // 只有一句：没有可隐藏的答案，正面退化成一段自述
  return { title: firstSentence.slice(0, HEAD_MAX), notes: trimmed }
}
