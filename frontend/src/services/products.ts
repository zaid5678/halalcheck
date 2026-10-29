import type { ApiErrorBody, Product, SearchResponse } from '../types/product'

// Empty by default so requests go to the same origin (the Vite dev proxy in development).
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '')

export class ApiError extends Error {
  readonly code: string
  readonly status: number

  constructor(code: string, message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
  }

  get isNotFound(): boolean {
    return this.code === 'not_found'
  }
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { Accept: 'application/json' },
      signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(
      'network_error',
      'Could not reach HalalCheck. Check your connection and try again.',
      0,
    )
  }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new ApiError(
      'invalid_response',
      'Something went wrong while loading this information. Please try again.',
      response.status,
    )
  }

  if (!response.ok) {
    const error = (body as Partial<ApiErrorBody> | null)?.error
    throw new ApiError(
      error?.code ?? 'unknown_error',
      error?.message ?? 'Something went wrong. Please try again.',
      response.status,
    )
  }
  return body as T
}

export function searchProducts(
  query: string,
  page = 1,
  signal?: AbortSignal,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query, page: String(page) })
  return request<SearchResponse>(`/api/products/search?${params}`, signal)
}

export function getProductByBarcode(barcode: string, signal?: AbortSignal): Promise<Product> {
  return request<Product>(`/api/products/barcode/${encodeURIComponent(barcode)}`, signal)
}
