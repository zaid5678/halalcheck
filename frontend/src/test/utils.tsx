import { render } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { vi } from 'vitest'
import App from '../App'

export function renderApp(initialPath = '/') {
  return {
    user: userEvent.setup(),
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <App />
      </MemoryRouter>,
    ),
  }
}

type Route = (url: URL) => { status?: number; body: unknown } | undefined

/** Replace global fetch with a router over API paths. Returns the mock for assertions. */
export function mockApi(route: Route) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://localhost')
    const response = route(url)
    if (!response) throw new Error(`Unexpected request: ${url.pathname}${url.search}`)
    return new Response(JSON.stringify(response.body), {
      status: response.status ?? 200,
      headers: { 'Content-Type': 'application/json' },
    })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}
