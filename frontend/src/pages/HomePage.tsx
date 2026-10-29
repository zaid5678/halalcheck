import { lazy, Suspense, useCallback, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { CameraIcon, KeypadIcon, LabelTextIcon, ScanIcon, SearchIcon } from '../components/icons'
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
  // Product lookup isn't connected yet, so a scan just shows the barcode it read.
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null)

  const query = searchParams.get('q')?.trim() ?? ''
  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1)

  const openProduct = useCallback(
    (barcode: string) => navigate(`/product/${barcode}`),
    [navigate],
  )
  const closeScanner = useCallback(() => setScannerOpen(false), [])
  const handleDetected = useCallback((barcode: string) => {
    setScannerOpen(false)
    setScannedBarcode(barcode)
  }, [])
  const startScan = () => {
    setScannedBarcode(null)
    setScannerOpen(true)
  }
  const switchToManualEntry = useCallback(() => {
    setScannerOpen(false)
    setManualOpen(true)
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Check a product</h1>
        <p className="mt-1 text-muted">Search, scan a barcode, or scan an ingredients label.</p>
      </div>

      <FeatureCard
        icon={<SearchIcon className="size-5" />}
        title="Search a product"
        description="Find a product by name or brand."
      >
        {/* Keyed by the query so the input resets when the URL changes (e.g. back/forward). */}
        <ProductSearch key={query} initialQuery={query} onSearch={(q) => setSearchParams({ q })} />
      </FeatureCard>

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

      <div className="grid gap-4 md:grid-cols-2">
        <FeatureCard
          icon={<ScanIcon className="size-5" />}
          title="Scan a barcode"
          description="Look up a product using its barcode."
        >
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={startScan} className="btn-primary h-12 gap-1.5 px-3 whitespace-nowrap">
              <ScanIcon className="size-5" />
              Scan barcode
            </button>
            <button
              type="button"
              onClick={() => setManualOpen((open) => !open)}
              aria-expanded={manualOpen}
              aria-controls="manual-entry"
              className="btn-secondary h-12 gap-1.5 px-3 whitespace-nowrap"
            >
              <KeypadIcon className="size-5" />
              Enter barcode
            </button>
          </div>
          <div aria-live="polite">
            {scannedBarcode && (
              <div className="mt-4 rounded-xl bg-brand-50 p-4 text-center">
                <p className="text-sm font-medium text-brand-800">Barcode detected</p>
                <p className="mt-1 font-mono text-2xl font-semibold tracking-wider break-all text-ink">
                  {scannedBarcode}
                </p>
                <button type="button" onClick={startScan} className="btn-secondary mt-3 gap-1.5">
                  <ScanIcon className="size-5" />
                  Scan again
                </button>
              </div>
            )}
          </div>
          {manualOpen && (
            <div id="manual-entry" className="mt-4 border-t border-line pt-4">
              <ManualBarcodeEntry onSubmit={openProduct} autoFocus />
            </div>
          )}
        </FeatureCard>

        <FeatureCard
          icon={<LabelTextIcon className="size-5" />}
          title="Scan ingredients"
          description="Photograph an ingredients label for an AI halal assessment."
        >
          <Link to="/ingredients" className="btn-primary h-12 w-full gap-2">
            <CameraIcon className="size-5" />
            Scan ingredients
          </Link>
        </FeatureCard>
      </div>

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

interface FeatureCardProps {
  icon: ReactNode
  title: string
  description: string
  children: ReactNode
}

function FeatureCard({ icon, title, description, children }: FeatureCardProps) {
  return (
    <section className="flex flex-col rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="mb-4 flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold">{title}</h2>
          <p className="text-sm text-muted">{description}</p>
        </div>
      </div>
      <div className="mt-auto">{children}</div>
    </section>
  )
}
