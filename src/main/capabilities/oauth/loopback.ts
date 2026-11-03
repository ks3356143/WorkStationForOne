import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface CallbackResult {
  code: string
  state: string
  iss?: string
  error?: string
  errorDescription?: string
}

export interface CallbackServer {
  redirectUri: string
  wait: Promise<CallbackResult>
  close(): void
}

export const CALLBACK_PATH = '/oauth/callback'

function listen(server: Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: NodeJS.ErrnoException) => {
      server.removeListener('listening', onListening)
      reject(error)
    }
    const onListening = () => {
      server.removeListener('error', onError)
      resolve()
    }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen({ host: '127.0.0.1', port })
  })
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>${title}</title>
<body style="font:15px/1.6 system-ui;background:#0b0c16;color:#e8f2fd;padding:48px">
<h1 style="font-size:20px">${title}</h1><p>${body}</p></body></html>`
}

/**
 * 仅监听 127.0.0.1 的回环回调。端口按顺序尝试，第一个可用的就是 redirect_uri。
 * 只接受精确路径；state 由调用方校验。
 */
export async function startLoopbackCallback(
  ports: number[],
  timeoutMs = 300_000
): Promise<CallbackServer> {
  let lastError: Error | null = null
  for (const port of ports) {
    const server = createServer()
    try {
      await listen(server, port)
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('本地回调端口不可用')
      server.close()
      continue
    }

    const boundPort = (server.address() as AddressInfo).port
    let settled = false
    let timer: NodeJS.Timeout | null = null
    let close = () => {}
    const wait = new Promise<CallbackResult>((resolve, reject) => {
      const finish = (result: CallbackResult) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(result)
      }
      const fail = (error: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        reject(error)
      }
      close = () => {
        if (timer) clearTimeout(timer)
        server.close()
        if (!settled) fail(new Error('已取消登录'))
      }
      timer = setTimeout(() => {
        fail(new Error('浏览器授权超时，请重新登录'))
        server.close()
      }, timeoutMs)

      server.on('request', (request, response) => {
        const url = new URL(request.url ?? '/', `http://127.0.0.1:${boundPort}`)
        if (url.pathname !== CALLBACK_PATH) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('not found')
          return
        }
        const params = url.searchParams
        const error = params.get('error') ?? undefined
        const result: CallbackResult = {
          code: params.get('code') ?? '',
          state: params.get('state') ?? '',
          ...(params.get('iss') ? { iss: params.get('iss') ?? undefined } : {}),
          ...(error ? { error } : {}),
          ...(params.get('error_description')
            ? { errorDescription: params.get('error_description') ?? undefined }
            : {})
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        response.end(
          error
            ? page('授权未完成', `浏览器返回：${error}。可以关闭此页面并回到应用重试。`)
            : page('授权完成', '可以关闭此页面，回到 WorkStationForOne。')
        )
        finish(result)
        server.close()
      })
    })

    return {
      redirectUri: `http://127.0.0.1:${boundPort}${CALLBACK_PATH}`,
      wait,
      close: () => close()
    }
  }
  throw new Error(
    `本地回调端口都被占用（${ports[0]}–${ports.at(-1)}）：${lastError?.message ?? '未知原因'}`
  )
}
