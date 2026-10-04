import type { OrderRecord } from '@/types/delivery'

export interface OperationalWindow {
  start: number
  end: number
  dateStr: string
  /**
   * Data/hora de início da janela operacional formatada para PocketBase:
   * "YYYY-MM-DD HH:mm:ss.sssZ" (com espaço em vez de 'T', evitando descarte léxico no SQLite)
   */
  startPbString: string
  /**
   * Data/hora de término da janela operacional formatada para PocketBase:
   * "YYYY-MM-DD HH:mm:ss.sssZ"
   */
  endPbString: string
}

/**
 * Converte Date ou timestamp numérico para o formato nativo do PocketBase/SQLite:
 * "YYYY-MM-DD HH:mm:ss.sssZ" (substitui o 'T' da ISO por espaço).
 */
/**
 * Converte data/hora para exibição estritamente no fuso horário do Brasil (America/Sao_Paulo, UTC-3).
 */
export function formatBrazilTime(
  dateVal?: string | number | Date | null,
  options: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' },
): string {
  const ts = parseSafeTimestamp(dateVal)
  if (!ts) return '--:--'
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      ...options,
    }).format(new Date(ts))
  } catch {
    return new Date(ts).toLocaleTimeString('pt-BR', options)
  }
}

export function formatPbTimestamp(dateOrTs: Date | number): string {
  const d = typeof dateOrTs === 'number' ? new Date(dateOrTs) : dateOrTs
  return d.toISOString().replace('T', ' ')
}

/**
 * Utilitário central de formatação de horários e datas com garantia de fuso horário America/Sao_Paulo (UTC-3).
 * Garante que timestamps UTC gravados no PocketBase sejam sempre exibidos no horário local brasileiro.
 */
export const SAO_PAULO_TZ = 'America/Sao_Paulo'

/**
 * Retorna ano e mês (1-12) de uma data no fuso de São Paulo.
 */
export function getYearMonthInTz(dateOrStrOrTs?: Date | string | number | null): {
  year: number
  month: number
} {
  const ts = parseSafeTimestamp(dateOrStrOrTs || Date.now())
  const d = new Date(ts > 0 ? ts : Date.now())
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: 'numeric',
  })
  const parts = formatter.formatToParts(d)
  let year = d.getFullYear()
  let month = d.getMonth() + 1
  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value)
    if (part.type === 'month') month = Number(part.value)
  }
  return { year, month }
}

/**
 * Avalia se um timestamp pertence ao mês corrente no fuso de São Paulo.
 */
export function isCurrentMonthInTz(
  dateOrStrOrTs?: Date | string | number | null,
  referenceDate: Date = new Date(),
): boolean {
  if (!dateOrStrOrTs) return false
  const ts = parseSafeTimestamp(dateOrStrOrTs)
  if (ts <= 0) return false
  const monthStart = getOperationalMonthStart(referenceDate)
  // Próximo início operacional de mês (dia 1 às 05:00 do mês seguinte)
  const nextMonthDate = new Date(monthStart.timestamp + 32 * 24 * 60 * 60 * 1000)
  const nextMonthStart = getOperationalMonthStart(nextMonthDate)
  return ts >= monthStart.timestamp && ts < nextMonthStart.timestamp
}

/**
 * Avalia se um timestamp pertence a meses ANTERIORES ao mês corrente no fuso de São Paulo.
 */
export function isBeforeCurrentMonthInTz(
  dateOrStrOrTs?: Date | string | number | null,
  referenceDate: Date = new Date(),
): boolean {
  if (!dateOrStrOrTs) return false
  const ts = parseSafeTimestamp(dateOrStrOrTs)
  if (ts <= 0) return false
  const monthStart = getOperationalMonthStart(referenceDate)
  return ts < monthStart.timestamp
}

export function formatTimeInTz(
  dateOrStrOrTs: Date | string | number | null | undefined,
  includeSeconds = false,
): string {
  if (!dateOrStrOrTs) return '--:--'
  const ts = parseSafeTimestamp(dateOrStrOrTs)
  if (!ts) return '--:--'
  const d = new Date(ts)
  if (isNaN(d.getTime())) return '--:--'

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' } : {}),
  }).format(d)
}

export function formatDateInTz(
  dateOrStrOrTs: Date | string | number | null | undefined,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!dateOrStrOrTs) return ''
  const ts = parseSafeTimestamp(dateOrStrOrTs)
  if (!ts) return ''
  const d = new Date(ts)
  if (isNaN(d.getTime())) return ''

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: SAO_PAULO_TZ,
    ...options,
  }).format(d)
}

/**
 * Retorna se duas datas caem no mesmo dia civil no fuso de São Paulo (America/Sao_Paulo).
 */
export function isSameDayInTz(
  a: Date | string | number | null | undefined,
  b: Date | string | number | null | undefined = new Date(),
): boolean {
  if (!a || !b) return false
  const dateStrA = formatDateInTz(a, { year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateStrB = formatDateInTz(b, { year: 'numeric', month: '2-digit', day: '2-digit' })
  return Boolean(dateStrA && dateStrB && dateStrA === dateStrB)
}

/**
 * Retorna a janela operacional oficial Rotaly: 05:00:00 até 23:59:59.999.
 * Se a hora atual for anterior às 05:00 (madrugada), pertence ao ciclo operacional
 * iniciado no dia anterior às 05:00.
 */
/**
 * Extrai componentes de data e hora civis de uma data estritamente no fuso de São Paulo (America/Sao_Paulo).
 */
export function getCivilPartsInTz(dateOrTs?: Date | string | number | null): {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
} {
  const ts = parseSafeTimestamp(dateOrTs || Date.now())
  const d = new Date(ts > 0 ? ts : Date.now())
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: SAO_PAULO_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hour12: false,
  })
  const parts = formatter.formatToParts(d)
  let year = d.getFullYear()
  let month = d.getMonth() + 1
  let day = d.getDate()
  let hour = d.getHours()
  let minute = d.getMinutes()
  let second = d.getSeconds()

  for (const part of parts) {
    if (part.type === 'year') year = Number(part.value)
    if (part.type === 'month') month = Number(part.value)
    if (part.type === 'day') day = Number(part.value)
    if (part.type === 'hour') {
      const val = Number(part.value)
      hour = val === 24 ? 0 : val
    }
    if (part.type === 'minute') minute = Number(part.value)
    if (part.type === 'second') second = Number(part.value)
  }

  return { year, month, day, hour, minute, second }
}

/**
 * Retorna a janela operacional oficial Rotaly: 05:00:00 até 23:59:59.999 no fuso de Brasília (America/Sao_Paulo).
 * Extrai ano/mês/dia/hora civis via Intl.DateTimeFormat com timeZone 'America/Sao_Paulo'.
 * Se a hora em SP for < 5 (madrugada 00h–04h59), a data operacional é o dia anterior.
 * start = 05:00:00.000 SP do dia operacional; end = 23:59:59.999 SP do mesmo dia operacional.
 */
/**
 * Cria uma janela operacional personalizada no fuso de Brasília (America/Sao_Paulo).
 * Início: 05:00:00.000 do startDateStr (YYYY-MM-DD)
 * Fim: 23:59:59.999 do endDateStr (YYYY-MM-DD)
 */
export function getCustomOperationalWindow(
  startDateStr: string,
  endDateStr: string,
): OperationalWindow | null {
  if (!startDateStr || !endDateStr) return null
  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(startDateStr) || !dateRegex.test(endDateStr)) return null

  // Início às 05:00 SP e término às 23:59:59.999 SP (-03:00)
  const start = new Date(`${startDateStr}T05:00:00.000-03:00`).getTime()
  const end = new Date(`${endDateStr}T23:59:59.999-03:00`).getTime()

  if (isNaN(start) || isNaN(end) || start > end) {
    return null
  }

  const startPbString = new Date(start).toISOString().replace('T', ' ')
  const endPbString = new Date(end).toISOString().replace('T', ' ')

  return {
    start,
    end,
    dateStr: `${startDateStr} a ${endDateStr}`,
    startPbString,
    endPbString,
  }
}

export function getOperationalWindow(referenceDate: Date = new Date()): OperationalWindow {
  const parts = getCivilPartsInTz(referenceDate)
  let { year, month, day } = parts
  const { hour } = parts

  // Madrugada antes das 05h em SP: pertence ao ciclo operacional do dia anterior
  if (hour < 5) {
    // Subtrair 1 dia civil usando Date em UTC para cálculo de calendário sem desvio
    const d = new Date(Date.UTC(year, month - 1, day - 1))
    year = d.getUTCFullYear()
    month = d.getUTCMonth() + 1
    day = d.getUTCDate()
  }

  // Montar strings ISO com o offset do fuso de Brasília (-03:00)
  const monthStr = String(month).padStart(2, '0')
  const dayStr = String(day).padStart(2, '0')
  const dateStr = `${year}-${monthStr}-${dayStr}`

  // 05:00:00.000 SP = 08:00:00.000 UTC
  // 23:59:59.999 SP = 02:59:59.999 UTC do dia seguinte
  const start = new Date(`${dateStr}T05:00:00.000-03:00`).getTime()
  const end = new Date(`${dateStr}T23:59:59.999-03:00`).getTime()

  const startPbString = new Date(start).toISOString().replace('T', ' ')
  const endPbString = new Date(end).toISOString().replace('T', ' ')

  return { start, end, dateStr, startPbString, endPbString }
}

/**
 * Retorna o início oficial do mês no fuso de Brasília (America/Sao_Paulo):
 * Início = 05:00:00.000 do dia 1 do mês operacional em São Paulo.
 * (A janela operacional vai das 05h às 23h59; a madrugada antes das 05h do dia 1 pertence ao mês anterior).
 */
export function getOperationalMonthStart(referenceDate: Date = new Date()): {
  timestamp: number
  isoString: string
  pbString: string
} {
  const parts = getCivilPartsInTz(referenceDate)
  let { year, month, day } = parts
  const { hour } = parts

  // Madrugada antes das 05h do dia 1 pertence ao mês anterior
  if (day === 1 && hour < 5) {
    const prev = new Date(Date.UTC(year, month - 2, 1))
    year = prev.getUTCFullYear()
    month = prev.getUTCMonth() + 1
  }

  const monthStr = String(month).padStart(2, '0')
  const startIsoSP = `${year}-${monthStr}-01T05:00:00.000-03:00`
  const d = new Date(startIsoSP)
  const timestamp = d.getTime()
  const isoString = d.toISOString()
  const pbString = isoString.replace('T', ' ')

  return { timestamp, isoString, pbString }
}

/**
 * Helper unificado para verificar se um timestamp pertence a um período:
 * - 'today' → dentro da janela operacional de SP (opWindow.start <= ts <= opWindow.end)
 * - 'week' → >= start da janela operacional de 7 dias operacionais atrás (opWindow.start - 6 dias)
 * - 'month' → usa isCurrentMonthInTz existente
 * - 'all' → sempre true
 */
export function isOrderInPeriod(
  dateVal: string | number | Date | null | undefined,
  periodFilter: 'all' | 'today' | 'week' | 'month',
  referenceDate: Date = new Date(),
): boolean {
  if (periodFilter === 'all') return true
  const ts = parseSafeTimestamp(dateVal)
  if (!ts) return false

  const opWindow = getOperationalWindow(referenceDate)

  if (periodFilter === 'today') {
    return ts >= opWindow.start && ts <= opWindow.end
  }

  if (periodFilter === 'week') {
    // 7 dias operacionais: o dia operacional de hoje + os 6 dias operacionais anteriores
    const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
    return ts >= sevenDaysAgoStart
  }

  if (periodFilter === 'month') {
    return isCurrentMonthInTz(ts, referenceDate)
  }

  return true
}

/**
 * Converte carimbos de data do banco para timestamp numérico seguro em milissegundos.
 */
export function parseSafeTimestamp(dateVal?: string | number | Date | null): number {
  if (!dateVal) return 0
  try {
    if (typeof dateVal === 'number') {
      return isNaN(dateVal) ? 0 : dateVal
    }
    if (dateVal instanceof Date) {
      const t = dateVal.getTime()
      return isNaN(t) ? 0 : t
    }
    if (typeof dateVal === 'string') {
      const trimmed = dateVal.trim()
      if (!trimmed) return 0
      // PocketBase armazena datas sempre em UTC (ex: "YYYY-MM-DD HH:mm:ss.sssZ" ou "YYYY-MM-DD HH:mm:ss").
      // Se a string contiver data e hora sem indicação de fuso (sem 'Z' e sem offset +/-HH:mm),
      // forçar a terminação com 'Z' para garantir interpretação estrita em UTC, evitando perda de 3h no fuso do Brasil.
      let normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
      if (
        /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed) &&
        !trimmed.endsWith('Z') &&
        !/[+-]\d{2}:?\d{2}$/.test(trimmed)
      ) {
        normalized = normalized + 'Z'
      }
      const t = new Date(normalized).getTime()
      if (!isNaN(t)) return t
      const fallback = new Date(trimmed).getTime()
      return isNaN(fallback) ? 0 : fallback
    }
    return 0
  } catch {
    return 0
  }
}

/**
 * Verifica se um timestamp está estritamente dentro da janela operacional 05:00 - 23:59.
 */
export function isTimestampInOperationalWindow(
  dateVal?: string | Date | null,
  windowRange: { start: number; end: number } = getOperationalWindow(),
): boolean {
  const ts = parseSafeTimestamp(dateVal)
  if (ts <= 0) return false
  return ts >= windowRange.start && ts <= windowRange.end
}

/**
 * Avalia se o pedido pertence ao dia operacional ativo (05:00 - 23:59).
 * Considera:
 * 1. Pedidos com rota em andamento (route_started = true && route_finished != true) ou status 'in_transit'
 * 2. Carimbos do ciclo de vida: route_finished_at, actual_arrival, route_started_at, route_released_at, created, updated
 */
export function isTodayOrder(
  order: OrderRecord,
  windowRange: { start: number; end: number } = getOperationalWindow(),
): boolean {
  // Pedidos cancelados ou com problema NÃO devem ser considerados "ativos em rota" mesmo se route_started === true
  // pois quando foram cancelados ou tiveram ocorrência a rota daquela entrega não está mais em andamento.
  const isTerminatedOrIssue =
    order.status === 'cancelled' ||
    order.status === 'address_error' ||
    order.status === 'client_absent' ||
    order.completion_reason === 'address_error' ||
    order.completion_reason === 'client_absent'

  // Pedidos em trânsito com rota iniciada e não finalizada pertencem à jornada ativa
  const isActiveInRoute =
    !isTerminatedOrIssue &&
    (order.route_started === true || order.status === 'in_transit') &&
    order.route_finished !== true

  if (isActiveInRoute) return true

  // Avaliar carimbos relevantes contra a janela do dia operacional
  // Prioriza o fechamento da entrega e marcos do ciclo operacional
  // NOTA: order.updated foi removido para evitar que migrações ou updates de sistema
  // em pedidos de dias passados os façam contar indevidamente como pedidos de hoje.
  const stamps = [
    order.route_finished_at,
    order.actual_arrival,
    order.route_started_at,
    order.route_released_at,
    order.created,
  ]

  return stamps.some((s) => isTimestampInOperationalWindow(s, windowRange))
}

/**
 * Avalia se uma exceção/problema (cancelamento, cliente ausente, erro de endereço)
 * ocorreu dentro da janela operacional do dia atual (05:00 - 23:59 no fuso de Brasília).
 * Critério temporal: prioriza a data em que o problema de fato ocorreu (actual_arrival, updated, route_finished_at ou created).
 */
export function isOrderIssueToday(
  order: OrderRecord,
  windowRange: { start: number; end: number } = getOperationalWindow(),
): boolean {
  if (!order) return false

  // Se o pedido foi neutralizado como erro técnico de sistema, não é exceção operacional
  if (isNeutralizedSystemError(order)) return false

  // Timestamps relevantes de quando a exceção / cancelamento ocorreu
  // Para pedidos cancelados pelo vendedor/operador ou entregador, a data da ocorrência é
  // registrada em actual_arrival, updated, route_finished_at ou created.
  const issueStamps = [order.actual_arrival, order.updated, order.route_finished_at, order.created]

  // Verifica se o carimbo mais recente da ocorrência ocorreu dentro da janela do dia corrente
  // Pega o maior timestamp válido dentre os campos preenchidos do pedido
  const issueTs = issueStamps
    .map((s) => parseSafeTimestamp(s))
    .filter((ts) => ts > 0)
    .sort((a, b) => b - a)[0]

  if (!issueTs) return false

  return issueTs >= windowRange.start && issueTs <= windowRange.end
}

/**
 * Retorna true se o pedido foi neutralizado como erro de sistema (não é cancelamento operacional).
 * Exclui pedidos cancelados por erro de rota não executada / neutralização técnica do sistema.
 */
export function isNeutralizedSystemError(order: OrderRecord): boolean {
  if (!order) return false
  const notesLower = order.notes ? order.notes.toLowerCase() : ''
  // Erros de sistema neutralizados (não são ocorrências legítimas de entrega nem cancelamentos operacionais)
  // Exemplos reais do banco:
  // - "Neutralizado — km e combustível zerados"
  // - "Cancelado — erro de sistema"
  // - "[neutralizado: erro de sistema - rota liberada e nunca iniciada]"
  // - "neutralização de rota não executada"
  return (
    notesLower.includes('erro de sistema') ||
    notesLower.includes('neutralizado — km e combustível zerados') ||
    notesLower.includes('km e combustível zerados') ||
    notesLower.includes('neutralizado: erro de sistema') ||
    notesLower.includes('neutralização de rota não executada')
  )
}
