export interface ShortcutItem {
  keys: string[]
  /** plus = 依次按下，or = 任选其一 */
  combine?: 'plus' | 'or'
  label: string
}

export interface ShortcutGroup {
  title: string
  items: ShortcutItem[]
}

/**
 * 速查表的唯一数据源。键位必须与真实处理逻辑一致：
 * 全局在 App.tsx / main/capture.ts，任务在 QuickAdd、TaskEditor、TasksView，
 * 学习在 ReviewSession，笔记与 Agent 在 QuickNoteModal、Composer。
 */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: '全局',
    items: [
      { keys: ['Ctrl', 'K'], label: '命令面板' },
      { keys: ['Ctrl', 'N'], label: '快速笔记' },
      { keys: ['Ctrl', 'Shift', 'N'], label: '新建任务' },
      { keys: ['Ctrl', 'Alt', 'Space'], label: '全局捕获窗' },
      { keys: ['?'], label: '打开本表' },
      { keys: ['Esc'], label: '关闭最上层' }
    ]
  },
  {
    title: '任务',
    items: [
      { keys: ['Enter'], label: '添加任务' },
      { keys: ['Ctrl', 'Enter'], label: '保存任务详情' },
      { keys: ['Esc'], label: '清空搜索或收起详情' }
    ]
  },
  {
    title: '学习',
    items: [
      { keys: ['Space'], label: '翻面看答案' },
      { keys: ['1', '2', '3', '4'], combine: 'or', label: '评分：重来 / 困难 / 良好 / 简单' },
      { keys: ['Esc'], label: '退出复习' }
    ]
  },
  {
    title: '笔记与 Agent',
    items: [
      { keys: ['Ctrl', 'Enter'], label: '保存快速笔记' },
      { keys: ['Enter'], label: '发送消息' },
      { keys: ['Shift', 'Enter'], label: '消息内换行' }
    ]
  },
  {
    title: '命令面板',
    items: [
      { keys: ['↑', '↓'], combine: 'or', label: '上下选择' },
      { keys: ['Enter'], label: '执行' },
      { keys: ['Esc'], label: '关闭' }
    ]
  }
]

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

/**
 * `?` 只在非输入场景生效：在输入框里它就是普通问号。
 * contenteditable 单独判断，isContentEditable 对后代节点也成立。
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (TYPING_TAGS.has(target.tagName)) return true
  return target.isContentEditable
}
