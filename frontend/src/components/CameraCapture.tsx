import { useEffect, useId, useRef, useState } from 'react'
import {
  CAMERA_ERRORS,
  cameraPreflightError,
  classifyCameraError,
  type CameraErrorKind,
} from '../lib/camera'
import { CameraIcon, CloseIcon, UploadIcon } from './icons'

type CaptureState =
  | { status: 'starting' }
  | { status: 'ready' }
  | { status: 'error'; kind: CameraErrorKind }

interface CameraCaptureProps {
  onCapture: (photo: File) => void
  onClose: () => void
  onUploadInstead: () => void
}

/**
 * In-page camera for taking a still photo, used on devices without a native camera app (laptops
 * and desktops). The camera stream is stopped on capture, cancel and unmount.
 */
export function CameraCapture({ onCapture, onClose, onUploadInstead }: CameraCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<CaptureState>(() => {
    const kind = cameraPreflightError()
    return kind ? { status: 'error', kind } : { status: 'starting' }
  })
  const titleId = useId()

  useEffect(() => {
    if (cameraPreflightError()) return
    let cancelled = false

    navigator.mediaDevices
      .getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      })
      .then(async (stream) => {
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
        }
        if (!cancelled) setState({ status: 'ready' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', kind: classifyCameraError(error) })
      })

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [attempt])

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null
    closeButtonRef.current?.focus()
    const { overflow } = document.body.style
    document.body.style.overflow = 'hidden'
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = overflow
      previouslyFocused?.focus?.()
    }
  }, [onClose])

  function takePhoto() {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext('2d')?.drawImage(video, 0, 0)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setState({ status: 'error', kind: 'unknown' })
          return
        }
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = null
        onCapture(new File([blob], `ingredients-${Date.now()}.jpg`, { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  const error = state.status === 'error' ? CAMERA_ERRORS[state.kind] : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <h2 id={titleId} className="text-lg font-semibold">
          Photograph the label
        </h2>
        <button
          ref={closeButtonRef}
          type="button"
          onClick={onClose}
          className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white/15 px-4 text-sm font-medium hover:bg-white/25 focus-visible:outline-white"
        >
          <CloseIcon className="size-4" />
          Cancel
        </button>
      </div>

      <div className="relative flex-1 overflow-hidden">
        <video
          ref={videoRef}
          className={`absolute inset-0 size-full object-contain ${error ? 'hidden' : ''}`}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
        />
        {error && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <h3 className="text-lg font-semibold">{error.title}</h3>
              <p className="mt-2 text-sm text-white/75">
                {error.message} You can upload a photo instead.
              </p>
              <div className="mt-5 flex flex-col gap-2">
                {error.canRetry && (
                  <button
                    type="button"
                    onClick={() => {
                      setState({ status: 'starting' })
                      setAttempt((n) => n + 1)
                    }}
                    className="h-12 rounded-xl bg-white font-semibold text-ink hover:bg-brand-50"
                  >
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  onClick={onUploadInstead}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/30 font-semibold hover:bg-white/10"
                >
                  <UploadIcon className="size-5" />
                  Upload a photo
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {!error && (
        <div className="flex flex-col items-center gap-3 px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
          <p aria-live="polite" className="text-center text-sm text-white/80">
            {state.status === 'starting'
              ? 'Starting camera… Your browser may ask for permission.'
              : 'Fill the frame with the ingredients list and keep it in focus.'}
          </p>
          <button
            type="button"
            onClick={takePhoto}
            disabled={state.status !== 'ready'}
            className="inline-flex h-14 items-center gap-2 rounded-full bg-white px-8 font-semibold text-ink hover:bg-brand-50 disabled:opacity-50"
          >
            <CameraIcon className="size-5" />
            Take photo
          </button>
        </div>
      )}
    </div>
  )
}
