import type { ReactNode } from 'react'
import type {
  Assessment,
  Confidence,
  IngredientFinding,
  IngredientsAnalysis,
  OverallStatus,
  SourceType,
} from '../types/analysis'
import { AlertIcon, BadgeIcon, CheckIcon, InfoIcon } from './icons'

const STATUS: Record<OverallStatus, { label: string; meaning: string; className: string; icon: ReactNode }> = {
  likely_halal: {
    label: 'Likely halal',
    meaning:
      'No prohibited ingredients or unresolved concerns were identified from the available evidence. This is not a certification.',
    className: 'border-brand-200 bg-brand-50 text-brand-800',
    icon: <CheckIcon className="size-6" />,
  },
  potentially_non_halal: {
    label: 'Potentially non-halal',
    meaning:
      'A credible concern was identified, though the evidence may not be enough for a definitive ruling.',
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

export function AnalysisResult({ analysis }: { analysis: IngredientsAnalysis }) {
  const status = STATUS[analysis.overall_status]
  const flagged = analysis.ingredients
    .filter((item) => item.assessment !== 'likely_permissible' || item.needs_more_information)
    .sort((a, b) => ASSESSMENT_ORDER.indexOf(a.assessment) - ASSESSMENT_ORDER.indexOf(b.assessment))
  const permissible = analysis.ingredients.filter((item) => !flagged.includes(item))

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
            </h2>
            <p className="mt-1 inline-block rounded-full bg-white/70 px-2.5 py-0.5 text-xs font-semibold">
              {CONFIDENCE[analysis.confidence]}
            </p>
          </div>
        </div>
        <p className="mt-3 leading-relaxed text-ink">{analysis.summary}</p>
        <p className="mt-2 text-sm opacity-90">{status.meaning}</p>
      </section>

      {analysis.adjustments.length > 0 && (
        <Panel title="HalalCheck safety check">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.adjustments.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </Panel>
      )}

      {analysis.prohibited_findings.length > 0 && (
        <section
          aria-labelledby="prohibited-heading"
          className="rounded-2xl border border-danger-700/25 bg-surface p-4 sm:p-6"
        >
          <h2 id="prohibited-heading" className="flex items-center gap-2 font-semibold text-danger-700">
            <AlertIcon className="size-5" />
            Prohibited source identified on the label
          </h2>
          <ul className="mt-3 space-y-3">
            {analysis.prohibited_findings.map((finding) => (
              <li key={`${finding.ingredient}-${finding.source}`} className="rounded-xl bg-danger-50 p-3 text-sm">
                <p className="font-semibold text-ink" dir="auto">
                  {finding.ingredient}
                  <span className="font-normal text-muted"> · source: {finding.source}</span>
                </p>
                <p className="mt-1 text-ink">{finding.evidence}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {analysis.concerns.length > 0 && (
        <Panel title="Concerns">
          <ul className="space-y-2 text-sm">
            {analysis.concerns.map((concern, index) => (
              <li key={index} className="flex gap-2">
                <AlertIcon className="mt-0.5 size-4 shrink-0 text-danger-700" />
                <span>
                  {concern.ingredient && (
                    <span className="font-semibold" dir="auto">
                      {concern.ingredient}:{' '}
                    </span>
                  )}
                  {concern.description}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel
        title="Ingredients"
        aside={
          analysis.detected_language.length > 0
            ? `Label language: ${analysis.detected_language.join(', ')}`
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

      <Panel title="Halal certification">
        {analysis.certification_information.marks_visible.length > 0 ? (
          <>
            <p className="text-sm text-muted">Visible in the photo:</p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {analysis.certification_information.marks_visible.map((mark) => (
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
        <p className="mt-2 text-sm text-muted">{analysis.certification_information.notes}</p>
        <p className="mt-2 text-xs text-muted">
          HalalCheck can’t confirm whether a logo is genuine or current. Check with the certifying
          body.
        </p>
      </Panel>

      {analysis.next_steps.length > 0 && (
        <Panel title="What you can do next">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {analysis.next_steps.map((step) => (
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
    </div>
  )
}

function IngredientCard({ item }: { item: IngredientFinding }) {
  const assessment = ASSESSMENT[item.assessment]
  const otherNames = [item.translation, item.standardised_name].filter(
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
          {otherNames.length > 0 && (
            <p className="text-sm text-muted">{otherNames.join(' · ')}</p>
          )}
        </div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${assessment.className}`}>
          {assessment.label}
        </span>
      </div>

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
          {item.source_established ? 'Source stated on label' : 'Source not stated'}
        </span>
      </div>

      <p className="mt-2 text-sm leading-relaxed">{item.explanation}</p>
      <p className="mt-1 text-sm text-muted">
        <span className="font-medium text-ink">
          {item.evidence_basis === 'label'
            ? 'Evidence from the label: '
            : 'AI general knowledge (not independently verified): '}
        </span>
        {item.evidence}
      </p>
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
