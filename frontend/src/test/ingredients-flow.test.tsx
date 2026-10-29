import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngredientsExtraction } from '../types/ingredients'
import { mockApi, renderApp } from './utils'

const extraction: IngredientsExtraction = {
  text: 'INGREDIENTS: Wheat flour, sugar,\ngelatine (beef), emulsifier (E471).',
  confidence: 91.2,
  word_count: 9,
  uncertain_words: [],
  low_confidence: false,
}

function photo(name = 'label.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array(2048)], name, { type })
}

function uploadInput() {
  return screen.getByLabelText('Upload an image file') as HTMLInputElement
}

function cameraInput() {
  return screen.getByLabelText('Take a photo with your camera') as HTMLInputElement
}

function extractRoute(response: { status?: number; body: unknown }) {
  return mockApi((url) => (url.pathname === '/api/ingredients/extract' ? response : undefined))
}

describe('photograph ingredients', () => {
  it('is offered on the home page as a separate feature', async () => {
    const { user } = renderApp()

    expect(screen.getByRole('heading', { name: 'Search a product' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan a barcode' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Photograph ingredients' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Photograph ingredients' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Photograph ingredients' })).toBeInTheDocument()
  })

  it('uploads a photo, previews it, extracts editable text and copies it', async () => {
    const fetchMock = extractRoute({ body: extraction })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())

    expect(screen.getByRole('img', { name: /your photo of the ingredients label/i })).toBeInTheDocument()
    expect(screen.getByText('label.jpg')).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    const textarea = await screen.findByRole('textbox', { name: 'Ingredients text' })
    expect(textarea).toHaveValue(extraction.text)
    expect(screen.getByText('Read with 91% confidence')).toBeInTheDocument()

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/ingredients/extract')
    expect(init.method).toBe('POST')
    const sent = (init.body as FormData).get('image') as File
    expect(sent.name).toBe('label.jpg')

    // Users can correct OCR mistakes, undo, and copy the result.
    await user.clear(textarea)
    await user.type(textarea, 'Wheat flour, sugar')
    expect(screen.getByRole('button', { name: 'Undo my changes' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Copy text' }))
    expect(await navigator.clipboard.readText()).toBe('Wheat flour, sugar')
    expect(screen.getByText('Copied to clipboard.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Undo my changes' }))
    expect(textarea).toHaveValue(extraction.text)

    // Nothing on the page makes a halal or haram claim.
    expect(document.body).not.toHaveTextContent(/\bharam\b|is halal\b|not halal\b/i)
    expect(screen.getByText(/hasn’t assessed these ingredients/i)).toBeInTheDocument()
  })

  it('flags hard-to-read photos and words to double-check', async () => {
    extractRoute({
      body: { ...extraction, confidence: 48, low_confidence: true, uncertain_words: ['gelatlne', 'E47l'] },
    })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    expect(await screen.findByText(/this photo was hard to read/i)).toBeInTheDocument()
    const list = screen.getByRole('list', { name: 'Words to double-check' })
    expect(within(list).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'gelatlne',
      'E47l',
    ])
  })

  it('lets users replace the photo before submitting', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo('first.jpg'))
    expect(screen.getByText('first.jpg')).toBeInTheDocument()

    await user.upload(uploadInput(), photo('second.png', 'image/png'))
    expect(screen.getByText('second.png')).toBeInTheDocument()
    expect(revoke).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Retake' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose another' })).toBeInTheDocument()
  })

  it.each([
    ['animation.gif', 'image/gif', 'Please choose a JPEG, PNG or WebP image.'],
    ['IMG_1234.HEIC', 'image/heic', 'HEIC photos aren’t supported yet'],
  ])('rejects %s before uploading', async (name, type, message) => {
    const fetchMock = extractRoute({ body: extraction })
    renderApp('/ingredients')

    fireEvent.change(uploadInput(), { target: { files: [photo(name, type)] } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Read ingredients' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('explains when no text could be read', async () => {
    extractRoute({
      status: 422,
      body: {
        error: {
          code: 'no_text_found',
          message: 'We couldn’t read any text in this photo. Try again in good light.',
        },
      },
    })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('No text found')
    expect(alert).toHaveTextContent('We couldn’t read any text in this photo.')
    // Retrying the same unreadable photo won't help; offer a different one instead.
    expect(within(alert).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()

    await user.click(within(alert).getByRole('button', { name: 'Use a different photo' }))
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument()
  })

  it.each([
    [415, 'unsupported_image_type', 'Unsupported image'],
    [413, 'image_too_large', 'Image too large'],
  ])('shows server-side validation errors (%s)', async (status, code, title) => {
    extractRoute({ status, body: { error: { code, message: 'Server says no.' } } })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent('Server says no.')
  })

  it('retries the same photo after an OCR failure', async () => {
    let calls = 0
    mockApi(() => {
      calls += 1
      return calls === 1
        ? {
            status: 503,
            body: { error: { code: 'ocr_unavailable', message: 'Text recognition is unavailable.' } },
          }
        : { body: extraction }
    })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Text recognition is unavailable.')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('textbox', { name: 'Ingredients text' })).toHaveValue(extraction.text)
  })

  it('handles network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach halalcheck/i)
  })

  it('can cancel while processing', async () => {
    let aborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init: RequestInit) => {
        return new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            aborted = true
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })
      }),
    )
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))
    expect(await screen.findByText('Reading the label…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Read ingredients' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('taking a photo', () => {
  const track = { stop: vi.fn() }
  const getUserMedia = vi.fn()

  beforeEach(() => {
    track.stop.mockReset()
    getUserMedia.mockReset().mockResolvedValue({ getTracks: () => [track] })
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
  })

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    Reflect.deleteProperty(window, 'matchMedia')
  })

  it('uses the native camera on touch devices without requesting permission itself', async () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof window.matchMedia
    const { user } = renderApp('/ingredients')
    const click = vi.spyOn(cameraInput(), 'click')

    expect(cameraInput()).toHaveAttribute('capture', 'environment')
    expect(cameraInput()).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    await user.click(screen.getByRole('button', { name: 'Take photo' }))

    expect(click).toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()

    await user.upload(cameraInput(), photo('IMG_0001.jpg'))
    expect(screen.getByText('Photo taken')).toBeInTheDocument()
  })

  it('opens an in-page camera on computers and releases it when cancelled', async () => {
    const { user } = renderApp('/ingredients')
    expect(getUserMedia).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Take photo' }))

    const dialog = await screen.findByRole('dialog', { name: 'Photograph ingredients' })
    expect(await within(dialog).findByText(/fill the frame/i)).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(track.stop).toHaveBeenCalled()
  })

  it('offers upload when camera permission is denied', async () => {
    getUserMedia.mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
    const { user } = renderApp('/ingredients')
    const uploadClick = vi.spyOn(uploadInput(), 'click')

    await user.click(screen.getByRole('button', { name: 'Take photo' }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Camera access was blocked')

    await user.click(within(alert).getByRole('button', { name: 'Upload a photo' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(uploadClick).toHaveBeenCalled()
  })

  it('stops a camera that starts after the dialog was closed', async () => {
    let resolveStream!: (stream: unknown) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => (resolveStream = resolve)))
    const { user } = renderApp('/ingredients')

    await user.click(screen.getByRole('button', { name: 'Take photo' }))
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await act(async () => resolveStream({ getTracks: () => [track] }))

    expect(track.stop).toHaveBeenCalled()
  })
})
