import type { ApiErrorBody } from '../types/product'

/**
 * The API's origin, e.g. "https://halalcheck-api.onrender.com". Paths already start with /api,
 * so a trailing slash or "/api" in the configured value is removed to avoid "/api/api/...".
 */
export function normaliseApiBaseUrl(raw: string | undefined): string {
  return (raw ?? '').trim().replace(/\/+$/, '').replace(/\/api$/i, '')
}

// Empty by default so requests go to the same origin (the Vite dev proxy in development).
// In production, set VITE_API_BASE_URL to the API's URL (e.g. the Render service).
const API_BASE_URL = normaliseApiBaseUrl(import.meta.env.VITE_API_BASE_URL)

if (import.meta.env.PROD && !API_BASE_URL) {
  console.warn(
    'HalalCheck: VITE_API_BASE_URL was not set when this site was built, so API requests go to ' +
      'this site itself. Set it to the backend URL and redeploy.',
  )
}

const SERVER_UNREACHABLE_MESSAGE =
  'HalalCheck couldn’t reach its server. Please try again later.'

/** The request reached something other than the HalalCheck API (wrong or missing API URL). */
function misconfigured(status: number, detail: string): ApiError {
  console.error(
    `HalalCheck: ${detail} Check VITE_API_BASE_URL (currently "${API_BASE_URL || '(not set)'}") ` +
      'and redeploy the frontend after changing it.',
  )
  return new ApiError('api_unreachable', SERVER_UNREACHABLE_MESSAGE, status)
}

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

    // An HTML page means the request hit the website (or a host's error page), not the API.
    if ((response.headers.get('content-type') ?? '').includes('text/html')) {
      throw misconfigured(response.status, `${path} returned a web page instead of API data.`)
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
      if (!error?.code && (response.status === 404 || response.status === 405)) {
        // A bare {"detail": "Not Found"} comes from a server without this route.
        throw misconfigured(response.status, `${path} does not exist on the API server.`)
      }
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
