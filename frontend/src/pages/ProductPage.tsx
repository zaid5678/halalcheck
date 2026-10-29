import { Link, useNavigate, useParams } from 'react-router'
import { ArrowLeftIcon, CameraIcon } from '../components/icons'
import { ProductDetails } from '../components/ProductDetails'
import { VerdictCard } from '../components/VerdictCard'
import { EmptyState, ErrorState, Spinner } from '../components/StatusMessages'
import { useRequest } from '../hooks/useRequest'
import { validateBarcode } from '../lib/barcode'
import { checkBarcode } from '../services/halal'
import { getProductByBarcode, PRODUCT_LOOKUP_UNAVAILABLE } from '../services/products'

export function ProductPage() {
  const { barcode: rawBarcode = '' } = useParams()
  const navigate = useNavigate()
  const validation = validateBarcode(rawBarcode)
  const barcode = validation.ok ? validation.barcode : null

  const result = useRequest(barcode, (signal) => getProductByBarcode(barcode!, signal))
  const check = useRequest(barcode, (signal) => checkBarcode(barcode!, signal))

  function goBack() {
    // Return to the search results if we came from them; otherwise go home.
    if (window.history.state?.idx > 0) navigate(-1)
    else navigate('/')
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={goBack}
        className="-ml-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
      >
        <ArrowLeftIcon className="size-5" />
        Back
      </button>

      {!validation.ok && (
        <ErrorState title="That doesn’t look like a barcode" message={validation.error}>
          <Link to="/" className="btn-secondary">
            Search again
          </Link>
        </ErrorState>
      )}

      {result.status === 'loading' && <Spinner label="Looking up product…" />}

      {result.status === 'error' && result.error.code === PRODUCT_LOOKUP_UNAVAILABLE && (
        <EmptyState title="Product lookup is coming soon">
          <p>
            Barcode <span className="font-mono text-ink">{barcode}</span> was read, but product
            information isn’t available in HalalCheck yet. You can scan the ingredients list
            instead.
          </p>
          <Link to="/ingredients" className="btn-primary mt-4 gap-2">
            <CameraIcon className="size-5" />
            Scan ingredients
          </Link>
        </EmptyState>
      )}

      {result.status === 'error' && result.error.isNotFound && (
        <EmptyState title="Product not found">
          <p>
            No product with barcode <span className="font-mono text-ink">{barcode}</span> was
            found. Check the number, or scan the ingredients list instead.
          </p>
          <Link to="/ingredients" className="btn-secondary mt-4">
            Scan ingredients
          </Link>
        </EmptyState>
      )}

      {result.status === 'error' &&
        !result.error.isNotFound &&
        result.error.code !== PRODUCT_LOOKUP_UNAVAILABLE && (
        <ErrorState
          title="Couldn’t load this product"
          message={result.error.message}
          onRetry={result.retry}
        />
      )}

      {result.status === 'success' && (
        <>
          {check.status === 'loading' && <Spinner label="Checking ingredients…" />}
          {check.status === 'error' && (
            <ErrorState
              title="Couldn’t check this product"
              message={check.error.message}
              onRetry={check.retry}
            />
          )}
          {check.status === 'success' && check.data.ingredients_text && (
            <VerdictCard result={check.data} />
          )}
          {check.status === 'success' && !check.data.ingredients_text && (
            <section
              aria-label="Photo needed"
              className="rounded-2xl border border-line bg-surface p-5 text-center"
            >
              <CameraIcon className="mx-auto size-7 text-brand-600" />
              <h2 className="mt-2 text-xl font-bold">We need a photo to check this</h2>
              <p className="mt-1 text-muted">
                We found {result.data.name ?? 'this product'}, but its ingredients aren’t in our
                database.
              </p>
              <Link to="/ingredients" className="btn-primary mt-4 h-14 w-full gap-2 text-base">
                <CameraIcon className="size-5" />
                Photograph the ingredients
              </Link>
            </section>
          )}
          <ProductDetails product={result.data} />
        </>
      )}
    </div>
  )
}
