import type { LearningCsvRow } from '../../../shared/learning-csv'

/** 导入去重键：科目 + 正面，精确匹配。 */
export function importKey(subject: string, title: string): string {
  return `${subject.trim()}\u0000${title.trim()}`
}

export interface ImportPlan {
  rows: LearningCsvRow[]
  duplicates: number
}

export function planImport(
  rows: LearningCsvRow[],
  existing: { subject: string; title: string }[]
): ImportPlan {
  const seen = new Set(existing.map((item) => importKey(item.subject, item.title)))
  const kept: LearningCsvRow[] = []
  let duplicates = 0

  for (const row of rows) {
    const key = importKey(row.draft.subject, row.draft.title)
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    seen.add(key)
    kept.push(row)
  }

  return { rows: kept, duplicates }
}
