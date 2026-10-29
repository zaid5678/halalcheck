import type { IngredientsExtraction } from '../types/ingredients'
import { apiRequest } from './api'

// Generous: a sleeping free-tier server can take up to a minute to start before OCR even begins.
const EXTRACT_TIMEOUT_MS = 120_000

export function extractIngredients(
  image: Blob,
  fileName: string,
  signal?: AbortSignal,
): Promise<IngredientsExtraction> {
  const body = new FormData()
  body.append('image', image, fileName)
  return apiRequest<IngredientsExtraction>('/api/ingredients/extract', {
    method: 'POST',
    body,
    signal,
    timeoutMs: EXTRACT_TIMEOUT_MS,
  })
}
