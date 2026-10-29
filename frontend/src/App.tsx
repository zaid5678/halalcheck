import { Link, Route, Routes } from 'react-router'
import { EmptyState } from './components/StatusMessages'
import { HomePage } from './pages/HomePage'
import { ProductPage } from './pages/ProductPage'

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-lg bg-surface px-4 py-2 focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50"
      >
        Skip to content
      </a>
      <header className="border-b border-line bg-surface/80 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center px-4">
          <Link to="/" className="flex items-center gap-2 rounded-lg font-bold">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="text-lg tracking-tight">
              Halal<span className="text-brand-600">Check</span>
            </span>
          </Link>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-10">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/product/:barcode" element={<ProductPage />} />
          <Route
            path="*"
            element={
              <EmptyState title="Page not found">
                <Link to="/" className="font-semibold text-brand-700 underline">
                  Go to search
                </Link>
              </EmptyState>
            }
          />
        </Routes>
      </main>

      <footer className="border-t border-line py-6 text-center text-xs text-muted">
        <p className="mx-auto max-w-5xl px-4">
          Product data from{' '}
          <a
            href="https://world.openfoodfacts.org/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Open Food Facts
          </a>{' '}
          (ODbL). HalalCheck does not certify products as halal.
        </p>
      </footer>
    </div>
  )
}
