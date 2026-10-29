import type { ReactNode } from 'react'
import type {
  Assessment,
  CitedEvidence,
  ConcernResult,
  ConcernType,
  Confidence,
  EvidenceBasis,
  IngredientResult,
  IngredientsAnalysis,
  OverallStatus,
  ProhibitionReason,
  SourceType,
} from '../types/analysis'
import { EvidenceCard, Qualifications } from './EvidenceCard'
import { AlertIcon, BadgeIcon, CheckIcon, InfoIcon } from './icons'

const STATUS: Record<
  OverallStatus,
  { label: string; meaning: string; className: string; icon: ReactNode }
> = {
  haram: {
    label: 'Haram',
    meaning:
      'The label establishes that an ingredient comes from a source the Qur’an prohibits. See the explanation below.',
    className: 'border-danger-700/40 bg-danger-50 text-danger-700',
    icon: <AlertIcon className="size-6" />,
  },
  potentially_non_halal: {
    label: 'Potentially non-halal',
    meaning:
      'A credible concern was identified, but the evidence is not enough for a definitive classification.',
    className: 'border-danger-700/25 bg-danger-50 text-danger-700',
    icon: <AlertIcon className="size-6" />,
  },
  needs_further_investigation: {
    label: 'Needs further investigation',
    meaning:
      'The label is incomplete or ambiguous, or the source of one or more ingredients is uncertain.',
    className: 'border-amber-300 bg-amber-50 text-amber-900',
    icon: <InfoIcon className="size-6" />,
  },
  likely_halal: {
    label: 'Likely halal',
    meaning:
      'No prohibited ingredients or unresolved concerns were identified from the available evidence. This is not a certification.',
    className: 'border-brand-200 bg-brand-50 text-brand-800',
    icon: <CheckIcon className="size-6" />,
  },
}

const CONFIDENCE: Record<Confidence, string> = {
  low: 'Low confidence',
  medium: 'Medium confidence',
  high: 'High confidence',
}

const ASSESSMENT: Record<Assessment, { label: string; className: string }> = {
  potential_concern: { label: 'Potential concern', className: 'bg-danger-50 text-danger-700' },
  unknown: { label: 'Unknown source', className: 'bg-amber-50 text-amber-900' },
  likely_permissible: { label: 'Likely permissible', className: 'bg-brand-50 text-brand-800' },
}

const CONCERN_TYPE: Record<ConcernType, string> = {
  established_prohibited_source: 'Prohibited source stated on the label',
  possible_prohibited_source: 'Possible prohibited source — not established',
  disputed_ingredient: 'Scholars differ on this ingredient',
}

const SOURCE_LABELS: Record<SourceType, string> = {
  pork: 'Pork',
  animal: 'Animal',
  insect: 'Insect',
  plant: 'Plant',
  mineral: 'Mineral',
  synthetic: 'Synthetic',
  microbial: 'Microbial',
  alcohol: 'Alcohol',
  unknown: 'Unknown',
}

const ASSESSMENT_ORDER: Assessment[] = ['potential_concern', 'unknown', 'likely_permissible']

/** Labels distinguishing verified facts, label evidence and AI interpretation. */
function Provenance({ kind }: { kind: 'verified' | EvidenceBasis | 'ai' }) {
  const styles = {
    verified: ['Verified reference', 'bg-brand-100 text-brand-800'],
    label: ['From the label', 'bg-canvas text-ink'],
    general_knowledge: ['AI general knowledge — not independently verified', 'bg-amber-50 text-amber-900'],
    ai: ['AI interpretation', 'bg-amber-50 text-amber-900'],
  } as const
  const [label, className] = styles[kind]
  return (
    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${className}`}>
      {label}
    </span>
  )
}

export function AnalysisResult({ analysis }: { analysis: IngredientsAnalysis }) {
  const status = STATUS[analysis.overall_status]
  const flagged = analysis.ingredients
    .filter((item) => item.assessment !== 'likely_permissible' || item.needs_more_information)
    .sort((a, b) => ASSESSMENT_ORDER.indexOf(a.assessment) - ASSESSMENT_ORDER.indexOf(b.assessment))
  const permissible = analysis.ingredients.filter((item) => !flagged.includes(item))
  const evidenceById = new Map(analysis.islamic_evidence.map((item) => [item.id, item]))
  const shownInReasons = new Set(analysis.reason_for_prohibition.flatMap((r) => r.evidence_ids))
  const otherEvidence = analysis.islamic_evidence.filter((item) => !shownInReasons.has(item.id))
  const reasonPrinciples = new Set(analysis.reason_for_prohibition.map((r) => r.principle_id))
  const otherQualifications = analysis.scholarly_qualifications.filter(
    (q) => !reasonPrinciples.has(q.principle_id),
  )
  const openConcerns = analysis.identified_concerns.filter((c) => !c.verified_prohibited_source)

  return (
    <div className="space-y-4">
      <section
        aria-labelledby="assessment-heading"
        className={`rounded-2xl border p-4 sm:p-6 ${status.className}`}
      >
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0">{status.icon}</span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide uppercase opacity-80">Assessment</p>
            <h2 id="assessment-heading" className="text-xl font-bold">
              {status.label}
              {analysis.overall_status === 'haram' && analysis.reason_for_prohibition[0] && (
                <span className="block text-base font-semibold">
                  {analysis.reason_for_prohibition[0].principle_title} identified
                </span>
              )}
            </h2>
            <p className="mt-1 inline-block rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-semibold">
              {CONFIDENCE[analysis.confidence]}
            </p>
          </div>
        </div>
        <p className="mt-3 leading-relaxed text-ink">{analysis.summary}</p>
        <p className="mt-2 text-sm opacity-90">{status.meaning}</p>
      </section>

      {analysis.reason_for_prohibition.length > 0 && (
        <section aria-labelledby="why-haram-heading" className="space-y-3">
          <h2 id="why-haram-heading" className="text-lg font-bold">
            Why this product is assessed as haram
          </h2>
          {analysis.reason_for_prohibition.map((reason) => (
            <ProhibitionCard
              key={`${reason.ingredient_on_packaging}-${reason.principle_id}`}
              reason={reason}
              evidence={reason.evidence_ids
                .map((id) => evidenceById.get(id))
                .filter((item): item is CitedEvidence => !!item)}
            />
          ))}
        </section>
      )}

      {analysis.adjustments.length > 0 && (
        <Panel title="HalalCheck safety check">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.adjustments.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Panel>
      )}

      {(openConcerns.length > 0 || analysis.unresolved_questions.length > 0) && (
        <Panel title={analysis.overall_status === 'haram' ? 'Other concerns' : 'What needs checking'}>
          {openConcerns.length > 0 && (
            <ul className="space-y-3">
              {openConcerns.map((concern, index) => (
                <ConcernItem key={`${concern.ingredient}-${concern.principle_id}-${index}`} concern={concern} />
              ))}
            </ul>
          )}
          {analysis.unresolved_questions.length > 0 && (
            <div className={openConcerns.length > 0 ? 'mt-4' : ''}>
              <p className="text-sm font-semibold">Unresolved questions</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {analysis.unresolved_questions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </div>
          )}
        </Panel>
      )}

      <Panel
        title="Ingredients"
        aside={
          analysis.detected_languages.length > 0
            ? `Label language: ${analysis.detected_languages.join(', ')}`
            : undefined
        }
      >
        {analysis.ingredients.length === 0 ? (
          <p className="text-sm text-muted italic">No ingredients could be identified.</p>
        ) : (
          <>
            {flagged.length > 0 && (
              <ul className="space-y-3" aria-label="Ingredients to check">
                {flagged.map((item, index) => (
                  <IngredientCard key={`${item.original_text}-${index}`} item={item} />
                ))}
              </ul>
            )}
            {permissible.length > 0 && (
              <details className="group mt-3 rounded-xl border border-line" open={flagged.length === 0}>
                <summary className="flex min-h-11 cursor-pointer items-center justify-between px-3 text-sm font-medium">
                  {permissible.length} likely permissible{' '}
                  {permissible.length === 1 ? 'ingredient' : 'ingredients'}
                  <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
                    ▾
                  </span>
                </summary>
                <ul className="space-y-3 border-t border-line p-3" aria-label="Likely permissible ingredients">
                  {permissible.map((item, index) => (
                    <IngredientCard key={`${item.original_text}-${index}`} item={item} />
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </Panel>

      {otherEvidence.length > 0 && (
        <Panel title={analysis.overall_status === 'haram' ? 'Other related Islamic evidence' : 'Related Islamic evidence'}>
          <p className="mb-3 text-sm text-muted">
            The principles behind the concerns above, from HalalCheck’s verified library. These
            explain what Islam prohibits; they do not show that this product contains a prohibited
            ingredient.
          </p>
          <div className="space-y-2">
            {otherEvidence.map((item) => (
              <EvidenceCard key={item.id} item={item} notes={item.notes} />
            ))}
          </div>
        </Panel>
      )}

      {otherQualifications.length > 0 && (
        <Panel title="Scholarly qualifications">
          <div className="space-y-3">
            {otherQualifications.map((q) => (
              <Qualifications key={q.principle_id} title={q.principle_title} notes={q.notes} />
            ))}
          </div>
        </Panel>
      )}

      <Panel title="Halal certification">
        {analysis.certification_status.marks_visible.length > 0 ? (
          <>
            <p className="text-sm text-muted">Visible in the photo:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {analysis.certification_status.marks_visible.map((mark) => (
                <li key={mark} className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1 text-sm text-brand-800" dir="auto">
                  <BadgeIcon className="size-4" />
                  {mark}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm font-medium">No halal certification visible</p>
        )}
        <p className="mt-2 text-sm text-muted">{analysis.certification_status.notes}</p>
        <p className="mt-2 text-xs text-muted">
          HalalCheck can’t confirm whether a logo is genuine or current. Check with the certifying
          body.
        </p>
      </Panel>

      {analysis.recommended_next_steps.length > 0 && (
        <Panel title="What you can do next">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.recommended_next_steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ul>
        </Panel>
      )}

      {analysis.limitations.length > 0 && (
        <Panel title="Limitations">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {analysis.limitations.map((limitation) => (
              <li key={limitation}>{limitation}</li>
            ))}
          </ul>
        </Panel>
      )}

      <aside className="rounded-2xl border border-line bg-surface p-4 text-xs text-muted">
        <p className="mb-2 font-semibold text-ink">How to read this result</p>
        <ul className="space-y-1.5">
          <li><Provenance kind="verified" /> Qur’an and hadith text checked against Quran.com and Sunnah.com, from HalalCheck’s curated library. The AI cannot add references.</li>
          <li><Provenance kind="label" /> Printed on the packaging, as read from your photo or text.</li>
          <li><Provenance kind="general_knowledge" /> The AI model’s knowledge of how ingredients are made. Not checked with the manufacturer.</li>
          <li><Provenance kind="ai" /> The AI’s explanation linking an ingredient to a principle.</li>
        </ul>
      </aside>
    </div>
  )
}

function ProhibitionCard({ reason, evidence }: { reason: ProhibitionReason; evidence: CitedEvidence[] }) {
  const names = [reason.translated_name, reason.standardised_name].filter(
    (name, index, all): name is string =>
      !!name &&
      name.toLowerCase() !== reason.ingredient_on_packaging.toLowerCase() &&
      all.findIndex((other) => other?.toLowerCase() === name.toLowerCase()) === index,
  )
  return (
    <article className="space-y-4 rounded-2xl border border-danger-700/25 bg-surface p-4 sm:p-6">
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold tracking-wide text-muted uppercase">Ingredient</dt>
          <dd>
            <span className="text-lg font-bold break-words" dir="auto">{reason.ingredient_on_packaging}</span>
            <span className="block text-xs text-muted">Name used on the packaging</span>
            {names.length > 0 && <span className="mt-1 block text-sm">{names.join(' · ')}</span>}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold tracking-wide text-muted uppercase">Source</dt>
          <dd>
            <span className="text-lg font-bold">{SOURCE_LABELS[reason.source]}-derived</span>{' '}
            <Provenance kind={reason.source_evidence_basis} />
            <span className="mt-1 block text-sm">{reason.source_evidence}</span>
          </dd>
        </div>
      </dl>

      <div>
        <h3 className="font-semibold">Why is it prohibited?</h3>
        <p className="mt-1 text-sm leading-relaxed">{reason.why_prohibited}</p>
        <p className="mt-2 text-sm leading-relaxed">
          <Provenance kind="ai" /> {reason.connection}
        </p>
      </div>

      <div>
        <h3 className="font-semibold">Islamic evidence</h3>
        <div className="mt-2 space-y-2">
          {evidence.map((item) => (
            <EvidenceCard key={item.id} item={item} notes={item.notes} />
          ))}
        </div>
        {!reason.has_verified_hadith && (
          <p className="mt-2 text-xs text-muted">
            No verified hadith in HalalCheck’s library directly addresses this, so only Qur’anic
            evidence is shown.
          </p>
        )}
      </div>

      {reason.qualifications.length > 0 && <Qualifications notes={reason.qualifications} />}
    </article>
  )
}

function ConcernItem({ concern }: { concern: ConcernResult }) {
  return (
    <li className="rounded-xl border border-line p-3 text-sm">
      <p className="font-semibold" dir="auto">{concern.ingredient}</p>
      <p className="text-xs text-muted">
        {CONCERN_TYPE[concern.concern_type]} · {concern.principle_title}
      </p>
      <p className="mt-2">
        <span className="font-medium">Source: </span>
        {concern.source_evidence} <Provenance kind={concern.source_evidence_basis} />
      </p>
      <p className="mt-1">
        <Provenance kind="ai" /> {concern.connection}
      </p>
      {concern.unresolved_question && (
        <p className="mt-2 font-medium text-amber-900">To resolve: {concern.unresolved_question}</p>
      )}
    </li>
  )
}

function IngredientCard({ item }: { item: IngredientResult }) {
  const assessment = ASSESSMENT[item.assessment]
  const otherNames = [item.translated_name, item.standardised_identity].filter(
    (name, index, names): name is string =>
      !!name &&
      name.toLowerCase() !== item.original_text.toLowerCase() &&
      names.findIndex((other) => other?.toLowerCase() === name.toLowerCase()) === index,
  )

  return (
    <li className="rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold break-words" dir="auto">
            {item.original_text}
          </p>
          {otherNames.length > 0 && <p className="text-sm text-muted">{otherNames.join(' · ')}</p>}
          {item.alternative_names.length > 0 && (
            <p className="text-xs text-muted">Also known as {item.alternative_names.join(', ')}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${assessment.className}`}>
          {assessment.label}
        </span>
      </div>

      {item.reading_uncertain && (
        <p className="mt-2 text-xs font-medium text-amber-900">
          ⚠ The text or translation of this ingredient may be wrong. Check it against the pack.
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
        {item.e_number && (
          <span className="rounded-md bg-canvas px-2 py-0.5 font-mono">{item.e_number}</span>
        )}
        {item.possible_sources.map((source) => (
          <span key={source} className="rounded-md bg-canvas px-2 py-0.5">
            {SOURCE_LABELS[source]}
          </span>
        ))}
        <span className="rounded-md bg-canvas px-2 py-0.5 text-muted">
          {item.established_source
            ? `Source stated on label: ${SOURCE_LABELS[item.established_source]}`
            : 'Source not stated'}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed">{item.explanation}</p>
      <p className="mt-1 text-sm text-muted">
        <Provenance kind={item.evidence_basis} /> {item.evidence}
      </p>
      {item.knowledge_base_match && (
        <p className="mt-1 text-xs text-muted">
          HalalCheck knowledge base: “{item.knowledge_base_match.term}” —{' '}
          {item.knowledge_base_match.note}
        </p>
      )}
      {item.needs_more_information && (
        <p className="mt-2 text-xs font-medium text-amber-900">
          Needs confirmation from the manufacturer or a certifier.
        </p>
      )}
    </li>
  )
}

function Panel({ title, aside, children }: { title: string; aside?: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {aside && <span className="text-xs text-muted">{aside}</span>}
      </div>
      {children}
    </section>
  )
}
