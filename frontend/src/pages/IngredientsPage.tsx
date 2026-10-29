import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ExtractedIngredients } from '../components/ExtractedIngredients'
import { ArrowLeftIcon } from '../components/icons'
import { PhotoPicker, type PhotoSource } from '../components/PhotoPicker'
import { ErrorState } from '../components/StatusMessages'
import {
  formatFileSize,
  MAX_UPLOAD_BYTES,
  prepareImageForUpload,
  validateImageFile,
} from '../lib/image'
import { ApiError } from '../services/api'
import { extractIngredients } from '../services/ingredients'
import type { IngredientsExtraction } from '../types/ingredients'

interface Photo {
  file: File
  url: string
  source: PhotoSource
}

type Stage =
  | { step: 'choose' }
  | { step: 'preview'; photo: Photo }
  | { step: 'processing'; photo: Photo }
  | { step: 'result'; photo: Photo; result: IngredientsExtraction }
  | { step: 'error'; photo: Photo; error: ApiError }

const SLOW_PROCESSING_MS = 8000

const ERROR_TITLES: Record<string, string> = {
  no_text_found: 'No text found',
  unsupported_image_type: 'Unsupported image',
  image_too_large: 'Image too large',
  invalid_image: 'Couldn’t open this image',
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

  async function extract(current: Photo) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStage({ step: 'processing', photo: current })

    try {
      const upload = await prepareImageForUpload(current.file)
      if (upload.size > MAX_UPLOAD_BYTES) {
        throw new ApiError(
          'image_too_large',
          'That image is too large. Please use one under 10 MB.',
          413,
        )
      }
      const result = await extractIngredients(upload, current.file.name || 'label.jpg', controller.signal)
      if (!controller.signal.aborted) setStage({ step: 'result', photo: current, result })
    } catch (error) {
      if (controller.signal.aborted) return
      setStage({
        step: 'error',
        photo: current,
        error:
          error instanceof ApiError
            ? error
            : new ApiError('unknown_error', 'Something went wrong. Please try again.', 0),
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
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Photograph ingredients</h1>
        <p className="mt-1 text-muted">
          Take or upload a photo of the ingredients list on the packaging. We’ll read the text so
          you can check and copy it.
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
        <PhotoPreview photo={photo} dimmed={stage.step === 'processing'} compact={stage.step === 'result'} />
      )}

      {stage.step === 'preview' && (
        <div className="space-y-3">
          <button type="button" onClick={() => extract(stage.photo)} className="btn-primary h-14 w-full text-base">
            Read ingredients
          </button>
          <PhotoPicker onSelect={selectPhoto} variant="compact" />
        </div>
      )}

      {stage.step === 'processing' && (
        <Processing onCancel={() => cancel(stage.photo)} />
      )}

      {stage.step === 'error' && (
        <ErrorState
          title={ERROR_TITLES[stage.error.code] ?? 'Couldn’t read this photo'}
          message={stage.error.message}
          onRetry={stage.error.code === 'no_text_found' ? undefined : () => extract(stage.photo)}
        >
          <button type="button" onClick={startOver} className="btn-secondary">
            Use a different photo
          </button>
        </ErrorState>
      )}

      {stage.step === 'result' && (
        <>
          <ExtractedIngredients key={stage.photo.url} result={stage.result} />
          <button type="button" onClick={startOver} className="btn-secondary w-full">
            Photograph another label
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
        className={`w-full bg-ink/5 object-contain transition-opacity ${compact ? 'max-h-48' : 'max-h-[55vh]'} ${dimmed ? 'opacity-50' : ''}`}
      />
      <figcaption className="flex justify-between gap-2 border-t border-line px-4 py-2 text-xs text-muted">
        <span className="truncate">{photo.source === 'camera' ? 'Photo taken' : photo.file.name}</span>
        <span className="shrink-0">{formatFileSize(photo.file.size)}</span>
      </figcaption>
    </figure>
  )
}

function Processing({ onCancel }: { onCancel: () => void }) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), SLOW_PROCESSING_MS)
    return () => clearTimeout(timer)
  }, [])

  return (
    <div className="rounded-2xl border border-line bg-surface p-5 text-center">
      <div role="status" className="flex items-center justify-center gap-3">
        <span
          className="size-5 rounded-full border-2 border-brand-200 border-t-brand-600 motion-safe:animate-spin"
          aria-hidden="true"
        />
        <span className="font-medium">Reading the label…</span>
      </div>
      <p className="mt-2 text-sm text-muted" aria-live="polite">
        {slow
          ? 'Still working. If the service has been idle it can take up to a minute to start.'
          : 'This usually takes a few seconds.'}
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
        <li>Fill the frame with the ingredients list only.</li>
        <li>Use good, even light and avoid glare on shiny packaging.</li>
        <li>Hold the camera straight and make sure the text is in focus.</li>
        <li>Flatten curved or crumpled packaging if you can.</li>
      </ul>
    </div>
  )
}
