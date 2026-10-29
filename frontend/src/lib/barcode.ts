// Barcodes are always strings: "0012345678905" and "12345678905" are different products.

export const BARCODE_MIN_LENGTH = 8
export const BARCODE_MAX_LENGTH = 14

export type BarcodeValidation = { ok: true; barcode: string } | { ok: false; error: string }

/** Remove the spaces and hyphens people often type when copying a barcode from packaging. */
export function normaliseBarcode(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export function validateBarcode(raw: string): BarcodeValidation {
  const barcode = normaliseBarcode(raw)
  if (barcode === '') {
    return { ok: false, error: 'Enter the number printed under the barcode.' }
  }
  if (!/^\d+$/.test(barcode)) {
    return { ok: false, error: 'A barcode can only contain digits (0–9).' }
  }
  if (barcode.length < BARCODE_MIN_LENGTH || barcode.length > BARCODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Barcodes are usually 8, 12 or 13 digits long. This one has ${barcode.length}.`,
    }
  }
  return { ok: true, barcode }
}

export function isPlausibleBarcode(raw: string): boolean {
  return validateBarcode(raw).ok
}
