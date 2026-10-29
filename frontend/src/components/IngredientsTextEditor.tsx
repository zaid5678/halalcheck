import { useId, useState } from 'react'

interface IngredientsTextEditorProps {
  initialText: string
  onRerun: (text: string) => void
}

/** Shows the ingredients the AI read from the label and lets users correct them and re-check. */
export function IngredientsTextEditor({ initialText, onRerun }: IngredientsTextEditorProps) {
  const [text, setText] = useState(initialText)
  const fieldId = useId()
  const hintId = useId()
  const trimmed = text.trim()
  const edited = trimmed !== initialText.trim()

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="font-semibold">
        <label htmlFor={fieldId}>What we read</label>
      </h2>
      <p id={hintId} className="mt-1 text-sm text-muted">
        Read by AI from your photo. Check it matches the pack, fix any mistakes, then re-check.
      </p>
      <textarea
        id={fieldId}
        value={text}
        onChange={(event) => setText(event.target.value)}
        aria-describedby={hintId}
        dir="auto"
        rows={Math.min(12, Math.max(4, Math.ceil(text.length / 45) + 1))}
        maxLength={5000}
        className="mt-3 w-full resize-y rounded-xl border border-line bg-canvas/60 p-3 text-base leading-relaxed focus:border-brand-500 focus:bg-surface focus:outline-none focus-visible:outline-2"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onRerun(trimmed)}
          disabled={!edited || !trimmed}
          className="btn-primary"
        >
          Edit and re-check
        </button>
        {edited && (
          <button type="button" onClick={() => setText(initialText)} className="btn-secondary">
            Undo my changes
          </button>
        )}
      </div>
    </section>
  )
}
