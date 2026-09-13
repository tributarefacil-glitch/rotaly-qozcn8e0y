/**
 * multiDeliveryDetector.ts
 *
 * Utilitário para detecção e agrupamento de entregas conjuntas / múltiplas no mesmo ponto.
 *
 * Problema real identificado:
 * O vendedor cadastra acidentalmente pedidos repetidos para o mesmo cliente em sequência,
 * ou o cliente faz compras complementares despachadas juntas.
 * Quando o entregador vai ao endereço, ele faz UMA única viagem (base -> cliente -> base) com
 * dois ou mais pacotes.
 * Sem essa detecção, cada pedido cobrava uma viagem completa na telemetria, dobrando
 * o KM oficial reembolsável e o gasto com combustível.
 *
 * Regras:
 * 1. Agrupar pedidos entregues por (customer_id, courier_id, dia).
 * 2. Horários de conclusão (actual_arrival) a no máximo 45 minutos entre si.
 *    (Se não houver actual_arrival gravado, utiliza route_finished_at ou created na mesma janela de 45m).
 * 3. Mesmo endereço (mesmo customer_id já basta, com fallback para coordenadas/endereço similar se id ausente).
 * 4. Grupos com 2+ pedidos = "entrega múltipla no mesmo ponto / entrega conjunta".
 * 5. Na telemetria: cobrar a viagem UMA vez só para o grupo (o primeiro pedido do grupo retém o KM;
 *    os demais entram com KM oficial reembolsável = 0 e flag isJointDeliveryChild = true).
 * 6. NÃO alterar o total_route_with_return_km das rotas no banco (histórico viário permanece intocado).
 */

import type { OrderRecord } from '@/types/delivery'

export interface MultiDeliveryGroup {
  groupId: string
  customerId: string
  customerName?: string
  courierId: string
  dayKey: string
  orders: OrderRecord[]
  primaryOrderId: string
  count: number
}

export interface JointDeliveryOrderMeta {
  isJointDelivery: boolean
  isJointPrimary: boolean
  isJointSecondary: boolean
  groupId: string | null
  groupSize: number
  primaryTrackingCode?: string
  primaryOrderId?: string
  partnerTrackingCodes: string[]
}

/**
 * Retorna a chave do dia (YYYY-MM-DD) no horário local de Brasília / do Brasil (UTC-3)
 * para evitar que pedidos entregues às 21h e 22h virem dias diferentes em UTC.
 */
export function getDeliveryDayKey(dateObj: Date): string {
  // Ajuste seguro para dia local
  const year = dateObj.getFullYear()
  const month = String(dateObj.getMonth() + 1).padStart(2, '0')
  const day = String(dateObj.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Obtém o timestamp representativo de conclusão da entrega.
 * Prioridade: actual_arrival > route_finished_at > updated > created.
 */
export function getOrderDeliveryTimestamp(order: OrderRecord): number {
  if (order.actual_arrival) {
    const t = new Date(order.actual_arrival).getTime()
    if (!isNaN(t) && t > 0) return t
  }
  if (order.route_finished_at) {
    const t = new Date(order.route_finished_at).getTime()
    if (!isNaN(t) && t > 0) return t
  }
  if (order.created) {
    const t = new Date(order.created).getTime()
    if (!isNaN(t) && t > 0) return t
  }
  return Date.now()
}

const MAX_JOINT_DELIVERY_INTERVAL_MS = 45 * 60 * 1000 // 45 minutos

/**
 * Agrupa uma lista de pedidos por entregas conjuntas no mesmo ponto.
 * Apenas pedidos entregues ('delivered') ou com rota concluída entram na detecção.
 */
export function detectMultiDeliveryGroups(orders: OrderRecord[]): MultiDeliveryGroup[] {
  // 1. Filtrar apenas pedidos elegíveis (entregues / concluídos pelo entregador)
  const eligible = orders.filter((o) => {
    if (o.status === 'cancelled') return false
    // Apenas pedidos entregues ou com finalização no cliente
    const st = String(o.status)
    return st === 'delivered' || (o.route_finished === true && st === 'in_transit')
  })

  // 2. Pré-agrupar por (courier_id + customer_id + dia)
  const buckets = new Map<string, OrderRecord[]>()

  for (const ord of eligible) {
    const courierId = ord.courier_id || 'unassigned'
    // Identificador único do cliente
    const rawAddr = String(
      ord.expand?.customer_id?.address || ord.start_base_address || ord.id || '',
    )
    const addrSlug = rawAddr ? rawAddr.toLowerCase().trim() : 'no_address'
    const customerId = String(
      ord.customer_id ||
        ord.expand?.customer_id?.id ||
        (ord.expand?.customer_id?.phone
          ? `phone_${String(ord.expand.customer_id.phone).replace(/\D/g, '')}`
          : `addr_${addrSlug}`),
    )

    const ts = getOrderDeliveryTimestamp(ord)
    const dayKey = getDeliveryDayKey(new Date(ts))

    const bucketKey = `${courierId}:::${customerId}:::${dayKey}`
    const list = buckets.get(bucketKey) || []
    list.push(ord)
    buckets.set(bucketKey, list)
  }

  const resultGroups: MultiDeliveryGroup[] = []

  // 3. Dentro de cada bucket, ordenar por timestamp de conclusão e encadear janelas <= 45 minutos
  buckets.forEach((bucketOrders, bucketKey) => {
    if (bucketOrders.length < 2) return

    // Ordenar cronologicamente por horário de entrega (ou de criação se igual)
    bucketOrders.sort((a, b) => {
      const ta = getOrderDeliveryTimestamp(a)
      const tb = getOrderDeliveryTimestamp(b)
      if (ta !== tb) return ta - tb
      return new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime()
    })

    const [courierId, customerId, dayKey] = bucketKey.split(':::')

    // Particionar em clusters contíguos onde a diferença com o vizinho ou com o âncora é <= 45 min
    let currentCluster: OrderRecord[] = [bucketOrders[0]]

    for (let i = 1; i < bucketOrders.length; i++) {
      const prevOrder = currentCluster[currentCluster.length - 1]
      const currOrder = bucketOrders[i]

      const tPrev = getOrderDeliveryTimestamp(prevOrder)
      const tCurr = getOrderDeliveryTimestamp(currOrder)

      if (Math.abs(tCurr - tPrev) <= MAX_JOINT_DELIVERY_INTERVAL_MS) {
        currentCluster.push(currOrder)
      } else {
        if (currentCluster.length >= 2) {
          resultGroups.push(buildGroup(currentCluster, courierId, customerId, dayKey))
        }
        currentCluster = [currOrder]
      }
    }

    if (currentCluster.length >= 2) {
      resultGroups.push(buildGroup(currentCluster, courierId, customerId, dayKey))
    }
  })

  return resultGroups
}

function buildGroup(
  cluster: OrderRecord[],
  courierId: string,
  customerId: string,
  dayKey: string,
): MultiDeliveryGroup {
  const primaryOrder = cluster[0]
  const groupId = `joint_${courierId}_${customerId}_${dayKey}_${primaryOrder.id}`
  const customerName =
    primaryOrder.expand?.customer_id?.name || primaryOrder.receiver_name || 'Cliente'

  return {
    groupId,
    customerId,
    customerName,
    courierId,
    dayKey,
    orders: cluster,
    primaryOrderId: primaryOrder.id,
    count: cluster.length,
  }
}

/**
 * Constrói um mapa rápido OrderID -> Metadados de Entrega Conjunta
 */
export function buildJointDeliveryMetaMap(
  orders: OrderRecord[],
): Map<string, JointDeliveryOrderMeta> {
  const groups = detectMultiDeliveryGroups(orders)
  const metaMap = new Map<string, JointDeliveryOrderMeta>()

  for (const group of groups) {
    const primaryOrder = group.orders[0]
    const allCodes = group.orders.map((o) => o.tracking_code || o.id)

    group.orders.forEach((ord, index) => {
      const isPrimary = index === 0
      const partnerCodes = allCodes.filter((c) => c !== (ord.tracking_code || ord.id))

      metaMap.set(ord.id, {
        isJointDelivery: true,
        isJointPrimary: isPrimary,
        isJointSecondary: !isPrimary,
        groupId: group.groupId,
        groupSize: group.count,
        primaryTrackingCode: primaryOrder.tracking_code || primaryOrder.id,
        primaryOrderId: primaryOrder.id,
        partnerTrackingCodes: partnerCodes,
      })
    })
  }

  return metaMap
}
