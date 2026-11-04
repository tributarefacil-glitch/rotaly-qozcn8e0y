import pb from '@/lib/pocketbase/client'
import { isOrderInPeriod, parseSafeTimestamp } from '@/lib/operationalWindow'
import { haversineDistanceMeters } from '@/lib/geo'

export type RouteLegType = 'base_to_stop' | 'stop_to_stop' | 'return_to_base'

export type RouteLegAnalysisStatus =
  | 'candidate_better' // GPS < Planejado (candidata à rota mais inteligente)
  | 'excess_deviation' // GPS >> Planejado (> 35% a mais, desvio ou erro)
  | 'equivalent' // GPS ~= Planejado (dentro da margem normal)
  | 'insufficient_data' // Menos de MIN_PINGS_PER_LEG pings válidos

export interface RouteLegItem {
  id?: string
  route_batch_key: string
  courier_id: string
  courier_name?: string
  empresa_id?: string
  leg_index: number
  leg_type: RouteLegType
  from_name: string
  to_name: string
  order_id?: string | null
  tracking_code?: string | null
  km_planned: number
  km_realized: number | null
  km_diff: number | null // km_realized - km_planned
  diff_pct: number | null // ((km_realized - km_planned) / km_planned) * 100
  pings_count: number
  is_better_route: boolean
  is_excess_deviation: boolean
  is_insufficient_data: boolean
  analysis_status: RouteLegAnalysisStatus
  started_at?: string | null
  finished_at?: string | null
  batch_finished_at?: string | null
  metadata?: Record<string, unknown>
}

export interface CourierIntelligenceAggregate {
  courier_id: string
  courier_name: string
  total_legs: number
  valid_legs: number
  insufficient_data_legs: number
  better_legs: number // quantas pernas venceu o planejado
  excess_deviation_legs: number
  equivalent_legs: number
  win_rate_pct: number // (better_legs / valid_legs) * 100
  total_km_planned: number
  total_km_realized: number
  net_km_saved: number // km_planned - km_realized nas pernas better
}

export interface RouteIntelligenceSummary {
  legs: RouteLegItem[]
  aggregates: CourierIntelligenceAggregate[]
  total_batches: number
  total_legs_count: number
  total_better_legs: number
  total_excess_deviation_legs: number
  total_insufficient_data_legs: number
  total_km_planned_valid: number
  total_km_realized_valid: number
  global_win_rate_pct: number
}

export interface FetchRouteIntelligenceOptions {
  periodFilter: 'all' | 'today' | 'week' | 'month' | 'previous_month' | 'custom'
  customStartDate?: string // YYYY-MM-DD
  customEndDate?: string // YYYY-MM-DD
  courierId?: string | 'all'
  statusFilter?: 'all' | 'better' | 'deviation' | 'insufficient' | 'equivalent'
  empresaId?: string
  persistArchive?: boolean // se true, salva/atualiza registros na coleção route_leg_analysis
}

// Limiar mínimo de pings base.
// REGRA RECALIBRADA: densidade proporcional ao tamanho da perna.
// Pernas muito curtas (< 1km) exigem ao menos 5 pings.
// Pernas maiores exigem ~3 pings por km planejado (mínimo 5 pings),
// impedindo que lotes furados com 2-3 pings gerem falsos "candidato a rota melhor" (ex: -97% de desvio).
export const MIN_PINGS_PER_LEG = 5

export function getRequiredPingsForLeg(kmPlanned: number): number {
  const safeKm = Math.max(0, Number(kmPlanned) || 0)
  if (safeKm <= 0.5) return 4
  if (safeKm <= 1.0) return 5
  // Para pernas maiores: 3 pings por km planejado, com piso de 5 e teto de 30
  return Math.min(30, Math.max(5, Math.ceil(safeKm * 3)))
}

// Tolerância para classificar como "rota melhor": pelo menos 0.15 km menor ou 5% menor
export const BETTER_ROUTE_KM_MARGIN = 0.15
export const BETTER_ROUTE_PCT_MARGIN = 5 // %

// Tolerância para desvio excessivo: > 35% acima do planejado ou +2.0 km
export const EXCESS_DEVIATION_PCT_MARGIN = 35 // %
export const EXCESS_DEVIATION_KM_MARGIN = 2.0 // km

/**
 * Normaliza e classifica uma perna de rota comparando planejado vs realizado.
 */
export function classifyRouteLeg(
  kmPlanned: number,
  kmRealized: number | null | undefined,
  pingsCount: number,
): {
  status: RouteLegAnalysisStatus
  kmDiff: number | null
  diffPct: number | null
  isBetter: boolean
  isExcess: boolean
  isInsufficient: boolean
} {
  const safePlanned = Number((Number(kmPlanned) || 0).toFixed(2))
  const requiredPings = getRequiredPingsForLeg(safePlanned)

  // Se a perna não possui pings suficientes para a extensão do trajeto, fica como dados insuficientes
  if (pingsCount < requiredPings || kmRealized === null || kmRealized === undefined) {
    return {
      status: 'insufficient_data',
      kmDiff: null,
      diffPct: null,
      isBetter: false,
      isExcess: false,
      isInsufficient: true,
    }
  }

  const safeRealized = Number((Number(kmRealized) || 0).toFixed(2))
  const diff = Number((safeRealized - safePlanned).toFixed(2))
  const pct = safePlanned > 0 ? Number(((diff / safePlanned) * 100).toFixed(1)) : 0

  // Se a diferença percentual for absurda (ex: -80% ou menos), é evidente que a telemetria não registrou
  // o trajeto completo (buraco de GPS). Não pode jamais nascer como "candidate_better".
  if (pct <= -70 && safePlanned >= 0.5) {
    return {
      status: 'insufficient_data',
      kmDiff: diff,
      diffPct: pct,
      isBetter: false,
      isExcess: false,
      isInsufficient: true,
    }
  }

  // Candidata a rota melhor: realizado MENOR que o planejado respeitando margem mínima
  const isBetter =
    safeRealized < safePlanned &&
    (safePlanned - safeRealized >= BETTER_ROUTE_KM_MARGIN || pct <= -BETTER_ROUTE_PCT_MARGIN)

  // Desvio excessivo: realizado MUITO MAIOR que o planejado
  const isExcess =
    diff > 0 && (pct >= EXCESS_DEVIATION_PCT_MARGIN || diff >= EXCESS_DEVIATION_KM_MARGIN)

  let status: RouteLegAnalysisStatus = 'equivalent'
  if (isBetter) {
    status = 'candidate_better'
  } else if (isExcess) {
    status = 'excess_deviation'
  }

  return {
    status,
    kmDiff: diff,
    diffPct: pct,
    isBetter,
    isExcess,
    isInsufficient: false,
  }
}

/**
 * Saneia pings de telemetria brutos:
 * - accuracy estritamente < 100m (guarda anti-zumbi)
 * - deduplicação temporal/espacial (>= 5s ou >= 10m)
 */
export function sanitizeGpsLocations(
  rawLocations: Array<{
    lat: number
    lng: number
    accuracy?: number | null
    created: string
    location_timestamp?: string | null
  }>,
): Array<{ lat: number; lng: number; created: string; timestampMs: number }> {
  const valid = rawLocations
    .filter((loc) => {
      const acc = typeof loc.accuracy === 'number' ? loc.accuracy : 0
      return acc < 100 && typeof loc.lat === 'number' && typeof loc.lng === 'number'
    })
    .map((loc) => {
      const ts = parseSafeTimestamp(loc.location_timestamp) || parseSafeTimestamp(loc.created) || 0
      return {
        lat: loc.lat,
        lng: loc.lng,
        created: loc.created,
        timestampMs: ts,
      }
    })
    .filter((loc) => loc.timestampMs > 0)
    .sort((a, b) => a.timestampMs - b.timestampMs)

  if (valid.length <= 1) return valid

  const deduped: Array<{ lat: number; lng: number; created: string; timestampMs: number }> = [
    valid[0],
  ]
  for (let i = 1; i < valid.length; i++) {
    const prev = deduped[deduped.length - 1]
    const curr = valid[i]
    const deltaMs = curr.timestampMs - prev.timestampMs
    const distM = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng)

    // Deduplica pings gravados em rajada a menos de 5 segundos ou com movimento < 10 metros
    if (deltaMs >= 5000 || distM >= 10) {
      deduped.push(curr)
    }
  }

  return deduped
}

/**
 * Busca lotes de telemetria já consolidados (route_batch_telemetry) e computa a análise perna a perna.
 * Opcionalmente salva/atualiza na coleção `route_leg_analysis`.
 */
export async function fetchRouteIntelligenceAnalysis(
  options: FetchRouteIntelligenceOptions,
): Promise<RouteIntelligenceSummary> {
  const {
    periodFilter,
    customStartDate,
    customEndDate,
    courierId = 'all',
    statusFilter = 'all',
    empresaId,
    persistArchive = true,
  } = options

  // 1. Carregar mapa de usuários para exibir nomes reais de entregadores
  const userMap = new Map<string, string>()
  try {
    const users = await pb.collection('users').getFullList({
      filter: "role = 'courier'",
      fields: 'id,name,email',
    })
    users.forEach((u: any) => {
      userMap.set(u.id, u.name || u.email || 'Entregador')
    })
  } catch (errUsers) {
    console.warn('[routeIntelligenceService] Aviso ao carregar entregadores:', errUsers)
  }

  // 2. Montar filtro base para route_batch_telemetry
  const filterParts: string[] = []
  if (courierId && courierId !== 'all') {
    filterParts.push(`courier_id = '${courierId}'`)
  }
  if (empresaId) {
    filterParts.push(`empresa_id = '${empresaId}'`)
  }

  const pbFilter = filterParts.length > 0 ? filterParts.join(' && ') : ''

  // Buscar lotes de telemetria ordenados pelos mais recentes
  let batchTelemetryRecords: any[] = []
  try {
    batchTelemetryRecords = await pb.collection('route_batch_telemetry').getFullList({
      filter: pbFilter,
      sort: '-created',
      requestKey: null,
    })
  } catch (errBatch) {
    console.error('[routeIntelligenceService] Erro ao carregar route_batch_telemetry:', errBatch)
    batchTelemetryRecords = []
  }

  // 3. Filtrar registros pelo período selecionado
  const filteredBatches = batchTelemetryRecords.filter((rec) => {
    const rawDate = rec.route_finished_at || rec.created || rec.updated
    if (!rawDate) return false

    if (periodFilter === 'custom') {
      if (!customStartDate && !customEndDate) return true
      const ts = parseSafeTimestamp(rawDate)
      if (customStartDate) {
        const startTs = new Date(`${customStartDate}T00:00:00-03:00`).getTime()
        if (ts < startTs) return false
      }
      if (customEndDate) {
        const endTs = new Date(`${customEndDate}T23:59:59-03:00`).getTime()
        if (ts > endTs) return false
      }
      return true
    }

    return isOrderInPeriod(rawDate, periodFilter as any)
  })

  // 4. Extrair e classificar pernas
  const rawLegs: RouteLegItem[] = []

  for (const batch of filteredBatches) {
    const legsData: any[] = Array.isArray(batch.legs_data) ? batch.legs_data : []
    const totalBatchPings = Number(batch.pings_count) || 0
    const courierName = userMap.get(batch.courier_id) || 'Entregador'

    legsData.forEach((leg: any, idx: number) => {
      const legIndex = typeof leg.leg_index === 'number' ? leg.leg_index : idx + 1
      const isReturn = Boolean(leg.is_return)
      let legType: RouteLegType = 'stop_to_stop'
      if (legIndex === 1) {
        legType = 'base_to_stop'
      } else if (isReturn) {
        legType = 'return_to_base'
      }

      const kmPlanned = Number((Number(leg.km_viario) || 0).toFixed(2))
      const kmRealized =
        leg.km_gps !== null && leg.km_gps !== undefined
          ? Number((Number(leg.km_gps) || 0).toFixed(2))
          : null

      // Estimar pings da perna ou usar cota proporcional caso pings_count da perna não esteja isolado
      let legPings = typeof leg.pings_count === 'number' ? leg.pings_count : 0
      if (legPings === 0 && totalBatchPings > 0 && legsData.length > 0) {
        // Se a perna tem km_gps registrado maior que 0 e o lote teve pings, inferir quantidade mínima
        if (kmRealized !== null && kmRealized > 0) {
          legPings = Math.max(MIN_PINGS_PER_LEG, Math.round(totalBatchPings / legsData.length))
        }
      }

      const classification = classifyRouteLeg(kmPlanned, kmRealized, legPings)

      const legItem: RouteLegItem = {
        route_batch_key: batch.route_batch_key,
        courier_id: batch.courier_id,
        courier_name: courierName,
        empresa_id: batch.empresa_id || undefined,
        leg_index: legIndex,
        leg_type: legType,
        from_name: String(leg.from_name || (legIndex === 1 ? 'Base Oficial' : 'Parada')).trim(),
        to_name: String(leg.to_name || (isReturn ? 'Volta à Base' : 'Cliente')).trim(),
        order_id: leg.order_id || null,
        tracking_code: leg.tracking_code || null,
        km_planned: kmPlanned,
        km_realized: kmRealized,
        km_diff: classification.kmDiff,
        diff_pct: classification.diffPct,
        pings_count: legPings,
        is_better_route: classification.isBetter,
        is_excess_deviation: classification.isExcess,
        is_insufficient_data: classification.isInsufficient,
        analysis_status: classification.status,
        started_at: batch.route_started_at || null,
        finished_at: batch.route_finished_at || null,
        batch_finished_at: batch.route_finished_at || batch.created || null,
        metadata: {
          batch_status: batch.status,
          batch_total_pings: totalBatchPings,
        },
      }

      rawLegs.push(legItem)
    })
  }

  // 5. Opcional: persistência assíncrona idempotente no banco para servir de acervo da Etapa 2
  if (persistArchive && rawLegs.length > 0) {
    // Dispara em background para não onerar a renderização
    persistLegsAnalysisArchive(rawLegs).catch((errArch) => {
      console.warn('[routeIntelligenceService] Aviso ao persistir acervo de pernas:', errArch)
    })
  }

  // 6. Aplicar filtro de status de exibição
  const filteredLegs = rawLegs.filter((leg) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'better') return leg.analysis_status === 'candidate_better'
    if (statusFilter === 'deviation') return leg.analysis_status === 'excess_deviation'
    if (statusFilter === 'insufficient') return leg.analysis_status === 'insufficient_data'
    if (statusFilter === 'equivalent') return leg.analysis_status === 'equivalent'
    return true
  })

  // 7. Agregação por Entregador (apenas pernas válidas contam para o win rate e somas)
  const courierMap = new Map<string, CourierIntelligenceAggregate>()

  for (const leg of rawLegs) {
    const cId = leg.courier_id
    if (!courierMap.has(cId)) {
      courierMap.set(cId, {
        courier_id: cId,
        courier_name: leg.courier_name || 'Entregador',
        total_legs: 0,
        valid_legs: 0,
        insufficient_data_legs: 0,
        better_legs: 0,
        excess_deviation_legs: 0,
        equivalent_legs: 0,
        win_rate_pct: 0,
        total_km_planned: 0,
        total_km_realized: 0,
        net_km_saved: 0,
      })
    }

    const agg = courierMap.get(cId)!
    agg.total_legs++

    if (leg.is_insufficient_data) {
      agg.insufficient_data_legs++
    } else {
      agg.valid_legs++
      agg.total_km_planned = Number((agg.total_km_planned + leg.km_planned).toFixed(2))
      if (leg.km_realized !== null) {
        agg.total_km_realized = Number((agg.total_km_realized + leg.km_realized).toFixed(2))
      }

      if (leg.is_better_route) {
        agg.better_legs++
        if (leg.km_diff !== null && leg.km_diff < 0) {
          agg.net_km_saved = Number((agg.net_km_saved + Math.abs(leg.km_diff)).toFixed(2))
        }
      } else if (leg.is_excess_deviation) {
        agg.excess_deviation_legs++
      } else {
        agg.equivalent_legs++
      }
    }
  }

  // Calcular taxa de vitória (quantas pernas venceu o planejado)
  const aggregates: CourierIntelligenceAggregate[] = Array.from(courierMap.values()).map((agg) => {
    const winRate =
      agg.valid_legs > 0 ? Number(((agg.better_legs / agg.valid_legs) * 100).toFixed(1)) : 0
    return {
      ...agg,
      win_rate_pct: winRate,
    }
  })

  // 8. Resumo Global
  let totalBetter = 0
  let totalExcess = 0
  let totalInsufficient = 0
  let totalKmPlannedValid = 0
  let totalKmRealizedValid = 0
  let totalValidLegs = 0

  for (const leg of rawLegs) {
    if (leg.is_insufficient_data) {
      totalInsufficient++
    } else {
      totalValidLegs++
      totalKmPlannedValid += leg.km_planned
      if (leg.km_realized !== null) {
        totalKmRealizedValid += leg.km_realized
      }
      if (leg.is_better_route) totalBetter++
      if (leg.is_excess_deviation) totalExcess++
    }
  }

  const globalWinRate =
    totalValidLegs > 0 ? Number(((totalBetter / totalValidLegs) * 100).toFixed(1)) : 0

  return {
    legs: filteredLegs,
    aggregates,
    total_batches: filteredBatches.length,
    total_legs_count: rawLegs.length,
    total_better_legs: totalBetter,
    total_excess_deviation_legs: totalExcess,
    total_insufficient_data_legs: totalInsufficient,
    total_km_planned_valid: Number(totalKmPlannedValid.toFixed(2)),
    total_km_realized_valid: Number(totalKmRealizedValid.toFixed(2)),
    global_win_rate_pct: globalWinRate,
  }
}

/**
 * Persiste pernas analisadas na coleção `route_leg_analysis` de forma idempotente
 * para acervo de aprendizado do otimizador.
 */
async function persistLegsAnalysisArchive(legs: RouteLegItem[]): Promise<void> {
  const collectionName = 'route_leg_analysis'

  for (const leg of legs) {
    const payload = {
      route_batch_key: leg.route_batch_key,
      courier_id: leg.courier_id,
      empresa_id: leg.empresa_id || undefined,
      leg_index: leg.leg_index,
      leg_type: leg.leg_type,
      from_name: leg.from_name,
      to_name: leg.to_name,
      order_id: leg.order_id || '',
      tracking_code: leg.tracking_code || '',
      km_planned: leg.km_planned,
      km_realized: leg.km_realized ?? 0,
      km_diff: leg.km_diff ?? 0,
      diff_pct: leg.diff_pct ?? 0,
      pings_count: leg.pings_count,
      is_better_route: leg.is_better_route,
      is_excess_deviation: leg.is_excess_deviation,
      is_insufficient_data: leg.is_insufficient_data,
      analysis_status: leg.analysis_status,
      started_at: leg.started_at || undefined,
      finished_at: leg.finished_at || undefined,
      metadata: leg.metadata || {},
    }

    try {
      // Verificar se já existe pelo par (route_batch_key, leg_index)
      const existing = await pb
        .collection(collectionName)
        .getFirstListItem(
          `route_batch_key = '${leg.route_batch_key}' && leg_index = ${leg.leg_index}`,
          { requestKey: null },
        )
      if (existing) {
        await pb.collection(collectionName).update(existing.id, payload, { requestKey: null })
      }
    } catch {
      // Se não existir, cria novo registro
      try {
        await pb.collection(collectionName).create(payload, { requestKey: null })
      } catch (errCreate) {
        // Ignora duplicidade caso já gravado
        console.debug('[routeIntelligenceService] Info ao criar acervo de perna:', errCreate)
      }
    }
  }
}
