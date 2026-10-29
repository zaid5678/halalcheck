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

export function classifyCameraError(error: unknown): CameraErrorKind {
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

/** Problems that make the camera unusable before even asking for permission. */
export function cameraPreflightError(): CameraErrorKind | null {
  if (typeof window !== 'undefined' && window.isSecureContext === false) return 'insecure'
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return 'unsupported'
  return null
}

/**
 * Phones and tablets have a far better native camera (autofocus, flash, full resolution) than
 * an in-page video stream, so on touch devices photos are taken through the system camera.
 */
export function prefersNativeCamera(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(pointer: coarse)').matches
}
