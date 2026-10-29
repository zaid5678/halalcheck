import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nutellaProduct } from '../test/fixtures'
import { mockApi, renderApp } from '../test/utils'
import { BarcodeScanner } from './BarcodeScanner'

type Callback = (
  result: { getText: () => string } | undefined,
  error: unknown,
  controls: { stop: () => void },
) => void

// The real reader needs a camera; replace it with one the tests drive by hand.
const zxing = vi.hoisted(() => ({
  decodeFromConstraints: vi.fn(),
  constructed: 0,
}))

vi.mock('@zxing/browser', () => ({
  BrowserMultiFormatReader: class {
    constructor() {
      zxing.constructed += 1
    }
    decodeFromConstraints = zxing.decodeFromConstraints
  },
}))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Simulates a camera that starts successfully. Returns hooks to emit frames. */
function cameraStarts() {
  const controls = { stop: vi.fn() }
  let callback: Callback = () => {}
  zxing.decodeFromConstraints.mockImplementation((_c: unknown, _v: unknown, cb: Callback) => {
    callback = cb
    return Promise.resolve(controls)
  })
  return {
    controls,
    emit: (text: string) => act(() => callback({ getText: () => text }, undefined, controls)),
    emitNothing: () => act(() => callback(undefined, new Error('NotFoundException'), controls)),
  }
}

function cameraFails(name: string) {
  zxing.decodeFromConstraints.mockRejectedValue(new DOMException('camera error', name))
}

function renderScanner() {
  const props = { onDetected: vi.fn(), onClose: vi.fn(), onManualEntry: vi.fn() }
  return { props, user: userEvent.setup(), ...render(<BarcodeScanner {...props} />) }
}

beforeEach(() => {
  zxing.constructed = 0
  zxing.decodeFromConstraints.mockReset()
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn() },
  })
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true })
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'mediaDevices')
})

describe('BarcodeScanner', () => {
  it('requests the rear camera and reports a detected barcode', async () => {
    const camera = cameraStarts()
    const { props } = renderScanner()

    expect(await screen.findByText(/hold the barcode inside the frame/i)).toBeInTheDocument()
    expect(zxing.decodeFromConstraints.mock.calls[0][0]).toEqual({
      audio: false,
      video: { facingMode: { ideal: 'environment' } },
    })

    camera.emitNothing()
    expect(props.onDetected).not.toHaveBeenCalled()

    camera.emit('0012345678905')
    expect(camera.controls.stop).toHaveBeenCalled()
    expect(props.onDetected).toHaveBeenCalledExactlyOnceWith('0012345678905')

    // Further frames after detection are ignored.
    camera.emit('5000112637922')
    expect(props.onDetected).toHaveBeenCalledTimes(1)
  })

  it('ignores values that are not retail barcodes', async () => {
    const camera = cameraStarts()
    const { props } = renderScanner()
    await screen.findByText(/hold the barcode/i)

    camera.emit('HELLO')
    expect(props.onDetected).not.toHaveBeenCalled()
    expect(camera.controls.stop).not.toHaveBeenCalled()
  })

  it('releases the camera when cancelled', async () => {
    const camera = cameraStarts()
    const { props, user, unmount } = renderScanner()
    await screen.findByText(/hold the barcode/i)

    await user.click(screen.getByRole('button', { name: /cancel/i }))
    expect(props.onClose).toHaveBeenCalled()

    unmount()
    expect(camera.controls.stop).toHaveBeenCalled()
  })

  it('closes on Escape', async () => {
    cameraStarts()
    const { props, user } = renderScanner()

    await user.keyboard('{Escape}')
    expect(props.onClose).toHaveBeenCalled()
  })

  it('stops a camera that finishes starting after the scanner was closed', async () => {
    const controls = { stop: vi.fn() }
    const pending = deferred<typeof controls>()
    zxing.decodeFromConstraints.mockReturnValue(pending.promise)
    const { unmount } = renderScanner()

    unmount()
    await act(async () => pending.resolve(controls))
    expect(controls.stop).toHaveBeenCalled()
  })

  it('explains denied permission and offers retry and manual entry', async () => {
    cameraFails('NotAllowedError')
    const { props, user } = renderScanner()

    expect(await screen.findByRole('alert')).toHaveTextContent('Camera access was blocked')

    const camera = cameraStarts()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(/hold the barcode/i)).toBeInTheDocument()
    expect(zxing.decodeFromConstraints).toHaveBeenCalledTimes(2)
    camera.emit('12345678')
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

  it('explains unsupported browsers without starting the reader', () => {
    Reflect.deleteProperty(navigator, 'mediaDevices')
    renderScanner()

    expect(screen.getByRole('alert')).toHaveTextContent('Camera isn’t supported in this browser')
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(zxing.constructed).toBe(0)
  })

  it('explains that HTTPS is required on insecure origins', () => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: false })
    renderScanner()

    expect(screen.getByRole('alert')).toHaveTextContent('Camera needs a secure connection')
    expect(zxing.constructed).toBe(0)
  })
})

describe('scanning from the home page', () => {
  it('only requests the camera after "Scan barcode" and looks up the detected product', async () => {
    const fetchMock = mockApi(() => ({ body: nutellaProduct }))
    const camera = cameraStarts()
    const { user } = renderApp()

    expect(zxing.decodeFromConstraints).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Scan barcode' }))
    expect(await screen.findByRole('dialog', { name: 'Scan a barcode' })).toBeInTheDocument()
    await screen.findByText(/hold the barcode/i)

    camera.emit('0098008952506')

    expect(await screen.findByRole('heading', { level: 1, name: 'Nutella' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(camera.controls.stop).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/products/barcode/0098008952506')
  })
})
