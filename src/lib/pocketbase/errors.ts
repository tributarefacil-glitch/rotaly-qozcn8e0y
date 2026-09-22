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

const PT_FIELD_NAMES: Record<string, string> = {
  proof_photo: 'Foto do Comprovante',
  signature: 'Assinatura Digital',
  status: 'Status do Pedido',
  notes: 'Observações',
  receiver_name: 'Nome do Recebedor',
  actual_arrival: 'Data/Hora de Chegada',
  distance_km: 'Distância (km)',
  return_trip_km: 'Retorno (km)',
  completion_reason: 'Motivo de Conclusão',
  tracking_code: 'Código de Rastreamento',
  customer_id: 'Cliente',
  courier_id: 'Entregador',
  foto_odometro_inicial: 'Foto do Odômetro Inicial',
  foto_odometro_final: 'Foto do Odômetro Final',
}

function translateErrorMessage(msg: string): string {
  if (!msg) return ''
  const m = msg.toLowerCase()
  if (
    m.includes('file size') ||
    m.includes('exceeds') ||
    m.includes('too large') ||
    m.includes('max') ||
    m.includes('tamanho')
  ) {
    return 'Arquivo muito grande. O limite máximo permitido foi excedido.'
  }
  if (m.includes('mime') || m.includes('extension') || m.includes('type')) {
    return 'Formato de imagem inválido. Use JPG, PNG ou WEBP.'
  }
  if (m.includes('cannot be blank') || m.includes('required') || m.includes('obrigat')) {
    return 'Campo obrigatório não preenchido.'
  }
  if (m.includes('failed to update record')) {
    return 'Falha ao atualizar o pedido no servidor.'
  }
  return msg
}

export function getErrorMessage(error: unknown): string {
  if (!(error instanceof ClientResponseError)) {
    return error instanceof Error ? error.message : 'Ocorreu um erro inesperado.'
  }
  const fieldErrors = extractFieldErrors(error)
  const entries = Object.entries(fieldErrors)
  if (entries.length > 0) {
    return entries
      .map(([field, rawMsg]) => {
        const fieldLabel = PT_FIELD_NAMES[field] || field
        const translatedMsg = translateErrorMessage(rawMsg)
        return `${fieldLabel}: ${translatedMsg}`
      })
      .join(' | ')
  }

  // Verificar se há mensagem genérica no corpo da resposta
  const topMsg = (error.response?.message as string | undefined) || error.message
  if (topMsg) {
    return translateErrorMessage(topMsg)
  }

  return 'Ocorreu um erro ao comunicar com o servidor. Tente novamente.'
}
