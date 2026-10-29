import { BrowserMultiFormatReader, type IScannerControls } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'
import { useEffect, useId, useRef, useState } from 'react'
import { isPlausibleBarcode } from '../lib/barcode'
import { CloseIcon, KeypadIcon } from './icons'

export type ScanErrorKind = 'insecure' | 'unsupported' | 'permission' | 'no-camera' | 'in-use' | 'unknown'

type ScanStatus = { status: 'starting' } | { status: 'scanning' } | { status: 'error'; kind: ScanErrorKind }

const RETAIL_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
]

const ERROR_MESSAGES: Record<ScanErrorKind, { title: string; message: string; canRetry: boolean }> = {
  insecure: {
    title: 'Camera needs a secure connection',
    message:
      'Browsers only allow camera access on pages served over HTTPS. Open HalalCheck over HTTPS, or enter the barcode manually.',
    canRetry: false,
  },
  unsupported: {
    title: 'Scanning isn’t supported in this browser',
    message:
      'This browser can’t access a camera. Try an up-to-date version of Chrome, Safari or Firefox, or enter the barcode manually.',
    canRetry: false,
  },
  permission: {
    title: 'Camera access was blocked',
    message:
      'To scan, allow camera access for this site in your browser settings and try again. You can also enter the barcode manually.',
    canRetry: true,
  },
  'no-camera': {
    title: 'No camera found',
    message: 'We couldn’t find a camera on this device. You can enter the barcode manually instead.',
    canRetry: true,
  },
  'in-use': {
    title: 'Camera is unavailable',
    message:
      'Your camera may be in use by another app or tab. Close it and try again, or enter the barcode manually.',
    canRetry: true,
  },
  unknown: {
    title: 'Couldn’t start the camera',
    message: 'Something went wrong while starting the scanner. Try again, or enter the barcode manually.',
    canRetry: true,
  },
}

function classifyCameraError(error: unknown): ScanErrorKind {
  const name = error instanceof Error || error instanceof DOMException ? error.name : ''
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return 'permission'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return 'no-camera'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'in-use'
    default:
      return 'unknown'
  }
}

function preflightError(): ScanErrorKind | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
  return null
}

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
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<ScanStatus>(() => {
    const kind = preflightError()
    return kind ? { status: 'error', kind } : { status: 'starting' }
  })
  const titleId = useId()
  const statusId = useId()

  // Keep the latest callback without restarting the camera when the parent re-renders.
  const onDetectedRef = useRef(onDetected)
  useEffect(() => {
    onDetectedRef.current = onDetected
  }, [onDetected])

  useEffect(() => {
    // Preflight failures are already reflected in the initial state.
    if (preflightError() || !videoRef.current) return

    let cancelled = false
    let detected = false
    let controls: IScannerControls | null = null

    const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.POSSIBLE_FORMATS, RETAIL_FORMATS]])
    const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 })

    reader
      .decodeFromConstraints(
        { audio: false, video: { facingMode: { ideal: 'environment' } } },
        videoRef.current,
        (result, _error, scanControls) => {
          // Per-frame "nothing found" errors are expected while the user lines up the barcode.
          if (!result || detected || cancelled) return
          const text = result.getText()
          if (!isPlausibleBarcode(text)) return
          detected = true
          scanControls.stop()
          onDetectedRef.current(text)
        },
      )
      .then((scanControls) => {
        if (cancelled || detected) {
          scanControls.stop()
          return
        }
        controls = scanControls
        setState({ status: 'scanning' })
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: 'error', kind: classifyCameraError(error) })
      })

    return () => {
      cancelled = true
      controls?.stop()
    }
  }, [attempt])

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

  const error = state.status === 'error' ? ERROR_MESSAGES[state.kind] : null

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
        <p id={statusId} aria-live="polite" className="text-sm text-white/80">
          {state.status === 'starting' && 'Starting camera… Your browser may ask for permission.'}
          {state.status === 'scanning' &&
            'Hold the barcode inside the frame. It will be detected automatically.'}
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
