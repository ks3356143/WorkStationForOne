import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { imageDataUrl, imagePath, readImageBase64, removeImage, saveImage } from './images'

const dirs: string[] = []
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

function dir(): string {
  const path = mkdtempSync(join(tmpdir(), 'wsfo-images-'))
  dirs.push(path)
  return path
}

afterEach(() => {
  for (const path of dirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('图片存储', () => {
  it('保存并读回图片', () => {
    const root = dir()
    const image = saveImage(root, { mime: 'image/png', data: PNG, name: '截图 1.png' })
    expect(image).toMatchObject({ name: '截图-1.png', mime: 'image/png', size: 70 })
    expect(existsSync(imagePath(root, image))).toBe(true)
    expect(readImageBase64(root, image)).toBe(PNG)
    expect(imageDataUrl(root, image).startsWith('data:image/png;base64,')).toBe(true)
    expect(imagePath(root, image)).not.toContain('..')
  })

  it('拒绝不支持的格式、伪造 id 与非法 base64', () => {
    const root = dir()
    expect(() => saveImage(root, { mime: 'image/svg+xml', data: PNG })).toThrow(TypeError)
    expect(() => saveImage(root, { mime: 'image/png', data: 'not base64!!' })).toThrow(TypeError)
    expect(() =>
      readImageBase64(root, { id: '../../etc/passwd', name: 'x', mime: 'image/png', size: 1 })
    ).toThrow(TypeError)
  })

  it('删除图片文件，非法引用返回 false', () => {
    const root = dir()
    const image = saveImage(root, { mime: 'image/png', data: PNG })
    expect(removeImage(root, image)).toBe(true)
    expect(existsSync(join(root, `${image.id}.png`))).toBe(false)
    expect(removeImage(root, image)).toBe(false)
    expect(removeImage(root, { ...image, id: '../../etc/passwd' })).toBe(false)
  })

  it('文件存在但找不到图片时报错', () => {
    const root = dir()
    expect(() =>
      readImageBase64(root, {
        id: 'img-00000000-0000-0000-0000-000000000000',
        name: 'x.png',
        mime: 'image/png',
        size: 10
      })
    ).toThrow()
  })
})
