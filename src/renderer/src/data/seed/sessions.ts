import type { ChatMessage, Session } from '../../types'

export function createSeedSessions(): Session[] {
  return [
    {
      id: 's-c1',
      agent: 'claude',
      title: '重构 auth 模块',
      meta: '待确认 · 00:42:18',
      status: 'wait',
      threadDate: '今天'
    },
    {
      id: 's-c2',
      agent: 'claude',
      title: '修复登录 500',
      meta: '00:06:12 · 3 个文件',
      status: 'run',
      threadDate: '今天'
    },
    {
      id: 's-c3',
      agent: 'claude',
      title: '补单元测试',
      meta: '2 小时前',
      status: 'idle',
      threadDate: '今天'
    },
    {
      id: 's-x1',
      agent: 'codex',
      title: '周报草稿',
      meta: '00:12:40 · 只读',
      status: 'run',
      threadDate: '今天'
    },
    {
      id: 's-x2',
      agent: 'codex',
      title: '会议纪要整理',
      meta: '昨天 18:20',
      status: 'idle',
      threadDate: '昨天'
    }
  ]
}

export function createSeedThreads(): Record<string, ChatMessage[]> {
  return {
    's-c1': [
      {
        id: 'c-u1',
        role: 'user',
        text: '把今天没完成的任务顺延到明天，再给我留 30 分钟复习。',
        time: '14:04'
      },
      {
        id: 'c-a1',
        role: 'assistant',
        text: '可以。我先把 3 项未完成任务顺延，再把复习放到 20:30–21:00。改任务需要你确认。',
        time: '14:06',
        tools: [
          { name: 'tasks.reschedule', meta: '3 项', status: '完成' },
          { name: 'study.plan', meta: '20:30–21:00', status: '完成' }
        ]
      },
      { id: 'c-u2', role: 'user', text: '先只改任务，复习块我自己来。', time: '14:09' }
    ],
    's-c2': [
      {
        id: 'c2-u1',
        role: 'user',
        text: '登录接口偶发 500，先只定位原因，不要改代码。',
        time: '13:52'
      },
      {
        id: 'c2-a1',
        role: 'assistant',
        text: '定位到 session 过期分支里的未捕获异常：token 刷新失败时直接抛错。修复需要改 auth/session.ts:88，等你确认。',
        time: '13:55',
        tools: [
          { name: 'logs.read', meta: '近 2 小时 · 4 次异常', status: '完成' },
          { name: 'code.locate', meta: 'auth/session.ts:88', status: '完成' }
        ]
      }
    ],
    's-c3': [
      {
        id: 'c3-u1',
        role: 'user',
        text: '给 auth 模块补边界用例。',
        time: '14:18'
      },
      {
        id: 'c3-a1',
        role: 'assistant',
        text: '补了 6 个用例：空 token、过期、并发刷新、时钟漂移、损坏 payload、重复登出。全部通过。',
        time: '14:21',
        tools: [{ name: 'tests.run', meta: '6 passed', status: '完成' }]
      }
    ],
    's-x1': [
      {
        id: 'x-u1',
        role: 'user',
        text: '把本周的提交整理成一份周报草稿，语气克制一点。',
        time: '11:02'
      },
      {
        id: 'x-a1',
        role: 'assistant',
        text: '已从 12 条提交里归纳出 3 个主题，草稿放在笔记区，没有提交到任何外部服务。',
        time: '11:03',
        tools: [
          { name: 'git.log', meta: '12 commits', status: '完成' },
          { name: 'notes.create', meta: '周报草稿 v2', status: '完成' }
        ]
      }
    ],
    's-x2': [
      {
        id: 'x2-u1',
        role: 'user',
        text: '把今天的会议记录整理成行动项。',
        time: '18:02'
      },
      {
        id: 'x2-a1',
        role: 'assistant',
        text: '整理了 4 条行动项；其中 2 条与本周任务重复，已合并。纪要已存入笔记。',
        time: '18:04',
        tools: [{ name: 'notes.create', meta: '4 项行动项', status: '完成' }]
      }
    ]
  }
}
