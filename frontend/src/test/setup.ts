import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

// jsdom does not implement scrolling, object URLs or media playback.
window.scrollTo = () => {}
let objectUrlCount = 0
URL.createObjectURL = () => `blob:test/${++objectUrlCount}`
URL.revokeObjectURL = () => {}
HTMLMediaElement.prototype.play = () => Promise.resolve()
