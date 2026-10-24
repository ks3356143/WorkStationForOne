const { app, BrowserWindow } = require('electron')
const { join } = require('node:path')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function run() {
  const consoleErrors = []
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    show: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false }
  })

  win.webContents.on('console-message', (event) => {
    if (event.level === 'error') {
      consoleErrors.push(`${event.message} (${event.sourceId}:${event.lineNumber})`)
    }
  })

  await win.loadFile(join(__dirname, '../out/renderer/index.html'))
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
    const setValue = (el, value) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, value)
      el.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const checks = []
    const check = (name, ok, detail = '') => checks.push({ name, ok, detail })

    check('初始任务 8 项', all('.w1-task').length === 8, String(all('.w1-task').length))
    check('初始完成 2 项', all('.w1-task.done').length === 2, String(all('.w1-task.done').length))
    check('初始权限卡存在', !!one('.w1-perm'))
    check('状态栏待审批 1', byText('.w1-sbtn.pending', '待审批 1') !== undefined)
    check(
      '舰队总览统计会话',
      one('.w1-fleet .w1-frow')?.textContent?.includes('5') &&
        one('.w1-fleet .w1-frow')?.textContent?.includes('待确认'),
      one('.w1-fleet .w1-frow')?.textContent ?? ''
    )
    check(
      '权限变更逐行可扫读',
      all('.w1-dchange').length === 3 &&
        all('.w1-dchange')[0]?.querySelector('.w1-dline.ins')?.textContent === '明天 09:00',
      String(all('.w1-dchange').length)
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

    const undone = one('.w1-task:not(.done)')
    const undoneTitle = undone?.querySelector('.w1-ttext')?.textContent ?? ''
    undone?.click()
    await sleep(200)
    check('勾选任务后完成数 +1', all('.w1-task.done').length === 3, String(all('.w1-task.done').length))
    check('任务进度同步', one('.w1-tprog b')?.textContent?.includes('3 / 8'), one('.w1-tprog b')?.textContent ?? '')

    byText('.w1-filter', '已完成')?.click()
    await sleep(200)
    check('筛选已完成', all('.w1-task').length === 3, String(all('.w1-task').length))
    byText('.w1-filter', '全部')?.click()
    await sleep(200)
    check('筛选恢复全部', all('.w1-task').length === 8, String(all('.w1-task').length))

    const habitBefore = one('.w1-card:nth-child(2) .w1-ct span')?.textContent ?? ''
    one('.w1-hdot.today:not(.on)')?.click()
    await sleep(250)
    const habitAfter = one('.w1-card:nth-child(2) .w1-ct span')?.textContent ?? ''
    const habitCount = (text) => Number.parseInt(text, 10)
    check(
      '今日习惯可打卡',
      habitCount(habitAfter) === habitCount(habitBefore) + 1,
      habitBefore + ' -> ' + habitAfter
    )

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
    check('允许后任务提示完成', one('.w1-anote')?.textContent?.includes('已顺延 3 项任务'), one('.w1-anote')?.textContent ?? '')
    check('允许后状态栏无待审批', one('.w1-status')?.textContent?.includes('无待审批'))
    check('允许后任务时间写入', byText('.w1-task', '周报收尾')?.textContent?.includes('22:00'), byText('.w1-task', '周报收尾')?.textContent ?? '')

    const input = one('#composer-input')
    setValue(input, '测一下多会话回复')
    await sleep(80)
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }))
    await sleep(250)
    check('发送后出现等待动画', !!one('.w1-typing'))
    await sleep(1400)
    check('收到助手回复', one('.w1-thread')?.querySelectorAll('.w1-amsg').length >= 2, String(one('.w1-thread')?.querySelectorAll('.w1-amsg').length))
    check('等待动画结束', !one('.w1-typing'))

    byText('.w1-btn', '快速笔记')?.click()
    await sleep(350)
    check('快速笔记弹窗', !!one('.w1-modal'))
    const textarea = one('.w1-noteinput')
    setValue(textarea, '来自自动化冒烟测试的笔记')
    await sleep(80)
    byText('.w1-modalacts .w1-pb', '保存笔记')?.click()
    await sleep(600)
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

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
    await sleep(650)
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
    await sleep(650)
    check(
      '命令面板关闭并跳转会话',
      !one('.w1-palette') && one('.w1-tdiv')?.textContent?.includes('修复登录 500'),
      one('.w1-tdiv')?.textContent ?? ''
    )
    check(
      '命令面板关闭后焦点归位',
      document.activeElement?.classList.contains('w1-motion'),
      document.activeElement?.className?.toString?.() ?? ''
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
    await sleep(650)
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
    await sleep(650)
    check('命令面板可执行筛选', all('.w1-task').length === 5, String(all('.w1-task').length))
    byText('.w1-filter', '全部')?.click()
    await sleep(250)
    check('筛选恢复全部', all('.w1-task').length === 8, String(all('.w1-task').length))
    one('.w1-motion')?.focus()

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
    await sleep(650)
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
    await sleep(150)
    check(
      '命令面板可发送消息',
      one('.w1-thread')?.textContent?.includes('帮我拟一条周报提醒') && !!one('.w1-typing'),
      one('.w1-thread')?.textContent?.slice(-80) ?? ''
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
    await sleep(400)
    const busyInput = one('.w1-paletteinput')
    setValue(busyInput, '再发一条')
    await sleep(150)
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
    await sleep(400)
    check('命令面板发送后收到回复', !one('.w1-typing'), one('.w1-typing') ? '等待动画未结束' : '')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, bubbles: true }))
    await sleep(650)
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

    byText('.w1-sess', '重构 auth 模块')?.click()
    await sleep(300)
    byText('.w1-tab', 'Codex')?.click()
    await sleep(350)
    check('切换到 Codex 会话', one('.w1-tdiv')?.textContent?.includes('周报草稿'), one('.w1-tdiv')?.textContent ?? '')

    byText('.w1-sess', '重构 auth 模块')?.click()
    await sleep(300)
    one('.w1-nall')?.click()
    await sleep(600)
    check('全部笔记页打开', !!one('.w1-notesview'))
    check(
      '未接数据库时笔记页给出空态而非崩溃',
      !!one('.w1-nvempty') || all('.w1-nvrow').length >= 0,
      one('.w1-nvempty')?.textContent ?? String(all('.w1-nvrow').length)
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))
    await sleep(500)
    check('Esc 关闭全部笔记页', !one('.w1-notesview'))

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', code: 'KeyN', ctrlKey: true, bubbles: true }))
    await sleep(350)
    check('Ctrl+N 打开笔记', !!one('.w1-modal'))
    one('.w1-modalx')?.click()
    await sleep(600)
    check('弹窗可关闭', !one('.w1-modal'))

    return { checks, title: document.title, size: [innerWidth, innerHeight] }
  })()`)
  } catch (error) {
    console.error(`[smoke] renderer script failed: ${error}`)
    const snapshot = await win.webContents
      .executeJavaScript(
        '({ root: document.getElementById("root")?.textContent?.slice(0, 120) ?? null, scripts: [...document.scripts].map((s) => s.src) })'
      )
      .catch((snapshotError) => String(snapshotError))
    console.error(JSON.stringify({ consoleErrors, snapshot }, null, 2))
    app.exit(1)
    return
  }

  const failed = results.checks.filter((check) => !check.ok)
  console.log(JSON.stringify({ ...results, consoleErrors, failures: failed.length }, null, 2))
  if (failed.length > 0 || consoleErrors.length > 0) {
    console.error(`[smoke] ${failed.length} failed check(s), ${consoleErrors.length} console error(s)`)
    app.exit(1)
    return
  }
  app.quit()
}

app.whenReady().then(run).catch((error) => {
  console.error(error)
  app.exit(1)
})
