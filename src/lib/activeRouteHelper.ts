import type { OrderRecord } from '@/types/delivery'
import { getOperationalWindow, isTodayOrder, type OperationalWindow } from '@/lib/operationalWindow'
import { offlineRouteStorage } from '@/services/offlineRouteStorage'

/**
 * Status finais canônicos de um pedido (espelha as regras de lote misto do backend).
 */
export const FINAL_ORDER_STATUSES: string[] = [
  'delivered',
  'delivered_with_exception',
  'unsuccessful',
  'address_error',
  'client_absent',
  'cancelled',
]

export function isFinalOrderStatus(status: string): boolean {
  return FINAL_ORDER_STATUSES.indexOf(status) !== -1
}

/**
 * Lote misto concluído: TODAS as entregas do route_batch_key já estão em status final,
 * mas o route_finished ainda não foi propagado (ex.: fechamento automático pendente ou
 * ordem do lote órfã presa em in_transit). É tratado como lote morto/fechado para
 * exibição na Torre (kanban, contadores e mapa), sem tocar em lote com entrega
 * genuinamente pendente (pending/assigned/in_transit real).
 */
export function buildCompletedMixedBatchKeys(orders: OrderRecord[]): Set<string> {
  const batchMembers = new Map<string, OrderRecord[]>()
  for (const o of orders) {
    if (!o.route_batch_key) continue
    const list = batchMembers.get(o.route_batch_key)
    if (list) list.push(o)
    else batchMembers.set(o.route_batch_key, [o])
  }
  const keys = new Set<string>()
  batchMembers.forEach((members, key) => {
    if (members.length === 0) return
    const allFinal = members.every((m) => isFinalOrderStatus(m.status))
    if (allFinal) keys.add(key)
  })
  return keys
}

/**
 * Critério centralizado e unificado de verificação de rota ativa de entregador.
 * Um pedido está em rota ativa se e somente se:
 * - route_started === true
 * - route_finished !== true (ou seja, false, null ou undefined)
 * - NÃO pertencer a um LOTE MORTO (ver abaixo)
 * - status não for cancelado nem entregue (para fins de trânsito em curso)
 *
 * LOTE MORTO: qualquer route_batch_key em que UM pedido qualquer tenha route_finished = true.
 * O "Voltar para base" grava route_finished=true no lote; pedidos pendentes remanescentes desse
 * lote (composição mista: entregues/encerrados + pendentes) NUNCA mais contam como rota ativa,
 * mesmo que ainda tragam route_started=true com route_finished=false no próprio registro.
 *
 * LOTE MISTO CONCLUÍDO: route_batch_key em que TODOS os pedidos conhecidos já estão em status
 * final (sem nenhum pendente genuíno), mesmo sem route_finished propagado — tratado como lote
 * morto para exibição (kanban, contadores e mapa da Torre).
 */
export function buildDeadRouteBatchKeys(orders: OrderRecord[]): Set<string> {
  const keys = new Set<string>()
  for (const o of orders) {
    if (o.route_finished === true && o.route_batch_key) keys.add(o.route_batch_key)
  }
  buildCompletedMixedBatchKeys(orders).forEach((k) => keys.add(k))
  return keys
}

export function isOrderInDeadBatch(order: OrderRecord, deadBatchKeys: Set<string>): boolean {
  return Boolean(order.route_batch_key) && deadBatchKeys.has(order.route_batch_key)
}

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
 * EXCLUI pedidos de lotes mortos (algum pedido do route_batch_key com route_finished=true) — a
 * exclusão por lote é computada varrendo TODOS os pedidos disponíveis (allOrders), não apenas os
 * do entregador, para cobrir composição mista.
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

  const deadBatchKeys = buildDeadRouteBatchKeys(allOrders)

  return allOrders.filter((o) => {
    if (o.courier_id !== courierId) return false
    if (!isOrderInActiveRoute(o)) return false
    if (isOrderInDeadBatch(o, deadBatchKeys)) return false
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
      const raw =
        (d as any).delivery_timestamp || (d as any).actual_arrival || d.updated || d.created
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

/**
 * Valida o lote ativo do servidor contra o cache local do entregador.
 * Invalida e limpa o cache local caso:
 * - A chave do lote (route_batch_key) tenha mudado entre servidor e cache
 * - O servidor não tenha mais rota ativa para o entregador
 * - Haja lote mais recente no servidor
 * Garante que o entregador nunca veja um lote antigo em cache quando o vendedor/Torre
 * tiver liberado um novo lote ou atualizado a sequência.
 */
export async function syncAndValidateRouteCache(
  courierId: string,
  serverOrders: OrderRecord[],
): Promise<void> {
  if (!courierId) return

  try {
    const serverActiveOrders = getActiveRouteOrdersForCourier(courierId, serverOrders)
    const serverBatchKey =
      serverActiveOrders.find((o) => Boolean(o.route_batch_key))?.route_batch_key || null

    const cached = await offlineRouteStorage.getCachedRouteOrders(courierId)
    if (!cached || !Array.isArray(cached.orders) || cached.orders.length === 0) {
      if (serverActiveOrders.length > 0) {
        await offlineRouteStorage.saveRouteOrders(courierId, serverActiveOrders)
      }
      return
    }

    const cachedBatchKey =
      cached.orders.find((o) => Boolean(o.route_batch_key))?.route_batch_key || null

    // Se o lote mudou (novo batch no servidor), descarta imediatamente o cache antigo
    if (serverBatchKey && cachedBatchKey && serverBatchKey !== cachedBatchKey) {
      await offlineRouteStorage.clearRouteCache(courierId)
      if (serverActiveOrders.length > 0) {
        await offlineRouteStorage.saveRouteOrders(courierId, serverActiveOrders)
      }
      return
    }

    // Se no servidor a rota já terminou, limpa o cache local para não manter paradas zumbis
    if (serverActiveOrders.length === 0 && cached.orders.length > 0) {
      const anyStillActiveInCache = cached.orders.some((o) => isOrderInActiveRoute(o))
      if (!anyStillActiveInCache) {
        await offlineRouteStorage.clearRouteCache(courierId)
      }
      return
    }

    // Atualiza cache local com a versão canônica e atualizada do servidor
    if (serverActiveOrders.length > 0) {
      await offlineRouteStorage.saveRouteOrders(courierId, serverActiveOrders)
    }
  } catch (err) {
    console.warn('[activeRouteHelper] syncAndValidateRouteCache falhou:', err)
  }
}
