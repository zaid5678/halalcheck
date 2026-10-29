import { describe, expect, it } from 'vitest'
import { validateBarcode } from './barcode'

describe('validateBarcode', () => {
  it.each([
    ['12345678', '12345678'],
    ['0012345678905', '0012345678905'],
    ['5 000112 637922', '5000112637922'],
    ['036000-291452', '036000291452'],
  ])('accepts %s', (raw, expected) => {
    expect(validateBarcode(raw)).toEqual({ ok: true, barcode: expected })
  })

  it('keeps leading zeros', () => {
    const result = validateBarcode('00000123')
    expect(result.ok && result.barcode).toBe('00000123')
  })

  it.each([
    ['', 'Enter the number'],
    ['12a45678', 'only contain digits'],
    ['1234567', 'This one has 7'],
    ['123456789012345', 'This one has 15'],
  ])('rejects %j', (raw, message) => {
    const result = validateBarcode(raw)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toContain(message)
  })
})
