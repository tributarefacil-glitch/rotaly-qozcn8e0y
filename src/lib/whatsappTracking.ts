/**
 * Helper para formatação de deep link do WhatsApp (wa.me)
 * e geração de mensagem pronta de rastreamento com link do Rotaly.
 *
 * REGRA DE ETA (decisão do usuário, 04/11):
 * A página pública de rastreamento é a fonte da verdade da previsão de chegada
 * (ETA ao vivo calculada da posição real do entregador + distância viária Google).
 * O texto do WhatsApp NUNCA deve cravar um horário calculado por placeholder
 * (ex.: 20 min + 15 min por posição na fila). Só cita "por volta das X" quando
 * existe duração REAL de trânsito do Google (por perna da rota liberada).
 * Sem duração real, o texto diz que a previsão atualizada está no link.
 */

/**
 * DDD padrão da operação Rotaly: todos os clientes são do RJ (DDD 21).
 * Usado para antepor o DDD quando o telefone informado pelo cliente ou vendedor
 * tiver apenas 8 ou 9 dígitos (sem DDD).
 */
export const DEFAULT_DDD = '21'

export interface TrackingWhatsAppMessageOptions {
  customerName?: string
  trackingCode: string
  /**
   * Duração REAL de trânsito (Google, por perna da rota já liberada) em minutos.
   * Só fornecer quando houver duração viária real apurada (route_released +
   * estimated_duration_minutes do resequenciador). NUNCA passar valor derivado
   * do placeholder 20+i*15 da aplicação de rota.
   */
  realTransitDurationMinutes?: number | null
  sellerName?: string
  /**
   * @deprecated Legado: era o estimated_arrival do placeholder. IGNORADO —
   * a mensagem nunca mais cita horário derivado dele.
   */
  estimatedArrival?: string | null
  /** @deprecated Legado: ignorado. */
  includeEta?: boolean
}

/**
 * Normaliza e padroniza número de telefone para cadastro de clientes no banco / estado local.
 * Regras da operação Rotaly (RJ):
 * - Vazio/nulo -> retorna string vazia ''
 * - 8 ou 9 dígitos sem DDD -> antepõe DDD 21 (ex: 971344477 -> 21971344477)
 * - Prefixo 0 no DDD (ex: 021987654321 ou 021 97134-4477) -> remove o zero inicial (-> 21987654321)
 * - Com código de país 55 (ex: 5521987654321) -> remove o 55 para o formato nacional se tiver 12 ou 13 dígitos
 * - 10 ou 11 dígitos com DDD válido -> mantém limpo apenas com dígitos
 */
export function normalizeCustomerPhone(phone?: string | null): string {
  if (!phone) return ''
  let digits = phone.replace(/\D/g, '')
  if (!digits) return ''

  // Remove 55 inicial se já tiver 12 ou 13 dígitos (ex: 5521987654321 -> 21987654321)
  if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
    digits = digits.slice(2)
  }

  // Remove 0 inicial de discagem (ex: 021987654321 -> 21987654321)
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1)
  }

  // Se tem apenas 8 ou 9 dígitos (sem DDD), antepõe o DDD 21 do RJ
  if (digits.length === 8 || digits.length === 9) {
    digits = `${DEFAULT_DDD}${digits}`
  }

  return digits
}

/**
 * Normaliza o telefone para o formato padrão do wa.me (55 + DDD + dígitos, sem caracteres especiais).
 * Retorna null se não houver telefone válido (mínimo 8 dígitos).
 * Se o telefone tiver 8 ou 9 dígitos (sem DDD), assume automaticamente o DDD 21 do RJ.
 */
export function normalizeWhatsAppPhone(phone?: string | null): string | null {
  if (!phone) return null
  let digits = phone.replace(/\D/g, '')
  if (!digits) return null

  // Remove zero de operadora inicial (ex: 021987654321 -> 21987654321)
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.slice(1)
  }

  // Remove 0 após 55 (ex: 55021987654321 -> 5521987654321)
  if (digits.startsWith('550') && digits.length >= 13) {
    digits = `55${digits.slice(3)}`
  }

  // Se tiver 8 ou 9 dígitos (sem DDD), assume o DDD padrão 21 (RJ)
  if (digits.length === 8 || digits.length === 9) {
    digits = `${DEFAULT_DDD}${digits}`
  }

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
 * Formata a ETA "por volta das X" a partir de uma duração REAL de trânsito em minutos.
 * Retorna null quando não há duração válida (> 0) — nesse caso a mensagem NÃO cita horário.
 * `from` é injetável para testes determinísticos.
 */
export function formatEtaFromRealDuration(
  realTransitDurationMinutes?: number | null,
  from: Date = new Date(),
): string | null {
  if (
    typeof realTransitDurationMinutes !== 'number' ||
    !isFinite(realTransitDurationMinutes) ||
    realTransitDurationMinutes <= 0
  ) {
    return null
  }
  try {
    const etaDate = new Date(from.getTime() + Math.round(realTransitDurationMinutes) * 60 * 1000)
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
    }).format(etaDate)
  } catch {
    return null
  }
}

/**
 * Monta o texto da mensagem do WhatsApp conforme o tom decidido:
 * - Saudação com nome do cliente
 * - Confirmação do pedido registrado com sucesso
 * - ETA "por volta das X" SOMENTE quando há duração real de trânsito (rota liberada);
 *   caso contrário, NENHUM horário fechado é citado — a previsão ao vivo fica no link
 * - Link público https://www.rotaly.com.br/track/<tracking_code>
 * - Convite para ao final avaliar vendedor e entregador na mesma página
 */
export function buildTrackingWhatsAppText(options: TrackingWhatsAppMessageOptions): string {
  const firstName = options.customerName ? options.customerName.trim().split(' ')[0] : 'Cliente'
  const trackingUrl = `https://www.rotaly.com.br/track/${options.trackingCode}`

  // estimatedArrival/includeEta (legado) são deliberadamente IGNORADOS:
  // horário do placeholder 20+i*15 nunca mais vai para o cliente.
  const etaFormatted = formatEtaFromRealDuration(options.realTransitDurationMinutes)
  const etaNotice = etaFormatted ? `\nPrevisão de entrega: por volta das *${etaFormatted}*.` : ''

  return (
    `Olá, ${firstName}! Seu pedido foi registrado com sucesso.${etaNotice}\n\n` +
    `Acompanhe sua entrega em tempo real, incluindo a previsão de chegada atualizada e o mapa ao vivo, por este link:\n` +
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
