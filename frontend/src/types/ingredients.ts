// Mirrors backend/app/models/ingredients.py.

export interface IngredientsExtraction {
  /** Text exactly as recognised; the user reviews and corrects it. */
  text: string
  /** Average OCR confidence, 0–100, when available. */
  confidence: number | null
  word_count: number
  /** Words the OCR engine was least sure about. */
  uncertain_words: string[]
  low_confidence: boolean
}
