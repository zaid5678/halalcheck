import type { HalalVerdict } from '../types/halal'
import { apiRequest } from './api'

// Generous: a sleeping free-tier server can take up to a minute to start before the check begins.
const PHOTO_TIMEOUT_MS = 120_000

export function checkBarcode(barcode: string, signal?: AbortSignal): Promise<HalalVerdict> {
  return apiRequest<HalalVerdict>(`/api/halal/barcode/${encodeURIComponent(barcode)}`, { signal })
}

export function checkPhoto(image: Blob, fileName: string, signal?: AbortSignal): Promise<HalalVerdict> {
  const body = new FormData()
  body.append('image', image, fileName)
  return apiRequest<HalalVerdict>('/api/halal/photo', {
    method: 'POST',
    body,
    signal,
    timeoutMs: PHOTO_TIMEOUT_MS,
  })
}
