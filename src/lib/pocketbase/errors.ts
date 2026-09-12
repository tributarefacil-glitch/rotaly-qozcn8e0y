import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

export function extractFieldErrors(error: unknown): FieldErrors {
  if (!(error instanceof ClientResponseError)) return {}
  const data = error.response?.data
  if (!data || typeof data !== 'object') return {}
  const errors: FieldErrors = {}
  for (const [field, detail] of Object.entries(data)) {
    if (
      detail &&
      typeof detail === 'object' &&
      'message' in detail &&
      typeof (detail as { message: unknown }).message === 'string'
    ) {
      errors[field] = (detail as { message: string }).message
    }
  }
  return errors
}

export function getErrorMessage(error: unknown, fallback?: string): string {
  if (!(error instanceof ClientResponseError)) {
    if (error instanceof Error && error.message) {
      return error.message
    }
    return fallback || 'Ocorreu um erro inesperado.'
  }

  // Handle common HTTP status codes with user-friendly PT-BR messages
  if (error.status === 400) {
    const msgs = Object.values(extractFieldErrors(error))
    if (msgs.length > 0) return msgs.join(' ')
    if (error.message && !error.message.includes('Something went wrong')) {
      return error.message
    }
    return fallback || 'Dados inválidos ou credenciais incorretas.'
  }

  if (error.status === 401 || error.status === 403) {
    return 'E-mail ou senha incorretos. Verifique suas credenciais.'
  }

  if (error.status === 0 || error.status === 502 || error.status === 503 || error.status === 504) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão ou tente novamente mais tarde.'
  }

  const msgs = Object.values(extractFieldErrors(error))
  if (msgs.length > 0) return msgs.join(' ')

  if (
    error.message &&
    error.message !== 'Something went wrong.' &&
    error.message !== 'Failed to authenticate.'
  ) {
    return error.message
  }

  return fallback || 'Falha ao processar solicitação. Tente novamente.'
}
