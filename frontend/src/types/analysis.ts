// Mirrors backend/app/models/analysis.py.

export type OverallStatus = 'likely_halal' | 'potentially_non_halal' | 'needs_further_investigation'
export type Assessment = 'likely_permissible' | 'potential_concern' | 'unknown'
export type Confidence = 'low' | 'medium' | 'high'
export type SourceType =
  | 'pork'
  | 'animal'
  | 'insect'
  | 'plant'
  | 'mineral'
  | 'synthetic'
  | 'microbial'
  | 'alcohol'
  | 'unknown'
/** "label": printed on the label. "general_knowledge": the AI model's own knowledge. */
export type EvidenceBasis = 'label' | 'general_knowledge'

export interface IngredientFinding {
  original_text: string
  standardised_name: string | null
  translation: string | null
  e_number: string | null
  possible_sources: SourceType[]
  source_established: boolean
  assessment: Assessment
  explanation: string
  evidence: string
  evidence_basis: EvidenceBasis
  needs_more_information: boolean
}

export interface ProhibitedFinding {
  ingredient: string
  source: string
  evidence: string
}

export interface Concern {
  ingredient: string | null
  description: string
}

export interface IngredientsAnalysis {
  label_readable: boolean
  readability_notes: string | null
  detected_language: string[]
  extracted_ingredients_text: string
  overall_status: OverallStatus
  confidence: Confidence
  summary: string
  ingredients: IngredientFinding[]
  prohibited_findings: ProhibitedFinding[]
  concerns: Concern[]
  certification_information: { marks_visible: string[]; notes: string }
  limitations: string[]
  next_steps: string[]
  model: string
  used_corrected_text: boolean
  /** Changes HalalCheck's safeguards made to the model's result. */
  adjustments: string[]
}
