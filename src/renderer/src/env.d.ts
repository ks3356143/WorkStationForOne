/// <reference types="vite/client" />

import type { WsApi } from '../../shared/ipc'

declare global {
  interface Window {
    ws?: WsApi
  }

  /** 构建时由 electron.vite.config.ts 从 package.json 注入 */
  const __APP_VERSION__: string
}
