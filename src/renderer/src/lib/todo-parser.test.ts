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
    expect(parseTaskInput('今天 读完论文', TODAY)).toMatchObject({
      title: '读完论文',
      dueDate: TODAY
    })
    expect(parseTaskInput('后天 交作业', TODAY)).toMatchObject({ dueDate: '2026-10-26' })
    expect(parseTaskInput('周三 复习线代', TODAY)).toMatchObject({ dueDate: '2026-10-28' })
    expect(parseTaskInput('周天 休息', TODAY)).toMatchObject({ dueDate: '2026-10-25' })
  })

  it('周几跨过本周时指向下一次', () => {
    expect(parseTaskInput('周一 站会', '2026-10-25')).toMatchObject({ dueDate: '2026-10-26' })
    expect(parseTaskInput('周一 站会', '2026-10-26')).toMatchObject({ dueDate: '2026-10-26' })
  })

  it('下周几指向下一周的对应日期', () => {
    expect(parseTaskInput('下周一 站会', '2026-10-24')).toEqual({
      title: '站会',
      dueDate: '2026-10-26'
    })
    expect(parseTaskInput('下周一 站会', '2026-10-25')).toEqual({
      title: '站会',
      dueDate: '2026-10-26'
    })
    expect(parseTaskInput('下周一 站会', '2026-10-26')).toEqual({
      title: '站会',
      dueDate: '2026-11-02'
    })
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

describe('截止前缀不残留到标题', () => {
  it('周几后的「前」「之前」「以前」并入日期', () => {
    expect(parseTaskInput('周五前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-30'
    })
    expect(parseTaskInput('周五之前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-30'
    })
    expect(parseTaskInput('周五以前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-30'
    })
    expect(parseTaskInput('明天前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-25'
    })
    expect(parseTaskInput('10月30日前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-30'
    })
  })

  it('「前台」这类词组不被当作截止前缀', () => {
    expect(parseTaskInput('周五前台交报告', TODAY)).toEqual({
      title: '前台交报告',
      dueDate: '2026-10-30'
    })
    expect(parseTaskInput('周五前面交报告', TODAY)).toEqual({
      title: '前面交报告',
      dueDate: '2026-10-30'
    })
  })
})

describe('时间数字与单位之间允许空格', () => {
  it('数字与「点」之间、时段后的空格都能识别', () => {
    expect(parseTaskInput('晚上 8 点跑步', TODAY)).toMatchObject({ title: '跑步', time: '20:00' })
    expect(parseTaskInput('晚上8 点跑步', TODAY)).toMatchObject({ title: '跑步', time: '20:00' })
    expect(parseTaskInput('下午 3 点半 开会', TODAY)).toMatchObject({
      title: '开会',
      time: '15:30'
    })
    expect(parseTaskInput('早上 9 点 15 分 晨跑', TODAY)).toMatchObject({
      title: '晨跑',
      time: '09:15'
    })
  })
})

describe('「晚上十二点」是零点', () => {
  it('晚上/今晚的 12 点归零', () => {
    expect(parseTaskInput('晚上12点提交周报', TODAY)).toEqual({ title: '提交周报', time: '00:00' })
    expect(parseTaskInput('今晚12点半提交周报', TODAY)).toEqual({
      title: '提交周报',
      time: '00:30'
    })
  })

  it('中午与下午的 12 点仍是中午', () => {
    expect(parseTaskInput('中午12点吃饭', TODAY)).toEqual({ title: '吃饭', time: '12:00' })
    expect(parseTaskInput('下午12点吃饭', TODAY)).toEqual({ title: '吃饭', time: '12:00' })
  })

  it('凌晨 12 点同样是零点', () => {
    expect(parseTaskInput('凌晨12点发版', TODAY)).toEqual({ title: '发版', time: '00:00' })
    expect(parseTaskInput('凌晨十二点发版', TODAY)).toEqual({ title: '发版', time: '00:00' })
  })
})

describe('中文数字时间', () => {
  it('一位数与十位数的中文数字', () => {
    expect(parseTaskInput('下午三点开会', TODAY)).toEqual({ title: '开会', time: '15:00' })
    expect(parseTaskInput('下午三点半开会', TODAY)).toEqual({ title: '开会', time: '15:30' })
    expect(parseTaskInput('上午十点开会', TODAY)).toEqual({ title: '开会', time: '10:00' })
    expect(parseTaskInput('十五点碰头', TODAY)).toEqual({ title: '碰头', time: '15:00' })
    expect(parseTaskInput('二十三点睡觉', TODAY)).toEqual({ title: '睡觉', time: '23:00' })
    expect(parseTaskInput('早上九点十五分 晨跑', TODAY)).toEqual({ title: '晨跑', time: '09:15' })
  })

  it('「十点一刻」「十点三刻」按刻计', () => {
    expect(parseTaskInput('十点一刻开会', TODAY)).toEqual({ title: '开会', time: '10:15' })
    expect(parseTaskInput('十点三刻开会', TODAY)).toEqual({ title: '开会', time: '10:45' })
  })

  it('「零」与「两」也算数字', () => {
    expect(parseTaskInput('下午两点开会', TODAY)).toEqual({ title: '开会', time: '14:00' })
    expect(parseTaskInput('零点出发', TODAY)).toEqual({ title: '出发', time: '00:00' })
  })

  it('不含数词的「点」不当作时间', () => {
    expect(parseTaskInput('有一点问题需要处理', TODAY)).toEqual({ title: '有一点问题需要处理' })
    expect(parseTaskInput('看两点半的资料', TODAY)).toEqual({ title: '看两点半的资料' })
    expect(parseTaskInput('关注重点问题', TODAY)).toEqual({ title: '关注重点问题' })
  })

  it('没有时段前缀时，一/两/二 点不当作钟点', () => {
    expect(parseTaskInput('一点意见想提', TODAY)).toEqual({ title: '一点意见想提' })
    expect(parseTaskInput('两点建议', TODAY)).toEqual({ title: '两点建议' })
    expect(parseTaskInput('二点注意事项', TODAY)).toEqual({ title: '二点注意事项' })
  })

  it('带时段前缀时，一/两 点仍识别为钟点', () => {
    expect(parseTaskInput('下午一点开会', TODAY)).toEqual({ title: '开会', time: '13:00' })
    expect(parseTaskInput('凌晨两点出发', TODAY)).toEqual({ title: '出发', time: '02:00' })
  })
})

describe('相对天数', () => {
  it('阿拉伯数字与中文数字的「N 天后 / N 周后」', () => {
    expect(parseTaskInput('3 天后复盘', TODAY)).toEqual({ title: '复盘', dueDate: '2026-10-27' })
    expect(parseTaskInput('三天后复盘', TODAY)).toEqual({ title: '复盘', dueDate: '2026-10-27' })
    expect(parseTaskInput('7天后复盘', TODAY)).toEqual({ title: '复盘', dueDate: '2026-10-31' })
    expect(parseTaskInput('2周后复盘', TODAY)).toEqual({ title: '复盘', dueDate: '2026-11-07' })
    expect(parseTaskInput('两周后复盘', TODAY)).toEqual({ title: '复盘', dueDate: '2026-11-07' })
  })

  it('「N 天后」带截止语时一并吃掉', () => {
    expect(parseTaskInput('3 天后前交报告', TODAY)).toEqual({
      title: '交报告',
      dueDate: '2026-10-27'
    })
  })

  it('「天后」「周末」这类词不被误判', () => {
    expect(parseTaskInput('关注天后现象', TODAY)).toEqual({ title: '关注天后现象' })
    expect(parseTaskInput('周末复盘', TODAY)).toEqual({ title: '周末复盘' })
  })
})
