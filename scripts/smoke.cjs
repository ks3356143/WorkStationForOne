const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')
const { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')

// 冒烟跑真实主进程：SQLite、preload 与 IPC 全部走生产路径。
// 数据库、Chromium 存储与单实例锁都隔离到临时目录，避免污染真实工作站。
// 退出时 Chromium 仍持有缓存句柄，当次目录删不干净；改为启动时清理一小时前的残留。
function pruneStaleDirs() {
  const base = tmpdir()
  for (const name of readdirSync(base)) {
    if (!name.startsWith('ws-smoke-')) continue
    const path = join(base, name)
    try {
      if (Date.now() - statSync(path).mtimeMs < 60 * 60 * 1000) continue
      rmSync(path, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
    } catch {
      // 被其他进程占用时留到下次启动再清。
    }
  }
}

pruneStaleDirs()

const dataDir = mkdtempSync(join(tmpdir(), 'ws-smoke-'))
const userDir = join(dataDir, 'user')
const sessionDir = join(dataDir, 'session')
mkdirSync(userDir, { recursive: true })
mkdirSync(sessionDir, { recursive: true })
app.setPath('userData', userDir)
app.setPath('sessionData', sessionDir)
process.env.WS_DATA_DIR = join(dataDir, 'db')
// Agent 走 stub CLI：验证真实 IPC → 子进程 → 渲染整条链路，但不调用模型、不消耗额度
process.env.WS_AGENT_CLI = join(__dirname, 'stub-agent.cjs')
// 提醒轮询调快，并把命中记录写到文件，供主进程侧断言
const reminderLog = join(dataDir, 'reminders.log')
process.env.WS_REMINDER_TICK_MS = '400'
process.env.WS_REMINDER_LOG = reminderLog

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const consoleErrors = []
let win = null

app.on('browser-window-created', (_event, created) => {
  // 生产窗口默认允许节流；冒烟要按真实时间等待动画与 IPC 回包。
  created.webContents.setBackgroundThrottling(false)
  created.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      consoleErrors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`)
    }
  })
  if (!win) win = created
})

// 加载真实入口：单实例锁、数据库、IPC 与 preload 都由它建立。
require('../out/main/index.js')

async function waitForWindow(timeout = 20_000) {
  const started = Date.now()
  while (!win && Date.now() - started < timeout) await sleep(100)
  if (!win) throw new Error('主窗口未创建：确认 out/ 已构建，且没有实例占用同一 userData')
  return win
}

async function run() {
  await waitForWindow()
  if (win.webContents.isLoading()) {
    await new Promise((resolve) => win.webContents.once('did-finish-load', resolve))
  }
  win.setAlwaysOnTop(true, 'screen-saver')
  win.show()
  win.focus()
  await sleep(1800)

  // Injected as a template literal: regex backslashes need double escaping.
  let results
  try {
    results = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    const all = (sel) => [...document.querySelectorAll(sel)]
    const one = (sel) => document.querySelector(sel)
    const byText = (sel, text) => all(sel).find((el) => el.textContent.includes(text))
    const activeNav = () => one('.w1-navitem.on .w1-navtext b')?.textContent?.trim() ?? ''
    const navTo = async (label) => {
      const item = all('.w1-navitem').find((el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === label)
      item?.click()
      await sleep(600)
      return item
    }
    const taskScopeTo = async (label) => {
      const item = all('.w1-todorow').find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === label
      )
      item?.click()
      await sleep(400)
      return Boolean(item)
    }
    const taskRow = (text) => all('.w1-todorowwrap').find((el) => el.textContent?.includes(text))
    const setValue = (el, value) => {
      if (!el) throw new Error('setValue target missing')
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const openPalette = async (wait = 600) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
      await sleep(wait)
    }
    const checks = []
    const check = (name, ok, detail = '') => {
      checks.push({ name, ok, detail })
      window.__smokeProgress = checks.map((item) => item.name)
    }

    check('左侧导航五个入口', all('.w1-navitem').length === 5, String(all('.w1-navitem').length))
    check(
      'preload 桥可用（真实 IPC 路径）',
      typeof window.ws?.tasks?.list === 'function' &&
        typeof window.ws?.notes?.page === 'function' &&
        typeof window.ws?.learning?.list === 'function',
      typeof window.ws
    )
    check(
      '导航顺序为今日任务 Agent 笔记 学习',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/') === '今日/任务/Agent/笔记/学习',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/')
    )
    check('默认停在今日', activeNav() === '今日', activeNav())
    check('今日看板可见', !!one('.w1-main'))
    check('完成热力图可见', !!one('.w1-heat'))
    check(
      '热力图按 26 周 × 7 天渲染',
      all('.w1-heatcol').length === 26 && all('.w1-heatcol i').length === 182,
      all('.w1-heatcol').length + ' × ' + all('.w1-heatcol i').length
    )
    check(
      '热力图统计文案',
      one('.w1-heatstats')?.textContent?.includes('项完成') ?? false,
      one('.w1-heatstats')?.textContent ?? ''
    )
    check('看板与 Agent 不同时可见', !one('.w1-dock') && !one('.w1-agent'))
    check('初始任务 8 项', all('.w1-task').length === 8, String(all('.w1-task').length))
    check('初始完成 2 项', all('.w1-task.done').length === 2, String(all('.w1-task.done').length))
    check('状态栏待审批 1', byText('.w1-sbtn.pending', '待审批 1') !== undefined)
    check(
      '舰队总览统计会话',
      one('.w1-fleet .w1-frow')?.textContent?.includes('5') &&
        one('.w1-fleet .w1-frow')?.textContent?.includes('待确认'),
      one('.w1-fleet .w1-frow')?.textContent ?? ''
    )
    const launchNames = all('.w1-launch .w1-lname')
    check(
      '外部启动器名称有宽度',
      launchNames.length === 2 && launchNames.every((el) => el.getBoundingClientRect().width > 30),
      launchNames.map((el) => el.textContent + ':' + Math.round(el.getBoundingClientRect().width)).join(' ')
    )

    const themeBefore = document.documentElement.dataset.theme
    const fgBefore = getComputedStyle(one('.w1')).getPropertyValue('--fg').trim()
    check('状态栏有主题按钮', !!one('.w1-theme'), one('.w1-theme')?.textContent ?? '')
    one('.w1-theme')?.click()
    await sleep(350)
    const themeAfter = document.documentElement.dataset.theme
    const fgAfter = getComputedStyle(one('.w1')).getPropertyValue('--fg').trim()
    check(
      '主题可切换',
      themeAfter === (themeBefore === 'light' ? 'dark' : 'light'),
      themeBefore + ' -> ' + themeAfter
    )
    check('主题令牌生效', themeAfter !== themeBefore && fgAfter !== fgBefore && fgAfter.length > 0, fgBefore + ' -> ' + fgAfter)
    check(
      '主题写入本地存储',
      localStorage.getItem('workstation.theme') === themeAfter,
      String(localStorage.getItem('workstation.theme'))
    )
    check('主题切换有提示', one('.w1-toast')?.textContent?.includes('模式'), one('.w1-toast')?.textContent ?? '')
    one('.w1-theme')?.click()
    await sleep(350)
    check('主题可切回', document.documentElement.dataset.theme === themeBefore, document.documentElement.dataset.theme)
    one('.w1-theme')?.blur()

    await navTo('任务')
    check('导航切换到任务', activeNav() === '任务' && !!one('.w1-todos'), activeNav())
    check(
      '任务工作区与其他视图互斥',
      !one('.w1-main') && !one('.w1-agent') && !one('.w1-notesview') && !one('.w1-learn'),
      activeNav()
    )
    check(
      '任务默认停在今天',
      all('.w1-todorow').find((el) => el.classList.contains('on'))?.textContent?.includes('今天'),
      all('.w1-todorow').find((el) => el.classList.contains('on'))?.textContent ?? ''
    )
    check('今天清单 6 项', all('.w1-todorowwrap').length === 6, String(all('.w1-todorowwrap').length))
    check(
      '任务行显示清单与优先级',
      taskRow('重构 auth 模块')?.textContent?.includes('#工作') &&
        taskRow('重构 auth 模块')?.textContent?.includes('高'),
      taskRow('重构 auth 模块')?.textContent ?? ''
    )

    const quickInput = one('.w1-todoinput')
    setValue(quickInput, '明天 15:00 提交周报 !高 #工作')
    await sleep(250)
    check(
      '快速添加解析预览',
      ['明天', '15:00', '高', '#工作'].every((part) =>
        one('.w1-todoquickhint')?.textContent?.includes(part)
      ),
      one('.w1-todoquickhint')?.textContent ?? ''
    )
    const hlMarks = all('.w1-hlk')
    check(
      '输入框内联高亮四类 token',
      hlMarks.length === 4 &&
        hlMarks.map((el) => el.textContent).join('|') === '明天|15:00|!高|#工作',
      hlMarks.map((el) => el.textContent).join('|')
    )
    check(
      '高亮按种类着色',
      hlMarks
        .map((el) => [...el.classList].find((name) => name.startsWith('w1-hlk-')) ?? '')
        .join(',') === 'w1-hlk-date,w1-hlk-time,w1-hlk-priority,w1-hlk-list',
      hlMarks.map((el) => [...el.classList].join('.')).join(' / ')
    )
    quickInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true, bubbles: true })
    )
    await sleep(200)
    check(
      '输入法组合中的 Enter 不提交',
      quickInput.value !== '' && taskRow('提交周报') === undefined,
      quickInput.value
    )
    quickInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(500)
    check('快速添加后清空输入', quickInput.value === '')
    check(
      '快速添加提示去向',
      one('.w1-toast')?.textContent?.includes('已添加「提交周报」'),
      one('.w1-toast')?.textContent ?? ''
    )
    await taskScopeTo('即将到来')
    check(
      '新任务进入即将到来并带日期',
      taskRow('提交周报') !== undefined && taskRow('提交周报')?.textContent?.includes('明天 15:00'),
      taskRow('提交周报')?.textContent ?? ''
    )

    taskRow('提交周报')?.querySelector('.w1-todobody')?.click()
    await sleep(300)
    check('任务详情可展开', !!one('.w1-todoedit') && !!one('.w1-tododatequick'))
    setValue(one('.w1-todoedit input[id^="todo-title-"]'), '提交周报 v2')
    setValue(one('.w1-todoedit textarea[id^="todo-notes-"]'), '补充备注')
    setValue(one('.w1-todoedit input[id^="todo-list-"]'), '验证二')
    byText('.w1-todopriopt', '中')?.click()
    await sleep(150)
    one('.w1-todosave')?.click()
    await sleep(400)
    check(
      '任务标题与详情可编辑保存',
      taskRow('提交周报 v2') !== undefined &&
        taskRow('提交周报 v2')?.textContent?.includes('#验证二') &&
        taskRow('提交周报 v2')?.textContent?.includes('中') &&
        taskRow('提交周报 v2')?.textContent?.includes('备注') &&
        !one('.w1-todoedit') &&
        document.activeElement?.classList.contains('w1-todobody'),
      taskRow('提交周报 v2')?.textContent ?? ''
    )

    taskRow('提交周报 v2')?.querySelector('.w1-todocb')?.click()
    await sleep(400)
    check('完成后离开即将到来', taskRow('提交周报 v2') === undefined, all('.w1-todorowwrap').length)
    await taskScopeTo('已完成')
    check('已完成包含刚完成的任务', taskRow('提交周报 v2') !== undefined)

    taskRow('提交周报 v2')?.querySelector('.w1-todobody')?.click()
    await sleep(300)
    one('.w1-tododelete')?.click()
    await sleep(150)
    check('删除需要二次确认', byText('.w1-tododelete', '再次点击确认删除') !== undefined)
    one('.w1-tododelete')?.click()
    await sleep(400)
    check('删除任务后列表移除', taskRow('提交周报 v2') === undefined)

    await taskScopeTo('全部任务')
    const taskSearch = one('.w1-todosearch input')
    setValue(taskSearch, 'auth')
    await sleep(300)
    check(
      '任务搜索命中标题',
      all('.w1-todorowwrap').length === 1 && taskRow('重构 auth 模块') !== undefined,
      String(all('.w1-todorowwrap').length)
    )
    one('.w1-todosearch button')?.click()
    await sleep(300)
    check('清空任务搜索恢复', all('.w1-todorowwrap').length === 6, String(all('.w1-todorowwrap').length))

    // 清单重命名：行内输入、Enter 提交、Esc 取消、重名被拦
    const listEdit = all('.w1-todolistedit').find((el) =>
      el.getAttribute('aria-label')?.includes('工作')
    )
    check('清单行有重命名入口', Boolean(listEdit), String(all('.w1-todolistedit').length))
    listEdit?.click()
    await sleep(250)
    const renameInput = one('.w1-todorenaming')
    check('点击后出现行内输入框', Boolean(renameInput), one('.w1-todorail')?.textContent ?? '')
    setValue(renameInput, '工作流')
    await sleep(60)
    renameInput?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(450)
    const listLabels = () => all('.w1-todolistrow .w1-todolabel').map((el) => el.textContent)
    check(
      '重命名后清单栏更新',
      listLabels().includes('工作流') && !listLabels().includes('工作'),
      listLabels().join('|')
    )
    check(
      '重命名后任务行跟着改',
      all('.w1-todorowwrap').some((el) => el.textContent?.includes('#工作流')) ||
        one('.w1-todomain')?.textContent?.includes('工作流'),
      all('.w1-todorowwrap').length + ' 行'
    )

    all('.w1-todolistedit')
      .find((el) => el.getAttribute('aria-label')?.includes('工作流'))
      ?.click()
    await sleep(250)
    const dupInput = one('.w1-todorenaming')
    setValue(dupInput, '学习')
    await sleep(60)
    dupInput?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check(
      '重名被拦下并给出提示',
      one('.w1-todolisthint')?.textContent?.includes('已存在同名清单') && Boolean(one('.w1-todorenaming')),
      one('.w1-todolisthint')?.textContent ?? 'missing'
    )
    one('.w1-todorenaming')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await sleep(250)
    check(
      'Esc 取消重命名且清单未变',
      !one('.w1-todorenaming') && listLabels().includes('工作流'),
      listLabels().join('|')
    )

    // 只做三件事：从全部未完成里挑三条，完成一条自动补位
    const threeBtn = byText('.w1-planbtn', '只做三件事')
    threeBtn?.click()
    await sleep(350)
    check(
      '开启后只显示三条',
      all('.w1-todorowwrap').length === 3 && !!one('.w1-threebar'),
      all('.w1-todorowwrap').length + ' 行'
    )
    check(
      '三件事横幅不撑出横向滚动',
      document.documentElement.scrollWidth <= innerWidth,
      document.documentElement.scrollWidth + ' / ' + innerWidth
    )
    const firstTitle = one('.w1-todorowwrap .w1-todotitletext')?.textContent?.trim() ?? ''
    one('.w1-todorowwrap .w1-todocb')?.click()
    await sleep(600)
    const afterTitles = all('.w1-todorowwrap .w1-todotitletext').map((el) =>
      el.textContent?.trim() ?? ''
    )
    check(
      '完成一件后自动补位仍是三条',
      afterTitles.length === 3 && firstTitle !== '' && !afterTitles.includes(firstTitle),
      firstTitle + ' -> ' + afterTitles.join(' / ')
    )
    byText('.w1-threebar button', '退出')?.click()
    await sleep(300)
    check(
      '退出后恢复完整列表',
      !one('.w1-threebar') && all('.w1-todorowwrap').length >= 3,
      String(all('.w1-todorowwrap').length)
    )
    // 把刚才勾掉的任务还原：它已离开未完成列表，得去「已完成」里取消勾选
    byText('.w1-todorow', '已完成')?.click()
    await sleep(400)
    const doneRow = all('.w1-todorowwrap').find(
      (row) => row.querySelector('.w1-todotitletext')?.textContent?.trim() === firstTitle
    )
    doneRow?.querySelector('.w1-todocb')?.click()
    await sleep(500)
    byText('.w1-todorow', '今天')?.click()
    await sleep(400)
    check(
      '还原被勾选的任务',
      all('.w1-todotitletext').some((el) => el.textContent?.trim() === firstTitle),
      firstTitle
    )

    // 重复任务：设成每周后完成，应自动生成下一周的实例（落在「即将到来」）
    const repeatInput = one('.w1-todoinput')
    setValue(repeatInput, '每周复盘')
    await sleep(120)
    repeatInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(600)
    all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('每周复盘'))
      ?.querySelector('.w1-todobody')
      ?.click()
    await sleep(400)
    byText('.w1-todoedit .w1-todopriopt', '每周')?.click()
    await sleep(120)
    byText('.w1-todoedit .w1-todosave', '保存')?.click()
    await sleep(600)
    const badge = all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('每周复盘'))
      ?.querySelector('.w1-todorepeat')?.textContent
    check('保存后任务显示重复标记', badge === '↻ 每周', badge ?? 'missing')

    all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('每周复盘'))
      ?.querySelector('.w1-todocb')
      ?.click()
    await sleep(800)
    const repeated = await window.ws.tasks.list()
    const copies = repeated.filter((task) => task.title === '每周复盘')
    const openCopy = copies.find((task) => !task.done)
    const todayKey = new Date().toLocaleDateString('sv-SE')
    const expectedDue = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString('sv-SE')
    check(
      '完成后自动生成下一周的实例',
      copies.length === 2 && Boolean(openCopy) && openCopy.dueDate === expectedDue,
      copies.map((task) => (task.done ? 'done@' : 'open@') + (task.dueDate ?? '-')).join(' / ')
    )
    check('新实例落在今天之后', openCopy?.dueDate !== todayKey, openCopy?.dueDate ?? '-')

    // 收尾：完成态在「已完成」里，下一轮在「即将到来」里，分别删掉
    const removeRow = async (row) => {
      row?.querySelector('.w1-todobody')?.click()
      await sleep(300)
      byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
      await sleep(150)
      byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
      await sleep(400)
    }
    byText('.w1-todorow', '已完成')?.click()
    await sleep(400)
    await removeRow(
      all('.w1-todorowwrap').find((item) => item.textContent?.includes('每周复盘'))
    )
    byText('.w1-todorow', '即将到来')?.click()
    await sleep(400)
    await removeRow(
      all('.w1-todorowwrap').find((item) => item.textContent?.includes('每周复盘'))
    )
    byText('.w1-todorow', '今天')?.click()
    await sleep(400)
    // 到点提醒：建一条时间为「当前时刻」的今日任务，等主进程轮询命中。
    // 轮询按分钟精确匹配；这 1.4 秒内若跨过分钟边界就可能错过，此时删掉重建一次。
    const addReminderTask = async () => {
      const clock = new Date().toTimeString().slice(0, 5)
      const input = one('.w1-todoinput')
      setValue(input, '提醒测试 ' + clock)
      await sleep(120)
      input.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      await sleep(1400)
      return new Date().toTimeString().slice(0, 5) === clock
    }
    const removeReminderTask = async () => {
      const row = all('.w1-todorowwrap').find((item) => item.textContent?.includes('提醒测试'))
      if (!row) return
      row.querySelector('.w1-todobody')?.click()
      await sleep(300)
      byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
      await sleep(150)
      byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
      await sleep(400)
    }
    let reminderSameMinute = false
    for (let attempt = 0; attempt < 3 && !reminderSameMinute; attempt += 1) {
      reminderSameMinute = await addReminderTask()
      if (!reminderSameMinute) await removeReminderTask()
    }
    check('提醒轮询期间同分钟未跨界', reminderSameMinute)
    await removeReminderTask()

    check(
      '循环任务两条都已清理',
      !all('.w1-todorowwrap').some((item) => item.textContent?.includes('每周复盘')),
      String(all('.w1-todorowwrap').length)
    )


    const planButton = byText('button', '计划今天')
    check('任务区有计划今天入口', Boolean(planButton))
    planButton?.click()
    await sleep(400)
    check('计划面板与容量条', !!one('.w1-plan') && !!one('.w1-plan .w1-cap'))
    const planCols = all('.w1-plancol')
    const beforePlanned = planCols[1]?.querySelectorAll('.w1-planrow').length ?? 0
    planCols[0]?.querySelector('.w1-planrow')?.click()
    await sleep(300)
    const afterPlanned = all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0
    check('加入今天后进入已计划列', afterPlanned === beforePlanned + 1, beforePlanned + '->' + afterPlanned)
    byText('.w1-planfoot button', '完成')?.click()
    await sleep(300)
    check('计划面板可关闭', !one('.w1-plan'))

    const scheduleButton = byText('button', '排程预览')
    check('任务区有排程预览入口', Boolean(scheduleButton))
    scheduleButton?.click()
    await sleep(400)
    check('排程预览面板打开', !!one('.w1-sched') && !!one('.w1-schedlist'))
    check(
      '排程预览有结果或空态',
      !!one('.w1-schedempty') || all('.w1-schedblock').length > 0 || all('.w1-schedrow').length > 0,
      all('.w1-schedblock').length + '/' + all('.w1-schedrow').length
    )
    byText('.w1-schedfoot button', '取消')?.click()
    await sleep(300)
    check('排程预览可关闭', !one('.w1-sched'))

    check('View Transitions API 可用', typeof document.startViewTransition === 'function')
    const vtNames = all('.w1-todorowwrap').map(
      (el) => getComputedStyle(el).viewTransitionName ?? ''
    )
    check(
      '任务行有唯一过渡名',
      vtNames.length > 0 && new Set(vtNames).size === vtNames.length && vtNames.every((name) => name.startsWith('task-')),
      String(vtNames.length) + '/' + String(new Set(vtNames).size)
    )
    window.__vt = 0
    const originalVt = document.startViewTransition?.bind(document)
    document.startViewTransition = (callback) => {
      window.__vt += 1
      return originalVt(callback)
    }
    one('.w1-todorowwrap .w1-todobody')?.click()
    await sleep(400)
    one('.w1-todosave')?.click()
    await sleep(500)
    document.startViewTransition = originalVt
    check('保存走 View Transition', window.__vt >= 1, String(window.__vt))
    setValue(taskSearch, 'auth')
    await sleep(250)
    taskSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check(
      '任务搜索 Esc 清空',
      taskSearch.value === '' && all('.w1-todorowwrap').length === 6,
      taskSearch.value + ' · ' + all('.w1-todorowwrap').length
    )
    setValue(taskSearch, 'auth')
    await sleep(250)
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    await sleep(400)
    check(
      '搜索中新建任务会清空搜索并聚焦',
      taskSearch.value === '' && document.activeElement === one('.w1-todoinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    taskRow('周报收尾')?.querySelector('.w1-todobody')?.click()
    await sleep(250)
    one('.w1-todoedit input[id^="todo-title-"]')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await sleep(300)
    check(
      'Esc 收起任务详情但不离开视图',
      !one('.w1-todoedit') &&
        activeNav() === '任务' &&
        document.activeElement?.classList.contains('w1-todobody'),
      document.activeElement?.className?.toString?.() ?? activeNav()
    )

    const railItem = (label) =>
      all('.w1-todorow').find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === label
      )
    const dragTo = async (fromRow, target, wait = 700) => {
      if (!fromRow || !target) return false
      const dt = new DataTransfer()
      fromRow
        .querySelector('.w1-tododrag')
        ?.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }))
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await sleep(90)
      const highlighted = target.classList.contains('drop')
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }))
      await sleep(wait)
      return highlighted
    }

    railItem('今天')?.click()
    await sleep(450)
    const todayBefore = all('.w1-todorowwrap').length
    const dragRow = all('.w1-todorowwrap')[0]
    const dragTitle = dragRow?.querySelector('.w1-todotitletext')?.textContent?.trim() ?? ''

    const highlighted = await dragTo(dragRow, railItem('即将到来'))
    check('拖拽悬停高亮清单', highlighted)
    check(
      '拖到即将到来后离开今天',
      Boolean(dragTitle) && !taskRow(dragTitle) && all('.w1-todorowwrap').length === todayBefore - 1,
      dragTitle + ' · ' + all('.w1-todorowwrap').length + '/' + todayBefore
    )
    railItem('即将到来')?.click()
    await sleep(450)
    check('任务出现在即将到来清单', Boolean(taskRow(dragTitle)))

    await dragTo(taskRow(dragTitle), railItem('今天'))
    railItem('今天')?.click()
    await sleep(500)
    check(
      '拖回今天后恢复',
      Boolean(taskRow(dragTitle)) && all('.w1-todorowwrap').length === todayBefore,
      dragTitle + ' · ' + all('.w1-todorowwrap').length + '/' + todayBefore
    )

    await navTo('今日')
    one('.w1-ctlink')?.click()
    await sleep(500)
    check('今日卡可进入任务工作区', activeNav() === '任务' && !!one('.w1-todos'), activeNav())
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, shiftKey: true, bubbles: true })
    )
    await sleep(350)
    check(
      'Ctrl+Shift+N 聚焦任务输入',
      document.activeElement === one('.w1-todoinput') && activeNav() === '任务',
      document.activeElement?.className?.toString?.() ?? ''
    )
    await navTo('今日')

    one('.w1-motion')?.focus()
    await openPalette()
    const taskCommandInput = one('.w1-paletteinput')
    setValue(taskCommandInput, '新建任务')
    await sleep(300)
    taskCommandInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(600)
    check(
      '命令面板新建任务聚焦输入',
      activeNav() === '任务' && document.activeElement === one('.w1-todoinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    await navTo('今日')

    await navTo('Agent')
    check('导航切换到 Agent', activeNav() === 'Agent', activeNav())
    check('Agent 工作区出现', !!one('.w1-agent') && !!one('.w1-dock') && !!one('.w1-rail'))
    check('切换后今日看板隐藏', !one('.w1-main'))
    check('Agent 会话列表完整', all('.w1-sess').length === 5, String(all('.w1-sess').length))
    check('初始权限卡存在', !!one('.w1-perm'))
    check(
      '权限变更逐行可扫读',
      all('.w1-dchange').length === 3 &&
        all('.w1-dchange')[0]?.querySelector('.w1-dline.ins')?.textContent === '明天 09:00',
      String(all('.w1-dchange').length)
    )

    await navTo('今日')
    check('导航可回到今日', activeNav() === '今日' && !!one('.w1-main'))
    check('回看板后 Agent 工作区隐藏', !one('.w1-dock') && !one('.w1-agent'))
    one('.w1-sbtn.pending')?.click()
    await sleep(600)
    check('状态栏待审批跳到 Agent', activeNav() === 'Agent' && !!one('.w1-perm'), activeNav())

    byText('.w1-sess', '修复登录 500')?.click()
    await sleep(600)
    check('切换会话标题', one('.w1-tdiv')?.textContent?.includes('修复登录 500'), one('.w1-tdiv')?.textContent ?? '')
    check('其他会话不显示权限卡', !one('.w1-perm'))
    byText('.w1-sess', '重构 auth 模块')?.click()
    await sleep(300)
    check('切回会话显示权限卡', !!one('.w1-perm'))

    one('.w1-perm .w1-pb.pri')?.click()
    await sleep(700)
    check('允许后权限卡消失', !one('.w1-perm'))
    check('允许后有结果提示', one('.w1-resolved')?.textContent?.includes('已允许'), one('.w1-resolved')?.textContent ?? '')
    check('允许后状态栏无待审批', one('.w1-status')?.textContent?.includes('无待审批'))

    const input = one('#composer-input')
    setValue(input, '测一下多会话回复')
    await sleep(80)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check('发送后出现等待动画', !!one('.w1-typing'))
    await navTo('今日')
    await sleep(1300)
    await navTo('Agent')
    check('切换视图后仍收到助手回复', all('.w1-amsg').length >= 2, String(all('.w1-amsg').length))
    check('等待动画结束', !one('.w1-typing'))

    const streamedText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    check(
      '回复来自 CLI 的流式文本',
      streamedText.includes('先把当前看板读一遍') && streamedText.includes('读完了'),
      streamedText
    )
    const toolCard = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check(
      '工具调用渲染成卡片且状态已完成',
      toolCard?.textContent?.includes('Read') &&
        toolCard?.textContent?.includes('src/main/index.ts') &&
        toolCard?.textContent?.includes('完成'),
      toolCard?.textContent ?? 'missing'
    )
    check('真实回复不是演示文案', !streamedText.includes('我先读取今天的看板'), streamedText)

    const failInput = one('#composer-input')
    setValue(failInput, '这次注定失败')
    await sleep(80)
    failInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(900)
    const failedText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')
    check(
      'CLI 失败时明确报错',
      failedText?.classList.contains('error') === true && failedText.textContent.includes('模拟失败'),
      failedText?.textContent ?? 'missing'
    )
    check('失败后不残留等待动画', !one('.w1-typing'))

    await navTo('今日')
    check(
      '允许后任务时间写入',
      byText('.w1-task', '周报收尾')?.textContent?.includes('22:00'),
      byText('.w1-task', '周报收尾')?.textContent ?? ''
    )
    check('返回今日后仅保留今日任务', all('.w1-task').length === 6, String(all('.w1-task').length))

    const cardRow = all('.w1-task').find(
      (el) => el.dataset.taskId && !el.classList.contains('done')
    )
    const cardId = cardRow?.dataset.taskId ?? ''
    const timeline = one('.w1-tl')
    if (cardRow && timeline && cardId) {
      const dt = new DataTransfer()
      cardRow.dispatchEvent(
        new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt })
      )
      const rect = timeline.getBoundingClientRect()
      const dropX = rect.left + rect.width * 0.5
      timeline.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: dropX,
          clientY: rect.top + 10
        })
      )
      await sleep(80)
      check('时间轴拖拽高亮', timeline.classList.contains('drop'))
      timeline.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          dataTransfer: dt,
          clientX: dropX,
          clientY: rect.top + 10
        })
      )
      await sleep(450)
      const draggedTime = document
        .querySelector('.w1-task[data-task-id="' + cardId + '"] .w1-time')
        ?.textContent?.trim()
      check('拖到时间轴写入 15:30', draggedTime === '15:30', String(draggedTime))
    }
    check(
      '顺延任务离开今日',
      byText('.w1-task', '整理本周资料') === undefined && byText('.w1-task', '给妈妈回电话') === undefined
    )
    check('允许后任务提示完成', one('.w1-anote')?.textContent?.includes('已顺延 3 项任务'), one('.w1-anote')?.textContent ?? '')

    const undone = one('.w1-task:not(.done)')
    const undoneTitle = undone?.querySelector('.w1-ttext')?.textContent ?? ''
    undone?.click()
    await sleep(200)
    check('勾选任务后完成数 +1', all('.w1-task.done').length === 3, String(all('.w1-task.done').length))
    check('任务进度同步', one('.w1-tprog b')?.textContent?.includes('3 / 6'), one('.w1-tprog b')?.textContent ?? '')

    byText('.w1-filter', '已完成')?.click()
    await sleep(200)
    check('筛选已完成', all('.w1-task').length === 3, String(all('.w1-task').length))
    byText('.w1-filter', '全部')?.click()
    await sleep(200)
    check('筛选恢复全部', all('.w1-task').length === 6, String(all('.w1-task').length))

    // 子任务：父任务行显示进度，勾选后更新，删父任务连带清理
    await navTo('任务')
    await sleep(500)
    const topBefore = (await window.ws.tasks.list()).filter((task) => !task.parentId).length
    const subParent = one('.w1-todoinput')
    setValue(subParent, '整理季度复盘')
    await sleep(120)
    subParent.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(600)
    all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('整理季度复盘'))
      ?.querySelector('.w1-todobody')
      ?.click()
    await sleep(400)
    const subInput = one('.w1-todosubadd input')
    check('详情里有子任务输入框', Boolean(subInput))
    for (const title of ['收集数据', '写结论']) {
      setValue(subInput, title)
      await sleep(80)
      subInput.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      )
      await sleep(500)
    }
    check(
      '子任务出现在详情里',
      all('.w1-todosubrow').length === 2,
      String(all('.w1-todosubrow').length)
    )
    one('.w1-todosubrow .w1-todocb')?.click()
    await sleep(500)
    const subBadge = all('.w1-todorowwrap')
      .find((row) => row.textContent?.includes('整理季度复盘'))
      ?.querySelector('.w1-todosubcount')?.textContent
    check('父任务行显示 1/2 进度', subBadge === '1/2', subBadge ?? 'missing')
    const subCounts = await window.ws.tasks.list()
    check(
      '子任务不进入清单计数',
      subCounts.filter((task) => !task.parentId).length === topBefore + 1,
      topBefore + ' -> ' + subCounts.filter((task) => !task.parentId).length
    )
    // 删掉父任务：子任务应一起软删
    byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
    await sleep(150)
    byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
    await sleep(600)
    const afterDelete = await window.ws.tasks.list()
    check(
      '删除父任务后子任务一并移除',
      !afterDelete.some((task) => task.parentId),
      String(afterDelete.filter((task) => task.parentId).length)
    )

    // 设置面板：从左侧导航打开，读到真实数据路径与版本
    await navTo('今日')
    one('.w1-settings')?.click()
    await sleep(600)
    check('设置面板可打开', !!one('.w1-settings-sheet'), one('.w1-navver')?.textContent ?? '')
    const settingsText = one('.w1-settings-sheet')?.textContent ?? ''
    check(
      '设置面板显示版本与数据路径',
      settingsText.includes('当前版本 v') && settingsText.includes('ws-smoke-'),
      settingsText.slice(0, 120)
    )
    check(
      '设置面板读到备份份数',
      settingsText.includes('份 ·'),
      one('.w1-setpath')?.textContent ?? ''
    )
    const themeBtnBefore = document.documentElement.dataset.theme
    const themeBtns = all('.w1-setbtn')
    themeBtns[0]?.click()
    await sleep(500)
    const themeBtnAfter = document.documentElement.dataset.theme
    check('设置里可切换主题', themeBtnBefore !== themeBtnAfter, themeBtnBefore + ' -> ' + themeBtnAfter)
    all('.w1-setbtn')[0]?.click()
    await sleep(500)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(400)
    check('Esc 关闭设置面板', !one('.w1-settings-sheet'))

    const habitCard = all('.w1-card').find((card) => card.textContent?.includes('习惯打卡'))
    const habitBefore = habitCard?.querySelector('.w1-ct span')?.textContent ?? ''
    one('.w1-hdot.today:not(.on)')?.click()
    await sleep(250)
    const habitAfter = habitCard?.querySelector('.w1-ct span')?.textContent ?? ''
    const habitCount = (text) => Number.parseInt(text, 10)
    check(
      '今日习惯可打卡',
      habitCount(habitAfter) === habitCount(habitBefore) + 1,
      habitBefore + ' -> ' + habitAfter
    )
    const habitKey = new Date().toLocaleDateString('sv-SE')
    const storedHabits = await window.ws.habits.list()
    const habitStored = {
      total: storedHabits.length,
      checkedToday: storedHabits.filter((habit) => habit.checkins.includes(habitKey)).length
    }
    check(
      '习惯行显示连续天数',
      all('.w1-hstreak').length >= 1 &&
        all('.w1-hstreak').every((el) => /^[0-9]+$/.test(el.textContent?.trim() ?? '')),
      all('.w1-hstreak')
        .map((el) => el.textContent?.trim())
        .join(',')
    )
    check(
      '习惯打卡已落库',
      habitStored?.total > 0 && habitStored?.checkedToday >= 1,
      JSON.stringify(habitStored)
    )

    byText('.w1-btn', '快速笔记')?.click()
    await sleep(350)
    check('快速笔记弹窗', !!one('.w1-modal'))
    const textarea = one('.w1-noteinput')
    setValue(textarea, '来自自动化冒烟测试的笔记')
    await sleep(80)
    byText('.w1-modalacts .w1-pb', '保存笔记')?.click()
    await sleep(650)
    check('笔记弹窗关闭', !one('.w1-modal'))
    check('笔记写入列表', one('.w1-nlist')?.textContent?.includes('来自自动化冒烟测试的笔记'), one('.w1-nlist')?.textContent ?? '')

    byText('.w1-btn', '开始专注')?.click()
    await sleep(400)
    check('专注模式打开', !!one('.w1-focus'))
    one('.w1-focus .w1-pb.pri')?.click()
    await sleep(600)
    check('专注模式关闭', !one('.w1-focus'))

    byText('.w1-tlblk', '深度工作')?.click()
    await sleep(400)
    check(
      '时间块可开始专注',
      one('.w1-focus')?.textContent?.includes('深度工作 · 10:30'),
      one('.w1-focus')?.textContent?.slice(0, 60) ?? ''
    )
    one('.w1-focus .w1-pb.pri')?.click()
    await sleep(600)
    check('时间块专注可关闭', !one('.w1-focus'))

    one('.w1-motion')?.click()
    await sleep(150)
    check('动效可暂停', one('.w1')?.classList.contains('motion-off'))
    one('.w1-motion')?.click()
    await sleep(150)
    check('动效可恢复', !one('.w1')?.classList.contains('motion-off'))
    one('.w1-motion')?.focus()

    await openPalette()
    check('Ctrl K 打开命令面板', !!one('.w1-palette'))
    check(
      '命令面板输入自动聚焦',
      document.activeElement?.classList.contains('w1-paletteinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    const paletteInput = one('.w1-paletteinput')
    setValue(paletteInput, '登录')
    await sleep(300)
    const selectedSession = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '搜索命中会话时优先会话',
      selectedSession.includes('修复登录 500') && !selectedSession.includes('发送给'),
      selectedSession
    )
    paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(700)
    check(
      '命令面板跳转会话并切换视图',
      !one('.w1-palette') && activeNav() === 'Agent' && one('.w1-tdiv')?.textContent?.includes('修复登录 500'),
      activeNav() + ' · ' + (one('.w1-tdiv')?.textContent ?? '')
    )
    check(
      '命令面板关闭后焦点归位',
      document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    await navTo('今日')
    one('.w1-motion')?.focus()
    await openPalette()
    const filterInput = one('.w1-paletteinput')
    setValue(filterInput, '待办')
    await sleep(300)
    const selectedFilter = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '搜索命中操作时优先操作',
      selectedFilter.includes('待办') && !selectedFilter.includes('发送给'),
      selectedFilter
    )
    filterInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(700)
    check('命令面板可执行筛选', all('.w1-task').length === 3, String(all('.w1-task').length))
    byText('.w1-filter', '全部')?.click()
    await sleep(250)
    check('筛选恢复全部', all('.w1-task').length === 6, String(all('.w1-task').length))
    one('.w1-motion')?.focus()

    await openPalette()
    const viewInput = one('.w1-paletteinput')
    setValue(viewInput, '打开全部笔记')
    await sleep(300)
    viewInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(700)
    check(
      '命令面板可切换工作区',
      !one('.w1-palette') && activeNav() === '笔记' && !!one('.w1-notesview'),
      activeNav()
    )
    check('笔记页是独立工作区', !one('.w1-dock') && !one('.w1-main'))

    const noteSearch = one('.w1-nvinput')
    if (!noteSearch) {
      throw new Error(JSON.stringify({
        noteView: !!one('.w1-notesview'),
        noteInputs: all('.w1-nvsearch input').length,
        stage: one('.w1-stage')?.textContent?.slice(0, 200) ?? '',
        active: one('.w1-navitem.on')?.textContent ?? ''
      }))
    }
    setValue(noteSearch, '线代')
    await sleep(400)
    check('笔记页可搜索', one('.w1-nvlist')?.textContent?.includes('线代'), one('.w1-nvlist')?.textContent?.slice(0, 60) ?? '')
    noteSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(400)
    check(
      'Esc 清空搜索但不离开笔记页',
      noteSearch.value === '' && activeNav() === '笔记' && all('.w1-nvrow').length >= 4,
      noteSearch.value + '|' + activeNav()
    )
    setValue(noteSearch, '线代')
    await sleep(400)
    one('.w1-nvclear')?.click()
    await sleep(400)
    check('清空搜索恢复列表', all('.w1-nvrow').length >= 4, String(all('.w1-nvrow').length))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(400)
    check('Esc 不关闭笔记工作区', activeNav() === '笔记' && !!one('.w1-notesview'), activeNav())

    // 笔记详情：编辑正文、改标签、删除
    const noteRow = all('.w1-nvrowbtn')[0]
    noteRow?.click()
    await sleep(400)
    const detail = one('.w1-notedetail')
    check('笔记行可打开详情', Boolean(detail) && !!one('.w1-notedetail-text'))
    const detailText = one('.w1-notedetail-text')
    const originalText = detailText?.value ?? ''
    setValue(detailText, originalText + '［冒烟改写］')
    await sleep(150)
    byText('.w1-notedetail .w1-pb.pri', '保存修改')?.click()
    await sleep(600)
    check(
      '笔记编辑后列表同步',
      !one('.w1-notedetail') && (one('.w1-nvlist')?.textContent ?? '').includes('冒烟改写'),
      (one('.w1-nvrow')?.textContent ?? '').slice(0, 40)
    )

    // 删除：详情里连点两次确认，删掉刚才那条
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(400)
    byText('.w1-notedetail-del', '删除')?.click()
    await sleep(150)
    byText('.w1-notedetail-del', '再次点击确认删除')?.click()
    await sleep(600)
    check(
      '笔记删除后从列表消失',
      !one('.w1-notedetail') && !(one('.w1-nvlist')?.textContent ?? '').includes('冒烟改写'),
      String(all('.w1-nvrow').length)
    )

    // 笔记转卡：详情里点「变成卡片」应跳到学习视图并留下这张卡
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(400)
    const noteTitle = (one('.w1-notedetail-text')?.value ?? '').slice(0, 12)
    byText('.w1-notedetail-card', '变成卡片')?.click()
    await sleep(800)
    check(
      '笔记可转成学习卡',
      activeNav() === '学习' &&
        all('.w1-litem').some((el) => el.textContent?.includes(noteTitle)),
      activeNav() + '|' + noteTitle
    )
    await navTo('笔记')
    await sleep(400)

    // 笔记双链：建两篇，来源引用目标，详情里能来回跳
    const createNote = async (value) => {
      one('.w1-nvnew')?.click()
      await sleep(300)
      setValue(one('.w1-modal .w1-noteinput'), value)
      byText('.w1-modalacts .w1-pb.pri', '保存笔记')?.click()
      await sleep(600)
    }
    await createNote('冒烟目标笔记\\n这是被引用的目标')
    await createNote('冒烟来源\\n先看 [[冒烟目标笔记]]')
    all('.w1-nvrowbtn')[0]?.click()
    await sleep(500)
    const linkChip = one('.w1-nlchip')
    check(
      '笔记出链可见',
      Boolean(linkChip) && (linkChip?.textContent ?? '').includes('冒烟目标笔记'),
      linkChip?.textContent ?? ''
    )
    linkChip?.click()
    await sleep(400)
    check(
      '链接跳到目标并显示反向链接',
      (one('.w1-notedetail-text')?.value ?? '').startsWith('冒烟目标笔记') &&
        (one('.w1-nlback')?.textContent ?? '').includes('冒烟来源'),
      (one('.w1-notedetail-text')?.value ?? '').slice(0, 20)
    )
    const detailBox = one('.w1-notedetail')?.getBoundingClientRect()
    check(
      '笔记详情在视口内',
      Boolean(detailBox) && detailBox.top >= 0 && detailBox.bottom <= innerHeight,
      detailBox
        ? Math.round(detailBox.top) + '–' + Math.round(detailBox.bottom) + ' / ' + innerHeight
        : '无详情'
    )
    one('.w1-modalx')?.click()
    await sleep(300)

    // ---------- 学习域 ----------
    await navTo('学习')
    check('导航切换到学习', activeNav() === '学习' && !!one('.w1-learn'), activeNav())
    check(
      '学习与其他视图互斥',
      !one('.w1-main') && !one('.w1-todos') && !one('.w1-agent') && !one('.w1-notesview'),
      activeNav()
    )
    check('学习左栏列出科目', all('.w1-learnrail .w1-todorow').length >= 3, String(all('.w1-learnrail .w1-todorow').length))
    check(
      '学习科目按卡片数降序（全部/英语二/互联网/…/已停用）',
      (() => {
        const labels = all('.w1-learnrail .w1-todolabel').map((node) => node.textContent)
        if (labels[0] !== '全部' || labels.at(-1) !== '已停用') return false
        // 中间是科目：数量必须单调不增（前面刚把一条笔记转成了卡，可能多出一个科目）
        const counts = all('.w1-learnrail .w1-todocount')
          .slice(1, -1)
          .map((node) => Number(node.textContent))
        return counts.every((value, index) => index === 0 || counts[index - 1] >= value)
      })(),
      all('.w1-learnrail .w1-todolabel').map((node) => node.textContent).join('/')
    )
    check(
      '学习默认列出全部卡片',
      all('.w1-litem').length >= 20,
      String(all('.w1-litem').length)
    )
    check(
      '学习顶部显示到期数与时长',
      one('.w1-learnmain .w1-todosub')?.textContent?.includes('分钟') ?? false,
      one('.w1-learnmain .w1-todosub')?.textContent ?? ''
    )

    const learnSearch = one('.w1-learnmain .w1-todosearch input')
    setValue(learnSearch, 'analyze')
    await sleep(350)
    check(
      '卡片搜索命中正面',
      all('.w1-litem').length === 1 && one('.w1-ltitle')?.textContent === 'analyze',
      String(all('.w1-litem').length)
    )
    learnSearch.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check('卡片搜索 Esc 清空', learnSearch.value === '' && all('.w1-litem').length >= 20, learnSearch.value)

    byText('.w1-learnrail .w1-todorow', '互联网')?.click()
    await sleep(350)
    check(
      '按科目收窄卡片',
      all('.w1-litem').length === 8,
      String(all('.w1-litem').length)
    )
    byText('.w1-learnrail .w1-todorow', '全部')?.click()
    await sleep(350)

    byText('.w1-learnrail button', '新建')?.click()
    await sleep(300)
    check('新建卡片表单内联展开', !!one('.w1-lnew'))
    setValue(one('#learn-new-subject'), '互联网')
    setValue(one('#learn-new-title'), '幂等键')
    setValue(one('#learn-new-notes'), '用于支付类接口去重')
    byText('.w1-lnew button', '保存卡片')?.click()
    await sleep(600)
    check(
      '新建卡片出现在列表',
      all('.w1-litem').some((el) => el.textContent?.includes('幂等键')) && !one('.w1-lnew'),
      String(all('.w1-litem').length)
    )

    // 挖空卡：切到挖空卡型，用 {{c1::}} 标记建一张
    byText('.w1-learnrail button', '新建')?.click()
    await sleep(300)
    byText('.w1-lkindtabs button', '挖空')?.click()
    await sleep(250)
    const clozeField = one('#learn-new-cloze')
    check('挖空卡型切出原文输入框', Boolean(clozeField))
    setValue(one('#learn-new-subject'), '互联网')
    setValue(clozeField, '冒烟：{{c1::TCP}} 是面向连接的')
    await sleep(250)
    check(
      '挖空正面预览隐藏答案',
      (one('.w1-lclozehint')?.textContent ?? '').includes('[1] 是面向连接的'),
      one('.w1-lclozehint')?.textContent ?? ''
    )
    byText('.w1-lnew button', '保存卡片')?.click()
    await sleep(600)
    const clozeRow = all('.w1-litem').find((el) => el.textContent?.includes('[1] 是面向连接的'))
    check(
      '挖空卡进入卡片库并带标记',
      Boolean(clozeRow) && clozeRow?.textContent?.includes('挖空'),
      clozeRow?.textContent?.slice(0, 40) ?? ''
    )

    const dueBefore = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)
    const reviewBtn = one('.w1-lrevbtn')
    check('卡片库有开始复习入口', Boolean(reviewBtn))
    reviewBtn?.click()
    await sleep(600)
    check('进入复习态', !!one('.w1-lreview') && !!one('.w1-lcard'))
    check(
      '复习卡默认显示正面',
      one('.w1-lfront')?.textContent?.includes('正面') ?? false,
      one('.w1-lfront')?.textContent?.slice(0, 40) ?? ''
    )
    check(
      '复习进度显示当前张数',
      /\\d+\\s*\\/\\s*\\d+/.test(one('.w1-lrevcount')?.textContent ?? ''),
      one('.w1-lrevcount')?.textContent ?? ''
    )
    check(
      '未翻面时评分禁用',
      all('.w1-lrate').every((el) => el.disabled),
      String(all('.w1-lrate').filter((el) => el.disabled).length)
    )

    one('.w1-lcard')?.click()
    await sleep(500)
    check(
      '点击翻面显示背面',
      one('.w1-lfront')?.style.opacity === '0' && !!one('.w1-lcardnotes'),
      one('.w1-lfront')?.style.opacity ?? ''
    )
    check(
      '翻面后评分可用并显示间隔',
      all('.w1-lrate').every((el) => !el.disabled) &&
        all('.w1-lrate span').every((el) => /\\d+\\s*天|今天/.test(el.textContent ?? '')),
      all('.w1-lrate span').map((el) => el.textContent).join('/')
    )

    const queueSizeBefore = all('.w1-lrate').length
    byText('.w1-lrate', '良好')?.click()
    await sleep(700)
    const advanced = one('.w1-lrevcount')?.textContent ?? ''
    check('评分后进入下一张', queueSizeBefore === 4 && advanced.length > 0, advanced)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    check(
      'Esc 退出复习回到卡片库',
      !one('.w1-lreview') && !!one('.w1-learn') && activeNav() === '学习',
      activeNav()
    )

    const dueAfter = Number(one('.w1-learnmain .w1-todosub b')?.textContent ?? -1)
    check('评分后到期数减少', dueAfter === dueBefore - 1, dueBefore + ' -> ' + dueAfter)

    await navTo('今日')
    check(
      '今日学习卡显示真实到期数',
      one('.w1-review .w1-big')?.textContent === String(dueAfter),
      (one('.w1-review .w1-big')?.textContent ?? '') + ' vs ' + dueAfter
    )
    one('.w1-review .w1-rbtn')?.click()
    await sleep(600)
    check('今日卡可开始复习', !!one('.w1-lreview') && activeNav() === '学习', activeNav())
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(450)
    await navTo('今日')

    one('.w1-motion')?.focus()
    await openPalette()
    const sendInput = one('.w1-paletteinput')
    setValue(sendInput, '帮我拟一条周报提醒')
    await sleep(300)
    const selectedSend = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '无匹配命令时回退为发送',
      selectedSend.includes('发送给 Claude') && !selectedSend.includes('修复登录'),
      selectedSend
    )
    sendInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(350)
    check(
      '命令面板发送后切到 Agent',
      activeNav() === 'Agent' && one('.w1-thread')?.textContent?.includes('帮我拟一条周报提醒') && !!one('.w1-typing'),
      activeNav()
    )

    await openPalette(350)
    const busyInput = one('.w1-paletteinput')
    setValue(busyInput, '再发一条')
    await sleep(120)
    const sendItem = byText('.w1-paletteitem', '发送给')
    check(
      '等待回复时禁用发送',
      !!sendItem && sendItem.getAttribute('data-disabled') === 'true',
      sendItem?.getAttribute('data-disabled') ?? 'missing'
    )
    busyInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    await openPalette()
    const backupInput = one('.w1-paletteinput')
    setValue(backupInput, '立即备份数据')
    await sleep(300)
    backupInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await sleep(1200)
    check(
      '命令面板可立即备份',
      one('.w1-toast')?.textContent?.includes('已备份') === true,
      one('.w1-toast')?.textContent ?? 'no toast'
    )

    check('Esc 关闭命令面板', !one('.w1-palette'))
    check(
      'Esc 后焦点归位',
      document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    await sleep(1000)
    check('命令面板发送后收到回复', !one('.w1-typing'), one('.w1-typing') ? '等待动画未结束' : '')

    // 键盘速查表：输入框内不抢问号，非输入场景打开
    await navTo('任务')
    const shortcutProbe = one('.w1-todoinput')
    shortcutProbe?.focus()
    shortcutProbe?.dispatchEvent(
      new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true })
    )
    await sleep(300)
    check('输入框内的问号不打开速查表', !one('.w1-shortcuts'))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '?', code: 'Slash', shiftKey: true, bubbles: true }))
    await sleep(500)
    check(
      '问号打开键盘速查表',
      !!one('.w1-shortcuts') &&
        all('.w1-sheetgroup').length === 5 &&
        all('.w1-sheetrow').length >= 15,
      String(all('.w1-sheetgroup').length) + ' 组 / ' + String(all('.w1-sheetrow').length) + ' 条'
    )
    check(
      '速查表列出主键位',
      ['Ctrl', 'Shift', 'Space', 'Esc'].every((key) =>
        one('.w1-shortcuts')?.textContent?.includes(key)
      ),
      one('.w1-schead')?.textContent ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    check('Esc 关闭速查表', !one('.w1-shortcuts'))
    check('状态栏有速查入口', !!one('.w1-st-shortcuts'))

    await navTo('今日')
    one('.w1-motion')?.focus()
    await openPalette()
    const noteCommand = one('.w1-paletteinput')
    setValue(noteCommand, '新建快速笔记')
    await sleep(300)
    noteCommand.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(500)
    check('命令面板可打开快速笔记', !!one('.w1-modal'))
    check(
      '快速笔记接管焦点',
      document.activeElement?.classList.contains('w1-noteinput'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(650)
    check(
      '快速笔记关闭后焦点归位',
      !one('.w1-modal') && document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    await navTo('Agent')
    byText('.w1-sess', '重构 auth 模块')?.click()
    await sleep(300)
    byText('.w1-tab', 'Codex')?.click()
    await sleep(350)
    check('切换到 Codex 会话', one('.w1-tdiv')?.textContent?.includes('周报草稿'), one('.w1-tdiv')?.textContent ?? '')

    await navTo('今日')
    one('.w1-nall')?.click()
    await sleep(600)
    check('全部笔记入口切换工作区', activeNav() === '笔记' && !!one('.w1-notesview'))

    await navTo('今日')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
    await sleep(350)
    check('Ctrl+N 打开笔记', !!one('.w1-modal'))
    one('.w1-modalx')?.click()
    await sleep(600)
    check('弹窗可关闭', !one('.w1-modal'))

    return { checks, title: document.title, size: [innerWidth, innerHeight], activeView: activeNav() }
  })()`)
  } catch (error) {
    console.error(`[smoke] renderer script failed: ${error}`)
    const snapshot = await win.webContents
      .executeJavaScript(
        '({ progress: window.__smokeProgress ?? [], root: document.getElementById("root")?.textContent?.slice(0, 120) ?? null, scripts: [...document.scripts].map((s) => s.src) })'
      )
      .catch((snapshotError) => String(snapshotError))
    console.error(JSON.stringify({ consoleErrors, snapshot }, null, 2))
    fail()
    return
  }

  results.checks.push(...(await runCaptureChecks(win)))

  // 主进程侧的证据：这一轮 UI 操作必须真的落进 SQLite。
  const dbFile = join(dataDir, 'db', 'workstation.db')
  let dbStats = null
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(dbFile, { readOnly: true })
    const count = (sql) => Number(db.prepare(sql).get().n)
    dbStats = {
      tasks: count('SELECT COUNT(*) AS n FROM tasks WHERE deleted_at IS NULL'),
      notes: count('SELECT COUNT(*) AS n FROM notes'),
      learning: count('SELECT COUNT(*) AS n FROM learning_items'),
      reviews: count('SELECT COUNT(*) AS n FROM learning_reviews'),
      links: count('SELECT COUNT(*) AS n FROM note_links'),
      fsrs: count('SELECT COUNT(*) AS n FROM learning_items WHERE stability IS NOT NULL')
    }
    db.close()
  } catch (error) {
    console.error(`[smoke] 读取临时数据库失败：${error}`)
  }
  const dbReady = Boolean(
    dbStats && dbStats.tasks > 0 && dbStats.notes > 0 && dbStats.learning > 0 && dbStats.reviews > 0
  )
  results.checks.push({
    name: '笔记双链已落库',
    ok: Boolean(dbStats && dbStats.links > 0),
    detail: dbStats ? String(dbStats.links) : '无数据'
  })
  results.checks.push({
    name: 'FSRS 状态已落库',
    ok: Boolean(dbStats && dbStats.fsrs > 0),
    detail: dbStats ? String(dbStats.fsrs) : '无数据'
  })
  // 审计：UI 操作必须留下记录（这里读库，不依赖渲染层）
  let auditRows = []
  try {
    const { DatabaseSync } = require('node:sqlite')
    const auditDb = new DatabaseSync(dbFile, { readOnly: true })
    auditRows = auditDb
      .prepare('SELECT domain, action, title FROM audit_log ORDER BY id DESC LIMIT 40')
      .all()
    auditDb.close()
  } catch (error) {
    console.error(`[smoke] 读取审计失败：${error}`)
  }
  const auditHas = (domain, action) =>
    auditRows.some((row) => row.domain === domain && row.action === action)
  results.checks.push({
    name: '审计记录任务新增与完成',
    ok: auditHas('task', 'create') && auditHas('task', 'complete'),
    detail: `${auditRows.length} 条`
  })
  results.checks.push({
    name: '审计记录笔记与习惯写入',
    ok: auditHas('note', 'create') && auditHas('habit', 'checkin'),
    detail: auditRows
      .slice(0, 6)
      .map((row) => `${row.domain}:${row.action}`)
      .join(', ')
  })

  let reminderLines = []
  try {
    const { readFileSync } = require('node:fs')
    reminderLines = readFileSync(reminderLog, 'utf8')
      .split(String.fromCharCode(10))
      .map((line) => line.trim())
      .filter(Boolean)
  } catch {
    reminderLines = []
  }
  results.checks.push({
    name: '到点提醒真的触发并落日志',
    ok: reminderLines.some((line) => line.includes('提醒测试')),
    detail: reminderLines.join(' / ') || 'empty'
  })

  let backupFiles = []
  try {
    const { readdirSync } = require('node:fs')
    backupFiles = readdirSync(join(dataDir, 'db', 'backups')).filter((name) => name.endsWith('.db'))
  } catch (error) {
    console.error(`[smoke] 读取备份目录失败：${error}`)
  }
  const failed = results.checks.filter((check) => !check.ok)
  const failures = failed.length + (dbReady ? 0 : 1) + (backupFiles.length > 0 ? 0 : 1)
  console.log(
    JSON.stringify(
      {
        ...results,
        database: { file: dbFile, ...dbStats, ready: dbReady },
        backups: backupFiles,
        consoleErrors,
        failures
      },
      null,
      2
    )
  )
  if (failures > 0 || consoleErrors.length > 0) {
    console.error(`[smoke] ${failures} failed check(s), ${consoleErrors.length} console error(s)`)
    fail()
    return
  }
  app.quit()
}

async function runCaptureChecks(mainWin) {
  const checks = []
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail })
  const inboxCount = () =>
    mainWin.webContents.executeJavaScript(`(() => {
      const row = [...document.querySelectorAll('.w1-todorow')].find(
        (el) => el.querySelector('.w1-todolabel')?.textContent?.trim() === '收集箱'
      )
      return Number(row?.querySelector('.w1-todocount')?.textContent ?? -1)
    })()`)

  await mainWin.webContents.executeJavaScript(`(() => {
    const item = [...document.querySelectorAll('.w1-navitem')].find(
      (node) => node.querySelector('.w1-navtext b')?.textContent?.trim() === '任务'
    )
    item?.click()
  })()`)
  await sleep(500)

  const before = await inboxCount()
  await mainWin.webContents.executeJavaScript('window.ws.capture.open()')
  await sleep(900)

  const captureWin = BrowserWindow.getAllWindows().find((window) =>
    window.webContents.getURL().includes('#capture')
  )
  check('捕获窗打开', Boolean(captureWin))

  if (captureWin) {
    await captureWin.webContents.executeJavaScript(`(() => {
      const input = document.querySelector('.cap-input')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '冒烟捕获任务')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      return true
    })()`)
    await sleep(900)
    check('捕获后窗口隐藏', !captureWin.isVisible())
    captureWin.destroy()
  }

  const after = await inboxCount()
  check('捕获任务出现在主窗口', after === before + 1, `${before} -> ${after}`)
  return checks
}

function cleanup() {
  try {
    rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  } catch {
    // 临时目录清理失败不影响冒烟结论。
  }
}

function fail(code = 1) {
  // app.exit 不触发 before-quit / will-quit：先手动关库（主进程的 before-quit 处理器），
  // 再清临时目录，否则 Windows 上文件仍被占用、目录会残留在 %TEMP%。
  try {
    app.emit('before-quit', { preventDefault() {} })
  } catch {
    // 退出路径不再抛错
  }
  cleanup()
  app.exit(code)
}

app
  .whenReady()
  .then(run)
  .catch((error) => {
    console.error(error)
    fail()
  })

app.on('will-quit', cleanup)
