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
import { deliveryService } from '@/services/deliveryService'
import { calculateRealKmForOrder } from '@/lib/telemetryKmEngine'

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
  vehicleCategory: 'moto' | 'carro' | 'caminhao'
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
  const courierEvents = offRouteEvents.filter((ev) => ev.courier_id === courier.id)

  // 3. Filtrar ordens atribuídas ao entregador que tenham iniciado rota ou finalizado
  // (mesma regra de elegibilidade do backend getCourierFuelAccounts e AdminDashboard)
  const allCourierOrders = orders.filter((o) => o.courier_id === courier.id)

  const eligibleOrders = allCourierOrders.filter((o) => {
    const isStartedOrDelivered =
      o.route_started === true ||
      o.status === 'delivered' ||
      o.status === 'in_transit' ||
      o.status === 'address_error' ||
      o.status === 'client_absent'

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

  // 4. Calcular telemetria real (Haversine + Curvatura + Filtro >300m) para cada pedido
  let totalOfficialKm = 0
  let totalDeviationKm = 0
  let totalOdometerKm = 0
  let totalSpent = 0
  let totalLiters = 0

  const orderCalculations: CourierOrderTelemetryCalculation[] = eligibleOrders.map((order) => {
    const realTelemetry = calculateRealKmForOrder({
      order,
      allCourierLocations: courierLocations,
      courierEvents,
      allCourierOrders,
    })

    const officialKm = realTelemetry.officialRealKm
    const deviationKm = realTelemetry.deviationKm
    const totalGpsKm = realTelemetry.totalGpsKm

    const litersSpent = consumptionKml > 0 ? officialKm / consumptionKml : 0
    const fuelCost = litersSpent * pricePerLiter

    totalOfficialKm += officialKm
    totalDeviationKm += deviationKm
    totalOdometerKm += totalGpsKm
    totalSpent += fuelCost
    totalLiters += litersSpent

    return {
      order,
      officialKm,
      deviationKm,
      totalGpsKm,
      discardedNoiseKm: realTelemetry.discardedNoiseKm,
      isRealTelemetry: realTelemetry.isRealTelemetry,
      hasReturnKm: realTelemetry.hasReturnKm,
      fuelCost: Number(fuelCost.toFixed(2)),
      litersSpent: Number(litersSpent.toFixed(2)),
      offRouteCount: realTelemetry.offRouteCount,
      unexpectedStopsCount: realTelemetry.unexpectedStopsCount,
    }
  })

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
