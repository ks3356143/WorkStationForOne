const MAX_PROMPT = 20_000

function clamp(text: string): string {
  if (text.length <= MAX_PROMPT) return text
  const marker = '\n\n…（内容过长，已截断）'
  return text.slice(0, MAX_PROMPT - marker.length) + marker
}

const PRIORITY_LABEL: Record<1 | 2 | 3, string> = { 1: '高', 2: '中', 3: '低' }

/** Composer 是单行 input，换行会被浏览器吞掉；统一压成空格，保留词间分隔。 */
function oneLine(value: string): string {
  return value.replace(/\s*\n+\s*/g, ' ').trim()
}

export interface TaskHandoffInput {
  title: string
  notes?: string
  dueDate?: string
  time?: string
  priority?: 0 | 1 | 2 | 3
  list?: string
  estimateMinutes?: number
}

/** 任务详情「交给 Agent」：只拼任务字段与一段行动说明，不自动发送。 */
export function taskToAgentPrompt(task: TaskHandoffInput): string {
  const title = oneLine(task.title)
  if (!title) return ''
  const parts = [`标题：${title}`]
  if (task.list?.trim()) parts.push(`清单：${oneLine(task.list)}`)
  if (task.priority && PRIORITY_LABEL[task.priority]) {
    parts.push(`优先级：${PRIORITY_LABEL[task.priority]}`)
  }
  if (task.dueDate) parts.push(`截止：${task.dueDate}`)
  if (task.time && task.time !== '—') parts.push(`时间：${task.time}`)
  if (task.estimateMinutes && task.estimateMinutes > 0) {
    parts.push(`预计：${task.estimateMinutes} 分钟`)
  }
  if (task.notes?.trim()) parts.push(`备注：${oneLine(task.notes)}`)
  // 备注常以句号结尾；去掉尾部标点再拼行动说明，避免出现「。。」
  const summary = parts.join('；').replace(/[。.；;！!？?、，,]+$/, '')
  return clamp(
    `请帮我推进这个任务。${summary}。先说明你的处理计划，再开始执行；需要我确认的地方先问我。`
  )
}

export type NoteHandoffMode = 'summarize' | 'continue'

/** 笔记详情「交给 Agent」：总结或续写，正文压成单行带上。 */
export function noteToAgentPrompt(text: string, mode: NoteHandoffMode): string {
  const body = oneLine(text)
  if (!body) return ''
  const intro =
    mode === 'summarize'
      ? '请总结下面这篇笔记的要点，并给出 2–3 个可执行的下一步：'
      : '请顺着下面这篇笔记继续写下去，保持原有语气与结构；先给出续写内容，再用一句话说明你补充了什么：'
  return clamp(`${intro}${body}`)
}
