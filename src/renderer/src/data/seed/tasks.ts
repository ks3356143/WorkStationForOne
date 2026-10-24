import { dateKey } from '../../../../shared/date-key'
import type { Task } from '../../types'

export function createSeedTasks(): Task[] {
  const today = dateKey()
  return [
    { id: 't1', time: '09:00', title: '站会：确认本周优先级', done: true, dueDate: today, list: '工作', priority: 2 },
    {
      id: 't2',
      time: '10:30',
      title: '重构 auth 模块',
      done: false,
      tag: 'Claude',
      tone: 'agent',
      dueDate: today,
      list: '工作',
      priority: 1,
      notes: '拆出 token 刷新与权限守卫，先补回归测试。'
    },
    { id: 't3', time: '14:30', title: '线代第 3 章 · 25 张卡', done: false, dueDate: today, list: '学习', priority: 2 },
    { id: 't4', time: '19:00', title: '跑步 5 km', done: false, tag: '45 分钟', dueDate: today, list: '生活', priority: 3 },
    { id: 't5', time: '08:30', title: '喝水 500 ml', done: true, dueDate: today, list: '生活' },
    { id: 't6', time: '21:00', title: '周报收尾', done: false, dueDate: today, list: '工作', priority: 1 },
    { id: 't7', time: '—', title: '给妈妈回电话', done: false, dueDate: today, list: '生活' },
    { id: 't8', time: '—', title: '整理本周资料', done: false, tag: '顺延?', dueDate: today, priority: 3 }
  ]
}
