import React, { useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Truck,
  Fuel,
  Wallet,
  Compass,
  AlertTriangle,
  Clock,
  Calendar,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  HelpCircle,
  TrendingDown,
  Navigation,
  FileSpreadsheet,
  Download,
  Info,
  MapPin,
  Maximize2,
  Package,
  Layers,
} from 'lucide-react'
import type {
  UserRecord,
  OrderRecord,
  AppSettingsRecord,
  OffRouteEventRecord,
  CourierFuelAccount,
  LocationRecord,
  FuelAdvanceRecord,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import {
  calculateCanonicalCourierTotals,
  getCanonicalCourierBalance,
} from '@/services/canonicalCourierTotalsService'
import { fuelAccountService } from '@/services/fuelAccountService'
import { DEVIATION_THRESHOLD_METERS, haversineDistanceMeters } from '@/lib/telemetryKmEngine'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import {
  formatDateInTz,
  formatTimeInTz,
  getCivilPartsInTz,
  getCustomOperationalWindow,
  getOperationalWindow,
  isAdvancePostCutoff,
  isCurrentMonthInTz,
  parseSafeTimestamp,
  getOperationalMonthStart,
} from '@/lib/operationalWindow'

export interface CourierDeliveryHistoryItem {
  order: OrderRecord
  dateStr: string
  dateObj: Date
  trackingCode: string
  customerName: string
  customerAddress: string
  status: string
  statusLabel: string
  statusColor: string
  kmRodado: number
  isRealTelemetry: boolean
  deviationKm: number
  totalGpsKm: number
  discardedNoiseKm: number
  samplingCurvatureFactor?: number
  auditNotes?: string
  plannedKm: number
  gpsPointsCount: number
  filteredNoisePointsCount: number
  hasReturnKm: boolean
  fuelCost: number
  litersSpent: number
  offRouteCount: number
  unexpectedStopsCount: number
  events: OffRouteEventRecord[]
  // Metadados de entrega conjunta
  isJointDelivery?: boolean
  isJointPrimary?: boolean
  isJointSecondary?: boolean
  jointGroupSize?: number
  jointPrimaryTrackingCode?: string
  jointPartnerTrackingCodes?: string[]
}

interface CourierDeliveryHistoryModalProps {
  isOpen: boolean
  onClose: () => void
  courier: UserRecord | null
  fuelAccount?: CourierFuelAccount | null
  orders: OrderRecord[]
  offRouteEvents?: OffRouteEventRecord[]
  locations?: LocationRecord[]
  settings: AppSettingsRecord | null
  initialPeriodFilter?: 'all' | 'today' | 'week' | 'month' | 'custom'
  advances?: FuelAdvanceRecord[]
}

export const CourierDeliveryHistoryModal: React.FC<CourierDeliveryHistoryModalProps> = ({
  isOpen,
  onClose,
  courier,
  fuelAccount,
  orders,
  offRouteEvents = [],
  locations: externalLocations,
  settings,
  initialPeriodFilter = 'week',
  advances: externalAdvances,
}) => {
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month' | 'custom'>(
    initialPeriodFilter,
  )

  // Datas padrão para o período personalizado: últimos 7 dias civis no fuso de Brasília
  const defaultCustomDates = useMemo(() => {
    const now = new Date()
    const opWindow = getOperationalWindow(now)
    const sevenDaysAgoTs = opWindow.start - 6 * 24 * 60 * 60 * 1000
    const startParts = getCivilPartsInTz(sevenDaysAgoTs)
    const endParts = getCivilPartsInTz(opWindow.end)
    const pad = (n: number) => String(n).padStart(2, '0')
    return {
      startDate: `${startParts.year}-${pad(startParts.month)}-${pad(startParts.day)}`,
      endDate: `${endParts.year}-${pad(endParts.month)}-${pad(endParts.day)}`,
    }
  }, [])

  const [customStartDate, setCustomStartDate] = useState<string>('')
  const [customEndDate, setCustomEndDate] = useState<string>('')
  const [customDateError, setCustomDateError] = useState<string | null>(null)

  // Janela operacional ativa derivada (seja pré-definida ou customizada)
  const activeOperationalWindow = useMemo(() => {
    const now = new Date()
    const opWindow = getOperationalWindow(now)

    if (periodFilter === 'today') {
      return {
        type: 'today' as const,
        start: opWindow.start,
        end: opWindow.end,
        startPbString: opWindow.startPbString,
        endPbString: opWindow.endPbString,
        label: 'Hoje',
      }
    }

    if (periodFilter === 'week') {
      const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
      return {
        type: 'week' as const,
        start: sevenDaysAgoStart,
        end: opWindow.end,
        startPbString: new Date(sevenDaysAgoStart).toISOString().replace('T', ' '),
        endPbString: opWindow.endPbString,
        label: 'Últimos 7 dias',
      }
    }

    if (periodFilter === 'month') {
      const monthStart = getOperationalMonthStart(now)
      return {
        type: 'month' as const,
        start: monthStart.timestamp,
        end: opWindow.end,
        startPbString: monthStart.pbString,
        endPbString: opWindow.endPbString,
        label: 'Este Mês',
      }
    }

    if (periodFilter === 'custom') {
      const startStr = customStartDate || defaultCustomDates.startDate
      const endStr = customEndDate || defaultCustomDates.endDate
      const win = getCustomOperationalWindow(startStr, endStr)
      if (win) {
        return {
          type: 'custom' as const,
          start: win.start,
          end: win.end,
          startPbString: win.startPbString,
          endPbString: win.endPbString,
          label: `${startStr} a ${endStr}`,
        }
      }
      return null
    }

    return {
      type: 'all' as const,
      start: 0,
      end: Infinity,
      startPbString: undefined,
      endPbString: undefined,
      label: 'Todo Histórico',
    }
  }, [periodFilter, customStartDate, customEndDate, defaultCustomDates])
  const [officialSettings, setOfficialSettings] = useState<AppSettingsRecord | null>(settings)

  // Assegurar que settings venha do global_settings oficial, nunca sintetizado/vazio
  React.useEffect(() => {
    if (settings && settings.fuel_price_per_liter && settings.fuel_price_per_liter > 0) {
      setOfficialSettings(settings)
    } else {
      deliveryService
        .getSettings()
        .then((s) => {
          setOfficialSettings(s)
        })
        .catch(() => null)
    }
  }, [settings])

  // Sincronizar período padrão quando o modal for aberto ou initialPeriodFilter mudar
  React.useEffect(() => {
    if (isOpen) {
      setPeriodFilter(initialPeriodFilter)
      if (!customStartDate) setCustomStartDate(defaultCustomDates.startDate)
      if (!customEndDate) setCustomEndDate(defaultCustomDates.endDate)
      setCustomDateError(null)
    }
  }, [isOpen, initialPeriodFilter, defaultCustomDates, customStartDate, customEndDate])

  // Validação dinâmica das datas personalizadas
  const validateAndSetDates = (newStart: string, newEnd: string) => {
    setCustomStartDate(newStart)
    setCustomEndDate(newEnd)

    if (!newStart || !newEnd) {
      setCustomDateError('Selecione as datas de início e fim.')
      return
    }

    const win = getCustomOperationalWindow(newStart, newEnd)
    if (!win) {
      if (newStart > newEnd) {
        setCustomDateError('Data inicial não pode ser posterior à data final.')
      } else {
        setCustomDateError('Intervalo de datas inválido.')
      }
      return
    }

    // Verificar se a data inicial ou final é muito futura
    const now = new Date()
    const currentOpWindow = getOperationalWindow(now)
    // Permite até o fim do dia operacional de hoje ou alguns dias à frente com aviso suave
    if (win.start > currentOpWindow.end + 24 * 60 * 60 * 1000) {
      setCustomDateError('A data inicial é futura. Não há entregas previstas neste período.')
      return
    }

    setCustomDateError(null)
  }
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemForDetails, setSelectedItemForDetails] =
    useState<CourierDeliveryHistoryItem | null>(null)
  const [fetchedLocations, setFetchedLocations] = useState<LocationRecord[]>([])
  const [isLoadingLocations, setIsLoadingLocations] = useState(false)
  const [approvalsList, setApprovalsList] = useState<any[]>([])
  const [activeBaseCoords, setActiveBaseCoords] = useState<{ lat: number; lng: number } | null>(
    null,
  )

  // Carregar base ativa dinâmica (coleção base_addresses)
  React.useEffect(() => {
    let isMounted = true
    deliveryService
      .getActiveBaseCoordinate(courier?.empresa_id)
      .then((b) => {
        if (isMounted && b) setActiveBaseCoords({ lat: b.lat, lng: b.lng })
      })
      .catch(() => null)
    return () => {
      isMounted = false
    }
  }, [courier?.empresa_id])

  const [telemetryBatchesList, setTelemetryBatchesList] = useState<RouteBatchTelemetryRecord[]>([])

  // Carregar aprovações via deliveryService.getRouteKmApprovals (paridade com KmAuditReport)
  // Parametrizado com a janela operacional de Brasília (05h–23h59) quando disponível
  React.useEffect(() => {
    if (!isOpen) return
    let isMounted = true

    const options = activeOperationalWindow
      ? {
          startDate: activeOperationalWindow.startPbString,
          endDate: activeOperationalWindow.endPbString,
        }
      : undefined

    deliveryService
      .getRouteKmApprovals(courier?.empresa_id, options)
      .then((data) => {
        if (isMounted) setApprovalsList(data || [])
      })
      .catch((err) => {
        console.warn('[CourierDeliveryHistoryModal] Erro ao carregar aprovações de KM:', err)
      })

    // Carregar registros canônicos de route_batch_telemetry para compor a fonte de verdade dos lotes
    deliveryService
      .listRouteBatchTelemetry()
      .then((data) => {
        if (isMounted) setTelemetryBatchesList(data || [])
      })
      .catch((err) => {
        console.warn('[CourierDeliveryHistoryModal] Erro ao carregar route_batch_telemetry:', err)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, courier?.empresa_id, activeOperationalWindow])

  const approvalsMap = useMemo(() => {
    const map = new Map<
      string,
      { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
    >()
    approvalsList.forEach((appr) => {
      if (appr.order_id) {
        map.set(appr.order_id, {
          approvedKm: appr.approved_km,
          justification: appr.justification,
          status: appr.status,
        })
      }
    })
    return map
  }, [approvalsList])

  // Carregar locations do entregador para cobrir a telemetria do período selecionado
  React.useEffect(() => {
    if (!isOpen || !courier?.id) return

    let isMounted = true
    setIsLoadingLocations(true)

    // Determinar janela de datas conforme o filtro selecionado
    let startDate: string | undefined
    let endDate: string | undefined

    if (activeOperationalWindow) {
      startDate = activeOperationalWindow.startPbString
      endDate = activeOperationalWindow.endPbString
    }

    // Buscar locations do entregador do período selecionado (sem fallback irrestrito que infla o período)
    deliveryService
      .getCourierLocations(courier.id, startDate, endDate)
      .then((locs) => {
        if (!isMounted) return
        if (locs && locs.length > 0) {
          setFetchedLocations(locs)
        } else if (externalLocations && externalLocations.length > 0) {
          // Filtrar externalLocations para a janela do período se houver datas limites
          const startTs = startDate ? new Date(startDate).getTime() : 0
          const endTs = endDate ? new Date(endDate).getTime() : Infinity
          const filteredExt = externalLocations.filter((l) => {
            const lTs = new Date(l.created).getTime()
            return lTs >= startTs && lTs <= endTs
          })
          setFetchedLocations(filteredExt)
        } else {
          setFetchedLocations([])
        }
      })
      .catch((err) => {
        console.warn('Erro ao carregar telemetria de GPS para histórico:', err)
        if (isMounted) {
          if (externalLocations && externalLocations.length > 0) {
            const startTs = startDate ? new Date(startDate).getTime() : 0
            const endTs = endDate ? new Date(endDate).getTime() : Infinity
            const filteredExt = externalLocations.filter((l) => {
              const lTs = new Date(l.created).getTime()
              return lTs >= startTs && lTs <= endTs
            })
            setFetchedLocations(filteredExt)
          } else {
            setFetchedLocations([])
          }
        }
      })
      .finally(() => {
        if (isMounted) setIsLoadingLocations(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, courier?.id, activeOperationalWindow, externalLocations])

  const allLocations = useMemo(() => {
    if (fetchedLocations && fetchedLocations.length > 0) {
      return fetchedLocations
    }
    return externalLocations && externalLocations.length > 0 ? externalLocations : []
  }, [externalLocations, fetchedLocations])

  // Obter parâmetros de combustível específicos do entregador
  const fuelParams = useMemo(() => {
    const effectiveSettings = officialSettings || settings
    if (courier?.consumption_kml && courier.consumption_kml > 0) {
      const defaultSettings = deliveryService.getVehicleFuelParams(
        effectiveSettings,
        courier?.vehicle_type,
      )
      return {
        consumptionKml: courier.consumption_kml,
        pricePerLiter: defaultSettings.pricePerLiter,
        category: defaultSettings.category,
      }
    }
    return deliveryService.getVehicleFuelParams(effectiveSettings, courier?.vehicle_type)
  }, [officialSettings, settings, courier])

  // Lista consolidada de adiantamentos do entregador (se houver cutoff_date, excluir os anteriores ao corte)
  const allCourierAdvances = useMemo(() => {
    const cutoffDateStr = courier?.cutoff_date || undefined
    const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
    const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)

    const isAfterCutoff = (a: FuelAdvanceRecord) => {
      if (!hasCutoff) return true
      return isAdvancePostCutoff(a.date || a.created, cutoffDateStr)
    }

    if (externalAdvances && externalAdvances.length > 0) {
      return externalAdvances.filter((a) => a.courier_id === courier?.id && isAfterCutoff(a))
    }
    if (fuelAccount?.advances && fuelAccount.advances.length > 0) {
      return fuelAccount.advances.filter((a) => a.courier_id === courier?.id && isAfterCutoff(a))
    }
    if (fuelAccount && fuelAccount.totalAdvances > 0 && courier?.id) {
      return [
        {
          id: `synthetic_adv_${courier.id}`,
          courier_id: courier.id,
          amount: fuelAccount.totalAdvances,
          date: new Date().toISOString(),
          collectionId: 'fuel_advances',
          collectionName: 'fuel_advances',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
        } as any,
      ]
    }
    return []
  }, [externalAdvances, fuelAccount, courier?.id, courier?.cutoff_date])

  // Saldo de abertura congelado: usar courier.opening_balance quando existir sem recalcular carry-over
  const carryOverBalance = useMemo(() => {
    if (!courier?.id) return 0
    if (typeof courier.opening_balance === 'number') {
      return courier.opening_balance
    }
    if (fuelAccount?.carryOverBalance !== undefined) {
      return fuelAccount.carryOverBalance
    }
    return fuelAccountService.calculateCarryOverBalance({
      courierId: courier.id,
      courierVehicleType: courier.vehicle_type,
      advances: allCourierAdvances,
      orders,
      settings: officialSettings || settings,
    })
  }, [
    courier?.id,
    courier?.vehicle_type,
    courier?.opening_balance,
    fuelAccount?.carryOverBalance,
    allCourierAdvances,
    orders,
    officialSettings,
    settings,
  ])

  // Executar o motor consolidado de telemetria e combustível (o mesmo motor do useCourierFuelMetrics)
  // Agrupa por lotes de rota, desconta desvios/paradas de rota e rateia proporcionalmente sem duplicações
  // Passamos `orders` diretamente para manter o contexto completo dos pedidos, com filtro periodFilter='all'
  // e approvalsMap montado a partir de route_km_approvals
  const consolidatedMetrics = useMemo(() => {
    if (!courier) return null

    return calculateCourierFuelMetrics({
      courier,
      orders,
      locations: allLocations,
      offRouteEvents,
      advances: allCourierAdvances,
      settings: officialSettings || settings,
      periodFilter: 'all',
      carryOverBalance,
      approvalsMap,
      activeBaseCoords,
      telemetryBatches: telemetryBatchesList,
    })
  }, [
    courier,
    orders,
    allLocations,
    offRouteEvents,
    allCourierAdvances,
    officialSettings,
    settings,
    carryOverBalance,
    approvalsMap,
    activeBaseCoords,
    telemetryBatchesList,
  ])

  // Eventos de desvio e paradas do entregador para exibição na auditoria do modal:
  const courierEvents = useMemo(() => {
    if (!courier?.id) return []
    return offRouteEvents.filter((ev) => {
      if (ev.courier_id !== courier.id) return false
      // Se for desvio de rota, verificar se a distância registrada é >= 600m
      if (ev.event_type === 'route_deviation') {
        const devDist = ev.distance_deviation_meters || 0
        if (devDist > 0 && devDist < DEVIATION_THRESHOLD_METERS) {
          return false
        }
      }
      // Se for parada inesperada, só considerar com duração real >= 180s e fora da base (>600m)
      if (ev.event_type === 'unexpected_stop') {
        const stopSec = ev.stop_duration_seconds || 0
        if (stopSec < 180) {
          return false
        }
        // Verificar se foi na base padrão (Pilar/Caxias ou start_base ativa)
        const baseLat = activeBaseCoords?.lat ?? -22.6977499
        const baseLng = activeBaseCoords?.lng ?? -43.2936013
        const distToBase = haversineDistanceMeters(ev.lat, ev.lng, baseLat, baseLng)
        if (distToBase < DEVIATION_THRESHOLD_METERS) {
          return false
        }
      }
      return true
    })
  }, [offRouteEvents, courier, activeBaseCoords])

  // Processar itens detalhados de cada entrega utilizando os orderAllocations do motor canônico
  const historyItems: CourierDeliveryHistoryItem[] = useMemo(() => {
    if (!courier || !consolidatedMetrics) return []

    // Calcular mapa de alocações canônicas sobre todos os pedidos elegíveis (rateio viário de lote com volta à base 1x)
    const canonicalAll = calculateCanonicalCourierTotals({
      courier: courier.id
        ? courier
        : ({ id: '', name: courier.name || 'Entregador' } as UserRecord),
      telemetryBatches: telemetryBatchesList,
      orders,
      advances: allCourierAdvances,
      settings: officialSettings || settings,
      periodFilter: 'all',
      approvalsMap,
    })

    // Mapear cada orderCalculation gerado pelo motor consolidado, alinhando km e combustível com canonicalTotals
    return consolidatedMetrics.orderCalculations.map((calc) => {
      const o = calc.order

      // Prioridade absoluta: alocação do motor canônico (rateio proporcional do km viário do lote, volta à base inclusa 1x)
      const canonicalAlloc = canonicalAll.orderAllocations.get(o.id)
      const kmOficial = canonicalAlloc ? canonicalAlloc.officialKm : calc.officialKm
      const cost = canonicalAlloc ? canonicalAlloc.fuelCost : calc.fuelCost

      const isBicycle =
        fuelParams.category === 'bicicleta' ||
        courier?.vehicle_type === 'bicicleta' ||
        courier?.vehicle_type === 'bicycle'
      const effectiveKml =
        typeof courier?.consumption_kml === 'number' && courier.consumption_kml > 0
          ? courier.consumption_kml
          : fuelParams.consumptionKml || 30.0
      const liters =
        !isBicycle && effectiveKml > 0 ? Number((kmOficial / effectiveKml).toFixed(2)) : 0

      // Eventos associados a esta entrega específica
      const associatedEvents = courierEvents.filter(
        (ev) =>
          ev.order_id === o.id ||
          (ev.courier_id === courier.id &&
            ev.created >= (o.route_started_at || o.created) &&
            ev.created <= (o.actual_arrival || o.updated || o.created)),
      )
      const offRouteCount = Math.max(
        canonicalAlloc?.deviationEpisodes ?? calc.offRouteCount,
        associatedEvents.filter((ev) => ev.event_type === 'route_deviation').length,
      )
      const unexpectedStopsCount = Math.max(
        calc.unexpectedStopsCount,
        associatedEvents.filter((ev) => ev.event_type === 'unexpected_stop').length,
      )

      let statusLabel = 'Em Espera'
      let statusColor = 'bg-slate-500/15 text-slate-300 border-slate-700'

      const notesLower = o.notes ? o.notes.toLowerCase() : ''
      const isDesistenciaCliente =
        notesLower.includes('cancelamento: [desistência do cliente]') ||
        notesLower.includes('desistência do cliente') ||
        notesLower.includes('desistencia do cliente')

      if (o.status === 'delivered') {
        statusLabel = '✓ Entregue'
        statusColor = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      } else if (o.status === 'in_transit') {
        statusLabel = '🛵 Em Rota'
        statusColor = 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      } else if (o.status === 'address_error') {
        statusLabel = '⚠️ Erro de Endereço'
        statusColor = 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      } else if (o.status === 'client_absent') {
        statusLabel = '⚠️ Cliente Ausente'
        statusColor = 'bg-orange-500/15 text-orange-400 border-orange-500/30'
      } else if (o.status === 'cancelled') {
        if (isDesistenciaCliente) {
          statusLabel = '⚠️ Desistência do Cliente (Cancelado)'
          statusColor = 'bg-slate-700/30 text-slate-400 border-slate-700'
        } else if (o.completion_reason === 'cancelado_vendedor') {
          statusLabel = 'Cancelado Loja'
          statusColor = 'bg-slate-700/30 text-slate-400 border-slate-700'
        } else {
          statusLabel = 'Cancelado'
          statusColor = 'bg-slate-700/30 text-slate-400 border-slate-700'
        }
      } else if (o.status === 'assigned') {
        statusLabel = 'Atribuído / Preparando'
        statusColor = 'bg-blue-500/15 text-blue-400 border-blue-500/30'
      }

      const dateRaw = o.route_finished_at || o.actual_arrival || o.created || Date.now()
      const tsSafe = parseSafeTimestamp(dateRaw) || Date.now()
      const dateObj = new Date(tsSafe)
      const dayFormatted = formatDateInTz(tsSafe, {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
      const timeFormatted = formatTimeInTz(tsSafe, false)
      const dateStr = `${dayFormatted}, ${timeFormatted}`

      return {
        order: o,
        dateStr,
        dateObj,
        trackingCode: o.tracking_code || `ORD-${o.id.slice(0, 6)}`,
        customerName: o.expand?.customer_id?.name || 'Cliente',
        customerAddress:
          o.expand?.customer_id?.address || o.start_base_address || 'Endereço não informado',
        status: o.status,
        statusLabel,
        statusColor,
        kmRodado: kmOficial,
        isRealTelemetry: canonicalAlloc ? canonicalAlloc.isRealTelemetry : calc.isRealTelemetry,
        deviationKm: calc.deviationKm,
        totalGpsKm: calc.totalGpsKm,
        discardedNoiseKm: calc.discardedNoiseKm,
        samplingCurvatureFactor: undefined,
        auditNotes: undefined,
        plannedKm: Number(((o.distance_km || 0) + (o.return_trip_km || 0)).toFixed(1)),
        gpsPointsCount: 0,
        filteredNoisePointsCount: 0,
        hasReturnKm: calc.hasReturnKm,
        fuelCost: cost,
        litersSpent: liters,
        offRouteCount,
        unexpectedStopsCount,
        isJointDelivery: calc.isJointDelivery,
        isJointPrimary: calc.isJointPrimary,
        isJointSecondary: canonicalAlloc ? canonicalAlloc.isJointSecondary : calc.isJointSecondary,
        jointGroupSize: calc.jointGroupSize,
        jointPrimaryTrackingCode: calc.jointPrimaryTrackingCode,
        jointPartnerTrackingCodes: calc.jointPartnerTrackingCodes,
        events:
          associatedEvents.length > 0
            ? associatedEvents
            : courierEvents.filter((ev) => ev.order_id === o.id),
      }
    })
  }, [
    courier,
    consolidatedMetrics,
    courierEvents,
    fuelParams,
    telemetryBatchesList,
    orders,
    allCourierAdvances,
    officialSettings,
    settings,
    approvalsMap,
  ])

  // Aplicar filtros de período, status e busca
  const filteredItems = useMemo(() => {
    const now = new Date()

    return historyItems.filter((item) => {
      // Filtro de período (respeitando fuso America/Sao_Paulo e janela operacional)
      const ts = item.dateObj.getTime()
      if (periodFilter === 'today') {
        if (
          !activeOperationalWindow ||
          ts < activeOperationalWindow.start ||
          ts > activeOperationalWindow.end
        ) {
          return false
        }
      } else if (periodFilter === 'week') {
        if (!activeOperationalWindow || ts < activeOperationalWindow.start) {
          return false
        }
      } else if (periodFilter === 'month') {
        const isCurrentMonth = isCurrentMonthInTz(item.dateObj, now)
        if (!isCurrentMonth) return false
      } else if (periodFilter === 'custom') {
        if (!activeOperationalWindow) return false
        if (ts < activeOperationalWindow.start || ts > activeOperationalWindow.end) {
          return false
        }
      }

      // Trava de cancelados sem visita: descartar pedido cancelado se não foi iniciado e sem visita registrada
      if (item.status === 'cancelled' && !item.order.route_started && !item.order.actual_arrival) {
        return false
      }

      // Filtro de status
      if (statusFilter !== 'all') {
        if (statusFilter === 'partial') {
          const isLocalAttemptFail =
            item.status === 'address_error' ||
            item.status === 'client_absent' ||
            item.statusLabel === '⚠️ Desistência do Cliente'
          if (!isLocalAttemptFail) return false
        } else if (item.status !== statusFilter) {
          return false
        }
      }
      // Filtro de busca
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchesCode = item.trackingCode.toLowerCase().includes(q)
        const matchesCustomer = item.customerName.toLowerCase().includes(q)
        const matchesAddress = item.customerAddress.toLowerCase().includes(q)
        if (!matchesCode && !matchesCustomer && !matchesAddress) return false
      }

      return true
    })
  }, [historyItems, periodFilter, activeOperationalWindow, statusFilter, searchQuery])

  // Totais do período filtrado com CARRY-OVER contínuo e agregação de conjuntas
  const metricsSummary = useMemo(() => {
    const now = new Date()
    const cutoffDateStr = courier?.cutoff_date || undefined
    const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
    const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)
    const openingBal =
      typeof courier?.opening_balance === 'number' ? courier.opening_balance : carryOverBalance

    // Filtrar adiantamentos pós-corte de acordo com o periodFilter (fuso America/Sao_Paulo)
    // Regra 1a/3: totalAdvances/totalAdiantado deve somar SOMENTE registros com entry_type === 'advance'
    // (ou entry_type vazio/ausente por retrocompatibilidade) E status !== 'cancelled'.
    // Excluir toda entrada entry_type === 'balance_adjustment'.
    const filteredAdvances = allCourierAdvances.filter((a) => {
      if (a.status === 'cancelled') return false
      if (a.entry_type === 'balance_adjustment') return false
      if (a.entry_type && a.entry_type !== 'advance') return false
      if (hasCutoff && !isAdvancePostCutoff(a.date || a.created, cutoffDateStr)) return false

      if (periodFilter === 'all') return true
      const advRaw = a.date || a.created
      const parsedAdvTs = parseSafeTimestamp(advRaw) || 0

      if (periodFilter === 'today') {
        if (!activeOperationalWindow) return false
        return (
          parsedAdvTs >= activeOperationalWindow.start && parsedAdvTs <= activeOperationalWindow.end
        )
      }
      if (periodFilter === 'week') {
        if (!activeOperationalWindow) return false
        return parsedAdvTs >= activeOperationalWindow.start
      }
      if (periodFilter === 'month') {
        return isCurrentMonthInTz(advRaw, now)
      }
      if (periodFilter === 'custom') {
        if (!activeOperationalWindow) return false
        return (
          parsedAdvTs >= activeOperationalWindow.start && parsedAdvTs <= activeOperationalWindow.end
        )
      }
      return true
    })

    const totalAdiantado = filteredAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0)

    // KM Oficial e Combustível totalizadores derivados ESTRITAMENTE de filteredItems
    // respeitando a janela civil de Brasília (activeOperationalWindow), somando os valores
    // já rateados/calculados pelo motor oficial para as entregas visíveis.
    // FONTE ÚNICA CANÔNICA: Calcular totais a partir dos lotes de rota de telemetria
    // GUARDA v0.0.464: entregador nulo/sem id nunca derruba o modal — totais zerados seguros.
    const canonicalCalculation = calculateCanonicalCourierTotals({
      courier:
        courier && courier.id
          ? courier
          : ({ id: '', name: courier?.name || 'Entregador' } as UserRecord),
      telemetryBatches: telemetryBatchesList,
      orders: filteredItems.map((fi) => fi.order),
      advances: allCourierAdvances,
      settings: officialSettings || settings,
      periodFilter,
      customStartDate,
      customEndDate,
      approvalsMap,
    })

    // Agregação de conjuntas RESTRITA AO PERÍODO FILTRADO:
    // Identificar secundárias do período filtrado
    const jointSecondaryItems = filteredItems.filter((i) => i.isJointSecondary)
    const jointConsolidatedCount = jointSecondaryItems.length
    // Economia de km e combustível obtidas das secundárias do período
    // Usar parâmetros reais: moto cadastrada -> app_settings -> 40 km/L e preço via app_settings
    const defaultParams = deliveryService.getVehicleFuelParams(
      officialSettings || settings,
      courier?.vehicle_type,
    )
    const isBicycle =
      fuelParams.category === 'bicicleta' ||
      courier?.vehicle_type === 'bicicleta' ||
      courier?.vehicle_type === 'bicycle'
    const effectiveKml =
      typeof courier?.consumption_kml === 'number' && courier.consumption_kml > 0
        ? courier.consumption_kml
        : fuelParams.consumptionKml || defaultParams.consumptionKml || 40.0
    const effectivePrice =
      typeof courier?.fuel_price === 'number' && courier.fuel_price > 0
        ? courier.fuel_price
        : fuelParams.pricePerLiter || defaultParams.pricePerLiter || 6.09

    const totalKm = canonicalCalculation.totalOfficialKm
    const totalFuelCost = isBicycle ? 0 : canonicalCalculation.fuelCost
    const totalLiters =
      !isBicycle && effectiveKml > 0 ? Number((totalKm / effectiveKml).toFixed(2)) : 0

    const totalDeviations = filteredItems.reduce((acc, i) => acc + i.offRouteCount, 0)
    const totalStops = filteredItems.reduce((acc, i) => acc + i.unexpectedStopsCount, 0)

    const jointSavedKm = jointSecondaryItems.reduce((sum, item) => {
      const planned = Number(item.plannedKm) || 0
      return sum + planned
    }, 0)
    const jointSavedFuelCost = isBicycle
      ? 0
      : jointSecondaryItems.reduce((sum, item) => {
          const pKm = Number(item.plannedKm) || 0
          return sum + (pKm / effectiveKml) * effectivePrice
        }, 0)

    // FONTE ÚNICA CANÔNICA DO SALDO (getCanonicalCourierBalance):
    // Substitui a fórmula de saldo local do modal pela chamada canônica única.
    // Card e modal exibem exatamente o mesmo valor da função getCanonicalCourierBalance.
    const canonicalBalance = getCanonicalCourierBalance({
      courier:
        courier && courier.id
          ? courier
          : ({ id: '', name: courier?.name || 'Entregador' } as UserRecord),
      telemetryBatches: telemetryBatchesList,
      orders: orders || filteredItems.map((fi) => fi.order),
      advances: allCourierAdvances,
      settings: officialSettings || settings,
      periodFilter,
      customStartDate,
      customEndDate,
      approvalsMap,
    })

    return {
      totalKm: Number(totalKm.toFixed(1)),
      totalFuelCost: Number(totalFuelCost.toFixed(2)),
      totalLiters: Number(totalLiters.toFixed(2)),
      totalDeviations,
      totalStops,
      saldoContaCorrente: Number(canonicalBalance.saldo.toFixed(2)),
      totalAdiantado: Number(totalAdiantado.toFixed(2)),
      totalDeliveries: filteredItems.length,
      carryOverBalance: Number(openingBal.toFixed(2)),
      jointConsolidatedCount,
      jointSavedKm: Number(jointSavedKm.toFixed(1)),
      jointSavedFuelCost: Number(jointSavedFuelCost.toFixed(2)),
      hasManualAdjustment: canonicalCalculation.hasManualAdjustment,
      manualAdjustmentKm: canonicalCalculation.manualAdjustmentKm,
      manualAdjustmentFuelCost: canonicalCalculation.manualAdjustmentFuelCost,
      manualAdjustmentDeltaKm: canonicalCalculation.manualAdjustmentDeltaKm,
      manualAdjustmentPeriodLabel: canonicalCalculation.manualAdjustmentPeriodLabel,
      rawOfficialKmBeforeAdjustment: canonicalCalculation.rawOfficialKmBeforeAdjustment,
      kmPagamento: isBicycle ? 0 : canonicalCalculation.km_pagamento,
      combustivelPagamento: isBicycle ? 0 : canonicalCalculation.combustivel_pagamento,
      descontoKm: isBicycle ? 0 : canonicalCalculation.desconto_km,
      descontoCombustivel: isBicycle ? 0 : canonicalCalculation.desconto_combustivel,
    }
  }, [
    allCourierAdvances,
    periodFilter,
    activeOperationalWindow,
    filteredItems,
    historyItems,
    carryOverBalance,
    fuelParams,
    courier?.cutoff_date,
    courier?.opening_balance,
    telemetryBatchesList,
    customStartDate,
    customEndDate,
  ])

  // Exportar dados em CSV com KM Real e KM de Desvios em colunas separadas
  const handleExportCSV = () => {
    if (!courier || filteredItems.length === 0) return

    const headers = [
      'Código',
      'Data/Hora',
      'Cliente',
      'Endereço',
      'Status',
      'KM Real Oficial (Reembolsável)',
      'Episódios de Desvio (Qtd)',
      'KM Total Rodado (GPS / Telemetria)',
      'KM Descartado por Ruído',
      'Origem Telemetria (GPS Real vs Estimado)',
      'Combustível Oficial (R$)',
      'Litros Consumidos',
      'Desvios de Rota (>600m)',
      'Paradas Fora da Rota',
      'Entrega Conjunta',
      'Obs Auditoria',
    ]

    const rows = filteredItems.map((item) => [
      item.trackingCode,
      `"${item.dateStr}"`,
      `"${item.customerName}"`,
      `"${item.customerAddress.replace(/"/g, '""')}"`,
      `"${item.statusLabel}"`,
      item.kmRodado.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
      item.offRouteCount,
      item.totalGpsKm.toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1,
      }),
      item.discardedNoiseKm.toFixed(2),
      item.isRealTelemetry ? '100% Real (GPS)' : 'Estimado (Planejado)',
      item.fuelCost.toFixed(2),
      item.litersSpent.toFixed(2),
      item.offRouteCount,
      item.unexpectedStopsCount,
      item.isJointSecondary
        ? `"Conjunta (km contabilizado no ${item.jointPrimaryTrackingCode})"`
        : item.isJointPrimary
          ? `"Principal (${item.jointGroupSize || 2} pedidos)"`
          : '"Individual"',
      item.isJointSecondary ? '"km já contabilizado na entrega conjunta"' : '""',
    ])

    // Se houver ajuste manual no período, adicionar linha para que a soma feche exatamente no total do período
    if (metricsSummary.hasManualAdjustment && metricsSummary.manualAdjustmentDeltaKm) {
      const deltaKm = metricsSummary.manualAdjustmentDeltaKm
      const deltaFuel = (deltaKm / fuelParams.consumptionKml) * fuelParams.pricePerLiter
      const deltaLiters = deltaKm / fuelParams.consumptionKml
      rows.push([
        'AJUSTE-MANUAL',
        `"${metricsSummary.manualAdjustmentPeriodLabel || '01/10–22/10'}"`,
        '"Ajuste manual do período"',
        '"Ajuste manual de km determinado pelo administrador"',
        '"Aprovado"',
        deltaKm.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
        '0',
        '0,0',
        '0.00',
        'Ajuste Manual Admin',
        deltaFuel.toFixed(2),
        deltaLiters.toFixed(2),
        '0',
        '0',
        '"Ajuste Manual"',
        '"Ajuste manual do período para fechar o total de 731 km"',
      ])
    }

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute(
      'download',
      `historico_entregas_${courier.name ? courier.name.replace(/\s+/g, '_').toLowerCase() : 'entregador'}.csv`,
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  if (!courier) return null

  const isSaldoPositivo = metricsSummary.saldoContaCorrente >= 0

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl w-[95vw] max-h-[92vh] overflow-hidden flex flex-col bg-[#070D1E] text-slate-100 border-[#1E2B58] p-0 shadow-2xl">
        {/* HEADER MODAL */}
        <DialogHeader className="p-4 sm:p-5 pb-3 border-b border-[#1E2B58] bg-[#0A1128]/95 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-[#0052CC] to-[#1D4ED8] text-white font-black text-sm shadow-brand border border-blue-400/30 shrink-0">
                {courier.name ? courier.name.slice(0, 2).toUpperCase() : 'EN'}
              </div>
              <div>
                <DialogTitle className="text-base sm:text-lg font-bold text-white flex items-center gap-2">
                  <span>{courier.name || 'Entregador'}</span>
                  <Badge
                    variant="outline"
                    className="text-[10px] uppercase font-mono font-bold bg-[#0E1738] border-[#1E2B58] text-[#60A5FA]"
                  >
                    {fuelParams.category.toUpperCase()}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400 flex flex-wrap items-center gap-2 mt-0.5">
                  <span>{courier.vehicle_plate || 'Sem placa'}</span>
                  <span>•</span>
                  <span>{courier.vehicle_model || 'Veículo padrão'}</span>
                  <span>•</span>
                  <span className="text-slate-300">
                    {fuelParams.consumptionKml.toLocaleString('pt-BR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{' '}
                    km/L @ R${' '}
                    {fuelParams.pricePerLiter.toLocaleString('pt-BR', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                    /L
                  </span>
                </DialogDescription>
              </div>
            </div>

            {/* Ações de topo */}
            <div className="flex items-center gap-2 self-start sm:self-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCSV}
                className="h-8 text-xs gap-1.5 border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-slate-200"
                title="Exportar dados da tabela em planilha CSV"
              >
                <Download className="h-3.5 w-3.5 text-[#22C55E]" />
                Exportar CSV
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* CORPO DO MODAL COM ROLAGEM */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* CARD EXCLUSIVO ADMIN: KM PAGAMENTO DE COMBUSTÍVEL (-15% PÓS 26/10) */}
          <div className="p-3.5 rounded-xl bg-gradient-to-r from-emerald-950/40 via-[#0E1738] to-emerald-900/30 border border-emerald-500/40 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1 bg-emerald-500" />
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 shrink-0">
                  <Fuel className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
                      KM Pagamento de Combustível
                    </span>
                    <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/40 text-[9px] px-1.5 py-0 font-bold uppercase">
                      Admin • -15% após 26/10
                    </Badge>
                  </div>
                  <p className="text-[11px] text-slate-300 mt-0.5">
                    Base canônica para reembolso de combustível. Pedidos a partir de 26/10 aplicam
                    desconto de 15% sobre o KM viário.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 sm:gap-6 bg-[#070D1E]/70 p-2.5 px-4 rounded-xl border border-emerald-500/20 self-start sm:self-center">
                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                    KM Pagamento
                  </span>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-xl sm:text-2xl font-black font-mono text-emerald-400">
                      {metricsSummary.kmPagamento.toLocaleString('pt-BR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}
                    </span>
                    <span className="text-xs text-slate-400 font-medium">km</span>
                  </div>
                </div>

                <div className="h-8 w-px bg-[#1E2B58]" />

                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                    Combustível Pagamento
                  </span>
                  <span className="text-xl sm:text-2xl font-black font-mono text-white">
                    R$ {metricsSummary.combustivelPagamento.toFixed(2)}
                  </span>
                </div>

                <div className="h-8 w-px bg-[#1E2B58]" />

                <div>
                  <span className="text-[10px] text-slate-400 block uppercase font-semibold">
                    Viário Oficial (Sem Desconto)
                  </span>
                  <span className="text-xs font-mono text-slate-300">
                    {metricsSummary.totalKm.toLocaleString('pt-BR', {
                      minimumFractionDigits: 1,
                      maximumFractionDigits: 1,
                    })}{' '}
                    km • R$ {metricsSummary.totalFuelCost.toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* TOTALIZADORES NO TOPO DO PAINEL */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {/* 1. Saldo da Conta Corrente */}
            <div className="p-3.5 rounded-xl bg-[#0E1738] border border-[#1E2B58] relative overflow-hidden">
              <div
                className={`absolute top-0 left-0 right-0 h-1 ${
                  isSaldoPositivo ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
                }`}
              />
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  Saldo Conta Corrente
                </span>
                <Wallet
                  className={`h-4 w-4 ${isSaldoPositivo ? 'text-[#22C55E]' : 'text-[#EF4444]'}`}
                />
              </div>
              <p
                className={`text-xl sm:text-2xl font-black font-mono mt-1 ${
                  isSaldoPositivo ? 'text-[#22C55E]' : 'text-[#EF4444]'
                }`}
              >
                R$ {metricsSummary.saldoContaCorrente.toFixed(2)}
              </p>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                {isSaldoPositivo ? 'Crédito disponível' : 'Saldo a repor'}
                {periodFilter === 'month' && (
                  <span className="block text-[9px] text-slate-400 font-mono mt-0.5">
                    (Carry-over mês anterior: R$ {metricsSummary.carryOverBalance.toFixed(2)})
                  </span>
                )}
              </span>
            </div>

            {/* 2. Total Adiantado */}
            <div className="p-3.5 rounded-xl bg-[#0E1738] border border-[#1E2B58] relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-[#0052CC]" />
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  Total Adiantado
                </span>
                <span className="text-xs text-[#60A5FA]">💰</span>
              </div>
              <p className="text-xl sm:text-2xl font-black font-mono text-[#60A5FA] mt-1">
                R$ {metricsSummary.totalAdiantado.toFixed(2)}
              </p>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                Créditos antecipados pelo admin
              </span>
            </div>

            {/* 3. KM Real Rodado (Oficial) */}
            <div className="p-3.5 rounded-xl bg-[#0E1738] border border-[#1E2B58] relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-[#FF6B35]" />
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  {periodFilter === 'today'
                    ? 'KM Oficial do Dia (Auditoria de KM)'
                    : periodFilter === 'custom'
                      ? 'KM Oficial Personalizado (Auditoria de KM)'
                      : 'KM Oficial do Período (Auditoria de KM)'}
                </span>
                <Navigation className="h-4 w-4 text-[#FF6B35]" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-xl sm:text-2xl font-black font-mono text-white">
                  {metricsSummary.totalKm.toLocaleString('pt-BR', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{' '}
                  <span className="text-xs font-normal text-slate-400">km</span>
                </p>
                {metricsSummary.hasManualAdjustment && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[9px] px-1.5 py-0 font-bold">
                    Ajuste manual aplicado ({metricsSummary.manualAdjustmentPeriodLabel})
                  </Badge>
                )}
              </div>
              {metricsSummary.hasManualAdjustment ? (
                <span className="text-[10px] text-amber-400/90 block mt-0.5 font-medium">
                  +{metricsSummary.manualAdjustmentDeltaKm?.toFixed(1)} km sobre a soma dos lotes (
                  {metricsSummary.rawOfficialKmBeforeAdjustment?.toFixed(1)} km)
                </span>
              ) : (
                <span className="text-[10px] text-emerald-400/90 block mt-0.5 font-medium">
                  KM viário dos lotes (volta à base incluída)
                </span>
              )}
            </div>

            {/* 4. Combustível Total Gasto */}
            <div className="p-3.5 rounded-xl bg-[#0E1738] border border-[#1E2B58] relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-amber-500" />
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span className="font-semibold uppercase tracking-wider text-[10px]">
                  Combustível Gasto
                </span>
                <Fuel className="h-4 w-4 text-amber-400" />
              </div>
              <div className="flex items-baseline gap-2 mt-1">
                <p className="text-xl sm:text-2xl font-black font-mono text-amber-400">
                  R$ {metricsSummary.totalFuelCost.toFixed(2)}
                </p>
                {metricsSummary.hasManualAdjustment && (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[9px] px-1.5 py-0 font-bold">
                    Ajuste manual
                  </Badge>
                )}
              </div>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                ~{metricsSummary.totalLiters} L consumidos
              </span>
            </div>
          </div>

          {/* ALERTA INFORMATIVO DE ENTREGAS CONJUNTAS CONSOLIDADAS (SINCRONIZADO COM O PERÍODO SELECIONADO) */}
          {metricsSummary.jointConsolidatedCount > 0 && (
            <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>📦 Entregas Conjuntas Detectadas no Mesmo Ponto</span>
                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px] font-mono">
                      {metricsSummary.jointConsolidatedCount} pedido(s) agrupado(s)
                    </Badge>
                  </h4>
                  <p className="text-[11px] text-purple-200/80 mt-0.5">
                    Pedidos múltiplos no mesmo endereço e horário foram consolidados em uma única
                    viagem. O KM oficial e combustível foram cobrados uma só vez pelo grupo,
                    economizando{' '}
                    <strong className="text-white">
                      {metricsSummary.jointSavedKm.toLocaleString('pt-BR', {
                        minimumFractionDigits: 1,
                        maximumFractionDigits: 1,
                      })}{' '}
                      km
                    </strong>{' '}
                    (R$ {metricsSummary.jointSavedFuelCost.toFixed(2)} reembolsáveis).
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TELEMETRIA & OCORRÊNCIAS DE ROTA (DESVIOS E PARADAS) */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-xl bg-[#0A1128] border border-blue-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-blue-500/20 text-blue-400 border border-blue-500/40">
                  <Navigation className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Telemetria GPS Real
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    {filteredItems.filter((i) => i.isRealTelemetry).length} de{' '}
                    {filteredItems.length} entrega(s) com GPS 100% real
                  </p>
                </div>
              </div>
              <Badge className="bg-blue-500/20 text-blue-300 border-blue-500/40 text-xs font-bold font-mono px-2.5 py-1">
                {filteredItems.length > 0 &&
                filteredItems.filter((i) => i.isRealTelemetry).length === filteredItems.length
                  ? '100% Real'
                  : `${filteredItems.filter((i) => i.isRealTelemetry).length}/${filteredItems.length} Real`}
              </Badge>
            </div>

            <div className="p-3 rounded-xl bg-[#0A1128] border border-amber-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40">
                  <Clock className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Paradas Fora da Rota
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    Interrupções não programadas registradas via telemetria
                  </p>
                </div>
              </div>
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-xs font-bold font-mono px-2.5 py-1">
                {metricsSummary.totalStops} parada(s)
              </Badge>
            </div>

            <div className="p-3 rounded-xl bg-[#0A1128] border border-rose-500/30 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-rose-500/20 text-rose-400 border border-rose-500/40">
                  <Compass className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider">
                    Desvios (&gt;600m)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    KM separado (não entra no cálculo de combustível)
                  </p>
                </div>
              </div>
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-xs font-bold font-mono px-2.5 py-1">
                {metricsSummary.totalDeviations} desvio(s) (&gt;600m)
              </Badge>
            </div>
          </div>

          {/* FILTROS E PESQUISA */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
            <div className="flex flex-wrap items-center gap-2">
              {/* Filtro Período */}
              <Select
                value={periodFilter}
                onValueChange={(v: 'all' | 'today' | 'week' | 'month' | 'custom') => {
                  setPeriodFilter(v)
                  if (v === 'custom' && (!customStartDate || !customEndDate)) {
                    validateAndSetDates(
                      customStartDate || defaultCustomDates.startDate,
                      customEndDate || defaultCustomDates.endDate,
                    )
                  }
                }}
              >
                <SelectTrigger className="h-8 w-36 text-xs bg-[#0E1738] border-[#1E2B58] text-white">
                  <Calendar className="h-3.5 w-3.5 mr-1.5 text-[#60A5FA]" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-[#0A1128] border-[#1E2B58] text-slate-200">
                  <SelectItem value="all">Todo Histórico</SelectItem>
                  <SelectItem value="today">Hoje</SelectItem>
                  <SelectItem value="week">Últimos 7 dias</SelectItem>
                  <SelectItem value="month">Este Mês</SelectItem>
                  <SelectItem value="custom">Personalizado</SelectItem>
                </SelectContent>
              </Select>

              {/* Filtro Status */}
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-8 w-44 text-xs bg-[#0E1738] border-[#1E2B58] text-white">
                  <Filter className="h-3.5 w-3.5 mr-1.5 text-[#FF6B35]" />
                  <SelectValue placeholder="Status da Entrega" />
                </SelectTrigger>
                <SelectContent className="bg-[#0A1128] border-[#1E2B58] text-slate-200">
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="delivered">✓ Entregue</SelectItem>
                  <SelectItem value="in_transit">🛵 Em Rota</SelectItem>
                  <SelectItem value="partial">⚠️ Rotas Parciais (Erro/Ausente)</SelectItem>
                  <SelectItem value="assigned">Atribuídas / Preparando</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Input de Busca */}
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <Input
                placeholder="Buscar código, cliente ou rua..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-8 pl-8 text-xs bg-[#0E1738] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg"
              />
            </div>
          </div>

          {/* PAINEL DE PERÍODO PERSONALIZADO (DE / ATÉ) */}
          {periodFilter === 'custom' && (
            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">De:</span>
                  <Input
                    type="date"
                    value={customStartDate || defaultCustomDates.startDate}
                    onChange={(e) =>
                      validateAndSetDates(
                        e.target.value,
                        customEndDate || defaultCustomDates.endDate,
                      )
                    }
                    className="h-8 w-36 text-xs bg-[#0E1738] border-[#1E2B58] text-white rounded-lg focus-visible:ring-1 focus-visible:ring-[#60A5FA]"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-slate-300">Até:</span>
                  <Input
                    type="date"
                    value={customEndDate || defaultCustomDates.endDate}
                    onChange={(e) =>
                      validateAndSetDates(
                        customStartDate || defaultCustomDates.startDate,
                        e.target.value,
                      )
                    }
                    className="h-8 w-36 text-xs bg-[#0E1738] border-[#1E2B58] text-white rounded-lg focus-visible:ring-1 focus-visible:ring-[#60A5FA]"
                  />
                </div>

                <span className="text-[11px] text-slate-400 flex items-center gap-1">
                  <Info className="h-3.5 w-3.5 text-[#60A5FA]" />
                  <span>
                    Janela operacional oficial: 05:00 do 1º dia às 23:59:59 do último dia (Horário
                    de Brasília)
                  </span>
                </span>
              </div>

              {customDateError && (
                <div className="flex items-center gap-1.5 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2.5 py-1.5 rounded-lg">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>{customDateError}</span>
                </div>
              )}
            </div>
          )}

          {/* TABELA DETALHADA DE HISTÓRICO DE CADA ENTREGA */}
          <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[#1E2B58] bg-[#0A1128] text-slate-400 uppercase tracking-wider text-[10px]">
                    <th className="py-2.5 px-3 font-semibold">Data / Rota</th>
                    <th className="py-2.5 px-3 font-semibold">Código / Cliente</th>
                    <th className="py-2.5 px-3 font-semibold">Status</th>
                    <th className="py-2.5 px-3 font-semibold text-right">KM Real Rodado</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Combustível</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Parada Fora Rota</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Desvios (Episódios)</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Desvio (&gt;600m)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2B58]/60 text-slate-200">
                  {filteredItems.length === 0 && !metricsSummary.hasManualAdjustment ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Nenhuma entrega encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    <>
                      {metricsSummary.hasManualAdjustment && (
                        <tr className="bg-amber-950/20 border-b border-amber-500/30">
                          <td className="py-2.5 px-3 font-mono text-[11px] text-amber-300">
                            {metricsSummary.manualAdjustmentPeriodLabel || '01/10–22/10'}
                            <span className="block text-[10px] text-amber-400/80">
                              Período Mensal
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="flex items-center gap-1.5">
                              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/40 text-[10px] font-bold">
                                Ajuste manual do período
                              </Badge>
                            </div>
                            <span className="text-[11px] text-amber-200/90 font-medium block">
                              Ajuste manual determinado pelo administrador (+
                              {metricsSummary.manualAdjustmentDeltaKm?.toFixed(1)} km para fechar
                              731 km)
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge
                              variant="outline"
                              className="text-[10px] font-bold border-amber-500/40 text-amber-300 bg-amber-500/10"
                            >
                              Aprovado Admin
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-300">
                            +{metricsSummary.manualAdjustmentDeltaKm?.toFixed(1)} km
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <span className="font-mono font-bold text-amber-400 block">
                              R${' '}
                              {(
                                ((metricsSummary.manualAdjustmentDeltaKm || 0) /
                                  fuelParams.consumptionKml) *
                                fuelParams.pricePerLiter
                              ).toFixed(2)}
                            </span>
                            <span className="text-[10px] text-slate-400 font-mono">
                              ~
                              {(
                                (metricsSummary.manualAdjustmentDeltaKm || 0) /
                                fuelParams.consumptionKml
                              ).toFixed(2)}{' '}
                              L
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-500">-</td>
                          <td className="py-2.5 px-3 text-center text-slate-500 font-mono">
                            0 ep.
                          </td>
                          <td className="py-2.5 px-3 text-center text-slate-500">-</td>
                          <td className="py-2.5 px-3 text-right text-slate-500 text-[10px]">
                            Ajuste Global
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                  {filteredItems.length > 0 &&
                    filteredItems.map((item) => (
                      <tr
                        key={item.order.id}
                        className="hover:bg-[#121E46]/50 transition-colors cursor-pointer"
                        onClick={() => setSelectedItemForDetails(item)}
                      >
                        {/* Data / Rota */}
                        <td className="py-2.5 px-3 font-mono text-[11px] text-slate-300">
                          {item.dateStr}
                          {item.order.sequence ? (
                            <span className="block text-[10px] text-slate-500">
                              Parada #{item.order.sequence}
                            </span>
                          ) : null}
                        </td>

                        {/* Código / Cliente */}
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-[#60A5FA] block">
                              {item.trackingCode}
                            </span>
                            {item.isJointDelivery && (
                              <Badge
                                variant="outline"
                                className={`text-[9px] px-1.5 py-0 font-medium flex items-center gap-1 border ${
                                  item.isJointPrimary
                                    ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                    : 'bg-purple-500/15 text-purple-300 border-purple-500/30'
                                }`}
                                title={
                                  item.isJointPrimary
                                    ? `Entrega principal de grupo de ${item.jointGroupSize || 2} pedidos no mesmo ponto (${(item.jointPartnerTrackingCodes || []).join(', ')})`
                                    : `Entrega conjunta agregada ao pedido ${item.jointPrimaryTrackingCode}. Viagem computada no pedido principal.`
                                }
                              >
                                <Package className="h-2.5 w-2.5" />
                                <span>
                                  {item.isJointPrimary
                                    ? `Conjunta (${item.jointGroupSize || 2})`
                                    : 'Conjunta'}
                                </span>
                              </Badge>
                            )}
                          </div>
                          <span className="text-[11px] text-slate-300 font-medium truncate max-w-[180px] block">
                            {item.customerName}
                          </span>
                        </td>

                        {/* Status */}
                        <td className="py-2.5 px-3">
                          <Badge
                            variant="outline"
                            className={`text-[10px] font-bold ${item.statusColor}`}
                          >
                            {item.statusLabel}
                          </Badge>
                        </td>

                        {/* KM Real Rodado (Oficial) */}
                        <td className="py-2.5 px-3 text-right font-mono font-semibold text-white">
                          <div className="flex items-center justify-end gap-1.5">
                            {item.isJointSecondary ? (
                              <span
                                className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300 font-sans border border-purple-500/30 font-medium cursor-help"
                                title={`km já contabilizado na entrega conjunta (${item.jointPrimaryTrackingCode})`}
                              >
                                km já contabilizado na entrega conjunta
                              </span>
                            ) : (
                              <>
                                {!item.isRealTelemetry && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-slate-700/60 text-slate-300 font-sans border border-slate-600"
                                    title="Sem pontos de GPS gravados. KM estimado do planejamento."
                                  >
                                    ~estimado
                                  </span>
                                )}
                                {item.isRealTelemetry && (
                                  <span
                                    className="text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-[#60A5FA] font-sans border border-blue-500/30 font-bold"
                                    title="KM 100% Real calculado por telemetria GPS"
                                  >
                                    100% real
                                  </span>
                                )}
                              </>
                            )}
                            <span>
                              {item.kmRodado.toLocaleString('pt-BR', {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}{' '}
                              km
                            </span>
                          </div>
                          {item.hasReturnKm && !item.isJointSecondary && (
                            <span className="block text-[9px] text-[#22C55E]">c/ retorno</span>
                          )}
                          {item.isJointSecondary && (
                            <span className="block text-[9px] text-purple-400">
                              (ref: {item.jointPrimaryTrackingCode})
                            </span>
                          )}
                        </td>

                        {/* Combustível Gasto */}
                        <td className="py-2.5 px-3 text-right">
                          <span className="font-mono font-bold text-amber-400 block">
                            R$ {item.fuelCost.toFixed(2)}
                          </span>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ~{item.litersSpent.toFixed(2)} L
                          </span>
                        </td>

                        {/* Paradas Fora da Rota */}
                        <td className="py-2.5 px-3 text-center">
                          {item.unexpectedStopsCount > 0 ? (
                            <Badge
                              className="bg-amber-500/20 text-amber-400 border-amber-500/40 text-[10px] font-mono font-bold"
                              title="Parada não programada detectada"
                            >
                              🛑 {item.unexpectedStopsCount}
                            </Badge>
                          ) : (
                            <span className="text-slate-500 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Desvios (Episódios e Distância Máxima - NUNCA km somado) */}
                        <td className="py-2.5 px-3 text-center">
                          {item.offRouteCount > 0 ? (
                            <span
                              className="font-mono text-[11px] text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 inline-block"
                              title="Contagem de episódios de desvio de rota (não reembolsável, não entra em km pago)"
                            >
                              {item.offRouteCount} ep.
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-mono">0 ep.</span>
                          )}
                        </td>

                        {/* Desvios de Rota */}
                        <td className="py-2.5 px-3 text-center">
                          {item.offRouteCount > 0 ? (
                            <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/40 text-[10px] font-mono font-bold">
                              🚨 {item.offRouteCount}
                            </Badge>
                          ) : (
                            <span className="text-slate-500 text-[11px]">-</span>
                          )}
                        </td>

                        {/* Ação */}
                        <td className="py-2.5 px-3 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedItemForDetails(item)
                            }}
                            className="h-7 w-7 p-0 text-slate-400 hover:text-white hover:bg-[#1E2B58]"
                            title="Ver detalhes da entrega e telemetria"
                          >
                            <Maximize2 className="h-3.5 w-3.5" />
                          </Button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* MODAL SECUNDÁRIO: DETALHES COMPLETOS DE UMA ENTREGA */}
        {selectedItemForDetails && (
          <Dialog
            open={Boolean(selectedItemForDetails)}
            onOpenChange={(open) => !open && setSelectedItemForDetails(null)}
          >
            <DialogContent className="max-w-md bg-[#0A1128] text-slate-100 border-[#1E2B58]">
              <DialogHeader>
                <DialogTitle className="text-base font-bold text-white flex items-center justify-between">
                  <span>Entrega {selectedItemForDetails.trackingCode}</span>
                  <Badge variant="outline" className={selectedItemForDetails.statusColor}>
                    {selectedItemForDetails.statusLabel}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="text-xs text-slate-400">
                  Registrada em {selectedItemForDetails.dateStr}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3 text-xs">
                {/* Cliente & Endereço */}
                <div className="p-3 rounded-lg bg-[#0E1738] border border-[#1E2B58] space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Destino / Cliente
                  </span>
                  <p className="font-semibold text-white">{selectedItemForDetails.customerName}</p>
                  <p className="text-slate-300 text-[11px] flex items-start gap-1 mt-0.5">
                    <MapPin className="h-3.5 w-3.5 text-rose-400 shrink-0 mt-0.5" />
                    <span>{selectedItemForDetails.customerAddress}</span>
                  </p>
                </div>

                {/* Bloco de Entrega Conjunta se aplicável */}
                {selectedItemForDetails.isJointDelivery && (
                  <div className="p-3 rounded-lg bg-purple-950/30 border border-purple-500/30 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <Package className="h-4 w-4 text-purple-400" />
                        <span className="font-bold text-purple-200">
                          📦 Entrega conjunta ({selectedItemForDetails.jointGroupSize || 2} pedidos
                          no mesmo ponto)
                        </span>
                      </div>
                      <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px]">
                        {selectedItemForDetails.isJointPrimary
                          ? 'Pedido Principal'
                          : 'Entrega Agregada'}
                      </Badge>
                    </div>
                    {selectedItemForDetails.isJointSecondary ? (
                      <p className="text-[11px] text-purple-200/90 leading-relaxed">
                        <strong className="text-white">
                          km já contabilizado na entrega conjunta:
                        </strong>{' '}
                        Este pedido foi entregue no mesmo endereço e viagem do pedido principal{' '}
                        <strong className="text-purple-300 font-mono">
                          {selectedItemForDetails.jointPrimaryTrackingCode}
                        </strong>
                        . O entregador realizou apenas um deslocamento físico até o cliente,
                        evitando cobrança duplicada na telemetria.
                      </p>
                    ) : (
                      <p className="text-[11px] text-purple-200/90 leading-relaxed">
                        Este é o pedido principal que consolida a quilometragem da viagem ao
                        endereço. Pedidos agregados no mesmo momento:{' '}
                        <strong className="text-purple-300 font-mono">
                          {(selectedItemForDetails.jointPartnerTrackingCodes || []).join(', ')}
                        </strong>
                        .
                      </p>
                    )}
                  </div>
                )}

                {/* Métricas de KM e Combustível */}
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="p-3 rounded-lg bg-[#0E1738] border border-[#1E2B58]">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">
                      KM Real Oficial (Reembolsável)
                    </span>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-lg font-black text-white font-mono">
                        {selectedItemForDetails.kmRodado} km
                      </span>
                      {selectedItemForDetails.isJointSecondary ? (
                        <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[9px] px-1 font-bold">
                          Conjunta
                        </Badge>
                      ) : selectedItemForDetails.isRealTelemetry ? (
                        <Badge className="bg-blue-500/20 text-[#60A5FA] border-blue-500/30 text-[9px] px-1 font-bold">
                          100% Real
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[9px] px-1 text-slate-400 border-slate-600"
                        >
                          ~estimado
                        </Badge>
                      )}
                    </div>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      {selectedItemForDetails.isJointSecondary
                        ? `Consolidado no pedido ${selectedItemForDetails.jointPrimaryTrackingCode}`
                        : selectedItemForDetails.isRealTelemetry
                          ? 'Telemetria GPS consolidada do lote'
                          : `Planejado: ${selectedItemForDetails.plannedKm} km`}
                    </span>
                  </div>

                  <div className="p-3 rounded-lg bg-[#0E1738] border border-[#1E2B58]">
                    <span className="text-[10px] text-slate-400 uppercase font-bold block">
                      Combustível Oficial
                    </span>
                    <span className="text-lg font-black text-amber-400 font-mono mt-0.5 block">
                      R$ {selectedItemForDetails.fuelCost.toFixed(2)}
                    </span>
                    <span className="text-[9px] text-slate-400 block mt-0.5">
                      {selectedItemForDetails.isJointSecondary
                        ? 'R$ 0,00 (viagem já reembolsada no grupo)'
                        : `~${selectedItemForDetails.litersSpent} L @ R$ ${fuelParams.pricePerLiter.toFixed(2)}/L`}
                    </span>
                  </div>
                </div>

                {/* Bloco de Desvios e Paradas fora da Rota (Exibido à parte, NÃO somado no oficial) */}
                <div className="p-3 rounded-lg bg-[#0E1738] border border-rose-500/20 text-xs">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] text-rose-400 uppercase font-bold block">
                        Desvios & Paradas Fora da Rota (Não Reembolsável)
                      </span>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Quilometragem percorrida fora do corredor oficial de entrega.
                      </p>
                    </div>
                    <div className="text-right">
                      <span className="text-base font-black font-mono text-rose-400 block">
                        +
                        {selectedItemForDetails.deviationKm.toLocaleString('pt-BR', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{' '}
                        km
                      </span>
                      <span className="text-[9px] text-slate-400">Descontado da rota</span>
                    </div>
                  </div>
                </div>

                {/* Auditoria Matemática e Fechamento de Telemetria */}
                <div className="p-3 rounded-lg bg-[#0E1738] border border-blue-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-[#60A5FA] block">
                      Auditoria de Telemetria & GPS
                    </span>
                    <Badge
                      variant="outline"
                      className="text-[9px] bg-[#0A1128] text-slate-300 border-[#1E2B58]"
                    >
                      Fechamento 100% Auditável
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 font-mono text-center pt-1 border-t border-[#1E2B58]">
                    <div className="bg-[#0A1128] p-1.5 rounded">
                      <span className="text-[9px] text-slate-400 block font-sans">Oficial</span>
                      <span className="text-xs font-bold text-white">
                        {selectedItemForDetails.kmRodado.toLocaleString('pt-BR', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{' '}
                        km
                      </span>
                    </div>
                    <div className="bg-[#0A1128] p-1.5 rounded">
                      <span className="text-[9px] text-slate-400 block font-sans">Desvios</span>
                      <span className="text-xs font-bold text-rose-400">
                        {selectedItemForDetails.deviationKm.toFixed(1)} km
                      </span>
                    </div>
                    <div className="bg-[#0A1128] p-1.5 rounded">
                      <span className="text-[9px] text-slate-400 block font-sans">
                        Total Rodado
                      </span>
                      <span className="text-xs font-bold text-[#22C55E]">
                        {selectedItemForDetails.totalGpsKm.toLocaleString('pt-BR', {
                          minimumFractionDigits: 1,
                          maximumFractionDigits: 1,
                        })}{' '}
                        km
                      </span>
                    </div>
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5 pt-1">
                    <div className="flex justify-between">
                      <span>Rateio Proporcional do Lote:</span>
                      <span className="text-slate-200 font-mono">
                        Baseado na distância planejada da entrega
                      </span>
                    </div>
                    {selectedItemForDetails.discardedNoiseKm > 0 && (
                      <div className="flex justify-between">
                        <span>KM Descartado por Ruído:</span>
                        <span className="text-slate-200 font-mono">
                          {selectedItemForDetails.discardedNoiseKm.toFixed(2)} km
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Auditoria de Ocorrências e Telemetria */}
                <div className="p-3 rounded-lg bg-[#0E1738] border border-[#1E2B58] space-y-2">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">
                    Eventos de Telemetria Vinculados
                  </span>
                  {selectedItemForDetails.events.length === 0 ? (
                    <p className="text-slate-400 text-[11px] italic">
                      Nenhum desvio ou parada fora da rota registrado nesta entrega.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {selectedItemForDetails.events.map((ev) => (
                        <div
                          key={ev.id}
                          className="p-2 rounded bg-[#070D1E] border border-[#1E2B58] text-[11px]"
                        >
                          <div className="flex items-center justify-between font-semibold">
                            <span
                              className={
                                ev.event_type === 'route_deviation'
                                  ? 'text-rose-400'
                                  : 'text-amber-400'
                              }
                            >
                              {ev.event_type === 'route_deviation'
                                ? '🚨 Desvio de Rota (>600m)'
                                : '🛑 Parada Não Prevista'}
                            </span>
                            <span className="text-slate-500 font-mono text-[10px]">
                              {new Intl.DateTimeFormat('pt-BR', {
                                timeZone: 'America/Sao_Paulo',
                                hour: '2-digit',
                                minute: '2-digit',
                                second: '2-digit',
                              }).format(new Date(ev.created))}
                            </span>
                          </div>
                          {ev.notes && (
                            <p className="text-slate-300 text-[10px] mt-0.5">{ev.notes}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <Button
                  size="sm"
                  onClick={() => setSelectedItemForDetails(null)}
                  className="bg-[#0052CC] hover:bg-[#1D4ED8] text-white text-xs"
                >
                  Fechar Detalhes
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default CourierDeliveryHistoryModal
