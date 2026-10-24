// 在样式表与 React 之前同步应用持久主题，避免浅色模式启动或重载时先绘制深色底。
;(() => {
  let theme = 'dark'
  try {
    if (window.localStorage.getItem('workstation.theme') === 'light') theme = 'light'
  } catch {
    // 存储不可用时保持默认夜间。
  }
  document.documentElement.dataset.theme = theme
})()
