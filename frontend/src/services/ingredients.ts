import type { IngredientsAnalysis, LabelReading } from '../types/analysis'
import { apiRequest } from './api'

// Reading takes a few seconds; analysis typically 15–40 seconds. A sleeping free-tier server can
// take up to a minute to start first.
const READ_TIMEOUT_MS = 90_000
const ANALYZE_TIMEOUT_MS = 180_000

/** Step 1: read and interpret the label (any language) for the user to check. */
export function readLabel(
  image: Blob,
  fileName = 'label.jpg',
  signal?: AbortSignal,
): Promise<LabelReading> {
  const body = new FormData()
  body.append('image', image, fileName)
  return apiRequest<LabelReading>('/api/ingredients/read', {
    method: 'POST',
    body,
    signal,
    timeoutMs: READ_TIMEOUT_MS,
  })
}

interface AnalyzeOptions {
  image: Blob | null
  fileName?: string
  /** Ingredients text confirmed or corrected by the user; authoritative over the photo. */
  correctedText?: string | null
  signal?: AbortSignal
}

/** Step 2: assess the confirmed ingredients, with the photo as supporting evidence. */
export function analyzeIngredients({
  image,
  fileName = 'label.jpg',
  correctedText,
  signal,
}: AnalyzeOptions): Promise<IngredientsAnalysis> {
  const body = new FormData()
  if (image) body.append('image', image, fileName)
  if (correctedText) body.append('ingredients_text', correctedText)
  return apiRequest<IngredientsAnalysis>('/api/ingredients/analyze', {
    method: 'POST',
    body,
    signal,
    timeoutMs: ANALYZE_TIMEOUT_MS,
  })
}
