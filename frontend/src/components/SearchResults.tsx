import { useRequest } from '../hooks/useRequest'
import { searchProducts } from '../services/products'
import { ProductCard } from './ProductCard'
import { EmptyState, ErrorState, Spinner } from './StatusMessages'

const MAX_PAGES = 100

interface SearchResultsProps {
  query: string
  page: number
  onPageChange: (page: number) => void
}

export function SearchResults({ query, page, onPageChange }: SearchResultsProps) {
  const result = useRequest(`${query}\u0000${page}`, (signal) =>
    searchProducts(query, page, signal),
  )

  if (result.status === 'idle' || result.status === 'loading') {
    return <Spinner label="Searching products…" />
  }

  if (result.status === 'error') {
    return (
      <ErrorState
        title="Search isn't working right now"
        message={result.error.message}
        onRetry={result.retry}
      />
    )
  }

  const { products, total, page_size: pageSize } = result.data
  if (products.length === 0) {
    return (
      <EmptyState title={`No products found for “${query}”`}>
        <p>Try a shorter name, a different spelling, or the brand name. You can also scan the barcode.</p>
      </EmptyState>
    )
  }

  // The API serves at most MAX_PAGES pages; beyond that, users should refine their search.
  const totalPages = Math.min(MAX_PAGES, Math.max(1, Math.ceil(total / pageSize)))
  const firstShown = (page - 1) * pageSize + 1

  return (
    <section aria-labelledby="results-heading">
      <h2 id="results-heading" className="text-sm text-muted" aria-live="polite">
        Showing {firstShown}–{firstShown + products.length - 1} of {total.toLocaleString()} results
        for <span className="font-medium text-ink">“{query}”</span>
      </h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {products.map((product) => (
          <li key={product.barcode}>
            <ProductCard product={product} />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <nav aria-label="Search results pages" className="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            className="btn-secondary"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </button>
          <span className="text-sm text-muted">
            Page {page} of {totalPages.toLocaleString()}
          </span>
          <button
            type="button"
            className="btn-secondary"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </button>
        </nav>
      )}
    </section>
  )
}
