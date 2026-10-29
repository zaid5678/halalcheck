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

describe('halal check', () => {
  it('shows the verdict and its reasons above the product details', async () => {
    mockApi((url) =>
      url.pathname.startsWith('/api/halal/')
        ? {
            body: {
              verdict: 'haram',
              reasons: [
                { ingredient: 'gelatine', ruling: 'doubtful', note: 'Source not stated' },
                { ingredient: 'pork fat', ruling: 'haram', note: 'Pork or pork-derived' },
              ],
              ingredients_text: 'sugar, pork fat, gelatine',
              ai_checked: false,
              product: null,
            },
          }
        : { body: nutellaProduct },
    )
    renderApp('/product/0098008952506')

    const check = await screen.findByRole('region', { name: 'Halal check' })
    expect(within(check).getByRole('heading', { name: 'Haram' })).toBeInTheDocument()
    expect(check).toHaveTextContent('1 haram ingredient found')
    expect(check).toHaveTextContent('not a fatwa or certification')
    // Haram reasons come first; a rules-only haram result isn't reported as an AI outage.
    const names = within(check).getAllByRole('listitem').map((item) => item.querySelector('p')?.textContent)
    expect(names).toEqual(['pork fat', 'gelatine'])
    expect(check).not.toHaveTextContent('AI check unavailable')
    expect(screen.getByRole('heading', { level: 1, name: 'Nutella' })).toBeInTheDocument()
  })

  it('asks for a photo instead of a verdict when ingredients are missing', async () => {
    mockApi((url) =>
      url.pathname.startsWith('/api/halal/')
        ? {
            body: {
              verdict: 'doubtful',
              reasons: [{ ingredient: 'Ingredients', ruling: 'doubtful', note: 'Ingredients are not available for this product' }],
              ingredients_text: null,
              ai_checked: false,
              product: null,
            },
          }
        : { body: nutellaProduct },
    )
    const { user } = renderApp('/product/0098008952506')

    const prompt = await screen.findByRole('region', { name: 'Photo needed' })
    expect(prompt).toHaveTextContent('We need a photo to check this')
    expect(prompt).toHaveTextContent('We found Nutella')
    expect(screen.queryByRole('region', { name: 'Halal check' })).not.toBeInTheDocument()
    expect(screen.queryByText('Doubtful')).not.toBeInTheDocument()

    await user.click(within(prompt).getByRole('link', { name: 'Photograph the ingredients' }))
    expect(await screen.findByRole('heading', { level: 1 })).not.toHaveTextContent('Nutella')
  })
})
