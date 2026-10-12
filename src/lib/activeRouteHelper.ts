import type { OrderRecord } from '@/types/delivery'
import { getOperationalWindow, isTodayOrder, type OperationalWindow } from '@/lib/operationalWindow'

/**
 * Critério centralizado e unificado de verificação de rota ativa de entregador.
 * Um pedido está em rota ativa se e somente se:
 * - route_started === true
 * - route_finished !== true (ou seja, false, null ou undefined)
 * - status não for cancelado nem entregue (para fins de trânsito em curso)
 */
export function isOrderInActiveRoute(order: OrderRecord): boolean {
  if (order.status === 'cancelled' || order.status === 'delivered') return false
  const isStarted = order.route_started === true
  const isNotFinished =
    order.route_finished !== true &&
    (order.route_finished === false ||
      order.route_finished === null ||
      order.route_finished === undefined)

  return isStarted && isNotFinished
}

/**
 * Retorna todos os pedidos da rota ativa em andamento de um entregador.
 * Se operationalWindow ou filterToday for fornecido, restringe aos pedidos da janela do dia operacional.
 */
export function getActiveRouteOrdersForCourier(
  courierId: string,
  allOrders: OrderRecord[],
  options?: {
    filterToday?: boolean
    operationalWindow?: OperationalWindow
  },
): OrderRecord[] {
  if (!courierId) return []

  const opWindow =
    options?.operationalWindow || (options?.filterToday ? getOperationalWindow() : undefined)

  return allOrders.filter((o) => {
    if (o.courier_id !== courierId) return false
    if (!isOrderInActiveRoute(o)) return false
    if (opWindow && !isTodayOrder(o, opWindow)) return false
    return true
  })
}

/**
 * Avalia se o entregador possui ao menos uma rota em andamento (iniciada e não finalizada).
 */
export function hasCourierActiveRoute(
  courierId: string,
  allOrders: OrderRecord[],
  options?: {
    filterToday?: boolean
    operationalWindow?: OperationalWindow
  },
): boolean {
  return getActiveRouteOrdersForCourier(courierId, allOrders, options).length > 0
}

/**
 * Retorna true quando:
 * - route_finished = true no lote vigente do courier OU
 * - todas as entregas do lote estão concluídas (status final) OU
 * - dentro da janela de graça de 5 min após a última entrega concluída.
 *
 * Previne falsos positivos de parada/desvio após o término da rota ou enquanto o entregador
 * acabou de entregar o último cliente (ex.: caso ANDREIA CRISTINA).
 */
export function isCourierRecentlyFinished(
  courierId: string,
  allOrders: OrderRecord[],
  nowMs: number = Date.now(),
  gracePeriodMs: number = 5 * 60 * 1000,
): boolean {
  if (!courierId) return false

  // Obter pedidos do courier que pertençam ao lote do dia ou tenham sido iniciados
  const courierOrders = allOrders.filter(
    (o) => o.courier_id === courierId && (o.route_started === true || o.route_finished === true),
  )

  if (courierOrders.length === 0) return false

  // Se qualquer pedido do lote está marcado como route_finished === true
  const anyRouteFinished = courierOrders.some((o) => o.route_finished === true)
  if (anyRouteFinished) return true

  // Verificar se há paradas pendentes no lote
  const pendingOrders = courierOrders.filter(
    (o) =>
      o.status !== 'delivered' &&
      o.status !== 'cancelled' &&
      o.status !== 'address_error' &&
      o.status !== 'client_absent',
  )

  const deliveredOrders = courierOrders.filter((o) => o.status === 'delivered')

  // Se todas as paradas do lote foram concluídas
  if (pendingOrders.length === 0 && deliveredOrders.length > 0) {
    return true
  }

  // Janela de graça de 5 minutos após a última entrega realizada
  if (deliveredOrders.length > 0) {
    let latestDeliveryTs = 0
    for (const d of deliveredOrders) {
      const raw = (d as any).delivery_timestamp || d.actual_arrival || d.updated || d.created
      const ts = raw ? new Date(raw).getTime() : 0
      if (!isNaN(ts) && ts > latestDeliveryTs) {
        latestDeliveryTs = ts
      }
    }

    if (latestDeliveryTs > 0 && nowMs - latestDeliveryTs <= gracePeriodMs) {
      return true
    }
  }

  return false
}
