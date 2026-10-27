/// <reference types="vite/client" />

import type { WsApi } from '../../shared/ipc'

declare global {
  interface Window {
    ws?: WsApi
  }
}
