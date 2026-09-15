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
