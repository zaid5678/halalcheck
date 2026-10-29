// Mirrors backend/app/models/analysis.py.
import type { EvidenceItem, PrincipleCategory } from './evidence'
import type { Ruling } from './halal'

export type OverallStatus =
  | 'haram'
  | 'potentially_non_halal'
  | 'needs_further_investigation'
  | 'likely_halal'
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
export type ConcernType =
  | 'established_prohibited_source'
  | 'possible_prohibited_source'
  | 'disputed_ingredient'

// --- Step 1: reading the label ---------------------------------------------------------------

export interface ReadIngredient {
  original_text: string
  translated_name: string | null
  e_number: string | null
  alternative_names: string[]
  reading_uncertain: boolean
  reading_note: string | null
}

export interface LabelReading {
  label_readable: boolean
  readability_notes: string | null
  clarification_request: string | null
  detected_languages: string[]
  ingredients_text: string
  ingredients: ReadIngredient[]
  model: string
}

// --- Step 2: analysis ------------------------------------------------------------------------

export interface IngredientResult {
  original_text: string
  translated_name: string | null
  standardised_identity: string | null
  alternative_names: string[]
  e_number: string | null
  reading_uncertain: boolean
  possible_sources: SourceType[]
  /** Set only when the label itself establishes the source. */
  established_source: SourceType | null
  assessment: Assessment
  explanation: string
  evidence: string
  evidence_basis: EvidenceBasis
  needs_more_information: boolean
  knowledge_base_match: { term: string; ruling: Ruling; note: string } | null
}

export interface ConcernResult {
  ingredient: string
  principle_id: string
  principle_title: string
  principle_category: PrincipleCategory
  concern_type: ConcernType
  source_evidence: string
  source_evidence_basis: EvidenceBasis
  connection: string
  unresolved_question: string | null
  /** Both a clear prohibition and a label-established source. */
  verified_prohibited_source: boolean
}

export interface ProhibitionReason {
  ingredient_on_packaging: string
  translated_name: string | null
  standardised_name: string | null
  source: SourceType
  source_evidence: string
  source_evidence_basis: EvidenceBasis
  principle_id: string
  principle_title: string
  /** Curated statement of the Islamic principle. */
  why_prohibited: string
  /** AI-written link between the principle and the ingredient. */
  connection: string
  evidence_ids: string[]
  has_verified_hadith: boolean
  qualifications: string[]
}

export interface SourceEvidence {
  ingredient: string
  standardised_identity: string | null
  possible_sources: SourceType[]
  established_source: SourceType | null
  evidence: string
  evidence_basis: EvidenceBasis
  knowledge_base_note: string | null
}

export interface CitedEvidence extends EvidenceItem {
  principle_ids: string[]
  notes: string[]
}

export interface IngredientsAnalysis {
  label_readable: boolean
  readability_notes: string | null
  detected_languages: string[]
  extracted_ingredients_text: string
  overall_status: OverallStatus
  confidence: Confidence
  summary: string
  ingredients: IngredientResult[]
  identified_concerns: ConcernResult[]
  reason_for_prohibition: ProhibitionReason[]
  ingredient_source_evidence: SourceEvidence[]
  islamic_evidence: CitedEvidence[]
  scholarly_qualifications: {
    principle_id: string
    principle_title: string
    category: PrincipleCategory
    notes: string[]
  }[]
  certification_status: { marks_visible: string[]; notes: string }
  unresolved_questions: string[]
  recommended_next_steps: string[]
  limitations: string[]
  model: string
  used_corrected_text: boolean
  /** Changes HalalCheck's safeguards made to the model's result. */
  adjustments: string[]
}
