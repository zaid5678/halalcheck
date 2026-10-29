import { screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { nutellaProduct, nutellaSearch } from './fixtures'
import { mockApi, renderApp } from './utils'

describe('product search', () => {
  it('searches on Enter, shows results and opens product details', async () => {
    const fetchMock = mockApi((url) => {
      if (url.pathname === '/api/products/search') return { body: nutellaSearch }
      if (url.pathname === `/api/products/barcode/${nutellaProduct.barcode}`) {
        return { body: nutellaProduct }
      }
    })
    const { user } = renderApp()

    const input = screen.getByRole('searchbox', { name: /search for a product or brand/i })
    await user.type(input, 'nutella')
    // Submit-based: typing alone must not trigger requests.
    expect(fetchMock).not.toHaveBeenCalled()
    await user.keyboard('{Enter}')

    const results = await screen.findByRole('list')
    const cards = within(results).getAllByRole('link')
    expect(cards).toHaveLength(2)
    expect(cards[0]).toHaveTextContent('Nutella')
    expect(cards[0]).toHaveTextContent('Ferrero')
    expect(cards[0]).toHaveTextContent('0098008952506')
    expect(cards[1]).toHaveTextContent('Unnamed product')
    expect(cards[1]).toHaveTextContent('Brand not listed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain('q=nutella')

    await user.click(cards[0])

    expect(await screen.findByRole('heading', { level: 1, name: 'Nutella' })).toBeInTheDocument()
    expect(String(fetchMock.mock.calls[1][0])).toContain('/api/products/barcode/0098008952506')
  })

  it('searches with the button and validates very short queries', async () => {
    const fetchMock = mockApi(() => ({ body: nutellaSearch }))
    const { user } = renderApp()

    await user.type(screen.getByRole('searchbox'), 'n')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(screen.getByText(/at least 2 characters/i)).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.type(screen.getByRole('searchbox'), 'u')
    await user.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
  })

  it('shows an empty state when nothing matches', async () => {
    mockApi(() => ({ body: { ...nutellaSearch, total: 0, products: [] } }))
    renderApp('/?q=zzzz')

    expect(await screen.findByText(/no products found for “zzzz”/i)).toBeInTheDocument()
  })

  it('shows API errors and retries', async () => {
    let calls = 0
    mockApi(() => {
      calls += 1
      return calls === 1
        ? {
            status: 503,
            body: {
              error: {
                code: 'upstream_unavailable',
                message: 'The product database is currently unavailable.',
              },
            },
          }
        : { body: nutellaSearch }
    })
    const { user } = renderApp('/?q=nutella')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The product database is currently unavailable.')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findAllByRole('listitem')).toHaveLength(2)
  })

  it('handles network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    renderApp('/?q=nutella')

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach halalcheck/i)
  })
})
