import type { ReactNode } from 'react'
import type { Product } from '../types/product'
import { BadgeIcon, ExternalLinkIcon, InfoIcon } from './icons'
import { ProductImage } from './ProductImage'

export function ProductDetails({ product }: { product: Product }) {
  const name = product.name ?? 'Unnamed product'

  return (
    <article className="space-y-4">
      <header className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-4 sm:flex-row sm:items-center sm:p-6">
        <ProductImage
          src={product.image_url}
          alt={name}
          className="mx-auto aspect-square w-40 shrink-0 rounded-xl border border-line sm:mx-0 sm:w-36"
        />
        <div className="min-w-0 text-center sm:text-left">
          <h1 className={`text-2xl leading-tight font-bold ${product.name ? '' : 'text-muted'}`}>
            {name}
          </h1>
          <p className="mt-1 text-muted">
            {product.brands.length > 0 ? product.brands.join(', ') : 'Brand not listed'}
          </p>
          <p className="mt-2 inline-block rounded-md bg-canvas px-2 py-1 font-mono text-sm text-muted">
            <span className="sr-only">Barcode: </span>
            {product.barcode}
          </p>
        </div>
      </header>

      <HalalCertification labels={product.halal_labels} />

      <Section title="Ingredients">
        {product.ingredients_text ? (
          <p className="leading-relaxed">
            <IngredientsText text={product.ingredients_text} />
          </p>
        ) : (
          <Missing>No ingredients list is available for this product.</Missing>
        )}
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Categories">
          <TagList items={product.categories} emptyText="No categories listed." />
        </Section>
        <Section title="Sold in">
          <TagList items={product.countries} emptyText="No country or market information." />
        </Section>
      </div>

      <Section title="All labels">
        <TagList items={product.labels} emptyText="No labels listed." />
      </Section>

      <footer className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 sm:p-5">
        <p>
          Product information may be incomplete or out of date. Always check the packaging.
          {product.source_url && (
            <>
              {' '}
              <a
                href={product.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
              >
                View the source record
                <ExternalLinkIcon className="size-3.5" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </>
          )}
        </p>
      </footer>
    </article>
  )
}

function HalalCertification({ labels }: { labels: string[] }) {
  const hasInfo = labels.length > 0

  return (
    <section
      aria-labelledby="halal-heading"
      className={`rounded-2xl border p-4 sm:p-6 ${hasInfo ? 'border-brand-200 bg-surface' : 'border-line bg-surface'}`}
    >
      <div className="flex items-start gap-3">
        {hasInfo ? (
          <BadgeIcon className="mt-0.5 size-6 shrink-0 text-brand-600" />
        ) : (
          <InfoIcon className="mt-0.5 size-6 shrink-0 text-muted" />
        )}
        <div className="min-w-0">
          <h2 id="halal-heading" className="font-semibold">
            Halal certification
          </h2>
          {hasInfo ? (
            <>
              <p className="mt-1 text-sm text-muted">
                These halal-related labels are recorded for this product:
              </p>
              <ul className="mt-3 flex flex-wrap gap-2">
                {labels.map((label) => (
                  <li
                    key={label}
                    className="rounded-lg bg-brand-100 px-3 py-1 text-sm font-medium text-brand-800"
                  >
                    {label}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm text-muted">
                These labels come from the product database and haven’t been verified by HalalCheck. Check the certification mark on the packaging and with the certifying
                body.
              </p>
            </>
          ) : (
            <>
              <p className="mt-1 font-medium">No halal certification information available</p>
              <p className="mt-1 text-sm text-muted">
                This doesn’t mean the product isn’t halal. No halal label has been recorded for it
                yet. Check the packaging for a certification mark.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  )
}

/** Product databases such as Open Food Facts mark allergens with underscores ("_wheat_ flour").
 * Show them in bold. */
function IngredientsText({ text }: { text: string }) {
  const parts = text.split(/_([^_]+)_/g)
  return parts.map((part, index) =>
    index % 2 === 1 ? (
      <strong key={index} className="font-semibold">
        {part}
      </strong>
    ) : (
      part
    ),
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  )
}

function Missing({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted italic">{children}</p>
}

function TagList({ items, emptyText }: { items: string[]; emptyText: string }) {
  if (items.length === 0) return <Missing>{emptyText}</Missing>
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((item) => (
        <li key={item} className="rounded-lg bg-canvas px-3 py-1 text-sm">
          {item}
        </li>
      ))}
    </ul>
  )
}
