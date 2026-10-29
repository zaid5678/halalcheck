import { useId, useState, type FormEvent } from 'react'
import { BARCODE_MAX_LENGTH, validateBarcode } from '../lib/barcode'

interface ManualBarcodeEntryProps {
  onSubmit: (barcode: string) => void
  autoFocus?: boolean
}

export function ManualBarcodeEntry({ onSubmit, autoFocus = false }: ManualBarcodeEntryProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()
  const hintId = useId()
  const errorId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const result = validateBarcode(value)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    onSubmit(result.barcode)
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Enter a barcode">
      <label htmlFor={inputId} className="block text-sm font-medium">
        Barcode number
      </label>
      <p id={hintId} className="text-sm text-muted">
        The digits printed under the barcode, usually 8 or 13.
      </p>
      <div className="mt-2 flex gap-2">
        {/* type="text" rather than "number" so leading zeros are never dropped. */}
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="go"
          // Allow room for spaces or hyphens typed from the packaging.
          maxLength={BARCODE_MAX_LENGTH + 6}
          autoFocus={autoFocus}
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            if (error) setError(null)
          }}
          placeholder="e.g. 5000112637922"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${hintId} ${errorId}` : hintId}
          className="h-12 w-full min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 font-mono text-base tracking-wide placeholder:font-sans placeholder:tracking-normal placeholder:text-muted/80 focus:border-brand-500 focus:outline-none focus-visible:outline-2"
        />
        <button type="submit" className="btn-primary h-12 px-5">
          Look up
        </button>
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-sm text-danger-700">
          {error}
        </p>
      )}
    </form>
  )
}
