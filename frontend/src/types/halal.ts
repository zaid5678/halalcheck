// Mirrors the FastAPI response models in backend/app/models/halal.py.
import type { PrincipleExplanation } from './evidence'
import type { Product } from './product'

export type Ruling = 'halal' | 'haram' | 'doubtful'

export interface Reason {
  ingredient: string
  ruling: Ruling
  note: string
  /** Evidence-library principle behind this knowledge-base ruling, if any. */
  principle_id?: string | null
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
  /** Curated principles and verified evidence for haram reasons. */
  explanations?: PrincipleExplanation[]
}
