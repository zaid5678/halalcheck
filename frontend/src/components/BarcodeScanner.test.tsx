import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockApi, renderApp } from '../test/utils'
import { BarcodeScanner } from './BarcodeScanner'

type ZxingCallback = (result: { getText: () => string } | undefined) => void

// The real decoders need camera frames; replace zxing with one the tests drive by hand.
const zxing = vi.hoisted(() => ({
  decodeFromVideoElement: vi.fn(),
  hints: [] as Map<unknown, unknown>[],
}))

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    constructor(hints: Map<unknown, unknown>) {
      zxing.hints.push(hints)
    }
    decodeFromVideoElement = zxing.decodeFromVideoElement
  },
}))

interface FakeTrackOptions {
  capabilities?: Record<string, unknown>
}

function fakeCamera({ capabilities = {} }: FakeTrackOptions = {}) {
  const track = {
    stop: vi.fn(),
    getCapabilities: vi.fn(() => capabilities),
    applyConstraints: vi.fn().mockResolvedValue(undefined),
  }
  const stream = { getTracks: () => [track], getVideoTracks: () => [track] }
  return { track, stream: stream as unknown as MediaStream }
}

let getUserMedia: ReturnType<typeof vi.fn>

/** A zxing decoder that starts successfully; ``emit`` simulates a decoded frame. */
function zxingStarts() {
  const controls = { stop: vi.fn() }
  let callback: ZxingCallback = () => {}
  zxing.decodeFromVideoElement.mockImplementation((_video: unknown, cb: ZxingCallback) => {
    callback = cb
    return Promise.resolve(controls)
  })
  return {
    controls,
    emit: (text: string) => act(() => callback({ getText: () => text })),
    emitNothing: () => act(() => callback(undefined)),
  }
}

function cameraFails(name: string) {
  getUserMedia.mockRejectedValue(new DOMException('camera error', name))
}

function renderScanner() {
  const props = { onDetected: vi.fn(), onClose: vi.fn(), onManualEntry: vi.fn() }
  return { props, user: userEvent.setup(), ...render(<BarcodeScanner {...props} />) }
}

beforeEach(() => {
  zxing.hints = []
  zxing.decodeFromVideoElement.mockReset()
  getUserMedia = vi.fn().mockResolvedValue(fakeCamera().stream)
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices')
  Reflect.deleteProperty(globalThis, 'BarcodeDetector')
})

describe('BarcodeScanner camera setup', () => {
  it('requests a high-resolution rear camera so distant barcodes stay readable', async () => {
    zxingStarts()
    renderScanner()

    await screen.findByText(/20–30 cm away/)
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
      },
    })
  })

  it('falls back to default resolution if the camera rejects 1080p', async () => {
    const camera = fakeCamera()
    getUserMedia
      .mockReset()
      .mockRejectedValueOnce(new DOMException('too big', 'OverconstrainedError'))
      .mockResolvedValueOnce(camera.stream)
    zxingStarts()
    renderScanner()

    await screen.findByText(/20–30 cm away/)
    expect(getUserMedia).toHaveBeenLastCalledWith({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    })
  })

  it('turns on continuous autofocus and starts zoomed in when supported', async () => {
    const camera = fakeCamera({
      capabilities: { focusMode: ['manual', 'continuous'], zoom: { min: 1, max: 8 } },
    })
    getUserMedia.mockResolvedValue(camera.stream)
    zxingStarts()
    const { user } = renderScanner()

    const zoomGroup = await screen.findByRole('group', { name: 'Camera zoom' })
    expect(camera.track.applyConstraints).toHaveBeenCalledWith({
      advanced: [{ focusMode: 'continuous' }],
    })
    expect(camera.track.applyConstraints).toHaveBeenCalledWith({ advanced: [{ zoom: 2 }] })
    expect(within(zoomGroup).getByRole('button', { name: '2×' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )

    await user.click(within(zoomGroup).getByRole('button', { name: '1×' }))
    expect(camera.track.applyConstraints).toHaveBeenLastCalledWith({ advanced: [{ zoom: 1 }] })
    expect(within(zoomGroup).getByRole('button', { name: '1×' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('only offers zoom levels the camera supports', async () => {
    const camera = fakeCamera({ capabilities: { zoom: { min: 1, max: 2.5 } } })
    getUserMedia.mockResolvedValue(camera.stream)
    zxingStarts()
    renderScanner()

    const zoomGroup = await screen.findByRole('group', { name: 'Camera zoom' })
    expect(within(zoomGroup).getAllByRole('button').map((b) => b.textContent)).toEqual(['1×', '2×'])
  })

  it('hides zoom controls when the camera cannot zoom', async () => {
    zxingStarts()
    renderScanner()

    await screen.findByText(/20–30 cm away/)
    expect(screen.queryByRole('group', { name: 'Camera zoom' })).not.toBeInTheDocument()
  })
})

describe('BarcodeScanner decoding', () => {
  it('uses zxing in "try harder" mode and reports a detected barcode', async () => {
    const camera = fakeCamera()
    getUserMedia.mockResolvedValue(camera.stream)
    const decoder = zxingStarts()
    const { props } = renderScanner()
    await screen.findByText(/20–30 cm away/)

    expect([...zxing.hints[0].values()]).toContain(true)
    decoder.emitNothing()
    expect(props.onDetected).not.toHaveBeenCalled()

    decoder.emit('0012345678905')
    expect(props.onDetected).toHaveBeenCalledExactlyOnceWith('0012345678905')
    expect(decoder.controls.stop).toHaveBeenCalled()
    expect(camera.track.stop).toHaveBeenCalled()

    // Further frames after detection are ignored.
    decoder.emit('5000112637922')
    expect(props.onDetected).toHaveBeenCalledTimes(1)
  })

  it('ignores values that are not retail barcodes', async () => {
    const camera = fakeCamera()
    getUserMedia.mockResolvedValue(camera.stream)
    const decoder = zxingStarts()
    const { props } = renderScanner()
    await screen.findByText(/20–30 cm away/)

    decoder.emit('HELLO')
    expect(props.onDetected).not.toHaveBeenCalled()
    expect(camera.track.stop).not.toHaveBeenCalled()
  })

  it('prefers the browser’s built-in barcode detector when available', async () => {
    const detect = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([{ rawValue: '5000112637922' }])
    class FakeBarcodeDetector {
      static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code', 'ean_13', 'upc_a'])
      constructor(options: { formats: string[] }) {
        expect(options.formats).toEqual(['ean_13', 'upc_a'])
      }
      detect = detect
    }
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: FakeBarcodeDetector,
    })
    // jsdom videos never have frame data; pretend a frame is ready.
    vi.spyOn(HTMLMediaElement.prototype, 'readyState', 'get').mockReturnValue(4)
    const camera = fakeCamera()
    getUserMedia.mockResolvedValue(camera.stream)
    const { props } = renderScanner()

    await vi.waitFor(() => expect(props.onDetected).toHaveBeenCalledWith('5000112637922'))
    expect(zxing.decodeFromVideoElement).not.toHaveBeenCalled()
    expect(camera.track.stop).toHaveBeenCalled()
  })

  it('falls back to zxing when the built-in detector lacks retail formats', async () => {
    Object.defineProperty(globalThis, 'BarcodeDetector', {
      configurable: true,
      value: class {
        static getSupportedFormats = vi.fn().mockResolvedValue(['qr_code'])
      },
    })
    zxingStarts()
    renderScanner()

    await screen.findByText(/20–30 cm away/)
    expect(zxing.decodeFromVideoElement).toHaveBeenCalled()
  })
})

describe('BarcodeScanner cleanup and errors', () => {
  it('releases the camera when cancelled', async () => {
    const camera = fakeCamera()
    getUserMedia.mockResolvedValue(camera.stream)
    const decoder = zxingStarts()
    const { props, user, unmount } = renderScanner()
    await screen.findByText(/20–30 cm away/)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onClose).toHaveBeenCalled()

    unmount()
    expect(decoder.controls.stop).toHaveBeenCalled()
    expect(camera.track.stop).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    zxingStarts()
    const { props, user } = renderScanner()

    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('stops a camera that finishes starting after the scanner was closed', async () => {
    const camera = fakeCamera()
    let resolveStream!: (stream: MediaStream) => void
    getUserMedia.mockReturnValue(new Promise((resolve) => (resolveStream = resolve)))
    const { unmount } = renderScanner()

    unmount()
    await act(async () => resolveStream(camera.stream))
    expect(camera.track.stop).toHaveBeenCalled()
    expect(zxing.decodeFromVideoElement).not.toHaveBeenCalled()
  })

  it('explains denied permission and offers retry', async () => {
    cameraFails('NotAllowedError')
    const { props, user } = renderScanner()

    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was blocked')

    getUserMedia.mockResolvedValue(fakeCamera().stream)
    const decoder = zxingStarts()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/20–30 cm away/)).toBeInTheDocument()
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    decoder.emit('12345678')
    expect(props.onDetected).toHaveBeenCalledWith('12345678')
  })

  it('offers manual entry when scanning fails', async () => {
    cameraFails('NotAllowedError')
    const { props, user } = renderScanner()
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /enter barcode manually/i }))
    expect(props.onManualEntry).toHaveBeenCalled()
  })

  it.each([
    ['NotFoundError', 'No camera found'],
    ['NotReadableError', 'Camera is unavailable'],
    ['SomethingElse', 'Couldn’t start the camera'],
  ])('handles %s', async (name, title) => {
    cameraFails(name)
    renderScanner()
    expect(await screen.findByRole('alert')).toHaveTextContent(title)
  })

  it('explains unsupported browsers without requesting the camera', () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    renderScanner()

    expect(screen.getByRole('alert')).toHaveTextContent('Camera isn’t supported in this browser')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it('explains that HTTPS is required on insecure origins', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    renderScanner()

    expect(screen.getByRole('alert')).toHaveTextContent('Camera needs a secure connection')
    expect(getUserMedia).not.toHaveBeenCalled()
  })
})

describe('scanning from the home page', () => {
  it('only requests the camera after "Scan barcode" and shows the detected barcode', async () => {
    const fetchMock = mockApi(() => undefined)
    const camera = fakeCamera()
    getUserMedia.mockResolvedValue(camera.stream)
    const decoder = zxingStarts()
    const { user } = renderApp()

    expect(getUserMedia).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Scan barcode' }))
    expect(await screen.findByRole('dialog', { name: 'Scan a barcode' })).toBeInTheDocument()
    await screen.findByText(/20–30 cm away/)

    decoder.emit('0012345678905')

    // The barcode is shown as read, leading zeros included, without any network request.
    expect(await screen.findByText('Barcode detected')).toBeInTheDocument()
    expect(screen.getByText('0012345678905')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(camera.track.stop).toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()

    // Scanning again reopens the camera and clears the previous result.
    const secondCamera = fakeCamera()
    getUserMedia.mockResolvedValue(secondCamera.stream)
    await user.click(screen.getByRole('button', { name: 'Scan again' }))
    expect(await screen.findByRole('dialog', { name: 'Scan a barcode' })).toBeInTheDocument()
    expect(screen.queryByText('Barcode detected')).not.toBeInTheDocument()
    await screen.findByText(/20–30 cm away/)
    expect(getUserMedia).toHaveBeenCalledTimes(2)
  })
})
