import { useState } from 'react'
import { PackageIcon } from './icons'

interface ProductImageProps {
  src: string | null
  alt: string
  className?: string
}

export function ProductImage({ src, alt, className = '' }: ProductImageProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)

  if (!src || failedSrc === src) {
    return (
      <div
        role="img"
        aria-label="No product image available"
        className={`flex flex-col items-center justify-center gap-1 bg-brand-50 text-brand-600/60 ${className}`}
      >
        <PackageIcon className="size-1/3 max-h-12 max-w-12" />
        <span className="text-[11px] font-medium">No image</span>
      </div>
    )
  }

  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => setFailedSrc(src)}
      className={`bg-white object-contain ${className}`}
    />
  )
}
