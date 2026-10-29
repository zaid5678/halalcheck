import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HalalVerdict } from '../types/halal'
import { mockApi, renderApp } from './utils'

const verdict: HalalVerdict = {
  verdict: 'doubtful',
  reasons: [{ ingredient: 'E471', ruling: 'doubtful', note: 'Can be animal or plant fat' }],
  ingredients_text: 'Sugar, salt, emulsifier (E471)',
  ai_checked: true,
  product: null,
}

function photo(name = 'label.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array(2048)], name, { type })
}

const uploadInput = () => screen.getByLabelText('Upload an image file') as HTMLInputElement
const cameraInput = () => screen.getByLabelText('Take a photo with your camera') as HTMLInputElement

function photoRoute(...responses: { status?: number; body: unknown }[]) {
  let call = 0
  return mockApi((url) => {
    if (url.pathname !== '/api/halal/photo') return undefined
    return responses[Math.min(call++, responses.length - 1)]
  })
}

function sentForm(fetchMock: ReturnType<typeof mockApi>, index = 0): FormData {
  const [, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
  expect(init.method).toBe('POST')
  return init.body as FormData
}

async function uploadAndCheck(user: ReturnType<typeof renderApp>['user']) {
  await user.upload(uploadInput(), photo())
  await user.click(screen.getByRole('button', { name: 'Check ingredients' }))
}

describe('scan ingredients', () => {
  it('is offered on the home page as a separate feature', async () => {
    const { user } = renderApp()

    expect(screen.getByRole('heading', { name: 'Scan ingredients' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Scan ingredients' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Scan ingredients' })).toBeInTheDocument()
  })

  it('uploads a photo, previews it and shows the halal check', async () => {
    const fetchMock = photoRoute({ body: verdict })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    expect(screen.getByRole('img', { name: /your photo of the ingredients label/i })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Check ingredients' }))

    expect(await screen.findByRole('heading', { name: 'Doubtful' })).toBeInTheDocument()
    expect(screen.getByText('1 ingredient needs checking')).toBeInTheDocument()
    expect(screen.getByText('Can be animal or plant fat')).toBeInTheDocument()
    expect(screen.getByText(/not a fatwa or certification/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'What we read' })).toHaveValue(verdict.ingredients_text)
    expect(screen.getByText(/Read by AI from your photo/)).toBeInTheDocument()

    const form = sentForm(fetchMock)
    expect((form.get('image') as File).name).toBe('label.jpg')
    expect(form.get('ingredients_text')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Check another product' }))
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeInTheDocument()
  })

  it('lets users correct the ingredients and re-check without the photo', async () => {
    const fetchMock = photoRoute(
      { body: verdict },
      {
        body: {
          ...verdict,
          verdict: 'halal',
          reasons: [],
          ingredients_text: 'Sugar, salt, sunflower lecithin',
        },
      },
    )
    const { user } = renderApp('/ingredients')
    await uploadAndCheck(user)
    await screen.findByRole('heading', { name: 'Doubtful' })

    const editor = screen.getByRole('textbox', { name: 'What we read' })
    const recheck = screen.getByRole('button', { name: 'Edit and re-check' })
    expect(recheck).toBeDisabled()

    await user.clear(editor)
    await user.type(editor, 'Sugar, salt, sunflower lecithin')
    await user.click(recheck)

    expect(await screen.findByRole('heading', { name: 'Halal' })).toBeInTheDocument()
    const form = sentForm(fetchMock, 1)
    expect(form.get('ingredients_text')).toBe('Sugar, salt, sunflower lecithin')
    expect(form.get('image')).toBeNull()
  })

  it('lets users replace the photo before submitting', async () => {
    const revoke = vi.spyOn(URL, 'revokeObjectURL')
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo('first.jpg'))
    expect(screen.getByText('first.jpg')).toBeInTheDocument()

    await user.upload(uploadInput(), photo('second.png', 'image/png'))
    expect(screen.getByText('second.png')).toBeInTheDocument()
    expect(revoke).toHaveBeenCalled()
  })

  it.each([
    ['animation.gif', 'image/gif', 'Please choose a JPEG, PNG or WebP image.'],
    ['IMG_1234.HEIC', 'image/heic', 'HEIC photos aren’t supported yet'],
  ])('rejects %s before uploading', (name, type, message) => {
    const fetchMock = photoRoute({ body: verdict })
    renderApp('/ingredients')

    fireEvent.change(uploadInput(), { target: { files: [photo(name, type)] } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Check ingredients' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries after the checker was unavailable', async () => {
    photoRoute(
      {
        status: 503,
        body: { error: { code: 'llm_unavailable', message: 'The ingredient checker is unavailable.' } },
      },
      { body: verdict },
    )
    const { user } = renderApp('/ingredients')
    await uploadAndCheck(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t check this photo')
    expect(alert).toHaveTextContent('The ingredient checker is unavailable.')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Doubtful' })).toBeInTheDocument()
  })

  it.each([
    [422, 'unreadable_image', 'No ingredients list found', false],
    [415, 'unsupported_image_type', 'Unsupported image', false],
    [413, 'image_too_large', 'Image too large', false],
    [429, 'too_many_requests', 'Scan limit reached', false],
    [503, 'ai_not_configured', 'Analysis isn’t available', true],
  ])('shows %s %s errors', async (status, code, title, canRetry) => {
    photoRoute({ status, body: { error: { code, message: 'Server message.' } } })
    const { user } = renderApp('/ingredients')
    await uploadAndCheck(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent('Server message.')
    expect(!!within(alert).queryByRole('button', { name: 'Try again' })).toBe(canRetry)
    expect(within(alert).getByRole('button', { name: 'Use a different photo' })).toBeInTheDocument()
  })

  it('handles network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { user } = renderApp('/ingredients')
    await uploadAndCheck(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach halalcheck/i)
  })

  it('can cancel while checking', async () => {
    let aborted = false
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => {
              aborted = true
              reject(new DOMException('Aborted', 'AbortError'))
            })
          }),
      ),
    )
    const { user } = renderApp('/ingredients')
    await uploadAndCheck(user)
    expect(await screen.findByText('Reading the label…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Check ingredients' })).toBeInTheDocument()
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

    const dialog = await screen.findByRole('dialog', { name: 'Photograph the label' })
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
