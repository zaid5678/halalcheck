import { lazy, Suspense, useCallback, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { KeypadIcon, ScanIcon } from '../components/icons'
import { ManualBarcodeEntry } from '../components/ManualBarcodeEntry'
import { ProductSearch } from '../components/ProductSearch'
import { SearchResults } from '../components/SearchResults'

// The barcode library is large, so it is only downloaded when someone opens the scanner.
const BarcodeScanner = lazy(() =>
  import('../components/BarcodeScanner').then((m) => ({ default: m.BarcodeScanner })),
)

export function HomePage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [scannerOpen, setScannerOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)

  const query = searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const openProduct = useCallback(
    (barcode: string) => navigate(`/product/${barcode}`),
    [navigate],
  )
  const closeScanner = useCallback(() => setScannerOpen(false), [])
  const handleDetected = useCallback(
    (barcode: string) => {
      setScannerOpen(false)
      openProduct(barcode)
    },
    [openProduct],
  )
  const switchToManualEntry = useCallback(() => {
    setScannerOpen(false)
    setManualOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      <section className="space-y-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check a product</h1>
          <p className="mt-1 text-muted">
            Search by name or brand, or scan the barcode to see ingredients and any halal
            certification information.
          </p>
        </div>

        {/* Keyed by the query so the input resets when the URL changes (e.g. back/forward). */}
        <ProductSearch key={query} initialQuery={query} onSearch={(q) => setSearchParams({ q })} />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="btn-primary h-14 gap-2 text-base"
          >
            <ScanIcon className="size-5" />
            Scan barcode
          </button>
          <button
            type="button"
            onClick={() => setManualOpen((open) => !open)}
            aria-expanded={manualOpen}
            aria-controls="manual-entry"
            className="btn-secondary h-14 gap-2 text-base"
          >
            <KeypadIcon className="size-5" />
            Enter barcode
          </button>
        </div>

        {manualOpen && (
          <div id="manual-entry" className="rounded-2xl border border-line bg-surface p-4">
            <ManualBarcodeEntry onSubmit={openProduct} autoFocus />
          </div>
        )}
      </section>

      {query && (
        <SearchResults
          query={query}
          page={page}
          onPageChange={(next) => {
            setSearchParams({ q: query, page: String(next) })
            window.scrollTo({ top: 0, behavior: 'smooth' })
          }}
        />
      )}

      {scannerOpen && (
        <Suspense
          fallback={
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black text-white">
              <p role="status">Opening scanner…</p>
            </div>
          }
        >
          <BarcodeScanner
            onDetected={handleDetected}
            onClose={closeScanner}
            onManualEntry={switchToManualEntry}
          />
        </Suspense>
      )}
    </div>
  )
}
