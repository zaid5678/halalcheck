import type { ApiErrorBody } from '../types/product'

// Empty by default so requests go to the same origin (the Vite dev proxy in development).
// In production, set VITE_API_BASE_URL to the API's URL (e.g. the Render service).
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

interface RequestOptions {
  method?: 'GET' | 'POST'
  body?: BodyInit
  signal?: AbortSignal
  /** Abort and report a timeout after this many milliseconds. */
  timeoutMs?: number
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, timeoutMs } = options

  const controller = new AbortController()
  const abortFromCaller = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abortFromCaller)
  if (signal?.aborted) controller.abort(signal.reason)
  let timedOut = false
  const timer =
    timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          timedOut = true
          controller.abort()
        }, timeoutMs)

  try {
    let response: Response
    try {
      response = await fetch(`${API_BASE_URL}${path}`, {
        method,
        body,
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      })
    } catch (error) {
      if (timedOut) {
        throw new ApiError(
          'request_timeout',
          'This is taking too long. Please check your connection and try again.',
          0,
        )
      }
      if (error instanceof DOMException && error.name === 'AbortError') throw error
      throw new ApiError(
        'network_error',
        'Could not reach HalalCheck. Check your connection and try again.',
        0,
      )
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throw new ApiError(
        'invalid_response',
        'Something went wrong while loading this information. Please try again.',
        response.status,
      )
    }

    if (!response.ok) {
      const error = (payload as Partial<ApiErrorBody> | null)?.error
      throw new ApiError(
        error?.code ?? 'unknown_error',
        error?.message ?? 'Something went wrong. Please try again.',
        response.status,
      )
    }
    return payload as T
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abortFromCaller)
  }
}
