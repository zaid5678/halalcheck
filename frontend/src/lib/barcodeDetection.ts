// Barcode decoding from a live <video>. Uses the browser's built-in BarcodeDetector where it
// supports retail formats (e.g. Chrome on Android), which copes far better with small or soft
// barcodes, and falls back to the zxing JavaScript decoder elsewhere (e.g. iOS Safari).

import { BrowserMultiFormatReader } from '@zxing/browser'
import { BarcodeFormat, DecodeHintType } from '@zxing/library'

export interface BarcodeDecoder {
  readonly kind: 'native' | 'zxing'
  stop: () => void
}

type OnDetected = (text: string) => void

const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e']
const ZXING_FORMATS = [
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
]
const SCAN_INTERVAL_MS = 120

// BarcodeDetector is not in TypeScript's DOM types yet.
interface DetectedBarcode {
  rawValue: string
}
interface NativeBarcodeDetector {
  detect(source: HTMLVideoElement): Promise<DetectedBarcode[]>
}
interface NativeBarcodeDetectorClass {
  new (options: { formats: string[] }): NativeBarcodeDetector
  getSupportedFormats(): Promise<string[]>
}

function nativeDetectorClass(): NativeBarcodeDetectorClass | undefined {
  return (globalThis as { BarcodeDetector?: NativeBarcodeDetectorClass }).BarcodeDetector
}

async function supportedNativeFormats(): Promise<string[]> {
  const Detector = nativeDetectorClass()
  if (!Detector) return []
  try {
    const supported = await Detector.getSupportedFormats()
    return NATIVE_FORMATS.filter((format) => supported.includes(format))
  } catch {
    return []
  }
}

function startNative(video: HTMLVideoElement, formats: string[], onDetected: OnDetected) {
  const Detector = nativeDetectorClass()!
  const detector = new Detector({ formats })
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const tick = async () => {
    if (stopped) return
    // HAVE_CURRENT_DATA: a frame is available to analyse.
    if (video.readyState >= 2) {
      try {
        const [barcode] = await detector.detect(video)
        if (!stopped && barcode?.rawValue) onDetected(barcode.rawValue)
      } catch {
        // A single failed frame (e.g. while the camera adjusts) is not fatal.
      }
    }
    if (!stopped) timer = setTimeout(tick, SCAN_INTERVAL_MS)
  }
  void tick()

  return {
    kind: 'native' as const,
    stop: () => {
      stopped = true
      clearTimeout(timer)
    },
  }
}

async function startZxing(video: HTMLVideoElement, onDetected: OnDetected) {
  const hints = new Map<DecodeHintType, unknown>([
    [DecodeHintType.POSSIBLE_FORMATS, ZXING_FORMATS],
    // Spend more effort per frame: helps with small, distant or slightly blurred barcodes.
    [DecodeHintType.TRY_HARDER, true],
  ])
  const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: SCAN_INTERVAL_MS })
  const controls = await reader.decodeFromVideoElement(video, (result) => {
    // Frames without a barcode report errors; those are expected and ignored.
    if (result) onDetected(result.getText())
  })
  return { kind: 'zxing' as const, stop: () => controls.stop() }
}

/** Start decoding frames from ``video``, which must already be showing the camera stream. */
export async function startBarcodeDecoder(
  video: HTMLVideoElement,
  onDetected: OnDetected,
): Promise<BarcodeDecoder> {
  const formats = await supportedNativeFormats()
  if (formats.length > 0) return startNative(video, formats, onDetected)
  return startZxing(video, onDetected)
}
