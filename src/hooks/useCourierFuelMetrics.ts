import { useMemo } from 'react'
import type {
  UserRecord,
  OrderRecord,
  FuelAdvanceRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
  CourierFuelAccount,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
// Telemetry engine and delivery service for courier fuel calculation
import { deliveryService } from '@/services/deliveryService'
import {
  calculateRealKmForOrder,
  DEVIATION_THRESHOLD_METERS,
  haversineDistanceMeters,
} from '@/lib/telemetryKmEngine'
import { isSuspectPin } from '@/lib/geo'
import { MapDataService } from '@/lib/mapDataService'
import { buildJointDeliveryMetaMap } from '@/lib/multiDeliveryDetector'
import { deriveRouteBatchKey, groupOrdersByRouteBatch } from '@/lib/routeBatchHelper'
import {
  getOperationalWindow,
  isAdvancePostCutoff,
  isCurrentMonthInTz,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import {
  getCanonicalCourierTotals,
  getCanonicalCourierBalance,
} from '@/services/canonicalCourierTotalsService'

export interface CourierOrderTelemetryCalculation {
  order: OrderRecord
  officialKm: number
  deviationKm: number
  totalGpsKm: number
  km_real_perna?: number
  discardedNoiseKm: number
  isRealTelemetry: boolean
  hasReturnKm: boolean
  fuelCost: number
  litersSpent: number
  offRouteCount: number
  unexpectedStopsCount: number
  calculationSource?: 'odometro' | 'historico_viario' | 'gps'
  telemetryStatus?: 'suficiente' | 'insuficiente'
  telemetryPingsCount?: number
  odometerKm?: number
  // Metadados de entrega conjunta / múltipla no mesmo ponto
  isJointDelivery?: boolean
  isJointPrimary?: boolean
  isJointSecondary?: boolean
  jointGroupSize?: number
  jointPrimaryTrackingCode?: string
  jointPartnerTrackingCodes?: string[]
  isApprovedKm?: boolean
  approvedKm?: number
  approvalJustification?: string
  isSuspectPin?: boolean
  suspectPinReason?: string
}

export interface CourierRouteAuditSummary {
  routeKey: string
  dateStr: string
  dateObj: Date
  routeStartedAt?: string
  routeFinishedAt?: string
  deliveriesCount: number
  orders: OrderRecord[]
  orderCalculations: CourierOrderTelemetryCalculation[]
  routeKm: number
  fuelCost: number
  litersSpent: number
  deviationKm: number
  totalGpsKm: number
  offRouteCount: number
  unexpectedStopsCount: number
  isRealTelemetry: boolean
  hasReturnKm: boolean
  startBaseAddress?: string
  trackingCodes: string[]
}

export interface CourierFuelCalculationResult {
  courier: UserRecord | null
  // Resumo de Conta Corrente e Combustível (Exatamente idêntico ao Admin)
  balance: number
  totalAdvances: number
  totalSpent: number
  totalOfficialKm: number
  totalDeviationKm: number
  totalOdometerKm: number
  totalLiters: number
  advanceCount: number
  deliveriesCount: number
  // Regras de consumo vigentes
  pricePerLiter: number
  consumptionKml: number
  vehicleCategory: 'moto' | 'carro' | 'caminhao' | 'bicicleta'
  // Detalhamento por entrega elegível
  orderCalculations: CourierOrderTelemetryCalculation[]
  // Detalhamento consolidado por rotas únicas deduplicadas
  routesSummary?: CourierRouteAuditSummary[]
  // Objeto compatível com CourierFuelAccount
  fuelAccount: CourierFuelAccount | null
  // Fonte oficial do cálculo
  calculationSource: 'odometro' | 'historico_viario' | 'gps'
  calculationSourceLabel: string
  // Métricas de consolidação de entrega conjunta
  jointDeliveriesConsolidatedCount: number
  jointDeliveriesOrdersCount: number
  jointSavedKm: number
  jointSavedFuelCost: number
  hasManualAdjustment?: boolean
  manualAdjustmentKm?: number
  manualAdjustmentFuelCost?: number
  manualAdjustmentDeltaKm?: number
  manualAdjustmentPeriodLabel?: string
  rawOfficialKmBeforeAdjustment?: number
  openingBalance?: number
  cutoffDate?: string
  periodAdvances?: number
  periodAdjustments?: number
  carryOverBalance?: number
  // Derivados para pagamento de combustível (10% desconto a partir de 26/10)
  km_pagamento?: number
  combustivel_pagamento?: number
  desconto_km?: number
  desconto_combustivel?: number
}

export interface UseCourierFuelOptions {
  periodFilter?: 'all' | 'month' | 'week' | 'today'
  carryOverBalance?: number
}

/**
 * Função utilitária pura que calcula a conta corrente, KM e combustível de um entregador.
 * Utilizada por AdminDashboard, CourierFuelPage, CourierApp e ReportsSection
 * para garantir 100% de consistência entre o app do entregador e a visão do administrador.
 */
export function calculateCourierFuelMetrics(params: {
  courier: UserRecord | null
  advances: FuelAdvanceRecord[]
  orders: OrderRecord[]
  locations: LocationRecord[]
  offRouteEvents: OffRouteEventRecord[]
  settings: Partial<AppSettingsRecord> | null
  periodFilter?: 'all' | 'month' | 'week' | 'today'
  carryOverBalance?: number
  approvalsMap?: Map<
    string,
    { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
  >
  activeBaseCoords?: { lat: number; lng: number } | null
  isPostCutoffComputation?: boolean
  telemetryBatches?: RouteBatchTelemetryRecord[]
}): CourierFuelCalculationResult {
  const {
    courier,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter = 'all',
    carryOverBalance = 0,
    approvalsMap,
    activeBaseCoords,
    isPostCutoffComputation = false,
    telemetryBatches = [],
  } = params

  if (!courier || !courier.id) {
    // GUARDA DE ENTRADA (REGRA DE OURO, v0.0.464): entregador nulo/sem id nunca derruba a tela.
    // Métricas zeradas seguras (km 0, gasto 0, saldo = carry-over informado), sem lançar exceção.
    const fuelParams = deliveryService.getVehicleFuelParams(settings, 'moto')
    return {
      courier: null,
      balance: carryOverBalance ?? 0,
      totalAdvances: 0,
      totalSpent: 0,
      totalOfficialKm: 0,
      totalDeviationKm: 0,
      totalOdometerKm: 0,
      totalLiters: 0,
      advanceCount: 0,
      deliveriesCount: 0,
      pricePerLiter: fuelParams.pricePerLiter,
      consumptionKml: fuelParams.consumptionKml,
      vehicleCategory: fuelParams.category,
      orderCalculations: [],
      fuelAccount: null,
      calculationSource: 'historico_viario',
      calculationSourceLabel: 'Histórico Viário de Rotas',
      jointDeliveriesConsolidatedCount: 0,
      jointDeliveriesOrdersCount: 0,
      jointSavedKm: 0,
      jointSavedFuelCost: 0,
      carryOverBalance: 0,
    }
  }

  if (!courier.vehicle_type) {
    console.warn(
      '[useCourierFuelMetrics] courier sem vehicle_type; aplicando padrão seguro "moto".',
    )
  }
  const courierVehicleTypeSafe = courier.vehicle_type || 'moto'

  const defaultFuelParams = deliveryService.getVehicleFuelParams(settings, courierVehicleTypeSafe)
  // Combustível por escopo 100% app_settings: moto 30 km/L e R$ 6,49 (taxa do app_settings), bicicleta R$ 0
  const isBicycleCourier = defaultFuelParams.category === 'bicicleta'
  const appSettingsMotoConsumption =
    typeof settings?.moto_consumption_kml === 'number' && settings.moto_consumption_kml > 0
      ? settings.moto_consumption_kml
      : typeof settings?.fuel_consumption_kml === 'number' && settings.fuel_consumption_kml > 0
        ? settings.fuel_consumption_kml
        : 30.0
  const appSettingsMotoPrice =
    typeof settings?.moto_fuel_price === 'number' && settings.moto_fuel_price > 0
      ? settings.moto_fuel_price
      : typeof settings?.fuel_price_per_liter === 'number' && settings.fuel_price_per_liter > 0
        ? settings.fuel_price_per_liter
        : 6.49

  const courierConsumption = isBicycleCourier
    ? 0
    : typeof courier.consumption_kml === 'number' && courier.consumption_kml > 0
      ? courier.consumption_kml
      : appSettingsMotoConsumption

  const pricePerLiter = isBicycleCourier
    ? 0
    : typeof courier.fuel_price === 'number' && courier.fuel_price > 0
      ? courier.fuel_price
      : appSettingsMotoPrice

  const consumptionKml = courierConsumption
  const category = defaultFuelParams.category

  const now = new Date()

  // CONTA CORRENTE COM SALDO CONGELADO E DATA DE CORTE:
  // Se não houver cutoff_date gravado, não aplicar corte nenhum (saldo = abertura + todo movimento)
  const cutoffDateStr = courier.cutoff_date || undefined
  const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
  const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)
  const openingBalance =
    typeof courier.opening_balance === 'number' ? courier.opening_balance : (carryOverBalance ?? 0)

  // 1. Adiantamentos e Ajustes pós-corte ESTRITOS (com data civil no fuso America/Sao_Paulo via isAdvancePostCutoff):
  // Itens pré-corte (data civil < cutoffDate) NUNCA entram na lista pós-corte nem no saldo, pois já estão
  // estritamente embutidos no opening_balance.
  const allPostCutoffAdvances = advances.filter((a) => {
    if (a.courier_id !== courier.id) return false
    if (a.status === 'cancelled') return false
    if (hasCutoff && !isAdvancePostCutoff(a.date || a.created, cutoffDateStr)) return false
    return true
  })

  // Totais pós-corte consolidados (período-independentes, para apurar o Saldo canônico):
  // Regra 1a/3: totalAdvances deve somar SOMENTE registros com entry_type === 'advance'
  // (ou entry_type vazio/ausente por retrocompatibilidade) E status !== 'cancelled'.
  // Excluir toda entrada entry_type === 'balance_adjustment'.
  let totalPostCutoffAdvances = 0
  let totalPostCutoffAdjustments = 0
  allPostCutoffAdvances.forEach((a) => {
    const val = Number(a.amount) || 0
    if (a.entry_type === 'balance_adjustment') {
      totalPostCutoffAdjustments += val
    } else if (!a.entry_type || a.entry_type === 'advance') {
      totalPostCutoffAdvances += val
    }
  })

  // Parcelas do período selecionado (meramente informativas, para exibir adiantamentos do período):
  const periodFilteredAdvances = allPostCutoffAdvances.filter((a) => {
    if (periodFilter === 'all') return true

    const advRaw = a.date || a.created
    const opWindow = getOperationalWindow(now)
    if (periodFilter === 'today') {
      const ts = parseSafeTimestamp(advRaw) || Date.now()
      return ts >= opWindow.start && ts <= opWindow.end
    }
    if (periodFilter === 'week') {
      const ts = parseSafeTimestamp(advRaw) || 0
      const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
      return ts >= sevenDaysAgoStart
    }
    if (periodFilter === 'month') {
      return isCurrentMonthInTz(advRaw, now)
    }
    return true
  })

  let periodAdvances = 0
  let periodAdjustments = 0
  periodFilteredAdvances.forEach((a) => {
    const val = Number(a.amount) || 0
    if (a.entry_type === 'balance_adjustment') {
      periodAdjustments += val
    } else if (!a.entry_type || a.entry_type === 'advance') {
      periodAdvances += val
    }
  })

  // totalAdvances do objeto reflete os adiantamentos reais (regra 1a)
  const totalAdvances = totalPostCutoffAdvances

  // 2. Filtrar telemetria e ocorrências do entregador
  const baseLatFallback = activeBaseCoords?.lat ?? -22.6977499
  const baseLngFallback = activeBaseCoords?.lng ?? -43.2936013

  const courierLocations = locations.filter((l) => l.user_id === courier.id)
  const courierEvents = offRouteEvents.filter((ev) => {
    if (ev.courier_id !== courier.id) return false
    // Filtro anti-outlier de desvios (< 600m) e paradas espúrias na base
    if (ev.event_type === 'route_deviation') {
      const devDist = ev.distance_deviation_meters || 0
      if (devDist > 0 && devDist < DEVIATION_THRESHOLD_METERS) return false
    }
    if (ev.event_type === 'unexpected_stop') {
      const stopSec = ev.stop_duration_seconds || 0
      // Parada só é válida se durar ao menos 180s (3 min) e estiver fora da rota
      if (stopSec < 180) return false
      const distToBase = haversineDistanceMeters(ev.lat, ev.lng, baseLatFallback, baseLngFallback)
      if (distToBase < DEVIATION_THRESHOLD_METERS) return false
    }
    return true
  })

  // 3. Filtrar ordens atribuídas ao entregador elegíveis para km e combustível.
  // REGRA 1 & 2 DO USUÁRIO:
  // - Cancelamento pelo VENDEDOR (completion_reason 'cancelado_vendedor' ou cancelled na base sem deslocamento):
  //   NÃO conta para o entregador (km=0, combustível=0) e estorna do vendedor.
  // - Tentativa local onde o entregador foi até o cliente e falhou:
  //   (status 'client_absent', 'address_error', ou 'cancelled' com desistência do cliente no local):
  //   KM e COMBUSTÍVEL CONTAM para o entregador.
  // - Erros de sistema continuam neutralizados.
  const isCourierEligibleOrder = (o: OrderRecord): boolean => {
    if (o.courier_id !== courier.id) return false
    const notesLower = o.notes ? o.notes.toLowerCase() : ''
    if (notesLower.includes('erro de sistema')) return false

    // Descartar pedidos com base 0,0 que não foram saneados
    const baseLat = Number(o.start_base_lat) || 0
    const baseLng = Number(o.start_base_lng) || 0
    if (baseLat === 0 && baseLng === 0 && !o.start_base_name && !o.start_base_address) {
      return false
    }

    // Regra 1: Cancelamento explícito da loja/vendedor -> NÃO conta para entregador
    if (o.completion_reason === 'cancelado_vendedor') {
      return false
    }

    // Pedido entregue com sucesso
    if (o.status === 'delivered') return true

    // Regra 2: Entregador foi até o cliente e a entrega falhou
    // - Erro de endereço / Rota errada no local
    // - Cliente ausente no local
    if (o.status === 'address_error' || o.status === 'client_absent') {
      return true
    }

    // Regra oficial alinhada pelo usuário: "não foi ao local = não conta"
    // Pedidos cancelados (incluindo desistência do cliente) NÃO entram no km apurado nem no combustível
    if (o.status === 'cancelled') {
      return false
    }

    return false
  }

  const allCourierOrders = orders.filter(isCourierEligibleOrder)

  const eligibleOrders = allCourierOrders.filter((o) => {
    if (periodFilter === 'all') return true

    const oDateVal = o.route_finished_at || o.actual_arrival || o.created
    const opWindow = getOperationalWindow(now)
    if (periodFilter === 'today') {
      const ts = parseSafeTimestamp(oDateVal) || Date.now()
      return ts >= opWindow.start && ts <= opWindow.end
    }
    if (periodFilter === 'week') {
      const oTs = parseSafeTimestamp(oDateVal) || 0
      const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
      return oTs >= sevenDaysAgoStart
    }
    if (periodFilter === 'month') {
      return isCurrentMonthInTz(oDateVal, now)
    }
    return true
  })

  // 4. Agrupar pedidos por rota/ciclo de saída da base
  // Regra do Usuário: "O KM RODADO INICIA NA SAIDA DA BASE, CONTINUA CONTANDO EM TODAS ENTREGAS E FINALIZA NA BASE DE VOLTA"
  // Quando uma rota contém múltiplos pedidos despachados juntos (mesmo lote / route_started_at aproximado),
  // a telemetria GPS mede a rota completa do entregador (Base -> Entregas -> Retorno à Base).
  // O KM de combustível da rota é o percurso real completo, e para cada entrega exibimos a sua cota ou valor correspondente.

  // Agrupamento por lote de rota compartilhado com 2 minutos de tolerância temporal
  const routeBatches = groupOrdersByRouteBatch(eligibleOrders, courier.id)
  // Mapa reverso para mapear cada pedido ao seu lote exato atribuído
  const orderBatchKeyMap = new Map<string, string>()
  routeBatches.forEach((bOrders, bKey) => {
    bOrders.forEach((o) => {
      orderBatchKeyMap.set(o.id, bKey)
    })
  })

  // Pré-calcular métricas de telemetria e verificar a presença de Odômetro Físico ou Histórico Viário
  let hasAnyOdometer = false
  let totalBatchOdometer = 0

  eligibleOrders.forEach((o) => {
    if (typeof o.km_odometro === 'number' && o.km_odometro > 0) {
      hasAnyOdometer = true
      totalBatchOdometer += o.km_odometro
    } else if (
      typeof o.odometro_final === 'number' &&
      typeof o.odometro_inicial === 'number' &&
      o.odometro_final > o.odometro_inicial
    ) {
      hasAnyOdometer = true
      totalBatchOdometer += o.odometro_final - o.odometro_inicial
    }
  })

  // Mapa de lotes canônicos passados via telemetryBatches
  const canonicalBatchesMap = new Map<string, RouteBatchTelemetryRecord>()
  if (telemetryBatches && telemetryBatches.length > 0) {
    telemetryBatches.forEach((b) => {
      if (b && b.route_batch_key) {
        canonicalBatchesMap.set(b.route_batch_key, b)
      }
    })
  }

  // REGRA DO USUÁRIO (20/10): Base -> Paradas -> Volta à base 1x por lote, cada perna 1x.
  // REMOVIDO: Corte de volta à base por lotes encadeados (não corta mais a volta à base).
  // REMOVIDO: Teto de desvios arbitrário sobre pernas. A fonte canônica é km_viario_total dos lotes.

  // Pré-calcular métricas de telemetria por lote de rota completa
  const batchTelemetryMap = new Map<string, ReturnType<typeof calculateRealKmForOrder>>()
  routeBatches.forEach((batchOrders, key) => {
    // Escolhe o pedido âncora do lote para apurar a rota inteira
    const anchorOrder = batchOrders[0]
    const batchTelemetry = calculateRealKmForOrder({
      order: anchorOrder,
      allCourierOrders: batchOrders,
      allCourierLocations: courierLocations,
      courierEvents,
    })

    // Se houver registro oficial de telemetria no banco para este lote, priorizar km_viario_total
    const recordedBatch = canonicalBatchesMap.get(key)
    const recordedViarioKm = recordedBatch ? Number(recordedBatch.km_viario_total) || 0 : 0
    const recordedOficialKm = recordedBatch ? Number(recordedBatch.km_oficial) || 0 : 0

    // Se no lote algum pedido tiver total_route_with_return_km registrado pelo otimizador de rotas
    // (Histórico viário oficial da rota: Base -> Paradas -> Retorno)
    const maxRoadKmInBatch = batchOrders.reduce((max, ord) => {
      const roadKm =
        typeof ord.total_route_with_return_km === 'number' ? ord.total_route_with_return_km : 0
      return Math.max(max, roadKm)
    }, 0)

    // Verificar se há odômetro no lote
    const batchOdometerKm = batchOrders.reduce((acc, ord) => {
      if (typeof ord.km_odometro === 'number' && ord.km_odometro > 0) return acc + ord.km_odometro
      if (
        typeof ord.odometro_final === 'number' &&
        typeof ord.odometro_inicial === 'number' &&
        ord.odometro_final > ord.odometro_inicial
      ) {
        return acc + (ord.odometro_final - ord.odometro_inicial)
      }
      return acc
    }, 0)

    // KM OFICIAL (DECISÃO FECHADA DO PRODUTO):
    // 1. Se existe km_viario_total no route_batch_telemetry gravado, este é a fonte canônica com volta inclusa.
    // 2. Senão, usa total_route_with_return_km do lote (rota com retorno).
    // 3. Fallback: officialRealKm computado.
    if (recordedViarioKm > 0) {
      batchTelemetry.officialRealKm = Number(recordedViarioKm.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
      batchTelemetry.hasReturnKm = true
    } else if (recordedOficialKm > 0) {
      batchTelemetry.officialRealKm = Number(recordedOficialKm.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
      batchTelemetry.hasReturnKm = true
    } else if (maxRoadKmInBatch > 0) {
      batchTelemetry.officialRealKm = Number(maxRoadKmInBatch.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
      batchTelemetry.hasReturnKm = true
    } else if (batchTelemetry.officialRealKm > 0) {
      batchTelemetry.officialRealKm = Number(batchTelemetry.officialRealKm.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
    } else {
      batchTelemetry.calculationSource = 'historico_viario'
    }

    if (batchOdometerKm > 0) {
      batchTelemetry.odometerKm = batchOdometerKm
    }

    batchTelemetryMap.set(key, batchTelemetry)
  })

  const isBicycle = category === 'bicicleta'

  // FONTE ÚNICA CANÔNICA:
  // Chama getCanonicalCourierTotals e getCanonicalCourierBalance de canonicalCourierTotalsService.
  // Nenhum cálculo local alternativo de km / gasto / saldo nasce aqui.
  const canonicalTotals = getCanonicalCourierTotals({
    courier,
    periodFilter,
    telemetryBatches,
    orders: allCourierOrders,
    advances,
    settings,
    approvalsMap: approvalsMap as Map<
      string,
      { approvedKm: number; status: 'approved' | 'rejected' | 'pending' }
    >,
  })

  const canonicalBalance = getCanonicalCourierBalance({
    courier,
    periodFilter,
    telemetryBatches,
    orders: allCourierOrders,
    advances,
    settings,
    approvalsMap: approvalsMap as Map<
      string,
      { approvedKm: number; status: 'approved' | 'rejected' | 'pending' }
    >,
  })

  // 4.1 Detectar entregas múltiplas/conjuntas no mesmo ponto (< 45 minutos no mesmo cliente)
  const jointMetaMap = buildJointDeliveryMetaMap(eligibleOrders)
  let jointDeliveriesConsolidatedCount = 0
  let jointDeliveriesOrdersCount = 0
  let jointSavedKm = 0
  let jointSavedFuelCost = 0

  const orderCalculations: CourierOrderTelemetryCalculation[] = eligibleOrders.map((order) => {
    const key =
      orderBatchKeyMap.get(order.id) || deriveRouteBatchKey(order, routeBatches.keys(), courier.id)

    const batchTelemetry =
      batchTelemetryMap.get(key) ||
      calculateRealKmForOrder({
        order,
        allCourierOrders: [order],
        allCourierLocations: courierLocations,
        courierEvents,
      })
    const batchOrders = routeBatches.get(key) || [order]
    const batchCount = batchOrders.length

    // Alocação vinda da fonte canônica ou rateio simples
    const canonicalAlloc = canonicalTotals.orderAllocations.get(order.id)
    let officialKm = canonicalAlloc
      ? canonicalAlloc.officialKm
      : Number((batchTelemetry.officialRealKm / Math.max(batchCount, 1)).toFixed(1))
    let fuelCost = canonicalAlloc
      ? canonicalAlloc.fuelCost
      : isBicycle
        ? 0
        : Number(((officialKm / Math.max(consumptionKml, 1)) * pricePerLiter).toFixed(2))
    let litersSpent =
      !isBicycle && consumptionKml > 0 ? Number((officialKm / consumptionKml).toFixed(2)) : 0
    let deviationKm = 0
    let totalGpsKm = Number((batchTelemetry.totalGpsKm / Math.max(batchCount, 1)).toFixed(1))

    // Presença de telemetria GPS real no lote
    const recordedBatch = canonicalBatchesMap.get(key)
    const hasBatchRealTelemetry = Boolean(
      batchTelemetry.isRealTelemetry ||
      (recordedBatch &&
        (recordedBatch.status === 'processed' ||
          recordedBatch.status === 'yellow_flag' ||
          (typeof recordedBatch.pings_count === 'number' && recordedBatch.pings_count > 1) ||
          (typeof recordedBatch.km_gps_total === 'number' && recordedBatch.km_gps_total > 0))),
    )

    // APLICAR REGRA DE ENTREGA CONJUNTA NO MESMO PONTO
    const jointMeta = jointMetaMap.get(order.id)
    let isJointDelivery = false
    let isJointPrimary = false
    let isJointSecondary = false
    let jointGroupSize: number | undefined
    let jointPrimaryTrackingCode: string | undefined
    let jointPartnerTrackingCodes: string[] | undefined

    if (jointMeta?.isJointDelivery) {
      isJointDelivery = true
      isJointPrimary = jointMeta.isJointPrimary
      isJointSecondary = jointMeta.isJointSecondary
      jointGroupSize = jointMeta.groupSize
      jointPrimaryTrackingCode = jointMeta.primaryTrackingCode
      jointPartnerTrackingCodes = jointMeta.partnerTrackingCodes
      jointDeliveriesOrdersCount++

      if (jointMeta.isJointSecondary) {
        jointDeliveriesConsolidatedCount++
        jointSavedKm += officialKm
        jointSavedFuelCost += fuelCost
        officialKm = 0
        fuelCost = 0
        litersSpent = 0
      }
    }

    const cleanDestToCheck = MapDataService.getOrderDestination(order)
    const custLatToCheck = cleanDestToCheck?.lat ?? null
    const custLngToCheck = cleanDestToCheck?.lng ?? null
    const custNotesToCheck = order.notes || order.expand?.customer_id?.notes || ''
    const isSuspect = isSuspectPin(custLatToCheck, custLngToCheck, custNotesToCheck)

    if (isSuspect) {
      officialKm = 0
      fuelCost = 0
      litersSpent = 0
    }

    let isApprovedKm = false
    let approvedKmVal: number | undefined
    let approvalJustification: string | undefined

    const approval = approvalsMap?.get(order.id)
    if (approval && approval.status === 'approved') {
      isApprovedKm = true
      approvedKmVal = approval.approvedKm
      approvalJustification = approval.justification

      if (!isJointSecondary) {
        officialKm = Number(approvedKmVal.toFixed(1))
        litersSpent =
          !isBicycle && consumptionKml > 0 ? Number((officialKm / consumptionKml).toFixed(2)) : 0
        fuelCost = !isBicycle ? Number((litersSpent * pricePerLiter).toFixed(2)) : 0
      }
    }

    const kmRealPernaVal =
      typeof order.km_real_perna === 'number' &&
      Number.isFinite(order.km_real_perna) &&
      order.km_real_perna > 0
        ? Number(order.km_real_perna.toFixed(1))
        : undefined

    return {
      order,
      officialKm,
      deviationKm: Number(deviationKm.toFixed(1)),
      totalGpsKm: Number(totalGpsKm.toFixed(1)),
      km_real_perna: kmRealPernaVal,
      discardedNoiseKm: batchTelemetry.discardedNoiseKm,
      isRealTelemetry: hasBatchRealTelemetry,
      telemetryStatus: hasBatchRealTelemetry ? 'suficiente' : batchTelemetry.telemetryStatus,
      telemetryPingsCount: batchTelemetry.telemetryPingsCount,
      hasReturnKm: batchTelemetry.hasReturnKm,
      fuelCost: Number(fuelCost.toFixed(2)),
      litersSpent: Number(litersSpent.toFixed(2)),
      offRouteCount: batchTelemetry.offRouteCount,
      unexpectedStopsCount: batchTelemetry.unexpectedStopsCount,
      calculationSource: batchTelemetry.calculationSource,
      odometerKm: batchTelemetry.odometerKm,
      isJointDelivery,
      isJointPrimary,
      isJointSecondary,
      jointGroupSize,
      jointPrimaryTrackingCode,
      jointPartnerTrackingCodes,
      isApprovedKm,
      approvedKm: approvedKmVal,
      approvalJustification,
      isSuspectPin: isSuspect,
      suspectPinReason: isSuspect ? 'Parada com Pin Suspeito' : undefined,
    }
  })

  // TOTAIS VINDOS EXCLUSIVAMENTE DO SERVIÇO CANÔNICO:
  const totalOfficialKm = canonicalTotals.totalOfficialKm
  const totalSpent = canonicalTotals.totalSpent
  const totalLiters =
    !isBicycle && consumptionKml > 0 ? Number((totalOfficialKm / consumptionKml).toFixed(2)) : 0
  const totalDeviationKm = 0
  const totalOdometerKm = 0
  const balance = canonicalBalance.saldo
  const calculationSource: 'odometro' | 'historico_viario' | 'gps' = 'historico_viario'
  const calculationSourceLabel = 'Trajeto Viário Oficial'

  const fuelAccount: CourierFuelAccount = {
    courier,
    totalAdvances: Number(totalAdvances.toFixed(2)),
    totalRouteKm: Number(totalOfficialKm.toFixed(1)),
    totalSpent: Number(totalSpent.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    advanceCount: allPostCutoffAdvances.length,
    deliveriesCount: eligibleOrders.length,
    advances: allPostCutoffAdvances,
    openingBalance: Number(openingBalance.toFixed(2)),
    cutoffDate: cutoffDateStr,
    periodAdvances: Number(periodAdvances.toFixed(2)),
    periodAdjustments: Number(periodAdjustments.toFixed(2)),
    carryOverBalance: Number(openingBalance.toFixed(2)),
  }

  return {
    courier,
    balance: Number(balance.toFixed(2)),
    totalAdvances: Number(totalAdvances.toFixed(2)),
    totalSpent: Number(totalSpent.toFixed(2)),
    totalOfficialKm: Number(totalOfficialKm.toFixed(1)),
    totalDeviationKm: Number(totalDeviationKm.toFixed(1)),
    totalOdometerKm: Number(totalOdometerKm.toFixed(1)),
    totalLiters: Number(totalLiters.toFixed(2)),
    advanceCount: allPostCutoffAdvances.length,
    deliveriesCount: eligibleOrders.length,
    pricePerLiter,
    consumptionKml,
    vehicleCategory: category,
    orderCalculations,
    fuelAccount,
    calculationSource,
    calculationSourceLabel,
    jointDeliveriesConsolidatedCount,
    jointDeliveriesOrdersCount,
    jointSavedKm: Number(jointSavedKm.toFixed(1)),
    jointSavedFuelCost: Number(jointSavedFuelCost.toFixed(2)),
    openingBalance: Number(openingBalance.toFixed(2)),
    cutoffDate: cutoffDateStr,
    periodAdvances: Number(periodAdvances.toFixed(2)),
    periodAdjustments: Number(periodAdjustments.toFixed(2)),
    carryOverBalance: Number(openingBalance.toFixed(2)),
    hasManualAdjustment: canonicalTotals.hasManualAdjustment,
    manualAdjustmentKm: canonicalTotals.manualAdjustmentKm,
    manualAdjustmentFuelCost: canonicalTotals.manualAdjustmentFuelCost,
    manualAdjustmentDeltaKm: canonicalTotals.manualAdjustmentDeltaKm,
    manualAdjustmentPeriodLabel: canonicalTotals.manualAdjustmentPeriodLabel,
    rawOfficialKmBeforeAdjustment: canonicalTotals.rawOfficialKmBeforeAdjustment,
    km_pagamento: canonicalTotals.km_pagamento,
    combustivel_pagamento: canonicalTotals.combustivel_pagamento,
    desconto_km: canonicalTotals.desconto_km,
    desconto_combustivel: canonicalTotals.desconto_combustivel,
  }
}

/**
 * Hook React para cálculo reativo de telemetria, combustível e conta corrente de um entregador.
 */
export function useCourierFuelMetrics(params: {
  courier: UserRecord | null
  advances: FuelAdvanceRecord[]
  orders: OrderRecord[]
  locations: LocationRecord[]
  offRouteEvents: OffRouteEventRecord[]
  settings: Partial<AppSettingsRecord> | null
  periodFilter?: 'all' | 'month' | 'week' | 'today'
  carryOverBalance?: number
  approvalsMap?: Map<
    string,
    { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
  >
  activeBaseCoords?: { lat: number; lng: number } | null
  telemetryBatches?: RouteBatchTelemetryRecord[]
}): CourierFuelCalculationResult {
  const {
    courier,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter = 'all',
    carryOverBalance,
    approvalsMap,
    activeBaseCoords,
    telemetryBatches,
  } = params

  return useMemo(() => {
    return calculateCourierFuelMetrics({
      courier,
      advances,
      orders,
      locations,
      offRouteEvents,
      settings,
      periodFilter,
      carryOverBalance,
      approvalsMap,
      activeBaseCoords,
      telemetryBatches,
    })
  }, [
    courier,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter,
    carryOverBalance,
    approvalsMap,
    activeBaseCoords,
    telemetryBatches,
  ])
}
