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
/**
 * Helper canônico único para derivação de chave de lote de rota.
 * Considera:
 * - Data civil do pedido (YYYY-MM-DD)
 * - Entregador (courier_id)
 * - route_started_at com janela temporal de ~2 minutos
 * Evita desmembramento por virada de segundo ou minuto e garante
 * agrupamento idêntico em todas as telas (Auditoria, Histórico, Combustível).
 */
export function deriveRouteBatchKey(
  order: OrderRecord,
  existingKeys?: Iterable<string>,
  courierId?: string,
): string {
  // Prioridade 1: chave explicitamente gravada no banco
  const explicitKey = (order.route_batch_key || '').trim()
  if (explicitKey) {
    return explicitKey
  }

  const effectiveCourier = courierId || order.courier_id || 'unassigned'

  if (order.route_started_at) {
    const oStartMs = new Date(order.route_started_at).getTime()
    const oFinishMs = order.route_finished_at ? new Date(order.route_finished_at).getTime() : 0
    const dateStr = order.route_started_at.slice(0, 10)

    if (existingKeys) {
      for (const existingKey of existingKeys) {
        // Formato canônico: route_${courier}_${date}_${startMin} ou legado route_m_${startMin}_${finishMin}
        if (existingKey.startsWith(`rb_${effectiveCourier}_`)) {
          const parts = existingKey.split('_')
          // rb, courier, date, startMin
          if (parts.length >= 4) {
            const exDate = parts[2]
            const exStartMin = Number(parts[3])
            const exStartMs = exStartMin * 60000
            if (exDate === dateStr && Math.abs(oStartMs - exStartMs) <= 2 * 60 * 1000) {
              return existingKey
            }
          }
        } else if (existingKey.startsWith('route_m_')) {
          const parts = existingKey.replace('route_m_', '').split('_')
          if (parts.length === 2) {
            const exStartMs = Number(parts[0]) * 60000
            const exFinishMs = Number(parts[1]) * 60000
            if (
              Math.abs(oStartMs - exStartMs) <= 2 * 60 * 1000 &&
              (oFinishMs === 0 ||
                exFinishMs === 0 ||
                Math.abs(oFinishMs - exFinishMs) <= 2 * 60 * 1000)
            ) {
              return existingKey
            }
          }
        }
      }
    }

    const startMin = Math.floor(oStartMs / 60000)
    const dateFormatted = dateStr.replace(/-/g, '')
    return `rb_${effectiveCourier}_${dateFormatted}_${startMin}`
  }

  if (order.created) {
    const cTime = new Date(order.created).getTime()
    const dateStr = order.created.slice(0, 10).replace(/-/g, '')
    const startMin = Math.floor(cTime / 60000)
    return `rb_${effectiveCourier}_${dateStr}_${startMin}`
  }

  return `rb_${effectiveCourier}_nodate_${order.id}`
}

/**
 * Função única construtora da chave de lote rb_{courierId}_{YYYYMMDD}_{startMin}
 * Compartilhada pelo fechamento, motor canônico, guarda de sanidade e telas.
 */
export function buildCanonicalRouteBatchKey(
  courierId: string,
  dateOrTimestamp: string | number | Date,
): string {
  const d = new Date(dateOrTimestamp)
  const ts = d.getTime()
  const startMin = Math.floor(ts / 60000)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const dateStr = `${yyyy}${mm}${dd}`
  const cId = courierId || 'unassigned'
  return `rb_${cId}_${dateStr}_${startMin}`
}

/**
 * Re-export para compatibilidade reversa com chamadas legadas
 */
export function getMergedRouteBatchKey(
  order: OrderRecord,
  existingKeys?: Iterable<string>,
): string {
  return deriveRouteBatchKey(order, existingKeys)
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
export function groupOrdersByRouteBatch(
  orders: OrderRecord[],
  courierId?: string,
): Map<string, OrderRecord[]> {
  const routeBatches = new Map<string, OrderRecord[]>()

  // Pedidos que já possuem route_batch_key gravado no banco usam estritamente essa chave
  // Apenas pedidos sem chave gravada caem no agrupamento temporal de fallback
  orders.forEach((o) => {
    const explicitKey = (o.route_batch_key || '').trim()
    const assignedKey = explicitKey || deriveRouteBatchKey(o, routeBatches.keys(), courierId)
    const list = routeBatches.get(assignedKey) || []
    list.push(o)
    routeBatches.set(assignedKey, list)
  })
  return routeBatches
}
