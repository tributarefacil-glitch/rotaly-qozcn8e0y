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
import { buildJointDeliveryMetaMap } from '@/lib/multiDeliveryDetector'

export interface CourierOrderTelemetryCalculation {
  order: OrderRecord
  officialKm: number
  deviationKm: number
  totalGpsKm: number
  discardedNoiseKm: number
  isRealTelemetry: boolean
  hasReturnKm: boolean
  fuelCost: number
  litersSpent: number
  offRouteCount: number
  unexpectedStopsCount: number
  calculationSource?: 'odometro' | 'historico_viario' | 'gps'
  odometerKm?: number
  // Metadados de entrega conjunta / múltipla no mesmo ponto
  isJointDelivery?: boolean
  isJointPrimary?: boolean
  isJointSecondary?: boolean
  jointGroupSize?: number
  jointPrimaryTrackingCode?: string
  jointPartnerTrackingCodes?: string[]
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

  const fuelParams = deliveryService.getVehicleFuelParams(settings, courier.vehicle_type)
  const { pricePerLiter, consumptionKml, category } = fuelParams

  const now = new Date()

  // 1. Filtrar adiantamentos do entregador (com filtro de período opcional)
  const courierAdvances = advances.filter((a) => {
    if (a.courier_id !== courier.id) return false
    if (periodFilter === 'all') return true

    const advDate = new Date(a.date || a.created || Date.now())
    if (periodFilter === 'today') {
      return (
        advDate.getDate() === now.getDate() &&
        advDate.getMonth() === now.getMonth() &&
        advDate.getFullYear() === now.getFullYear()
      )
    }
    if (periodFilter === 'week') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return advDate >= sevenDaysAgo
    }
    if (periodFilter === 'month') {
      return advDate.getMonth() === now.getMonth() && advDate.getFullYear() === now.getFullYear()
    }
    return true
  })

  const totalAdvances = courierAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

  // 2. Filtrar telemetria e ocorrências do entregador
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
      const distToBase = haversineDistanceMeters(ev.lat, ev.lng, -22.7001402, -43.2982834)
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

    // Cancelamento com tentativa local (ex.: desistência do cliente no local)
    // Identificado por notes começando por "Cancelamento: [Desistência do Cliente]"
    // ou tentativa de deslocamento registrada (route_started_at presente / actual_arrival preenchido)
    if (o.status === 'cancelled') {
      const isLocalDesistencia =
        notesLower.includes('cancelamento: [desistência do cliente]') ||
        notesLower.includes('desistência do cliente') ||
        notesLower.includes('desistencia do cliente')
      const hadAttempt = Boolean(o.route_started_at || o.actual_arrival)
      if (isLocalDesistencia && hadAttempt) {
        return true
      }
      return false
    }

    return false
  }

  const allCourierOrders = orders.filter(isCourierEligibleOrder)

  const eligibleOrders = allCourierOrders.filter((o) => {
    if (periodFilter === 'all') return true

    const oDate = new Date(o.created || Date.now())
    if (periodFilter === 'today') {
      return (
        oDate.getDate() === now.getDate() &&
        oDate.getMonth() === now.getMonth() &&
        oDate.getFullYear() === now.getFullYear()
      )
    }
    if (periodFilter === 'week') {
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      return oDate >= sevenDaysAgo
    }
    if (periodFilter === 'month') {
      return oDate.getMonth() === now.getMonth() && oDate.getFullYear() === now.getFullYear()
    }
    return true
  })

  // 4. Agrupar pedidos por rota/ciclo de saída da base
  // Regra do Usuário: "O KM RODADO INICIA NA SAIDA DA BASE, CONTINUA CONTANDO EM TODAS ENTREGAS E FINALIZA NA BASE DE VOLTA"
  // Quando uma rota contém múltiplos pedidos despachados juntos (mesmo lote / route_started_at aproximado),
  // a telemetria GPS mede a rota completa do entregador (Base -> Entregas -> Retorno à Base).
  // O KM de combustível da rota é o percurso real completo, e para cada entrega exibimos a sua cota ou valor correspondente.

  // Agrupamento por lote de rota (pedidos com mesmo route_started_at + route_finished_at, ou janela temporal)
  // Regra B: Deduplicação por rota: dentro de um mesmo entregador, pedidos que compartilham a mesma rota
  // (mesmo route_started_at + route_finished_at, ou mesmo start_base + janela de tempo)
  // devem ter o km/combustível da rota contado UMA VEZ só, não por pedido.
  const getRouteBatchKey = (o: OrderRecord): string => {
    if (o.route_started_at && o.route_finished_at) {
      return `route_${o.route_started_at}_${o.route_finished_at}`
    }
    if (o.route_started_at) {
      const oTime = new Date(o.route_started_at).getTime()
      return `batch_${Math.floor(oTime / (15 * 60 * 1000))}`
    }
    if (o.created) {
      const cTime = new Date(o.created).getTime()
      return `batch_created_${Math.floor(cTime / (15 * 60 * 1000))}`
    }
    return `single_${o.id}`
  }

  const routeBatches = new Map<string, OrderRecord[]>()
  eligibleOrders.forEach((o) => {
    let assignedKey: string | null = null
    if (o.route_started_at && o.route_finished_at) {
      assignedKey = `route_${o.route_started_at}_${o.route_finished_at}`
    } else if (o.route_started_at) {
      const oTime = new Date(o.route_started_at).getTime()
      for (const existingKey of routeBatches.keys()) {
        if (existingKey.startsWith('batch_')) {
          const batchTime = Number(existingKey.replace('batch_', '')) * (15 * 60 * 1000)
          if (Math.abs(oTime - batchTime) <= 15 * 60 * 1000) {
            assignedKey = existingKey
            break
          }
        }
      }
      if (!assignedKey) {
        assignedKey = `batch_${Math.floor(oTime / (15 * 60 * 1000))}`
      }
    } else if (o.created) {
      const cTime = new Date(o.created).getTime()
      for (const existingKey of routeBatches.keys()) {
        if (existingKey.startsWith('batch_created_')) {
          const batchTime = Number(existingKey.replace('batch_created_', '')) * (15 * 60 * 1000)
          if (Math.abs(cTime - batchTime) <= 15 * 60 * 1000) {
            assignedKey = existingKey
            break
          }
        }
      }
      if (!assignedKey) {
        assignedKey = `batch_created_${Math.floor(cTime / (15 * 60 * 1000))}`
      }
    } else {
      assignedKey = `single_${o.id}`
    }

    const list = routeBatches.get(assignedKey) || []
    list.push(o)
    routeBatches.set(assignedKey, list)
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

    // APLICAR HIERARQUIA NO LOTE DA ROTA:
    // PRIORIDADE 1: Odômetro da moto (se informado pelo entregador)
    // PRIORIDADE 2: Trajeto viário oficial das paradas da rota (maxRoadKmInBatch ou trajeto planejado)
    // PRIORIDADE 3: Telemetria GPS saneada (falha de sinal nunca reduz km do entregador)
    if (batchOdometerKm > 0) {
      batchTelemetry.officialRealKm = Number(batchOdometerKm.toFixed(1))
      batchTelemetry.calculationSource = 'odometro'
      batchTelemetry.odometerKm = batchOdometerKm
    } else if (maxRoadKmInBatch > 0) {
      batchTelemetry.officialRealKm = Number(
        Math.max(maxRoadKmInBatch, batchTelemetry.officialRealKm).toFixed(1),
      )
      batchTelemetry.calculationSource =
        batchTelemetry.officialRealKm > maxRoadKmInBatch ? 'gps' : 'historico_viario'
    } else if (batchTelemetry.officialRealKm > 0) {
      batchTelemetry.calculationSource = batchTelemetry.calculationSource || 'gps'
    } else {
      batchTelemetry.calculationSource = 'historico_viario'
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

  // Helper para peso individual da entrega:
  // per-delivery weight = max(roadDistFromBase(i), 0.8) + returnToBase(i)
  const computeOrderWeight = (ord: OrderRecord): number => {
    const baseLat = ord.start_base_lat || -22.7001402
    const baseLng = ord.start_base_lng || -43.2982834
    const custLat = ord.expand?.customer_id?.lat || ord.end_address_lat || 0
    const custLng = ord.expand?.customer_id?.lng || ord.end_address_lng || 0

    let roadDist = 0.8
    if (custLat !== 0 && custLng !== 0) {
      const directMeters = haversineDistanceMeters(baseLat, baseLng, custLat, custLng)
      roadDist = Math.max(directMeters / 1000, 0.8)
    }

    // Se distance_km da ordem for válido e maior (já computado no asfalto), utiliza
    if (typeof ord.distance_km === 'number' && ord.distance_km > 0) {
      roadDist = Math.max(roadDist, ord.distance_km)
    }

    const returnKm =
      typeof ord.return_trip_km === 'number' && ord.return_trip_km > 0
        ? ord.return_trip_km
        : roadDist

    return Math.max(roadDist, 0.8) + returnKm
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
    const key = getRouteBatchKey(order)

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
      const ratio = totalBatchWeight > 0 ? thisWeight / totalBatchWeight : 1 / batchCount

      const orderIndex = batchOrders.findIndex((b) => b.id === order.id)
      const isLastOrderInBatch = orderIndex === batchCount - 1

      if (isLastOrderInBatch) {
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

    return {
      order,
      officialKm,
      deviationKm: Number(deviationKm.toFixed(1)),
      totalGpsKm: Number(totalGpsKm.toFixed(1)),
      discardedNoiseKm: batchTelemetry.discardedNoiseKm,
      isRealTelemetry: batchTelemetry.isRealTelemetry,
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
    }
  })

  // Regra "linha = cabeçalho" e Paridade 100% de Rotas Únicas:
  // Os totais consolidados somam diretamente a soma de cada linha calculada (orderCalculations)
  // ou a soma das rotas únicas deduplicadas (que bate exatamente com a soma dos pedidos rateados)
  totalOfficialKm = Number(orderCalculations.reduce((acc, c) => acc + c.officialKm, 0).toFixed(1))
  totalDeviationKm = Number(orderCalculations.reduce((acc, c) => acc + c.deviationKm, 0).toFixed(1))
  totalOdometerKm = Number(orderCalculations.reduce((acc, c) => acc + c.totalGpsKm, 0).toFixed(1))
  totalLiters = Number(orderCalculations.reduce((acc, c) => acc + c.litersSpent, 0).toFixed(2))

  if (isBicycle) {
    totalSpent = 0
  } else {
    totalSpent = Number(orderCalculations.reduce((acc, c) => acc + c.fuelCost, 0).toFixed(2))
  }

  // REGRA DE OURO DO DONO (CARRY-OVER MENSAL DE CONTA CORRENTE):
  // O saldo dos entregadores sempre é levado para o próximo mês (contínuo).
  // O KM e combustível apurados sempre são calculados dentro do mês fechado.
  // No filtro de mês ('month'): saldo = carryOverBalance (saldo acumulado até o mês anterior) + adiantamentos do mês - gasto do mês
  let balance = totalAdvances - totalSpent
  if (periodFilter === 'month') {
    balance = carryOverBalance + totalAdvances - totalSpent
  }

  const calculationSource: 'odometro' | 'historico_viario' | 'gps' = hasAnyOdometer
    ? 'odometro'
    : 'historico_viario'
  const calculationSourceLabel =
    calculationSource === 'odometro'
      ? 'Odômetro da Moto'
      : calculationSource === 'historico_viario'
        ? 'Histórico Viário de Rotas'
        : 'Telemetria GPS'

  const fuelAccount: CourierFuelAccount = {
    courier,
    totalAdvances: Number(totalAdvances.toFixed(2)),
    totalRouteKm: Number(totalOfficialKm.toFixed(1)),
    totalSpent: Number(totalSpent.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    advanceCount: courierAdvances.length,
    deliveriesCount: eligibleOrders.length,
    advances: courierAdvances,
    carryOverBalance: Number(carryOverBalance.toFixed(2)),
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
    advanceCount: courierAdvances.length,
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
    carryOverBalance: Number(carryOverBalance.toFixed(2)),
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
  ])
}
