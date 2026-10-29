import { describe, expect, it } from 'vitest'
import { formatFileSize, prepareImageForUpload, validateImageFile } from './image'

function file(name: string, type: string, size = 1000) {
  return new File([new Uint8Array(size)], name, { type })
}

describe('validateImageFile', () => {
  it.each([
    ['label.jpg', 'image/jpeg'],
    ['label.png', 'image/png'],
    ['label.webp', 'image/webp'],
    ['label.JPG', ''],
  ])('accepts %s (%s)', (name, type) => {
    expect(validateImageFile(file(name, type))).toEqual({ ok: true })
  })

  it.each([
    ['label.gif', 'image/gif', 'JPEG, PNG or WebP'],
    ['notes.pdf', 'application/pdf', 'JPEG, PNG or WebP'],
    ['IMG_0001.HEIC', 'image/heic', 'HEIC photos'],
    ['mystery', '', 'JPEG, PNG or WebP'],
  ])('rejects %s', (name, type, message) => {
    const result = validateImageFile(file(name, type))
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(message)
  })

  it('rejects empty and very large files', () => {
    expect(validateImageFile(file('a.jpg', 'image/jpeg', 0)).ok).toBe(false)
    const huge = file('a.jpg', 'image/jpeg', 1)
    Object.defineProperty(huge, 'size', { value: 31 * 1024 * 1024 })
    expect(validateImageFile(huge)).toEqual({
      ok: false,
      error: 'That image is too large. Please choose one under 30 MB.',
    })
  })
})

describe('prepareImageForUpload', () => {
  it('returns the original file when the browser cannot resize images', async () => {
    const original = file('a.jpg', 'image/jpeg')
    expect(await prepareImageForUpload(original)).toBe(original)
  })
})

describe('formatFileSize', () => {
  it('formats bytes for display', () => {
    expect(formatFileSize(200)).toBe('1 KB')
    expect(formatFileSize(350 * 1024)).toBe('350 KB')
    expect(formatFileSize(3.25 * 1024 * 1024)).toBe('3.3 MB')
  })
})
