import { Link } from 'react-router'
import type { ProductSummary } from '../types/product'
import { ProductImage } from './ProductImage'

export function ProductCard({ product }: { product: ProductSummary }) {
  const name = product.name ?? 'Unnamed product'

  return (
    <Link
      to={`/product/${product.barcode}`}
      className="flex h-full items-center gap-4 rounded-2xl border border-line bg-surface p-3 transition-colors hover:border-brand-200 hover:bg-brand-50/40"
    >
      <ProductImage
        src={product.image_url}
        alt={name}
        className="size-20 shrink-0 rounded-xl border border-line"
      />
      <div className="min-w-0 flex-1">
        <h3 className={`line-clamp-2 font-semibold leading-snug ${product.name ? '' : 'text-muted'}`}>
          {name}
        </h3>
        <p className="mt-0.5 truncate text-sm text-muted">
          {product.brands.length > 0 ? product.brands.join(', ') : 'Brand not listed'}
        </p>
        <p className="mt-1 font-mono text-xs text-muted/80">
          <span className="sr-only">Barcode </span>
          {product.barcode}
        </p>
      </div>
    </Link>
  )
}
