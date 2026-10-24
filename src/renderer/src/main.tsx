import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { applyTheme, browserStorage, readStoredTheme, syncWindowTheme } from './lib/theme'
import './styles/index.css'

const initialTheme = readStoredTheme(browserStorage())
applyTheme(initialTheme)
syncWindowTheme(initialTheme)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
)
