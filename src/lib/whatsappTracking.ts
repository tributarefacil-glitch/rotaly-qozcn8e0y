/**
 * Helper para formatação de deep link do WhatsApp (wa.me)
 * e geração de mensagem pronta de rastreamento com link do Rotaly.
 */

export interface TrackingWhatsAppMessageOptions {
  customerName?: string
  trackingCode: string
  estimatedArrival?: string | null
  sellerName?: string
  includeEta?: boolean
}

/**
 * Normaliza o telefone para o formato padrão do wa.me (55 + DDD + dígitos, sem caracteres especiais).
 * Retorna null se não houver telefone válido com DDD (mínimo 10 dígitos).
 */
export function normalizeWhatsAppPhone(phone?: string | null): string | null {
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  if (!digits) return null

  // Se já começar com 55 e tiver 12 ou 13 dígitos (ex: 5521999998888 ou 552188887777)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    return digits
  }

  // Se for celular ou fixo com DDD brasileiro (10 ou 11 dígitos)
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`
  }

  // Caso tenha mais de 11 dígitos sem 55 ou número internacional
  if (digits.length >= 10 && digits.length <= 15) {
    return digits.startsWith('55') ? digits : `55${digits}`
  }

  return null
}

/**
 * Monta o texto da mensagem do WhatsApp conforme o tom decidido:
 * Próximo, profissional, em português, contendo:
 * - Saudação com nome do cliente
 * - Confirmação do pedido registrado com sucesso
 * - Link público https://www.rotaly.com.br/track/<tracking_code>
 * - Aviso de que ali ele acompanha o status E o tempo de entrega em tempo real
 * - Convite para ao final avaliar vendedor e entregador na mesma página
 */
export function buildTrackingWhatsAppText(options: TrackingWhatsAppMessageOptions): string {
  const firstName = options.customerName ? options.customerName.trim().split(' ')[0] : 'Cliente'
  const trackingUrl = `https://www.rotaly.com.br/track/${options.trackingCode}`

  let etaNotice = ''
  if (options.includeEta && options.estimatedArrival) {
    try {
      const etaFormatted = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        hour: '2-digit',
        minute: '2-digit',
      }).format(new Date(options.estimatedArrival))
      etaNotice = `\nPrevisão estimada de entrega para hoje: por volta das *${etaFormatted}*.`
    } catch {
      // ignora erro de parsing
    }
  }

  return (
    `Olá, ${firstName}! Seu pedido foi registrado com sucesso.${etaNotice}\n\n` +
    `Acompanhe sua entrega em tempo real, incluindo o tempo de chegada e o mapa ao vivo, por este link:\n` +
    `${trackingUrl}\n\n` +
    `Ao final, você também pode avaliar seu vendedor e seu entregador diretamente por ali.\n\n` +
    `Obrigado pela preferência!`
  )
}

/**
 * Gera o link completo wa.me já url-encoded
 */
export function buildTrackingWhatsAppUrl(
  phone: string | null | undefined,
  options: TrackingWhatsAppMessageOptions,
): string | null {
  const normalizedPhone = normalizeWhatsAppPhone(phone)
  if (!normalizedPhone) return null

  const text = buildTrackingWhatsAppText(options)
  return `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(text)}`
}
