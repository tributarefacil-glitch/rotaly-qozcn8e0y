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
    if (error instanceof Error) {
      if (error.message.includes('Failed to authenticate')) {
        return 'E-mail ou senha incorretos. Verifique suas credenciais de acesso.'
      }
      return error.message
    }
    return fallback || 'Ocorreu um erro inesperado. Tente novamente.'
  }

  // Handle specific HTTP status codes and PocketBase message strings
  const rawMsg = error.message || error.response?.message || ''

  if (error.status === 400 && rawMsg.includes('Failed to authenticate')) {
    return 'E-mail ou senha inválidos. Verifique se digitou as credenciais corretamente.'
  }

  if (error.status === 403) {
    return 'Acesso não autorizado. Verifique suas permissões ou contate o administrador.'
  }

  if (error.status === 404) {
    return 'Registro ou usuário não encontrado no sistema.'
  }

  const msgs = Object.values(extractFieldErrors(error))
  if (msgs.length > 0) {
    return msgs.join(' ')
  }

  if (rawMsg.includes('Failed to authenticate')) {
    return 'E-mail ou senha inválidos. Verifique suas credenciais de acesso.'
  }

  if (rawMsg.includes('Failed to create record')) {
    return 'Falha ao criar registro. Verifique os dados fornecidos.'
  }

  if (rawMsg.includes('Failed to update record')) {
    return 'Falha ao atualizar dados. Tente novamente.'
  }

  return rawMsg || fallback || 'Ocorreu um erro inesperado. Tente novamente.'
}
