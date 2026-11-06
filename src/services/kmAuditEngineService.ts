import {
  OrderRecord,
  UserRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
  RouteKmApprovalRecord,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import {
  groupOrdersByRouteBatch,
  getRouteBatchDisplay,
  deriveRouteBatchKey,
} from '@/lib/routeBatchHelper'
import { isPostFuelPaymentCutoff } from '@/services/canonicalCourierTotalsService'
import { MapDataService } from '@/lib/mapDataService'
import { haversineDistanceMeters } from '@/lib/geo'
import {
  getOperationalWindow,
  getOperationalMonthStart,
  getOperationalPreviousMonthRange,
  getCustomOperationalWindow,
  getYearMonthInTz,
  isOrderInPeriod,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import { deliveryService } from '@/services/deliveryService'

export const FUEL_DISCOUNT_EVENT = 'rotaly:fuel_discount_changed'

export interface KmAuditRow {
  order: OrderRecord
  courier: UserRecord | undefined
  trackingCode: string
  customerName: string
  address: string
  dateStr: string
  dateRaw: string
  batchKey: string
  batchDisplay: string
  roadKm: number
  gpsKm: number
  telemetryStatus?: 'suficiente' | 'insuficiente'
  telemetryPingsCount: number
  hasRelevantGaps?: boolean
  canonicalBatchTelem?: RouteBatchTelemetryRecord
  deviationMeters: number
  deviationTimeStr: string
  offRoadEventsCount: number
  unexpectedStopsMeters: number
  unexpectedStopsCount: number
  isJointDelivery: boolean
  isJointSecondary: boolean
  statusBadge: string
  hasSignificantDeviation: boolean
  isRedirected: boolean
  isRedirectionPending: boolean
  hasKmDivergence: boolean
  divergenciaInfo?: { valido: boolean; diferenca: number; alertaSanidade?: string }
  isDivergent: boolean
  isAutoApproved: boolean
  isPendingDecision: boolean
  approval?: RouteKmApprovalRecord
  officialAfterApprovalKm: number
  odometerKm: number
}

export interface KmAuditSummaryResult {
  roadKmTotal: number
  rawRoadKmBeforeAdjustment: number
  gpsKmTotal: number
  afterApprovalKmTotal: number
  approvedItemsCount: number
  autoApprovedCount: number
  divergentPendingCount: number
  redirectedCount: number
  totalScopeCount: number
  unreadableDateCount: number
  batchCount: number
  hasManualAdjustment: boolean
  manualAdjDelta: number
  manualAdjPeriodText: string
  kmPagamentoTotal: number
  combustivelPagamentoTotal: number
  combustivelViarioOficialTotal: number
}

/**
 * Obtém a chave canônica do mês de referência (ex.: "2026-11")
 */
export function getReferenceMonthKey(
  periodFilter: 'all' | 'today' | 'week' | 'month' | 'previous_month' | 'custom',
  customStartDate?: string,
): string {
  if (periodFilter === 'previous_month') {
    try {
      return getOperationalPreviousMonthRange(new Date()).dateStr
    } catch {
      /* fallback */
    }
  }
  if (periodFilter === 'custom' && customStartDate) {
    try {
      const ym = getYearMonthInTz(customStartDate)
      return `${ym.year}-${String(ym.month).padStart(2, '0')}`
    } catch {
      /* fallback */
    }
  }
  const ym = getYearMonthInTz(new Date())
  return `${ym.year}-${String(ym.month).padStart(2, '0')}`
}

/**
 * Lê o percentual de desconto manual para o mês de referência de settings e localStorage (0, 5, 10, 15 - padrão 15)
 */
export function getManualFuelDiscountPct(
  monthKey: string,
  settings?: AppSettingsRecord | null,
): number {
  const extraRecord = settings?.extra as Record<string, unknown> | undefined
  const monthlyMap = extraRecord?.fuel_discount_monthly as Record<string, number> | undefined
  const fromSettings = monthlyMap?.[monthKey]
  if (typeof fromSettings === 'number' && [0, 5, 10, 15].includes(fromSettings)) {
    return fromSettings
  }
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const stored = window.localStorage.getItem(`rotaly_fuel_discount_${monthKey}`)
      if (stored !== null) {
        const parsed = Number(stored)
        if ([0, 5, 10, 15].includes(parsed)) {
          return parsed
        }
      }
    }
  } catch {
    /* ignore */
  }
  return 15
}

/**
 * Persiste o percentual de desconto manual no localStorage e em app_settings.extra.fuel_discount_monthly,
 * disparando evento reativo para que todas as telas atualizem instantaneamente.
 */
export async function setManualFuelDiscountPct(
  monthKey: string,
  pct: number,
  settings?: AppSettingsRecord | null,
  onUpdated?: () => void,
): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(`rotaly_fuel_discount_${monthKey}`, String(pct))
      window.dispatchEvent(new CustomEvent(FUEL_DISCOUNT_EVENT, { detail: { monthKey, pct } }))
    }
  } catch {
    /* ignore */
  }

  try {
    const existingExtra = (
      settings?.extra && typeof settings.extra === 'object' ? settings.extra : {}
    ) as Record<string, unknown>
    const existingMonthly = (existingExtra.fuel_discount_monthly as Record<string, number>) || {}
    const updatedExtra = {
      ...existingExtra,
      fuel_discount_monthly: {
        ...existingMonthly,
        [monthKey]: pct,
      },
    }
    await deliveryService.updateSettings({
      extra: updatedExtra,
    })
    onUpdated?.()
  } catch (err) {
    console.warn('Erro ao persistir desconto de combustível em app_settings:', err)
  }
}

export interface BuildKmAuditRowsParams {
  orders: OrderRecord[]
  couriers: UserRecord[]
  approvals: RouteKmApprovalRecord[]
  batchTelemetryList?: RouteBatchTelemetryRecord[]
  locations?: LocationRecord[]
  offRouteEvents?: OffRouteEventRecord[]
  settings?: AppSettingsRecord | null
}

/**
 * Constrói linhas de auditoria auditRows idênticas às de KmAuditReport
 */
export function buildKmAuditRows(params: BuildKmAuditRowsParams): KmAuditRow[] {
  const {
    orders,
    couriers,
    approvals,
    batchTelemetryList = [],
    locations = [],
    offRouteEvents = [],
    settings = null,
  } = params

  const eligibleOrdersPool = orders.filter((ord) => {
    if (!ord) return false
    if (ord.status === 'cancelled') return false
    if (ord.route_started === false && !ord.actual_arrival) return false
    return true
  })

  const batchTelemetryMap = new Map<string, RouteBatchTelemetryRecord>()
  batchTelemetryList.forEach((rec) => {
    if (rec.route_batch_key) batchTelemetryMap.set(rec.route_batch_key, rec)
    if (rec.id) batchTelemetryMap.set(rec.id, rec)
  })

  const ordersByCourier = new Map<string, OrderRecord[]>()
  eligibleOrdersPool.forEach((ord) => {
    if (!ord.courier_id) return
    const list = ordersByCourier.get(ord.courier_id) || []
    list.push(ord)
    ordersByCourier.set(ord.courier_id, list)
  })

  const motorApprovalsMap = new Map<
    string,
    { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
  >()
  const approvalsMap = new Map<string, RouteKmApprovalRecord>()
  approvals.forEach((appr) => {
    if (appr.order_id) {
      approvalsMap.set(appr.order_id, appr)
      motorApprovalsMap.set(appr.order_id, {
        approvedKm: appr.approved_km,
        justification: appr.justification,
        status: appr.status,
      })
    }
  })

  const rows: KmAuditRow[] = []

  ordersByCourier.forEach((courierOrders, courierId) => {
    const courierObj = couriers.find((c) => c.id === courierId)
    if (!courierObj) return

    const courierBatchMap = groupOrdersByRouteBatch(courierOrders, courierId)
    const orderToBatchKey = new Map<string, string>()
    courierBatchMap.forEach((bOrders, key) => {
      bOrders.forEach((bo) => {
        orderToBatchKey.set(bo.id, key)
      })
    })

    const courierBatches = Array.from(batchTelemetryMap.values()).filter(
      (b) => b.courier_id === courierId,
    )

    const metrics = calculateCourierFuelMetrics({
      courier: courierObj,
      advances: [],
      orders: courierOrders,
      locations,
      offRouteEvents,
      settings,
      periodFilter: 'all',
      approvalsMap: motorApprovalsMap,
      telemetryBatches: courierBatches,
    })

    const metricsOriginal = calculateCourierFuelMetrics({
      courier: courierObj,
      advances: [],
      orders: courierOrders,
      locations,
      offRouteEvents,
      settings,
      periodFilter: 'all',
      telemetryBatches: courierBatches,
    })

    const originalOrderMap = new Map<string, number>()
    metricsOriginal.orderCalculations.forEach((c) => {
      originalOrderMap.set(c.order.id, c.officialKm)
    })

    metrics.orderCalculations.forEach((calc) => {
      const order = calc.order
      const cust = order.expand?.customer_id
      const customerName = cust?.name || order.customer_name || 'Cliente'
      const address =
        cust?.address || order.end_address_text || order.address || 'Endereço não informado'

      const dateRaw = order.route_finished_at || order.actual_arrival || order.created
      const dateObj = new Date(dateRaw)
      const dateStr = dateObj.toLocaleDateString('pt-BR')

      const bKey = orderToBatchKey.get(order.id) || `single_${order.id}`
      const batchDisplay = getRouteBatchDisplay(order)

      const canonicalBatchTelem =
        batchTelemetryMap.get(bKey) ||
        (order.route_batch_key ? batchTelemetryMap.get(order.route_batch_key) : undefined) ||
        ((order as any).batch_telemetry_id
          ? batchTelemetryMap.get((order as any).batch_telemetry_id)
          : undefined)

      let maxDevMeters = 0
      let devTimeStr = '-'
      let offRouteCount = 0
      let maxStopDistMeters = 0
      let unexpectedStopsCount = 0

      const orderStart = order.route_started_at ? new Date(order.route_started_at).getTime() : 0
      const orderEnd =
        order.actual_arrival || order.route_finished_at
          ? new Date(order.actual_arrival || order.route_finished_at!).getTime()
          : 0

      offRouteEvents.forEach((ev) => {
        if (ev.courier_id !== courierId) return
        const evTime = new Date(ev.created).getTime()
        const matchesTime =
          orderStart > 0 &&
          orderEnd > 0 &&
          evTime >= orderStart - 2 * 60 * 1000 &&
          evTime <= orderEnd + 2 * 60 * 1000

        if (ev.order_id === order.id || matchesTime) {
          if (ev.event_type === 'route_deviation') {
            offRouteCount++
            const devM = ev.distance_deviation_meters || 0
            if (devM > maxDevMeters) {
              maxDevMeters = devM
              devTimeStr = new Date(ev.created).toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
              })
            }
          } else if (ev.event_type === 'unexpected_stop') {
            unexpectedStopsCount++
            const cleanDest = MapDataService.getOrderDestination(order)
            if (cleanDest && ev.lat && ev.lng) {
              const stopDist = haversineDistanceMeters(ev.lat, ev.lng, cleanDest.lat, cleanDest.lng)
              if (stopDist > maxStopDistMeters) maxStopDistMeters = Math.round(stopDist)
            }
          }
        }
      })

      const approval = approvalsMap.get(order.id)
      const roadKmOriginal = originalOrderMap.get(order.id) ?? calc.officialKm
      const officialAfterApprovalKm = calc.officialKm

      const canonicalGpsKm =
        canonicalBatchTelem && typeof canonicalBatchTelem.km_gps_total === 'number'
          ? canonicalBatchTelem.km_gps_total
          : calc.totalGpsKm

      const canonicalPingsCount =
        canonicalBatchTelem && typeof canonicalBatchTelem.pings_count === 'number'
          ? canonicalBatchTelem.pings_count
          : (calc.telemetryPingsCount ?? 0)

      const hasRelevantGaps = Boolean(
        canonicalBatchTelem &&
        canonicalBatchTelem.telemetry_gaps &&
        canonicalBatchTelem.telemetry_gaps.length > 0,
      )

      let orderOdometerKm = 0
      if (typeof order.km_odometro === 'number' && order.km_odometro > 0) {
        orderOdometerKm = order.km_odometro
      } else if (
        typeof order.odometro_final === 'number' &&
        typeof order.odometro_inicial === 'number' &&
        order.odometro_final > order.odometro_inicial
      ) {
        orderOdometerKm = Number((order.odometro_final - order.odometro_inicial).toFixed(1))
      }

      const isRedirected = Boolean(
        order.is_redirected ||
        order.redirection_status === 'initiated' ||
        order.redirection_status === 'completed' ||
        order.redirection_status === 'point_a_visited' ||
        order.redirection_status === 'point_b_reached',
      )
      const isRedirectionPending = Boolean(order.redirection_status === 'initiated')

      const kmDivergenceDelta = Math.abs(calc.officialKm - calc.totalGpsKm)
      const hasSignificantDeviation =
        maxDevMeters > 500 || maxStopDistMeters > 300 || kmDivergenceDelta > 2.0 || isRedirected

      const divergenciaInfo = (calc as any).divergenciaInfo
      const hasKmDivergence = divergenciaInfo ? !divergenciaInfo.valido : kmDivergenceDelta > 2.0
      const isDivergent = hasSignificantDeviation || hasKmDivergence

      const isAutoApproved =
        !isDivergent &&
        calc.telemetryStatus === 'suficiente' &&
        !hasRelevantGaps &&
        !isRedirected &&
        (!approval || approval.status === 'approved')

      const isPendingDecision = !isAutoApproved && (!approval || approval.status === 'pending')

      let statusBadge = 'Aprovado'
      if (approval?.status === 'approved') {
        statusBadge = 'Aprovado Manual'
      } else if (approval?.status === 'rejected') {
        statusBadge = 'Rejeitado'
      } else if (isAutoApproved) {
        statusBadge = 'Auto-Aprovado'
      } else if (isPendingDecision) {
        statusBadge = 'Pendente'
      }

      rows.push({
        order,
        courier: courierObj,
        trackingCode: order.tracking_code || `ORD-${order.id.slice(0, 6)}`,
        customerName,
        address,
        dateStr,
        dateRaw,
        batchKey: bKey,
        batchDisplay,
        roadKm: roadKmOriginal,
        gpsKm: canonicalGpsKm,
        telemetryStatus: calc.telemetryStatus,
        telemetryPingsCount: canonicalPingsCount,
        hasRelevantGaps,
        canonicalBatchTelem,
        deviationMeters: maxDevMeters,
        deviationTimeStr: devTimeStr,
        offRoadEventsCount: offRouteCount,
        unexpectedStopsMeters: maxStopDistMeters,
        unexpectedStopsCount,
        isJointDelivery: calc.isJointDelivery,
        isJointSecondary: calc.isJointSecondary,
        statusBadge,
        hasSignificantDeviation,
        isRedirected,
        isRedirectionPending,
        hasKmDivergence,
        divergenciaInfo,
        isDivergent,
        isAutoApproved,
        isPendingDecision,
        approval,
        officialAfterApprovalKm,
        odometerKm: orderOdometerKm,
      })
    })
  })

  return rows
}

export interface CalculateKmAuditSummaryParams {
  auditRows: KmAuditRow[]
  selectedCourierId?: string
  selectedDateFilter?: 'all' | 'today' | 'week' | 'month' | 'previous_month' | 'custom'
  customStartDate?: string
  customEndDate?: string
  selectedBatchKey?: string
  searchQuery?: string
  eligibleCouriers?: UserRecord[]
  manualDiscountPct?: number
  settings?: AppSettingsRecord | null
}

/**
 * MOTOR CANÔNICO ÚNICO DE AUDITORIA E CÁLCULO DE KM E COMBUSTÍVEL
 * Extraído estritamente de scopeSummary em KmAuditReport.tsx.
 */
export function calculateKmAuditSummary(
  params: CalculateKmAuditSummaryParams,
): KmAuditSummaryResult {
  const {
    auditRows,
    selectedCourierId = 'all',
    selectedDateFilter = 'month',
    customStartDate,
    customEndDate,
    selectedBatchKey = 'all',
    searchQuery = '',
    eligibleCouriers = [],
    manualDiscountPct = 15,
    settings = null,
  } = params

  let approvedItemsCount = 0
  let autoApprovedCount = 0
  let divergentPendingCount = 0
  let redirectedCount = 0
  let totalScopeCount = 0
  let unreadableDateCount = 0

  const now = new Date()
  let customWindow: { start: number; end: number } | null = null
  if (selectedDateFilter === 'custom' && customStartDate) {
    customWindow = getCustomOperationalWindow(customStartDate, customEndDate || customStartDate)
  }

  const inScopeRows: KmAuditRow[] = []

  auditRows.forEach((r) => {
    if (selectedCourierId !== 'all' && r.order.courier_id !== selectedCourierId) return

    const parsed = parseSafeTimestamp(r.dateRaw)
    const fallbackTs = r.dateRaw ? new Date(r.dateRaw).getTime() : 0
    const rowTs =
      parsed > 0 ? parsed : Number.isFinite(fallbackTs) && fallbackTs > 0 ? fallbackTs : 0

    if (!rowTs || rowTs <= 0) {
      unreadableDateCount++
      return
    }

    if (selectedDateFilter === 'custom' && customWindow) {
      if (rowTs < customWindow.start || rowTs > customWindow.end) return
    } else if (
      selectedDateFilter === 'today' ||
      selectedDateFilter === 'week' ||
      selectedDateFilter === 'month' ||
      selectedDateFilter === 'previous_month'
    ) {
      if (
        !isOrderInPeriod(
          rowTs,
          selectedDateFilter as 'today' | 'week' | 'month' | 'previous_month',
          now,
        )
      ) {
        return
      }
    }
    if (selectedBatchKey !== 'all' && r.batchDisplay !== selectedBatchKey) return
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      const matchCust = r.customerName.toLowerCase().includes(q)
      const matchAddr = r.address.toLowerCase().includes(q)
      const matchTrk = r.trackingCode.toLowerCase().includes(q)
      const matchCourier = (r.courier?.name || '').toLowerCase().includes(q)
      if (!matchCust && !matchAddr && !matchTrk && !matchCourier) return
    }

    totalScopeCount++
    inScopeRows.push(r)

    if (r.isRedirected) redirectedCount++
    if (r.isAutoApproved) autoApprovedCount++
    if (r.isPendingDecision) divergentPendingCount++

    if (r.approval && r.approval.status === 'approved') {
      approvedItemsCount++
    }
  })

  const scopeBatches = new Map<string, KmAuditRow[]>()
  inScopeRows.forEach((r) => {
    const bKey = r.batchKey || deriveRouteBatchKey(r.order, scopeBatches.keys(), r.order.courier_id)
    const list = scopeBatches.get(bKey) || []
    list.push(r)
    scopeBatches.set(bKey, list)
  })

  let roadKmTotal = 0
  let gpsKmTotal = 0
  let afterApprovalKmTotal = 0
  let kmPagamentoTotal = 0

  scopeBatches.forEach((batchRows) => {
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
          : batchRows.reduce((sum, r) => sum + r.roadKm, 0)

    const hasManualApproval = batchRows.some((r) =>
      Boolean(r.approval && r.approval.status === 'approved'),
    )
    const bAfter = hasManualApproval
      ? batchRows.reduce((sum, r) => sum + r.officialAfterApprovalKm, 0)
      : bRoad

    const earliestCreatedTs = batchRows.reduce((min, r) => {
      const t = r.dateRaw ? new Date(r.dateRaw).getTime() : 0
      return t > 0 && t < min ? t : min
    }, Number.MAX_SAFE_INTEGER)
    const isDiscountPostCutoff = isPostFuelPaymentCutoff(earliestCreatedTs)
    const discountFactor = 1 - manualDiscountPct / 100
    const bKmPagamento = isDiscountPostCutoff ? bRoad * discountFactor : bRoad

    const bGps = batchRows.reduce((max, r) => {
      const telemKm = r.canonicalBatchTelem ? r.canonicalBatchTelem.km_gps_total : 0
      return Math.max(max, telemKm || r.gpsKm || 0)
    }, 0)

    roadKmTotal += bRoad
    gpsKmTotal += bGps
    afterApprovalKmTotal += bAfter
    kmPagamentoTotal += bKmPagamento
  })

  // Regra de ajuste manual Edson
  const isEdsonSelected =
    selectedCourierId === 'tetrfu5oi19jbwz' ||
    (selectedCourierId === 'all' &&
      eligibleCouriers.some((c) => c.name?.toLowerCase().includes('edson')))

  let manualAdjustmentActive = false
  const manualAdjTargetKm = 731.0
  let manualAdjDelta = 0
  const manualAdjPeriodText = '01/10–22/10'

  if (
    isEdsonSelected &&
    (selectedDateFilter === 'all' ||
      selectedDateFilter === 'month' ||
      (selectedDateFilter === 'custom' &&
        customStartDate &&
        customEndDate &&
        customStartDate <= '2026-10-22' &&
        customEndDate >= '2026-10-01'))
  ) {
    manualAdjustmentActive = true
    manualAdjDelta = Number((manualAdjTargetKm - roadKmTotal).toFixed(1))
  }

  const finalRoadKmTotal = manualAdjustmentActive
    ? manualAdjTargetKm
    : Number(roadKmTotal.toFixed(1))
  const finalAfterApprovalKmTotal = manualAdjustmentActive
    ? manualAdjTargetKm
    : Number(afterApprovalKmTotal.toFixed(1))
  const finalKmPagamentoTotal = manualAdjustmentActive
    ? manualAdjTargetKm
    : Number(kmPagamentoTotal.toFixed(1))

  const motoConsumption = Number(settings?.consumption_kml) || 30.0
  const motoPrice = Number(settings?.fuel_price) || 6.49
  const combustivelPagamentoTotal = Number(
    ((finalKmPagamentoTotal / motoConsumption) * motoPrice).toFixed(2),
  )
  const combustivelViarioOficialTotal = Number(
    ((finalRoadKmTotal / motoConsumption) * motoPrice).toFixed(2),
  )

  return {
    roadKmTotal: finalRoadKmTotal,
    rawRoadKmBeforeAdjustment: Number(roadKmTotal.toFixed(1)),
    gpsKmTotal: Number(gpsKmTotal.toFixed(1)),
    afterApprovalKmTotal: finalAfterApprovalKmTotal,
    approvedItemsCount,
    autoApprovedCount,
    divergentPendingCount,
    redirectedCount,
    totalScopeCount,
    unreadableDateCount,
    batchCount: scopeBatches.size,
    hasManualAdjustment: manualAdjustmentActive,
    manualAdjDelta,
    manualAdjPeriodText,
    kmPagamentoTotal: finalKmPagamentoTotal,
    combustivelPagamentoTotal,
    combustivelViarioOficialTotal,
  }
}
