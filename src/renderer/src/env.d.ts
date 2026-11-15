/// <reference types="vite/client" />

import type { WsApi } from '../../shared/ipc'

declare global {
  interface Window {
    ws?: WsApi
    /** 自动化测试缝：设置后番茄钟每段按该秒数倒计时，便于冒烟快进验证完成落库 */
    __WS_FOCUS_FAST__?: number
  }

  /** 构建时由 electron.vite.config.ts 从 package.json 注入 */
  const __APP_VERSION__: string
}
