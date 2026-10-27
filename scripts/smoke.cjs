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

    check('左侧导航四个入口', all('.w1-navitem').length === 4, String(all('.w1-navitem').length))
    check(
      'preload 桥可用（真实 IPC 路径）',
      typeof window.ws?.tasks?.list === 'function' && typeof window.ws?.notes?.page === 'function',
      typeof window.ws
    )
    check(
      '导航顺序为今日任务 Agent 笔记',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/') === '今日/任务/Agent/笔记',
      all('.w1-navitem .w1-navtext b')
        .map((el) => el.textContent?.trim())
        .join('/')
    )
    check('默认停在今日', activeNav() === '今日', activeNav())
    check('今日看板可见', !!one('.w1-main'))
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
      !one('.w1-main') && !one('.w1-agent') && !one('.w1-notesview'),
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

    await navTo('今日')
    check(
      '允许后任务时间写入',
      byText('.w1-task', '周报收尾')?.textContent?.includes('22:00'),
      byText('.w1-task', '周报收尾')?.textContent ?? ''
    )
    check('返回今日后仅保留今日任务', all('.w1-task').length === 6, String(all('.w1-task').length))
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
    check('Esc 关闭命令面板', !one('.w1-palette'))
    check(
      'Esc 后焦点归位',
      document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )
    await sleep(1000)
    check('命令面板发送后收到回复', !one('.w1-typing'), one('.w1-typing') ? '等待动画未结束' : '')

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
      notes: count('SELECT COUNT(*) AS n FROM notes')
    }
    db.close()
  } catch (error) {
    console.error(`[smoke] 读取临时数据库失败：${error}`)
  }
  const dbReady = Boolean(dbStats && dbStats.tasks > 0 && dbStats.notes > 0)
  const failed = results.checks.filter((check) => !check.ok)
  const failures = failed.length + (dbReady ? 0 : 1)
  console.log(
    JSON.stringify(
      {
        ...results,
        database: { file: dbFile, ...dbStats, ready: dbReady },
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
