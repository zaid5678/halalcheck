import { useEffect, useId, useRef, useState } from 'react'
import { isPlausibleBarcode } from '../lib/barcode'
import { startBarcodeDecoder, type BarcodeDecoder } from '../lib/barcodeDetection'
import {
  CAMERA_ERRORS,
  cameraPreflightError,
  classifyCameraError,
  enableContinuousFocus,
  openRearCamera,
  setZoom,
  stopStream,
  zoomRange,
  type CameraErrorKind,
  type ZoomRange,
} from '../lib/camera'
import { CloseIcon, KeypadIcon } from './icons'

type ScanStatus =
  | { status: 'starting' }
  | { status: 'scanning' }
  | { status: 'error'; kind: CameraErrorKind }

/**
 * Phones can't focus on a barcode held very close, so where the camera can zoom we start
 * zoomed in: people naturally hold the phone further back, where the barcode is sharp.
 */
const DEFAULT_ZOOM = 2
const ZOOM_LEVELS = [1, 2, 3]

interface BarcodeScannerProps {
  onDetected: (barcode: string) => void
  onClose: () => void
  onManualEntry: () => void
}

/**
 * Full-screen camera scanner. The camera is only requested when this component mounts, and is
 * always released when a barcode is found, the user cancels, or the component unmounts.
 */
export function BarcodeScanner({ onDetected, onClose, onManualEntry }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ScanStatus>(() => {
    const kind = cameraPreflightError()
    return kind ? { status: 'error', kind } : { status: 'starting' }
  })
  const [zoom, setZoomState] = useState<{ range: ZoomRange; level: number } | null>(null)
  const titleId = useId()
  const statusId = useId()

  // Keep the latest callback without restarting the camera when the parent re-renders.
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    // Preflight failures are already reflected in the initial state.
    const video = videoRef.current
    if (cameraPreflightError() || !video) return

    let cancelled = false
    let detected = false
    let stream: MediaStream | null = null
    let decoder: BarcodeDecoder | null = null

    const release = () => {
      decoder?.stop()
      stopStream(stream)
      trackRef.current = null
    }

    const handleText = (text: string) => {
      if (detected || cancelled || !isPlausibleBarcode(text)) return
      detected = true
      release()
      onDetectedRef.current(text)
    }

    const start = async () => {
      stream = await openRearCamera()
      if (cancelled) return release()

      const [track] = stream.getVideoTracks()
      if (track) {
        trackRef.current = track
        await enableContinuousFocus(track)
        const range = zoomRange(track)
        if (range) {
          const level = Math.min(Math.max(DEFAULT_ZOOM, range.min), range.max)
          const applied = await setZoom(track, level)
          if (!cancelled) setZoomState({ range, level: applied ? level : range.min })
        }
      }

      video.srcObject = stream
      await video.play().catch(() => {})
      if (cancelled) return release()

      decoder = await startBarcodeDecoder(video, handleText)
      if (cancelled || detected) return release()
      setState({ status: 'scanning' })
    }

    start().catch((error: unknown) => {
      release()
      if (!cancelled) setState({ status: 'error', kind: classifyCameraError(error) })
    })

    return () => {
      cancelled = true
      release()
    }
  }, [attempt])

  async function changeZoom(level: number) {
    const track = trackRef.current
    if (!track || !zoom) return
    if (await setZoom(track, level)) setZoomState({ range: zoom.range, level })
  }

  // Dialog behaviour: focus the close button, close on Escape, and stop the page scrolling.
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

  const error = state.status === 'error' ? CAMERA_ERRORS[state.kind] : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={statusId}
      className="fixed inset-0 z-50 flex flex-col bg-black text-white"
    >
      <div className="flex items-center justify-between gap-3 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-3">
        <h2 id={titleId} className="text-lg font-semibold">
          Scan a barcode
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
          className={`absolute inset-0 size-full object-cover ${error ? 'hidden' : ''}`}
          muted
          playsInline
          autoPlay
          aria-hidden="true"
        />

        {!error && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="relative aspect-[1.6] w-[min(80vw,26rem)] rounded-2xl shadow-[0_0_0_100vmax_rgba(0,0,0,0.55)]">
              <span className="absolute -top-0.5 -left-0.5 size-8 rounded-tl-2xl border-t-4 border-l-4 border-brand-200" />
              <span className="absolute -top-0.5 -right-0.5 size-8 rounded-tr-2xl border-t-4 border-r-4 border-brand-200" />
              <span className="absolute -bottom-0.5 -left-0.5 size-8 rounded-bl-2xl border-b-4 border-l-4 border-brand-200" />
              <span className="absolute -right-0.5 -bottom-0.5 size-8 rounded-br-2xl border-r-4 border-b-4 border-brand-200" />
              {state.status === 'scanning' && (
                <span className="absolute inset-x-6 top-1/2 h-0.5 rounded bg-brand-200/80 motion-safe:animate-pulse" />
              )}
            </div>
          </div>
        )}

        {error && (
          <div role="alert" className="absolute inset-0 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <h3 className="text-lg font-semibold">{error.title}</h3>
              <p className="mt-2 text-sm text-white/75">{error.message}</p>
              <div className="mt-5 flex flex-col gap-2">
                {error.canRetry && (
                  <button
                    type="button"
                    onClick={() => {
                      setState({ status: 'starting' })
                      setZoomState(null)
                      setAttempt((n) => n + 1)
                    }}
                    className="h-12 rounded-xl bg-white font-semibold text-ink hover:bg-brand-50"
                  >
                    Try again
                  </button>
                )}
                <button
                  type="button"
                  onClick={onManualEntry}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-white/30 font-semibold hover:bg-white/10"
                >
                  <KeypadIcon className="size-5" />
                  Enter barcode manually
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center">
        {!error && zoom && (
          <div role="group" aria-label="Camera zoom" className="mb-3 inline-flex gap-1 rounded-full bg-white/15 p-1">
            {ZOOM_LEVELS.filter((level) => level >= zoom.range.min && level <= zoom.range.max).map(
              (level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => changeZoom(level)}
                  aria-pressed={zoom.level === level}
                  className={`h-10 min-w-12 rounded-full px-3 text-sm font-semibold ${
                    zoom.level === level ? 'bg-white text-ink' : 'text-white hover:bg-white/15'
                  }`}
                >
                  {level}×
                </button>
              ),
            )}
          </div>
        )}
        <p id={statusId} aria-live="polite" className="text-sm text-white/80">
          {state.status === 'starting' && 'Starting camera… Your browser may ask for permission.'}
          {state.status === 'scanning' &&
            'Hold the phone about 20–30 cm away with the barcode inside the frame. If it looks blurry, move further back.'}
          {state.status === 'error' && 'The camera is off.'}
        </p>
        {!error && (
          <button
            type="button"
            onClick={onManualEntry}
            className="mt-3 inline-flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-white/90 underline-offset-4 hover:underline"
          >
            <KeypadIcon className="size-4" />
            Type the barcode instead
          </button>
        )}
      </div>
    </div>
  )
}
