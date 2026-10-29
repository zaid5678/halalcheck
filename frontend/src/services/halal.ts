import type { HalalVerdict } from '../types/halal'
import { apiRequest } from './api'

// A sleeping free-tier server can take up to a minute to start before the check even begins.
const PHOTO_TIMEOUT_MS = 120_000

export function checkBarcode(barcode: string, signal?: AbortSignal): Promise<HalalVerdict> {
  return apiRequest<HalalVerdict>(`/api/halal/barcode/${encodeURIComponent(barcode)}`, { signal })
}

interface PhotoCheck {
  image?: Blob
  fileName?: string
  /** Ingredients text corrected by the user; sent instead of the photo to re-check. */
  ingredientsText?: string
  signal?: AbortSignal
}

export function checkPhoto({
  image,
  fileName = 'label.jpg',
  ingredientsText,
  signal,
}: PhotoCheck): Promise<HalalVerdict> {
  const body = new FormData()
  if (ingredientsText) body.append('ingredients_text', ingredientsText)
  else if (image) body.append('image', image, fileName)
  return apiRequest<HalalVerdict>('/api/halal/photo', {
    method: 'POST',
    body,
    signal,
    timeoutMs: PHOTO_TIMEOUT_MS,
  })
}
