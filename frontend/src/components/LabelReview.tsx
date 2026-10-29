import { useId, useState } from 'react'
import type { LabelReading } from '../types/analysis'
import { AlertIcon } from './icons'

interface LabelReviewProps {
  reading: LabelReading
  onConfirm: (text: string) => void
  onRetake: () => void
}

/**
 * Step 1 result: what the AI read from the label, in its original language with an English
 * interpretation, for the user to check and correct before anything is assessed.
 */
export function LabelReview({ reading, onConfirm, onRetake }: LabelReviewProps) {
  const [text, setText] = useState(reading.ingredients_text)
  const fieldId = useId()
  const hintId = useId()
  const edited = text.trim() !== reading.ingredients_text.trim()
  const uncertain = reading.ingredients.filter((item) => item.reading_uncertain)

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="space-y-4">
      {!reading.label_readable && (
        <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
          <h2 className="font-semibold">Please take a clearer photo</h2>
          <p className="mt-1 text-sm">
            {reading.readability_notes ??
              'The ingredients list couldn’t be read reliably. Retake the photo, or type the ingredients below.'}
          </p>
          <button type="button" onClick={onRetake} className="btn-secondary mt-3">
            Retake photo
          </button>
        </div>
      )}

      {reading.clarification_request && (
        <div role="status" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            <strong>Please check the pack:</strong> {reading.clarification_request} Correct the
            text below if needed.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${fieldId}-heading`} className="font-semibold">
            Check the ingredients we read
          </h2>
          {reading.detected_languages.length > 0 && (
            <span className="text-xs text-muted">
              Label language: {reading.detected_languages.join(', ')}
            </span>
          )}
        </div>
        <p id={hintId} className="mt-1 text-sm text-muted">
          Read by AI. Small print and other languages are easily misread, so compare this with
          the pack and fix any mistakes before checking.
        </p>

        {reading.ingredients.length > 0 && (
          <table className="mt-3 w-full text-left text-sm">
            <caption className="sr-only">Ingredients as printed and their English meaning</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th scope="col" className="pb-1 font-medium">On the label</th>
                <th scope="col" className="pb-1 font-medium">In English</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {reading.ingredients.map((item, index) => (
                <tr key={`${item.original_text}-${index}`} className="align-top">
                  <td className="py-2 pr-3 font-medium break-words" dir="auto">
                    {item.original_text}
                  </td>
                  <td className="py-2">
                    <span className={item.translated_name ? '' : 'text-muted italic'}>
                      {item.translated_name ?? 'No confident translation'}
                    </span>
                    {item.e_number && (
                      <span className="ml-1.5 rounded bg-canvas px-1.5 font-mono text-xs">
                        {item.e_number}
                      </span>
                    )}
                    {item.alternative_names.length > 0 && (
                      <span className="block text-xs text-muted">
                        Also known as {item.alternative_names.join(', ')}
                      </span>
                    )}
                    {item.reading_uncertain && (
                      <span className="mt-1 block text-xs font-medium text-amber-900">
                        ⚠ Check this: {item.reading_note ?? 'the reading or translation may be wrong.'}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {uncertain.length > 0 && (
          <p className="mt-3 text-sm font-medium text-amber-900">
            {uncertain.length === 1
              ? '1 ingredient may have been misread.'
              : `${uncertain.length} ingredients may have been misread.`}{' '}
            Please check {uncertain.length === 1 ? 'it' : 'them'} against the pack.
          </p>
        )}

        <label htmlFor={fieldId} className="mt-4 block text-sm font-medium">
          Ingredients text (edit if anything is wrong)
        </label>
        <textarea
          id={fieldId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={hintId}
          dir="auto"
          rows={Math.min(10, Math.max(4, Math.ceil(text.length / 45) + 1))}
          maxLength={5000}
          className="mt-1 w-full resize-y rounded-xl border border-line bg-canvas/60 p-3 text-base leading-relaxed focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:outline-2"
        />
        {edited && (
          <p className="mt-1 text-xs text-muted">
            Your edited text will be used, and the ingredients re-interpreted from it.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onConfirm(text.trim())}
            disabled={!text.trim()}
            className="btn-primary h-12 flex-1 text-base"
          >
            {edited ? 'Check edited ingredients' : 'Looks right — check ingredients'}
          </button>
          <button type="button" onClick={onRetake} className="btn-secondary h-12">
            Retake
          </button>
        </div>
      </div>
    </section>
  )
}
