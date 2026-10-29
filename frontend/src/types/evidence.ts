// Mirrors the curated Islamic evidence library (backend/app/evidence.py). Every item here was
// checked against Quran.com/AlQuran Cloud or Sunnah.com; the AI never writes these.

export type PrincipleCategory = 'prohibited' | 'disputed' | 'caution'

export interface EvidenceItem {
  id: string
  source_type: 'quran' | 'hadith'
  /** e.g. "Qur'an 2:173" or "Sahih al-Bukhari 2236". */
  reference: string
  title: string
  narrator: string | null
  arabic_text: string
  translation: string
  translation_source: string
  text_source: string
  authenticity: { grade: string; graded_by: string } | null
  url: string
  /** True when only part of the text is quoted. */
  excerpt: boolean
}

export interface PrincipleExplanation {
  principle_id: string
  title: string
  category: PrincipleCategory
  principle: string
  evidence: EvidenceItem[]
  evidence_notes: Record<string, string>
  qualifications: string[]
  has_verified_hadith: boolean
}
