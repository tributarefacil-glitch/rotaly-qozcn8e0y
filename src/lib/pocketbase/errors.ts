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

export function getErrorMessage(
  error: unknown,
  fallbackMessage = 'Ocorreu um erro inesperado.',
): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : fallbackMessage
  }

  const fieldErrors = extractFieldErrors(error)
  const entries = Object.entries(fieldErrors)

  if (entries.length > 0) {
    const translated = entries.map(([field, msg]) => {
      let fieldLabel = field
      if (field === 'email') fieldLabel = 'E-mail'
      else if (field === 'password') fieldLabel = 'Senha'
      else if (field === 'passwordConfirm') fieldLabel = 'Confirmação de senha'
      else if (field === 'name') fieldLabel = 'Nome'
      else if (field === 'role') fieldLabel = 'Perfil'
      else if (field === 'username') fieldLabel = 'Nome de usuário'

      let msgText = msg
      if (msg.includes('Value must be between 8 and')) {
        msgText = 'A senha deve ter no mínimo 8 caracteres.'
      } else if (
        msg.includes('Value must be unique') ||
        msg.includes('already exists') ||
        msg.includes('unique constraint')
      ) {
        msgText = 'já está em uso no sistema.'
      } else if (msg.includes('cannot be blank') || msg.includes('required')) {
        msgText = 'é obrigatório.'
      } else if (msg.includes('Value must be a valid email address')) {
        msgText = 'deve ser um endereço de e-mail válido.'
      }

      return `${fieldLabel}: ${msgText}`
    })

    return translated.join(' | ')
  }

  if (error.message) {
    if (error.message.includes('Failed to create record')) {
      return 'Não foi possível cadastrar o usuário. Verifique os dados informados (mínimo de 8 caracteres para a senha e e-mail único).'
    }
    return error.message
  }

  return fallbackMessage
}
