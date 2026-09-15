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
export function formatPbTimestamp(dateOrTs: Date | number): string {
  const d = typeof dateOrTs === 'number' ? new Date(dateOrTs) : dateOrTs
  return d.toISOString().replace('T', ' ')
}

/**
 * Retorna a janela operacional oficial Rotaly: 05:00:00 até 23:59:59.999.
 * Se a hora atual for anterior às 05:00 (madrugada), pertence ao ciclo operacional
 * iniciado no dia anterior às 05:00.
 */
export function getOperationalWindow(referenceDate: Date = new Date()): OperationalWindow {
  const opDate = new Date(referenceDate)

  // Madrugada antes das 05h: pertence ao dia operacional iniciado ontem às 05h
  if (opDate.getHours() < 5) {
    opDate.setDate(opDate.getDate() - 1)
  }

  const start = new Date(
    opDate.getFullYear(),
    opDate.getMonth(),
    opDate.getDate(),
    5,
    0,
    0,
    0,
  ).getTime()

  const end = new Date(
    opDate.getFullYear(),
    opDate.getMonth(),
    opDate.getDate(),
    23,
    59,
    59,
    999,
  ).getTime()

  const dateStr = `${opDate.getFullYear()}-${String(opDate.getMonth() + 1).padStart(2, '0')}-${String(opDate.getDate()).padStart(2, '0')}`
  const startPbString = new Date(start).toISOString().replace('T', ' ')
  const endPbString = new Date(end).toISOString().replace('T', ' ')

  return { start, end, dateStr, startPbString, endPbString }
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
      // Tratar formato padrão PocketBase "YYYY-MM-DD HH:mm:ss.sssZ" ou ISO direto
      const normalized = trimmed.includes('T') ? trimmed : trimmed.replace(' ', 'T')
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
  // Pedidos em trânsito com rota iniciada e não finalizada pertencem à jornada ativa
  const isActiveInRoute =
    (order.route_started === true || order.status === 'in_transit') && order.route_finished !== true

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
 * Retorna true se o pedido foi neutralizado como erro de sistema (não é cancelamento operacional).
 * Exclui pedidos cancelados por erro de rota não executada / neutralização técnica do sistema.
 */
export function isNeutralizedSystemError(order: OrderRecord): boolean {
  if (!order) return false
  const notesLower = order.notes ? order.notes.toLowerCase() : ''
  return notesLower.includes('erro de sistema')
}
