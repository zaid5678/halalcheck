import type { Product, SearchResponse } from '../types/product'
import { apiRequest } from './api'

export { ApiError } from './api'

/** Returned by the API until a product data source is connected. */
export const PRODUCT_LOOKUP_UNAVAILABLE = 'product_lookup_unavailable'

export function searchProducts(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, page: String(page) })
  return apiRequest<SearchResponse>(`/api/products/search?${params}`, { signal })
}

export function getProductByBarcode(barcode: string, signal?: AbortSignal): Promise<Product> {
  return apiRequest<Product>(`/api/products/barcode/${encodeURIComponent(barcode)}`, { signal })
}
