import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { AnalysisResult } from '../components/AnalysisResult'
import { ArrowLeftIcon } from '../components/icons'
import { IngredientsTextEditor } from '../components/IngredientsTextEditor'
import { LabelReview } from '../components/LabelReview'
import { PhotoPicker, type PhotoSource } from '../components/PhotoPicker'
import { ErrorState } from '../components/StatusMessages'
import {
  formatFileSize,
  MAX_UPLOAD_BYTES,
  prepareImageForUpload,
  validateImageFile,
} from '../lib/image'
import { ApiError } from '../services/api'
import { analyzeIngredients, readLabel } from '../services/ingredients'
import type { IngredientsAnalysis, LabelReading } from '../types/analysis'

interface Photo {
  file: File
  url: string
  source: PhotoSource
  /** The photo as uploaded (possibly downscaled), reused for both steps. */
  upload?: Blob
}

type Stage =
  | { step: 'choose' }
  | { step: 'preview'; photo: Photo }
  | { step: 'reading'; photo: Photo }
  | { step: 'review'; photo: Photo; reading: LabelReading }
  | { step: 'analysing'; photo: Photo; text: string; rerun: boolean }
  | { step: 'result'; photo: Photo; result: IngredientsAnalysis }
  | { step: 'error'; photo: Photo; error: ApiError; retry: () => void }

const SLOW_READING_MS = 15_000
const SLOW_ANALYSIS_MS = 50_000

const ERROR_TITLES: Record<string, string> = {
  unsupported_image_type: 'Unsupported image',
  image_too_large: 'Image too large',
  invalid_image: 'Couldn’t open this image',
  too_many_requests: 'Scan limit reached',
  ai_not_configured: 'Analysis isn’t available',
}

// Retrying these won't help; the user needs a different photo or to wait.
const NO_RETRY = new Set([
  'unsupported_image_type',
  'image_too_large',
  'invalid_image',
  'too_many_requests',
])

function asApiError(error: unknown): ApiError {
  return error instanceof ApiError
    ? error
    : new ApiError('unknown_error', 'Something went wrong. Please try again.', 0)
}

async function uploadable(photo: Photo): Promise<Blob> {
  if (photo.upload) return photo.upload
  const upload = await prepareImageForUpload(photo.file)
  if (upload.size > MAX_UPLOAD_BYTES) {
    throw new ApiError('image_too_large', 'That image is too large. Please use one under 10 MB.', 413)
  }
  photo.upload = upload
  return upload
}

export function IngredientsPage() {
  const [stage, setStage] = useState<Stage>({ step: 'choose' })
  const [pickerError, setPickerError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const photo = stage.step === 'choose' ? null : stage.photo

  // Release the preview's memory when the photo changes or the page closes. The photo itself
  // only ever lives in this tab's memory.
  useEffect(() => {
    if (!photo) return
    return () => URL.revokeObjectURL(photo.url)
  }, [photo])

  useEffect(() => () => abortRef.current?.abort(), [])

  const selectPhoto = useCallback((file: File, source: PhotoSource) => {
    abortRef.current?.abort()
    const validation = validateImageFile(file)
    if (!validation.ok) {
      setPickerError(validation.error)
      setStage({ step: 'choose' })
      return
    }
    setPickerError(null)
    setStage({ step: 'preview', photo: { file, url: URL.createObjectURL(file), source } })
  }, [])

  function newRequest(): AbortController {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    window.scrollTo({ top: 0, behavior: 'smooth' })
    return controller
  }

  /** Step 1: read and interpret the label. */
  async function read(current: Photo) {
    const controller = newRequest()
    setStage({ step: 'reading', photo: current })
    try {
      const reading = await readLabel(
        await uploadable(current),
        current.file.name || 'label.jpg',
        controller.signal,
      )
      if (!controller.signal.aborted) setStage({ step: 'review', photo: current, reading })
    } catch (error) {
      if (controller.signal.aborted) return
      setStage({ step: 'error', photo: current, error: asApiError(error), retry: () => read(current) })
    }
  }

  /** Step 2: assess the confirmed text, with the photo as supporting evidence. */
  async function analyse(current: Photo, text: string, rerun = false) {
    const controller = newRequest()
    setStage({ step: 'analysing', photo: current, text, rerun })
    try {
      const result = await analyzeIngredients({
        image: await uploadable(current),
        fileName: current.file.name || 'label.jpg',
        correctedText: text,
        signal: controller.signal,
      })
      if (!controller.signal.aborted) setStage({ step: 'result', photo: current, result })
    } catch (error) {
      if (controller.signal.aborted) return
      setStage({
        step: 'error',
        photo: current,
        error: asApiError(error),
        retry: () => analyse(current, text, rerun),
      })
    }
  }

  function cancel(current: Photo) {
    abortRef.current?.abort()
    setStage({ step: 'preview', photo: current })
  }

  function startOver() {
    abortRef.current?.abort()
    setStage({ step: 'choose' })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        to="/"
        className="-ml-2 inline-flex h-11 items-center gap-2 rounded-lg px-2 font-medium text-brand-700 hover:bg-brand-50"
      >
        <ArrowLeftIcon className="size-5" />
        Home
      </Link>

      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Scan ingredients</h1>
        <p className="mt-1 text-muted">
          Photograph the ingredients list on the packaging, in any language. We’ll read it, let you
          check it, then look into where each ingredient comes from.
        </p>
      </div>

      {stage.step === 'choose' && (
        <div className="space-y-4">
          <PhotoPicker onSelect={selectPhoto} />
          {pickerError && (
            <p role="alert" className="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">
              {pickerError}
            </p>
          )}
          <PhotoTips />
        </div>
      )}

      {photo && stage.step !== 'choose' && (
        <PhotoPreview
          photo={photo}
          dimmed={stage.step === 'analysing' || stage.step === 'reading'}
          compact={stage.step === 'result' || stage.step === 'review'}
        />
      )}

      {stage.step === 'preview' && (
        <div className="space-y-3">
          <button
            type="button"
            onClick={() => read(stage.photo)}
            className="btn-primary h-14 w-full text-base"
          >
            Read ingredients
          </button>
          <PhotoPicker onSelect={selectPhoto} variant="compact" />
        </div>
      )}

      {stage.step === 'reading' && (
        <Working
          title="Reading the label…"
          detail="This usually takes a few seconds."
          slowAfterMs={SLOW_READING_MS}
          onCancel={() => cancel(stage.photo)}
        />
      )}

      {stage.step === 'review' && (
        <LabelReview
          reading={stage.reading}
          onConfirm={(text) => analyse(stage.photo, text)}
          onRetake={startOver}
        />
      )}

      {stage.step === 'analysing' && (
        <Working
          title={stage.rerun ? 'Re-checking ingredients…' : 'Checking each ingredient…'}
          detail="Each ingredient’s source is being investigated. This usually takes 15–40 seconds."
          slowAfterMs={SLOW_ANALYSIS_MS}
          onCancel={() => cancel(stage.photo)}
        />
      )}

      {stage.step === 'error' && (
        <ErrorState
          title={ERROR_TITLES[stage.error.code] ?? 'Couldn’t check this photo'}
          message={stage.error.message}
          onRetry={NO_RETRY.has(stage.error.code) ? undefined : stage.retry}
        >
          <button type="button" onClick={startOver} className="btn-secondary">
            Use a different photo
          </button>
        </ErrorState>
      )}

      {stage.step === 'result' && (
        <>
          {!stage.result.label_readable && (
            <div role="alert" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900">
              <h2 className="font-semibold">Please take a clearer photo</h2>
              <p className="mt-1 text-sm">
                {stage.result.readability_notes ??
                  'The ingredients list couldn’t be read reliably, so this assessment is incomplete.'}
              </p>
              <button type="button" onClick={startOver} className="btn-secondary mt-3">
                Retake photo
              </button>
            </div>
          )}
          <AnalysisResult analysis={stage.result} />
          <IngredientsTextEditor
            key={stage.result.extracted_ingredients_text}
            initialText={stage.result.extracted_ingredients_text}
            onRerun={(text) => analyse(stage.photo, text, true)}
          />
          <p className="text-center text-xs text-muted">
            Informational guidance from an AI model ({stage.result.model}), not a religious ruling
            or certification. If in doubt, ask the manufacturer or a scholar you trust.
          </p>
          <button type="button" onClick={startOver} className="btn-secondary w-full">
            Check another product
          </button>
        </>
      )}
    </div>
  )
}

function PhotoPreview({ photo, dimmed, compact }: { photo: Photo; dimmed: boolean; compact: boolean }) {
  return (
    <figure className="overflow-hidden rounded-2xl border border-line bg-surface">
      <img
        src={photo.url}
        alt="Your photo of the ingredients label"
        className={`w-full bg-ink/5 object-contain transition-opacity ${compact ? 'max-h-40' : 'max-h-[55vh]'} ${dimmed ? 'opacity-50' : ''}`}
      />
      <figcaption className="flex justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
        <span className="truncate">{photo.source === 'camera' ? 'Photo taken' : photo.file.name}</span>
        <span className="shrink-0">{formatFileSize(photo.file.size)}</span>
      </figcaption>
    </figure>
  )
}

function Working({
  title,
  detail,
  slowAfterMs,
  onCancel,
}: {
  title: string
  detail: string
  slowAfterMs: number
  onCancel: () => void
}) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), slowAfterMs)
    return () => clearTimeout(timer)
  }, [slowAfterMs])

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-center">
      <div role="status" className="flex items-center justify-center gap-3">
        <span
          className="size-5 rounded-full border-2 border-brand-200 border-t-brand-600 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <span className="font-medium">{title}</span>
      </div>
      <p className="mt-2 text-sm text-muted" aria-live="polite">
        {slow
          ? 'Still working. If the service has been idle it can take up to a minute longer to start.'
          : detail}
      </p>
      <button type="button" onClick={onCancel} className="btn-secondary mt-4">
        Cancel
      </button>
    </div>
  )
}

function PhotoTips() {
  return (
    <div className="rounded-2xl bg-brand-50 p-4 text-sm text-brand-800 sm:p-5">
      <h2 className="font-semibold">For the best results</h2>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>Fill the frame with the whole ingredients list, in focus.</li>
        <li>Include any halal certification logo if it’s nearby on the pack.</li>
        <li>Use good, even light and avoid glare on shiny packaging.</li>
        <li>Labels in any language are fine, including Arabic, French, Turkish and Urdu.</li>
      </ul>
    </div>
  )
}
