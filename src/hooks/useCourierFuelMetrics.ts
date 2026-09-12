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
  // Objeto compatível com CourierFuelAccount
  fuelAccount: CourierFuelAccount | null
}

export interface UseCourierFuelOptions {
  periodFilter?: 'all' | 'month' | 'week' | 'today'
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
      const distToBase = haversineDistanceMeters(ev.lat, ev.lng, -22.7001402, -43.2982834)
      if (distToBase < DEVIATION_THRESHOLD_METERS && stopSec < 180 && stopSec > 0) return false
    }
    return true
  })

  // 3. Filtrar ordens atribuídas ao entregador que tenham iniciado rota ou finalizado
  // (IMPORTANTE: pedidos cancelados o.status === 'cancelled' NUNCA somam km nem combustível)
  const allCourierOrders = orders.filter(
    (o) => o.courier_id === courier.id && o.status !== 'cancelled',
  )

  const eligibleOrders = allCourierOrders.filter((o) => {
    const isStartedOrDelivered =
      o.status !== 'cancelled' &&
      (o.route_started === true ||
        o.status === 'delivered' ||
        o.status === 'in_transit' ||
        o.status === 'address_error' ||
        o.status === 'client_absent')

    if (!isStartedOrDelivered) return false
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

  // Agrupamento por lote de rota (pedidos com mesmo route_started_at ou janela próxima)
  const routeBatches = new Map<string, OrderRecord[]>()
  eligibleOrders.forEach((o) => {
    const key = o.route_started_at
      ? `batch_${Math.floor(new Date(o.route_started_at).getTime() / (10 * 60 * 1000))}`
      : `single_${o.id}`
    const list = routeBatches.get(key) || []
    list.push(o)
    routeBatches.set(key, list)
  })

  // Pré-calcular métricas de telemetria por lote de rota completa
  const batchTelemetryMap = new Map<string, ReturnType<typeof calculateRealKmForOrder>>()
  routeBatches.forEach((batchOrders, key) => {
    // Escolhe o pedido âncora do lote para apurar a rota inteira
    const anchorOrder = batchOrders[0]
    const batchTelemetry = calculateRealKmForOrder({
      order: anchorOrder,
      allCourierLocations: courierLocations,
      courierEvents,
      allCourierOrders: batchOrders,
    })
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

  const orderCalculations: CourierOrderTelemetryCalculation[] = eligibleOrders.map((order) => {
    const key = order.route_started_at
      ? `batch_${Math.floor(new Date(order.route_started_at).getTime() / (10 * 60 * 1000))}`
      : `single_${order.id}`

    const batchTelemetry = batchTelemetryMap.get(key)!
    const batchOrders = routeBatches.get(key) || [order]
    const batchCount = batchOrders.length

    // Se houver mais de uma entrega na mesma rota, rateia o KM total da rota entre elas
    // proporcionalmente (ou igualmente se não houver distâncias planejadas individuais)
    let officialKm = batchTelemetry.officialRealKm
    let deviationKm = batchTelemetry.deviationKm
    let totalGpsKm = batchTelemetry.totalGpsKm

    if (batchCount > 1) {
      // Rateio proporcional: km da entrega = km da rota × distância planejada da entrega ÷ Σ distâncias planejadas do lote
      const totalPlannedInBatch = batchOrders.reduce((sum, b) => {
        const baseKm = b.distance_km || 0.5
        const returnKm = b.return_trip_km || 0
        return sum + (baseKm + returnKm)
      }, 0)
      const thisOrderWeight = (order.distance_km || 0.5) + (order.return_trip_km || 0)
      const ratio = totalPlannedInBatch > 0 ? thisOrderWeight / totalPlannedInBatch : 1 / batchCount

      const orderIndex = batchOrders.findIndex((b) => b.id === order.id)
      const isLastOrderInBatch = orderIndex === batchCount - 1

      if (isLastOrderInBatch) {
        // Compensar resíduo de arredondamento no último item para que a soma da coluna
        // resulte rigorosamente idêntica ao total oficial do lote
        let allocatedOfficialKm = 0
        let allocatedDeviationKm = 0
        let allocatedGpsKm = 0

        for (let i = 0; i < batchCount - 1; i++) {
          const bOrder = batchOrders[i]
          const bWeight = (bOrder.distance_km || 0.5) + (bOrder.return_trip_km || 0)
          const bRatio = totalPlannedInBatch > 0 ? bWeight / totalPlannedInBatch : 1 / batchCount
          allocatedOfficialKm += Number((batchTelemetry.officialRealKm * bRatio).toFixed(1))
          allocatedDeviationKm += Number((batchTelemetry.deviationKm * bRatio).toFixed(1))
          allocatedGpsKm += Number((batchTelemetry.totalGpsKm * bRatio).toFixed(1))
        }

        officialKm = Number(
          Math.max(0, batchTelemetry.officialRealKm - allocatedOfficialKm).toFixed(1),
        )
        deviationKm = Number(
          Math.max(0, batchTelemetry.deviationKm - allocatedDeviationKm).toFixed(1),
        )
        totalGpsKm = Number(Math.max(0, batchTelemetry.totalGpsKm - allocatedGpsKm).toFixed(1))
      } else {
        officialKm = Number((batchTelemetry.officialRealKm * ratio).toFixed(1))
        deviationKm = Number((batchTelemetry.deviationKm * ratio).toFixed(1))
        totalGpsKm = Number((batchTelemetry.totalGpsKm * ratio).toFixed(1))
      }
    }

    const litersSpent = !isBicycle && consumptionKml > 0 ? officialKm / consumptionKml : 0
    const fuelCost = !isBicycle ? litersSpent * pricePerLiter : 0

    return {
      order,
      officialKm,
      deviationKm,
      totalGpsKm,
      discardedNoiseKm: batchTelemetry.discardedNoiseKm,
      isRealTelemetry: batchTelemetry.isRealTelemetry,
      hasReturnKm: batchTelemetry.hasReturnKm,
      fuelCost: Number(fuelCost.toFixed(2)),
      litersSpent: Number(litersSpent.toFixed(2)),
      offRouteCount: batchTelemetry.offRouteCount,
      unexpectedStopsCount: batchTelemetry.unexpectedStopsCount,
    }
  })

  // Os totais consolidados somam diretamente os valores dos lotes de rotas
  // para garantir exatidão sem erro de arredondamento:
  // KM Rodado = soma das rotas (saída da base até volta à base)
  batchTelemetryMap.forEach((batchTelemetry) => {
    totalOfficialKm += batchTelemetry.officialRealKm
    totalDeviationKm += batchTelemetry.deviationKm
    totalOdometerKm += batchTelemetry.totalGpsKm
  })

  totalOfficialKm = Number(totalOfficialKm.toFixed(1))
  totalDeviationKm = Number(totalDeviationKm.toFixed(1))
  totalOdometerKm = Number(totalOdometerKm.toFixed(1))

  totalLiters = !isBicycle && consumptionKml > 0 ? totalOfficialKm / consumptionKml : 0
  totalSpent = !isBicycle ? totalLiters * pricePerLiter : 0

  const balance = totalAdvances - totalSpent

  const fuelAccount: CourierFuelAccount = {
    courier,
    totalAdvances: Number(totalAdvances.toFixed(2)),
    totalRouteKm: Number(totalOfficialKm.toFixed(1)),
    totalSpent: Number(totalSpent.toFixed(2)),
    balance: Number(balance.toFixed(2)),
    advanceCount: courierAdvances.length,
    deliveriesCount: eligibleOrders.length,
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
}): CourierFuelCalculationResult {
  const {
    courier,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter = 'all',
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
    })
  }, [courier, advances, orders, locations, offRouteEvents, settings, periodFilter])
}
