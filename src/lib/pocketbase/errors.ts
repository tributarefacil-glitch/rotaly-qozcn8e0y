import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ClientResponseError)) return {}
  const data = error.response?.data
  if (!data || typeof data !== 'object') return {}

  const result: FieldErrors = {}
  for (const [key, val] of Object.entries(data)) {
    if (val && typeof val === 'object' && 'message' in val) {
      result[key] = String((val as { message: string }).message)
    } else if (typeof val === 'string') {
      result[key] = val
    }
  }
  return result
}

export function getErrorMessage(error: unknown, fallbackMessage?: string): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error
      ? error.message
      : fallbackMessage || 'An unexpected error occurred.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  return msgs.length > 0
    ? msgs.join(' ')
    : error.message || fallbackMessage || 'An unexpected error occurred.'
}
