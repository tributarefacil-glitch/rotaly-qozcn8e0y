import type { OrderRecord } from '@/types/delivery'

/**
 * Interface representando um lote de rota agrupado com tolerância temporal de 2 minutos.
 */
export interface RouteBatchGroup {
  batchKey: string
  batchDisplay: string
  orders: OrderRecord[]
}

/**
 * Atribui ou reutiliza uma chave de lote de rota considerando a tolerância de 2 minutos
 * entre route_started_at e route_finished_at, evitando desmembramento por virada de minuto ou segundos.
 *
 * @param order Pedido a ser classificado
 * @param existingKeys Chaves de lotes já registradas no mapa de agrupamento
 */
export function getMergedRouteBatchKey(
  order: OrderRecord,
  existingKeys?: Iterable<string>,
): string {
  if (order.route_started_at && order.route_finished_at) {
    const oStartMs = new Date(order.route_started_at).getTime()
    const oFinishMs = new Date(order.route_finished_at).getTime()

    // Se houver chaves existentes, verificar tolerância de 2 minutos
    if (existingKeys) {
      for (const existingKey of existingKeys) {
        if (existingKey.startsWith('route_m_')) {
          const parts = existingKey.replace('route_m_', '').split('_')
          if (parts.length === 2) {
            const exStartMs = Number(parts[0]) * 60000
            const exFinishMs = Number(parts[1]) * 60000
            if (
              Math.abs(oStartMs - exStartMs) <= 2 * 60 * 1000 &&
              Math.abs(oFinishMs - exFinishMs) <= 2 * 60 * 1000
            ) {
              return existingKey
            }
          }
        }
      }
    }

    const startMin = Math.floor(oStartMs / 60000)
    const finishMin = Math.floor(oFinishMs / 60000)
    return `route_m_${startMin}_${finishMin}`
  }

  if (order.route_started_at) {
    const oTime = new Date(order.route_started_at).getTime()
    if (existingKeys) {
      for (const existingKey of existingKeys) {
        if (existingKey.startsWith('batch_') && !existingKey.startsWith('batch_created_')) {
          const batchTime = Number(existingKey.replace('batch_', '')) * (15 * 60 * 1000)
          if (Math.abs(oTime - batchTime) <= 15 * 60 * 1000) {
            return existingKey
          }
        }
      }
    }
    return `batch_${Math.floor(oTime / (15 * 60 * 1000))}`
  }

  if (order.created) {
    const cTime = new Date(order.created).getTime()
    if (existingKeys) {
      for (const existingKey of existingKeys) {
        if (existingKey.startsWith('batch_created_')) {
          const batchTime = Number(existingKey.replace('batch_created_', '')) * (15 * 60 * 1000)
          if (Math.abs(cTime - batchTime) <= 15 * 60 * 1000) {
            return existingKey
          }
        }
      }
    }
    return `batch_created_${Math.floor(cTime / (15 * 60 * 1000))}`
  }

  return `single_${order.id}`
}

/**
 * Retorna o rótulo amigável de exibição do lote no relatório e filtros.
 */
export function getRouteBatchDisplay(order: OrderRecord): string {
  if (order.route_started_at) {
    const timeStr = new Date(order.route_started_at).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })
    return order.route_finished_at ? `Rota ${timeStr}` : `Lote ${timeStr}`
  }
  return 'Avulso'
}

/**
 * Agrupa uma lista de pedidos em um Map<batchKey, OrderRecord[]>
 * usando SEMPRE a regra canônica com 2 minutos de tolerância.
 */
export function groupOrdersByRouteBatch(orders: OrderRecord[]): Map<string, OrderRecord[]> {
  const routeBatches = new Map<string, OrderRecord[]>()
  orders.forEach((o) => {
    const assignedKey = getMergedRouteBatchKey(o, routeBatches.keys())
    const list = routeBatches.get(assignedKey) || []
    list.push(o)
    routeBatches.set(assignedKey, list)
  })
  return routeBatches
}
