import { screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { halalProduct, nutellaProduct, sparseProduct } from './fixtures'
import { mockApi, renderApp } from './utils'

function halalSection() {
  return screen.getByRole('region', { name: 'Halal certification' })
}

describe('product details', () => {
  it('shows the available product information', async () => {
    mockApi(() => ({ body: nutellaProduct }))
    renderApp('/product/0098008952506')

    expect(await screen.findByRole('heading', { level: 1, name: 'Nutella' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Nutella' })).toHaveAttribute(
      'src',
      nutellaProduct.image_url,
    )
    expect(screen.getByText('Ferrero')).toBeInTheDocument()
    expect(screen.getByText('0098008952506')).toBeInTheDocument()
    expect(screen.getByText('hazelnuts', { selector: 'strong' })).toBeInTheDocument()
    expect(screen.getByText('Hazelnut spreads')).toBeInTheDocument()
    expect(screen.getByText('United Kingdom')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /opens in a new tab/i })).toHaveAttribute(
      'href',
      nutellaProduct.source_url,
    )
  })

  it('treats missing halal data as unknown, not as a negative result', async () => {
    mockApi(() => ({ body: nutellaProduct }))
    renderApp('/product/0098008952506')
    await screen.findByRole('heading', { level: 1 })

    const section = halalSection()
    expect(section).toHaveTextContent('No halal certification information available')
    expect(section).toHaveTextContent('This doesn’t mean the product isn’t halal')
    expect(document.body).not.toHaveTextContent(/\bharam\b|not halal\b/i)
  })

  it('shows halal labels exactly as supplied, with context', async () => {
    mockApi(() => ({ body: halalProduct }))
    renderApp('/product/3436598133214')
    await screen.findByRole('heading', { level: 1 })

    const section = halalSection()
    const labels = within(section).getAllByRole('listitem').map((item) => item.textContent)
    expect(labels).toEqual(['Halal', 'Contrôle de la mosquée d’Évry'])
    expect(section).toHaveTextContent(/haven’t been verified by HalalCheck/)
  })

  it('shows placeholders for missing fields', async () => {
    mockApi(() => ({ body: sparseProduct }))
    renderApp('/product/12345678')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Unnamed product' }),
    ).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'No product image available' })).toBeInTheDocument()
    expect(screen.getByText('Brand not listed')).toBeInTheDocument()
    expect(screen.getByText(/no ingredients list is available/i)).toBeInTheDocument()
    expect(screen.getByText(/no categories listed/i)).toBeInTheDocument()
    expect(screen.getByText(/no country or market information/i)).toBeInTheDocument()
  })

  it('handles unknown barcodes', async () => {
    mockApi(() => ({
      status: 404,
      body: { error: { code: 'not_found', message: 'No product with this barcode was found.' } },
    }))
    renderApp('/product/5000000000017')

    expect(await screen.findByRole('heading', { name: 'Product not found' })).toBeInTheDocument()
    expect(screen.getByText('5000000000017')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('explains that barcode lookup is not available yet', async () => {
    mockApi(() => ({
      status: 501,
      body: {
        error: { code: 'product_lookup_unavailable', message: 'Product lookup isn’t available yet.' },
      },
    }))
    renderApp('/product/0012345678905')

    expect(
      await screen.findByRole('heading', { name: 'Product lookup is coming soon' }),
    ).toBeInTheDocument()
    expect(screen.getByText('0012345678905')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Scan ingredients' })).toHaveAttribute(
      'href',
      '/ingredients',
    )
  })

  it('rejects invalid barcodes in the URL without calling the API', async () => {
    const fetchMock = mockApi(() => undefined)
    renderApp('/product/abc')

    expect(screen.getByRole('alert')).toHaveTextContent(/doesn’t look like a barcode/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('manual barcode entry', () => {
  it('validates input and opens the product, preserving leading zeros', async () => {
    const fetchMock = mockApi(() => ({ body: { ...sparseProduct, barcode: '0012345678905' } }))
    const { user } = renderApp()

    await user.click(screen.getByRole('button', { name: 'Enter barcode' }))
    const input = screen.getByRole('textbox', { name: 'Barcode number' })

    await user.type(input, '12ab')
    await user.click(screen.getByRole('button', { name: 'Look up' }))
    expect(screen.getByRole('alert')).toHaveTextContent(/only contain digits/)
    expect(input).toHaveAttribute('aria-invalid', 'true')

    await user.clear(input)
    await user.type(input, '0012345678905{Enter}')

    await screen.findByRole('heading', { level: 1 })
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/products/barcode/0012345678905')
  })
})
