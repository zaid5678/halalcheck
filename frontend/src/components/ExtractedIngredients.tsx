import { useEffect, useId, useRef, useState } from 'react'
import type { IngredientsExtraction } from '../types/ingredients'
import { AlertIcon, CheckIcon, CopyIcon, InfoIcon } from './icons'

async function copyText(text: string, fallbackField: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy approach (e.g. clipboard permission denied).
  }
  if (!fallbackField) return false
  fallbackField.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  }
}

interface ExtractedIngredientsProps {
  result: IngredientsExtraction
}

export function ExtractedIngredients({ result }: ExtractedIngredientsProps) {
  const [text, setText] = useState(result.text)
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()
  const hintId = useId()
  const edited = text !== result.text

  useEffect(() => {
    if (copyStatus === 'idle') return
    const timer = setTimeout(() => setCopyStatus('idle'), 2500)
    return () => clearTimeout(timer)
  }, [copyStatus])

  async function handleCopy() {
    setCopyStatus((await copyText(text, textareaRef.current)) ? 'copied' : 'failed')
  }

  return (
    <section aria-labelledby={`${fieldId}-heading`} className="space-y-4">
      {result.low_confidence && (
        <div role="status" className="flex gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <AlertIcon className="mt-0.5 size-5 shrink-0" />
          <p>
            This photo was hard to read, so the text below may contain mistakes. Check it carefully
            against the packaging, or try a clearer photo.
          </p>
        </div>
      )}

      <div className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id={`${fieldId}-heading`} className="font-semibold">
            <label htmlFor={fieldId}>Ingredients text</label>
          </h2>
          {result.confidence !== null && (
            <span className="text-xs text-muted">
              Read with {Math.round(result.confidence)}% confidence
            </span>
          )}
        </div>
        <p id={hintId} className="mt-1 text-sm text-muted">
          Compare this with the label and fix any mistakes before you use it.
        </p>
        <textarea
          ref={textareaRef}
          id={fieldId}
          value={text}
          onChange={(event) => setText(event.target.value)}
          aria-describedby={hintId}
          rows={Math.min(14, Math.max(6, text.split('\n').length + 2))}
          spellCheck
          className="mt-3 w-full resize-y rounded-xl border border-line bg-canvas/60 p-3 text-base leading-relaxed focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:outline-2"
        />

        {result.uncertain_words.length > 0 && (
          <div className="mt-3">
            <p className="text-sm font-medium">Words to double-check</p>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Words to double-check">
              {result.uncertain_words.map((word) => (
                <li key={word} className="rounded-lg bg-amber-50 px-2.5 py-1 font-mono text-sm text-amber-900">
                  {word}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={handleCopy} className="btn-primary gap-2" disabled={!text.trim()}>
            {copyStatus === 'copied' ? <CheckIcon className="size-5" /> : <CopyIcon className="size-5" />}
            {copyStatus === 'copied' ? 'Copied' : 'Copy text'}
          </button>
          {edited && (
            <button type="button" onClick={() => setText(result.text)} className="btn-secondary">
              Undo my changes
            </button>
          )}
          <span aria-live="polite" className="text-sm text-muted">
            {copyStatus === 'copied' && 'Copied to clipboard.'}
            {copyStatus === 'failed' && 'Couldn’t copy automatically. Select the text and copy it.'}
          </span>
        </div>
      </div>

      <p className="flex gap-2 text-sm text-muted">
        <InfoIcon className="mt-0.5 size-4 shrink-0" />
        HalalCheck hasn’t assessed these ingredients. This is only the text read from your photo.
      </p>
    </section>
  )
}
