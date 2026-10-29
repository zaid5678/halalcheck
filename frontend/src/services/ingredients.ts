import type { IngredientsAnalysis } from '../types/analysis'
import { apiRequest } from './api'

// AI analysis typically takes 15–40 seconds, and a sleeping free-tier server can take up to a
// minute to start first.
const ANALYZE_TIMEOUT_MS = 180_000

interface AnalyzeOptions {
  image: Blob | null
  fileName?: string
  /** Ingredients text corrected by the user; takes precedence over what the photo shows. */
  correctedText?: string | null
  signal?: AbortSignal
}

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
