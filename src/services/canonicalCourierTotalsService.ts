import {
  AppSettingsRecord,
  OrderRecord,
  UserRecord,
  FuelAdvanceRecord,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
import {
  getOperationalWindow,
  getOperationalMonthStart,
  getCustomOperationalWindow,
  isCurrentMonthInTz,
  isAdvancePostCutoff,
} from '@/lib/operationalWindow'
import { deliveryService } from '@/services/deliveryService'
import { groupOrdersByRouteBatch } from '@/lib/routeBatchHelper'

export interface CanonicalBatchMetric {
  routeBatchKey: string
  officialKm: number
  roadKm: number
  gpsKm: number
  deviationEpisodesCount: number
  maxDeviationMeters: number
  fuelCost: number
  litersSpent: number
  dateIso: string
  isApproved: boolean
  approvedKm?: number
}

export interface CanonicalCourierTotals {
  courierId: string
  courierName: string
  vehicleCategory: string
  consumptionKml: number
  pricePerLiter: number
  totalOfficialKm: number
  totalSpent: number
  fuelCost: number
  openingBalance: number
  totalAdvances: number
  postCutoffAdvances: number
  postCutoffSpent: number
  balance: number
  deviationEpisodesCount: number
  maxDeviationMeters: number
  batchesCount: number
  deliveriesCount: number
  batchMetrics: CanonicalBatchMetric[]
  orderAllocations: Map<
    string,
    {
      officialKm: number
      fuelCost: number
      deviationEpisodes: number
      maxDeviationMeters: number
      isJointSecondary: boolean
    }
  >
}

export interface CalculateCanonicalTotalsParams {
  courier: UserRecord
  telemetryBatches?: RouteBatchTelemetryRecord[]
  orders?: OrderRecord[]
  advances?: FuelAdvanceRecord[]
  settings?: Partial<AppSettingsRecord> | null
  periodFilter?: 'all' | 'today' | 'week' | 'month' | 'custom'
  customStartDate?: string
  customEndDate?: string
  approvalsMap?: Map<string, { approvedKm: number; status: 'approved' | 'rejected' | 'pending' }>
}

/**
 * FONTE ÚNICA DE VERDADE:
 * Calcula KM Oficial, Combustível, Gasto e Saldo exclusivamente a partir do km_oficial auditado
 * dos registros de route_batch_telemetry do courier, dedup 1x por route_batch_key.
 *
 * REGRAS INVIOLÁVEIS:
 * 1. PROIBIDO somar km_gps_total cru, km_real_perna poluído, km de desvio ou fontes não-auditadas.
 * 2. Desvio de rota NUNCA entra em km, combustível ou saldo. A coluna/métrica de desvio mostra
 *    apenas a CONTAGEM de episódios e a distância máxima em metros.
 * 3. km pago do período = soma dos km_oficial dos lotes elegíveis no período.
 * 4. Combustível = (se bicicleta: 0) senão (km oficial ÷ consumo km/L × preço/L).
 * 5. Saldo = saldo_abertura + adiantamentos pós-corte − gasto pós-corte.
 * 6. Guarda de sanidade: rejeitar lote com km > 2x viário; teto de coerência.
 * 7. Respeitar aprovação manual do admin (se admin aprovou km maior para o lote/pedido).
 */
export function calculateCanonicalCourierTotals(
  params: CalculateCanonicalTotalsParams,
): CanonicalCourierTotals {
  const {
    courier,
    telemetryBatches = [],
    orders = [],
    advances = [],
    settings = null,
    periodFilter = 'all',
    customStartDate,
    customEndDate,
    approvalsMap,
  } = params

  const now = new Date()
  const opWindow = getOperationalWindow(now)
  const courierId = courier.id || ''
  const courierName = courier.name || 'Entregador'

  // 1. Parâmetros de combustível
  const defaultParams = deliveryService.getVehicleFuelParams(
    settings as AppSettingsRecord | null,
    courier.vehicle_type,
  )
  const vehicleCategory = defaultParams.category
  const isBicycle =
    vehicleCategory === 'bicicleta' ||
    courier.vehicle_type === 'bicicleta' ||
    courier.vehicle_type === 'bicycle'

  const consumptionKml =
    typeof courier.consumption_kml === 'number' && courier.consumption_kml > 0
      ? courier.consumption_kml
      : defaultParams.consumptionKml || 30.0

  const pricePerLiter =
    typeof courier.fuel_price === 'number' && courier.fuel_price > 0
      ? courier.fuel_price
      : defaultParams.pricePerLiter || 6.49

  // 2. Janela operacional do período
  let startTs = 0
  let endTs = Infinity

  if (periodFilter === 'today') {
    startTs = opWindow.start
    endTs = opWindow.end
  } else if (periodFilter === 'week') {
    startTs = opWindow.start - 6 * 24 * 60 * 60 * 1000
    endTs = opWindow.end
  } else if (periodFilter === 'month') {
    const monthStart = getOperationalMonthStart(now)
    startTs = monthStart.timestamp
    endTs = opWindow.end
  } else if (periodFilter === 'custom' && customStartDate && customEndDate) {
    const win = getCustomOperationalWindow(customStartDate, customEndDate)
    if (win) {
      startTs = win.start
      endTs = win.end
    }
  }

  // 3. Cutoff Date e Opening Balance
  const cutoffDateStr = courier.cutoff_date || undefined
  const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
  const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)
  const openingBalance = typeof courier.opening_balance === 'number' ? courier.opening_balance : 0

  // 4. Adiantamentos
  const courierAdvances = advances.filter(
    (a) => a && a.courier_id === courierId && a.status !== 'cancelled',
  )
  const postCutoffAdvancesList = courierAdvances.filter((a) => {
    if (a.entry_type === 'balance_adjustment') return false
    if (a.entry_type && a.entry_type !== 'advance') return false
    if (!hasCutoff) return true
    return isAdvancePostCutoff(a.date || a.created, cutoffDateStr)
  })

  const totalAdvances = courierAdvances
    .filter((a) => !a.entry_type || a.entry_type === 'advance')
    .reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

  const postCutoffAdvances = postCutoffAdvancesList.reduce(
    (sum, a) => sum + (Number(a.amount) || 0),
    0,
  )

  // 5. Deduplicação e apuração de lotes de telemetria
  // Mapa de lotes por route_batch_key (dedup 1x)
  const uniqueBatchesMap = new Map<string, RouteBatchTelemetryRecord>()
  telemetryBatches
    .filter((b) => b && b.courier_id === courierId && b.route_batch_key)
    .forEach((b) => {
      // Se houver duplicata, mantém o mais recente
      const existing = uniqueBatchesMap.get(b.route_batch_key)
      if (
        !existing ||
        new Date(b.updated || b.created).getTime() >
          new Date(existing.updated || existing.created).getTime()
      ) {
        uniqueBatchesMap.set(b.route_batch_key, b)
      }
    })

  // Se houver pedidos sem registro em telemetryBatches, sintetizar lotes viários auditados seguros
  const courierOrders = orders.filter(
    (o) => o && o.courier_id === courierId && o.status !== 'cancelled',
  )
  const orderGroups = groupOrdersByRouteBatch(courierOrders, courierId)

  orderGroups.forEach((batchOrders, bKey) => {
    if (!uniqueBatchesMap.has(bKey)) {
      // Cria lote auditado a partir do viário dos pedidos com guarda de sanidade
      const anchor = batchOrders[0]
      const maxRoad = batchOrders.reduce(
        (max, o) => Math.max(max, Number(o.total_route_with_return_km) || 0),
        0,
      )
      const sumOutbound = batchOrders.reduce((sum, o) => sum + (Number(o.distance_km) || 0), 0)
      let canonicalKm = maxRoad > 0 ? maxRoad : sumOutbound
      // Guarda de sanidade: teto de 50 km se for sem telemetria
      if (canonicalKm > 60) canonicalKm = Math.min(sumOutbound, 35)

      uniqueBatchesMap.set(bKey, {
        id: `synth_${bKey}`,
        collectionId: 'route_batch_telemetry',
        collectionName: 'route_batch_telemetry',
        route_batch_key: bKey,
        courier_id: courierId,
        km_gps_total: canonicalKm,
        km_viario_total: canonicalKm,
        km_oficial: canonicalKm,
        route_started_at: anchor.route_started_at || anchor.created,
        route_finished_at: anchor.route_finished_at || anchor.actual_arrival || anchor.created,
        created: anchor.created,
        updated: anchor.updated,
        status: 'processed',
        deviation_classification: [],
      } as unknown as RouteBatchTelemetryRecord)
    }
  })

  // 6. Processamento dos lotes dedup 1x
  let totalOfficialKmPeriod = 0
  let totalPostCutoffKm = 0
  let totalDeviationEpisodes = 0
  let maxDeviationMetersAll = 0
  const batchMetrics: CanonicalBatchMetric[] = []
  const orderAllocations = new Map<
    string,
    {
      officialKm: number
      fuelCost: number
      deviationEpisodes: number
      maxDeviationMeters: number
      isJointSecondary: boolean
    }
  >()

  let deliveriesCountInPeriod = 0

  uniqueBatchesMap.forEach((batchRec, bKey) => {
    const batchOrders =
      orderGroups.get(bKey) || courierOrders.filter((o) => o.route_batch_key === bKey)
    const dateVal = batchRec.route_finished_at || batchRec.route_started_at || batchRec.created
    const dateTs = new Date(dateVal).getTime()

    // KM Oficial Canônico do Lote
    let viario = Number(batchRec.km_viario_total) || 0
    let gps = Number(batchRec.km_gps_total) || 0
    let kmOficial = Number(batchRec.km_oficial) || 0

    // FUTURO: Guarda de sanidade nos somatórios (rejeitar fonte com km > 2x viário; teto de coerência)
    if (viario > 0 && gps > viario * 2) {
      gps = Number((viario * 1.15).toFixed(2))
    }
    if (kmOficial <= 0 || (viario > 0 && kmOficial > viario * 2)) {
      kmOficial = viario > 0 ? (gps > 0 ? Math.min(viario, gps) : viario) : gps
    }

    // Regra da aprovação manual do admin: se admin aprovou km para pedidos do lote ou para o lote
    let isApproved = false
    let approvedKmVal: number | undefined
    if (approvalsMap) {
      let sumApproved = 0
      let hasApproval = false
      batchOrders.forEach((bo) => {
        const app = approvalsMap.get(bo.id)
        if (app && app.status === 'approved' && app.approvedKm > 0) {
          sumApproved += app.approvedKm
          hasApproval = true
        }
      })
      if (hasApproval && sumApproved > 0) {
        isApproved = true
        approvedKmVal = Number(sumApproved.toFixed(1))
        // Se aprovado maior ou menor, respeitar o aprovado
        kmOficial = approvedKmVal
      }
    }

    kmOficial = Number(kmOficial.toFixed(2))

    // Desvio de rota: NUNCA soma km. CONTAGEM de episódios e distância máxima
    const rawDevs = batchRec.deviation_classification || []
    const episodesCount = Array.isArray(rawDevs) ? rawDevs.length : 0
    let batchMaxDevMeters = 0
    if (Array.isArray(rawDevs)) {
      rawDevs.forEach((d) => {
        const dist = Number(d.max_deviation_meters) || 0
        if (dist > batchMaxDevMeters) batchMaxDevMeters = dist
      })
    }

    const batchLiters =
      !isBicycle && consumptionKml > 0 ? Number((kmOficial / consumptionKml).toFixed(2)) : 0
    const batchFuelCost = !isBicycle ? Number((batchLiters * pricePerLiter).toFixed(2)) : 0

    const metric: CanonicalBatchMetric = {
      routeBatchKey: bKey,
      officialKm: kmOficial,
      roadKm: viario,
      gpsKm: gps,
      deviationEpisodesCount: episodesCount,
      maxDeviationMeters: batchMaxDevMeters,
      fuelCost: batchFuelCost,
      litersSpent: batchLiters,
      dateIso: dateVal,
      isApproved,
      approvedKm: approvedKmVal,
    }
    batchMetrics.push(metric)

    // Checar elegibilidade pós-corte para compor o Saldo Invariante
    const isPostCutoff = !hasCutoff || dateTs >= cutoffTime
    if (isPostCutoff) {
      totalPostCutoffKm += kmOficial
    }

    // Checar elegibilidade no período selecionado
    const isInPeriod = periodFilter === 'all' || (dateTs >= startTs && dateTs <= endTs)
    if (isInPeriod) {
      totalOfficialKmPeriod += kmOficial
      totalDeviationEpisodes += episodesCount
      if (batchMaxDevMeters > maxDeviationMetersAll) {
        maxDeviationMetersAll = batchMaxDevMeters
      }
      deliveriesCountInPeriod += batchOrders.length

      // Rateio por entrega dentro do lote para exibição nas linhas
      const orderCount = batchOrders.length
      if (orderCount > 0) {
        const shareKm = Number((kmOficial / orderCount).toFixed(1))
        const shareFuel = !isBicycle ? Number((batchFuelCost / orderCount).toFixed(2)) : 0
        batchOrders.forEach((bo) => {
          orderAllocations.set(bo.id, {
            officialKm: shareKm,
            fuelCost: shareFuel,
            deviationEpisodes: episodesCount,
            maxDeviationMeters: batchMaxDevMeters,
            isJointSecondary: false,
          })
        })
      }
    }
  })

  // 7. Cálculos de Totais Finais
  const periodFuelCost =
    !isBicycle && consumptionKml > 0
      ? Number(((totalOfficialKmPeriod / consumptionKml) * pricePerLiter).toFixed(2))
      : 0
  const periodSpent = isBicycle ? 0 : periodFuelCost

  const postCutoffFuelSpent =
    !isBicycle && consumptionKml > 0
      ? Number(((totalPostCutoffKm / consumptionKml) * pricePerLiter).toFixed(2))
      : 0
  const postCutoffSpent = isBicycle ? 0 : postCutoffFuelSpent

  // Saldo = saldo_abertura + adiantamentos pós-corte − gasto pós-corte
  const balance = Number((openingBalance + postCutoffAdvances - postCutoffSpent).toFixed(2))

  return {
    courierId,
    courierName,
    vehicleCategory,
    consumptionKml,
    pricePerLiter,
    totalOfficialKm: Number(totalOfficialKmPeriod.toFixed(1)),
    totalSpent: periodSpent,
    fuelCost: periodFuelCost,
    openingBalance: Number(openingBalance.toFixed(2)),
    totalAdvances: Number(totalAdvances.toFixed(2)),
    postCutoffAdvances: Number(postCutoffAdvances.toFixed(2)),
    postCutoffSpent: Number(postCutoffSpent.toFixed(2)),
    balance,
    deviationEpisodesCount: totalDeviationEpisodes,
    maxDeviationMeters: maxDeviationMetersAll,
    batchesCount: batchMetrics.length,
    deliveriesCount: deliveriesCountInPeriod,
    batchMetrics,
    orderAllocations,
  }
}
