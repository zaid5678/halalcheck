import { useId, useState, type FormEvent } from 'react'
import { SearchIcon } from './icons'

export const MIN_QUERY_LENGTH = 2

interface ProductSearchProps {
  initialQuery: string
  onSearch: (query: string) => void
}

/** Submit-based search: a request is only made on Enter or the Search button, never per keystroke. */
export function ProductSearch({ initialQuery, onSearch }: ProductSearchProps) {
  const [query, setQuery] = useState(initialQuery)
  const [error, setError] = useState<string | null>(null)
  const errorId = useId()

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setError(`Type at least ${MIN_QUERY_LENGTH} characters to search.`)
      return
    }
    setError(null)
    onSearch(trimmed)
  }

  return (
    <form role="search" onSubmit={handleSubmit} noValidate>
      <label htmlFor="product-search" className="sr-only">
        Search for a product or brand
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-muted" />
          <input
            id="product-search"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              if (error) setError(null)
            }}
            placeholder="Search for a product or brand"
            enterKeyHint="search"
            autoComplete="off"
            maxLength={100}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-13 w-full rounded-xl border border-line bg-surface pr-3 pl-12 text-base shadow-sm placeholder:text-muted/80 focus:border-brand-500 focus:outline-none focus-visible:outline-2"
          />
        </div>
        <button type="submit" className="btn-primary h-13 px-5">
          Search
        </button>
      </div>
      {error && (
        <p id={errorId} className="mt-2 text-sm text-danger-700">
          {error}
        </p>
      )}
    </form>
  )
}
