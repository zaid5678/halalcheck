import type { HalalVerdict } from '../types/halal'
import { apiRequest } from './api'

export function checkBarcode(barcode: string, signal?: AbortSignal): Promise<HalalVerdict> {
  return apiRequest<HalalVerdict>(`/api/halal/barcode/${encodeURIComponent(barcode)}`, { signal })
}
