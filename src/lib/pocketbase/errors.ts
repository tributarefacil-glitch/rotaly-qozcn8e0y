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

export function getErrorMessage(error: unknown, fallbackMessage?: string): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : fallbackMessage || 'Ocorreu um erro inesperado.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  if (msgs.length > 0) {
    return msgs.join(' ')
  }

  // Handle common PocketBase error messages with friendly Portuguese translations
  if (error.status === 400 && error.message?.toLowerCase().includes('failed to authenticate')) {
    return 'Falha na autenticação. E-mail ou senha incorretos. Caso seja uma conta de teste, verifique a senha padrão (Skip@Pass).'
  }

  if (error.status === 403) {
    return 'Acesso negado. Sua conta pode estar inativa ou sem permissão de acesso.'
  }

  if (error.status === 404) {
    return 'Registro ou usuário não encontrado.'
  }

  return error.message || fallbackMessage || 'Ocorreu um erro inesperado.'
}
