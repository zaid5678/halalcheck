import { act, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IngredientResult, IngredientsAnalysis, LabelReading } from '../types/analysis'
import type { CitedEvidence } from '../types/analysis'
import { mockApi, renderApp } from './utils'

function photo(name = 'label.jpg', type = 'image/jpeg') {
  return new File([new Uint8Array(2048)], name, { type })
}

const uploadInput = () => screen.getByLabelText('Upload an image file') as HTMLInputElement
const cameraInput = () => screen.getByLabelText('Take a photo with your camera') as HTMLInputElement

const reading: LabelReading = {
  label_readable: true,
  readability_notes: null,
  clarification_request: 'Is the third ingredient “جيلاتين الخنزير” or “جيلاتين البقر”?',
  detected_languages: ['Arabic'],
  ingredients_text: 'المكونات: سكر، جيلاتين الخنزير، نكهات',
  ingredients: [
    { original_text: 'سكر', translated_name: 'sugar', e_number: null, alternative_names: [], reading_uncertain: false, reading_note: null },
    {
      original_text: 'جيلاتين الخنزير',
      translated_name: 'pork gelatine',
      e_number: null,
      alternative_names: ['porcine gelatin'],
      reading_uncertain: true,
      reading_note: 'The second word is partly covered by a crease.',
    },
    { original_text: 'نكهات', translated_name: 'flavourings', e_number: null, alternative_names: [], reading_uncertain: false, reading_note: null },
  ],
  model: 'google/gemini-3.1-flash-lite',
}

function ingredient(original: string, overrides: Partial<IngredientResult> = {}): IngredientResult {
  return {
    original_text: original,
    translated_name: null,
    standardised_identity: null,
    alternative_names: [],
    e_number: null,
    reading_uncertain: false,
    possible_sources: ['plant'],
    established_source: null,
    assessment: 'likely_permissible',
    explanation: `${original} is plant-derived.`,
    evidence: 'General knowledge of how it is made.',
    evidence_basis: 'general_knowledge',
    needs_more_information: false,
    knowledge_base_match: null,
    ...overrides,
  }
}

const quran2173: CitedEvidence = {
  id: 'quran-2-173',
  source_type: 'quran',
  reference: "Qur'an 2:173",
  title: 'Surah Al-Baqara (2), verse 173',
  narrator: null,
  arabic_text: 'إِنَّمَا حَرَّمَ عَلَيْكُمُ ٱلْمَيْتَةَ وَٱلدَّمَ وَلَحْمَ ٱلْخِنزِيرِ',
  translation: 'He has only forbidden to you dead animals, blood, the flesh of swine…',
  translation_source: 'Saheeh International',
  text_source: 'Uthmani text (Tanzil) via AlQuran Cloud',
  authenticity: null,
  url: 'https://quran.com/2/173',
  excerpt: false,
  principle_ids: ['swine'],
  notes: [],
}

const bukhari2236: CitedEvidence = {
  ...quran2173,
  id: 'hadith-bukhari-2236',
  source_type: 'hadith',
  reference: 'Sahih al-Bukhari 2236',
  title: 'Sahih al-Bukhari 2236',
  narrator: 'Narrated Jabir bin `Abdullah',
  arabic_text: 'إِنَّ اللَّهَ وَرَسُولَهُ حَرَّمَ بَيْعَ الْخَمْرِ وَالْمَيْتَةِ وَالْخِنْزِيرِ وَالأَصْنَامِ',
  translation: 'Allah and His Apostle made illegal the trade of alcohol, dead animals, pigs and idols.',
  translation_source: 'Sunnah.com (M. Muhsin Khan)',
  text_source: 'Sunnah.com',
  authenticity: { grade: 'Sahih', graded_by: 'Included in Sahih al-Bukhari' },
  url: 'https://sunnah.com/bukhari:2236',
  excerpt: true,
  notes: ['This narration concerns trading in pigs… it does not mention modern food additives.'],
}

const haramAnalysis: IngredientsAnalysis = {
  label_readable: true,
  readability_notes: null,
  detected_languages: ['Arabic'],
  extracted_ingredients_text: 'المكونات: سكر، جيلاتين الخنزير، نكهات',
  overall_status: 'haram',
  confidence: 'high',
  summary: 'The label states pork gelatine, a pig-derived ingredient.',
  ingredients: [
    ingredient('سكر', { translated_name: 'sugar' }),
    ingredient('جيلاتين الخنزير', {
      translated_name: 'pork gelatine',
      standardised_identity: 'Gelatine (porcine)',
      possible_sources: ['pork'],
      established_source: 'pork',
      assessment: 'potential_concern',
      evidence: 'The label says جيلاتين الخنزير, “pork gelatine”.',
      evidence_basis: 'label',
      knowledge_base_match: { term: 'pork gelatine', ruling: 'haram', note: 'Pork or pork-derived' },
    }),
  ],
  identified_concerns: [
    {
      ingredient: 'جيلاتين الخنزير',
      principle_id: 'swine',
      principle_title: 'Pork and pig-derived ingredients',
      principle_category: 'prohibited',
      concern_type: 'established_prohibited_source',
      source_evidence: 'The label names the gelatine as pork gelatine.',
      source_evidence_basis: 'label',
      connection: 'The gelatine is stated to come from pigs.',
      unresolved_question: null,
      verified_prohibited_source: true,
    },
  ],
  reason_for_prohibition: [
    {
      ingredient_on_packaging: 'جيلاتين الخنزير',
      translated_name: 'pork gelatine',
      standardised_name: 'Gelatine (porcine)',
      source: 'pork',
      source_evidence: 'The label names the gelatine as pork gelatine.',
      source_evidence_basis: 'label',
      principle_id: 'swine',
      principle_title: 'Pork and pig-derived ingredients',
      why_prohibited: 'The Qur’an explicitly prohibits the flesh of swine.',
      connection: 'The gelatine is stated to come from pigs.',
      evidence_ids: ['quran-2-173', 'hadith-bukhari-2236'],
      has_verified_hadith: true,
      qualifications: ['Scholars differ on whether complete chemical transformation (istihalah) changes the ruling.'],
    },
  ],
  ingredient_source_evidence: [],
  islamic_evidence: [quran2173, bukhari2236],
  scholarly_qualifications: [],
  certification_status: { marks_visible: [], notes: 'No certification mark is visible.' },
  unresolved_questions: [],
  recommended_next_steps: ['Avoid this product if you follow halal guidelines.'],
  limitations: ['No external verification.'],
  model: 'anthropic/claude-sonnet-5.5',
  used_corrected_text: true,
  adjustments: [],
}

const unknownGelatine: IngredientsAnalysis = {
  ...haramAnalysis,
  detected_languages: ['French'],
  extracted_ingredients_text: 'Ingrédients : sucre, gélatine',
  overall_status: 'potentially_non_halal',
  confidence: 'medium',
  summary: 'The gelatine’s animal source is not stated.',
  ingredients: [
    ingredient('gélatine', {
      translated_name: 'gelatine',
      possible_sources: ['pork', 'animal'],
      assessment: 'potential_concern',
      needs_more_information: true,
      knowledge_base_match: { term: 'gelatine', ruling: 'doubtful', note: 'Usually pork or non-halal beef unless the source is stated' },
    }),
  ],
  identified_concerns: [
    {
      ...haramAnalysis.identified_concerns[0],
      ingredient: 'gélatine',
      concern_type: 'possible_prohibited_source',
      source_evidence: 'Gelatine is commonly made from pork, but the label does not say.',
      source_evidence_basis: 'general_knowledge',
      connection: 'If the gelatine were pig-derived, it would fall under this principle.',
      unresolved_question: 'Which animal is the gelatine from?',
      verified_prohibited_source: false,
    },
  ],
  reason_for_prohibition: [],
  unresolved_questions: ['Which animal is the gelatine from?'],
  scholarly_qualifications: [
    { principle_id: 'swine', principle_title: 'Pork and pig-derived ingredients', category: 'prohibited', notes: ['The name alone does not establish a pig source.'] },
  ],
  adjustments: [],
}

function routes(...analyses: { status?: number; body: unknown }[]) {
  let analyseCalls = 0
  return mockApi((url) => {
    if (url.pathname === '/api/ingredients/read') return { body: reading }
    if (url.pathname === '/api/ingredients/analyze') {
      return analyses[Math.min(analyseCalls++, analyses.length - 1)]
    }
    return undefined
  })
}

function sentForm(fetchMock: ReturnType<typeof mockApi>, path: string, index = 0): FormData {
  const calls = fetchMock.mock.calls.filter(([url]) => String(url).includes(path))
  const [, init] = calls[index] as unknown as [string, RequestInit]
  expect(init.method).toBe('POST')
  return init.body as FormData
}

async function readPhoto(user: ReturnType<typeof renderApp>['user']) {
  await user.upload(uploadInput(), photo())
  await user.click(screen.getByRole('button', { name: 'Read ingredients' }))
  await screen.findByRole('heading', { name: 'Check the ingredients we read' })
}

describe('scan ingredients', () => {
  it('is offered on the home page as a separate feature', async () => {
    const { user } = renderApp()

    expect(screen.getByRole('heading', { name: 'Scan ingredients' })).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Scan ingredients' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Scan ingredients' })).toBeInTheDocument()
  })

  it('reads a multilingual label and shows the original text alongside English for review', async () => {
    const fetchMock = routes({ body: haramAnalysis })
    const { user } = renderApp('/ingredients')

    await user.upload(uploadInput(), photo())
    expect(fetchMock).not.toHaveBeenCalled()
    await readPhoto(user)

    expect(screen.getByText('Label language: Arabic')).toBeInTheDocument()
    const table = screen.getByRole('table', { name: /ingredients as printed and their english meaning/i })
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'سكر',
      'جيلاتين الخنزير',
      'نكهات',
    ])
    expect(rows[1]).toHaveTextContent('pork gelatine')
    expect(rows[1]).toHaveTextContent('Also known as porcine gelatin')
    expect(rows[1]).toHaveTextContent('Check this: The second word is partly covered by a crease.')
    expect(screen.getByText(/1 ingredient may have been misread/)).toBeInTheDocument()
    // The AI asks rather than guessing when the label is ambiguous.
    expect(screen.getByText(/Is the third ingredient/)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /ingredients text/i })).toHaveValue(reading.ingredients_text)
    // Nothing has been assessed yet.
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes('/analyze'))).toBe(false)
  })

  it('analyses the text the user confirmed or edited, with the photo as supporting evidence', async () => {
    const fetchMock = routes({ body: unknownGelatine })
    const { user } = renderApp('/ingredients')
    await readPhoto(user)

    const editor = screen.getByRole('textbox', { name: /ingredients text/i })
    await user.clear(editor)
    await user.type(editor, 'Ingrédients : sucre, gélatine')
    await user.click(screen.getByRole('button', { name: 'Check edited ingredients' }))

    expect(await screen.findByRole('heading', { name: /Potentially non-halal/ })).toBeInTheDocument()
    const form = sentForm(fetchMock, '/api/ingredients/analyze')
    expect(form.get('ingredients_text')).toBe('Ingrédients : sucre, gélatine')
    expect(form.get('image')).toBeInstanceOf(File)
  })

  it('explains exactly why a product is haram, with verified, openable references', async () => {
    routes({ body: haramAnalysis })
    const { user } = renderApp('/ingredients')
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Looks right — check ingredients' }))

    const status = await screen.findByRole('heading', { name: /^Haram/ })
    expect(status).toHaveTextContent('Pork and pig-derived ingredients identified')

    const why = screen.getByRole('heading', { name: 'Why this product is assessed as haram' })
      .parentElement!
    // The ingredient, its name on the pack, its translation and its source evidence.
    expect(within(why).getByText('جيلاتين الخنزير')).toHaveAttribute('dir', 'auto')
    expect(why).toHaveTextContent('Name used on the packaging')
    expect(why).toHaveTextContent('pork gelatine · Gelatine (porcine)')
    expect(why).toHaveTextContent('Pork-derived')
    expect(why).toHaveTextContent('From the label')
    expect(why).toHaveTextContent('The label names the gelatine as pork gelatine.')
    // Why it's prohibited (curated) and how it applies (AI, labelled as such).
    expect(why).toHaveTextContent('The Qur’an explicitly prohibits the flesh of swine.')
    expect(why).toHaveTextContent('AI interpretation')
    // Verified references that can be opened.
    const quranLink = within(why).getByRole('link', { name: /Read Qur'an 2:173 on Quran.com/ })
    expect(quranLink).toHaveAttribute('href', 'https://quran.com/2/173')
    const hadithLink = within(why).getByRole('link', { name: /Read Sahih al-Bukhari 2236 on Sunnah.com/ })
    expect(hadithLink).toHaveAttribute('href', 'https://sunnah.com/bukhari:2236')
    expect(why).toHaveTextContent('Sahih')
    expect(why).toHaveTextContent('does not mention modern food additives')
    expect(within(why).getAllByText('Verified reference')).toHaveLength(2)
    // Scholarly qualifications.
    expect(why).toHaveTextContent('istihalah')
    // Certification isn't shown next to a haram result.
    expect(screen.queryByRole('heading', { name: 'Halal certification' })).not.toBeInTheDocument()
  })

  it('does not call unknown-source gelatine haram, and says what would resolve it', async () => {
    routes({ body: unknownGelatine })
    const { user } = renderApp('/ingredients')
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Looks right — check ingredients' }))

    await screen.findByRole('heading', { name: /Potentially non-halal/ })
    expect(screen.queryByText('Why this product is assessed as haram')).not.toBeInTheDocument()
    const checking = screen.getByRole('heading', { name: 'What needs checking' }).parentElement!.parentElement!
    expect(checking).toHaveTextContent('Possible prohibited source — not established')
    expect(checking).toHaveTextContent('AI general knowledge — not independently verified')
    expect(checking).toHaveTextContent('To resolve: Which animal is the gelatine from?')
    expect(screen.getByText(/do not show that this product contains a prohibited/)).toBeInTheDocument()
    expect(screen.getByText(/HalalCheck knowledge base: “gelatine”/)).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Halal certification' })).toBeInTheDocument()
  })

  it('lets users correct the ingredients after the result and re-run', async () => {
    const fetchMock = routes({ body: unknownGelatine }, { body: { ...unknownGelatine, overall_status: 'likely_halal', summary: 'Fish gelatine is permissible.' } })
    const { user } = renderApp('/ingredients')
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Looks right — check ingredients' }))
    await screen.findByRole('heading', { name: /Potentially non-halal/ })

    const editor = screen.getByRole('textbox', { name: 'What we read' })
    await user.clear(editor)
    await user.type(editor, 'sucre, gélatine de poisson')
    await user.click(screen.getByRole('button', { name: 'Edit and re-check' }))

    expect(await screen.findByRole('heading', { name: /Likely halal/ })).toBeInTheDocument()
    expect(sentForm(fetchMock, '/api/ingredients/analyze', 1).get('ingredients_text')).toBe(
      'sucre, gélatine de poisson',
    )
  })

  it('asks for a clearer photo when the label is unreadable', async () => {
    mockApi((url) =>
      url.pathname === '/api/ingredients/read'
        ? {
            body: {
              ...reading,
              label_readable: false,
              readability_notes: 'The text is blurred. Move closer and hold the camera steady.',
              clarification_request: null,
              ingredients: [],
              ingredients_text: '',
            },
          }
        : undefined,
    )
    const { user } = renderApp('/ingredients')
    await readPhoto(user)

    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Please take a clearer photo')
    expect(alert).toHaveTextContent('The text is blurred.')
    expect(screen.getByRole('button', { name: /check ingredients/i })).toBeDisabled()
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
    const fetchMock = routes({ body: haramAnalysis })
    renderApp('/ingredients')

    fireEvent.change(uploadInput(), { target: { files: [photo(name, type)] } })

    expect(screen.getByRole('alert')).toHaveTextContent(message)
    expect(screen.queryByRole('button', { name: 'Read ingredients' })).not.toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('retries the analysis after an AI failure', async () => {
    routes(
      { status: 502, body: { error: { code: 'ai_invalid_response', message: 'The analysis came back incomplete.' } } },
      { body: haramAnalysis },
    )
    const { user } = renderApp('/ingredients')
    await readPhoto(user)
    await user.click(screen.getByRole('button', { name: 'Looks right — check ingredients' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The analysis came back incomplete.')
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: /^Haram/ })).toBeInTheDocument()
  })

  it.each([
    [415, 'unsupported_image_type', 'Unsupported image', false],
    [429, 'too_many_requests', 'Scan limit reached', false],
    [503, 'ai_not_configured', 'Analysis isn’t available', true],
  ])('shows %s %s errors when reading', async (status, code, title, canRetry) => {
    mockApi((url) =>
      url.pathname === '/api/ingredients/read'
        ? { status, body: { error: { code, message: 'Server message.' } } }
        : undefined,
    )
    const { user } = renderApp('/ingredients')
    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(title)
    expect(!!within(alert).queryByRole('button', { name: 'Try again' })).toBe(canRetry)
  })

  it('handles network failures', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const { user } = renderApp('/ingredients')
    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach halalcheck/i)
  })

  it('can cancel while reading', async () => {
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
    await user.upload(uploadInput(), photo())
    await user.click(screen.getByRole('button', { name: 'Read ingredients' }))
    expect(await screen.findByText('Reading the label…')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(aborted).toBe(true)
    expect(screen.getByRole('button', { name: 'Read ingredients' })).toBeInTheDocument()
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
