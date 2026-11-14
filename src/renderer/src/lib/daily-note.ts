/** 每日笔记标题：本地日期键 + 「日记」。 */
export function dailyNoteTitle(dateKey: string): string {
  return `${dateKey} 日记`
}

/** 笔记首行（即标题），去首尾空白。 */
export function noteFirstLine(text: string): string {
  return (text.split('\n')[0] ?? '').trim()
}

/** 在一组笔记里按首行精确匹配每日笔记标题。 */
export function findDailyNote<T extends { text: string }>(
  notes: T[],
  title: string
): T | undefined {
  return notes.find((note) => noteFirstLine(note.text) === title)
}
