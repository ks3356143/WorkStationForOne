import { clozeFrontText, validateCloze } from './cloze'
import type { LearningDraft, LearningItemRecord } from './ipc'

export const LEARNING_LIMITS = {
  subject: 40,
  title: 200,
  text: 2000,
  maxRows: 1000,
  maxBytes: 2 * 1024 * 1024
} as const

export const LEARNING_CSV_HEADER = ['科目', '正面', '背面', '来源', '类型', '挖空原文'] as const

export interface LearningCsvError {
  line: number
  message: string
}

export interface LearningCsvRow {
  line: number
  draft: LearningDraft
}

export interface LearningCsvParseResult {
  rows: LearningCsvRow[]
  errors: LearningCsvError[]
}

interface CsvRecord {
  line: number
  fields: string[]
}

/** 逐字符解析 CSV：引号内允许逗号、换行与 "" 转义。 */
function readRecords(source: string): CsvRecord[] {
  const text = source.startsWith('\uFEFF') ? source.slice(1) : source
  const records: CsvRecord[] = []
  let fields: string[] = []
  let field = ''
  let quoted = false
  let line = 1
  let recordLine = 1

  const endField = () => {
    fields.push(field)
    field = ''
  }
  const endRecord = () => {
    endField()
    if (fields.some((value) => value.trim() !== '')) records.push({ line: recordLine, fields })
    fields = []
    recordLine = line
  }

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        field += char
        if (char === '\n') line += 1
      }
      continue
    }

    if (char === '"') {
      quoted = true
      continue
    }
    if (char === ',') {
      endField()
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      endRecord()
      line += 1
      recordLine = line
      continue
    }
    field += char
  }

  if (field.length > 0 || fields.length > 0) endRecord()
  return records
}

function tooLong(value: string, max: number): boolean {
  return [...value].length > max
}

export function parseLearningCsv(source: string): LearningCsvParseResult {
  const records = readRecords(source)
  if (records.length === 0) {
    return { rows: [], errors: [{ line: 1, message: '文件为空或没有表头' }] }
  }

  const header = records[0].fields.map((value) => value.trim())
  const indexOf = (name: string) => header.indexOf(name)
  const required = ['科目', '正面']
  const missing = required.filter((name) => indexOf(name) < 0)
  if (missing.length > 0) {
    return {
      rows: [],
      errors: [{ line: 1, message: `缺少「${missing.join('」「')}」列` }]
    }
  }

  const rows: LearningCsvRow[] = []
  const errors: LearningCsvError[] = []
  const at = (fields: string[], name: string): string => {
    const index = indexOf(name)
    return index < 0 ? '' : (fields[index] ?? '').trim()
  }

  for (const record of records.slice(1)) {
    if (rows.length >= LEARNING_LIMITS.maxRows) {
      errors.push({ line: record.line, message: `一次最多导入 ${LEARNING_LIMITS.maxRows} 张` })
      break
    }

    const subject = at(record.fields, '科目')
    const rawTitle = at(record.fields, '正面')
    const notes = at(record.fields, '背面')
    const from = at(record.fields, '来源')
    const kindRaw = at(record.fields, '类型')
    const clozeSource = at(record.fields, '挖空原文')

    if (!subject) {
      errors.push({ line: record.line, message: '科目不能为空' })
      continue
    }
    if (tooLong(subject, LEARNING_LIMITS.subject)) {
      errors.push({ line: record.line, message: '科目过长' })
      continue
    }
    if (tooLong(notes, LEARNING_LIMITS.text)) {
      errors.push({ line: record.line, message: '背面过长' })
      continue
    }
    if (tooLong(from, LEARNING_LIMITS.text)) {
      errors.push({ line: record.line, message: '来源过长' })
      continue
    }

    const isCloze = kindRaw === '挖空' || kindRaw === 'cloze'
    if (kindRaw && !isCloze && kindRaw !== '基础' && kindRaw !== 'basic') {
      errors.push({ line: record.line, message: '类型只能是基础或挖空' })
      continue
    }

    if (isCloze) {
      if (!clozeSource) {
        errors.push({ line: record.line, message: '挖空卡缺少挖空原文' })
        continue
      }
      if (tooLong(clozeSource, LEARNING_LIMITS.text)) {
        errors.push({ line: record.line, message: '挖空原文过长' })
        continue
      }
      const problem = validateCloze(clozeSource)
      if (problem) {
        errors.push({ line: record.line, message: problem })
        continue
      }
      const draft: LearningDraft = {
        subject,
        title: [...clozeFrontText(clozeSource)].slice(0, LEARNING_LIMITS.title).join(''),
        kind: 'cloze',
        clozeSource
      }
      if (from) draft.source = from
      if (notes) draft.notes = notes
      rows.push({ line: record.line, draft })
      continue
    }

    if (!rawTitle) {
      errors.push({ line: record.line, message: '正面不能为空' })
      continue
    }
    if (tooLong(rawTitle, LEARNING_LIMITS.title)) {
      errors.push({ line: record.line, message: '正面过长' })
      continue
    }
    const draft: LearningDraft = { subject, title: rawTitle }
    if (from) draft.source = from
    if (notes) draft.notes = notes
    rows.push({ line: record.line, draft })
  }

  return { rows, errors }
}

function quote(value: string): string {
  if (value === '') return ''
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim()
  return needsQuotes ? `"${value.replaceAll('"', '""')}"` : value
}

/** 导出用于编辑的内容 CSV，不包含复习状态；调用方负责过滤启用卡。 */
export function serializeLearningCsv(items: LearningItemRecord[]): string {
  const lines = [LEARNING_CSV_HEADER.join(',')]
  for (const item of items) {
    const cloze = item.kind === 'cloze'
    lines.push(
      [
        item.subject,
        item.title,
        item.notes ?? '',
        item.source ?? '',
        cloze ? '挖空' : '基础',
        cloze ? (item.clozeSource ?? '') : ''
      ]
        .map(quote)
        .join(',')
    )
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
