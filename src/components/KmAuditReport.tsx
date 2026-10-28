import React, { useState, useMemo, useEffect, useCallback } from 'react'
import pb from '@/lib/pocketbase/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import {
  MapPin,
  Compass,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Search,
  Filter,
  Route,
  Gauge,
  Clock,
  Calendar,
  Layers,
  Fuel,
  Info,
  Check,
  RotateCcw,
  Navigation as NavigationIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { deliveryService } from '@/services/deliveryService'
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
  deriveRouteBatchKey,
  getMergedRouteBatchKey,
  getRouteBatchDisplay,
  groupOrdersByRouteBatch,
} from '@/lib/routeBatchHelper'
import { haversineDistanceMeters } from '@/lib/geo'
import { MapDataService } from '@/lib/mapDataService'
import { compararKm, getLoteCanonico } from '@/utils/kmAudit'
import {
  FUEL_PAYMENT_FACTOR,
  isPostFuelPaymentCutoff,
} from '@/services/canonicalCourierTotalsService'
import {
  formatDateInTz,
  formatPbTimestamp,
  getCustomOperationalWindow,
  getOperationalMonthStart,
  getOperationalWindow,
  isCurrentMonthInTz,
  isOrderInPeriod,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import { AuditRouteMapModal } from '@/components/AuditRouteMapModal'

interface KmAuditReportProps {
  orders: OrderRecord[]
  fuelHistoryOrders?: OrderRecord[]
  couriers: UserRecord[]
  locations: LocationRecord[]
  offRouteEvents: OffRouteEventRecord[]
  settings: Partial<AppSettingsRecord> | null
  currentCompanyId?: string
  onDataChange?: () => void
}

export const KmAuditReport: React.FC<KmAuditReportProps> = ({
  orders,
  fuelHistoryOrders = [],
  couriers,
  locations,
  offRouteEvents,
  settings,
  currentCompanyId,
  onDataChange,
}) => {
  // Pedidos carregados sob demanda para auditoria multi-dia
  const [fetchedOrders, setFetchedOrders] = useState<OrderRecord[]>([])
  const [isLoadingPeriodOrders, setIsLoadingPeriodOrders] = useState<boolean>(false)

  // Filtros
  const [selectedCourierId, setSelectedCourierId] = useState<string>('all')
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('week')
  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  // Modo de exibição: 'pending_divergent' (apenas divergências pendentes),
  // 'auto_approved' (aprovados automaticamente sem divergência),
  // 'all' (padrão - todas as entregas)
  const [queueViewMode, setQueueViewMode] = useState<'pending_divergent' | 'auto_approved' | 'all'>(
    'all',
  )
  const [filterDeviationOnly, setFilterDeviationOnly] = useState<boolean>(false)
  const [filterRedirectedOnly, setFilterRedirectedOnly] = useState<boolean>(false)

  // Estado de aprovações
  const [approvals, setApprovals] = useState<RouteKmApprovalRecord[]>([])
  const [isLoadingApprovals, setIsLoadingApprovals] = useState<boolean>(false)
  const [batchTelemetryMap, setBatchTelemetryMap] = useState<
    Map<string, RouteBatchTelemetryRecord>
  >(new Map())

  // Modal de Aprovação / Ajuste de KM
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false)
  const [modalAction, setModalAction] = useState<'approve' | 'reject'>('approve')
  const [activeItem, setActiveItem] = useState<{
    orderId: string
    courierId: string
    trackingCode: string
    customerName: string
    address: string
    originalRoadKm: number
    originalGpsKm: number
    suggestedKm: number
    batchKey: string
    currentApproval?: RouteKmApprovalRecord
  } | null>(null)
  const [proposedKmInput, setProposedKmInput] = useState<string>('')
  const [justificationInput, setJustificationInput] = useState<string>('')
  const [isSavingApproval, setIsSavingApproval] = useState<boolean>(false)

  // Modal de Auditoria no Mapa (estilo Vuupt com Google Maps)
  const [isAuditMapModalOpen, setIsAuditMapModalOpen] = useState<boolean>(false)
  const [activeAuditMapData, setActiveAuditMapData] = useState<{
    batchKey: string
    batchDisplay?: string
    batchOrders: OrderRecord[]
    courier?: UserRecord
    divergenceKm?: number
    divergencePct?: number
  } | null>(null)

  // Carregar pedidos sob demanda quando o filtro for multi-dia (week, month, custom, all)
  const fetchPeriodOrders = useCallback(async () => {
    // Se o filtro for 'today', orders (de hoje) já atende perfeitamente
    if (selectedDateFilter === 'today') {
      return
    }

    // Se custom sem data definida, não buscar ainda
    if (selectedDateFilter === 'custom' && !customStartDate) {
      return
    }

    setIsLoadingPeriodOrders(true)
    try {
      let filterStr = ''
      const now = new Date()
      const opWindow = getOperationalWindow(now)

      if (selectedDateFilter === 'week') {
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        const isoStart = new Date(sevenDaysAgoStart)
          .toISOString()
          .replace('T', ' ')
          .substring(0, 19)
        filterStr = `status != 'cancelled' && (route_started = true || actual_arrival != null) && (created >= '${isoStart}' || route_started_at >= '${isoStart}' || route_finished_at >= '${isoStart}')`
      } else if (selectedDateFilter === 'month') {
        const monthStartObj = getOperationalMonthStart(now)
        const isoStart = new Date(monthStartObj.timestamp)
          .toISOString()
          .replace('T', ' ')
          .substring(0, 19)
        filterStr = `status != 'cancelled' && (route_started = true || actual_arrival != null) && (created >= '${isoStart}' || route_started_at >= '${isoStart}' || route_finished_at >= '${isoStart}')`
      } else if (selectedDateFilter === 'custom') {
        const custWin = getCustomOperationalWindow(
          customStartDate,
          customEndDate || customStartDate,
        )
        const isoStart = new Date(custWin.start).toISOString().replace('T', ' ').substring(0, 19)
        const isoEnd = new Date(custWin.end).toISOString().replace('T', ' ').substring(0, 19)
        filterStr = `status != 'cancelled' && (route_started = true || actual_arrival != null) && ((created >= '${isoStart}' && created <= '${isoEnd}') || (route_started_at >= '${isoStart}' && route_started_at <= '${isoEnd}') || (route_finished_at >= '${isoStart}' && route_finished_at <= '${isoEnd}'))`
      } else {
        filterStr = `status != 'cancelled' && (route_started = true || actual_arrival != null)`
      }

      const res = await deliveryService.getOrdersInBatches(
        filterStr,
        '-created',
        'customer_id,courier_id,seller_id',
        200,
        currentCompanyId && currentCompanyId !== 'ALL' ? currentCompanyId : undefined,
      )
      setFetchedOrders(res)
    } catch (err) {
      console.warn('Erro ao carregar pedidos sob demanda para Auditoria de KM:', err)
    } finally {
      setIsLoadingPeriodOrders(false)
    }
  }, [selectedDateFilter, customStartDate, customEndDate, currentCompanyId])

  useEffect(() => {
    fetchPeriodOrders()
  }, [fetchPeriodOrders])

  // Pool de pedidos consolidado: une orders (hoje), fuelHistoryOrders e fetchedOrders (sob demanda)
  const allOrdersPool = useMemo(() => {
    const map = new Map<string, OrderRecord>()
    // Prioridade decrescente: fetchedOrders > fuelHistoryOrders > orders
    orders.forEach((o) => {
      if (o && o.id) map.set(o.id, o)
    })
    fuelHistoryOrders.forEach((o) => {
      if (o && o.id) map.set(o.id, o)
    })
    fetchedOrders.forEach((o) => {
      if (o && o.id) map.set(o.id, o)
    })
    return Array.from(map.values())
  }, [orders, fuelHistoryOrders, fetchedOrders])

  const [manualAdjustments, setManualAdjustments] = useState<any[]>([])

  // Carregar aprovações do banco e recarregar dados do período
  const loadApprovals = async () => {
    setIsLoadingApprovals(true)
    try {
      let options: { startDate?: string; endDate?: string } | undefined
      const now = new Date()
      if (selectedDateFilter === 'today') {
        const opWindow = getOperationalWindow(now)
        options = { startDate: opWindow.startPbString, endDate: opWindow.endPbString }
      } else if (selectedDateFilter === 'month') {
        const monthStartObj = getOperationalMonthStart(now)
        options = { startDate: monthStartObj.pbString }
      } else if (selectedDateFilter === 'week') {
        const opWindow = getOperationalWindow(now)
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        options = { startDate: formatPbTimestamp(new Date(sevenDaysAgoStart)) }
      } else if (selectedDateFilter === 'custom' && customStartDate) {
        const customWindow = getCustomOperationalWindow(
          customStartDate,
          customEndDate || customStartDate,
        )
        options = {
          startDate: formatPbTimestamp(new Date(customWindow.start)),
          endDate: formatPbTimestamp(new Date(customWindow.end)),
        }
      }

      const data = await deliveryService.getRouteKmApprovals(currentCompanyId, options)
      setApprovals(data)
      await fetchPeriodOrders()

      // Carregar ajustes manuais vigentes
      try {
        const adjRecords = await pb.collection('courier_period_manual_adjustments').getFullList({
          filter: "status != 'inactive'",
          sort: '-created',
        })
        setManualAdjustments(adjRecords || [])
      } catch (errAdj) {
        console.warn('Aviso ao carregar courier_period_manual_adjustments:', errAdj)
      }

      // Buscar registros canônicos de telemetria da tabela route_batch_telemetry
      try {
        const canonicalTelemList = await deliveryService.listRouteBatchTelemetry()
        const telemMap = new Map<string, RouteBatchTelemetryRecord>()
        canonicalTelemList.forEach((rec) => {
          if (rec.route_batch_key) {
            telemMap.set(rec.route_batch_key, rec)
          }
          if (rec.id) {
            telemMap.set(rec.id, rec)
          }
        })
        setBatchTelemetryMap(telemMap)
      } catch (errTelem) {
        console.warn('Erro ao carregar route_batch_telemetry:', errTelem)
      }
    } catch (err) {
      console.warn('Erro ao carregar aprovações de KM:', err)
    } finally {
      setIsLoadingApprovals(false)
    }
  }

  useEffect(() => {
    loadApprovals()
  }, [currentCompanyId, selectedDateFilter, customStartDate, customEndDate])

  // Map de aprovações por order_id
  const approvalsMap = useMemo(() => {
    const map = new Map<string, RouteKmApprovalRecord>()
    approvals.forEach((appr) => {
      map.set(appr.order_id, appr)
    })
    return map
  }, [approvals])

  // Entregadores deduplicados elegíveis
  const eligibleCouriers = useMemo(() => {
    const seen = new Set<string>()
    return couriers.filter((c) => {
      if (!c.id || seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }, [couriers])

  // Lotes disponíveis para filtro
  const availableBatches = useMemo(() => {
    const setBatches = new Set<string>()
    const scopedOrders = allOrdersPool.filter(
      (o) => selectedCourierId === 'all' || o.courier_id === selectedCourierId,
    )
    const grouped = groupOrdersByRouteBatch(
      scopedOrders,
      selectedCourierId !== 'all' ? selectedCourierId : undefined,
    )
    grouped.forEach((bOrders) => {
      if (bOrders.length > 0) {
        setBatches.add(getRouteBatchDisplay(bOrders[0]))
      }
    })
    return Array.from(setBatches)
  }, [allOrdersPool, selectedCourierId])

  // Processamento linha por linha: cada pedido elegível gera uma linha do relatório de auditoria
  // com rateio viário oficial, KM GPS da telemetria, desvios e aprovação do admin
  const auditRows = useMemo(() => {
    // Agrupar pedidos por entregador para rodar o motor oficial com aprovações
    const rows: Array<{
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
    }> = []

    // Filtrar pedidos elegíveis ANTES de agrupar por entregador:
    // Excluir pedidos cancelados (status === 'cancelled') e pedidos com route_started === false sem chegada/visita registrada,
    // para que calculateCourierFuelMetrics e as linhas do relatório nunca os recebam.
    const eligibleOrdersPool = allOrdersPool.filter((ord) => {
      if (ord.status === 'cancelled') return false
      if (ord.route_started === false && !ord.actual_arrival) return false
      return true
    })

    // Agrupa pedidos por entregador a partir do pool filtrado
    const ordersByCourier = new Map<string, OrderRecord[]>()
    eligibleOrdersPool.forEach((ord) => {
      if (!ord.courier_id) return
      const list = ordersByCourier.get(ord.courier_id) || []
      list.push(ord)
      ordersByCourier.set(ord.courier_id, list)
    })

    // Construir map de aprovações para o motor oficial
    const motorApprovalsMap = new Map<
      string,
      { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
    >()
    approvals.forEach((appr) => {
      motorApprovalsMap.set(appr.order_id, {
        approvedKm: appr.approved_km,
        justification: appr.justification,
        status: appr.status,
      })
    })

    ordersByCourier.forEach((courierOrders, courierId) => {
      const courierObj = eligibleCouriers.find((c) => c.id === courierId)
      if (!courierObj) return

      // Derivação de lotes compartilhada com tolerância de 2 minutos calculada uma vez por entregador
      const courierBatchMap = groupOrdersByRouteBatch(courierOrders, courierId)
      const orderToBatchKey = new Map<string, string>()
      courierBatchMap.forEach((bOrders, key) => {
        bOrders.forEach((bo) => {
          orderToBatchKey.set(bo.id, key)
        })
      })

      // Rodar motor oficial para este entregador com lotes de telemetria canônica
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

      // Também rodar sem aprovações para saber o valor original do trajeto viário oficial
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

        // Identificação de lote com a derivação mesclada do motor (tolerância de 2 minutos)
        const bKey = orderToBatchKey.get(order.id) || `single_${order.id}`
        const batchDisplay = getRouteBatchDisplay(order)

        // REGRA DE TELEMETRIA CANÔNICA (MOTOR CANÔNICO DE TELEMETRIA - RODADA 2):
        // Buscar registro gravado em route_batch_telemetry pelo servidor
        const canonicalBatchTelem =
          batchTelemetryMap.get(bKey) ||
          (order.route_batch_key ? batchTelemetryMap.get(order.route_batch_key) : undefined) ||
          ((order as any).batch_telemetry_id
            ? batchTelemetryMap.get((order as any).batch_telemetry_id)
            : undefined)

        // Buscar eventos de telemetria específicos deste trecho / pedido
        const orderEvents = offRouteEvents.filter(
          (ev) => ev.courier_id === courierId && ev.order_id === order.id,
        )

        // Se não houver order_id nos eventos, associar por proximidade temporal com a rota da entrega
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
              // Distância entre parada e o cliente
              const cleanDest = MapDataService.getOrderDestination(order)
              if (cleanDest && ev.lat && ev.lng) {
                const stopDist = haversineDistanceMeters(
                  ev.lat,
                  ev.lng,
                  cleanDest.lat,
                  cleanDest.lng,
                )
                if (stopDist > maxStopDistMeters) maxStopDistMeters = Math.round(stopDist)
              }
            }
          }
        })

        const approval = approvalsMap.get(order.id)
        const roadKmOriginal = originalOrderMap.get(order.id) ?? calc.officialKm
        const officialAfterApprovalKm = calc.officialKm

        // Motor Canônico: GPS gravado no lote
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

        // Odômetro registrado no pedido ou lote
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

        // Indicador de desvio relevante para priorizar triagem:
        // - Desvio de rota > 500m
        // - Ou parada fora do local > 300m
        // - Ou discrepância entre viário e GPS > 2.0 km
        // - Ou entrega redirecionada iniciada ou pendente
        const isRedirected = Boolean(
          order.is_redirected ||
          order.redirection_status === 'initiated' ||
          order.redirection_status === 'completed' ||
          approval?.approval_type === 'redirection_auto' ||
          approval?.approval_type === 'redirection_manual',
        )
        const isRedirectionPending =
          order.redirection_status === 'initiated' ||
          approval?.status === 'pending' ||
          (isRedirected && !approval)

        const diffGpsRoad = Math.abs(canonicalGpsKm - roadKmOriginal)

        // REGRA DE TRIAGEM DE DIVERGÊNCIA SOLICITADA PELO USUÁRIO:
        // 1. Tolerância para ruído de arredondamento: 0.1 km
        // 2. Entrega conjunta secundária (isJointSecondary):
        //    - Viagem já inclusa na 1ª entrega (viário 0,0 por deduplicação).
        //    - Auto-aprovada automaticamente, fora da fila de divergência/decisão do admin.
        // 3. Entrega com divergência (avaliada estritamente no mesmo escopo: perna x perna via compararKm):
        const isJointSecondary = Boolean(calc.isJointSecondary)
        const pernaKmReal =
          typeof order.km_real_perna === 'number' &&
          Number.isFinite(order.km_real_perna) &&
          order.km_real_perna > 0
            ? order.km_real_perna
            : undefined

        let divergenciaInfo:
          | { valido: boolean; diferenca: number; alertaSanidade?: string }
          | undefined
        let hasKmDivergence = false

        if (!isJointSecondary && typeof pernaKmReal === 'number') {
          divergenciaInfo = compararKm('perna', roadKmOriginal, 'perna', pernaKmReal)
          if (divergenciaInfo.valido && divergenciaInfo.diferenca > 0.1001) {
            hasKmDivergence = true
          }
        }

        const isDivergent =
          !isJointSecondary &&
          (hasKmDivergence ||
            maxDevMeters >= 500 ||
            maxStopDistMeters >= 300 ||
            isRedirectionPending ||
            (isRedirected && (order.redirection_extra_km || 0) > 3.0))

        // Se NÃO há divergência e não há aprovação gravada como rejeitada/pendente:
        // É considerada aprovada automaticamente pelo motor!
        const isAutoApproved =
          isJointSecondary ||
          (!isDivergent &&
            (!approval ||
              approval.status === 'approved' ||
              approval.approval_type === 'redirection_auto'))

        // Requer decisão do admin: entrega com divergência que ainda não foi deliberada (sem aprovação ou status pendente)
        const isPendingDecision =
          !isJointSecondary && isDivergent && (!approval || approval.status === 'pending')

        const hasSignificantDeviation =
          maxDevMeters >= 500 ||
          maxStopDistMeters >= 300 ||
          (diffGpsRoad >= 2.0 && calc.totalGpsKm > 0) ||
          isRedirectionPending

        rows.push({
          order,
          courier: courierObj,
          trackingCode: order.tracking_code || order.id.slice(0, 8),
          customerName,
          address,
          dateStr,
          dateRaw,
          batchKey: bKey,
          batchDisplay,
          roadKm: roadKmOriginal,
          gpsKm: canonicalGpsKm,
          telemetryStatus: canonicalBatchTelem
            ? hasRelevantGaps
              ? 'insuficiente'
              : 'suficiente'
            : calc.telemetryStatus,
          telemetryPingsCount: canonicalPingsCount,
          hasRelevantGaps,
          canonicalBatchTelem,
          deviationMeters: maxDevMeters,
          deviationTimeStr: devTimeStr,
          offRoadEventsCount: offRouteCount,
          unexpectedStopsMeters: maxStopDistMeters,
          unexpectedStopsCount,
          isJointDelivery: Boolean(calc.isJointDelivery),
          isJointSecondary: Boolean(calc.isJointSecondary),
          statusBadge: order.status,
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

    // Ordenar decrescente por data/hora da rota
    return rows.sort((a, b) => new Date(b.dateRaw).getTime() - new Date(a.dateRaw).getTime())
  }, [
    allOrdersPool,
    eligibleCouriers,
    locations,
    offRouteEvents,
    settings,
    approvals,
    approvalsMap,
    batchTelemetryMap,
  ])

  // Resumos globais do escopo (calculados considerando filtros de entregador/data/lote/busca,
  // mantendo a visão completa da operação independente do toggle de fila)
  // REGRA DE AGREGAÇÃO ÚNICA POR LOTE: qualquer total agregado soma o km do lote UMA única vez,
  // dedup por route_batch_key (ou batchKey), usando o motor oficial e somando telemetria GPS 1x.
  const scopeSummary = useMemo(() => {
    let approvedItemsCount = 0
    let autoApprovedCount = 0
    let divergentPendingCount = 0
    let redirectedCount = 0
    let totalScopeCount = 0
    let unreadableDateCount = 0

    const now = new Date()
    const opWindow = getOperationalWindow(now)
    let customWindow: { start: number; end: number } | null = null
    if (selectedDateFilter === 'custom' && customStartDate) {
      customWindow = getCustomOperationalWindow(customStartDate, customEndDate || customStartDate)
    }

    // Filtrar primeiro as linhas elegíveis pelo escopo
    const inScopeRows: (typeof auditRows)[0][] = []

    auditRows.forEach((r) => {
      // Aplica apenas filtros dimensionais (entregador, data, lote, busca)
      if (selectedCourierId !== 'all' && r.order.courier_id !== selectedCourierId) return

      // Blindagem de data: se o timestamp for 0/NaN/não-positivo, registrar como ilegível e excluir
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
        selectedDateFilter === 'month'
      ) {
        if (!isOrderInPeriod(rowTs, selectedDateFilter as 'today' | 'week' | 'month', now)) return
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

    // Agrupar linhas em escopo por lote único para somar KM viário, GPS e pós-aprovação 1x por lote
    // Utiliza deriveRouteBatchKey diretamente para garantir integridade e unificação idêntica
    const scopeBatches = new Map<string, typeof inScopeRows>()
    inScopeRows.forEach((r) => {
      const bKey =
        r.batchKey || deriveRouteBatchKey(r.order, scopeBatches.keys(), r.order.courier_id)
      const list = scopeBatches.get(bKey) || []
      list.push(r)
      scopeBatches.set(bKey, list)
    })

    let roadKmTotal = 0
    let gpsKmTotal = 0
    let afterApprovalKmTotal = 0
    let kmPagamentoTotal = 0

    scopeBatches.forEach((batchRows) => {
      // KM viário original do lote contado 1x:
      // REGRA DO USUÁRIO (20/10): Prioridade canônica absoluta: km_viario_total do route_batch_telemetry
      // gravado para o lote (inclui volta 1x por lote), nunca soma de pernas sem retorno.
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

      // Após aprovação: se alguma linha tem aprovação manual, soma officialAfterApprovalKm das linhas;
      // senão, reflete o valor canônico viário do lote (1x)
      const hasManualApproval = batchRows.some((r) =>
        Boolean(r.approval && r.approval.status === 'approved'),
      )
      const bAfter = hasManualApproval
        ? batchRows.reduce((sum, r) => sum + r.officialAfterApprovalKm, 0)
        : bRoad

      // REGRA 26/10: Desconto de 15% no km para pagamento de combustível a partir de 26/10
      const earliestCreatedTs = batchRows.reduce((min, r) => {
        const t = r.dateRaw ? new Date(r.dateRaw).getTime() : 0
        return t > 0 && t < min ? t : min
      }, Number.MAX_SAFE_INTEGER)
      const isDiscountPostCutoff = isPostFuelPaymentCutoff(earliestCreatedTs)
      const bKmPagamento = isDiscountPostCutoff ? bRoad * FUEL_PAYMENT_FACTOR : bRoad

      // KM GPS SANEADO/AUDITADO DO LOTE 1x (Coluna B, estritamente para comparação/auditoria):
      let bGps = batchRows.reduce((max, r) => {
        const telemKm = r.canonicalBatchTelem ? r.canonicalBatchTelem.km_gps_total : 0
        return Math.max(max, telemKm || r.gpsKm || 0)
      }, 0)

      roadKmTotal += bRoad
      gpsKmTotal += bGps
      afterApprovalKmTotal += bAfter
      kmPagamentoTotal += bKmPagamento
    })

    // REGRA DO USUÁRIO (Ajuste Manual Edson / Período):
    // Se o filtro selecionado engloba o entregador Edson no período 01/10–22/10,
    // o KM Oficial Pago Viário = 731 km e deve exibir nota explícita "+285,1 km sobre a soma canônica dos lotes (445,9 km)".
    const isEdsonSelected =
      selectedCourierId === 'tetrfu5oi19jbwz' ||
      (selectedCourierId === 'all' &&
        eligibleCouriers.some((c) => c.name?.toLowerCase().includes('edson')))

    let manualAdjustmentActive = false
    let manualAdjTargetKm = 731.0
    let manualAdjDelta = 0
    let manualAdjPeriodText = '01/10–22/10'

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

    // Cálculo do combustível sobre km_pagamento (usando taxa canônica de moto: 30 km/L, R$ 6,49/L ou settings)
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
  }, [
    auditRows,
    selectedCourierId,
    selectedDateFilter,
    customStartDate,
    customEndDate,
    selectedBatchKey,
    searchQuery,
    eligibleCouriers,
  ])

  // Filtragem dos registros da tabela
  const filteredRows = useMemo(() => {
    const now = new Date()
    const opWindow = getOperationalWindow(now)
    let customWindow: { start: number; end: number } | null = null
    if (selectedDateFilter === 'custom' && customStartDate) {
      customWindow = getCustomOperationalWindow(customStartDate, customEndDate || customStartDate)
    }

    return auditRows.filter((r) => {
      // Filtro de entregador
      if (selectedCourierId !== 'all' && r.order.courier_id !== selectedCourierId) {
        return false
      }

      // Blindagem de data: se o timestamp for 0/NaN/não-positivo, excluir da janela
      const parsed = parseSafeTimestamp(r.dateRaw)
      const fallbackTs = r.dateRaw ? new Date(r.dateRaw).getTime() : 0
      const rowTs =
        parsed > 0 ? parsed : Number.isFinite(fallbackTs) && fallbackTs > 0 ? fallbackTs : 0

      if (!rowTs || rowTs <= 0) {
        return false
      }

      if (selectedDateFilter === 'custom' && customWindow) {
        if (rowTs < customWindow.start || rowTs > customWindow.end) return false
      } else if (
        selectedDateFilter === 'today' ||
        selectedDateFilter === 'week' ||
        selectedDateFilter === 'month'
      ) {
        if (!isOrderInPeriod(rowTs, selectedDateFilter as 'today' | 'week' | 'month', now))
          return false
      }

      // Filtro de lote
      if (selectedBatchKey !== 'all' && r.batchDisplay !== selectedBatchKey) {
        return false
      }

      // FILTRO PRINCIPAL DE FILA / TRIAGEM:
      // 'pending_divergent': Mostra apenas entregas COM divergência pendentes de decisão do admin (padrão)
      // 'auto_approved': Mostra apenas entregas sem divergência aprovadas automaticamente (sem botão)
      // 'all': Mostra todas as entregas do histórico
      if (queueViewMode === 'pending_divergent') {
        if (!r.isPendingDecision) return false
      } else if (queueViewMode === 'auto_approved') {
        if (!r.isAutoApproved) return false
      }

      // Filtro apenas desvios relevantes (>500m ou paradas fora do local)
      if (filterDeviationOnly && !r.hasSignificantDeviation) {
        return false
      }

      // Filtro apenas redirecionados
      if (filterRedirectedOnly && !r.isRedirected) {
        return false
      }

      // Filtro de busca textual
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchCust = r.customerName.toLowerCase().includes(q)
        const matchAddr = r.address.toLowerCase().includes(q)
        const matchTrk = r.trackingCode.toLowerCase().includes(q)
        const matchCourier = (r.courier?.name || '').toLowerCase().includes(q)
        if (!matchCust && !matchAddr && !matchTrk && !matchCourier) return false
      }

      return true
    })
  }, [
    auditRows,
    selectedCourierId,
    selectedDateFilter,
    customStartDate,
    customEndDate,
    selectedBatchKey,
    queueViewMode,
    filterDeviationOnly,
    filterRedirectedOnly,
    searchQuery,
  ])

  // Totais consolidados para o rodapé (Km Oficial Atual, Km GPS, Total Após Aprovações da tabela visível)
  // Regra de deduplicação por lote também para a tabela filtrada
  const totals = useMemo(() => {
    let approvedItemsCount = 0
    let rejectedItemsCount = 0
    let pendingReviewCount = 0
    let redirectedCount = 0

    filteredRows.forEach((r) => {
      if (r.isRedirected) redirectedCount++

      if (r.approval) {
        if (r.approval.status === 'approved') approvedItemsCount++
        else if (r.approval.status === 'rejected') rejectedItemsCount++
        else if (r.approval.status === 'pending') pendingReviewCount++
      } else if (r.isPendingDecision || r.hasSignificantDeviation || r.isRedirectionPending) {
        pendingReviewCount++
      }
    })

    const filteredBatches = new Map<string, typeof filteredRows>()
    filteredRows.forEach((r) => {
      const bKey =
        r.batchKey || deriveRouteBatchKey(r.order, filteredBatches.keys(), r.order.courier_id)
      const list = filteredBatches.get(bKey) || []
      list.push(r)
      filteredBatches.set(bKey, list)
    })

    let roadKmTotal = 0
    let gpsKmTotal = 0
    let afterApprovalKmTotal = 0

    filteredBatches.forEach((batchRows) => {
      // KM viário original do lote contado 1x:
      // REGRA DO USUÁRIO (20/10): Prioridade canônica absoluta: km_viario_total do route_batch_telemetry
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

      // Após aprovação: se alguma linha tem aprovação manual, soma officialAfterApprovalKm das linhas;
      // senão, reflete o valor canônico viário do lote (1x)
      const hasManualApproval = batchRows.some((r) =>
        Boolean(r.approval && r.approval.status === 'approved'),
      )
      const bAfter = hasManualApproval
        ? batchRows.reduce((sum, r) => sum + r.officialAfterApprovalKm, 0)
        : bRoad

      // KM GPS SANEADO DO LOTE 1x (Coluna B, estritamente para comparação/auditoria)
      let bGps = batchRows.reduce((max, r) => {
        const telemKm = r.canonicalBatchTelem ? r.canonicalBatchTelem.km_gps_total : 0
        return Math.max(max, telemKm || r.gpsKm || 0)
      }, 0)

      roadKmTotal += bRoad
      gpsKmTotal += bGps
      afterApprovalKmTotal += bAfter
    })

    const isEdsonInFiltered =
      selectedCourierId === 'tetrfu5oi19jbwz' ||
      (selectedCourierId === 'all' &&
        eligibleCouriers.some((c) => c.name?.toLowerCase().includes('edson')))

    let manualAdjustmentActive = false
    let manualAdjTargetKm = 731.0
    let manualAdjDelta = 0

    if (
      isEdsonInFiltered &&
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

    return {
      roadKmTotal: finalRoadKmTotal,
      rawRoadKmBeforeAdjustment: Number(roadKmTotal.toFixed(1)),
      gpsKmTotal: Number(gpsKmTotal.toFixed(1)),
      afterApprovalKmTotal: finalAfterApprovalKmTotal,
      approvedItemsCount,
      rejectedItemsCount,
      pendingReviewCount,
      redirectedCount,
      totalCount: filteredRows.length,
      hasManualAdjustment: manualAdjustmentActive,
      manualAdjDelta,
    }
  }, [
    filteredRows,
    selectedCourierId,
    eligibleCouriers,
    selectedDateFilter,
    customStartDate,
    customEndDate,
  ])

  // Abrir modal de aprovação / rejeição
  const handleOpenActionModal = (row: (typeof auditRows)[0], action: 'approve' | 'reject') => {
    setActiveItem({
      orderId: row.order.id,
      courierId: row.order.courier_id,
      trackingCode: row.trackingCode,
      customerName: row.customerName,
      address: row.address,
      originalRoadKm: row.roadKm,
      originalGpsKm: row.gpsKm,
      suggestedKm: row.gpsKm > 0 ? row.gpsKm : row.roadKm,
      batchKey: row.batchKey,
      currentApproval: row.approval,
    })
    setModalAction(action)
    setProposedKmInput(
      row.approval
        ? String(row.approval.approved_km)
        : action === 'approve'
          ? String(row.gpsKm > 0 ? row.gpsKm : row.roadKm)
          : String(row.roadKm),
    )
    setJustificationInput(row.approval?.justification || '')
    setIsModalOpen(true)
  }

  // Salvar aprovação no backend
  const handleSaveApproval = async () => {
    if (!activeItem) return
    const kmNum = parseFloat(proposedKmInput.replace(',', '.'))
    if (isNaN(kmNum) || kmNum < 0) {
      toast.error('Informe um valor de KM válido (maior ou igual a 0).')
      return
    }

    const justificationTrimmed = justificationInput.trim()

    setIsSavingApproval(true)
    try {
      const targetCompanyId =
        activeItem.currentApproval?.empresa_id ||
        (currentCompanyId && currentCompanyId !== 'ALL' ? currentCompanyId : undefined)

      await deliveryService.saveRouteKmApproval({
        orderId: activeItem.orderId,
        courierId: activeItem.courierId,
        empresaId: targetCompanyId,
        routeBatchKey: activeItem.batchKey,
        originalRoadKm: activeItem.originalRoadKm,
        originalGpsKm: activeItem.originalGpsKm,
        approvedKm: modalAction === 'approve' ? kmNum : activeItem.originalRoadKm,
        status: modalAction === 'approve' ? 'approved' : 'rejected',
        justification: justificationTrimmed,
      })

      toast.success(
        modalAction === 'approve'
          ? `KM do trecho aprovado com sucesso! O cálculo oficial e combustível foram atualizados.`
          : 'Desvio rejeitado. O KM viário original prevalece no cálculo oficial.',
      )

      setIsModalOpen(false)
      await loadApprovals()
      onDataChange?.()
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.data?.message ||
        err?.message ||
        'Falha ao salvar decisão de aprovação de KM.'
      toast.error(msg)
    } finally {
      setIsSavingApproval(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* CABEÇALHO COM TÍTULO E AÇÕES */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Route className="h-6 w-6 text-[#0052CC]" />
              Relatório de Auditoria de KM por Entrega
            </h3>
            <Badge
              variant="outline"
              className="border-blue-400 bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300 text-xs font-bold"
            >
              Auditoria &amp; Recálculo Oficial
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Compare o <strong>KM viário oficial</strong> vs. <strong>KM GPS telemetria</strong> por
            cliente/entrega. Aprovações do administrador substituem o trecho no cálculo oficial de
            KM e combustível.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={loadApprovals}
            disabled={isLoadingApprovals || isLoadingPeriodOrders}
            className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[#00A3FF] ${isLoadingApprovals || isLoadingPeriodOrders ? 'animate-spin' : ''}`}
            />
            Atualizar Dados
          </Button>
        </div>
      </div>

      {/* AVISO DE ENTREGAS COM DATA ILEGÍVEL OU FORA DE FORMATO */}
      {scopeSummary.unreadableDateCount > 0 && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl flex items-center justify-between text-xs text-amber-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <span>
              <strong>Atenção:</strong> {scopeSummary.unreadableDateCount} entrega(s) com data
              ilegível aguardando correção foram desconsideradas das janelas de auditoria.
            </span>
          </div>
          <Badge
            variant="outline"
            className="border-amber-300 bg-amber-100 text-amber-900 font-mono text-[10px]"
          >
            {scopeSummary.unreadableDateCount} excluída(s)
          </Badge>
        </div>
      )}

      {/* BANNER INDICADOR DE CARREGAMENTO SOB DEMANDA */}
      {isLoadingPeriodOrders && (
        <div className="p-2.5 bg-blue-50 border border-blue-200 rounded-xl flex items-center gap-2 text-xs text-blue-700 animate-pulse">
          <RefreshCw className="h-3.5 w-3.5 animate-spin text-blue-600 shrink-0" />
          <span>Sincronizando entregas históricas do período selecionado sob demanda...</span>
        </div>
      )}

      {/* CARD DESTAQUE EXCLUSIVO ADMIN: KM PAGAMENTO DE COMBUSTÍVEL (-15% APÓS 26/10) */}
      <Card className="border-emerald-300 border-l-4 border-l-emerald-500 bg-gradient-to-r from-emerald-50/70 via-white to-emerald-50/40 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 border border-emerald-300 shrink-0">
                <Fuel className="h-5 w-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                    KM Pagamento de Combustível
                  </span>
                  <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[9px] px-1.5 py-0 font-bold uppercase">
                    Admin • -15% após 26/10
                  </Badge>
                </div>
                <p className="text-[11px] text-slate-600 mt-0.5">
                  Base canônica para reembolso de combustível. Pedidos criados a partir de 26/10
                  aplicam desconto de 15% sobre o KM viário.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 sm:gap-6 bg-white p-2.5 px-4 rounded-xl border border-emerald-200 shadow-xs self-start sm:self-center">
              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                  KM Pagamento
                </span>
                <div className="flex items-baseline gap-1">
                  <span className="text-xl sm:text-2xl font-black font-mono text-emerald-700">
                    {scopeSummary.kmPagamentoTotal.toFixed(1)}
                  </span>
                  <span className="text-xs text-slate-500 font-semibold">km</span>
                </div>
              </div>

              <div className="h-8 w-px bg-slate-200" />

              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                  Combustível Pagamento
                </span>
                <span className="text-xl sm:text-2xl font-black font-mono text-slate-900">
                  R$ {scopeSummary.combustivelPagamentoTotal.toFixed(2)}
                </span>
              </div>

              <div className="h-8 w-px bg-slate-200" />

              <div>
                <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                  Viário Oficial (Sem Desconto)
                </span>
                <span className="text-xs font-mono text-slate-600">
                  {scopeSummary.roadKmTotal.toFixed(1)} km • R${' '}
                  {scopeSummary.combustivelViarioOficialTotal.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* CARDS DE RESUMO RÁPIDO DO RELATÓRIO (MANTÉM VISÃO GLOBAL DO ESCOPO SELECIONADO) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-slate-200 border-l-4 border-l-[#0052CC] bg-white shadow-sm">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
                KM Oficial Pago (Viário)
              </span>
              {scopeSummary.hasManualAdjustment && (
                <Badge className="bg-amber-100 text-amber-900 border-amber-300 text-[10px] font-bold px-1.5 py-0">
                  Ajuste manual aplicado ({scopeSummary.manualAdjPeriodText})
                </Badge>
              )}
            </div>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-slate-900 dark:text-white">
                {scopeSummary.roadKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            {scopeSummary.hasManualAdjustment ? (
              <p className="text-[11px] text-amber-700 font-medium mt-0.5">
                Ajuste manual: +{scopeSummary.manualAdjDelta.toFixed(1)} km sobre a soma canônica
                dos lotes ({scopeSummary.rawRoadKmBeforeAdjustment?.toFixed(1)} km)
              </p>
            ) : (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {scopeSummary.batchCount} {scopeSummary.batchCount === 1 ? 'rota' : 'rotas'} ·{' '}
                {scopeSummary.totalScopeCount}{' '}
                {scopeSummary.totalScopeCount === 1 ? 'entrega' : 'entregas'}
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-purple-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              KM GPS Telemetria Saneada
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-purple-700 dark:text-purple-300">
                {scopeSummary.gpsKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Telemetria auditada e saneada (sem ruídos fantasma)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-emerald-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Oficial Após Aprovações
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {scopeSummary.afterApprovalKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            <p className="text-[11px] text-emerald-700 font-medium mt-0.5">
              {scopeSummary.autoApprovedCount} auto-aprovadas • {scopeSummary.approvedItemsCount}{' '}
              deliberadas
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-amber-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Divergências p/ Decisão
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-amber-600">
                {scopeSummary.divergentPendingCount}
              </span>
              <span className="text-xs text-slate-500 font-semibold">pendentes</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {scopeSummary.redirectedCount} redireções | Viário ≠ GPS
            </p>
          </CardContent>
        </Card>
      </div>

      {/* BARRA DE FILTROS */}
      <Card className="border-slate-200/80 shadow-xs">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-3">
            {/* Filtro Entregador */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Entregador</Label>
              <Select value={selectedCourierId} onValueChange={setSelectedCourierId}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos os entregadores" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">🛵 Todos os Entregadores</SelectItem>
                  {eligibleCouriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Filtro Data */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Período / Data</Label>
              <Select value={selectedDateFilter} onValueChange={setSelectedDateFilter}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Selecione o período" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="today">☀️ Hoje</SelectItem>
                  <SelectItem value="week">🗓️ Últimos 7 dias</SelectItem>
                  <SelectItem value="month">📅 Este Mês</SelectItem>
                  <SelectItem value="custom">🔍 Personalizado (De – Até)</SelectItem>
                  <SelectItem value="all">🌐 Todo o Histórico</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campo Data Específica (Intervalo De - Até) */}
            {selectedDateFilter === 'custom' && (
              <div className="flex items-center gap-2">
                <div className="space-y-1 flex-1">
                  <Label className="text-xs font-semibold text-slate-600">De</Label>
                  <Input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
                <div className="space-y-1 flex-1">
                  <Label className="text-xs font-semibold text-slate-600">Até</Label>
                  <Input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="h-9 text-xs font-mono"
                  />
                </div>
              </div>
            )}

            {/* Filtro Lote de Rota */}
            <div className="space-y-1">
              <Label className="text-xs font-semibold text-slate-600">Lote de Rota</Label>
              <Select value={selectedBatchKey} onValueChange={setSelectedBatchKey}>
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Todos os lotes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">📦 Todos os Lotes</SelectItem>
                  {availableBatches.map((b) => (
                    <SelectItem key={b} value={b}>
                      {b}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Busca Rápida */}
            <div className="space-y-1 sm:col-span-2 md:col-span-1">
              <Label className="text-xs font-semibold text-slate-600">Buscar</Label>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
                <Input
                  type="text"
                  placeholder="Cliente, endereço, rastreio..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 pl-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* SELETORES DE FILA / TRIAGEM E AUDITORIA */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            {/* Abas da Fila de Decisão */}
            <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1 rounded-lg border border-slate-200/80">
              <button
                type="button"
                onClick={() => setQueueViewMode('pending_divergent')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  queueViewMode === 'pending_divergent'
                    ? 'bg-white text-amber-900 shadow-xs border border-amber-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <AlertTriangle
                  className={`h-3.5 w-3.5 ${queueViewMode === 'pending_divergent' ? 'text-amber-600' : 'text-slate-400'}`}
                />
                <span>Com Divergência (Decisão Admin)</span>
                {scopeSummary.divergentPendingCount > 0 && (
                  <Badge className="bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4 font-mono font-bold">
                    {scopeSummary.divergentPendingCount}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => setQueueViewMode('auto_approved')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  queueViewMode === 'auto_approved'
                    ? 'bg-white text-emerald-900 shadow-xs border border-emerald-200'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <CheckCircle2
                  className={`h-3.5 w-3.5 ${queueViewMode === 'auto_approved' ? 'text-emerald-600' : 'text-slate-400'}`}
                />
                <span>Aprovados Automaticamente</span>
                {scopeSummary.autoApprovedCount > 0 && (
                  <Badge className="bg-emerald-600 text-white text-[10px] px-1.5 py-0 h-4 font-mono font-bold">
                    {scopeSummary.autoApprovedCount}
                  </Badge>
                )}
              </button>

              <button
                type="button"
                onClick={() => setQueueViewMode('all')}
                className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold transition-all ${
                  queueViewMode === 'all'
                    ? 'bg-white text-slate-900 shadow-xs border border-slate-300'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Layers
                  className={`h-3.5 w-3.5 ${queueViewMode === 'all' ? 'text-[#0052CC]' : 'text-slate-400'}`}
                />
                <span>Todas as Entregas</span>
                <span className="text-[10px] font-mono text-slate-400 font-semibold">
                  ({scopeSummary.totalScopeCount})
                </span>
              </button>
            </div>

            {/* Toggles complementares */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setFilterDeviationOnly(!filterDeviationOnly)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-all ${
                  filterDeviationOnly
                    ? 'bg-amber-100 border-amber-300 text-amber-900 font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <AlertTriangle
                  className={`h-3 w-3 ${filterDeviationOnly ? 'text-amber-600' : 'text-slate-400'}`}
                />
                <span>Desvios &gt;500m</span>
              </button>

              <button
                type="button"
                onClick={() => setFilterRedirectedOnly(!filterRedirectedOnly)}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border font-semibold transition-all ${
                  filterRedirectedOnly
                    ? 'bg-blue-100 border-blue-300 text-blue-900 font-bold shadow-xs'
                    : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                <Compass
                  className={`h-3 w-3 ${filterRedirectedOnly ? 'text-blue-600' : 'text-slate-400'}`}
                />
                <span>Redirecionadas</span>
                {scopeSummary.redirectedCount > 0 && (
                  <Badge className="ml-0.5 bg-[#0052CC] text-white text-[9px] px-1 py-0 h-3.5">
                    {scopeSummary.redirectedCount}
                  </Badge>
                )}
              </button>

              <span className="text-slate-400 text-[11px] ml-1">
                Exibindo <strong>{filteredRows.length}</strong> de {auditRows.length}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* TABELA DE AUDITORIA COM AS COLUNAS EXATAS PEDIDAS */}
      <Card className="border-slate-200/80 shadow-sm overflow-hidden">
        <CardHeader className="p-4 pb-3 border-b bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
              <Layers className="h-4 w-4 text-[#0052CC]" />
              Auditoria de KM por Entrega &amp; Decisões do Administrador
            </CardTitle>
            <CardDescription className="text-xs">
              Valores oficiais viários e aprovações de telemetria refletem imediatamente no cálculo
              de combustível.
            </CardDescription>
          </div>
        </CardHeader>

        {/* SEÇÃO SEPARADA [LOTE COMPLETO]: Total viário do lote x GPS do lote usando getLoteCanonico */}
        <div className="p-4 border-b border-slate-200 bg-slate-50/70">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Badge className="bg-[#0052CC] text-white font-bold text-xs uppercase px-2 py-0.5">
                [Lote Completo]
              </Badge>
              <h4 className="text-xs font-bold text-slate-800">
                Reconciliação Canônica por Lote de Rota (Viário Total 1x × GPS da Janela)
              </h4>
            </div>
            <span className="text-[11px] text-slate-500 font-medium">
              Comparação no mesmo escopo (lote × lote) via <code>getLoteCanonico()</code>
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from(
              auditRows.reduce((acc, r) => {
                const bKey = r.batchKey || 'lote_avulso'
                if (!acc.has(bKey)) acc.set(bKey, [])
                acc.get(bKey)!.push(r)
                return acc
              }, new Map<string, typeof auditRows>()),
            )
              .slice(0, 6)
              .map(([bKey, bRows]) => {
                const batchOrders = bRows.map((r) => r.order)
                const loteCanonico = getLoteCanonico(batchOrders)
                // Maior GPS entre as ordens do lote
                const maxGps = bRows.reduce((max, r) => Math.max(max, r.gpsKm || 0), 0)
                const loteComp = compararKm('lote', loteCanonico, 'lote', maxGps)
                const courierName = bRows[0].courier?.name || 'Entregador'

                return (
                  <div
                    key={bKey}
                    className="p-3 bg-white rounded-lg border border-slate-200 shadow-xs space-y-2 text-xs"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-900 truncate max-w-[140px]">
                        {courierName}
                      </span>
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {bRows[0].batchDisplay || bKey.slice(0, 10)}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div className="bg-blue-50/50 p-1.5 rounded border border-blue-100">
                        <span className="text-[10px] text-slate-500 block">
                          KM Oficial Pago (Lote 1x)
                        </span>
                        <strong className="text-blue-900 text-xs">
                          {loteCanonico.toFixed(1)} km
                        </strong>
                      </div>
                      <div className="bg-purple-50/50 p-1.5 rounded border border-purple-100">
                        <span className="text-[10px] text-purple-700 block">
                          GPS Lote (Auditoria)
                        </span>
                        <strong className="text-purple-900 text-xs">
                          {maxGps > 0 ? `${maxGps.toFixed(1)} km` : '—'}
                        </strong>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-[10px]">
                      <span className="text-slate-500">{bRows.length} entregas</span>
                      {maxGps > 0 && loteComp.valido && (
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`font-mono font-bold ${
                              loteComp.diferenca <= 0.5
                                ? 'text-emerald-600'
                                : loteComp.diferenca <= 2.0
                                  ? 'text-amber-600'
                                  : 'text-rose-600'
                            }`}
                          >
                            Divergência: {loteComp.diferenca.toFixed(1)} km
                          </span>
                          {/* Se desvio > 20% no lote completo, exibir botão Ver no mapa */}
                          {loteCanonico > 0 &&
                            Math.round((loteComp.diferenca / loteCanonico) * 100) > 20 && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                  const batchPct = Math.round(
                                    (loteComp.diferenca / loteCanonico) * 100,
                                  )
                                  setActiveAuditMapData({
                                    batchKey: bKey,
                                    batchDisplay: bRows[0].batchDisplay,
                                    batchOrders,
                                    courier: bRows[0].courier,
                                    divergenceKm: loteComp.diferenca,
                                    divergencePct: batchPct,
                                  })
                                  setIsAuditMapModalOpen(true)
                                }}
                                className="h-5 px-1.5 text-[9px] font-bold text-[#0052CC] border-blue-200 bg-blue-50/70 hover:bg-blue-100 gap-1"
                              >
                                <Route className="h-2.5 w-2.5 text-[#0052CC]" />
                                Ver no mapa
                              </Button>
                            )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
          </div>
        </div>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 uppercase tracking-wider text-[11px] font-bold select-none">
                  <th className="py-3 px-4">a) Cliente / Endereço</th>
                  <th className="py-3 px-3 text-center">Coluna A: KM Oficial Pago (Viário)</th>
                  <th className="py-3 px-3 text-center">Coluna B: GPS Telemetria (Auditoria)</th>
                  <th className="py-3 px-3 text-center">Desvio %</th>
                  <th className="py-3 px-3 text-center">Parada Fora do Local</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-400">
                      {queueViewMode === 'pending_divergent' ? (
                        <>
                          <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-500 mb-2" />
                          <p className="font-semibold text-slate-800 dark:text-slate-100">
                            Nenhuma divergência para decidir — todas auto-aprovadas
                          </p>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 max-w-md mx-auto">
                            Todas as entregas do período estão com o trajeto viário em conformidade
                            ou foram previamente aprovadas.
                          </p>
                        </>
                      ) : (
                        <>
                          <Route className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                          <p className="font-semibold text-slate-600">
                            Nenhuma entrega encontrada para os filtros selecionados.
                          </p>
                          <p className="text-[11px] text-slate-400 mt-0.5">
                            Tente ajustar os filtros de entregador, data ou desvios relevantes.
                          </p>
                        </>
                      )}
                    </td>
                  </tr>
                ) : (
                  filteredRows.map((row) => {
                    const isApproved = row.approval?.status === 'approved'
                    const isRejected = row.approval?.status === 'rejected'

                    return (
                      <tr
                        key={row.order.id}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          row.hasSignificantDeviation && !row.approval
                            ? 'bg-amber-50/40'
                            : isApproved
                              ? 'bg-emerald-50/20'
                              : ''
                        }`}
                      >
                        {/* Coluna a: Cliente + Endereço */}
                        <td className="py-3 px-4 align-top max-w-xs">
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className="font-bold text-slate-900 dark:text-white">
                                {row.customerName}
                              </span>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 font-mono text-slate-500 border-slate-200"
                              >
                                {row.trackingCode}
                              </Badge>
                              {row.isRedirected && (
                                <Badge className="bg-amber-500 text-slate-950 font-bold text-[9px] px-1.5 py-0 flex items-center gap-1">
                                  <Compass className="h-2.5 w-2.5" />
                                  Endereço Redirecionado
                                </Badge>
                              )}
                              {row.order.redirection_status === 'initiated' && (
                                <Badge className="bg-rose-500 text-white font-bold text-[9px] px-1.5 py-0">
                                  Redireção Iniciada (Pendente)
                                </Badge>
                              )}
                              {row.isJointDelivery && (
                                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[9px] px-1 py-0 font-semibold">
                                  {row.isJointSecondary
                                    ? 'Entrega Conjunta (2ª)'
                                    : 'Entrega Conjunta (1ª)'}
                                </Badge>
                              )}
                            </div>

                            {/* Endereço Original e Novo Endereço */}
                            <p className="text-[11px] text-slate-500 flex items-start gap-1 leading-relaxed">
                              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-2">{row.address}</span>
                            </p>

                            {row.isRedirected &&
                              (row.order.redirection_new_address || row.approval?.new_address) && (
                                <div className="p-1.5 rounded bg-amber-50 border border-amber-200 text-[10px] text-amber-900 space-y-0.5">
                                  <span className="font-bold block flex items-center gap-1">
                                    <NavigationIcon className="h-3 w-3 text-amber-700" />
                                    Novo Endereço (Ponto B):
                                  </span>
                                  <span className="line-clamp-2">
                                    {row.order.redirection_new_address || row.approval?.new_address}
                                  </span>
                                  {row.order.customer_address_updated && (
                                    <span className="text-[9px] text-emerald-700 font-semibold block">
                                      ✓ Cadastro oficial do cliente atualizado
                                    </span>
                                  )}
                                </div>
                              )}

                            <div className="flex items-center gap-2 text-[10px] text-slate-400">
                              <span>🛵 {row.courier?.name || 'Entregador'}</span>
                              <span>•</span>
                              <span>📅 {row.dateStr}</span>
                              <span>•</span>
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 text-slate-500"
                              >
                                {row.batchDisplay}
                              </Badge>
                            </div>
                          </div>
                        </td>

                        {/* Coluna A: KM Oficial Pago (Viário) */}
                        <td className="py-3 px-3 align-top text-center">
                          <div className="space-y-0.5">
                            <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                              {row.roadKm.toFixed(1)} km
                            </span>
                            <div className="flex items-center justify-center gap-1">
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1 py-0 font-mono text-slate-600 border-slate-200 bg-slate-50"
                              >
                                {row.order.calculation_source === 'google'
                                  ? 'Google'
                                  : row.order.calculation_source === 'osrm'
                                    ? 'OSRM'
                                    : 'Estimada 1.3x'}
                              </Badge>
                            </div>
                            {row.isJointSecondary && (
                              <span className="text-[9px] text-indigo-600 block font-semibold">
                                Rateio: 0.0 km (Viagem já inclusa)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Coluna B: GPS Telemetria - Exclusivo Auditoria (MOTOR CANÔNICO DE TELEMETRIA) */}
                        {/* REGRA OBRIGATÓRIA: */}
                        {/* Exibir km_gps_total gravado pelo motor para o lote; NUNCA copiar Coluna A. GPS é exclusivamente auditoria. */}
                        {/* Julgamento de suficiência usa o fluxo deduplicado e rotula claramente se houver lacunas reais. */}
                        <td className="py-3 px-3 align-top text-center">
                          <div className="space-y-0.5">
                            {(() => {
                              const hasBatchGps = typeof row.gpsKm === 'number' && row.gpsKm > 0
                              const pings = row.telemetryPingsCount || 0
                              const isAbundantPings = pings >= 15

                              // Se tem lacunas relevantes gravadas pelo motor
                              if (row.hasRelevantGaps) {
                                const gapsList = row.canonicalBatchTelem?.telemetry_gaps || []
                                const totalGapSecs =
                                  row.canonicalBatchTelem?.gaps_total_seconds || 0
                                const maxGapMins =
                                  totalGapSecs > 0
                                    ? Math.round(totalGapSecs / 60)
                                    : gapsList.length > 0
                                      ? Math.round(
                                          Math.max(
                                            ...gapsList.map(
                                              (g: any) =>
                                                g.duration_minutes ||
                                                (g.duration_seconds ? g.duration_seconds / 60 : 0),
                                            ),
                                          ),
                                        )
                                      : 0

                                return (
                                  <div className="space-y-0.5">
                                    <div className="flex items-center justify-center gap-1">
                                      <span className="font-mono text-sm font-bold text-amber-600">
                                        {hasBatchGps ? `${row.gpsKm.toFixed(2)} km` : '—'}
                                      </span>
                                    </div>
                                    <span className="text-[9px] text-amber-700 font-semibold block">
                                      {maxGapMins > 0
                                        ? `telemetria com lacunas (${maxGapMins} min sem sinal)`
                                        : `telemetria com lacunas (${row.canonicalBatchTelem?.gaps_count || 'várias'})`}
                                    </span>
                                  </div>
                                )
                              }

                              if (hasBatchGps) {
                                return (
                                  <div className="flex items-center justify-center gap-1">
                                    <span className="font-mono text-sm font-black text-purple-700 dark:text-purple-300">
                                      {row.gpsKm.toFixed(2)} km
                                    </span>
                                    <Badge
                                      variant="outline"
                                      className="text-[9px] px-1 py-0 font-bold border-purple-300 text-purple-700 bg-purple-50"
                                      title="Telemetria GPS exclusivamente para fins de auditoria"
                                    >
                                      GPS Auditoria
                                    </Badge>
                                  </div>
                                )
                              }

                              if (!isAbundantPings) {
                                return (
                                  <div className="space-y-0.5">
                                    <span className="font-mono text-sm font-bold text-slate-400">
                                      —
                                    </span>
                                    <span className="text-[9px] text-slate-400 block">
                                      sem telemetria suficiente ({pings} pings)
                                    </span>
                                  </div>
                                )
                              }

                              return (
                                <div className="space-y-0.5">
                                  <span className="font-mono text-sm font-bold text-slate-400">
                                    —
                                  </span>
                                  <span className="text-[9px] text-slate-400 block">
                                    aguardando telemetria ({pings} pings)
                                  </span>
                                </div>
                              )
                            })()}
                            <span className="text-[9px] text-slate-400 block">{row.dateStr}</span>
                          </div>
                        </td>

                        {/* Desvio %: Badge verde/neutro se ≤20%, vermelho com alerta se >20% */}
                        <td className="py-3 px-3 align-top text-center">
                          {(() => {
                            // Regra canônica oficial: badge "+N% desvio", divergência em km e botão
                            // "Ver no mapa" SÓ quando row.canonicalBatchTelem existir e tiver
                            // km_gps_total > 0; caso nulo/em processamento, estado neutro
                            // "Aguardando telemetria" — zero números fictícios.
                            const hasCanonicalTelem =
                              !!row.canonicalBatchTelem &&
                              typeof row.canonicalBatchTelem.km_gps_total === 'number' &&
                              row.canonicalBatchTelem.km_gps_total > 0

                            if (!hasCanonicalTelem) {
                              return (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-slate-500 bg-slate-50 border-slate-200"
                                >
                                  Aguardando telemetria
                                </Badge>
                              )
                            }

                            const batchGpsKm = row.canonicalBatchTelem!.km_gps_total!
                            const batchRoadKm =
                              row.canonicalBatchTelem!.km_viario_total !== undefined
                                ? row.canonicalBatchTelem!.km_viario_total!
                                : (row.roadKm ?? 0)

                            if (batchRoadKm <= 0) {
                              return (
                                <Badge
                                  variant="outline"
                                  className="text-[10px] text-slate-400 border-slate-200"
                                >
                                  Em conformidade
                                </Badge>
                              )
                            }

                            const diffPct = Math.round(
                              (Math.abs(batchGpsKm - batchRoadKm) / batchRoadKm) * 100,
                            )
                            const isWithinTolerance = diffPct <= 20

                            const isProcessed =
                              row.canonicalBatchTelem &&
                              row.canonicalBatchTelem.status === 'processed'

                            return (
                              <div className="space-y-1">
                                {isProcessed ? (
                                  <>
                                    <Badge
                                      className={`text-[10px] font-bold ${
                                        isWithinTolerance
                                          ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                          : 'bg-rose-100 text-rose-800 border-rose-300'
                                      }`}
                                    >
                                      {isWithinTolerance ? '✓ ' : '🚨 '}+{diffPct}% desvio
                                    </Badge>

                                    <span className="text-[10px] font-mono text-slate-500 block">
                                      div: {Math.abs(batchGpsKm - batchRoadKm).toFixed(1)} km
                                    </span>
                                  </>
                                ) : (
                                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                                    Aguardando Processamento
                                  </Badge>
                                )}

                                <div className="flex flex-col items-center justify-center gap-1 pt-0.5">
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                      const effectiveBatchKey =
                                        row.canonicalBatchTelem?.route_batch_key ||
                                        row.order.route_batch_key ||
                                        row.batchKey ||
                                        `single_${row.order.id}`

                                      // Buscar pedidos estritamente pelo route_batch_key do lote selecionado
                                      const batchOrders = allOrdersPool.filter((o) => {
                                        if (effectiveBatchKey && o.route_batch_key) {
                                          return o.route_batch_key === effectiveBatchKey
                                        }
                                        if (row.order.route_batch_key && o.route_batch_key) {
                                          return o.route_batch_key === row.order.route_batch_key
                                        }
                                        return o.id === row.order.id
                                      })

                                      setActiveAuditMapData({
                                        batchKey: effectiveBatchKey,
                                        batchDisplay: row.batchDisplay,
                                        batchOrders:
                                          batchOrders.length > 0 ? batchOrders : [row.order],
                                        courier: row.courier,
                                        divergenceKm: Math.abs(batchGpsKm - batchRoadKm),
                                        divergencePct: diffPct,
                                      })
                                      setIsAuditMapModalOpen(true)
                                    }}
                                    className="h-5 px-2 text-[10px] font-bold text-[#0052CC] border-blue-200 bg-blue-50/80 hover:bg-blue-100 shadow-2xs gap-1"
                                  >
                                    <Route className="h-3 w-3 text-[#0052CC]" />
                                    Ver no mapa
                                  </Button>

                                  {!isWithinTolerance && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => handleOpenActionModal(row, 'approve')}
                                      className="h-4 px-1 text-[9px] text-rose-700 hover:bg-rose-50 underline"
                                    >
                                      Exceção admin
                                    </Button>
                                  )}
                                </div>
                              </div>
                            )
                          })()}
                        </td>

                        {/* Coluna e: Parada Fora do Local */}
                        <td className="py-3 px-3 align-top text-center">
                          {row.unexpectedStopsCount > 0 ? (
                            <div className="space-y-0.5">
                              <Badge className="bg-amber-100 text-amber-800 border-amber-300 text-[10px] font-bold">
                                🛑 {row.unexpectedStopsCount} parada(s)
                              </Badge>
                              {row.unexpectedStopsMeters > 0 && (
                                <span className="text-[10px] text-amber-700 font-mono block">
                                  a {row.unexpectedStopsMeters}m do pin
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-400">-</span>
                          )}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* RODAPÉ RESUMO: KM OFICIAL ATUAL, KM GPS SOMADO E TOTAL APÓS APROVAÇÕES */}
          <div className="p-4 bg-slate-50/90 border-t border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-100 text-[#0052CC] shrink-0">
                <Gauge className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Resumo Geral da Tabela Filtrada ({totals.totalCount} Entregas)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Regra de ouro: o trajeto viário prevalece. Apenas trechos explicitamente aprovados
                  pelo admin entram como substituição.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="bg-white px-3 py-1.5 rounded-lg border border-slate-200">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">
                  KM Oficial Atual (Coluna A)
                </span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {totals.roadKmTotal.toFixed(1)} km
                </span>
                {totals.hasManualAdjustment && (
                  <span className="block text-[9px] text-amber-700 font-semibold">
                    (Ajuste manual: +{totals.manualAdjDelta?.toFixed(1)} km)
                  </span>
                )}
              </div>

              <div className="bg-white px-3 py-1.5 rounded-lg border border-purple-200">
                <span className="text-[10px] text-purple-600 block uppercase font-bold">
                  KM GPS Somado
                </span>
                <span className="font-mono font-bold text-purple-700 text-sm">
                  {totals.gpsKmTotal.toFixed(1)} km
                </span>
              </div>

              <div className="bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-300">
                <span className="text-[10px] text-emerald-700 block uppercase font-bold">
                  Total Após Aprovações
                </span>
                <span className="font-mono font-black text-emerald-800 text-base">
                  {totals.afterApprovalKmTotal.toFixed(1)} km
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* MODAL DE APROVAÇÃO / REJEIÇÃO COM JUSTIFICATIVA */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
              {modalAction === 'approve' ? (
                <>
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                  Aprovação de Ajuste de KM
                </>
              ) : (
                <>
                  <XCircle className="h-5 w-5 text-slate-600" />
                  Rejeição de Desvio de Rota
                </>
              )}
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              {modalAction === 'approve'
                ? 'O valor aprovado substituirá o trecho no cálculo oficial de KM e consumo de combustível.'
                : 'O desvio será rejeitado e o trajeto viário oficial permanecerá inalterado.'}
            </DialogDescription>
          </DialogHeader>

          {activeItem && (
            <div className="space-y-4 py-2 text-xs">
              {/* Resumo do Pedido */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900">{activeItem.customerName}</span>
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {activeItem.trackingCode}
                  </Badge>
                </div>
                <p className="text-slate-500 text-[11px] line-clamp-1">{activeItem.address}</p>
                <div className="pt-2 flex items-center justify-between text-[11px] border-t border-slate-200/60 font-mono">
                  <span>
                    KM Viário Original: <strong>{activeItem.originalRoadKm.toFixed(1)} km</strong>
                  </span>
                  <span>
                    KM GPS:{' '}
                    <strong>
                      {activeItem.originalGpsKm > 0
                        ? `${activeItem.originalGpsKm.toFixed(1)} km`
                        : '-'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Input de KM se for Aprovado */}
              {modalAction === 'approve' && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold text-slate-700">
                    KM Aprovado para este Trecho (Substituição Oficial)
                  </Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      value={proposedKmInput}
                      onChange={(e) => setProposedKmInput(e.target.value)}
                      className="font-mono font-bold pr-12 text-sm"
                      placeholder="Ex: 3.4"
                    />
                    <span className="absolute right-3 top-2.5 text-xs text-slate-400 font-bold">
                      km
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400">
                    💡 Sugestão automática preenchida com a telemetria GPS ou viário. Altere
                    conforme necessário.
                  </p>
                </div>
              )}

              {/* Justificativa */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-slate-700">
                  Justificativa do Administrador (Opcional)
                </Label>
                <Textarea
                  value={justificationInput}
                  onChange={(e) => setJustificationInput(e.target.value)}
                  placeholder="Ex: Erro de endereço corrigido no local, dia de chuva com alagamento, área de risco com desvio necessário..."
                  className="text-xs min-h-[80px]"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsModalOpen(false)}
              disabled={isSavingApproval}
              className="text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveApproval}
              disabled={isSavingApproval}
              className={`text-xs font-bold gap-1 text-white ${
                modalAction === 'approve'
                  ? 'bg-emerald-600 hover:bg-emerald-700'
                  : 'bg-slate-800 hover:bg-slate-900'
              }`}
            >
              {isSavingApproval ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  Salvando...
                </>
              ) : modalAction === 'approve' ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Confirmar Aprovação
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5" />
                  Confirmar Rejeição
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* MODAL DE AUDITORIA NO MAPA ESTILO VUUPT */}
      {activeAuditMapData && (
        <AuditRouteMapModal
          isOpen={isAuditMapModalOpen}
          onClose={() => {
            setIsAuditMapModalOpen(false)
            setActiveAuditMapData(null)
          }}
          batchKey={activeAuditMapData.batchKey}
          batchDisplay={activeAuditMapData.batchDisplay}
          batchOrders={activeAuditMapData.batchOrders}
          courier={activeAuditMapData.courier}
          divergenceKm={activeAuditMapData.divergenceKm}
          divergencePct={activeAuditMapData.divergencePct}
          locationsPool={locations}
        />
      )}
    </div>
  )
}
export default KmAuditReport
