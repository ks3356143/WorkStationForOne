const { app, BrowserWindow } = require('electron')
const { createServer } = require('node:http')
const { join } = require('node:path')
const {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} = require('node:fs')
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
const agentWorkspace = join(dataDir, 'workspace')
const stubMcpServer = join(__dirname, 'stub-mcp-server.cjs')
const localSkillDir = join(dataDir, 'local-skill')
const sessionScanRoot = join(dataDir, 'home')
mkdirSync(userDir, { recursive: true })
mkdirSync(sessionDir, { recursive: true })
mkdirSync(agentWorkspace, { recursive: true })
mkdirSync(join(agentWorkspace, 'src'), { recursive: true })
writeFileSync(join(agentWorkspace, 'smoke-note.txt'), 'workspace smoke preview')
writeFileSync(join(agentWorkspace, 'src', 'main.ts'), 'const smoke = true')
mkdirSync(localSkillDir, { recursive: true })
writeFileSync(
  join(localSkillDir, 'SKILL.md'),
  '---\nname: local-skill\ndescription: local smoke skill\n---\nLocal smoke skill body.\n'
)
process.env.WS_PICK_SKILL = localSkillDir

// 本机会话扫描只读指向临时 home，绝不读取真实的 ~/.claude 或 ~/.codex
const claudeScanDir = join(sessionScanRoot, '.claude', 'projects', '-smoke-workspace')
const codexScanDir = join(sessionScanRoot, '.codex', 'sessions', '2026', '10', '30')
mkdirSync(claudeScanDir, { recursive: true })
mkdirSync(codexScanDir, { recursive: true })
writeFileSync(
  join(claudeScanDir, 'smoke-claude-import.jsonl'),
  [
    JSON.stringify({
      type: 'user',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:00:00.000Z',
      message: { content: '导入 Claude 冒烟会话' }
    }),
    JSON.stringify({
      type: 'assistant',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:01:00.000Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: '先读一下文件。' },
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'Read',
            input: { file_path: 'smoke-note.txt' }
          }
        ]
      }
    }),
    JSON.stringify({
      type: 'user',
      cwd: agentWorkspace,
      timestamp: '2026-10-30T09:02:00.000Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'ok' }]
      },
      toolUseResult: {}
    }),
    JSON.stringify({ type: 'summary', summary: 'Claude 冒烟会话' })
  ].join('\n')
)
writeFileSync(
  join(codexScanDir, 'rollout-smoke-import.jsonl'),
  [
    JSON.stringify({
      type: 'session_meta',
      payload: { session_id: 'smoke-codex-import', cwd: agentWorkspace }
    }),
    JSON.stringify({
      type: 'response_item',
      payload: {
        role: 'user',
        content: [{ type: 'input_text', text: '导入 Codex 冒烟会话' }]
      }
    })
  ].join('\n')
)
process.env.WS_SESSION_SCAN_ROOT = sessionScanRoot
app.setPath('userData', userDir)
app.setPath('sessionData', sessionDir)
process.env.WS_DATA_DIR = join(dataDir, 'db')
// 原生目录选择器在自动化里跳过，但仍由主进程走同一套目录校验。
process.env.WS_PICK_WORKSPACE = agentWorkspace
// Agent 走 stub CLI：验证真实 IPC → 子进程 → 渲染整条链路，但不调用模型、不消耗额度
process.env.WS_AGENT_CLI = join(__dirname, 'stub-agent.cjs')
process.env.WS_CODEX_CLI = join(__dirname, 'stub-codex.cjs')
// 插件市场操作单独走 stub，避免冒烟访问真实市场或写用户 ~/.claude
process.env.WS_CLAUDE_PLUGIN_CLI = join(__dirname, 'stub-plugin-cli.cjs')
// 不抢 Cherry Studio 等外部应用的 Ctrl+Alt+Space
process.env.WS_DISABLE_CAPTURE_SHORTCUT = '1'
// 提醒轮询调快，并把命中记录写到文件，供主进程侧断言
const reminderLog = join(dataDir, 'reminders.log')
process.env.WS_REMINDER_TICK_MS = '400'
process.env.WS_REMINDER_LOG = reminderLog

// Provider 测试连接的本地探针：只验证请求路径、鉴权头与结果映射，不访问外网。
const providerProbe = createServer((req, res) => {
  req.resume()
  if (req.method === 'POST' && req.url === '/responses') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ object: 'response', output_text: 'OK' }))
    return
  }
  res.writeHead(404, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ error: { message: 'probe endpoint not found' } }))
})
providerProbe.on('error', (error) => console.error('[smoke] Provider 探针服务失败', error))
providerProbe.listen(23334, '127.0.0.1')

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

  await win.webContents.executeJavaScript(
    `window.__WS_MCP_STUB__ = ${JSON.stringify(stubMcpServer)}; window.__WS_AGENT_WORKSPACE__ = ${JSON.stringify(agentWorkspace)}`
  )
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
    const waitFor = async (fn, timeout = 3000) => {
      const started = Date.now()
      while (Date.now() - started < timeout) {
        try {
          if (await fn()) return true
        } catch {
          // 重渲染期间节点可能暂时不存在
        }
        await sleep(50)
      }
      return false
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
    check('状态栏初始无待审批', one('.w1-status')?.textContent?.includes('无待审批') ?? false)
    check(
      '状态栏显示 MCP 桥',
      one('.w1-st-mcp')?.textContent?.includes('MCP 桥') ?? false,
      one('.w1-st-mcp')?.textContent ?? ''
    )
    check(
      '舰队总览初始为空',
      one('.w1-fleet .w1-frow')?.textContent?.includes('0会话') ?? false,
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

    const quickAddLink = one('.w1-tasks .w1-quickadd')
    check('今日卡有快速添加入口', Boolean(quickAddLink))
    quickAddLink?.click()
    await sleep(500)
    check(
      '快速添加切到任务并聚焦输入',
      activeNav() === '任务' &&
        document.activeElement?.classList.contains('w1-todoinput') === true,
      activeNav() + '|' + (document.activeElement?.className ?? '')
    )

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
    await waitFor(
      () =>
        taskRow('提交周报 v2') !== undefined &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('#验证二') &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('中') &&
        (taskRow('提交周报 v2')?.textContent ?? '').includes('备注') &&
        !one('.w1-todoedit'),
      3000
    )
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
    await waitFor(() => byText('.w1-tododelete', '再次点击确认删除') !== undefined, 1500)
    check('删除需要二次确认', byText('.w1-tododelete', '再次点击确认删除') !== undefined)
    one('.w1-tododelete')?.click()
    await waitFor(() => taskRow('提交周报 v2') === undefined, 3000)
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
    await waitFor(() => all('.w1-plancol')[0]?.querySelector('.w1-planrow') !== undefined, 2500)
    check('计划面板与容量条', !!one('.w1-plan') && !!one('.w1-plan .w1-cap'))
    const beforePlanned = all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0
    all('.w1-plancol')[0]?.querySelector('.w1-planrow')?.click()
    await waitFor(
      () => (all('.w1-plancol')[1]?.querySelectorAll('.w1-planrow').length ?? 0) === beforePlanned + 1,
      3000
    )
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
    await waitFor(
      () =>
        !one('.w1-todoedit') &&
        activeNav() === '任务' &&
        document.activeElement?.classList.contains('w1-todobody'),
      2000
    )
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
    check(
      'Agent 初始为空态',
      !!one('.w1-agentempty') && all('.w1-sess').length === 0,
      String(all('.w1-sess').length)
    )
    one('.w1-agentempty .w1-pb.pri')?.click()
    await sleep(600)
    check(
      '新建真实会话',
      all('.w1-sess').length === 1 && (one('.w1-tdiv')?.textContent ?? '').includes('新会话'),
      one('.w1-tdiv')?.textContent ?? ''
    )
    check(
      '未选择工作区时输入禁用',
      !!one('.w1-aworkspacegate') && one('#composer-input')?.disabled === true,
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    one('.w1-aworkspacegate .w1-pb')?.click()
    const workspaceReady = await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const workspaceTitle = one('.w1-aworkspace')?.getAttribute('title') ?? ''
    check(
      '选择工作区后启用对话',
      workspaceReady && workspaceTitle.includes('workspace'),
      workspaceTitle
    )
    const workspacePersisted = await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.some((session) => session.workspace?.endsWith('workspace'))
    }, 3000)
    check(
      '工作区已落库',
      workspacePersisted,
      one('.w1-aworkspace')?.textContent?.trim() ?? 'missing'
    )

    const input = one('#composer-input')
    setValue(input, '测一下多会话回复')
    await sleep(80)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check('发送后出现等待动画', !!one('.w1-typing'))
    await navTo('今日')
    await sleep(1300)
    await navTo('Agent')
    check('切换视图后仍收到助手回复', all('.w1-amsg').length >= 1, String(all('.w1-amsg').length))
    check('等待动画结束', !one('.w1-typing'))
    check(
      '会话标题取首条消息',
      byText('.w1-sess', '测一下多会话回复') !== undefined,
      one('.w1-sess')?.textContent ?? ''
    )

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

    const askInput = one('#composer-input')
    setValue(askInput, '需要审批')
    await sleep(80)
    askInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        !!one('.w1-toolperm') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('tmp/stub.txt'),
      2000
    )
    check(
      '工具审批卡出现并显示目标',
      !!one('.w1-toolperm') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('Write') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('tmp/stub.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? ''
    )
    byText('.w1-toolperm .w1-pb.pri', '允许一次')?.click()
    await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已写入临时文件'),
      2500
    )
    check(
      '允许后 CLI 继续并写入工具卡',
      !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已写入临时文件') &&
        (one('.w1-thread')?.textContent ?? '').includes('tmp/stub.txt'),
      one('.w1-thread')?.textContent?.slice(-80) ?? ''
    )

    setValue(askInput, '需要审批')
    await sleep(80)
    askInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(() => !!one('.w1-toolperm'), 2000)
    byText('.w1-toolperm .w1-pb', '拒绝')?.click()
    await waitFor(
      () => !one('.w1-toolperm') && (one('.w1-thread')?.textContent ?? '').includes('权限被拒绝'),
      2500
    )
    check(
      '拒绝后 CLI 停止写入',
      !one('.w1-toolperm') && (one('.w1-thread')?.textContent ?? '').includes('权限被拒绝'),
      one('.w1-thread')?.textContent?.slice(-80) ?? ''
    )

    const mcpInput = one('#composer-input')
    setValue(mcpInput, 'MCP 概览')
    await sleep(80)
    mcpInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 概览：读取成功'),
      2500
    )
    const mcpText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    const mcpTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check('MCP 读工具可被 Claude 调用', mcpText.includes('MCP 概览：读取成功'), mcpText)
    check(
      'MCP 工具调用显示为已完成',
      mcpTool?.textContent?.includes('today_overview') && mcpTool?.textContent?.includes('完成'),
      mcpTool?.textContent ?? 'missing'
    )

    const mcpWriteInput = one('#composer-input')
    setValue(mcpWriteInput, 'MCP 写任务')
    await sleep(80)
    mcpWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('MCP 写任务：已创建'),
      2500
    )
    const mcpWriteText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    const mcpWriteTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check('MCP 任务写入返回成功', mcpWriteText.includes('MCP 写任务：已创建'), mcpWriteText)
    check(
      'MCP 写入工具卡显示完成',
      mcpWriteTool?.textContent?.includes('tasks_create') &&
        mcpWriteTool?.textContent?.includes('完成'),
      mcpWriteTool?.textContent ?? 'missing'
    )

    await window.ws.mcp.setPolicy('task', 'ask')
    await sleep(150)
    const mcpAskInput = one('#composer-input')
    setValue(mcpAskInput, 'MCP 审批写入')
    await sleep(80)
    mcpAskInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(() => !!one('.w1-mcpapprove'), 2000)
    check(
      '询问模式弹出 MCP 写入审批卡',
      !!one('.w1-mcpapprove') &&
        (one('.w1-mcpapprove')?.textContent ?? '').includes('tasks_create') &&
        (one('.w1-mcpapprove')?.textContent ?? '').includes('MCP 审批写入'),
      one('.w1-mcpapprove')?.textContent?.slice(0, 100) ?? 'missing'
    )
    byText('.w1-mcpapprove .w1-pb.pri', '允许一次')?.click()
    await waitFor(
      () =>
        !one('.w1-mcpapprove') &&
        (one('.w1-thread')?.textContent ?? '').includes('MCP 审批写入：已创建'),
      3000
    )
    check(
      '允许一次后写入完成',
      !one('.w1-mcpapprove') &&
        (one('.w1-thread')?.textContent ?? '').includes('MCP 审批写入：已创建'),
      one('.w1-thread')?.textContent?.slice(-100) ?? ''
    )
    await window.ws.mcp.setPolicy('task', 'write')
    await sleep(150)

    await navTo('今日')
    await sleep(500)
    check(
      'MCP 写入后任务出现在今日',
      (one('.w1-main')?.textContent ?? '').includes('MCP 写入测试'),
      one('.w1-main')?.textContent?.slice(0, 120) ?? ''
    )
    await navTo('Agent')
    await sleep(400)

    document.querySelector('[aria-label="新建 Codex 会话"]')?.click()
    await sleep(700)
    check(
      '新建 Codex 会话（继承 CLI 时只读）',
      all('.w1-sess').length === 2 &&
        (one('.w1-term')?.textContent ?? '').includes('codex') &&
        (one('.w1-term')?.textContent ?? '').includes('read-only'),
      one('.w1-term')?.textContent ?? ''
    )
    check(
      '新 Codex 会话先要求工作区',
      !!one('.w1-aworkspacegate') && one('#composer-input')?.disabled === true,
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    one('.w1-aworkspacegate .w1-pb')?.click()
    const codexWorkspaceReady = await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    check(
      'Codex 工作区选择后启用',
      codexWorkspaceReady && (one('.w1-aworkspace')?.getAttribute('title') ?? '').includes('workspace'),
      one('.w1-aworkspace')?.getAttribute('title') ?? 'missing'
    )
    await waitFor(async () => {
      const bundle = await window.ws.agent.threads()
      return bundle.sessions.filter((session) => session.workspace).length >= 2
    }, 3000)

    const codexInput = one('#composer-input')
    setValue(codexInput, '读一下入口')
    await sleep(80)
    codexInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(1000)
    const codexText = all('.w1-amsg').at(-1)?.querySelector('.w1-atext')?.textContent ?? ''
    check('Codex 回复来自 JSONL 流', codexText.includes('Codex 只读回复'), codexText)
    check(
      'Codex 子进程使用会话工作区',
      codexText.includes('工作目录：') && codexText.includes('workspace'),
      codexText.slice(-120)
    )
    const codexTool = all('.w1-amsg').at(-1)?.querySelector('.w1-tool')
    check(
      'Codex 命令渲染成工具卡',
      codexTool?.textContent?.includes('Shell') &&
        codexTool?.textContent?.includes('Get-Content') &&
        codexTool?.textContent?.includes('完成'),
      codexTool?.textContent ?? 'missing'
    )

    byText('.w1-sess', '测一下多会话回复')?.click()
    await sleep(400)
    check(
      '可切回 Claude 会话',
      (one('.w1-term')?.textContent ?? '').includes('claude'),
      one('.w1-term')?.textContent ?? ''
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const slowInput = one('#composer-input')
    setValue(slowInput, '并发慢会话一号')
    await sleep(80)
    slowInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(200)
    check('慢会话开始运行', !!one('.w1-typing'))

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const fastInput = one('#composer-input')
    setValue(fastInput, '第二个并发会话')
    await sleep(80)
    fastInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    const fastDone = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('读完了') &&
        !one('.w1-typing'),
      3000
    )
    check(
      '另一个会话在前一个运行中正常完成',
      fastDone,
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    byText('.w1-sess', '并发慢会话一号')?.click()
    await sleep(250)
    check('切回慢会话仍在等待', !!one('.w1-typing'), one('.w1-term')?.textContent ?? '')
    const slowDone = await waitFor(
      () =>
        (one('.w1-thread')?.textContent ?? '').includes('慢会话结束') &&
        !one('.w1-typing'),
      5000
    )
    check(
      '慢会话稍后独立完成',
      slowDone,
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const approvalAInput = one('#composer-input')
    setValue(approvalAInput, '并发审批甲')
    await sleep(80)
    approvalAInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalAVisible = await waitFor(() => !!one('.w1-toolperm'), 2500)
    check(
      '会话甲出现审批卡',
      approvalAVisible && (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )

    document.querySelector('[aria-label="新建 Claude 会话"]')?.click()
    await sleep(500)
    one('.w1-aworkspacegate .w1-pb')?.click()
    await waitFor(
      () => !one('.w1-aworkspacegate') && one('#composer-input')?.disabled === false,
      3000
    )
    const approvalBInput = one('#composer-input')
    setValue(approvalBInput, '并发审批乙')
    await sleep(80)
    approvalBInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalBVisible = await waitFor(
      () =>
        !!one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('等待并发审批'),
      2500
    )
    check(
      '会话乙出现自己的审批卡',
      approvalBVisible,
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    check(
      '后台审批入口提示另一会话',
      (one('.w1-queue')?.textContent ?? '').includes('1 项待审批'),
      one('.w1-queue')?.textContent ?? 'missing'
    )

    byText('.w1-sess', '并发审批甲')?.click()
    await sleep(300)
    check(
      '切到会话甲仍看到自己的审批卡',
      (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb.pri', '允许一次')?.click()
    const approvalADone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('并发审批已允许'),
      2500
    )
    check(
      '允许会话甲后它单独完成',
      approvalADone && (one('.w1-queue')?.textContent ?? '').includes('1 项待审批'),
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    byText('.w1-sess', '并发审批乙')?.click()
    await sleep(300)
    check(
      '会话乙的审批卡没有被误关',
      (one('.w1-toolperm')?.textContent ?? '').includes('tmp/concurrent.txt'),
      one('.w1-toolperm')?.textContent?.slice(0, 80) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '拒绝')?.click()
    const approvalBDone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('并发审批已拒绝'),
      2500
    )
    check(
      '会话乙拒绝后独立完成',
      approvalBDone && (one('.w1-status')?.textContent ?? '').includes('无待审批'),
      one('.w1-thread')?.textContent?.slice(-80) ?? 'missing'
    )

    const fleetButton = one('.w1-st-fleet')
    check(
      '状态栏有舰队入口',
      (fleetButton?.textContent ?? '').includes('舰队'),
      fleetButton?.textContent ?? 'missing'
    )
    fleetButton?.click()
    await waitFor(() => !!one('.w1-fleetsheet'), 2000)
    const fleetRows = all('.w1-fleetrow')
    check(
      '舰队控制台列出全部会话',
      fleetRows.length >= 6 &&
        (one('.w1-fleetsheet')?.textContent ?? '').includes('Claude Code') &&
        (one('.w1-fleetsheet')?.textContent ?? '').includes('Codex'),
      String(fleetRows.length) + ' 行 · ' + (one('.w1-fleetheadmeta')?.textContent ?? '')
    )
    check(
      '舰队汇总显示运行与审批',
      (one('.w1-fleetheadmeta')?.textContent ?? '').includes('会话') &&
        (one('.w1-fleetheadmeta')?.textContent ?? '').includes('待审批'),
      one('.w1-fleetheadmeta')?.textContent ?? 'missing'
    )

    byText('.w1-fleetheadmeta .w1-capmini', '存预设')?.click()
    const presetReady = await waitFor(() => !!one('.w1-fleetpreset'), 3000)
    check(
      '会话预设可保存',
      presetReady && (one('.w1-fleetpresets')?.textContent ?? '').includes('预设'),
      one('.w1-fleetpresets')?.textContent?.slice(0, 80) ?? 'missing'
    )
    one('.w1-fleetpresetdel')?.click()
    const presetRemoved = await waitFor(() => !one('.w1-fleetpreset'), 3000)
    check('会话预设可删除', presetRemoved)

    byText('.w1-fleetheadmeta .w1-capmini', '用量')?.click()
    const usageReady = await waitFor(() => !!one('.w1-fleetusage'), 3000)
    const usageRuns = await window.ws.agent.usage(7)
    check(
      '舰队用量统计可用',
      usageReady &&
        usageRuns.length > 0 &&
        (one('.w1-fleetusagesum')?.textContent ?? '').includes(String(usageRuns.length)),
      String(usageRuns.length) + ' 轮 · ' + (one('.w1-fleetusagesum')?.textContent ?? 'missing')
    )
    byText('.w1-fleetfilters button', '运行中')?.click()
    await sleep(250)
    check(
      '舰队筛选可切到运行中',
      !!one('.w1-fleetempty') && all('.w1-fleetrow').length === 0,
      one('.w1-fleetempty')?.textContent?.slice(0, 40) ?? 'missing'
    )
    byText('.w1-fleetfilters button', '全部')?.click()
    await sleep(250)
    byText('.w1-fleetheadmeta .w1-capmini', '用量')?.click()
    await sleep(150)
    byText('.w1-fleetheadmeta .w1-capmini', '导入本机')?.click()
    const importListed = await waitFor(() => all('.w1-fleetimportrow').length === 2, 3000)
    check(
      '舰队可只读扫描本机会话',
      importListed &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('只读扫描') &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('Claude 冒烟会话') &&
        (one('.w1-fleetimport')?.textContent ?? '').includes('导入 Codex 冒烟会话'),
      one('.w1-fleetimport')?.textContent?.slice(0, 120) ?? 'missing'
    )
    const rowsBeforeImport = all('.w1-fleetrow').length
    const claudeImport = all('.w1-fleetimportrow').find((el) =>
      el.textContent.includes('Claude 冒烟会话')
    )
    claudeImport?.querySelector('.w1-fleetimportbtn')?.click()
    const importedRow = await waitFor(
      () =>
        claudeImport?.classList.contains('on') &&
        (claudeImport?.textContent ?? '').includes('补历史'),
      3000
    )
    const importedThreads = await window.ws.agent.threads()
    const persistedImport = importedThreads.sessions.find(
      (session) => session.resumeId === 'smoke-claude-import'
    )
    check(
      '导入的本机会话进入舰队并落库',
      importedRow &&
        all('.w1-fleetrow').length === rowsBeforeImport + 1 &&
        !!persistedImport &&
        persistedImport.workspace === window.__WS_AGENT_WORKSPACE__ &&
        persistedImport.agent === 'claude',
      String(all('.w1-fleetrow').length) +
        ' 行 · ' +
        (persistedImport ? persistedImport.id : 'missing')
    )
    byText('.w1-fleetrow', 'Claude 冒烟会话')?.querySelector('.w1-fleetopen')?.click()
    const fleetClosed = await waitFor(() => !one('.w1-fleetsheet'), 2000)
    check(
      '舰队可打开并切回会话',
      fleetClosed && activeNav() === 'Agent' && !!one('.w1-dock'),
      activeNav()
    )
    const importHistoryReady = await waitFor(
      () =>
        !!one('.w1-importnote') &&
        (one('.w1-thread')?.textContent ?? '').includes('导入 Claude 冒烟会话') &&
        (one('.w1-thread')?.textContent ?? '').includes('Read') &&
        (one('.w1-thread')?.textContent ?? '').includes('smoke-note.txt'),
      2500
    )
    check(
      '导入会话显示只读历史与工具卡',
      importHistoryReady,
      one('.w1-thread')?.textContent?.slice(0, 160) ?? 'missing'
    )

    await navTo('今日')
    check('返回今日后仍有任务', all('.w1-task').length > 0, String(all('.w1-task').length))

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
      const timeCell = () =>
        document.querySelector('.w1-task[data-task-id="' + cardId + '"] .w1-time')
      await waitFor(() => timeCell()?.textContent?.trim() === '15:30', 2500)
      const draggedTime = timeCell()?.textContent?.trim()
      check('拖到时间轴写入 15:30', draggedTime === '15:30', String(draggedTime))
    }
    const undone = one('.w1-task:not(.done)')
    const undoneTitle = undone?.querySelector('.w1-ttext')?.textContent ?? ''
    undone?.click()
    await sleep(200)
    check('勾选任务后完成数 +1', all('.w1-task.done').length === 3, String(all('.w1-task.done').length))
    check(
      '任务进度同步',
      (one('.w1-tprog b')?.textContent ?? '').includes('3 / '),
      one('.w1-tprog b')?.textContent ?? ''
    )

    byText('.w1-filter', '已完成')?.click()
    await sleep(200)
    check('筛选已完成', all('.w1-task').length === 3, String(all('.w1-task').length))
    byText('.w1-filter', '全部')?.click()
    await sleep(200)
    check(
      '筛选恢复全部',
      all('.w1-task').length > all('.w1-task.done').length &&
        all('.w1-task.done').length === 3,
      String(all('.w1-task').length)
    )

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
      await waitFor(() => all('.w1-todosubrow').length === (title === '收集数据' ? 1 : 2), 2500)
    }
    check(
      '子任务出现在详情里',
      all('.w1-todosubrow').length === 2,
      String(all('.w1-todosubrow').length)
    )
    one('.w1-todosubrow .w1-todocb')?.click()
    const subBadgeOf = () =>
      all('.w1-todorowwrap')
        .find((row) => row.textContent?.includes('整理季度复盘'))
        ?.querySelector('.w1-todosubcount')?.textContent
    await waitFor(() => subBadgeOf() === '1/2', 2500)
    const subBadge = subBadgeOf()
    check('父任务行显示 1/2 进度', subBadge === '1/2', subBadge ?? 'missing')
    const subCounts = await window.ws.tasks.list()
    check(
      '子任务不进入清单计数',
      subCounts.filter((task) => !task.parentId).length === topBefore + 1,
      topBefore + ' -> ' + subCounts.filter((task) => !task.parentId).length
    )
    // 删掉父任务：子任务应一起软删
    byText('.w1-todoedit .w1-tododelete', '删除任务')?.click()
    await waitFor(
      () => byText('.w1-todoedit .w1-tododelete', '再次点击确认删除') !== undefined,
      1500
    )
    byText('.w1-todoedit .w1-tododelete', '再次点击确认删除')?.click()
    await waitFor(async () => {
      const rows = await window.ws.tasks.list()
      return !rows.some((task) => task.parentId)
    }, 3000)
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
    check('设置面板有 Provider 卡片', !!one('.w1-provcard'))
    check(
      'Provider 接线台有双目标端口',
      all('.w1-provport').length === 2 && !!one('.w1-provdeckhead'),
      String(all('.w1-provport').length)
    )
    check(
      'Provider 模式是信号路由',
      !!one('.w1-provroute') && all('.w1-provroute .w1-provseg button').length === 2,
      one('.w1-provroute')?.textContent ?? 'missing'
    )
    check(
      'Provider 继承态有说明卡',
      !!one('.w1-provinherit'),
      one('.w1-provinherit')?.textContent ?? 'missing'
    )
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    check(
      'Provider 可切到 Codex CLI',
      one('[aria-label="Provider 目标"] button.on')?.textContent?.includes('Codex') === true &&
        !!one('[aria-label="Codex 协议"]'),
      one('[aria-label="Provider 目标"] button.on')?.textContent ?? ''
    )
    const codexProtocol = one('[aria-label="Codex 协议"]')
    check(
      'Codex 协议只剩 Responses',
      codexProtocol?.textContent?.trim() === 'Responses' &&
        !(codexProtocol?.textContent ?? '').includes('Chat'),
      codexProtocol?.textContent?.trim() ?? 'missing'
    )
    byText('.w1-provseg button', 'Claude Code')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    check(
      '设置面板有 MCP 域权限',
      settingsText.includes('MCP 数据权限') && all('.w1-modepair').length === 4,
      String(all('.w1-modepair').length)
    )
    await sleep(300)
    check(
      '设置面板有活动记录',
      all('.w1-auditrow').length > 0 &&
        (one('.w1-auditlist')?.textContent ?? '').includes('MCP'),
      one('.w1-auditlist')?.textContent?.slice(0, 100) ?? ''
    )
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    setValue(one('input[aria-label="Provider 名称"]'), 'Smoke Provider')
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23333')
    setValue(one('input[aria-label="Provider 模型"]'), 'smoke-model')
    setValue(one('input[aria-label="Provider API Key"]'), 'sk-smoke-secret')
    byText('.w1-provsave', '保存并启用')?.click()
    await sleep(700)
    check(
      'Provider 加密保存并启用',
      (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      one('.w1-provstatus')?.textContent ?? ''
    )
    check(
      'Provider 加密 Key 显示胶囊状态',
      (one('.w1-provkeytag')?.textContent ?? '').includes('已加密') &&
        (one('.w1-provstate')?.textContent ?? '').includes('已启用'),
      (one('.w1-provkeytag')?.textContent ?? '') +
        ' / ' +
        (one('.w1-provstate')?.textContent ?? '')
    )
    byText('.w1-provseg button', '继承 Claude Code')?.click()
    await sleep(400)
    check(
      'Provider 可切回继承 CLI',
      one('[aria-label="Provider 模式"] button.on')?.textContent?.includes(
        '继承 Claude Code'
      ) === true,
      one('[aria-label="Provider 模式"] button.on')?.textContent ?? ''
    )

    // Codex app-server：工作区审批走同一条 preload → 主进程 → 渲染链路
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '自定义')?.click()
    await sleep(200)
    setValue(one('input[aria-label="Provider 名称"]'), 'Smoke Codex Provider')
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23334')
    setValue(one('input[aria-label="Provider 模型"]'), 'smoke-codex-model')
    setValue(one('input[aria-label="Provider API Key"]'), 'sk-smoke-codex-secret')
    byText('.w1-provsave', '保存并启用')?.click()
    await waitFor(
      () => (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      3000
    )
    check(
      'Codex Provider 加密保存并启用',
      (one('.w1-provstatus')?.textContent ?? '').includes('已加密保存'),
      one('.w1-provstatus')?.textContent ?? ''
    )
    byText('.w1-provtest', '测试连接')?.click()
    const probeOk = await waitFor(
      () => (one('.w1-provtestresult.ok')?.textContent ?? '').includes('连接正常'),
      4000
    )
    check(
      'Provider 测试连接成功',
      probeOk && (one('.w1-provtestresult.ok')?.textContent ?? '').includes('ms'),
      one('.w1-provtestresult')?.textContent ?? 'missing'
    )
    setValue(one('input[aria-label="Provider Base URL"]'), 'http://127.0.0.1:23339')
    await sleep(120)
    byText('.w1-provtest', '测试连接')?.click()
    const probeFailed = await waitFor(
      () => Boolean(one('.w1-provtestresult.fail')),
      5000
    )
    check(
      'Provider 测试连接失败有原因',
      probeFailed && /连接|超时|凭据|端点/.test(one('.w1-provtestresult.fail')?.textContent ?? ''),
      one('.w1-provtestresult.fail')?.textContent ?? 'missing'
    )

    byText('.w1-settabs button', '能力中心')?.click()
    await waitFor(() => !!one('.w1-cap') && !!one('.w1-capnav'), 3000)
    check(
      '设置里有能力中心三分区',
      all('.w1-capnav button').length === 3 &&
        (one('.w1-capscope')?.textContent ?? '').includes('应用私有'),
      one('.w1-capnav')?.textContent ?? 'missing'
    )
    byText('.w1-capseg button', '市场')?.click()
    const marketLoaded = await waitFor(
      () => (one('.w1-capcard')?.textContent ?? '').includes('demo-skill'),
      5000
    )
    check(
      'Claude 市场清单可读取',
      marketLoaded,
      one('.w1-capgrid')?.textContent?.slice(0, 80) ?? 'missing'
    )
    one('.w1-capcard .w1-capmini.pri')?.click()
    await waitFor(
      () => (one('.w1-capcard')?.textContent ?? '').includes('已安装'),
      5000
    )
    check('市场插件可一键安装到私有目录', (one('.w1-capcard')?.textContent ?? '').includes('已安装'))

    byText('.w1-capseg button', '已安装')?.click()
    await sleep(300)
    const skillRow = byText('.w1-caprow', 'demo-skill')
    check('已安装列表显示私有插件', Boolean(skillRow), skillRow?.textContent ?? 'missing')
    skillRow?.querySelector('.w1-setbtn')?.click()
    const skillEnabled = await waitFor(
      () => (byText('.w1-caprow', 'demo-skill')?.textContent ?? '').includes('已启用'),
      5000
    )
    const skillState = await window.ws.capability.skills.list()
    check(
      '插件应用内启用并落库',
      skillEnabled && skillState.length === 1 && skillState[0].enabled === true,
      JSON.stringify(skillState.map((item) => [item.name, item.enabled]))
    )

    byText('.w1-caphead .w1-capmini', '本地导入')?.click()
    const localSkillReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'local-skill')),
      4000
    )
    const localDetailButton = [
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '详情')
    localDetailButton?.click()
    const localDocReady = await waitFor(
      () => (one('.w1-skilldoc pre')?.textContent ?? '').includes('Local smoke skill'),
      3000
    )
    check(
      '本地 SKILL.md 可导入并查看源文件',
      localSkillReady && localDocReady,
      one('.w1-skilldetail')?.textContent?.slice(0, 120) ?? 'missing'
    )
    await waitFor(() => {
      const buttons = [
        ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
      ]
      return buttons.length > 0 && buttons.every((button) => !button.disabled)
    }, 3000)
    const localRemove = [
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '移除')
    localRemove?.click()
    await waitFor(
      () =>
        [...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])].some(
          (button) => button.textContent === '确认移除'
        ),
      2000
    )
    ;[
      ...(byText('.w1-caprow', 'local-skill')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '确认移除')?.click()
    const localRemoved = await waitFor(() => !byText('.w1-caprow', 'local-skill'), 3000)
    const localList = await window.ws.capability.skills.list()
    check(
      '本地技能可从私有目录移除',
      localRemoved && localList.length === 1,
      JSON.stringify(localList.map((item) => item.name))
    )

    byText('.w1-capnav button', 'MCP 服务')?.click()
    await sleep(300)
    check(
      '外部 MCP 说明包含 Codex Provider 会话',
      (one('.w1-cap')?.textContent ?? '').includes('Codex app-server') &&
        (one('.w1-cap')?.textContent ?? '').includes('密钥只进子进程环境'),
      one('.w1-capnote')?.textContent?.slice(0, 100) ?? 'missing'
    )
    const memoryCard = byText('.w1-capcard', 'Memory')
    memoryCard?.querySelector('.w1-capmini.pri')?.click()
    const memoryRowReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'Memory')),
      4000
    )
    byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '确认信任并启用',
      2000
    )
    byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.click()
    const memoryEnabled = await waitFor(
      () =>
        (byText('.w1-caprow', 'Memory')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '已启用',
      3000
    )
    const mcpState = await window.ws.capability.mcp.list()
    check(
      '内置 MCP 可添加、信任并启用',
      memoryRowReady &&
        memoryEnabled &&
        mcpState.some((server) => server.catalogId === 'memory' && server.enabled),
      JSON.stringify(mcpState.map((server) => [server.name, server.enabled]))
    )

    const envItems = all('.w1-capenvitem')
    check(
      'MCP 环境自检显示本机命令',
      envItems.length === 6 && (one('.w1-capenv')?.textContent ?? '').includes('node'),
      String(envItems.length) + ' · ' + (one('.w1-capenv')?.textContent?.slice(0, 80) ?? 'missing')
    )

    byText('.w1-caphead .w1-capmini', '导出')?.click()
    const exportReady = await waitFor(
      () => (one('.w1-capjson')?.value ?? '').includes('mcpServers'),
      3000
    )
    const exportText = one('.w1-capjson')?.value ?? ''
    check(
      'MCP JSON 导出包含 Server 且不导密钥值',
      exportReady && exportText.includes('"Memory"') && !exportText.includes('Bearer '),
      exportText.slice(0, 100)
    )
    byText('.w1-capform .w1-capmini', '取消')?.click()
    await sleep(200)

    byText('.w1-caphead .w1-capmini', '导入')?.click()
    await waitFor(() => !!one('.w1-capjson'), 2000)
    setValue(
      one('.w1-capjson'),
      JSON.stringify({
        mcpServers: {
          Imported: { command: 'node', args: [window.__WS_MCP_STUB__] }
        }
      })
    )
    byText('.w1-capform .w1-capmini.pri', '导入')?.click()
    const importedReady = await waitFor(
      () => Boolean(byText('.w1-caprow', 'Imported')),
      4000
    )
    check(
      'MCP JSON 导入生成停用 Server',
      importedReady,
      one('.w1-caplist')?.textContent?.slice(-80) ?? 'missing'
    )
    for (let index = 0; index < 2; index += 1) {
      const remove = [
        ...(byText('.w1-caprow', 'Imported')?.querySelectorAll('.w1-capmini') ?? [])
      ].find((button) => button.textContent === '移除' || button.textContent === '确认移除')
      remove?.click()
      await sleep(150)
    }
    await waitFor(() => !byText('.w1-caprow', 'Imported'), 3000)

    byText('.w1-caphead .w1-capmini.pri', '自定义 Server')?.click()
    await waitFor(() => !!one('.w1-capform'), 2000)
    setValue(one('input[aria-label="MCP 名称"]'), 'Stub MCP')
    setValue(one('input[aria-label="MCP 命令"]'), 'node')
    setValue(one('textarea[aria-label="MCP 参数"]'), window.__WS_MCP_STUB__)
    byText('.w1-capform .w1-capmini.pri', '添加 Server')?.click()
    const stubAdded = await waitFor(() => Boolean(byText('.w1-caprow', 'Stub MCP')), 4000)
    check('自定义 MCP 可添加', stubAdded, one('.w1-caplist')?.textContent?.slice(-80) ?? 'missing')

    byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '确认信任并启用',
      2000
    )
    byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.click()
    await waitFor(
      () =>
        (byText('.w1-caprow', 'Stub MCP')?.querySelector('.w1-setbtn')?.textContent ?? '') ===
        '已启用',
      2000
    )
    const stubTestButton = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '测试')
    stubTestButton?.click()
    const stubTested = await waitFor(() => {
      const row = byText('.w1-caprow', 'Stub MCP')
      const text = row?.textContent ?? ''
      return text.includes('已连接') && text.includes('echo') && text.includes('stub_status')
    }, 5000)
    check(
      '外部 MCP 可测试连接并列出工具',
      stubTested,
      byText('.w1-caprow', 'Stub MCP')?.textContent?.slice(-120) ?? 'missing'
    )

    const stubToolsButton = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent?.startsWith('工具'))
    stubToolsButton?.click()
    const toolsVisible = await waitFor(() => all('.w1-captool').length === 2, 2000)
    await waitFor(
      () => all('.w1-captoolseg button').every((button) => !button.disabled),
      3000
    )
    const allowButton = [
      ...(byText('.w1-captool', 'echo')?.querySelectorAll('.w1-captoolseg button') ?? [])
    ].find((button) => button.textContent === '自动')
    allowButton?.click()
    const allowSaved = await waitFor(async () => {
      const list = await window.ws.capability.mcp.list()
      return (
        list
          .find((server) => server.name === 'Stub MCP')
          ?.tools.find((tool) => tool.name === 'echo')?.approval === 'allow'
      )
    }, 3000)
    await waitFor(
      () => all('.w1-captoolseg button').every((button) => !button.disabled),
      3000
    )
    const denyButton = [
      ...(byText('.w1-captool', 'stub_status')?.querySelectorAll('.w1-captoolseg button') ?? [])
    ].find((button) => button.textContent === '禁止')
    denyButton?.click()
    const denySaved = await waitFor(async () => {
      const list = await window.ws.capability.mcp.list()
      const stub = list.find((server) => server.name === 'Stub MCP')
      return (
        stub?.tools.find((tool) => tool.name === 'stub_status')?.approval === 'deny' &&
        stub.tools.find((tool) => tool.name === 'echo')?.approval === 'allow'
      )
    }, 3000)
    check(
      'MCP 工具级权限可设置',
      toolsVisible && allowSaved && denySaved,
      byText('.w1-captoolpanel', '工具级权限')?.textContent?.slice(0, 120) ?? 'missing'
    )

    await waitFor(() => {
      const buttons = [...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])]
      return buttons.length > 0 && buttons.every((button) => !button.disabled)
    }, 3000)
    const firstRemove = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '移除')
    firstRemove?.click()
    await waitFor(
      () =>
        [...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])].some(
          (button) => button.textContent === '确认移除'
        ),
      2000
    )
    const confirmRemove = [
      ...(byText('.w1-caprow', 'Stub MCP')?.querySelectorAll('.w1-capmini') ?? [])
    ].find((button) => button.textContent === '确认移除')
    confirmRemove?.click()
    const stubRemoved = await waitFor(() => !byText('.w1-caprow', 'Stub MCP'), 3000)
    const remainingMcp = await window.ws.capability.mcp.list()
    check(
      '自定义 MCP 可移除且不残留',
      stubRemoved && remainingMcp.length === 1 && remainingMcp[0].catalogId === 'memory',
      JSON.stringify(remainingMcp.map((server) => server.name))
    )

    byText('.w1-capnav button', '内置工具')?.click()
    await sleep(250)
    check(
      '内置工具目录展示 11 个数据工具',
      all('.w1-caprow.static').length === 11 &&
        (one('.w1-cap')?.textContent ?? '').includes('tasks_list') &&
        (one('.w1-cap')?.textContent ?? '').includes('notes_create'),
      String(all('.w1-caprow.static').length)
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await waitFor(() => !one('.w1-settings-sheet'), 2000)

    await navTo('Agent')
    byText('.w1-sess', '测一下多会话回复')?.click()
    await sleep(400)
    const capabilityInput = one('#composer-input')
    setValue(capabilityInput, '能力中心检查')
    await sleep(80)
    capabilityInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const capabilityReply = await waitFor(
      () => (one('.w1-thread')?.textContent ?? '').includes('能力中心：插件'),
      3000
    )
    const capabilityText = one('.w1-thread')?.textContent ?? ''
    check(
      '私有插件与 MCP 注入 Claude 会话',
      capabilityReply &&
        capabilityText.includes('claude-plugins') &&
        capabilityText.includes('memory') &&
        capabilityText.includes('workstationforone') &&
        capabilityText.includes('严格 true'),
      capabilityText.slice(-180)
    )

    one('.w1-aworkspacefiles')?.click()
    const workspaceSheet = await waitFor(() => !!one('.w1-wssheet'), 2000)
    const workspaceTree = one('.w1-wstree')?.textContent ?? ''
    check(
      'Agent 工作区文件树可打开',
      workspaceSheet && workspaceTree.includes('smoke-note.txt') && workspaceTree.includes('src'),
      workspaceTree.slice(0, 100)
    )
    byText('.w1-wsfile', 'smoke-note.txt')?.click()
    const workspacePreview = await waitFor(
      () => (one('.w1-wspreview pre')?.textContent ?? '').includes('workspace smoke preview'),
      3000
    )
    check(
      '工作区文件可只读预览',
      workspacePreview,
      one('.w1-wspreview')?.textContent?.slice(0, 100) ?? 'missing'
    )
    one('.w1-wssheet')?.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })
    )
    await waitFor(() => !one('.w1-wssheet'), 2000)

    await navTo('Agent')
    byText('.w1-sess', '读一下入口')?.click()
    await sleep(350)
    check(
      'Codex Provider 激活后显示 app-server 审批模式',
      (one('.w1-term')?.textContent ?? '').includes('app-server') &&
        (one('.w1-perms')?.textContent ?? '').includes('写入 需审批'),
      one('.w1-term')?.textContent ?? ''
    )
    const codexWriteInput = one('#composer-input')
    setValue(codexWriteInput, '写一个文件')
    await sleep(80)
    codexWriteInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const approvalShown = await waitFor(
      () =>
        (one('.w1-toolperm')?.textContent ?? '').includes('Shell') &&
        (one('.w1-toolperm')?.textContent ?? '').includes('Set-Content'),
      5000
    )
    check(
      'Codex 工作区审批卡出现',
      approvalShown,
      one('.w1-toolperm')?.textContent?.slice(0, 140) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '允许一次')?.click()
    const codexWriteDone = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已允许写入。'),
      6000
    )
    check(
      'Codex 允许一次后继续本轮',
      codexWriteDone &&
        (all('.w1-amsg').at(-1)?.textContent ?? '').includes('已允许写入。'),
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    const codexMcpInput = one('#composer-input')
    setValue(codexMcpInput, 'MCP 写入')
    await sleep(80)
    codexMcpInput.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
    )
    const mcpApproval = await waitFor(
      () =>
        (one('.w1-toolperm')?.textContent ?? '').includes(
          'MCP · workstationforone/tasks_create'
        ),
      5000
    )
    check(
      'Codex MCP 工具进入审批卡',
      mcpApproval,
      one('.w1-toolperm')?.textContent?.slice(0, 180) ?? 'missing'
    )
    byText('.w1-toolperm .w1-pb', '允许一次')?.click()
    const mcpAllowed = await waitFor(
      () =>
        !one('.w1-toolperm') &&
        (one('.w1-thread')?.textContent ?? '').includes('已允许 MCP 调用。'),
      6000
    )
    check(
      'Codex MCP 允许一次后继续',
      mcpAllowed,
      all('.w1-amsg').at(-1)?.textContent?.slice(-120) ?? 'missing'
    )

    one('.w1-settings')?.click()
    await waitFor(() => !!one('.w1-settings-sheet'), 2000)
    byText('.w1-provseg button', 'Codex CLI')?.click()
    await sleep(200)
    byText('.w1-provseg button', '继承 Codex CLI')?.click()
    await sleep(400)
    check(
      'Codex Provider 可切回继承 CLI',
      one('[aria-label="Provider 模式"] button.on')?.textContent?.includes(
        '继承 Codex CLI'
      ) === true,
      one('[aria-label="Provider 模式"] button.on')?.textContent ?? ''
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
    await waitFor(() => !one('.w1-settings-sheet'), 2000)
    check('Esc 关闭设置面板', !one('.w1-settings-sheet'))
    await navTo('今日')

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
    await waitFor(() => !one('.w1-modal'), 2000)
    check('笔记弹窗关闭', !one('.w1-modal'))
    check('笔记写入列表', one('.w1-nlist')?.textContent?.includes('来自自动化冒烟测试的笔记'), one('.w1-nlist')?.textContent ?? '')

    byText('.w1-btn', '开始专注')?.click()
    await sleep(400)
    check('专注模式打开', !!one('.w1-focus'))
    one('.w1-focus .w1-pb.pri')?.click()
    await waitFor(() => !one('.w1-focus'), 2000)
    check('专注模式关闭', !one('.w1-focus'))

    byText('.w1-tlblk', '深度工作')?.click()
    await sleep(400)
    check(
      '时间块可开始专注',
      one('.w1-focus')?.textContent?.includes('深度工作 · 10:30'),
      one('.w1-focus')?.textContent?.slice(0, 60) ?? ''
    )
    one('.w1-focus .w1-pb.pri')?.click()
    await waitFor(() => !one('.w1-focus'), 2000)
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
    setValue(paletteInput, '多会话')
    await sleep(300)
    const selectedSession = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '搜索命中会话时优先会话',
      selectedSession.includes('测一下多会话回复') && !selectedSession.includes('发送给'),
      selectedSession
    )
    paletteInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        !one('.w1-palette') &&
        activeNav() === 'Agent' &&
        (one('.w1-tdiv')?.textContent ?? '').includes('测一下多会话回复'),
      2500
    )
    check(
      '命令面板跳转会话并切换视图',
      !one('.w1-palette') && activeNav() === 'Agent' && one('.w1-tdiv')?.textContent?.includes('测一下多会话回复'),
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
    check(
      '命令面板可执行筛选',
      all('.w1-task').length > 0 && all('.w1-task').every((el) => !el.classList.contains('done')),
      String(all('.w1-task').length)
    )
    byText('.w1-filter', '全部')?.click()
    await sleep(250)
    check(
      '筛选恢复全部',
      all('.w1-task').some((el) => el.classList.contains('done')),
      String(all('.w1-task').length)
    )
    one('.w1-motion')?.focus()

    await openPalette()
    const viewInput = one('.w1-paletteinput')
    setValue(viewInput, '打开全部笔记')
    await sleep(300)
    viewInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () => !one('.w1-palette') && activeNav() === '笔记' && !!one('.w1-notesview'),
      2500
    )
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
      '学习科目按卡片数降序（全部/英语二/管综…/…/已停用）',
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

    byText('.w1-lfilebtn', '统计')?.click()
    await sleep(350)
    check(
      '学习统计弹层显示 7 天预测',
      !!one('.w1-lstats') && all('.w1-lstatday').length === 7,
      String(all('.w1-lstatday').length)
    )
    check(
      '学习统计显示保持率与掌握分布',
      (one('.w1-lstatgrid')?.textContent ?? '').includes('记忆保持率') &&
        all('.w1-lstatlegend span').length === 3,
      one('.w1-lstatgrid')?.textContent ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)
    check('Esc 关闭学习统计', !one('.w1-lstats'))

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

    // CSV 导入：用 File + DataTransfer 驱动隐藏 input，覆盖预览与提交
    const importInput = one('#learn-import-file')
    check(
      '学习视图有 CSV 导入导出入口',
      Boolean(importInput) && !!byText('.w1-lfilebtn', '导入') && !!byText('.w1-lfilebtn', '导出')
    )
    const csv = '科目,正面,背面,来源,类型,挖空原文\\n管综逻辑,冒烟导入卡,导入测试,,基础,\\n'
    const file = new File([csv], 'smoke.csv', { type: 'text/csv' })
    const transfer = new DataTransfer()
    transfer.items.add(file)
    importInput.files = transfer.files
    importInput.dispatchEvent(new Event('change', { bubbles: true }))
    await sleep(500)
    check(
      'CSV 导入弹出预览',
      !!one('.w1-limport') && (one('.w1-limportstats')?.textContent ?? '').includes('1'),
      one('.w1-limportstats')?.textContent ?? ''
    )
    byText('.w1-limport .w1-pb.pri', '导入 1 张')?.click()
    await sleep(700)
    check(
      'CSV 导入写入卡片',
      !one('.w1-limport') && all('.w1-litem').some((el) => el.textContent?.includes('冒烟导入卡')),
      one('.w1-lnotice')?.textContent ?? ''
    )

    byText('.w1-learnrail .w1-todorow', '管综数学')?.click()
    await sleep(350)
    check(
      '按科目收窄卡片',
      all('.w1-litem').length === 3,
      String(all('.w1-litem').length)
    )
    byText('.w1-learnrail .w1-todorow', '全部')?.click()
    await sleep(350)

    byText('.w1-learnrail button', '新建')?.click()
    await sleep(300)
    check('新建卡片表单内联展开', !!one('.w1-lnew'))
    setValue(one('#learn-new-subject'), '管综逻辑')
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
    setValue(one('#learn-new-subject'), '管综逻辑')
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
    await waitFor(
      () => one('.w1-lfront')?.style.opacity === '0' && !!one('.w1-lcardnotes'),
      2000
    )
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

    byText('.w1-lfilebtn', '统计')?.click()
    await sleep(500)
    check(
      '统计显示 14 天复习历史',
      all('.w1-lreviewday').length === 14 &&
        (one('.w1-lreviewchart')?.textContent ?? '').includes('1'),
      String(all('.w1-lreviewday').length)
    )
    check(
      '统计显示评分分布',
      all('.w1-lratestack i').length === 4 &&
        (one('.w1-lstats')?.textContent ?? '').includes('良好 1'),
      one('.w1-lstats')?.textContent?.slice(0, 80) ?? ''
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(300)

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
    await waitFor(
      () => (one('.w1-paletteitem[data-selected="true"]')?.textContent ?? '').includes('发送给 Claude'),
      1500
    )
    const selectedSend = one('.w1-paletteitem[data-selected="true"]')?.textContent ?? ''
    check(
      '无匹配命令时回退为发送',
      selectedSend.includes('发送给 Claude') && !selectedSend.includes('测一下多会话'),
      selectedSend
    )
    sendInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await waitFor(
      () =>
        activeNav() === 'Agent' &&
        (one('.w1-thread')?.textContent ?? '').includes('帮我拟一条周报提醒') &&
        !!one('.w1-typing'),
      1500
    )
    check(
      '命令面板发送后切到 Agent',
      activeNav() === 'Agent' && one('.w1-thread')?.textContent?.includes('帮我拟一条周报提醒') && !!one('.w1-typing'),
      activeNav()
    )

    await openPalette(150)
    const busyInput = one('.w1-paletteinput')
    setValue(busyInput, '再发一条')
    await waitFor(() => byText('.w1-paletteitem', '发送给') !== undefined, 1000)
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

    const paletteClosed = await waitFor(() => !one('.w1-palette'), 2000)
    const paletteFocusReturned = await waitFor(
      () => document.activeElement?.classList.contains('w1-motion') === true,
      2000
    )
    check('Esc 关闭命令面板', paletteClosed)
    check(
      'Esc 后焦点归位',
      paletteFocusReturned,
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
    await waitFor(() => !one('.w1-shortcuts'), 2000)
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
    await waitFor(
      () => !one('.w1-modal') && document.activeElement?.classList.contains('w1-motion'),
      2000
    )
    check(
      '快速笔记关闭后焦点归位',
      !one('.w1-modal') && document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    await navTo('今日')
    one('.w1-nall')?.click()
    await sleep(600)
    check('全部笔记入口切换工作区', activeNav() === '笔记' && !!one('.w1-notesview'))

    await navTo('今日')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
    await sleep(350)
    check('Ctrl+N 打开笔记', !!one('.w1-modal'))
    one('.w1-modalx')?.click()
    await waitFor(() => !one('.w1-modal'), 2000)
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
      fsrs: count('SELECT COUNT(*) AS n FROM learning_items WHERE stability IS NOT NULL'),
      agentSessions: count('SELECT COUNT(*) AS n FROM agent_sessions'),
      agentMessages: count('SELECT COUNT(*) AS n FROM agent_messages'),
      importedMessages: count("SELECT COUNT(*) AS n FROM agent_messages WHERE origin = 'import'"),
      importedTools: count(
        "SELECT COUNT(*) AS n FROM agent_messages WHERE origin = 'import' AND tools_json IS NOT NULL"
      ),
      agentResume: count('SELECT COUNT(*) AS n FROM agent_sessions WHERE resume_id IS NOT NULL'),
      codexSessions: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE agent = 'codex'"),
      codexResume: count(
        "SELECT COUNT(*) AS n FROM agent_sessions WHERE agent = 'codex' AND resume_id IS NOT NULL"
      ),
      agentWorkspaces: count("SELECT COUNT(*) AS n FROM agent_sessions WHERE workspace <> ''"),
      agentRuns: count('SELECT COUNT(*) AS n FROM agent_runs'),
      plugins: count('SELECT COUNT(*) AS n FROM agent_plugins'),
      mcpServers: count('SELECT COUNT(*) AS n FROM mcp_servers'),
      mcpAudit: count("SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp'"),
      mcpWrites: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'write'"
      ),
      mcpPolicy: count('SELECT COUNT(*) AS n FROM mcp_domain_modes'),
      mcpTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 写入测试' AND deleted_at IS NULL"
      ),
      mcpApprovalTask: count(
        "SELECT COUNT(*) AS n FROM tasks WHERE title = 'MCP 审批写入' AND deleted_at IS NULL"
      ),
      mcpApproveAudit: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND action = 'approve'"
      ),
      mcpAuditLeak: count(
        "SELECT COUNT(*) AS n FROM audit_log WHERE domain = 'mcp' AND (detail LIKE '%Bearer%' OR detail LIKE '%token%')"
      ),
      providers: count('SELECT COUNT(*) AS n FROM provider_profiles'),
      providerTokens: count(
        'SELECT COUNT(*) AS n FROM provider_profiles WHERE token_encrypted IS NOT NULL'
      ),
      providerActive: count('SELECT COUNT(*) AS n FROM provider_profiles WHERE active = 1')
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
  results.checks.push({
    name: '智能体会话与消息已落库',
    ok: Boolean(dbStats && dbStats.agentSessions >= 2 && dbStats.agentMessages >= 10),
    detail: dbStats ? `${dbStats.agentSessions} 会话 / ${dbStats.agentMessages} 条` : '无数据'
  })
  results.checks.push({
    name: 'Claude 与 Codex 的 resume id 已保存',
    ok: Boolean(dbStats && dbStats.agentResume >= 2),
    detail: dbStats ? String(dbStats.agentResume) : '无数据'
  })
  results.checks.push({
    name: 'Codex 会话与 resume id 已落库',
    ok: Boolean(dbStats && dbStats.codexSessions === 1 && dbStats.codexResume === 1),
    detail: dbStats ? `${dbStats.codexSessions} 会话 / resume ${dbStats.codexResume}` : '无数据'
  })
  results.checks.push({
    name: 'Agent 会话工作区已落库',
    ok: Boolean(dbStats && dbStats.agentWorkspaces >= 2),
    detail: dbStats ? String(dbStats.agentWorkspaces) : '无数据'
  })
  results.checks.push({
    name: '导入历史消息已落库',
    ok: Boolean(dbStats && dbStats.importedMessages > 0 && dbStats.importedTools > 0),
    detail: dbStats ? `${dbStats.importedMessages} 条 / 工具卡 ${dbStats.importedTools}` : '无数据'
  })
  results.checks.push({
    name: 'Agent 运行用量已落库',
    ok: Boolean(dbStats && dbStats.agentRuns > 0),
    detail: dbStats ? String(dbStats.agentRuns) : '无数据'
  })
  results.checks.push({
    name: '能力中心插件与 MCP 已落库',
    ok: Boolean(dbStats && dbStats.plugins === 1 && dbStats.mcpServers === 1),
    detail: dbStats ? `${dbStats.plugins} 插件 / ${dbStats.mcpServers} MCP` : '无数据'
  })
  let codexConfig = ''
  try {
    codexConfig = readFileSync(join(dataDir, 'db', 'codex-home', 'config.toml'), 'utf8')
  } catch {
    // 没有 Codex Provider 运行过就没有配置文件，下面按失败断言
  }
  const codexExternalReady =
    codexConfig.includes('[mcp_servers.workstationforone]') &&
    codexConfig.includes('[mcp_servers.memory]') &&
    codexConfig.includes('default_tools_approval_mode = "prompt"') &&
    !codexConfig.includes('sk-smoke-codex-secret')
  results.checks.push({
    name: 'Codex Provider 配置下发外部 MCP 且不含密钥值',
    ok: codexExternalReady,
    detail: codexExternalReady
      ? 'memory + workstationforone'
      : codexConfig.slice(0, 160) || '无配置'
  })
  results.checks.push({
    name: 'MCP 调用已写审计',
    ok: Boolean(dbStats && dbStats.mcpAudit > 0),
    detail: dbStats ? String(dbStats.mcpAudit) : '无数据'
  })
  results.checks.push({
    name: 'MCP 写入任务与审计已落库',
    ok: Boolean(dbStats && dbStats.mcpTask === 1 && dbStats.mcpWrites > 0),
    detail: dbStats ? `task ${dbStats.mcpTask} / write ${dbStats.mcpWrites}` : '无数据'
  })
  results.checks.push({
    name: 'MCP 审批写入与决定已落库',
    ok: Boolean(dbStats && dbStats.mcpApprovalTask === 1 && dbStats.mcpApproveAudit > 0),
    detail: dbStats
      ? `task ${dbStats.mcpApprovalTask} / approve ${dbStats.mcpApproveAudit}`
      : '无数据'
  })
  results.checks.push({
    name: 'MCP 域权限默认值已落库',
    ok: Boolean(dbStats && dbStats.mcpPolicy === 4),
    detail: dbStats ? String(dbStats.mcpPolicy) : '无数据'
  })
  results.checks.push({
    name: 'MCP 审计不含 token',
    ok: Boolean(dbStats && dbStats.mcpAuditLeak === 0),
    detail: dbStats ? String(dbStats.mcpAuditLeak) : '无数据'
  })
  results.checks.push({
    name: 'Provider 配置与加密 Key 已落库',
    ok: Boolean(
      dbStats && dbStats.providers > 0 && dbStats.providerTokens > 0 && dbStats.providerActive === 0
    ),
    detail: dbStats
      ? `${dbStats.providers} 条 / token ${dbStats.providerTokens} / active ${dbStats.providerActive}`
      : '无数据'
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
    providerProbe.close()
  } catch {
    // 探针已关闭
  }
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
