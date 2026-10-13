import { useMemo } from 'react'
import type {
  UserRecord,
  OrderRecord,
  FuelAdvanceRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
  CourierFuelAccount,
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
import {
  deriveRouteBatchKey,
  getMergedRouteBatchKey,
  groupOrdersByRouteBatch,
} from '@/lib/routeBatchHelper'
import {
  getOperationalWindow,
  isAdvancePostCutoff,
  isCurrentMonthInTz,
  isOrderInPeriod,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'

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
  openingBalance?: number
  cutoffDate?: string
  periodAdvances?: number
  periodAdjustments?: number
  carryOverBalance?: number
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
  } = params

  if (!courier?.id) {
    const fuelParams = deliveryService.getVehicleFuelParams(settings, 'moto')
    return {
      courier: null,
      balance: 0,
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

  const defaultFuelParams = deliveryService.getVehicleFuelParams(settings, courier.vehicle_type)
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
  const baseLatFallback = activeBaseCoords?.lat ?? -22.7001402
  const baseLngFallback = activeBaseCoords?.lng ?? -43.2982834

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

  // COMANDO A1: Ordenar lotes finalizados cronologicamente para detecção de encadeamento
  // Ao ordenar lotes finalizados por route_started_at:
  // Se (route_started_at do lote seguinte − route_finished_at do anterior) < 10 min,
  // OU distância entre última parada do lote anterior e primeira parada do novo < 1 km sem ponto GPS na base,
  // o lote anterior NÃO cobra o retorno à base (só o viário até a última parada).
  // Rotas que terminam na base mantêm o retorno.

  type RouteBatchItem = {
    batchKey: string
    orders: OrderRecord[]
    firstOrder: OrderRecord
    lastOrder: OrderRecord
    startedAtMs: number
    finishedAtMs: number
  }

  const sortedBatchList: RouteBatchItem[] = Array.from(routeBatches.entries())
    .map(([bKey, bOrders]) => {
      const sortedBySeq = [...bOrders].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
      const firstO = sortedBySeq[0]
      const lastO = sortedBySeq[sortedBySeq.length - 1]
      const startedAt = firstO.route_started_at || firstO.created || ''
      const finishedAt = lastO.route_finished_at || lastO.actual_arrival || startedAt
      return {
        batchKey: bKey,
        orders: bOrders,
        firstOrder: firstO,
        lastOrder: lastO,
        startedAtMs: new Date(startedAt).getTime() || 0,
        finishedAtMs: new Date(finishedAt).getTime() || 0,
      }
    })
    .sort((a, b) => a.startedAtMs - b.startedAtMs)

  // Conjunto de lotes identificados como encadeados (lote anterior que não volta à base)
  const chainedPreviousBatches = new Set<string>()

  for (let bIdx = 0; bIdx < sortedBatchList.length - 1; bIdx++) {
    const currentBatch = sortedBatchList[bIdx]
    const nextBatch = sortedBatchList[bIdx + 1]

    if (currentBatch.finishedAtMs > 0 && nextBatch.startedAtMs > 0) {
      const diffMinutes = (nextBatch.startedAtMs - currentBatch.finishedAtMs) / (60 * 1000)

      // Distância entre última parada do lote anterior e primeira parada do novo
      const lastStopDest = MapDataService.getOrderDestination(currentBatch.lastOrder)
      const nextStartDest = MapDataService.getOrderDestination(nextBatch.firstOrder)

      let distBetweenStopsMeters = 999999
      if (lastStopDest && nextStartDest) {
        distBetweenStopsMeters = haversineDistanceMeters(
          lastStopDest.lat,
          lastStopDest.lng,
          nextStartDest.lat,
          nextStartDest.lng,
        )
      }

      // Checar se houve ponto GPS na base no intervalo entre lotes
      const hasGpsAtBaseBetweenBatches = courierLocations.some((loc) => {
        const locTs = new Date(loc.created).getTime()
        if (locTs >= currentBatch.finishedAtMs && locTs <= nextBatch.startedAtMs) {
          const dBase = haversineDistanceMeters(loc.lat, loc.lng, baseLatFallback, baseLngFallback)
          return dBase < 300 // dentro de 300m da base
        }
        return false
      })

      const isChainedTime = diffMinutes >= -5 && diffMinutes < 10
      const isChainedSpatial = distBetweenStopsMeters < 1000 && !hasGpsAtBaseBetweenBatches

      if (isChainedTime || isChainedSpatial) {
        chainedPreviousBatches.add(currentBatch.batchKey)
        console.log(
          `[useCourierFuelMetrics] [A1] Encadeamento detectado para lote ${currentBatch.batchKey}: diff=${diffMinutes.toFixed(1)}min, dist=${(distBetweenStopsMeters / 1000).toFixed(1)}km, gpsNaBase=${hasGpsAtBaseBetweenBatches}. Retorno à base descartado neste lote anterior.`,
        )
      }
    }
  }

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

    // Se no lote algum pedido tiver total_route_with_return_km registrado pelo otimizador de rotas
    // (Histórico viário oficial da rota: Base -> Paradas -> Retorno)
    const maxRoadKmInBatch = batchOrders.reduce((max, ord) => {
      const roadKm =
        typeof ord.total_route_with_return_km === 'number' ? ord.total_route_with_return_km : 0
      return Math.max(max, roadKm)
    }, 0)

    // Soma viária apenas das pernas de paradas (sem o retorno da última parada à base),
    // desconsiderando paradas com pin suspeito que foram excluídas do viário
    const sumOutboundLegsKm = batchOrders.reduce((sum, ord) => {
      const cleanDest = MapDataService.getOrderDestination(ord)
      const cNotes = ord.notes || ord.expand?.customer_id?.notes || ''
      if (isSuspectPin(cleanDest?.lat, cleanDest?.lng, cNotes)) {
        return sum
      }
      const dist = typeof ord.distance_km === 'number' ? ord.distance_km : 0
      return sum + dist
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

    // A1: Se o lote for encadeado com o seguinte, NÃO cobra o retorno à base!
    const isChainedBatch = chainedPreviousBatches.has(key)

    // KM OFICIAL (DECISÃO FECHADA DO PRODUTO):
    // KM oficial = Trajeto viário planejado pelo otimizador sobre paradas efetivamente visitadas.
    // Se o lote for encadeado, aplica apenas as pernas de paradas (sem retorno à base duplicado).
    if (isChainedBatch && sumOutboundLegsKm > 0) {
      batchTelemetry.officialRealKm = Number(sumOutboundLegsKm.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
      batchTelemetry.hasReturnKm = false
    } else if (maxRoadKmInBatch > 0) {
      batchTelemetry.officialRealKm = Number(maxRoadKmInBatch.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
    } else if (batchTelemetry.officialRealKm > 0) {
      batchTelemetry.officialRealKm = Number(batchTelemetry.officialRealKm.toFixed(1))
      batchTelemetry.calculationSource = 'historico_viario'
    } else {
      batchTelemetry.calculationSource = 'historico_viario'
    }

    // COMANDO B2: Trava de Sanidade no useCourierFuelMetrics
    // Se perna individual > 50 km OU km_total > 5x a soma direta viária das paradas:
    // Dispara alerta crítico e sanitiza
    const hasAbsurdLegInBatch = batchOrders.some((o) => (o.distance_km || 0) > 50)
    if (
      hasAbsurdLegInBatch ||
      batchTelemetry.officialRealKm > Math.max(30, sumOutboundLegsKm * 5)
    ) {
      console.warn(
        `[useCourierFuelMetrics] [B2] Trava de sanidade acionada para lote ${key}: km=${batchTelemetry.officialRealKm}, sumLegs=${sumOutboundLegsKm}, hasLeg>50=${hasAbsurdLegInBatch}. Limitando a valor coerente.`,
      )
      const sanitizedBatchKm = Number((Math.min(sumOutboundLegsKm, 25) + 4.5).toFixed(1))
      batchTelemetry.officialRealKm = sanitizedBatchKm
    }

    if (batchOdometerKm > 0) {
      batchTelemetry.odometerKm = batchOdometerKm
    }

    batchTelemetryMap.set(key, batchTelemetry)
  })

  let totalOfficialKm = 0
  let totalDeviationKm = 0
  let totalOdometerKm = 0
  let totalSpent = 0
  let totalLiters = 0

  // Se houver múltiplos pedidos na mesma rota, distribuímos proporcionalmente o KM da rota inteira
  // ou atribuímos a cada pedido de modo que a soma do lote corresponda exatamente ao KM real da rota inteira (Base -> Entregas -> Base).
  const isBicycle = category === 'bicicleta'

  // Helper para peso individual da entrega no rateio da rota:
  // Regra oficial: ida proporcional ao trecho (distance_km) + retorno rateado uma vez.
  // Paradas com pin suspeito recebem peso 0 para não absorverem quilometragem viária.
  const computeOrderWeight = (ord: OrderRecord): number => {
    const cleanDest = MapDataService.getOrderDestination(ord)
    const cNotes = ord.notes || ord.expand?.customer_id?.notes || ''
    if (isSuspectPin(cleanDest?.lat, cleanDest?.lng, cNotes)) {
      return 0
    }

    const baseLat = ord.start_base_lat || baseLatFallback
    const baseLng = ord.start_base_lng || baseLngFallback
    const hasCustomerCoords = Boolean(cleanDest)

    let roadDist = 0.8
    if (cleanDest) {
      const directMeters = haversineDistanceMeters(baseLat, baseLng, cleanDest.lat, cleanDest.lng)
      roadDist = Math.max(directMeters / 1000, 0.8)
    }

    // Se o cliente tem coordenadas vigentes, o viário calculado sobre o pin vigente tem soberania.
    // Math.max com ord.distance_km fica apenas como fallback quando não há coordenadas vigentes no cliente.
    if (!hasCustomerCoords && typeof ord.distance_km === 'number' && ord.distance_km > 0) {
      roadDist = Math.max(roadDist, ord.distance_km)
    }

    const returnKm =
      typeof ord.return_trip_km === 'number' && ord.return_trip_km > 0 ? ord.return_trip_km : 0

    return Math.max(roadDist + returnKm, 0.8)
  }

  // Mapa de controle para acumular os valores rateados por lote de rota
  // permitindo que o último pedido absorva o delta de arredondamento tanto para KM quanto para Combustível (R$)
  const batchAllocationAccumulators = new Map<
    string,
    {
      allocatedOfficialKm: number
      allocatedDeviationKm: number
      allocatedGpsKm: number
      allocatedFuelCost: number
      allocatedLiters: number
    }
  >()

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

    let acc = batchAllocationAccumulators.get(key)
    if (!acc) {
      acc = {
        allocatedOfficialKm: 0,
        allocatedDeviationKm: 0,
        allocatedGpsKm: 0,
        allocatedFuelCost: 0,
        allocatedLiters: 0,
      }
      batchAllocationAccumulators.set(key, acc)
    }

    // Totais calculados para este lote de rota completa
    const batchTotalOfficialKm = batchTelemetry.officialRealKm
    const batchTotalLiters =
      !isBicycle && consumptionKml > 0
        ? Number((batchTotalOfficialKm / consumptionKml).toFixed(2))
        : 0
    const batchTotalFuelCost = !isBicycle
      ? Number((batchTotalLiters * pricePerLiter).toFixed(2))
      : 0

    let officialKm = batchTelemetry.officialRealKm
    let deviationKm = batchTelemetry.deviationKm
    let totalGpsKm = batchTelemetry.totalGpsKm
    let fuelCost = batchTotalFuelCost
    let litersSpent = batchTotalLiters

    if (batchCount > 1) {
      // Rateio pro-rata: peso = max(roadDistFromBase(i), 0.8) + returnToBase(i)
      const totalBatchWeight = batchOrders.reduce((sum, b) => sum + computeOrderWeight(b), 0)
      const thisWeight = computeOrderWeight(order)
      const ratio = totalBatchWeight > 0 ? thisWeight / totalBatchWeight : 0

      const orderIndex = batchOrders.findIndex((b) => b.id === order.id)
      const isLastOrderInBatch = orderIndex === batchCount - 1

      if (thisWeight === 0) {
        // Parada com pin suspeito: 0 km viário e 0 combustível
        officialKm = 0
        fuelCost = 0
        litersSpent = 0
      } else if (isLastOrderInBatch) {
        // O último item do lote absorve exatamente o resíduo de arredondamento
        // garantindo que Σ km = total do lote e Σ fuel = total do lote
        officialKm = Number(
          Math.max(0, batchTelemetry.officialRealKm - acc.allocatedOfficialKm).toFixed(1),
        )
        deviationKm = Number(
          Math.max(0, batchTelemetry.deviationKm - acc.allocatedDeviationKm).toFixed(1),
        )
        totalGpsKm = Number(Math.max(0, batchTelemetry.totalGpsKm - acc.allocatedGpsKm).toFixed(1))

        fuelCost = Number(Math.max(0, batchTotalFuelCost - acc.allocatedFuelCost).toFixed(2))
        litersSpent = Number(Math.max(0, batchTotalLiters - acc.allocatedLiters).toFixed(2))
      } else {
        officialKm = Number((batchTelemetry.officialRealKm * ratio).toFixed(1))
        deviationKm = Number((batchTelemetry.deviationKm * ratio).toFixed(1))
        totalGpsKm = Number((batchTelemetry.totalGpsKm * ratio).toFixed(1))

        litersSpent =
          !isBicycle && consumptionKml > 0 ? Number((officialKm / consumptionKml).toFixed(2)) : 0
        fuelCost = !isBicycle ? Number((litersSpent * pricePerLiter).toFixed(2)) : 0

        acc.allocatedOfficialKm += officialKm
        acc.allocatedDeviationKm += deviationKm
        acc.allocatedGpsKm += totalGpsKm
        acc.allocatedFuelCost += fuelCost
        acc.allocatedLiters += litersSpent
      }
    }

    // APLICAR REGRA DE ENTREGA CONJUNTA NO MESMO PONTO:
    // Se o pedido fizer parte de um grupo de entrega múltipla no mesmo ponto:
    // O pedido primário (1º) mantém o KM/combustível da viagem.
    // Os pedidos secundários (2º em diante) entram com officialKm = 0 e fuelCost = 0 (viagem já paga).
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

        // Zera o KM oficial e combustível reembolsável
        officialKm = 0
        fuelCost = 0
        litersSpent = 0
      }
    }

    // REGRA DE PIN SUSPEITO:
    // Parada com isSuspectPin é excluída do viário e sinalizada 'Parada com Pin Suspeito'
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

    // REGRA DE APROVAÇÃO DE KM DO ADMINISTRADOR:
    // Quando o admin aprova um KM customizado para esta entrega (ex: erro de endereço, chuva, área de risco),
    // o valor aprovado SUBSTITUI o trecho no cálculo oficial de KM real e de consumo de combustível.
    // Para entregas secundárias consolidadas de entrega conjunta, o valor permanece zerado.
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
      isRealTelemetry: batchTelemetry.isRealTelemetry,
      telemetryStatus: batchTelemetry.telemetryStatus,
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

  // Regra de Agregação de Totais Únicos por Lote de Rota (Deduplicação de Lote):
  // Cada lote de rota (route_batch_key) é somado UMA ÚNICA VEZ nos totais agregados (dia, período, semana),
  // evitando que pedidos do mesmo lote dupliquem o KM da rota inteira uma vez por parada.
  // Linhas individuais (orderCalculations) exibem seu valor individual/rateado, mas o cabeçalho/total
  // agrega exatamente a soma dos lotes únicos (km viário oficial do lote com aprovações, GPS do lote 1x, etc).
  let aggregatedOfficialKm = 0
  let aggregatedDeviationKm = 0
  let aggregatedGpsKm = 0
  let aggregatedSpent = 0
  let aggregatedLiters = 0

  routeBatches.forEach((batchOrders, batchKey) => {
    // Buscar os cálculos das ordens deste lote
    const batchCalcs = orderCalculations.filter((c) =>
      batchOrders.some((bo) => bo.id === c.order.id),
    )
    if (batchCalcs.length === 0) return

    // Se houve aprovação manual em ordens do lote, a soma das ordens reflete os trechos aprovados
    const hasAnyApprovalInBatch = batchCalcs.some((c) => c.isApprovedKm)

    if (hasAnyApprovalInBatch) {
      // Quando há aprovação específica de trecho, soma os valores das paradas do lote
      const batchKm = batchCalcs.reduce((sum, c) => sum + c.officialKm, 0)
      const batchDev = batchCalcs.reduce((sum, c) => sum + c.deviationKm, 0)
      const batchGps = batchCalcs.reduce((sum, c) => sum + c.totalGpsKm, 0)
      const batchFuel = batchCalcs.reduce((sum, c) => sum + c.fuelCost, 0)
      const batchLit = batchCalcs.reduce((sum, c) => sum + c.litersSpent, 0)

      aggregatedOfficialKm += batchKm
      aggregatedDeviationKm += batchDev
      aggregatedGpsKm += batchGps
      aggregatedSpent += batchFuel
      aggregatedLiters += batchLit
    } else {
      // Sem aprovações manuais: pega o valor canônico oficial do lote UMA única vez.
      // Se algum pedido do lote tiver total_route_with_return_km > 0 registrado pelo otimizador de rota,
      // usa-o canonicamente 1x para o lote (desconsiderando soma linha a linha).
      // Caso contrário, usa batchTelemetry.officialRealKm.
      const batchTelem = batchTelemetryMap.get(batchKey)
      const maxRoadKmInBatch = batchOrders.reduce((max, ord) => {
        const roadKm =
          typeof ord.total_route_with_return_km === 'number' ? ord.total_route_with_return_km : 0
        return Math.max(max, roadKm)
      }, 0)

      const isChainedBatch = chainedPreviousBatches.has(batchKey)
      let canonicalBatchKm = 0
      if (isChainedBatch && batchTelem?.officialRealKm) {
        canonicalBatchKm = batchTelem.officialRealKm
      } else if (maxRoadKmInBatch > 0) {
        canonicalBatchKm = Number(maxRoadKmInBatch.toFixed(1))
      } else if (batchTelem?.officialRealKm) {
        canonicalBatchKm = Number(batchTelem.officialRealKm.toFixed(1))
      } else {
        canonicalBatchKm = Number(batchCalcs.reduce((sum, c) => sum + c.officialKm, 0).toFixed(1))
      }

      const batchDevKm = batchTelem ? batchTelem.deviationKm : 0
      const batchGpsKm = batchTelem ? batchTelem.totalGpsKm : 0

      const batchLit =
        !isBicycle && consumptionKml > 0
          ? Number((canonicalBatchKm / consumptionKml).toFixed(2))
          : 0
      const batchFuel = !isBicycle ? Number((batchLit * pricePerLiter).toFixed(2)) : 0

      aggregatedOfficialKm += canonicalBatchKm
      aggregatedDeviationKm += batchDevKm
      aggregatedGpsKm += batchGpsKm
      aggregatedSpent += batchFuel
      aggregatedLiters += batchLit
    }
  })

  totalOfficialKm = Number(aggregatedOfficialKm.toFixed(1))
  totalDeviationKm = Number(aggregatedDeviationKm.toFixed(1))
  totalOdometerKm = Number(aggregatedGpsKm.toFixed(1))
  totalLiters = Number(aggregatedLiters.toFixed(2))

  if (isBicycle) {
    totalSpent = 0
  } else {
    totalSpent = Number(aggregatedSpent.toFixed(2))
  }

  // GASTO PÓS-CORTE CANÔNICO PARA O SALDO:
  // O saldo é SEMPRE período-independente: opening_balance + totalPostCutoffAdvances − totalPostCutoffSpent.
  // Gasto pós-corte: pedidos elegíveis com timestamp >= cutoffTime calculados com periodFilter 'all'.
  // GUARDA ANTI-RECURSÃO INFINITA:
  // Se isPostCutoffComputation for true, pula este bloco (pois esta execução já é a computação do gasto pós-corte)
  // e utiliza diretamente o totalSpent já computado acima pelo motor oficial.
  let postCutoffSpent = 0
  if (!isBicycle) {
    if (isPostCutoffComputation) {
      postCutoffSpent = totalSpent
    } else if (!hasCutoff) {
      if (periodFilter === 'all') {
        postCutoffSpent = totalSpent
      } else {
        const allMetrics = calculateCourierFuelMetrics({
          courier,
          advances: allPostCutoffAdvances,
          orders: allCourierOrders,
          locations,
          offRouteEvents,
          settings,
          periodFilter: 'all',
          carryOverBalance: openingBalance,
          approvalsMap,
          activeBaseCoords,
          isPostCutoffComputation: true,
        })
        postCutoffSpent = allMetrics.totalSpent
      }
    } else {
      const postCutoffOrders = allCourierOrders.filter((o) => {
        const orderDateVal = o.route_finished_at || o.actual_arrival || o.created
        const orderTs = new Date(orderDateVal).getTime()
        return orderTs >= cutoffTime
      })

      if (postCutoffOrders.length > 0) {
        const postCutoffMetrics = calculateCourierFuelMetrics({
          courier,
          advances: allPostCutoffAdvances,
          orders: postCutoffOrders,
          locations,
          offRouteEvents,
          settings,
          periodFilter: 'all',
          carryOverBalance: openingBalance,
          approvalsMap,
          activeBaseCoords,
          isPostCutoffComputation: true,
        })
        postCutoffSpent = postCutoffMetrics.totalSpent
      }
    }
  }

  // FÓRMULA ÚNICA E INVARIANTE DO SALDO (Regra 1b):
  // Saldo = opening_balance (fixo) + adiantamentos reais pós-corte (regra 1a) − gasto pós-corte
  const balance = Number((openingBalance + totalPostCutoffAdvances - postCutoffSpent).toFixed(2))
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
  ])
}
