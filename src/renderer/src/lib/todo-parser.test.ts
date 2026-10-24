import { describe, expect, it } from 'vitest'
import { parseTaskInput } from './todo-parser'

const TODAY = '2026-10-24' // 周六

describe('parseTaskInput', () => {
  it('解析完整快速添加语句', () => {
    expect(parseTaskInput('明天 15:00 提交周报 !高 #工作', TODAY)).toEqual({
      title: '提交周报',
      dueDate: '2026-10-25',
      time: '15:00',
      priority: 1,
      list: '工作'
    })
  })

  it('识别今天、后天与周几', () => {
    expect(parseTaskInput('今天 读完论文', TODAY)).toMatchObject({ title: '读完论文', dueDate: TODAY })
    expect(parseTaskInput('后天 交作业', TODAY)).toMatchObject({ dueDate: '2026-10-26' })
    expect(parseTaskInput('周三 复习线代', TODAY)).toMatchObject({ dueDate: '2026-10-28' })
    expect(parseTaskInput('周天 休息', TODAY)).toMatchObject({ dueDate: '2026-10-25' })
  })

  it('周几跨过本周时指向下一次', () => {
    expect(parseTaskInput('周一 站会', '2026-10-25')).toMatchObject({ dueDate: '2026-10-26' })
    expect(parseTaskInput('周一 站会', '2026-10-26')).toMatchObject({ dueDate: '2026-10-26' })
  })

  it('下周几指向下一周的对应日期', () => {
    expect(parseTaskInput('下周一 站会', '2026-10-24')).toEqual({ title: '站会', dueDate: '2026-10-26' })
    expect(parseTaskInput('下周一 站会', '2026-10-25')).toEqual({ title: '站会', dueDate: '2026-10-26' })
    expect(parseTaskInput('下周一 站会', '2026-10-26')).toEqual({ title: '站会', dueDate: '2026-11-02' })
  })

  it('清单标记不误伤 C# 这类标题', () => {
    expect(parseTaskInput('C#学习', TODAY)).toEqual({ title: 'C#学习' })
    expect(parseTaskInput('提交周报#工作', TODAY)).toEqual({ title: '提交周报', list: '工作' })
  })

  it('识别中文日期并在跨年时顺延', () => {
    expect(parseTaskInput('10月30日 交报告', TODAY)).toMatchObject({ dueDate: '2026-10-30' })
    expect(parseTaskInput('1月2日 新年计划', '2026-12-30')).toMatchObject({ dueDate: '2027-01-02' })
    expect(parseTaskInput('2026-12-01 续费', TODAY)).toMatchObject({ dueDate: '2026-12-01' })
  })

  it('识别 24 小时与中文时段', () => {
    expect(parseTaskInput('下午3点 开会', TODAY)).toMatchObject({ title: '开会', time: '15:00' })
    expect(parseTaskInput('晚上8点半 看书', TODAY)).toMatchObject({ time: '20:30' })
    expect(parseTaskInput('早上9点15分 晨跑', TODAY)).toMatchObject({ time: '09:15' })
  })

  it('识别优先级且不区分顺序', () => {
    expect(parseTaskInput('!中 整理桌面', TODAY)).toEqual({ title: '整理桌面', priority: 2 })
    expect(parseTaskInput('整理桌面 !低', TODAY)).toEqual({ title: '整理桌面', priority: 3 })
  })

  it('普通中文词中的“周”不当作日期', () => {
    expect(parseTaskInput('周报收尾', TODAY)).toEqual({ title: '周报收尾' })
  })

  it('只有标记时标题为空', () => {
    expect(parseTaskInput('!高 #工作', TODAY)).toEqual({ title: '', priority: 1, list: '工作' })
  })

  it('非法日期不吞掉标题', () => {
    expect(parseTaskInput('2026-02-30 无效日期', TODAY)).toEqual({ title: '2026-02-30 无效日期' })
  })
})
