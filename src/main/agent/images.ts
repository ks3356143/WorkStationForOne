import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AgentImageInput, AgentImageRef } from '../../shared/ipc'
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

function basenameOf(name: string | undefined, mime: string): string {
  const safe = (name ?? '')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .slice(0, 60)
  if (safe) return safe
  return `image.${MIME_EXT[mime] ?? 'png'}`
}

/** 图片只存应用私有目录；返回引用供消息与工作区之外的渲染层使用。 */
export function saveImage(dir: string, input: AgentImageInput): AgentImageRef {
  const mime = input.mime.toLowerCase()
  if (!MIME_EXT[mime]) throw new TypeError('只支持 PNG / JPEG / WebP / GIF 图片')
  const data = input.data.trim()
  if (!/^[A-Za-z0-9+/=]+$/.test(data)) throw new TypeError('图片数据无效')
  const buffer = Buffer.from(data, 'base64')
  if (buffer.length === 0) throw new TypeError('图片为空')
  if (buffer.length > MAX_IMAGE_BYTES) throw new TypeError('图片超过 10 MB')
  mkdirSync(dir, { recursive: true })
  const id = `img-${randomUUID()}`
  writeFileSync(join(dir, `${id}.${MIME_EXT[mime]}`), buffer)
  return { id, name: basenameOf(input.name, mime), mime, size: buffer.length }
}

function pathOf(dir: string, image: AgentImageRef): string {
  const ext = MIME_EXT[image.mime]
  if (!ext) throw new TypeError('图片类型无效')
  if (!/^img-[0-9a-f-]{36}$/.test(image.id)) throw new TypeError('图片 id 无效')
  return join(dir, `${image.id}.${ext}`)
}

export function readImageBase64(dir: string, image: AgentImageRef): string {
  const buffer = readFileSync(pathOf(dir, image))
  if (buffer.length > MAX_IMAGE_BYTES) throw new TypeError('图片超过 10 MB')
  return buffer.toString('base64')
}

export function imageDataUrl(dir: string, image: AgentImageRef): string {
  return `data:${image.mime};base64,${readImageBase64(dir, image)}`
}

export function imagePath(dir: string, image: AgentImageRef): string {
  const path = pathOf(dir, image)
  statSync(path)
  return path
}

/** 会话删除后的孤儿图片清理；路径非法或文件已不在都返回 false。 */
export function removeImage(dir: string, image: AgentImageRef): boolean {
  try {
    rmSync(pathOf(dir, image))
    return true
  } catch {
    return false
  }
}
