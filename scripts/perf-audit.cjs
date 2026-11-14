// 可复用性能审计（npm run perf）：真实主进程 + 临时库灌数据，零额度、不调真实模型。
// 测长列表滚动帧间隔/p95、视图切换与勾选延迟、长任务、auto-animate 增删开销。
const { app } = require('electron')
const { join } = require('node:path')
const { mkdirSync, mkdtempSync } = require('node:fs')
const { tmpdir } = require('node:os')

const root = mkdtempSync(join(tmpdir(), 'ws-perf-'))
const dataDir = join(root, 'data')
const userDir = join(root, 'user')
mkdirSync(dataDir, { recursive: true })
mkdirSync(userDir, { recursive: true })
process.env.WS_DATA_DIR = dataDir
process.env.WS_DISABLE_CAPTURE_SHORTCUT = '1'
process.env.WS_REMINDER_TICK_MS = '3600000'
process.env.WS_ATTENTION_LOG = '1'
app.setPath('userData', userDir)

let win = null
app.on('browser-window-created', (_e, created) => {
  if (!win) win = created
})
require('../out/main/index.js')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitForWindow(timeout = 25000) {
  const started = Date.now()
  while (!win && Date.now() - started < timeout) await sleep(100)
  if (!win) throw new Error('主窗口未创建')
  return win
}

async function run() {
  await waitForWindow()
  if (win.webContents.isLoading())
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  win.setSkipTaskbar(true)
  win.setOpacity(0)
  win.showInactive()
  await sleep(2000)

  const result = await win.webContents.executeJavaScript(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
    const one = (s) => document.querySelector(s)
    const all = (s) => [...document.querySelectorAll(s)]
    const ws = window.ws
    const out = { seed: {}, scroll: {}, interaction: {}, longtasks: {}, autoAnimate: {} }

    let ltCount = 0, ltMax = 0, ltTotal = 0
    try {
      const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) { ltCount++; ltMax = Math.max(ltMax, e.duration); ltTotal += e.duration }
      })
      obs.observe({ entryTypes: ['longtask'] })
    } catch {}

    const measureFrames = async (action, ms = 1100) => {
      const deltas = []; let last = performance.now(); let raf
      const loop = (t) => { deltas.push(t - last); last = t; raf = requestAnimationFrame(loop) }
      raf = requestAnimationFrame(loop)
      await action()
      await sleep(ms)
      cancelAnimationFrame(raf)
      deltas.shift()
      if (!deltas.length) return { avg: 0, p95: 0, max: 0, jank: 0, frames: 0 }
      const sorted = [...deltas].sort((a, b) => a - b)
      return {
        avg: +(deltas.reduce((a, b) => a + b, 0) / deltas.length).toFixed(1),
        p95: +(sorted[Math.floor(sorted.length * 0.95)] || 0).toFixed(1),
        max: +Math.max(...deltas).toFixed(1),
        jank: deltas.filter((d) => d > 33).length,
        frames: deltas.length
      }
    }
    const waitFor = async (fn, timeout = 3000) => {
      const started = Date.now()
      while (Date.now() - started < timeout) { try { if (await fn()) return true } catch {} await sleep(50) }
      return false
    }
    const navTo = async (label) => {
      const item = all('.w1-navitem').find((el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === label)
      item?.click(); await sleep(700)
    }
    const scrollContainer = () => {
      const cands = all('div').filter((el) => el.scrollHeight > el.clientHeight + 50 && el.clientHeight > 200)
      return cands.sort((a, b) => b.scrollHeight - a.scrollHeight)[0] || null
    }
    const scrollTest = async (el) => {
      if (!el) return null
      el.scrollTop = 0; await sleep(150)
      return measureFrames(async () => {
        const step = Math.max(120, el.scrollHeight / 40)
        for (let y = 0; y <= el.scrollHeight; y += step) { el.scrollTop = y; await sleep(16) }
      }, 400)
    }

    const t0 = performance.now()
    for (let i = 0; i < 800; i++) await ws.notes.create('性能测试笔记 ' + i + '：这是一段用于滚动测试的正文内容，包含一些文字以撑开行高。', 'perf')
    out.seed.notes = 800
    let tasks = 0
    for (let i = 0; i < 500; i++) { try { await ws.tasks.create({ title: '性能任务 ' + i }); tasks++ } catch { break } }
    out.seed.tasks = tasks
    await ws.agent.createSession({ id: 's-perf', agent: 'claude', title: '性能会话' })
    for (let i = 0; i < 150; i++) {
      await ws.agent.saveMessage({ id: 'm-perf-' + i, sessionId: 's-perf', role: i % 2 ? 'assistant' : 'user', text: '性能消息 ' + i + '：' + '内容'.repeat(20), timeLabel: '刚刚', createdAt: Date.now() + i, origin: 'app' })
    }
    out.seed.messages = 150
    out.seedMs = Math.round(performance.now() - t0)

    await navTo('笔记'); await sleep(500)
    out.scroll.notes = await scrollTest(scrollContainer())
    await navTo('任务'); await sleep(500)
    out.scroll.tasks = await scrollTest(scrollContainer())
    await navTo('Agent'); await sleep(700)
    out.scroll.agent = await scrollTest(scrollContainer())

    const switchLatency = async (label) => {
      const item = all('.w1-navitem').find((el) => el.querySelector('.w1-navtext b')?.textContent?.trim() === label)
      const start = performance.now()
      item?.click()
      await waitFor(() => one('.w1-navitem.on .w1-navtext b')?.textContent?.trim() === label, 2000)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      return Math.round(performance.now() - start)
    }
    out.interaction.viewSwitch = {
      today: await switchLatency('今日'),
      tasks: await switchLatency('任务'),
      notes: await switchLatency('笔记'),
      learning: await switchLatency('学习')
    }

    await navTo('任务'); await sleep(500)
    const checkbox = one('.w1-todocb:not([disabled])')
    if (checkbox) {
      const start = performance.now()
      checkbox.click()
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
      out.interaction.taskToggleMs = Math.round(performance.now() - start)
    }

    await navTo('任务'); await sleep(400)
    const ids = []
    out.autoAnimate.addRemove = await measureFrames(async () => {
      for (let i = 0; i < 25; i++) {
        try { const t = await ws.tasks.create({ title: '动效压测 ' + i }); if (t && t.id) ids.push(t.id) } catch {}
        await sleep(20)
      }
      for (const id of ids) { try { await ws.tasks.remove(id) } catch {} await sleep(15) }
    }, 300)

    out.longtasks = { count: ltCount, maxMs: Math.round(ltMax), totalMs: Math.round(ltTotal) }
    return out
  })()`)

  console.log(`PERF_RESULT ${JSON.stringify(result, null, 2)}`)
  app.quit()
}
run().catch((e) => {
  console.log(`PERF_FATAL ${String(e?.stack || e)}`)
  app.quit()
})
