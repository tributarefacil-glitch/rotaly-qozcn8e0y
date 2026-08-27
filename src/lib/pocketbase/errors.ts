import { ClientResponseError } from 'pocketbase'

export type FieldErrors = Record<string, string>

const FIELD_TRANSLATIONS: Record<string, string> = {
  email: 'E-mail',
  password: 'Senha',
  passwordConfirm: 'Confirmação de senha',
  name: 'Nome',
  username: 'Nome de usuário',
  role: 'Perfil de acesso',
  status: 'Status',
  verified: 'Status de verificação',
  oldPassword: 'Senha antiga',
  title: 'Título',
  message: 'Mensagem',
  phone: 'Telefone',
  address: 'Endereço',
  customer_id: 'Cliente',
  courier_id: 'Entregador',
  seller_id: 'Vendedor',
  tracking_code: 'Código de rastreio',
}

function translateErrorMessage(field: string, msg: string): string {
  const fieldName = FIELD_TRANSLATIONS[field] || field
  const lower = msg.toLowerCase().trim()

  if (
    lower.includes("values don't match") ||
    lower.includes('values dont match') ||
    lower.includes('value does not match')
  ) {
    if (field === 'passwordConfirm' || field === 'password') {
      return 'As senhas digitadas não coincidem.'
    }
    if (field === 'verified') {
      return 'Não foi possível alterar o status de verificação da conta.'
    }
    return `O campo "${fieldName}" contém um valor inválido ou divergente.`
  }

  if (
    lower.includes('must be unique') ||
    lower.includes('already exists') ||
    lower.includes('unique')
  ) {
    return `Este ${fieldName.toLowerCase()} já está em uso.`
  }

  if (
    lower.includes('required') ||
    lower.includes('cannot be blank') ||
    lower.includes('must not be empty')
  ) {
    return `O campo ${fieldName} é obrigatório.`
  }

  if (lower.includes('min') && (lower.includes('characters') || lower.includes('length'))) {
    return `O campo ${fieldName} não atinge o tamanho mínimo necessário.`
  }

  if (lower.includes('invalid email') || lower.includes('must be a valid email')) {
    return 'Por favor, forneça um endereço de e-mail válido.'
  }

  return `${fieldName}: ${msg}`
}

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

export function getErrorMessage(error: unknown, fallback = 'Ocorreu um erro inesperado.'): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : fallback
  }

  const rawFieldErrors = extractFieldErrors(error)
  const entries = Object.entries(rawFieldErrors)

  if (entries.length > 0) {
    const translatedMessages = entries.map(([field, rawMsg]) =>
      translateErrorMessage(field, rawMsg),
    )
    return translatedMessages.join('\n')
  }

  if (error.response?.message && typeof error.response.message === 'string') {
    const mainMsg = error.response.message
    if (mainMsg.toLowerCase().includes('failed to create record')) {
      return 'Falha ao criar o registro. Verifique os dados informados.'
    }
    if (mainMsg.toLowerCase().includes('failed to authenticate')) {
      return 'E-mail ou senha incorretos.'
    }
    return mainMsg
  }

  return error.message || fallback
}
