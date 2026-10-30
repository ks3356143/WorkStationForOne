import { describe, expect, it, vi } from 'vitest'
import type {
  HabitRecord,
  LearningItemRecord,
  NoteRecord,
  NoteSearchHit,
  TaskRecord
} from '../../shared/ipc'
import { runMcpTool, type McpData } from './tools'

const TODAY = '2026-10-29'

function task(partial: Partial<TaskRecord> & { id: string; title: string }): TaskRecord {
  return { time: '—', done: false, ...partial }
}

const tasks: TaskRecord[] = [
  task({ id: 't1', title: '今天到期', dueDate: TODAY, priority: 2, list: '工作' }),
  task({ id: 't2', title: '逾期任务', dueDate: '2026-10-27', priority: 3 }),
  task({ id: 't3', title: '即将到来', dueDate: '2026-11-02' }),
  task({ id: 't4', title: '计划今天', plannedFor: TODAY, estimateMinutes: 30 }),
  task({
    id: 't5',
    title: '今天完成',
    done: true,
    completedAt: new Date(2026, 9, 29, 12).getTime()
  }),
  task({ id: 't6', title: '子任务', parentId: 't1', dueDate: TODAY }),
  task({ id: 't7', title: '无日期' })
]

const noteHits: NoteSearchHit[] = [
  {
    id: 'n1',
    text: '线代特征值三条性质',
    time: '今天',
    snippet: '线代\u0001特征值\u0002三条性质'
  }
]

const cards: LearningItemRecord[] = [
  {
    id: 'l1',
    subject: '英语二',
    title: 'abandon',
    source: '真题',
    notes: '放弃',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: TODAY,
    active: true
  },
  {
    id: 'l2',
    subject: '管综数学',
    title: '工程问题',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: '2026-11-04',
    active: true
  },
  {
    id: 'l3',
    subject: '英语二',
    title: '停用卡',
    repetitions: 0,
    intervalDays: 0,
    ease: 2.5,
    nextReviewOn: TODAY,
    active: false
  }
]

const habits: HabitRecord[] = [
  { id: 'h1', name: '早起', checkins: [TODAY, '2026-10-28', '2026-10-20'] },
  { id: 'h2', name: '阅读', checkins: ['2026-10-22'] }
]

function data(): McpData {
  return {
    transaction: (run) => run(),
    tasks: {
      list: () => tasks,
      find: (id) => tasks.find((task) => task.id === id),
      create: () => {
        throw new Error('not implemented')
      },
      update: () => {
        throw new Error('not implemented')
      },
      completeTask: () => null
    },
    notes: {
      count: () => 4,
      search: () => noteHits,
      create: () => {
        throw new Error('not implemented')
      }
    },
    learning: {
      list: () => cards,
      review: () => cards[0]
    },
    habits: {
      list: () => habits,
      setCheckin: () => {}
    },
    audit: { record: vi.fn(), recordStrict: vi.fn() }
  }
}

function call(name: string, args: unknown = {}, source = data()) {
  return runMcpTool(name, args, source, { sessionId: 's-1', today: TODAY })
}

function payload(result: { text: string }) {
  return JSON.parse(result.text)
}

describe('MCP 只读工具', () => {
  it('默认只取今天到期/计划今天，并排除子任务', () => {
    const result = call('tasks_list')
    const body = payload(result)
    expect(body.scope).toBe('today')
    expect(body.tasks.map((item: TaskRecord) => item.id)).toEqual(['t2', 't1', 't4'])
  })

  it('支持逾期、即将到来、已完成与 limit', () => {
    expect(
      payload(call('tasks_list', { scope: 'overdue' })).tasks.map((t: TaskRecord) => t.id)
    ).toEqual(['t2'])
    expect(
      payload(call('tasks_list', { scope: 'upcoming' })).tasks.map((t: TaskRecord) => t.id)
    ).toEqual(['t3'])
    expect(
      payload(call('tasks_list', { scope: 'done' })).tasks.map((t: TaskRecord) => t.id)
    ).toEqual(['t5'])
    expect(payload(call('tasks_list', { limit: 1 })).returned).toBe(1)
  })

  it('非法 scope 返回工具错误', () => {
    const result = call('tasks_list', { scope: 'someday' })
    expect(result.isError).toBe(true)
  })

  it('笔记搜索把 FTS 标记换成可读括号', () => {
    const body = payload(call('notes_search', { query: '线代' }))
    expect(body.libraryTotal).toBe(4)
    expect(body.results[0].snippet).toBe('线代[特征值]三条性质')
    expect(call('notes_search', { query: ' ' }).isError).toBe(true)
  })

  it('学习到期只含启用卡，可过滤科目', () => {
    const body = payload(call('learning_due'))
    expect(body.cards.map((card: LearningItemRecord) => card.id)).toEqual(['l1'])
    expect(payload(call('learning_due', { subject: '管综数学' })).due).toBe(0)
  })

  it('习惯汇总统计今天与最近 7 天', () => {
    const body = payload(call('habits_summary'))
    expect(body).toMatchObject({ checked: 1, total: 2 })
    expect(body.habits[0]).toMatchObject({ checkedToday: true, checkedDays7: 2 })
  })

  it('今日概览汇总任务、学习、习惯与笔记', () => {
    const body = payload(call('today_overview'))
    expect(body.tasks).toMatchObject({ doneToday: 1, overdue: 1 })
    expect(body.learning.due).toBe(1)
    expect(body.habits).toMatchObject({ checked: 1, total: 2 })
    expect(body.notes.total).toBe(4)
  })

  it('每次调用都写 mcp/read 审计，目标只记会话 id', () => {
    const source = data()
    runMcpTool('today_overview', {}, source, { sessionId: 's-7', today: TODAY })
    expect(source.audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        domain: 'mcp',
        action: 'read',
        targetId: 's-7',
        title: 'today_overview',
        source: 'agent'
      })
    )
  })

  it('未知工具明确报错', () => {
    const result = call('delete_everything')
    expect(result).toMatchObject({ isError: true })
    expect(result.text).toContain('未知工具')
  })
})

describe('MCP 写入工具', () => {
  function writeData() {
    const taskList: TaskRecord[] = []
    const noteList: NoteRecord[] = []
    const card = cards[0]
    const habitList: HabitRecord[] = [{ id: 'h1', name: '早起', checkins: [] }]
    const source: McpData = {
      transaction: (run) => run(),
      tasks: {
        list: () => taskList,
        find: (id) => taskList.find((item) => item.id === id),
        create: (draft) => {
          const created = {
            id: `t-${taskList.length + 1}`,
            time: draft.time ?? '—',
            done: false,
            ...draft
          } as TaskRecord
          taskList.push(created)
          return created
        },
        update: (id, patch) => {
          const index = taskList.findIndex((item) => item.id === id)
          if (index < 0) return
          const next = { ...taskList[index], ...patch } as Record<string, unknown>
          for (const key of ['dueDate', 'plannedFor', 'list', 'tag', 'tone']) {
            if (patch[key as keyof typeof patch] === null) delete next[key]
          }
          taskList[index] = next as unknown as TaskRecord
        },
        completeTask: (id) => {
          const index = taskList.findIndex((item) => item.id === id)
          if (index >= 0) taskList[index] = { ...taskList[index], done: true }
          return null
        }
      },
      notes: {
        count: () => noteList.length,
        search: () => [],
        create: (text, tag) => {
          const note: NoteRecord = { id: `n-${noteList.length + 1}`, text, time: '刚刚' }
          if (tag) note.tag = tag
          noteList.push(note)
          return note
        }
      },
      learning: {
        list: () => [card],
        review: (id, rating) => ({
          ...card,
          id,
          repetitions: card.repetitions + 1,
          intervalDays: rating,
          nextReviewOn: '2026-11-02'
        })
      },
      habits: {
        list: () => habitList,
        setCheckin: (id, day, done) => {
          const habit = habitList.find((item) => item.id === id)
          if (!habit) return
          habit.checkins = done
            ? [...new Set([...habit.checkins, day])]
            : habit.checkins.filter((item) => item !== day)
        }
      },
      audit: { record: vi.fn(), recordStrict: vi.fn() }
    }
    return { source, taskList, noteList, habitList }
  }

  it('创建/更新/完成任务，并记 write 审计', () => {
    const { source, taskList } = writeData()
    const created = runMcpTool(
      'tasks_create',
      { title: 'MCP 任务', dueDate: TODAY, priority: 2, list: '工作' },
      source,
      { sessionId: 's-1', today: TODAY, write: true }
    )
    expect(created.isError).toBeUndefined()
    expect(taskList[0]).toMatchObject({ title: 'MCP 任务', dueDate: TODAY, priority: 2 })

    const id = taskList[0].id
    expect(
      runMcpTool('tasks_update', { id, patch: { title: '改过', dueDate: null } }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      }).isError
    ).toBeUndefined()
    expect(taskList[0]).toMatchObject({ title: '改过' })
    expect(taskList[0].dueDate).toBeUndefined()

    expect(
      runMcpTool('tasks_complete', { id }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      }).isError
    ).toBeUndefined()
    expect(taskList[0].done).toBe(true)
  })

  it('创建笔记、打卡与评分', () => {
    const { source, noteList, habitList } = writeData()
    expect(
      runMcpTool('notes_create', { title: 'MCP 笔记', body: '正文', tag: '想法' }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      }).isError
    ).toBeUndefined()
    expect(noteList[0].text).toBe('MCP 笔记\n\n正文')
    expect(noteList[0].tag).toBe('想法')

    expect(
      runMcpTool('habits_check', { habitId: 'h1' }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      }).isError
    ).toBeUndefined()
    expect(habitList[0].checkins).toContain(TODAY)

    const reviewed = runMcpTool('learning_review', { itemId: 'l1', rating: 3 }, source, {
      sessionId: 's-1',
      today: TODAY,
      write: true
    })
    expect(reviewed.isError).toBeUndefined()
    expect(JSON.parse(reviewed.text)).toMatchObject({ nextReviewOn: '2026-11-02' })
  })

  it('拒绝非法日期与未来打卡', () => {
    const { source } = writeData()
    expect(
      runMcpTool('tasks_create', { title: '坏日期', dueDate: '2026-13-01' }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      }).isError
    ).toBe(true)
    expect(
      runMcpTool('habits_check', { habitId: 'h1', date: '2026-10-30' }, source, {
        sessionId: 's-1',
        today: TODAY,
        write: true
      })
    ).toMatchObject({ isError: true })
  })
})
