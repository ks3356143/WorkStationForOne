import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { CaptureApp } from './capture/CaptureApp'
import { applyTheme, browserStorage, readStoredTheme, syncWindowTheme } from './lib/theme'
import './styles/index.css'

const initialTheme = readStoredTheme(browserStorage())
applyTheme(initialTheme)
syncWindowTheme(initialTheme)

const container = document.getElementById('root')
if (!container) throw new Error('缺少 #root 挂载点')

const isCapture = window.location.hash === '#capture'

createRoot(container).render(<StrictMode>{isCapture ? <CaptureApp /> : <App />}</StrictMode>)
