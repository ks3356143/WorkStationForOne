import { describe, expect, it } from 'vitest'
import type { Task } from '../types'
import {
  filterTasksByScope,
  groupTasksByDate,
  isInToday,
  isOverdue,
  listNameError,
  searchTasks,
  taskCounts,
  taskDueLabel,
  taskLists,
  tasksForTodayCard
} from './todo'
const TODAY = '2026-10-24'

const tasks: Task[] = [
  {
    id: 'a',
    title: '逾期',
    time: '09:00',
    done: false,
    dueDate: '2026-10-23',
    priority: 1,
    list: '工作'
  },
  { id: 'b', title: '今天', time: '15:00', done: false, dueDate: TODAY, priority: 2 },
  { id: 'c', title: '明天', time: '—', done: false, dueDate: '2026-10-25', list: '生活' },
  { id: 'd', title: '无日期', time: '—', done: false },
  { id: 'e', title: '已完成', time: '10:00', done: true, dueDate: TODAY, completedAt: 2 },
  { id: 'f', title: '远期', time: '08:00', done: false, dueDate: '2026-11-02', list: '工作' }
]

describe('taskCounts', () => {
  it('按清单与日期口径统计', () => {
    expect(taskCounts(tasks, TODAY)).toEqual({
      inbox: 2,
      today: 2,
      upcoming: 2,
      all: 5,
      done: 1
    })
  })
})

describe('filterTasksByScope', () => {
  it('收集箱只包含未完成且无清单的任务', () => {
    expect(filterTasksByScope(tasks, 'inbox', TODAY).map((task) => task.id)).toEqual(['b', 'd'])
  })

  it('今天包含逾期且按日期、时间排序', () => {
    expect(filterTasksByScope(tasks, 'today', TODAY).map((task) => task.id)).toEqual(['a', 'b'])
  })

  it('即将到来按日期升序', () => {
    expect(filterTasksByScope(tasks, 'upcoming', TODAY).map((task) => task.id)).toEqual(['c', 'f'])
  })

  it('全部包含未完成任务，无日期排在最后', () => {
    expect(filterTasksByScope(tasks, 'all', TODAY).map((task) => task.id)).toEqual([
      'a',
      'b',
      'c',
      'f',
      'd'
    ])
  })

  it('已完成按完成时间倒序', () => {
    const done = [
      ...tasks,
      { id: 'g', title: '更早完成', time: '—', done: true, completedAt: 1 } satisfies Task
    ]
    expect(filterTasksByScope(done, 'done', TODAY).map((task) => task.id)).toEqual(['e', 'g'])
  })

  it('自定义清单按清单精确筛选', () => {
    expect(filterTasksByScope(tasks, 'list:工作', TODAY).map((task) => task.id)).toEqual(['a', 'f'])
  })
})

describe('taskLists', () => {
  it('从任务派生清单并按数量倒序', () => {
    expect(taskLists(tasks)).toEqual([
      { name: '工作', count: 2 },
      { name: '生活', count: 1 }
    ])
  })

  it('保留当前打开但已清空的清单', () => {
    expect(taskLists(tasks, '归档')).toEqual([
      { name: '工作', count: 2 },
      { name: '生活', count: 1 },
      { name: '归档', count: 0 }
    ])
  })
})

describe('today card', () => {
  it('包含今天全部任务与逾期未完成任务', () => {
    expect(tasksForTodayCard(tasks, TODAY).map((task) => task.id)).toEqual(['a', 'b', 'e'])
  })

  it('判断今天与逾期', () => {
    expect(isInToday(tasks[0], TODAY)).toBe(true)
    expect(isInToday(tasks[2], TODAY)).toBe(false)
    expect(isOverdue(tasks[0], TODAY)).toBe(true)
    expect(isOverdue(tasks[1], TODAY)).toBe(false)
  })
})

describe('taskDueLabel', () => {
  it('给出今天、明天、逾期与具体日期', () => {
    expect(taskDueLabel(tasks[0], TODAY)).toBe('逾期 · 10-23 09:00')
    expect(taskDueLabel(tasks[1], TODAY)).toBe('今天 15:00')
    expect(taskDueLabel(tasks[2], TODAY)).toBe('明天')
    expect(taskDueLabel(tasks[5], TODAY)).toBe('11-02 08:00')
    expect(taskDueLabel(tasks[3], TODAY)).toBeUndefined()
  })

  it('已完成任务不再标逾期', () => {
    expect(
      taskDueLabel(
        { id: 'z', title: '已完成', time: '—', done: true, dueDate: '2026-10-23' },
        TODAY
      )
    ).toBe('10-23')
  })

  it('跨年日期带年份', () => {
    expect(
      taskDueLabel({ id: 'z', title: '跨年', time: '—', done: false, dueDate: '2027-01-02' }, TODAY)
    ).toBe('2027-01-02')
  })
})

describe('groupTasksByDate', () => {
  it('按日期分组且保持排序', () => {
    const upcoming = filterTasksByScope(tasks, 'upcoming', TODAY)
    expect(
      groupTasksByDate(upcoming).map((group) => [group.date, group.tasks.map((task) => task.id)])
    ).toEqual([
      ['2026-10-25', ['c']],
      ['2026-11-02', ['f']]
    ])
  })
})

describe('searchTasks', () => {
  const searchable: Task[] = [
    ...tasks,
    { id: 'h', title: '周报草稿', time: '—', done: false, notes: '准备本周数据', list: '写作' }
  ]

  it('匹配标题、备注与清单', () => {
    expect(searchTasks(searchable, '工作').map((task) => task.id)).toEqual(['a', 'f'])
    expect(searchTasks(searchable, '本周数据').map((task) => task.id)).toEqual(['h'])
    expect(searchTasks(searchable, '周报').map((task) => task.id)).toEqual(['h'])
  })

  it('空格查询返回空数组', () => {
    expect(searchTasks(searchable, '   ')).toEqual([])
  })
})

describe('listNameError', () => {
  const existing = ['工作', '学习']

  it('合法新名字通过', () => {
    expect(listNameError('工作流', existing, '工作')).toBeNull()
  })

  it('空名与纯空白被拒', () => {
    expect(listNameError('', existing, '工作')).toBe('清单名不能为空')
    expect(listNameError('   ', existing, '工作')).toBe('清单名不能为空')
  })

  it('超长被拒', () => {
    expect(listNameError('x'.repeat(81), existing, '工作')).toBe('清单名最多 80 字')
    expect(listNameError('x'.repeat(80), existing, '工作')).toBeNull()
  })

  it('与其它清单重名被拒，改名成自己没有影响', () => {
    expect(listNameError('学习', existing, '工作')).toBe('已存在同名清单')
    expect(listNameError('工作', existing, '工作')).toBeNull()
  })

  it('前后空格会被裁掉再比较', () => {
    expect(listNameError('  学习  ', existing, '工作')).toBe('已存在同名清单')
    expect(listNameError('  工作流 ', existing, '工作')).toBeNull()
  })
})
