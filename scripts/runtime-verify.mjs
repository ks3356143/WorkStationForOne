import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { gzipSync } from 'node:zlib'
import { setTimeout as sleep } from 'node:timers/promises'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron')

// 校验过程会创建任务；指向临时数据目录，避免改写真实用户库。
const dataDir = mkdtempSync(join(tmpdir(), 'ws-verify-'))
// 主题/皮肤存在 Chromium localStorage；用独立 profile，避免读取或污染真实应用偏好。
const profileDir = mkdtempSync(join(tmpdir(), 'ws-verify-profile-'))
const env = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'ELECTRON_RUN_AS_NODE')
  ),
  WS_DATA_DIR: dataDir,
  WS_DISABLE_CAPTURE_SHORTCUT: '1'
}
process.on('exit', () => {
  for (const dir of [dataDir, profileDir]) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
    } catch {
      // 清理失败不影响结论。
    }
  }
})

const PAGE_PORT = 9333
const MAIN_PORT = 9334
const checks = []
const consoleErrors = []
const exceptions = []
const phases = []
const report = { checks, phases, consoleErrors, exceptions }

function record(name, ok, detail = '') {
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail)
  checks.push({ name, ok: Boolean(ok), detail: text })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${text ? ` · ${text}` : ''}`)
}

async function waitFor(fn, { timeout = 20000, interval = 100, label = 'condition' } = {}) {
  const started = Date.now()
  let lastError = null
  while (Date.now() - started < timeout) {
    try {
      const value = await fn()
      if (value) return value
    } catch (error) {
      lastError = error
    }
    await sleep(interval)
  }
  throw new Error(`timeout: ${label}${lastError ? ` · ${lastError.message}` : ''}`)
}

async function getJson(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`${url} -> ${response.status}`)
  return response.json()
}

function connect(url, label) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    let sequence = 0
    const pending = new Map()
    const events = []

    const api = {
      events,
      call(method, params = {}) {
        const id = ++sequence
        return new Promise((res, rej) => {
          pending.set(id, { res, rej })
          socket.send(JSON.stringify({ id, method, params }))
        })
      },
      close() {
        try {
          socket.close()
        } catch {
          /* already closed */
        }
      }
    }

    socket.onopen = () => resolve(api)
    socket.onerror = () => reject(new Error(`${label} websocket error`))
    // 连接断了要立即失败未决请求，否则它们会永远 pending，把整轮验证挂住
    socket.onclose = () => {
      for (const [id, request] of pending) {
        pending.delete(id)
        request.rej(new Error(`${label} websocket closed`))
      }
    }
    socket.onmessage = (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const request = pending.get(message.id)
        if (!request) return
        pending.delete(message.id)
        if (message.error)
          request.rej(
            new Error(`${label} ${message.error.message || JSON.stringify(message.error)}`)
          )
        else request.res(message.result ?? {})
        return
      }
      events.push(message)
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params?.exceptionDetails
        exceptions.push(details?.exception?.description || details?.text || 'unknown exception')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        const text = (message.params.args || [])
          .map((arg) => arg.value ?? arg.description ?? '')
          .join(' ')
        consoleErrors.push(text)
      }
      if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
        consoleErrors.push(message.params.entry.text)
      }
    }
  })
}

/** 单次求值的上限：主进程一旦卡住，CDP 不会自己返回，没有它会挂死整轮验证。 */
const EVAL_TIMEOUT_MS = 30000

async function withTimeout(promise, ms, label) {
  let timer = null
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${label} (${ms}ms)`)), ms)
  })
  try {
    return await Promise.race([promise, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function evaluate(target, expression, label = 'evaluate') {
  const call = target.call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    includeCommandLineAPI: true
  })
  const result = await withTimeout(call, EVAL_TIMEOUT_MS, label)
  if (result.exceptionDetails) {
    throw new Error(
      `${label}: ${result.exceptionDetails.exception?.description || result.exceptionDetails.text}`
    )
  }
  return result.result?.value
}

let app = null

async function launch(phase) {
  const startedAt = Date.now()
  const child = spawn(
    electronExecutable,
    [
      // 验证期间窗口可能被其它应用遮挡；关掉后台节流，和冒烟的 backgroundThrottling=false 对齐。
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      `--user-data-dir=${profileDir}`,
      `--remote-debugging-port=${PAGE_PORT}`,
      `--inspect=${MAIN_PORT}`,
      '--remote-allow-origins=*',
      '.'
    ],
    { cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let output = ''
  let exitCode = null
  child.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  child.on('exit', (code) => {
    exitCode = code ?? 0
  })

  const pageTarget = await waitFor(
    async () => {
      const targets = await getJson(`http://127.0.0.1:${PAGE_PORT}/json/list`)
      return targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
    },
    { timeout: 30000, label: 'renderer target' }
  )
  const pageTargetMs = Date.now() - startedAt

  const mainTarget = await waitFor(
    async () => {
      const targets = await getJson(`http://127.0.0.1:${MAIN_PORT}/json/list`)
      return targets.find((target) => target.webSocketDebuggerUrl)
    },
    { timeout: 30000, label: 'main target' }
  )

  const page = await connect(pageTarget.webSocketDebuggerUrl, 'renderer')
  const main = await connect(mainTarget.webSocketDebuggerUrl, 'main')
  await Promise.all([
    page.call('Runtime.enable'),
    page.call('Log.enable'),
    page.call('Page.enable'),
    page.call('Performance.enable'),
    main.call('Runtime.enable')
  ])
  await page.call('Page.bringToFront').catch(() => {})
  await page.call('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  // 其它窗口可能抢走焦点；验证期间把应用窗口置顶并聚焦，和冒烟保持同一前提。
  try {
    await evaluate(
      main,
      `(() => {
        let req
        try { req = require } catch { req = process.mainModule && process.mainModule.require.bind(process.mainModule) }
        if (!req) return false
        const { BrowserWindow } = req('electron')
        const win = BrowserWindow.getAllWindows()[0]
        if (!win) return false
        win.setAlwaysOnTop(true, 'screen-saver')
        win.show()
        win.focus()
        return win.isFocused()
      })()`,
      'focus window'
    )
  } catch (error) {
    console.error('[focus window]', error.message)
  }

  // Electron 45 没有 getTitleBarOverlay()，用原型探针记录真实的 setTitleBarOverlay 调用。
  try {
    await evaluate(
      main,
      `(() => {
        let req
        try { req = require } catch { req = process.mainModule && process.mainModule.require.bind(process.mainModule) }
        const { BrowserWindow } = req('electron')
        if (!globalThis.__overlayCalls) {
          globalThis.__overlayCalls = []
          const prototype = BrowserWindow.prototype
          const original = prototype.setTitleBarOverlay
          if (typeof original !== 'function') return { patched: false }
          prototype.setTitleBarOverlay = function (options) {
            globalThis.__overlayCalls.push({ options, at: Date.now() })
            return original.call(this, options)
          }
        }
        return { patched: true }
      })()`,
      'overlay probe'
    )
  } catch (error) {
    console.error('[overlay probe]', error.message)
  }

  await waitFor(
    async () => (await evaluate(page, 'document.readyState', 'readyState')) === 'complete',
    { timeout: 30000, label: 'readyState complete' }
  )
  const readyMs = Date.now() - startedAt
  await waitFor(
    async () => evaluate(page, `Boolean(document.querySelector('.w1.is-booted'))`, 'booted'),
    {
      timeout: 10000,
      label: 'shell booted'
    }
  )
  const bootedMs = Date.now() - startedAt
  // 全新 profile 没有偏好记录；补上默认值，让基线断言与旧 profile 的行为一致。
  await evaluate(
    page,
    `(() => {
      if (!localStorage.getItem('workstation.theme')) localStorage.setItem('workstation.theme', 'dark')
      if (!localStorage.getItem('workstation.skin')) localStorage.setItem('workstation.skin', 'prism')
      return true
    })()`,
    'baseline prefs'
  )
  await sleep(350)

  app = {
    phase,
    child,
    page,
    main,
    startedAt,
    pageTargetMs,
    readyMs,
    bootedMs,
    exited: () => exitCode,
    output: () => output
  }
  return app
}

const pageEval = (expression, label) => evaluate(app.page, expression, label)

const mainEval = (expression, label) => evaluate(app.main, expression, label)

async function shake(ms = 120) {
  await sleep(ms)
}

async function quitApp() {
  try {
    await pageEval('window.close(); true', 'close window')
  } catch {
    /* window may already be gone */
  }
  const exited = await waitFor(async () => app.exited() !== null, {
    timeout: 10000,
    label: 'app exit'
  })
    .then(() => true)
    .catch(() => false)
  if (!exited) {
    app.child.kill()
    await sleep(1200)
  }
  app.page.close()
  app.main.close()
  await sleep(700)
}

const stateExpr = `(() => {
  const root = document.documentElement
  const w1 = document.querySelector('.w1')
  const btn = document.querySelector('.w1-theme')
  if (!w1 || !btn) return { missing: true, html: document.body.innerHTML.slice(0, 120) }
  const cs = getComputedStyle(w1)
  const toast = document.querySelector('.w1-toast')
  return {
    theme: root.dataset.theme ?? null,
    skin: root.dataset.skin ?? null,
    stored: localStorage.getItem('workstation.theme'),
    storedSkin: localStorage.getItem('workstation.skin'),
    pressed: btn.getAttribute('aria-pressed'),
    label: btn.textContent.trim(),
    ariaLabel: btn.getAttribute('aria-label'),
    color: cs.color,
    bg0: cs.getPropertyValue('--bg0').trim(),
    fg: cs.getPropertyValue('--fg').trim(),
    toast: toast ? toast.textContent.trim() : null,
    booted: w1.classList.contains('is-booted')
  }
})()`

const windowStateExpr = `(() => {
  let req
  try { req = require } catch { req = process.mainModule && process.mainModule.require.bind(process.mainModule) }
  if (!req) return { error: 'no require in main inspector' }
  const { BrowserWindow, app } = req('electron')
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return { error: 'no window' }
  const overlay = typeof win.getTitleBarOverlay === 'function' ? win.getTitleBarOverlay() : null
  return {
    bg: win.getBackgroundColor(),
    overlay,
    visible: win.isVisible(),
    focused: win.isFocused(),
    bounds: win.getBounds(),
    minimumSize: win.getMinimumSize(),
    contentSize: win.getContentSize(),
    metrics: app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetKb: metric.memory?.workingSetSize ?? null,
      cpu: metric.cpu?.percentCPUUsage ?? null
    }))
  }
})()`

const startupExpr = `(() => {
  const nav = performance.getEntriesByType('navigation')[0]
  const paint = performance.getEntriesByType('paint').map((entry) => ({ name: entry.name, startTime: +entry.startTime.toFixed(1) }))
  return {
    readyState: document.readyState,
    now: +performance.now().toFixed(1),
    navigation: nav ? {
      responseEnd: +nav.responseEnd.toFixed(1),
      domContentLoaded: +nav.domContentLoadedEventEnd.toFixed(1),
      load: +nav.loadEventEnd.toFixed(1)
    } : null,
    paint,
    domNodes: document.querySelectorAll('*').length
  }
})()`

const metricsExpr = `(() => {
  const metrics = Object.fromEntries(performance.getEntriesByType('paint').map((entry) => [entry.name, +entry.startTime.toFixed(1)]))
  const heap = performance.memory ? {
    used: performance.memory.usedJSHeapSize,
    total: performance.memory.totalJSHeapSize,
    limit: performance.memory.jsHeapSizeLimit
  } : null
  return { paint: metrics, heap }
})()`

const clickThemeExpr = `(async () => {
  const btn = document.querySelector('.w1-theme')
  const before = { theme: document.documentElement.dataset.theme, stored: localStorage.getItem('workstation.theme') }
  const t0 = performance.now()
  btn.click()
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const t1 = performance.now()
  return {
    elapsed: +(t1 - t0).toFixed(2),
    before,
    after: { theme: document.documentElement.dataset.theme, stored: localStorage.getItem('workstation.theme'), pressed: btn.getAttribute('aria-pressed'), label: btn.textContent.trim() },
    color: getComputedStyle(document.querySelector('.w1')).color,
    toast: document.querySelector('.w1-toast')?.textContent?.trim() ?? null
  }
})()`

const expectedWindow = {
  dark: { bg: '#070812', symbol: '#b7c9dc' },
  light: { bg: '#eef2fb', symbol: '#35415c' }
}

const VIEW_EXPECTATIONS = {
  today: {
    active: '今日',
    hasMain: true,
    hasTasks: false,
    hasAgent: false,
    hasNotes: false,
    hasLearning: false,
    hasReview: false
  },
  tasks: {
    active: '任务',
    hasMain: false,
    hasTasks: true,
    hasAgent: false,
    hasNotes: false,
    hasLearning: false,
    hasReview: false
  },
  agent: {
    active: 'Agent',
    hasMain: false,
    hasTasks: false,
    hasAgent: true,
    hasNotes: false,
    hasLearning: false,
    hasReview: false
  },
  notes: {
    active: '笔记',
    hasMain: false,
    hasTasks: false,
    hasAgent: false,
    hasNotes: true,
    hasLearning: false,
    hasReview: false
  },
  learning: {
    active: '学习',
    hasMain: false,
    hasTasks: false,
    hasAgent: false,
    hasNotes: false,
    hasLearning: true,
    hasReview: false
  }
}

const navStateExpr = `(() => {
  const root = document.documentElement
  const items = [...document.querySelectorAll('.w1-navitem')]
  const active = items.find((item) => item.classList.contains('on'))
  const navLabel = document.querySelector('.w1-navtext b')
  const chatText = document.querySelector('.w1-atext, .w1-umsg')
  const nvbox = document.querySelector('.w1-nvbox')
  const nvrow = document.querySelector('.w1-nvrow')
  const rail = document.querySelector('.w1-rail')
  const dock = document.querySelector('.w1-dock')
  const stage = document.querySelector('.w1-stage')
  const view = document.querySelector('.w1-view')
  const interactive = [...document.querySelectorAll('button, input, textarea, [role="checkbox"], [role="button"]')]
  return {
    viewCount: document.querySelectorAll('.w1-view').length,
    hasMain: Boolean(document.querySelector('.w1-main')),
    hasTasks: Boolean(document.querySelector('.w1-todos')),
    hasAgent: Boolean(document.querySelector('.w1-agent')),
    hasNotes: Boolean(document.querySelector('.w1-notesview')),
    hasLearning: Boolean(document.querySelector('.w1-learn')),
    hasReview: Boolean(document.querySelector('.w1-lreview')),
    hasRail: Boolean(rail),
    hasDock: Boolean(dock),
    hasNvBox: Boolean(nvbox),
    labels: items.map((item) => item.querySelector('.w1-navtext b')?.textContent?.trim() ?? ''),
    active: active?.querySelector('.w1-navtext b')?.textContent?.trim() ?? null,
    ariaCurrent: items.filter((item) => item.getAttribute('aria-current') === 'page').length,
    navWidth: +(document.querySelector('.w1-nav')?.getBoundingClientRect().width ?? 0).toFixed(1),
    stageWidth: +(stage?.getBoundingClientRect().width ?? 0).toFixed(1),
    viewWidth: +(view?.getBoundingClientRect().width ?? 0).toFixed(1),
    docOverflowX: root.scrollWidth - root.clientWidth,
    bodyOverflowX: document.body.scrollWidth - document.body.clientWidth,
    fontSizes: {
      navLabel: navLabel ? getComputedStyle(navLabel).fontSize : null,
      chat: chatText ? getComputedStyle(chatText).fontSize : null
    },
    notes: {
      dialog: Boolean(document.querySelector('[role="dialog"][aria-label="全部笔记"]')),
      close: Boolean(document.querySelector('.w1-nvclose')),
      width: +(nvbox?.getBoundingClientRect().width ?? 0).toFixed(1),
      rowHeight: nvrow ? +nvrow.getBoundingClientRect().height.toFixed(1) : null
    },
    agent: {
      railWidth: +(rail?.getBoundingClientRect().width ?? 0).toFixed(1),
      dockWidth: +(dock?.getBoundingClientRect().width ?? 0).toFixed(1)
    },
    tasks: {
      railWidth: +(document.querySelector('.w1-todorail')?.getBoundingClientRect().width ?? 0).toFixed(1),
      mainWidth: +(document.querySelector('.w1-todomain')?.getBoundingClientRect().width ?? 0).toFixed(1),
      rows: document.querySelectorAll('.w1-todorowwrap').length,
      quick: Boolean(document.querySelector('.w1-todoinput')),
      title: document.querySelector('.w1-todotitle')?.textContent?.trim() ?? null
    },
    unnamed: interactive
      .filter((element) => !(element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim()))
      .map((element) => element.className?.toString().slice(0, 40) ?? element.tagName)
  }
})()`

async function clickNav(label) {
  const clicked = await pageEval(
    `(() => {
      const item = [...document.querySelectorAll('.w1-navitem')].find(
        (element) => element.querySelector('.w1-navtext b')?.textContent.trim() === ${JSON.stringify(label)}
      )
      if (!item) return false
      item.click()
      return true
    })()`,
    `nav ${label}`
  )
  if (!clicked) throw new Error(`导航项缺失：${label}`)
  await sleep(520)
}

let runtimeTask = null

/**
 * 把刚建的任务「变老」：直接改库里的 created_at。
 * 过期标记只有跨过 14 天才会出现，走 UI 造不出这种数据。
 */
function ageRuntimeTask(days) {
  if (!runtimeTask) return false
  const file = join(dataDir, 'workstation.db')
  const db = new DatabaseSync(file)
  try {
    const at = Date.now() - days * 86_400_000
    db.prepare('UPDATE tasks SET created_at = ? WHERE id = ?').run(at, runtimeTask.id)
    runtimeTask.ageDays = days
    return true
  } finally {
    db.close()
  }
}

async function createRuntimeTask() {
  const title = `运行时校验 ${Date.now()}`
  await clickNav('任务')
  const result = await pageEval(
    `(async () => {
      const input = document.querySelector('.w1-todoinput')
      if (!input) return { error: 'no input' }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(`${title} #验证 !中`)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 200))
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 650))
      const tasks = await window.ws.tasks.list()
      const saved = tasks.find((task) => task.title === ${JSON.stringify(title)})
      const row = [...document.querySelectorAll('.w1-todorowwrap')].some((element) =>
        element.textContent.includes(${JSON.stringify(title)})
      )
      return { saved, row, inputValue: input.value }
    })()`,
    'runtime task create'
  )
  if (result?.saved) runtimeTask = { id: result.saved.id, title }
  record('运行时：快速添加任务出现在列表', result?.row === true, result)
  record('运行时：可把任务创建时间改到 30 天前', ageRuntimeTask(30), runtimeTask)
  record('运行时：新任务写入 SQLite', Boolean(result?.saved), result?.saved ?? result)
  record(
    '运行时：新任务保留清单与优先级',
    result?.saved?.list === '验证' && result?.saved?.priority === 2,
    result?.saved
  )
  await clickNav('今日')

  // 中文数字与相对天数要走通真实输入链路
  await clickNav('任务')
  const parsePreviews = await pageEval(
    `(async () => {
      const input = document.querySelector('.w1-todoinput')
      if (!input) return { error: 'no input' }
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const read = async (text) => {
        setter.call(input, text)
        input.dispatchEvent(new Event('input', { bubbles: true }))
        await new Promise((resolve) => setTimeout(resolve, 220))
        return [...document.querySelectorAll('.w1-todoquickhint .w1-todochip')].map((chip) => chip.textContent.trim())
      }
      const chineseTime = await read('下午三点半开会')
      const relative = await read('3 天后复盘')
      const deadline = await read('周五前交报告')
      const midnight = await read('晚上 12 点提交周报')
      const ambiguous = await read('一点意见想提')
      setter.call(input, '')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return { chineseTime, relative, deadline, midnight, ambiguous }
    })()`,
    'parse previews'
  )
  record(
    '运行时：中文数字时间预览为 15:30',
    (parsePreviews?.chineseTime ?? []).includes('15:30'),
    parsePreviews?.chineseTime
  )
  record(
    '运行时：3 天后解析出日期',
    (parsePreviews?.relative ?? []).length === 1,
    parsePreviews?.relative
  )
  record(
    '运行时：周五前不残留「前」字',
    (parsePreviews?.deadline ?? []).length === 1,
    parsePreviews?.deadline
  )
  record(
    '运行时：晚上 12 点为 00:00',
    (parsePreviews?.midnight ?? []).includes('00:00'),
    parsePreviews?.midnight
  )
  record(
    '运行时：一点意见不当作时间',
    !(parsePreviews?.ambiguous ?? []).includes('01:00'),
    parsePreviews?.ambiguous
  )
  await clickNav('今日')

  // 删除与撤销要走通 IPC 与 SQLite 软删
  await clickNav('任务')
  const deleteUndo = await pageEval(
    `(async () => {
      const rows = [...document.querySelectorAll('.w1-todorowwrap')]
      const row = rows[0]
      if (!row) return { error: 'no row' }
      const before = rows.length
      row.querySelector('.w1-todobody')?.click()
      await new Promise((resolve) => setTimeout(resolve, 420))
      const del = document.querySelector('.w1-tododelete')
      del?.click()
      await new Promise((resolve) => setTimeout(resolve, 180))
      del?.click()
      await new Promise((resolve) => setTimeout(resolve, 700))
      const afterDelete = document.querySelectorAll('.w1-todorowwrap').length
      const undoButton = document.querySelector('.w1-toastact')
      const label = undoButton?.textContent?.trim() ?? null
      const listAfterDelete = await window.ws.tasks.list()
      undoButton?.click()
      await new Promise((resolve) => setTimeout(resolve, 900))
      const afterUndo = document.querySelectorAll('.w1-todorowwrap').length
      const listAfterUndo = await window.ws.tasks.list()
      return {
        before,
        afterDelete,
        label,
        afterUndo,
        restored: listAfterUndo.length === listAfterDelete.length + 1,
        toastCleared: !document.querySelector('.w1-toastact')
      }
    })()`,
    'delete undo'
  )
  record(
    '运行时：删除任务后行数减一',
    deleteUndo?.afterDelete === deleteUndo?.before - 1,
    deleteUndo
  )
  record('运行时：删除提示带撤销入口', deleteUndo?.label === '撤销', deleteUndo?.label)
  record('运行时：撤销后任务回到列表', deleteUndo?.afterUndo === deleteUndo?.before, deleteUndo)
  record('运行时：撤销写回 SQLite', deleteUndo?.restored === true, deleteUndo)
  record('运行时：撤销后提示消失', deleteUndo?.toastCleared === true, deleteUndo)
  await clickNav('今日')
}

async function verifyLearningReview() {
  await clickNav('学习')
  const result = await pageEval(
    `(async () => {
      const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
      document.querySelector('.w1-lrevbtn')?.click()
      await wait(600)
      const inReview = Boolean(document.querySelector('.w1-lreview'))
      const title = document.querySelector('.w1-lcardtitle')?.textContent?.trim() ?? ''
      const before = (await window.ws.learning.list()).find((item) => item.title === title)
      if (!before) return { error: '找不到当前卡片', title }

      document.querySelector('.w1-lcard')?.click()
      await wait(450)
      const flipped = Boolean(document.querySelector('.w1-lcard.flipped'))
      const good = [...document.querySelectorAll('.w1-lrate')].find((el) => el.textContent.includes('良好'))
      good?.click()
      await wait(900)
      const after = (await window.ws.learning.list()).find((item) => item.id === before.id)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
      await wait(500)
      return {
        inReview,
        flipped,
        title,
        before,
        after,
        backToLibrary: !document.querySelector('.w1-lreview') && Boolean(document.querySelector('.w1-learn'))
      }
    })()`,
    'learning review'
  )

  record('运行时：进入复习态', result?.inReview === true, result)
  record('运行时：翻面可看到背面', result?.flipped === true, result?.flipped)
  record(
    '运行时：评分后间隔与复习日前移',
    Boolean(result?.after) &&
      result.after.repetitions === result.before.repetitions + 1 &&
      result.after.nextReviewOn > result.before.nextReviewOn,
    result ? { title: result.title, before: result.before, after: result.after } : result
  )
  record('运行时：Esc 回到卡片库', result?.backToLibrary === true, result?.backToLibrary)
  await clickNav('今日')
}

let runtimeHabit = null

async function verifyHabitAfterRestart() {
  if (!runtimeHabit) {
    record('运行时：重启后习惯打卡仍在', false, '未打卡')
    return
  }
  const found = await pageEval(
    `(async () => {
      const habits = await window.ws.habits.list()
      const habit = habits.find((item) => item.id === ${JSON.stringify(runtimeHabit.habitId)})
      const nav = [...document.querySelectorAll('.w1-navitem')].find(
        (node) => node.textContent.includes('今日')
      )
      nav?.click()
      await new Promise((done) => setTimeout(done, 400))
      const dot = [...document.querySelectorAll('.w1-hrow')]
        .find((node) => node.textContent.includes(${JSON.stringify(runtimeHabit.name)}))
        ?.querySelector('.w1-hdot.today.on')
      return { stored: Boolean(habit?.checkins.includes(${JSON.stringify(runtimeHabit.day)})), rendered: Boolean(dot) }
    })()`,
    'habit reload'
  )
  record('运行时：重启后习惯打卡仍在 SQLite', found?.stored === true, found)
  record('运行时：重启后习惯打卡重新渲染', found?.rendered === true, found?.rendered)
}

async function verifyAndRemoveRuntimeTask() {
  if (!runtimeTask) {
    record('运行时：重启后仍能读回任务', false, '未创建任务')
    return
  }
  await clickNav('任务')
  const found = await pageEval(
    `(async () => {
      const tasks = await window.ws.tasks.list()
      const task = tasks.find((item) => item.id === ${JSON.stringify(runtimeTask.id)})
      const row = [...document.querySelectorAll('.w1-todorowwrap')].some((element) =>
        element.textContent.includes(${JSON.stringify(runtimeTask.title)})
      )
      return { found: Boolean(task), task: task ?? null, row }
    })()`,
    'runtime task reload'
  )
  record('运行时：重启后任务仍在 SQLite', found?.found === true, found?.task ?? found)
  record('运行时：重启后任务重新渲染', found?.row === true, found?.row)

  const stale = await pageEval(
    `(() => {
      const row = [...document.querySelectorAll('.w1-todorowwrap')].find((element) =>
        element.textContent.includes(${JSON.stringify(runtimeTask.title)})
      )
      const chip = row?.querySelector('.w1-todostale')
      return { text: chip?.textContent?.trim() ?? null, title: chip?.getAttribute('title') ?? null }
    })()`,
    'stale marker'
  )
  record('运行时：挂了 30 天的任务显示过期标记', stale?.text === '30 天未动', stale)
  record('运行时：标记带创建时间说明', (stale?.title ?? '').includes('30 天前'), stale?.title)

  const deleted = await pageEval(
    `(async () => {
      const row = [...document.querySelectorAll('.w1-todorowwrap')].find((element) =>
        element.textContent.includes(${JSON.stringify(runtimeTask.title)})
      )
      if (!row) return { clicked: false, still: true }
      row.querySelector('.w1-todobody')?.click()
      await new Promise((resolve) => setTimeout(resolve, 250))
      document.querySelector('.w1-tododelete')?.click()
      await new Promise((resolve) => setTimeout(resolve, 100))
      document.querySelector('.w1-tododelete')?.click()
      await new Promise((resolve) => setTimeout(resolve, 550))
      const tasks = await window.ws.tasks.list()
      return { clicked: true, still: tasks.some((item) => item.id === ${JSON.stringify(runtimeTask.id)}) }
    })()`,
    'runtime task delete'
  )
  record(
    '运行时：任务可从界面删除并落库',
    deleted?.clicked === true && deleted?.still === false,
    deleted
  )
  if (deleted?.still !== false && runtimeTask) {
    await pageEval(
      `window.ws.tasks.remove(${JSON.stringify(runtimeTask.id)})`,
      'runtime task cleanup'
    )
  }
  runtimeTask = null
  await clickNav('今日')
}

async function assertView(view, label) {
  const state = await pageEval(navStateExpr, `${label} nav state`)
  const expected = VIEW_EXPECTATIONS[view]
  record(
    `${label}：仅一个工作区且互斥`,
    state.viewCount === 1 &&
      state.hasMain === expected.hasMain &&
      state.hasTasks === expected.hasTasks &&
      state.hasAgent === expected.hasAgent &&
      state.hasNotes === expected.hasNotes &&
      state.hasLearning === expected.hasLearning &&
      state.hasReview === expected.hasReview,
    {
      viewCount: state.viewCount,
      main: state.hasMain,
      tasks: state.hasTasks,
      agent: state.hasAgent,
      notes: state.hasNotes,
      learning: state.hasLearning,
      review: state.hasReview
    }
  )
  record(
    `${label}：导航 aria-current 指向 ${expected.active}`,
    state.active === expected.active && state.ariaCurrent === 1,
    { active: state.active, ariaCurrent: state.ariaCurrent }
  )
  record(
    `${label}：无页面横向溢出`,
    state.docOverflowX <= 0 && state.bodyOverflowX <= 0,
    `doc ${state.docOverflowX} · body ${state.bodyOverflowX}`
  )
  record(
    `${label}：工作区铺满舞台`,
    state.stageWidth > 0 && Math.abs(state.viewWidth - state.stageWidth) < 1,
    { stage: state.stageWidth, view: state.viewWidth, nav: state.navWidth }
  )
  record(
    `${label}：导航标签字号 ≥ 15px`,
    parseFloat(state.fontSizes.navLabel) >= 15,
    state.fontSizes.navLabel
  )
  record(`${label}：交互元素均有可访问名称`, state.unnamed.length === 0, state.unnamed.slice(0, 5))

  if (view === 'agent') {
    record(`${label}：会话栏与聊天区同时存在`, state.hasRail && state.hasDock, {
      rail: state.hasRail,
      dock: state.hasDock
    })
    record(
      `${label}：会话栏宽度 240–320px`,
      state.agent.railWidth >= 240 && state.agent.railWidth <= 320,
      state.agent.railWidth
    )
    record(
      `${label}：聊天正文 ≥ 15px（空态跳过）`,
      state.fontSizes.chat === null || parseFloat(state.fontSizes.chat) >= 15,
      state.fontSizes.chat ?? '空态'
    )
  }
  if (view === 'tasks') {
    record(
      `${label}：任务次级栏 160–260px`,
      state.tasks.railWidth >= 160 && state.tasks.railWidth <= 260,
      state.tasks.railWidth
    )
    record(`${label}：任务快速添加与列表可用`, state.tasks.quick && state.tasks.rows > 0, {
      quick: state.tasks.quick,
      rows: state.tasks.rows,
      title: state.tasks.title
    })
  }
  if (view === 'notes') {
    record(
      `${label}：笔记为全宽工作区而非弹窗`,
      state.hasNvBox && !state.notes.dialog && !state.notes.close,
      state.notes
    )
    record(
      `${label}：笔记框宽度 ≥ 舞台 92%`,
      state.notes.width >= state.stageWidth * 0.92,
      `${state.notes.width} / ${state.stageWidth}`
    )
    record(
      `${label}：笔记行高 68px`,
      Math.abs((state.notes.rowHeight ?? 0) - 68) < 0.5,
      state.notes.rowHeight
    )
  }
  return state
}

async function auditNavigation(label, { expectDefault = true } = {}) {
  const initial = await pageEval(navStateExpr, `${label} initial nav`)
  if (expectDefault) {
    record(
      `${label}：默认停在今日`,
      initial.active === '今日' &&
        initial.hasMain &&
        !initial.hasTasks &&
        !initial.hasAgent &&
        !initial.hasNotes,
      initial.active
    )
  }
  record(
    `${label}：主导航为 今日/任务/Agent/笔记/学习`,
    JSON.stringify(initial.labels) === JSON.stringify(['今日', '任务', 'Agent', '笔记', '学习']),
    initial.labels
  )
  const today = await assertView('today', `${label} 今日`)
  await clickNav('任务')
  const tasks = await assertView('tasks', `${label} 任务`)
  await clickNav('Agent')
  const agent = await assertView('agent', `${label} Agent`)
  await clickNav('笔记')
  const notes = await assertView('notes', `${label} 笔记`)
  await clickNav('学习')
  const learning = await assertView('learning', `${label} 学习`)
  await clickNav('今日')
  const back = await pageEval(navStateExpr, `${label} back to today`)
  record(
    `${label}：返回今日后任务/Agent/笔记/学习 DOM 已卸载`,
    back.active === '今日' &&
      back.hasMain &&
      !back.hasTasks &&
      !back.hasAgent &&
      !back.hasNotes &&
      !back.hasLearning,
    back.active
  )
  return { initial, today, tasks, agent, notes, learning, back }
}

async function auditPaletteNavigation(label) {
  await app.page.call('Page.bringToFront')
  await pageEval(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`,
    'palette open'
  )
  await sleep(260)
  const typed = await pageEval(
    `(() => {
      const input = document.querySelector('.w1-paletteinput')
      if (!input) return false
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      setter.call(input, '打开全部笔记')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    })()`,
    'palette query'
  )
  if (!typed) throw new Error('命令面板输入缺失')
  await sleep(260)
  const committed = await pageEval(
    `(() => {
      const input = document.querySelector('.w1-paletteinput')
      if (!input) return false
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
      return true
    })()`,
    'palette commit'
  )
  if (!committed) throw new Error('命令面板提交失败')
  await sleep(700)
  const state = await pageEval(navStateExpr, 'palette nav result')
  record(
    `${label}：命令面板可直达笔记工作区`,
    state.active === '笔记' &&
      state.hasNotes &&
      !state.hasAgent &&
      !state.hasMain &&
      !state.hasTasks,
    state.active
  )
  const focused = await pageEval(
    `document.activeElement?.className?.toString() ?? ''`,
    'palette focus return'
  )
  record(`${label}：命令跳转后焦点归位`, String(focused).includes('w1-motion'), focused)

  await pageEval(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    'notes escape'
  )
  await sleep(450)
  const afterEscape = await pageEval(navStateExpr, 'notes after escape')
  record(
    `${label}：Esc 不关闭笔记工作区`,
    afterEscape.active === '笔记' && afterEscape.hasNotes,
    afterEscape.active
  )
  await clickNav('今日')
  return state
}

async function measureViewPerformance() {
  const beforeMetrics = await app.page.call('Performance.getMetrics')
  const timing = await pageEval(
    `(async () => {
      const nav = (label) => [...document.querySelectorAll('.w1-navitem')].find(
        (item) => item.querySelector('.w1-navtext b')?.textContent.trim() === label
      )
      const measure = async (label) => {
        const start = performance.now()
        nav(label).click()
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        return +(performance.now() - start).toFixed(2)
      }
      return {
        tasks: await measure('任务'),
        agent: await measure('Agent'),
        notes: await measure('笔记'),
        learning: await measure('学习'),
        today: await measure('今日')
      }
    })()`,
    'view switch timing'
  )
  await sleep(500)
  const afterMetrics = await app.page.call('Performance.getMetrics')
  const before = Object.fromEntries(
    (beforeMetrics.metrics || []).map((metric) => [metric.name, metric.value])
  )
  const after = Object.fromEntries(
    (afterMetrics.metrics || []).map((metric) => [metric.name, metric.value])
  )
  const delta = {
    layouts: after.LayoutCount - before.LayoutCount,
    styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    nodes: after.Nodes
  }
  const worst = Math.max(timing.tasks, timing.agent, timing.notes, timing.learning, timing.today)
  record(
    '五视图切换均在 120ms 内完成首帧',
    worst <= 120,
    `任务 ${timing.tasks}ms · Agent ${timing.agent}ms · 笔记 ${timing.notes}ms · 学习 ${timing.learning}ms · 今日 ${timing.today}ms`
  )
  record(
    '五视图往返布局次数可控',
    delta.layouts <= 100,
    `layout +${delta.layouts} · style +${delta.styleRecalcs}`
  )
  return { timing, delta }
}

function normalizeColor(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

async function assertWindow(theme, label) {
  let snapshot
  try {
    snapshot = await mainEval(windowStateExpr, 'window state')
  } catch (error) {
    record(`${label}：读取窗口外观`, false, error.message)
    return null
  }
  if (snapshot?.error) {
    record(`${label}：读取窗口外观`, false, snapshot.error)
    return snapshot
  }
  const expected = expectedWindow[theme]
  record(
    `${label}：窗口背景 ${expected.bg}`,
    normalizeColor(snapshot.bg) === expected.bg,
    snapshot.bg
  )
  return snapshot
}

async function assertOverlayCall(theme, label) {
  const calls = await mainEval('globalThis.__overlayCalls || []', 'overlay calls')
  const last = calls.at(-1)
  const expected = expectedWindow[theme]
  record(
    `${label}：标题栏 overlay 调用`,
    Boolean(last) &&
      normalizeColor(last.options?.color) === expected.bg &&
      normalizeColor(last.options?.symbolColor) === expected.symbol &&
      last.options?.height === 52,
    last ? last.options : '无调用记录'
  )
  return last
}

async function assertState(theme, label, { toast = null } = {}) {
  const state = await pageEval(stateExpr, `${label} state`)
  const expected =
    theme === 'light'
      ? { color: 'rgb(17, 26, 51)', bg0: '#eef2fb', label: '白天', pressed: 'true' }
      : { color: 'rgb(232, 242, 253)', bg0: '#070812', label: '夜间', pressed: 'false' }
  record(`${label}：<html data-theme>`, state.theme === theme, state.theme)
  record(`${label}：localStorage`, state.stored === theme, state.stored)
  record(`${label}：按钮文案`, state.label === expected.label, state.label)
  record(`${label}：aria-pressed`, state.pressed === expected.pressed, state.pressed)
  record(
    `${label}：正文颜色`,
    normalizeColor(state.color) === normalizeColor(expected.color),
    state.color
  )
  record(`${label}：背景令牌 --bg0`, normalizeColor(state.bg0) === expected.bg0, state.bg0)
  record(
    `${label}：aria-label`,
    String(state.ariaLabel || '').includes(expected.label),
    state.ariaLabel
  )
  if (toast) record(`${label}：toast 提示`, String(state.toast || '').includes(toast), state.toast)
  return state
}

function parseColor(value) {
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (text.startsWith('#')) {
    const hex = text.slice(1)
    const full =
      hex.length === 3
        ? hex
            .split('')
            .map((part) => part + part)
            .join('')
        : hex
    if (full.length !== 6) return null
    return [0, 2, 4].map((index) => parseInt(full.slice(index, index + 2), 16))
  }
  const match = text.match(/rgba?\(([^)]+)\)/)
  if (!match) return null
  return match[1]
    .split(/[\s,/]+/)
    .filter(Boolean)
    .slice(0, 3)
    .map(Number)
}

function relativeLuminance(rgb) {
  const [r, g, b] = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(foreground, background) {
  const fgRgb = parseColor(foreground)
  const bgRgb = parseColor(background)
  if (!fgRgb || !bgRgb) return null
  const fgLum = relativeLuminance(fgRgb)
  const bgLum = relativeLuminance(bgRgb)
  return +((Math.max(fgLum, bgLum) + 0.05) / (Math.min(fgLum, bgLum) + 0.05)).toFixed(2)
}

async function tokenSnapshot() {
  return pageEval(
    `(() => {
      const cs = getComputedStyle(document.querySelector('.w1'))
      const names = ['bg0', 'bg1', 's1', 's2', 's3', 'fg', 'fs', 'mu', 'su', 'ac', 'ac2', 'vio', 'ok', 'wn', 'dg', 'on-accent', 'ac-fg', 'ac2-fg', 'wn-fg', 'ok-fg', 'dg-fg', 'panel-solid', 'field-solid']
      return Object.fromEntries(names.map((name) => [name, cs.getPropertyValue('--' + name).trim()]))
    })()`,
    'tokens'
  )
}

function auditContrast(theme, tokens) {
  const pairs = [
    ['正文 fg / bg0', tokens.fg, tokens.bg0],
    ['次级 fs / bg0', tokens.fs, tokens.bg0],
    ['弱化 mu / bg0', tokens.mu, tokens.bg0],
    ['辅助 su / bg0', tokens.su, tokens.bg0],
    ['强调文字 ac-fg / 面板', tokens['ac-fg'], tokens['panel-solid']],
    ['青色文字 ac2-fg / 面板', tokens['ac2-fg'], tokens['panel-solid']],
    ['琥珀文字 wn-fg / 面板', tokens['wn-fg'], tokens['panel-solid']],
    ['成功文字 ok-fg / 面板', tokens['ok-fg'], tokens['panel-solid']],
    ['危险文字 dg-fg / 面板', tokens['dg-fg'], tokens['panel-solid']],
    ['主按钮文字 / ac', tokens['on-accent'], tokens.ac],
    ['主按钮文字 / ac2', tokens['on-accent'], tokens.ac2],
    ['琥珀按钮文字 / wn', tokens['on-accent'], tokens.wn]
  ]
  const results = pairs.map(([label, fg, bg]) => ({ label, fg, bg, ratio: contrastRatio(fg, bg) }))
  const worst = results.reduce(
    (current, item) =>
      item.ratio != null && (current == null || item.ratio < current.ratio) ? item : current,
    null
  )
  record(
    `${theme}：令牌对比度复算（12 组）`,
    results.every((item) => item.ratio != null && item.ratio >= 4.5),
    `最低 ${worst?.label} ${worst?.ratio}:1`
  )
  return results
}

async function auditAccessibility(theme) {
  const ariaSummary = await pageEval(
    `(() => {
      const elements = [...document.querySelectorAll('button, input, textarea, [role="checkbox"], [role="button"]')]
      return elements.map((element) => ({
        tag: element.tagName.toLowerCase(),
        cls: element.className?.toString().slice(0, 50),
        name: element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent.trim().slice(0, 40) || '',
        pressed: element.getAttribute('aria-pressed'),
        checked: element.getAttribute('aria-checked'),
        disabled: element.hasAttribute('disabled')
      }))
    })()`,
    'aria summary'
  )
  const unnamed = ariaSummary.filter((element) => !element.name)
  record(
    `${theme}：可交互元素均有可访问名称`,
    unnamed.length === 0,
    unnamed.length ? JSON.stringify(unnamed.slice(0, 5)) : `${ariaSummary.length} 个元素`
  )
  const themeButton = ariaSummary.find((element) => element.cls.includes('w1-theme'))
  record(`${theme}：主题按钮暴露 aria-pressed`, Boolean(themeButton?.pressed), themeButton?.pressed)
  const checkboxes = ariaSummary.filter((element) => element.checked !== null)
  record(
    `${theme}：任务复选框暴露 aria-checked`,
    checkboxes.length > 0 &&
      checkboxes.every((element) => element.checked === 'true' || element.checked === 'false'),
    `${checkboxes.length} 个`
  )

  await app.page.call('Page.bringToFront')
  await pageEval(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))`,
    'Ctrl+K'
  )
  await shake(220)
  const palette = await pageEval(
    `(() => {
      const dialog = document.querySelector('[role="dialog"][aria-label="命令面板"]')
      return { open: Boolean(dialog), active: document.activeElement?.className?.toString() ?? '', modal: dialog?.getAttribute('aria-modal') ?? null }
    })()`,
    'palette'
  )
  record(`${theme}：Ctrl+K 打开命令面板`, palette.open, palette.active)
  record(
    `${theme}：命令面板输入聚焦`,
    String(palette.active).includes('w1-paletteinput'),
    palette.active
  )
  record(`${theme}：命令面板 aria-modal`, palette.modal === 'true', palette.modal)

  await pageEval(
    `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`,
    'Escape'
  )
  await shake(520)
  const afterEscape = await pageEval(
    `(() => ({ open: Boolean(document.querySelector('[role="dialog"][aria-label="命令面板"]')), active: document.activeElement?.className?.toString() ?? '' }))()`,
    'palette closed'
  )
  record(`${theme}：Esc 关闭命令面板`, !afterEscape.open, afterEscape.active)

  await app.page.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  })
  await app.page.call('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key: 'Tab',
    code: 'Tab',
    windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9
  })
  await shake(60)
  const focusOutline = await pageEval(
    `(() => {
      const button = document.querySelector('.w1-theme')
      button.focus()
      const cs = getComputedStyle(button)
      return {
        active: document.activeElement?.className?.toString().slice(0, 60) ?? null,
        focusVisible: button.matches(':focus-visible'),
        outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor,
        shadow: cs.boxShadow.slice(0, 80)
      }
    })()`,
    'focus outline'
  )
  record(
    `${theme}：键盘焦点可见`,
    focusOutline.focusVisible && !String(focusOutline.outline).startsWith('none'),
    focusOutline
  )

  await app.page.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }]
  })
  const reducedMotion = await pageEval(
    `(() => {
      const bar = getComputedStyle(document.querySelector('.w1-bar'))
      const transitionProperty = bar.transitionProperty
      return {
        matches: matchMedia('(prefers-reduced-motion: reduce)').matches,
        animationName: bar.animationName,
        transitionDuration: bar.transitionDuration,
        transitionProperty,
        keepsOpacityFeedback: transitionProperty.includes('opacity') && Number.parseFloat(bar.transitionDuration) > 0,
        dropsTransform: !transitionProperty.includes('transform')
      }
    })()`,
    'reduced motion'
  )
  record(
    `${theme}：reduced-motion 生效`,
    reducedMotion.matches &&
      reducedMotion.animationName === 'none' &&
      reducedMotion.keepsOpacityFeedback &&
      reducedMotion.dropsTransform,
    reducedMotion
  )
  await app.page.call('Emulation.setEmulatedMedia', { features: [] })

  await app.page.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-contrast', value: 'more' }]
  })
  await shake(450)
  const contrastMode = await pageEval(
    `(() => {
      const card = getComputedStyle(document.querySelector('.w1-card'))
      const bar = getComputedStyle(document.querySelector('.w1-bar'))
      return {
        matches: matchMedia('(prefers-contrast: more)').matches,
        cardBackdrop: card.backdropFilter,
        cardBackground: card.backgroundColor,
        cardBackgroundImage: card.backgroundImage,
        barBackdrop: bar.backdropFilter,
        barBackground: bar.backgroundColor
      }
    })()`,
    'contrast mode'
  )
  record(
    `${theme}：高对比/无透明降级`,
    contrastMode.matches &&
      contrastMode.cardBackdrop === 'none' &&
      contrastMode.barBackdrop === 'none' &&
      contrastMode.cardBackground !== 'rgba(0, 0, 0, 0)' &&
      contrastMode.barBackground !== 'rgba(0, 0, 0, 0)',
    contrastMode
  )
  await app.page.call('Emulation.setEmulatedMedia', { features: [] })
  await shake(350)
}

async function auditReducedTransparencyAcrossSkins(label) {
  await app.page.call('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-contrast', value: 'more' }]
  })
  await shake(400)
  const probe = async (note) =>
    pageEval(
      `(() => {
        const read = (sel) => {
          const el = document.querySelector(sel)
          if (!el) return null
          const cs = getComputedStyle(el)
          return {
            backdrop: cs.backdropFilter,
            bgColor: cs.backgroundColor,
            bgImage: cs.backgroundImage,
            borderImage: cs.borderImageSource
          }
        }
        return {
          contrast: matchMedia('(prefers-contrast: more)').matches,
          skin: document.documentElement.dataset.skin,
          theme: document.documentElement.dataset.theme,
          bar: read('.w1-bar'),
          nav: read('.w1-nav'),
          status: read('.w1-status'),
          ambient: getComputedStyle(document.querySelector('.w1-ambient')).display
        }
      })()`,
      note
    )

  const states = []
  for (const skin of ['prism', 'classic']) {
    for (const theme of ['dark', 'light']) {
      await pageEval(
        `(() => {
          const root = document.documentElement
          const wantSkin = ${JSON.stringify(skin)}
          const wantTheme = ${JSON.stringify(theme)}
          if (root.dataset.skin !== wantSkin) document.querySelector('.w1-skin').click()
          if (root.dataset.theme !== wantTheme) document.querySelector('.w1-theme').click()
          return { skin: root.dataset.skin, theme: root.dataset.theme }
        })()`,
        `switch ${skin}/${theme}`
      )
      await shake(450)
      const state = await probe(`${label} ${skin}/${theme}`)
      states.push(state)
      const solid = (surf) =>
        Boolean(surf) &&
        surf.backdrop === 'none' &&
        surf.bgImage === 'none' &&
        surf.bgColor !== 'rgba(0, 0, 0, 0)'
      record(
        `${label} ${skin}/${theme}：外壳降级为实色`,
        state.contrast && solid(state.bar) && solid(state.nav) && solid(state.status),
        {
          bar: state.bar,
          nav: state.nav,
          status: state.status
        }
      )
      record(
        `${label} ${skin}/${theme}：皮肤与主题正确切换`,
        state.skin === skin && state.theme === theme,
        `${state.skin}/${state.theme}`
      )
    }
  }

  await app.page.call('Emulation.setEmulatedMedia', { features: [] })
  await shake(350)
  // 让调用方回到 dark + prism，避免影响后续阶段的断言基线。
  await pageEval(
    `(() => {
      const root = document.documentElement
      if (root.dataset.theme !== 'dark') document.querySelector('.w1-theme').click()
      if (root.dataset.skin !== 'prism') document.querySelector('.w1-skin').click()
      return { theme: root.dataset.theme, skin: root.dataset.skin }
    })()`,
    `${label} restore baseline`
  )
  await shake(400)
  return states
}

async function measurePerformance() {
  const frameStats = await pageEval(
    `(async () => {
      const deltas = []
      let last = performance.now()
      await new Promise((done) => {
        let frames = 0
        const tick = (now) => {
          deltas.push(now - last)
          last = now
          frames += 1
          if (frames < 90) requestAnimationFrame(tick)
          else done()
        }
        requestAnimationFrame(tick)
      })
      const sorted = [...deltas].sort((a, b) => a - b)
      const average = deltas.reduce((sum, value) => sum + value, 0) / deltas.length
      return {
        frames: deltas.length,
        average: +average.toFixed(2),
        p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2),
        max: +Math.max(...deltas).toFixed(2),
        fps: +(1000 / average).toFixed(1)
      }
    })()`,
    'frame stats'
  )
  record(
    '动效帧率 ≥ 55 FPS',
    frameStats.fps >= 55,
    `${frameStats.fps} FPS · avg ${frameStats.average}ms · p95 ${frameStats.p95}ms · max ${frameStats.max}ms`
  )

  const beforeMetrics = await app.page.call('Performance.getMetrics')
  await pageEval(
    `(() => { const btn = document.querySelector('.w1-theme'); btn.click(); return true })()`,
    'toggle for metrics'
  )
  await shake(250)
  const afterMetrics = await app.page.call('Performance.getMetrics')
  const before = Object.fromEntries(
    (beforeMetrics.metrics || []).map((metric) => [metric.name, metric.value])
  )
  const after = Object.fromEntries(
    (afterMetrics.metrics || []).map((metric) => [metric.name, metric.value])
  )
  const delta = {
    layouts: after.LayoutCount - before.LayoutCount,
    styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    jsHeapUsed: after.JSHeapUsedSize,
    nodes: after.Nodes
  }
  record(
    '主题切换布局次数可控',
    delta.layouts <= 20,
    `layout +${delta.layouts} · style +${delta.styleRecalcs}`
  )
  return { frameStats, delta }
}

async function themeReloadInstrumentation() {
  const source = `(() => {
    window.__themeTiming = []
    const log = (name, extra = {}) => {
      try {
        window.__themeTiming.push({
          name,
          t: +performance.now().toFixed(2),
          theme: document.documentElement ? (document.documentElement.dataset.theme || null) : null,
          skin: document.documentElement ? (document.documentElement.dataset.skin || null) : null,
          readyState: document.readyState,
          ...extra
        })
      } catch {}
    }
    log('document-start')
    const attach = () => {
      if (!document.documentElement) return setTimeout(attach, 0)
      new MutationObserver(() => log('theme-attr')).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    }
    attach()
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) log('paint:' + entry.name, { startTime: +entry.startTime.toFixed(2) })
    }).observe({ type: 'paint', buffered: true })
    requestAnimationFrame(() => log('raf-first'))
    addEventListener('DOMContentLoaded', () => log('dom-content-loaded'))
    addEventListener('load', () => log('load'))
  })()`
  await app.page.call('Page.addScriptToEvaluateOnNewDocument', { source })
  await app.page.call('Page.reload', { ignoreCache: true })
  await waitFor(
    async () => (await pageEval('document.readyState', 'reload readyState')) === 'complete',
    {
      timeout: 30000,
      label: 'reload complete'
    }
  )
  await waitFor(
    async () => pageEval(`Boolean(document.querySelector('.w1.is-booted'))`, 'reload booted'),
    {
      timeout: 10000,
      label: 'reload shell booted'
    }
  )
  await shake(400)
  const timing = await pageEval('window.__themeTiming', 'theme timing')
  const themeSet = timing.find((entry) => entry.name === 'theme-attr')
  const firstPaint = timing.find((entry) => entry.name === 'paint:first-paint')
  const firstRaf = timing.find((entry) => entry.name === 'raf-first')
  record(
    '重载后主题在首个 rAF 前应用',
    Boolean(firstRaf) && firstRaf.theme === 'light',
    JSON.stringify({ firstRaf, themeSet, firstPaint })
  )
  record(
    '重载后皮肤在首个 rAF 前应用',
    Boolean(firstRaf) && firstRaf.skin === 'prism',
    firstRaf?.skin
  )
  return { timing, firstPaint, themeSet, firstRaf }
}

async function bundleSizes() {
  const assets = await readdir('out/renderer/assets')
  const files = [
    'out/main/index.js',
    'out/preload/index.js',
    ...assets
      .filter((name) => name.endsWith('.css') || name.endsWith('.js'))
      .sort()
      .map((name) => `out/renderer/assets/${name}`)
  ]
  const sizes = []
  for (const file of files) {
    try {
      const content = await readFile(file)
      sizes.push({ file, bytes: content.length, gzip: gzipSync(content).length })
    } catch (error) {
      sizes.push({ file, error: error.message })
    }
  }
  const totalGzipKb = +(sizes.reduce((sum, item) => sum + (item.gzip ?? 0), 0) / 1024).toFixed(1)
  return { files: sizes, totalGzipKb }
}

async function main() {
  console.log(`\n=== ${new Date().toISOString()} runtime verification ===`)

  // Phase 1: initial persisted state, UI toggle, IPC contract, persistence + reload instrumentation
  const p1 = await launch('phase-1')
  const p1Startup = await pageEval(startupExpr, 'startup')
  const p1Initial = await pageEval(stateExpr, 'initial')
  phases.push({
    phase: 'phase-1',
    targetMs: p1.pageTargetMs,
    readyMs: p1.readyMs,
    bootedMs: p1.bootedMs,
    startup: p1Startup,
    initial: p1Initial
  })
  record('启动后 shell 完成挂载', p1Initial.booted === true, `${p1.bootedMs}ms`)
  record(
    '启动时主题与持久化一致',
    p1Initial.theme === (p1Initial.stored ?? 'dark'),
    `${p1Initial.theme} / ${p1Initial.stored ?? '(未写入，默认 dark)'}`
  )
  record(
    '启动后不残留 boot 遮罩',
    !(await pageEval(`Boolean(document.querySelector('.w1-boot'))`, 'boot overlay')),
    ''
  )

  const winInitial = await assertWindow(p1Initial.theme, '启动时')
  if (winInitial) {
    phases[0].windowInitial = winInitial
    record(
      '窗口最小尺寸 1180×720',
      Number(winInitial.minimumSize?.[0]) === 1180 && Number(winInitial.minimumSize?.[1]) === 720,
      winInitial.minimumSize
    )
  }

  const navigation = await auditNavigation('启动')
  phases[0].navigation = navigation
  await createRuntimeTask()
  await verifyLearningReview()

  const security = await pageEval(
    `(() => ({
      require: typeof window.require,
      process: typeof window.process,
      module: typeof window.module,
      wsKeys: Object.keys(window.ws || {}),
      appKeys: Object.keys(window.ws?.app || {}),
      dbAccess: Boolean(window.ws?.db),
      invoke: typeof window.ws?.app?.setTheme
    }))()`,
    'security'
  )
  record('渲染进程无 Node require', security.require === 'undefined', security.require)
  record('渲染进程无 process', security.process === 'undefined', security.process)
  record(
    'preload 桥仅暴露窄接口（tasks/notes/capture/learning/habits/agent/mcp/capability/provider/audit/app.setTheme+backupNow+info）',
    security.invoke === 'function' &&
      !security.dbAccess &&
      [...security.wsKeys].sort().join() ===
        'agent,app,audit,capability,capture,habits,learning,mcp,notes,provider,tasks' &&
      security.appKeys.join() === 'setTheme,backupNow,info',
    security
  )
  phases[0].security = security

  if (p1Initial.theme !== 'dark') {
    const toDark = await pageEval(clickThemeExpr, 'toggle dark')
    record(
      'UI 从当前主题切到夜间',
      toDark.after.theme === 'dark' && toDark.after.stored === 'dark',
      toDark
    )
    await assertWindow('dark', '切到夜间后')
  }
  await assertState('dark', '夜间基线')
  await assertWindow('dark', '夜间基线')

  const toLight = await pageEval(clickThemeExpr, 'toggle light')
  record('主题按钮切换耗时 ≤ 2 帧', toLight.elapsed <= 40, `${toLight.elapsed}ms`)
  record(
    '切换后按钮 aria 与文案更新',
    toLight.after.theme === 'light' &&
      toLight.after.pressed === 'true' &&
      toLight.after.label === '白天',
    toLight.after
  )
  record(
    '切换夜间→白天有 toast',
    String(toLight.toast || '').includes('已切换到白天模式'),
    toLight.toast
  )
  await assertState('light', '白天基线', { toast: '已切换到白天模式' })
  await assertWindow('light', '切到白天后')
  await assertOverlayCall('light', '切到白天后')

  const ipcLight = await pageEval(
    `(async () => { const t0 = performance.now(); const value = await window.ws.app.setTheme('light'); return { ms: +(performance.now() - t0).toFixed(2), value: value ?? null } })()`,
    'ipc light'
  )
  record('IPC app:set-theme 接受 light', typeof ipcLight.ms === 'number', `${ipcLight.ms}ms`)
  const ipcDark = await pageEval(
    `(async () => { const t0 = performance.now(); const value = await window.ws.app.setTheme('dark'); return { ms: +(performance.now() - t0).toFixed(2), value: value ?? null } })()`,
    'ipc dark'
  )
  await assertWindow('dark', 'IPC 同步到夜间')
  await assertOverlayCall('dark', 'IPC 同步到夜间')
  const invalid = await pageEval(
    `(async () => { try { await window.ws.app.setTheme('sepia'); return { rejected: false } } catch (error) { return { rejected: true, message: String(error && error.message ? error.message : error) } } })()`,
    'ipc invalid'
  )
  record(
    'IPC 拒绝非法主题',
    invalid.rejected === true && invalid.message.includes('主题无效'),
    invalid
  )
  await assertWindow('dark', '非法主题后窗口未改变')
  const restoreIpc = await pageEval(
    `(async () => { const t0 = performance.now(); await window.ws.app.setTheme('light'); return +(performance.now() - t0).toFixed(2) })()`,
    'ipc restore light'
  )
  record('IPC 恢复窗口为白天', typeof restoreIpc === 'number', `${restoreIpc}ms`)
  phases[0].ipc = { ipcLight, ipcDark, invalid, restoreIpc }

  // ---------- skin dimension ----------
  const skinBaseline = await pageEval(stateExpr, 'skin baseline')
  record(
    '皮肤基线为棱镜',
    skinBaseline.skin === 'prism' &&
      (skinBaseline.storedSkin === 'prism' || skinBaseline.storedSkin === null),
    `${skinBaseline.skin} / ${skinBaseline.storedSkin}`
  )
  const skinButton = await pageEval(
    `(() => { const b = document.querySelector('.w1-skin'); return b ? { label: b.textContent.trim(), pressed: b.getAttribute('aria-pressed'), aria: b.getAttribute('aria-label') } : null })()`,
    'skin button'
  )
  record(
    '皮肤按钮存在且默认未按下',
    Boolean(skinButton) && skinButton.pressed === 'false' && skinButton.label === '棱镜',
    skinButton
  )
  record(
    '皮肤按钮暴露 aria-label',
    String(skinButton?.aria || '').includes('棱镜皮肤'),
    skinButton?.aria
  )

  const toClassic = await pageEval(
    `(async () => {
      const btn = document.querySelector('.w1-skin')
      const before = document.documentElement.dataset.skin
      btn.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const w1 = document.querySelector('.w1')
      const card = document.querySelector('.w1-card')
      return {
        before,
        after: document.documentElement.dataset.skin,
        stored: localStorage.getItem('workstation.skin'),
        pressed: btn.getAttribute('aria-pressed'),
        label: btn.textContent.trim(),
        toast: document.querySelector('.w1-toast')?.textContent?.trim() ?? null,
        ambient: getComputedStyle(document.querySelector('.w1-ambient')).display,
        cardBorderImage: getComputedStyle(card).borderImageSource,
        cardBg: getComputedStyle(card).backgroundImage.slice(0, 40),
        bg0: getComputedStyle(w1).getPropertyValue('--bg0').trim()
      }
    })()`,
    'toggle classic'
  )
  record(
    '切换到经典皮肤：data-skin',
    toClassic.before === 'prism' && toClassic.after === 'classic',
    `${toClassic.before} → ${toClassic.after}`
  )
  record('切换到经典皮肤：localStorage', toClassic.stored === 'classic', toClassic.stored)
  record(
    '切换到经典皮肤：aria-pressed 与文案',
    toClassic.pressed === 'true' && toClassic.label === '经典',
    `${toClassic.pressed} / ${toClassic.label}`
  )
  record(
    '切换到经典皮肤：toast 提示',
    String(toClassic.toast || '').includes('已切换到经典皮肤'),
    toClassic.toast
  )
  record('经典皮肤隐藏棱镜光场层', toClassic.ambient === 'none', toClassic.ambient)
  record('经典皮肤移除棱镜描边', toClassic.cardBorderImage === 'none', toClassic.cardBorderImage)
  record(
    '经典皮肤改用叠层背景',
    /^(linear|radial)-gradient/.test(toClassic.cardBg),
    toClassic.cardBg
  )
  record('皮肤不改变窗口背景令牌', toClassic.bg0 === '#eef2fb', toClassic.bg0)

  const skinA11y = await pageEval(
    `(() => {
      const named = [...document.querySelectorAll('button, input, [role="checkbox"]')].filter((el) => {
        const label = el.getAttribute('aria-label') || el.textContent.trim() || el.getAttribute('title')
        return !label
      })
      return { unnamed: named.length, skinBtn: document.querySelectorAll('.w1-skin').length }
    })()`,
    'skin a11y'
  )
  record('经典皮肤下所有控件仍有可访问名称', skinA11y.unnamed === 0, skinA11y.unnamed)
  record('状态栏只有一个皮肤按钮', skinA11y.skinBtn === 1, skinA11y.skinBtn)

  const backToPrism = await pageEval(
    `(async () => {
      const btn = document.querySelector('.w1-skin')
      btn.click()
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return {
        skin: document.documentElement.dataset.skin,
        stored: localStorage.getItem('workstation.skin'),
        pressed: btn.getAttribute('aria-pressed'),
        label: btn.textContent.trim(),
        toast: document.querySelector('.w1-toast')?.textContent?.trim() ?? null
      }
    })()`,
    'toggle prism'
  )
  record(
    '切回棱镜皮肤',
    backToPrism.skin === 'prism' &&
      backToPrism.stored === 'prism' &&
      backToPrism.pressed === 'false' &&
      backToPrism.label === '棱镜',
    backToPrism
  )
  record(
    '切回棱镜有 toast',
    String(backToPrism.toast || '').includes('已切换到棱镜皮肤'),
    backToPrism.toast
  )
  phases[0].skin = { skinBaseline, skinButton, toClassic, skinA11y, backToPrism }

  // Direct IPC only changes the native window; the React UI state stays light.
  const persistedUi = await pageEval(stateExpr, 'ui after direct ipc')
  record(
    '直接 IPC 不改变 UI 主题状态',
    persistedUi.theme === 'light' && persistedUi.stored === 'light',
    `${persistedUi.theme} / ${persistedUi.stored}`
  )
  await assertWindow('light', '持久化前')
  await assertOverlayCall('light', 'IPC 恢复白天')

  const reload = await themeReloadInstrumentation()
  phases[0].reload = reload
  const reloadState = await assertState('light', '重载后')
  phases[0].reloadState = reloadState
  await assertWindow('light', '重载后')
  await assertOverlayCall('light', '重载后')

  // Skin persists across reload, and the pre-paint script applies it before stylesheets.
  const classicBeforeReload = await pageEval(
    `(() => { document.querySelector('.w1-skin').click(); return document.documentElement.dataset.skin })()`,
    'set classic before reload'
  )
  record('重载前切到经典皮肤', classicBeforeReload === 'classic', classicBeforeReload)
  await sleep(400)
  await app.page.call('Page.reload', { ignoreCache: true })
  await waitFor(
    async () => (await pageEval('document.readyState', 'skin reload readyState')) === 'complete',
    {
      timeout: 30000,
      label: 'skin reload complete'
    }
  )
  await waitFor(
    async () => pageEval(`Boolean(document.querySelector('.w1-skin'))`, 'skin reload mounted'),
    {
      timeout: 10000,
      label: 'skin reload mounted'
    }
  )
  await shake(400)
  const skinReload = await pageEval(
    `(() => {
      const btn = document.querySelector('.w1-skin')
      return {
        skin: document.documentElement.dataset.skin,
        stored: localStorage.getItem('workstation.skin'),
        theme: document.documentElement.dataset.theme,
        pressed: btn?.getAttribute('aria-pressed') ?? null,
        label: btn?.textContent?.trim() ?? null,
        ambient: getComputedStyle(document.querySelector('.w1-ambient')).display
      }
    })()`,
    'skin after reload'
  )
  record(
    '重载后保留经典皮肤',
    skinReload.skin === 'classic' && skinReload.stored === 'classic',
    `${skinReload.skin} / ${skinReload.stored}`
  )
  record(
    '重载后皮肤按钮同步',
    skinReload.pressed === 'true' && skinReload.label === '经典',
    `${skinReload.pressed} / ${skinReload.label}`
  )
  record('重载后经典皮肤仍隐藏棱镜光场', skinReload.ambient === 'none', skinReload.ambient)
  record('皮肤与主题互不影响', skinReload.theme === 'light', skinReload.theme)
  phases[0].skinReload = skinReload
  await pageEval(
    `(() => { document.querySelector('.w1-skin').click(); return true })()`,
    'restore prism before metrics'
  )
  await sleep(300)

  const themeToggleMetrics = await measurePerformance()
  const restoredAfterMetrics = await pageEval(clickThemeExpr, 'restore light after metrics')
  record(
    '性能测量后恢复白天',
    restoredAfterMetrics.after.theme === 'light' && restoredAfterMetrics.after.stored === 'light',
    restoredAfterMetrics.after
  )
  await assertWindow('light', '性能测量后')
  await assertOverlayCall('light', '性能测量后')
  const viewPerformance = await measureViewPerformance()
  phases[0].performance = themeToggleMetrics
  phases[0].viewPerformance = viewPerformance
  const tokensLight = await tokenSnapshot()
  const contrastLight = auditContrast('light', tokensLight)
  phases[0].tokens = { light: tokensLight }
  phases[0].contrast = { light: contrastLight }
  await auditAccessibility('light')
  const paletteNavigation = await auditPaletteNavigation('白天')
  phases[0].paletteNavigation = paletteNavigation

  // 习惯打卡：确保最终处于「已打卡」，重启后才能证明记录真的留在库里
  const habitToggle = await pageEval(
    `(async () => {
      const nav = [...document.querySelectorAll('.w1-navitem')].find(
        (node) => node.textContent.includes('今日')
      )
      nav?.click()
      await new Promise((done) => setTimeout(done, 500))
      const key = new Date().toLocaleDateString('sv-SE')
      const before = await window.ws.habits.list()
      const target = before[0]
      if (!target) return { error: '没有习惯' }
      const wasChecked = target.checkins.includes(key)
      // 种子数据可能今天已打卡：点一次会变成取消，所以确保最终是「已打卡」
      const clicks = wasChecked ? 2 : 1
      for (let index = 0; index < clicks; index += 1) {
        const dot = [...document.querySelectorAll('.w1-hrow')]
          .find((node) => node.textContent.includes(target.name))
          ?.querySelector('.w1-hdot.today')
        dot?.click()
        await new Promise((done) => setTimeout(done, 350))
      }
      const after = await window.ws.habits.list()
      const fresh = after.find((habit) => habit.id === target.id)
      const dotNow = [...document.querySelectorAll('.w1-hrow')]
        .find((node) => node.textContent.includes(target.name))
        ?.querySelector('.w1-hdot.today')
      return {
        habitId: target.id,
        name: target.name,
        day: key,
        wasChecked,
        clicks,
        stored: Boolean(fresh?.checkins.includes(key)),
        rendered: dotNow?.classList.contains('on') === true
      }
    })()`,
    'habit toggle'
  )
  runtimeHabit = habitToggle && !habitToggle.error ? habitToggle : null
  record('运行时：习惯打卡写入数据库', habitToggle?.stored === true, habitToggle)
  record('运行时：习惯打卡即时反映到界面', habitToggle?.rendered === true, habitToggle)

  const metrics = await pageEval(metricsExpr, 'renderer metrics')
  phases[0].rendererMetrics = metrics
  phases[0].consoleErrors = [...consoleErrors]
  phases[0].exceptions = [...exceptions]
  await quitApp()
  record('阶段 1 应用可正常退出', app.exited() !== null, `exit ${app.exited()}`)

  // Phase 2: persistence light -> dark
  await launch('phase-2')
  await shake(300)
  const p2 = await pageEval(stateExpr, 'phase2 initial')
  const p2Startup = await pageEval(startupExpr, 'phase2 startup')
  phases.push({
    phase: 'phase-2',
    targetMs: app.pageTargetMs,
    readyMs: app.readyMs,
    bootedMs: app.bootedMs,
    startup: p2Startup,
    initial: p2
  })
  record(
    '重启后保留白天模式',
    p2.theme === 'light' && p2.stored === 'light',
    `${p2.theme} / ${p2.stored}`
  )
  await assertState('light', '重启后白天')
  await assertWindow('light', '重启后白天')
  const p2Navigation = await auditNavigation('重启后')
  phases[1].navigation = p2Navigation
  await verifyHabitAfterRestart()
  await verifyAndRemoveRuntimeTask()
  const p2BackDark = await pageEval(clickThemeExpr, 'phase2 toggle dark')
  record(
    '重启后切回夜间',
    p2BackDark.after.theme === 'dark' && p2BackDark.after.stored === 'dark',
    p2BackDark.after
  )
  await assertState('dark', '切回夜间后', { toast: '已切换到夜间模式' })
  await assertWindow('dark', '切回夜间后')
  await assertOverlayCall('dark', '切回夜间后')
  const darkTokens = await tokenSnapshot()
  const contrastDark = auditContrast('dark', darkTokens)
  phases[1].tokens = { dark: darkTokens }
  phases[1].contrast = { dark: contrastDark }
  await auditAccessibility('dark')
  const reducedAcrossSkins = await auditReducedTransparencyAcrossSkins('降级跨皮肤')
  phases[1].reducedAcrossSkins = reducedAcrossSkins
  const darkMetrics = await pageEval(metricsExpr, 'dark metrics')
  phases[1].rendererMetrics = darkMetrics
  phases[1].consoleErrors = [...consoleErrors]
  phases[1].exceptions = [...exceptions]
  await quitApp()
  record('阶段 2 应用可正常退出', app.exited() !== null, `exit ${app.exited()}`)

  // Phase 3: persistence dark after restart, leave default state
  await launch('phase-3')
  await shake(300)
  const p3 = await pageEval(stateExpr, 'phase3 initial')
  const p3Startup = await pageEval(startupExpr, 'phase3 startup')
  phases.push({
    phase: 'phase-3',
    targetMs: app.pageTargetMs,
    readyMs: app.readyMs,
    bootedMs: app.bootedMs,
    startup: p3Startup,
    initial: p3
  })
  record(
    '再次重启后保留夜间模式',
    p3.theme === 'dark' && p3.stored === 'dark',
    `${p3.theme} / ${p3.stored}`
  )
  if (runtimeTask) {
    const cleanup = await pageEval(
      `(async () => {
        await window.ws.tasks.remove(${JSON.stringify(runtimeTask.id)})
        const tasks = await window.ws.tasks.list()
        return tasks.some((item) => item.id === ${JSON.stringify(runtimeTask.id)})
      })()`,
      'runtime task cleanup'
    )
    record('运行时：验证任务已清理', cleanup === false, cleanup)
    runtimeTask = null
  }
  await assertState('dark', '最终夜间')
  await assertWindow('dark', '最终夜间')
  const p3Nav = await pageEval(navStateExpr, 'phase3 nav')
  phases[2].navigation = p3Nav
  record(
    '重启后视图回到今日',
    p3Nav.active === '今日' &&
      p3Nav.hasMain &&
      !p3Nav.hasTasks &&
      !p3Nav.hasAgent &&
      !p3Nav.hasNotes &&
      !p3Nav.hasLearning,
    p3Nav.active
  )
  const finalMetrics = await pageEval(metricsExpr, 'final metrics')
  phases[2].rendererMetrics = finalMetrics
  phases[2].consoleErrors = [...consoleErrors]
  phases[2].exceptions = [...exceptions]
  const winFinal = await mainEval(windowStateExpr, 'final window')
  if (!winFinal?.error) phases[2].window = winFinal
  await quitApp()
  record('阶段 3 应用可正常退出', app.exited() !== null, `exit ${app.exited()}`)

  report.bundles = await bundleSizes()
  const expectedConsoleErrors = consoleErrors.filter(
    (text) => text.includes('app:set-theme') && text.includes('主题无效')
  )
  const unexpectedConsoleErrors = consoleErrors.filter(
    (text) => !expectedConsoleErrors.includes(text)
  )
  report.summary = {
    checks: checks.length,
    passed: checks.filter((check) => check.ok).length,
    failed: checks.filter((check) => !check.ok).length,
    unexpectedConsoleErrors: unexpectedConsoleErrors.length,
    expectedConsoleErrors: expectedConsoleErrors.length,
    exceptions: exceptions.length,
    bundleGzipKb: report.bundles.totalGzipKb
  }
  await writeFile('.screenshots/runtime-report.json', JSON.stringify(report, null, 2))
  console.log(
    `\n=== ${report.summary.passed}/${report.summary.checks} passed · unexpected console errors ${report.summary.unexpectedConsoleErrors} · expected ${report.summary.expectedConsoleErrors} · exceptions ${report.summary.exceptions} ===`
  )
  if (report.summary.failed > 0) process.exitCode = 1
}

main().catch(async (error) => {
  console.error('\nRUNTIME VERIFY FAILED')
  console.error(error)
  report.failure = error.stack || String(error)
  try {
    if (app) {
      app.page.close()
      app.main.close()
      if (app.exited() === null) app.child.kill()
    }
  } catch {}
  try {
    await writeFile('.screenshots/runtime-report.json', JSON.stringify(report, null, 2))
  } catch {}
  process.exitCode = 1
})
