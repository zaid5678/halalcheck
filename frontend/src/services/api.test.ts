import { describe, expect, it, vi } from 'vitest'
import { ApiError, apiRequest, normaliseApiBaseUrl } from './api'

describe('normaliseApiBaseUrl', () => {
  it.each([
    [undefined, ''],
    ['', ''],
    ['https://halalcheck-api.onrender.com', 'https://halalcheck-api.onrender.com'],
    ['https://halalcheck-api.onrender.com/', 'https://halalcheck-api.onrender.com'],
    ['https://halalcheck-api.onrender.com/api', 'https://halalcheck-api.onrender.com'],
    ['https://halalcheck-api.onrender.com/api/', 'https://halalcheck-api.onrender.com'],
    ['  https://halalcheck-api.onrender.com/API  ', 'https://halalcheck-api.onrender.com'],
  ])('%j → %j', (raw, expected) => {
    expect(normaliseApiBaseUrl(raw)).toBe(expected)
  })
})

function respond(body: string, status: number, contentType: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response(body, { status, headers: { 'Content-Type': contentType } })),
  )
}

async function requestError(): Promise<ApiError> {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await apiRequest('/api/products/barcode/12345678')
  } catch (error) {
    return error as ApiError
  }
  throw new Error('expected the request to fail')
}

describe('apiRequest misconfiguration handling', () => {
  it('explains when the website answers instead of the API', async () => {
    respond('<!doctype html><html></html>', 200, 'text/html; charset=utf-8')

    const error = await requestError()

    expect(error.code).toBe('api_unreachable')
    expect(error.message).toBe('HalalCheck couldn’t reach its server. Please try again later.')
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('VITE_API_BASE_URL'))
  })

  it('explains when the API server has no such route', async () => {
    respond(JSON.stringify({ detail: 'Not Found' }), 404, 'application/json')

    expect((await requestError()).code).toBe('api_unreachable')
  })

  it('keeps the API’s own not-found errors', async () => {
    respond(
      JSON.stringify({ error: { code: 'not_found', message: 'No product found.' } }),
      404,
      'application/json',
    )

    const error = await requestError()

    expect(error.isNotFound).toBe(true)
    expect(error.message).toBe('No product found.')
  })
})
