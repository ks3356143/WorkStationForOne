import type { Note } from '../../types'

export function createSeedNotes(): Note[] {
  return [
    {
      id: 'n1',
      text: '工作台不是聊天窗口，是把 agent 的产出沉淀成可检索的记忆。',
      time: '今天 13:58',
      tag: '产品思考',
      pinned: true
    },
    { id: 'n2', text: '线代 · 特征值三条性质', time: '12:20' },
    { id: 'n3', text: 'Codex 周报提示词 v2', time: '昨天' },
    { id: 'n4', text: '周末 · 给工作站做一次备份', time: '周二' }
  ]
}
