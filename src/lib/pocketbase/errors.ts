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

const TRANSLATED_MESSAGES: Record<string, string> = {
  "values don't match.": 'A confirmação de senha não confere com a senha digitada.',
  "values don't match": 'A confirmação de senha não confere com a senha digitada.',
  'value must be unique.': 'Este e-mail já está cadastrado no sistema.',
  'value must be unique': 'Este e-mail já está cadastrado no sistema.',
  'failed to create record.': 'Não foi possível salvar o usuário. Verifique os dados informados.',
  'failed to create record': 'Não foi possível salvar o usuário. Verifique os dados informados.',
}

function translateMessage(rawMsg: string): string {
  const trimmed = rawMsg.trim()
  const lower = trimmed.toLowerCase()
  if (TRANSLATED_MESSAGES[lower]) {
    return TRANSLATED_MESSAGES[lower]
  }
  if (lower.includes("values don't match")) {
    return 'A confirmação de senha não confere com a senha digitada.'
  }
  if (lower.includes('value must be unique') || lower.includes('must be unique')) {
    return 'Este e-mail já está cadastrado no sistema.'
  }
  if (lower.includes('failed to create record')) {
    return 'Não foi possível salvar o usuário. Verifique os dados informados.'
  }
  return trimmed
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    if (error instanceof Error) {
      return translateMessage(error.message)
    }
    return 'Ocorreu um erro inesperado.'
  }
  const msgs = Object.values(extractFieldErrors(error))
  if (msgs.length > 0) {
    return msgs.map(translateMessage).join(' ')
  }
  return translateMessage(error.message || 'Ocorreu um erro inesperado.')
}
