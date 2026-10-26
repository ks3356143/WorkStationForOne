// 在样式表与 React 之前同步应用持久主题与皮肤，避免启动或重载时先绘制默认外观。
;(() => {
  const root = document.documentElement
  let theme = 'dark'
  let skin = 'prism'
  try {
    if (window.localStorage.getItem('workstation.theme') === 'light') theme = 'light'
    if (window.localStorage.getItem('workstation.skin') === 'classic') skin = 'classic'
  } catch {
    // 存储不可用时保持默认夜间 + 棱镜皮肤。
  }
  root.dataset.theme = theme
  root.dataset.skin = skin
})()
