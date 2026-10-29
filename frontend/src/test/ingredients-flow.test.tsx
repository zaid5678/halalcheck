import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngredientFinding, IngredientsAnalysis } from '../types/analysis'
import { mockApi, renderApp } from './utils'

function finding(original: string, overrides: Partial<IngredientFinding> = {}): IngredientFinding {
  return {
    original_text: original,
    standardised_name: null,
    translation: null,
    e_number: null,
    possible_sources: ['plant'],
    source_established: false,
    assessment: 'likely_permissible',
    explanation: `${original} is plant-derived.`,
    evidence: 'General knowledge of how it is made.',
    evidence_basis: 'general_knowledge',
    needs_more_information: false,
    ...overrides,
  }
}

/** A multilingual label with one ambiguous ingredient (E471) and two plain ones. */
const analysis: IngredientsAnalysis = {
  label_readable: true,
  readability_notes: null,
  detected_language: ['Arabic', 'French'],
  extracted_ingredients_text: 'المكونات: سكر، ملح / émulsifiant : mono- et diglycérides (E471)',
  overall_status: 'needs_further_investigation',
  confidence: 'medium',
  summary: 'The source of the emulsifier E471 is not stated, so the product needs checking.',
  ingredients: [
    finding('سكر', { translation: 'sugar', standardised_name: 'Sugar' }),
    finding('mono- et diglycérides (E471)', {
      translation: 'mono- and diglycerides',
      standardised_name: 'Mono- and diglycerides of fatty acids',
      e_number: 'E471',
      possible_sources: ['plant', 'animal', 'pork'],
      assessment: 'unknown',
      explanation: 'E471 can be made from vegetable oils or animal fats, including pork fat.',
      evidence: 'E471 is commercially produced from both plant and animal fats.',
      needs_more_information: true,
    }),
    finding('ملح', {
      translation: 'salt',
      possible_sources: ['mineral'],
      evidence: 'Printed as salt.',
      evidence_basis: 'label',
    }),
  ],
  prohibited_findings: [],
  concerns: [{ ingredient: 'E471', description: 'Its animal or plant origin is not stated.' }],
  certification_information: { marks_visible: [], notes: 'No certification mark is visible.' },
  limitations: ['Sources could not be checked with the manufacturer.'],
  next_steps: ['Ask the manufacturer whether the E471 is plant-derived.'],
  model: 'anthropic/claude-sonnet-5.5',
  used_corrected_text: false,
  adjustments: [],
}

function photo(name = 'label.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array(2048)], name, { type })
}

const uploadInput = () => screen.getByLabelText('Upload an image file') as HTMLInputElement
const cameraInput = () => screen.getByLabelText('Take a photo with your camera') as HTMLInputElement

function analyzeRoute(...responses: { status?: number; body: unknown }[]) {
  let call = 0
  return mockApi((url) => {
    if (url.pathname !== '/api/ingredients/analyze') return undefined
    return responses[Math.min(call++, responses.length - 1)]
  })
}

function sentForm(fetchMock: ReturnType<typeof mockApi>, index = 0): FormData {
  const [, init] = fetchMock.mock.calls[index] as unknown as [string, RequestInit]
  expect(init.method).toBe('POST')
  return init.body as FormData
}

async function uploadAndAnalyse(user: ReturnType<typeof renderApp>['user']) {
  await user.upload(uploadInput(), photo())
  await user.click(screen.getByRole('button', { name: 'Analyse ingredients' }))
}

describe('scan ingredients', () => {
  it('is offered on the home page as a separate feature', async () => {
    const { user } = renderApp()

    expect(screen.getByRole('heading', { name: 'Search a product' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan a barcode' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Scan ingredients' })).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Scan ingredients' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Scan ingredients' })).toBeInTheDocument()
  })

  it('uploads a photo, previews it and shows the assessment', async () => {
    const fetchMock = analyzeRoute({ body: analysis })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    expect(screen.getByRole('img', { name: /your photo of the ingredients label/i })).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Analyse ingredients' }))

    expect(
      await screen.findByRole('heading', { name: 'Needs further investigation' }),
    ).toBeInTheDocument()
    expect(screen.getByText('Medium confidence')).toBeInTheDocument()
    expect(screen.getByText(analysis.summary)).toBeInTheDocument()

    const form = sentForm(fetchMock)
    expect((form.get('image') as File).name).toBe('label.jpg')
    expect(form.get('ingredients_text')).toBeNull()
  })

  it('shows ingredient findings with original names, translations and evidence basis', async () => {
    analyzeRoute({ body: analysis })
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    await screen.findByRole('heading', { name: 'Needs further investigation' })
    expect(screen.getByText('Label language: Arabic, French')).toBeInTheDocument()

    // Ingredients needing attention are listed first, with their original wording kept.
    const flagged = screen.getByRole('list', { name: 'Ingredients to check' })
    const [e471] = within(flagged).getAllByRole('listitem')
    expect(e471).toHaveTextContent('mono- et diglycérides (E471)')
    expect(e471).toHaveTextContent('mono- and diglycerides · Mono- and diglycerides of fatty acids')
    expect(e471).toHaveTextContent('Unknown source')
    expect(e471).toHaveTextContent('Pork')
    expect(e471).toHaveTextContent('Source not stated')
    expect(e471).toHaveTextContent('AI general knowledge (not independently verified):')
    expect(e471).toHaveTextContent('Needs confirmation from the manufacturer')

    // Plainly permissible ingredients are collapsed but still listed.
    const permissible = screen.getByRole('list', { name: 'Likely permissible ingredients' })
    const items = within(permissible).getAllByRole('listitem')
    expect(items.map((item) => item.querySelector('[dir="auto"]')?.textContent)).toEqual(['سكر', 'ملح'])
    expect(items[1]).toHaveTextContent('Evidence from the label:')

    expect(screen.getByText('No halal certification visible')).toBeInTheDocument()
    expect(screen.getByText(/Ask the manufacturer whether the E471/)).toBeInTheDocument()
    expect(screen.getByText(/not a religious ruling or certification/i)).toBeInTheDocument()
    expect(screen.getByText(/anthropic\/claude-sonnet-5.5/)).toBeInTheDocument()
  })

  it('shows prohibited findings and HalalCheck’s safety adjustments separately', async () => {
    analyzeRoute({
      body: {
        ...analysis,
        overall_status: 'potentially_non_halal',
        confidence: 'high',
        prohibited_findings: [
          { ingredient: 'دهن الخنزير', source: 'pork', evidence: 'The label lists pork fat.' },
        ],
        adjustments: [
          'HalalCheck changed the overall result from “Likely halal” to “Potentially non-halal” because an ingredient from a prohibited source was identified.',
        ],
      },
    })
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    expect(await screen.findByRole('heading', { name: 'Potentially non-halal' })).toBeInTheDocument()
    const prohibited = screen.getByRole('heading', { name: /prohibited source identified/i })
      .parentElement!
    expect(prohibited).toHaveTextContent('دهن الخنزير')
    expect(prohibited).toHaveTextContent('The label lists pork fat.')
    expect(screen.getByRole('heading', { name: 'HalalCheck safety check' }).parentElement!
      .parentElement!).toHaveTextContent('changed the overall result')
  })

  it('shows visible certification marks without vouching for them', async () => {
    analyzeRoute({
      body: {
        ...analysis,
        certification_information: {
          marks_visible: ['HMC Halal logo'],
          notes: 'An HMC logo is printed near the ingredients.',
        },
      },
    })
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    expect(await screen.findByText('HMC Halal logo')).toBeInTheDocument()
    expect(screen.getByText(/can’t confirm whether a logo is genuine/)).toBeInTheDocument()
  })

  it('lets users correct the ingredients text and re-run the assessment', async () => {
    const fetchMock = analyzeRoute(
      { body: analysis },
      {
        body: {
          ...analysis,
          overall_status: 'likely_halal',
          summary: 'With the corrected text, no concerns were identified.',
          used_corrected_text: true,
        },
      },
    )
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)
    await screen.findByRole('heading', { name: 'Needs further investigation' })

    const editor = screen.getByRole('textbox', { name: 'Ingredients as read from the label' })
    expect(editor).toHaveValue(analysis.extracted_ingredients_text)
    const rerun = screen.getByRole('button', { name: 'Re-run assessment' })
    expect(rerun).toBeDisabled()

    await user.clear(editor)
    await user.type(editor, 'sugar, salt, emulsifier: sunflower lecithin')
    expect(rerun).toBeEnabled()
    await user.click(rerun)

    expect(await screen.findByRole('heading', { name: 'Likely halal' })).toBeInTheDocument()
    expect(screen.getByText(/using your corrected ingredients text/)).toBeInTheDocument()

    const form = sentForm(fetchMock, 1)
    expect(form.get('ingredients_text')).toBe('sugar, salt, emulsifier: sunflower lecithin')
    // The photo is sent again so certification marks can still be considered.
    expect(form.get('image')).toBeInstanceOf(File)
  })

  it('asks for a clearer photo when the label is unreadable', async () => {
    analyzeRoute({
      body: {
        ...analysis,
        label_readable: false,
        readability_notes: 'The text is blurred. Move closer and hold the camera steady.',
        confidence: 'low',
        ingredients: [],
        extracted_ingredients_text: '',
      },
    })
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Please take a clearer photo')
    expect(alert).toHaveTextContent('The text is blurred.')
    expect(within(alert).getByRole('button', { name: 'Retake' })).toBeInTheDocument()
    expect(screen.getByText('No ingredients could be identified.')).toBeInTheDocument()
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
    const fetchMock = analyzeRoute({ body: analysis })
    renderApp('/ingredients')

    fireEvent.change(uploadInput(), { target: { files: [photo(name, type)] } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Analyse ingredients' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries after a malformed AI response', async () => {
    analyzeRoute(
      {
        status: 502,
        body: {
          error: {
            code: 'ai_invalid_response',
            message: 'The analysis came back incomplete or in an unexpected format.',
          },
        },
      },
      { body: analysis },
    )
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Couldn’t analyse this photo')
    expect(alert).toHaveTextContent('incomplete or in an unexpected format')

    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(
      await screen.findByRole('heading', { name: 'Needs further investigation' }),
    ).toBeInTheDocument()
  })

  it.each([
    [415, 'unsupported_image_type', 'Unsupported image', false],
    [429, 'too_many_requests', 'Scan limit reached', false],
    [503, 'ai_not_configured', 'Analysis isn’t available', true],
    [504, 'ai_timeout', 'Couldn’t analyse this photo', true],
  ])('shows %s %s errors', async (status, code, title, canRetry) => {
    analyzeRoute({ status, body: { error: { code, message: 'Server message.' } } })
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(alert).toHaveTextContent('Server message.')
    expect(!!within(alert).queryByRole('button', { name: 'Try again' })).toBe(canRetry)
    expect(within(alert).getByRole('button', { name: 'Use a different photo' })).toBeInTheDocument()
  })

  it('handles network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { user } = renderApp('/ingredients')
    await uploadAndAnalyse(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach halalcheck/i)
  })

  it('can cancel while analysing', async () => {
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
    await uploadAndAnalyse(user)
    expect(await screen.findByText('Analysing ingredients…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Analyse ingredients' })).toBeInTheDocument()
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
