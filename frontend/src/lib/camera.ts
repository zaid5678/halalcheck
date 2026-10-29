// Shared camera helpers for the barcode scanner and the ingredients photo capture.

export type CameraErrorKind =
  | 'insecure'
  | 'unsupported'
  | 'permission'
  | 'no-camera'
  | 'in-use'
  | 'unknown'

export interface CameraErrorInfo {
  title: string
  message: string
  canRetry: boolean
}

export const CAMERA_ERRORS: Record<CameraErrorKind, CameraErrorInfo> = {
  insecure: {
    title: 'Camera needs a secure connection',
    message: 'Browsers only allow camera access on pages served over HTTPS.',
    canRetry: false,
  },
  unsupported: {
    title: 'Camera isn’t supported in this browser',
    message: 'Try an up-to-date version of Chrome, Safari or Firefox.',
    canRetry: false,
  },
  permission: {
    title: 'Camera access was blocked',
    message: 'Allow camera access for this site in your browser settings, then try again.',
    canRetry: true,
  },
  'no-camera': {
    title: 'No camera found',
    message: 'We couldn’t find a camera on this device.',
    canRetry: true,
  },
  'in-use': {
    title: 'Camera is unavailable',
    message: 'Your camera may be in use by another app or tab. Close it and try again.',
    canRetry: true,
  },
  unknown: {
    title: 'Couldn’t start the camera',
    message: 'Something went wrong while starting the camera. Please try again.',
    canRetry: true,
  },
}

/**
 * Read an error's name without relying on its class: camera errors are DOMExceptions in most
 * browsers, but Chrome's OverconstrainedError has historically not extended Error at all.
 */
function errorName(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'name' in error) {
    const { name } = error as { name: unknown }
    return typeof name === 'string' ? name : ''
  }
  return ''
}

export function classifyCameraError(error: unknown): CameraErrorKind {
  switch (errorName(error)) {
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

/** Problems that make the camera unusable before even asking for permission. */
export function cameraPreflightError(): CameraErrorKind | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
  return null
}

/**
 * Open the rear camera at a high resolution. At the browser default (often 640×480) a barcode
 * held far enough away to be in focus is only a few pixels per bar; 1080p gives the decoder
 * enough detail to read it from further back.
 */
export async function openRearCamera(): Promise<MediaStream> {
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
  } catch (error) {
    // Some cameras reject the resolution request; retry with no size preference.
    if (errorName(error) === 'OverconstrainedError') {
      return navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' } },
      })
    }
    throw error
  }
}

// Camera focus and zoom controls are not in TypeScript's DOM types yet.
interface ExtendedCapabilities extends MediaTrackCapabilities {
  focusMode?: string[]
  zoom?: { min: number; max: number; step?: number }
}

export interface ZoomRange {
  min: number
  max: number
}

function capabilities(track: MediaStreamTrack): ExtendedCapabilities {
  try {
    return (track.getCapabilities?.() ?? {}) as ExtendedCapabilities
  } catch {
    return {}
  }
}

/** Switch on continuous autofocus where the browser and camera allow it. */
export async function enableContinuousFocus(track: MediaStreamTrack): Promise<void> {
  if (!capabilities(track).focusMode?.includes('continuous')) return
  try {
    await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] })
  } catch {
    // Unsupported in practice; the camera keeps its default focus.
  }
}

/** The camera's zoom range, if it can zoom (most Android phones in Chrome). */
export function zoomRange(track: MediaStreamTrack): ZoomRange | null {
  const zoom = capabilities(track).zoom
  if (!zoom || !(zoom.max > zoom.min)) return null
  return { min: zoom.min, max: zoom.max }
}

export async function setZoom(track: MediaStreamTrack, level: number): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ zoom: level } as MediaTrackConstraintSet] })
    return true
  } catch {
    return false
  }
}

export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((track) => track.stop())
}

/**
 * Phones and tablets have a far better native camera (autofocus, flash, full resolution) than
 * an in-page video stream, so on touch devices photos are taken through the system camera.
 */
export function prefersNativeCamera(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}
