/**
 * offlineFinishQueue.ts
 *
 * Fila persistente (localStorage) para a finalização de rota/lote que falhou por rede.
 *
 * Regra operacional (urgência Edson, 2026-11): o entregador sem internet na base NUNCA pode
 * ficar travado no toque de finalizar. Se a finalização falhar por rede (ou por pedidos cujo
 * desfecho ainda está no buffer offline), a tentativa é enfileirada aqui e reexecutada
 * automaticamente quando a conexão volta (listener de online no CourierApp), sem exigir novo toque.
 */

const KEY = 'rotaly_pending_route_finish'

export interface PendingRouteFinish {
  courierId: string
  orderIds: string[]
  batchKey: string
  origin: string
  latitude: number | null
  longitude: number | null
  distanceToBaseMeters: number | null
  enqueuedAt: number
  attempts: number
  lastError?: string
}

export function getPendingRouteFinish(): PendingRouteFinish | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingRouteFinish
    if (
      !parsed ||
      !parsed.courierId ||
      !Array.isArray(parsed.orderIds) ||
      parsed.orderIds.length === 0
    ) {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function enqueuePendingRouteFinish(
  entry: Omit<PendingRouteFinish, 'enqueuedAt' | 'attempts'> & {
    attempts?: number
    lastError?: string
  },
): void {
  try {
    const existing = getPendingRouteFinish()
    // Se já existe uma tentativa enfileirada para o mesmo entregador, mantém a mais antiga
    // e apenas incrementa o contador (evita sobrescrever o lote original por um lote vazio).
    if (
      existing &&
      existing.courierId === entry.courierId &&
      existing.orderIds.length >= entry.orderIds.length
    ) {
      existing.attempts = (existing.attempts || 0) + 1
      existing.lastError = entry.lastError
      existing.distanceToBaseMeters = entry.distanceToBaseMeters ?? existing.distanceToBaseMeters
      localStorage.setItem(KEY, JSON.stringify(existing))
      return
    }
    const payload: PendingRouteFinish = {
      ...entry,
      attempts: entry.attempts ?? (existing ? existing.attempts + 1 : 1),
      enqueuedAt: existing?.enqueuedAt || Date.now(),
    }
    localStorage.setItem(KEY, JSON.stringify(payload))
  } catch {
    /* ignore quota errors */
  }
}

export function clearPendingRouteFinish(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* ignore */
  }
}
