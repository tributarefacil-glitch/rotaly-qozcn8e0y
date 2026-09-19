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

export function getErrorMessage(error: unknown): string {
  if (!error) return 'Ocorreu um erro desconhecido.'

  // Se for erro do PocketBase (ClientResponseError) ou objeto com formato similar
  if (
    error instanceof ClientResponseError ||
    (typeof error === 'object' && error !== null && 'status' in error)
  ) {
    const pbErr = error as ClientResponseError
    const status = pbErr.status
    const rawMessage = (pbErr.message || '').trim()

    // 1. Falha de rede / sem conexão / status 0
    if (status === 0 || rawMessage.toLowerCase().includes('something went wrong')) {
      const origMsg = (pbErr.originalError as Error)?.message || ''
      if (
        origMsg.toLowerCase().includes('failed to fetch') ||
        origMsg.toLowerCase().includes('networkerror') ||
        origMsg.toLowerCase().includes('refused')
      ) {
        return 'Falha de conexão com o servidor. Verifique sua conexão com a internet.'
      }
      // Se for autenticação ou operação comum com status 0
      return 'Não foi possível conectar ao servidor de autenticação. Verifique sua conexão ou tente novamente em instantes.'
    }

    // 2. Extrair erros de campos específicos da resposta (ex: email, password, etc)
    const fieldErrors = extractFieldErrors(error)
    const fieldMsgList = Object.values(fieldErrors)
    if (fieldMsgList.length > 0) {
      return fieldMsgList.join(' ')
    }

    // 3. Traduzir mensagens padrão do PocketBase
    if (status === 400) {
      if (
        rawMessage.toLowerCase().includes('failed to authenticate') ||
        rawMessage.toLowerCase().includes('invalid email or password') ||
        rawMessage.toLowerCase().includes('something went wrong')
      ) {
        return 'E-mail ou senha incorretos. Verifique suas credenciais.'
      }
      if (
        rawMessage.toLowerCase().includes('failed to create') ||
        rawMessage.toLowerCase().includes('cannot be blank')
      ) {
        return 'Dados incompletos ou inválidos para esta operação.'
      }
    } else if (status === 401) {
      return 'Sessão expirada ou não autorizada. Faça login novamente.'
    } else if (status === 403) {
      return 'Acesso negado. Seu perfil não tem permissão para realizar esta ação.'
    } else if (status === 404) {
      return 'Registro ou usuário não encontrado.'
    } else if (status >= 500) {
      return 'Erro interno do servidor. Tente novamente em instantes.'
    }

    if (rawMessage && !rawMessage.toLowerCase().includes('something went wrong')) {
      return rawMessage
    }

    return 'E-mail ou senha inválidos. Verifique suas credenciais.'
  }

  if (error instanceof Error) {
    const msg = error.message.trim()
    if (msg.toLowerCase().includes('something went wrong')) {
      return 'Não foi possível concluir a autenticação. Verifique suas credenciais ou conexão.'
    }
    return msg || 'Ocorreu um erro inesperado.'
  }

  if (typeof error === 'string') {
    return error
  }

  return 'Ocorreu um erro inesperado. Tente novamente.'
}
