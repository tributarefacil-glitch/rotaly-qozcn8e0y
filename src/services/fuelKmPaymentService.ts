/**
 * src/services/fuelKmPaymentService.ts
 *
 * Motor Único e Canônico de KM e Pagamento de Combustível do Rotaly.
 *
 * Regras vigentes (permanentes):
 * 1. Base de pagamento é SEMPRE o KM VIÁRIO oficial (decisão 20/10).
 * 2. Deduplicação estrita por route_batch_key (agrupa por lote, volta à base 1x).
 * 3. Prioridade canônica para km_viario_total da telemetria de lote ou max(total_route_with_return_km).
 * 4. Desconto de combustível (padrão 15% / fator 0,85 para pós-corte 26/10),
 *    ajustável reativamente por mês (0%, 5%, 10%, 15%) via app_settings + localStorage.
 * 5. Bicicleta: isento de km e combustível (R$ 0,00).
 * 6. Moto: consumo app_settings (padrão 30 km/L) e preço app_settings (padrão R$ 6,49).
 */

import { AppSettingsRecord, OrderRecord, UserRecord } from '@/types/delivery'
import { isPostFuelPaymentCutoff } from '@/services/canonicalCourierTotalsService'
import { deriveRouteBatchKey } from '@/lib/routeBatchHelper'
import { isCurrentMonthInTz, isSameDayInTz } from '@/lib/operationalWindow'

export interface FuelPaymentBatchInput {
  order: OrderRecord
  batchKey?: string
  roadKm?: number
  gpsKm?: number
  dateRaw?: string | number | Date
  canonicalBatchTelem?: {
    km_viario_total?: number
    km_oficial?: number
    km_gps_total?: number
  } | null
}

export interface CalculateFuelKmPaymentParams {
  orders?: OrderRecord[]
  batchInputs?: FuelPaymentBatchInput[]
  courier?: {
    id?: string
    name?: string
    vehicle_type?: string
    consumption_kml?: number
    fuel_price?: number
  } | null
  periodFilter?: 'today' | 'week' | 'month' | 'previous_month' | 'all' | 'custom'
  customStartDate?: string
  customEndDate?: string
  referenceDate?: Date
  manualDiscountPct?: number
  settings?: AppSettingsRecord | null
}

export interface FuelKmPaymentResult {
  kmViarioOficial: number
  kmPagamento: number
  combustivelPagamento: number
  combustivelViarioOficial: number
  descontoKm: number
  descontoCombustivel: number
  appliedDiscountPct: number
  isBicycle: boolean
  deliveriesCount: number
  batchesCount: number
}

/**
 * Converte orders simples em FuelPaymentBatchInput com derivação de batchKey e km
 */
export function buildBatchInputsFromOrders(orders: OrderRecord[]): FuelPaymentBatchInput[] {
  const knownKeys = new Set<string>()
  return orders.map((order) => {
    const bKey = deriveRouteBatchKey(order, knownKeys, order.courier_id)
    knownKeys.add(bKey)

    const roadKm =
      typeof order.total_route_with_return_km === 'number' && order.total_route_with_return_km > 0
        ? order.total_route_with_return_km
        : typeof order.distance_km === 'number'
          ? order.distance_km + (order.return_trip_km || 0)
          : 0

    return {
      order,
      batchKey: bKey,
      roadKm,
      gpsKm: 0,
      dateRaw: order.route_finished_at || order.actual_arrival || order.created,
      canonicalBatchTelem: null,
    }
  })
}

/**
 * Calcula os totais canônicos de km e combustível a partir do motor único unificado.
 */
export function calculateFuelKmPayment(params: CalculateFuelKmPaymentParams): FuelKmPaymentResult {
  const {
    orders,
    batchInputs: explicitBatchInputs,
    courier,
    periodFilter = 'month',
    customStartDate,
    customEndDate,
    referenceDate = new Date(),
    manualDiscountPct,
    settings,
  } = params

  const isBicycle = courier?.vehicle_type === 'bicicleta' || courier?.vehicle_type === 'bicycle'

  if (isBicycle) {
    return {
      kmViarioOficial: 0,
      kmPagamento: 0,
      combustivelPagamento: 0,
      combustivelViarioOficial: 0,
      descontoKm: 0,
      descontoCombustivel: 0,
      appliedDiscountPct: manualDiscountPct ?? 15,
      isBicycle: true,
      deliveriesCount: (orders || explicitBatchInputs || []).length,
      batchesCount: 0,
    }
  }

  const inputs: FuelPaymentBatchInput[] =
    explicitBatchInputs && explicitBatchInputs.length > 0
      ? explicitBatchInputs
      : orders && orders.length > 0
        ? buildBatchInputsFromOrders(orders)
        : []

  // Filtragem de período de acordo com fuso Brasília
  const now = referenceDate
  const filteredInputs = inputs.filter((item) => {
    const rawDate = item.dateRaw || item.order.route_finished_at || item.order.created
    if (!rawDate) return false
    const d = new Date(rawDate)
    const t = d.getTime()
    if (isNaN(t)) return false

    if (periodFilter === 'all') return true

    if (periodFilter === 'today') {
      return isSameDayInTz(d, now)
    }

    if (periodFilter === 'month') {
      return isCurrentMonthInTz(d, now)
    }

    if (periodFilter === 'custom' && customStartDate) {
      const startT = new Date(`${customStartDate}T00:00:00-03:00`).getTime()
      const endT = new Date(`${customEndDate || customStartDate}T23:59:59-03:00`).getTime()
      return t >= startT && t <= endT
    }

    if (periodFilter === 'week') {
      const dayOfWeek = now.getDay()
      const diffToMonday = (dayOfWeek + 6) % 7
      const monday = new Date(now)
      monday.setDate(now.getDate() - diffToMonday)
      monday.setHours(0, 0, 0, 0)
      return t >= monday.getTime()
    }

    return true
  })

  // Agrupamento por lote (route_batch_key)
  const batchMap = new Map<string, FuelPaymentBatchInput[]>()
  filteredInputs.forEach((item) => {
    const bKey =
      item.batchKey || deriveRouteBatchKey(item.order, batchMap.keys(), item.order.courier_id)
    const list = batchMap.get(bKey) || []
    list.push(item)
    batchMap.set(bKey, list)
  })

  const effectiveDiscountPct = typeof manualDiscountPct === 'number' ? manualDiscountPct : 15
  const discountFactor = Math.max(0, 1 - effectiveDiscountPct / 100)

  let roadKmTotal = 0
  let kmPagamentoTotal = 0

  batchMap.forEach((batchRows) => {
    const canonicalTelemRec = batchRows.find((r) => r.canonicalBatchTelem)?.canonicalBatchTelem

    const telemViarioKm =
      canonicalTelemRec && typeof canonicalTelemRec.km_viario_total === 'number'
        ? canonicalTelemRec.km_viario_total
        : canonicalTelemRec && typeof canonicalTelemRec.km_oficial === 'number'
          ? canonicalTelemRec.km_oficial
          : 0

    const maxOrderReturnKm = batchRows.reduce((max, r) => {
      const km =
        typeof r.order?.total_route_with_return_km === 'number'
          ? r.order.total_route_with_return_km
          : 0
      return Math.max(max, km)
    }, 0)

    const bRoad =
      telemViarioKm > 0
        ? telemViarioKm
        : maxOrderReturnKm > 0
          ? maxOrderReturnKm
          : batchRows.reduce((sum, r) => sum + (r.roadKm || 0), 0)

    const earliestCreatedTs = batchRows.reduce((min, r) => {
      const t = r.dateRaw ? new Date(r.dateRaw).getTime() : 0
      return t > 0 && t < min ? t : min
    }, Number.MAX_SAFE_INTEGER)

    const isDiscountPostCutoff = isPostFuelPaymentCutoff(earliestCreatedTs)
    const bKmPagamento = isDiscountPostCutoff ? bRoad * discountFactor : bRoad

    roadKmTotal += bRoad
    kmPagamentoTotal += bKmPagamento
  })

  const finalRoadKm = Number(roadKmTotal.toFixed(1))
  const finalKmPagamento = Number(kmPagamentoTotal.toFixed(1))

  const motoConsumption =
    typeof courier?.consumption_kml === 'number' && courier.consumption_kml > 0
      ? courier.consumption_kml
      : Number(settings?.consumption_kml) || 30.0

  const motoPrice =
    typeof courier?.fuel_price === 'number' && courier.fuel_price > 0
      ? courier.fuel_price
      : Number(settings?.fuel_price) || 6.49

  const combustivelPagamentoTotal = Number(
    ((finalKmPagamento / motoConsumption) * motoPrice).toFixed(2),
  )
  const combustivelViarioTotal = Number(((finalRoadKm / motoConsumption) * motoPrice).toFixed(2))

  const descontoKm = Number((finalRoadKm - finalKmPagamento).toFixed(1))
  const descontoCombustivel = Number(
    (combustivelViarioTotal - combustivelPagamentoTotal).toFixed(2),
  )

  return {
    kmViarioOficial: finalRoadKm,
    kmPagamento: finalKmPagamento,
    combustivelPagamento: combustivelPagamentoTotal,
    combustivelViarioOficial: combustivelViarioTotal,
    descontoKm,
    descontoCombustivel,
    appliedDiscountPct: effectiveDiscountPct,
    isBicycle: false,
    deliveriesCount: filteredInputs.length,
    batchesCount: batchMap.size,
  }
}
