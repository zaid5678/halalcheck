import { useCallback, useEffect, useState } from 'react'
import { ApiError } from '../services/products'

export type RequestState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError }

/**
 * Runs `fetcher` whenever `key` changes, cancelling stale requests. A null key means "do not
 * fetch". `retry` re-runs the request for the current key.
 */
export function useRequest<T>(
  key: string | null,
  fetcher: (signal: AbortSignal) => Promise<T>,
): RequestState<T> & { retry: () => void } {
  const [state, setState] = useState<RequestState<T>>({ status: 'idle' })
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (key === null) {
      setState({ status: 'idle' })
      return
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    fetcher(controller.signal).then(
      (data) => setState({ status: 'success', data }),
      (error: unknown) => {
        if (controller.signal.aborted) return
        setState({
          status: 'error',
          error:
            error instanceof ApiError
              ? error
              : new ApiError('unknown_error', 'Something went wrong. Please try again.', 0),
        })
      },
    )
    return () => controller.abort()
    // The fetcher is keyed by `key`; re-running on every new function identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])

  const retry = useCallback(() => setAttempt((n) => n + 1), [])
  return { ...state, retry }
}
