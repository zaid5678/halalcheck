import { useState } from 'react'
import type { EvidenceItem, PrincipleExplanation } from '../types/evidence'
import { BadgeIcon, ExternalLinkIcon } from './icons'

// Long verses (e.g. Qur'an 5:3) are collapsed until the reader expands them.
const LONG_TEXT = 320

/** A verified Qur'an verse or hadith from HalalCheck's curated library. */
export function EvidenceCard({ item, notes = [] }: { item: EvidenceItem; notes?: string[] }) {
  const isQuran = item.source_type === 'quran'
  const isLong = item.translation.length > LONG_TEXT
  const [expanded, setExpanded] = useState(false)
  const clamp = isLong && !expanded
  return (
    <article className="rounded-xl border border-line bg-surface p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="font-semibold">
          <span
            className={`mr-2 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
              isQuran ? 'bg-brand-100 text-brand-800' : 'bg-canvas text-ink'
            }`}
          >
            {isQuran ? 'Qur’an' : 'Hadith'}
          </span>
          {item.reference}
        </h4>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
          <BadgeIcon className="size-3.5" />
          Verified reference
        </span>
      </header>

      <p lang="ar" dir="rtl" className={`mt-3 text-lg leading-loose font-medium ${clamp ? 'line-clamp-2' : ''}`}>
        {item.arabic_text}
      </p>
      <blockquote className={`mt-2 border-l-2 border-brand-200 pl-3 text-sm leading-relaxed ${clamp ? 'line-clamp-4' : ''}`}>
        {item.narrator && <span className="block text-muted">{item.narrator}:</span>}“
        {item.translation}”
      </blockquote>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          className="mt-1 min-h-9 text-sm font-medium text-brand-700"
        >
          {expanded ? 'Show less' : 'Show full text'}
        </button>
      )}

      <dl className="mt-2 space-y-0.5 text-xs text-muted">
        <div>
          <dt className="inline">Translation: </dt>
          <dd className="inline">{item.translation_source}</dd>
        </div>
        {item.authenticity && (
          <div>
            <dt className="inline">Grade: </dt>
            <dd className="inline">
              <span className="font-semibold text-ink">{item.authenticity.grade}</span> —{' '}
              {item.authenticity.graded_by}
            </dd>
          </div>
        )}
        {item.excerpt && <div>Excerpt; open the source for the full text.</div>}
      </dl>
      {notes.map((note) => (
        <p key={note} className="mt-2 rounded-lg bg-canvas p-2 text-xs">
          {note}
        </p>
      ))}
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-2 inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-700 underline underline-offset-2"
      >
        Read {item.reference} on {isQuran ? 'Quran.com' : 'Sunnah.com'}
        <ExternalLinkIcon className="size-3.5" />
        <span className="sr-only">(opens in a new tab)</span>
      </a>
    </article>
  )
}

/** A curated principle with its verified evidence and scholarly qualifications. */
export function PrincipleEvidence({ explanation }: { explanation: PrincipleExplanation }) {
  return (
    <div className="space-y-3">
      <div>
        <h4 className="font-semibold">{explanation.title}</h4>
        <p className="mt-1 text-sm leading-relaxed">{explanation.principle}</p>
      </div>
      <div className="space-y-2">
        {explanation.evidence.map((item) => (
          <EvidenceCard
            key={item.id}
            item={item}
            notes={explanation.evidence_notes[item.id] ? [explanation.evidence_notes[item.id]] : []}
          />
        ))}
      </div>
      {!explanation.has_verified_hadith && (
        <p className="text-xs text-muted">
          No verified hadith in HalalCheck’s library directly addresses this, so only Qur’anic
          evidence is shown.
        </p>
      )}
      {explanation.qualifications.length > 0 && <Qualifications notes={explanation.qualifications} />}
    </div>
  )
}

export function Qualifications({ notes, title = 'Qualifications and scholarly differences' }: {
  notes: string[]
  title?: string
}) {
  return (
    <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
      <p className="font-semibold">{title}</p>
      <ul className="mt-1 list-disc space-y-1 pl-5">
        {notes.map((note) => (
          <li key={note}>{note}</li>
        ))}
      </ul>
    </div>
  )
}
