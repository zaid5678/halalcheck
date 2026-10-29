// Mirrors the FastAPI response models in backend/app/models/product.py.

export interface ProductSummary {
  /** Always a string: leading zeros are significant. */
  barcode: string
  name: string | null
  brands: string[]
  image_url: string | null
}

export interface Product extends ProductSummary {
  ingredients_text: string | null
  categories: string[]
  countries: string[]
  labels: string[]
  /** Halal-related labels as recorded by the data source. Empty means "no information". */
  halal_labels: string[]
  source_url: string | null
}

export interface SearchResponse {
  query: string
  page: number
  page_size: number
  total: number
  products: ProductSummary[]
}

export interface ApiErrorBody {
  error: { code: string; message: string }
}
