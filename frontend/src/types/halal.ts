// Mirrors the FastAPI response models in backend/app/models/halal.py.
import type { Product } from './product'

export type Ruling = 'halal' | 'haram' | 'doubtful'

export interface Reason {
  ingredient: string
  ruling: Ruling
  note: string
}

export interface HalalVerdict {
  verdict: Ruling
  /** Haram and doubtful ingredients only. */
  reasons: Reason[]
  ingredients_text: string | null
  /** False when only the ingredient rules were applied. */
  ai_checked: boolean
  /** Null for photo checks. */
  product: Product | null
}
