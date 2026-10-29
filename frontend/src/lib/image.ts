// Client-side checks and resizing for ingredients photos. The server validates again; these
// checks exist to give instant feedback and to keep uploads small on mobile data.

export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
/** Value for <input accept>. Listing exact types makes iOS convert HEIC photos to JPEG. */
export const IMAGE_ACCEPT = ACCEPTED_IMAGE_TYPES.join(',')

/** Matches the API limit. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
/** Larger originals are accepted because they are shrunk before uploading. */
export const MAX_ORIGINAL_BYTES = 30 * 1024 * 1024
/**
 * Only very large photos are shrunk. Browser resizing is softer than the server's, which hurts
 * OCR on small print, so typical 12-megapixel phone photos are uploaded untouched.
 */
const RESIZE_ABOVE_LONG_EDGE = 4096
const RESIZE_ABOVE_BYTES = 8 * 1024 * 1024
const TARGET_LONG_EDGE = 3200

const EXTENSION_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
}

export type ImageValidation = { ok: true } | { ok: false; error: string }

function effectiveType(file: File): string {
  if (file.type) return file.type.toLowerCase()
  // Some file pickers don't report a type; fall back to the extension.
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return EXTENSION_TYPES[extension] ?? ''
}

export function validateImageFile(file: File): ImageValidation {
  const type = effectiveType(file)
  if (type === 'image/heic' || type === 'image/heif') {
    return {
      ok: false,
      error:
        'HEIC photos aren’t supported yet. Take the photo with “Take photo”, or export it as JPEG first.',
    }
  }
  if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: 'Please choose a JPEG, PNG or WebP image.' }
  }
  if (file.size === 0) {
    return { ok: false, error: 'That file is empty. Please choose another image.' }
  }
  if (file.size > MAX_ORIGINAL_BYTES) {
    return { ok: false, error: 'That image is too large. Please choose one under 30 MB.' }
  }
  return { ok: true }
}

/**
 * Shrink large photos before uploading. Falls back to the original file whenever the browser
 * can't decode or re-encode it; the server will still validate and process the original.
 */
export async function prepareImageForUpload(file: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file

  let bitmap: ImageBitmap | undefined
  try {
    // Applies EXIF orientation, so the uploaded pixels are upright.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    const longEdge = Math.max(bitmap.width, bitmap.height)
    if (longEdge <= RESIZE_ABOVE_LONG_EDGE && file.size <= RESIZE_ABOVE_BYTES) return file

    const scale = Math.min(1, TARGET_LONG_EDGE / longEdge)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const context = canvas.getContext('2d')
    if (!context) return file
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const resized = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.92),
    )
    return resized && resized.size < file.size ? resized : file
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
