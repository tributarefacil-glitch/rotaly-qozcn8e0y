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
} from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import { fuelAccountService } from '@/services/fuelAccountService'
import { DEVIATION_THRESHOLD_METERS, haversineDistanceMeters } from '@/lib/telemetryKmEngine'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'

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
  initialPeriodFilter?: 'all' | 'today' | 'week' | 'month'
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
  initialPeriodFilter = 'month',
  advances: externalAdvances,
}) => {
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month'>(
    initialPeriodFilter,
  )
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
    }
  }, [isOpen, initialPeriodFilter])
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemForDetails, setSelectedItemForDetails] =
    useState<CourierDeliveryHistoryItem | null>(null)
  const [fetchedLocations, setFetchedLocations] = useState<LocationRecord[]>([])
  const [isLoadingLocations, setIsLoadingLocations] = useState(false)

  // Carregar locations caso não tenham sido passadas externamente
  React.useEffect(() => {
    if (!isOpen || !courier?.id) return
    if (externalLocations && externalLocations.length > 0) {
      setFetchedLocations([])
      return
    }

    let isMounted = true
    setIsLoadingLocations(true)
    // Buscar locations do entregador com limite suficiente para cobrir o histórico completo
    deliveryService
      .getLatestLocations(`user_id = '${courier.id}'`)
      .then((locs) => {
        if (isMounted) {
          setFetchedLocations(locs)
        }
      })
      .catch((err) => {
        console.warn('Erro ao carregar telemetria de GPS para histórico:', err)
      })
      .finally(() => {
        if (isMounted) setIsLoadingLocations(false)
      })

    return () => {
      isMounted = false
    }
  }, [isOpen, courier?.id, externalLocations])

  const allLocations = useMemo(() => {
    return externalLocations && externalLocations.length > 0 ? externalLocations : fetchedLocations
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

  // Lista consolidada de adiantamentos do entregador
  const allCourierAdvances = useMemo(() => {
    if (externalAdvances && externalAdvances.length > 0) {
      return externalAdvances.filter((a) => a.courier_id === courier?.id)
    }
    if (fuelAccount?.advances && fuelAccount.advances.length > 0) {
      return fuelAccount.advances.filter((a) => a.courier_id === courier?.id)
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
  }, [externalAdvances, fuelAccount, courier?.id])

  // Calcular o carryOverBalance acumulado até o mês anterior
  const carryOverBalance = useMemo(() => {
    if (!courier?.id) return 0
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
    fuelAccount?.carryOverBalance,
    allCourierAdvances,
    orders,
    officialSettings,
    settings,
  ])

  // Executar o motor consolidado de telemetria e combustível (o mesmo motor do useCourierFuelMetrics)
  // Agrupa por lotes de rota, desconta desvios/paradas de rota e rateia proporcionalmente sem duplicações
  // Passamos `orders` diretamente para manter o contexto completo dos pedidos, com filtro periodFilter='all'
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
        // Verificar se foi na base padrão (Pilar/Caxias ou start_base)
        const baseLat = -22.7001402
        const baseLng = -43.2982834
        const distToBase = haversineDistanceMeters(ev.lat, ev.lng, baseLat, baseLng)
        if (distToBase < DEVIATION_THRESHOLD_METERS) {
          return false
        }
      }
      return true
    })
  }, [offRouteEvents, courier])

  // Processar itens detalhados de cada entrega utilizando o rateio consolidado do motor
  const historyItems: CourierDeliveryHistoryItem[] = useMemo(() => {
    if (!courier || !consolidatedMetrics) return []

    // Mapear cada orderCalculation gerado pelo motor consolidado
    return consolidatedMetrics.orderCalculations.map((calc) => {
      const o = calc.order
      const kmOficial = calc.officialKm
      const liters = calc.litersSpent
      const cost = calc.fuelCost

      // Eventos associados a esta entrega específica
      const associatedEvents = courierEvents.filter(
        (ev) =>
          ev.order_id === o.id ||
          (ev.courier_id === courier.id &&
            ev.created >= (o.route_started_at || o.created) &&
            ev.created <= (o.actual_arrival || o.updated || o.created)),
      )
      const offRouteCount = Math.max(
        calc.offRouteCount,
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
        if (isDesistenciaCliente && (o.route_started_at || o.actual_arrival)) {
          statusLabel = '⚠️ Desistência do Cliente'
          statusColor = 'bg-amber-500/15 text-amber-400 border-amber-500/30'
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

      const dateObj = new Date(o.created || Date.now())
      const dateStr = dateObj.toLocaleDateString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })

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
        isRealTelemetry: calc.isRealTelemetry,
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
        isJointSecondary: calc.isJointSecondary,
        jointGroupSize: calc.jointGroupSize,
        jointPrimaryTrackingCode: calc.jointPrimaryTrackingCode,
        jointPartnerTrackingCodes: calc.jointPartnerTrackingCodes,
        events:
          associatedEvents.length > 0
            ? associatedEvents
            : courierEvents.filter((ev) => ev.order_id === o.id),
      }
    })
  }, [courier, consolidatedMetrics, courierEvents])

  // Aplicar filtros de período, status e busca
  const filteredItems = useMemo(() => {
    const now = new Date()

    return historyItems.filter((item) => {
      // Filtro de período
      if (periodFilter === 'today') {
        const isToday =
          item.dateObj.getDate() === now.getDate() &&
          item.dateObj.getMonth() === now.getMonth() &&
          item.dateObj.getFullYear() === now.getFullYear()
        if (!isToday) return false
      } else if (periodFilter === 'week') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        if (item.dateObj < sevenDaysAgo) return false
      } else if (periodFilter === 'month') {
        const isCurrentMonth =
          item.dateObj.getMonth() === now.getMonth() &&
          item.dateObj.getFullYear() === now.getFullYear()
        if (!isCurrentMonth) return false
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
  }, [historyItems, periodFilter, statusFilter, searchQuery])

  // Totais do período filtrado com CARRY-OVER contínuo
  const metricsSummary = useMemo(() => {
    const now = new Date()

    // Filtrar adiantamentos de acordo com o periodFilter
    const filteredAdvances = allCourierAdvances.filter((a) => {
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

    const totalAdiantado = filteredAdvances.reduce((s, a) => s + (Number(a.amount) || 0), 0)

    // Regra "linha = cabeçalho": soma exata das linhas da tabela do período
    const totalKm = filteredItems.reduce((acc, i) => acc + i.kmRodado, 0)
    const totalFuelCost = filteredItems.reduce((acc, i) => acc + i.fuelCost, 0)
    const totalLiters = filteredItems.reduce((acc, i) => acc + i.litersSpent, 0)
    const totalDeviations = filteredItems.reduce((acc, i) => acc + i.offRouteCount, 0)
    const totalStops = filteredItems.reduce((acc, i) => acc + i.unexpectedStopsCount, 0)

    // Saldo:
    // Se periodFilter === 'month', saldo = carryOverBalance + adiantamentos do mês - gasto do mês
    // Se periodFilter === 'all', saldo = total adiantamentos históricos - total gasto histórico
    let saldoContaCorrente = totalAdiantado - totalFuelCost
    if (periodFilter === 'month') {
      saldoContaCorrente = carryOverBalance + totalAdiantado - totalFuelCost
    }

    return {
      totalKm: Number(totalKm.toFixed(1)),
      totalFuelCost: Number(totalFuelCost.toFixed(2)),
      totalLiters: Number(totalLiters.toFixed(2)),
      totalDeviations,
      totalStops,
      saldoContaCorrente: Number(saldoContaCorrente.toFixed(2)),
      totalAdiantado: Number(totalAdiantado.toFixed(2)),
      totalDeliveries: filteredItems.length,
      carryOverBalance: Number(carryOverBalance.toFixed(2)),
    }
  }, [allCourierAdvances, periodFilter, filteredItems, carryOverBalance])

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
      'KM em Desvios e Paradas (Não Reembolsável)',
      'KM Total Rodado (Odômetro Real)',
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
      item.kmRodado.toFixed(1),
      item.deviationKm.toFixed(1),
      item.totalGpsKm.toFixed(1),
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
                    {fuelParams.consumptionKml.toFixed(1)} km/L @ R${' '}
                    {fuelParams.pricePerLiter.toFixed(2)}/L
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
                  KM Real Oficial
                </span>
                <Navigation className="h-4 w-4 text-[#FF6B35]" />
              </div>
              <p className="text-xl sm:text-2xl font-black font-mono text-white mt-1">
                {metricsSummary.totalKm}{' '}
                <span className="text-xs font-normal text-slate-400">km</span>
              </p>
              <span className="text-[10px] text-emerald-400/90 block mt-0.5 font-medium">
                Descontados desvios e paradas fora da rota
              </span>
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
              <p className="text-xl sm:text-2xl font-black font-mono text-amber-400 mt-1">
                R$ {metricsSummary.totalFuelCost.toFixed(2)}
              </p>
              <span className="text-[10px] text-slate-400 block mt-0.5">
                ~{metricsSummary.totalLiters} L consumidos
              </span>
            </div>
          </div>

          {/* ALERTA INFORMATIVO DE ENTREGAS CONJUNTAS CONSOLIDADAS */}
          {consolidatedMetrics && consolidatedMetrics.jointDeliveriesConsolidatedCount > 0 && (
            <div className="p-3.5 rounded-xl bg-purple-950/20 border border-purple-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-purple-500/20 text-purple-300 border border-purple-500/40 shrink-0">
                  <Package className="h-4 w-4" />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <span>📦 Entregas Conjuntas Detectadas no Mesmo Ponto</span>
                    <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/40 text-[10px] font-mono">
                      {consolidatedMetrics.jointDeliveriesConsolidatedCount} pedido(s) agrupado(s)
                    </Badge>
                  </h4>
                  <p className="text-[11px] text-purple-200/80 mt-0.5">
                    Pedidos múltiplos no mesmo endereço e horário foram consolidados em uma única
                    viagem. O KM oficial e combustível foram cobrados uma só vez pelo grupo,
                    economizando{' '}
                    <strong className="text-white">
                      {consolidatedMetrics.jointSavedKm.toFixed(1)} km
                    </strong>{' '}
                    (R$ {consolidatedMetrics.jointSavedFuelCost.toFixed(2)} reembolsáveis).
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
                100% Real
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
                onValueChange={(v: 'all' | 'today' | 'week' | 'month') => setPeriodFilter(v)}
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
                    <th className="py-2.5 px-3 font-semibold text-center">KM Desvios</th>
                    <th className="py-2.5 px-3 font-semibold text-center">Desvio (&gt;600m)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2B58]/60 text-slate-200">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-400">
                        Nenhuma entrega encontrada para os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
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
                            <span>{item.kmRodado.toFixed(1)} km</span>
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

                        {/* KM em Desvios (destacado à parte, não somado) */}
                        <td className="py-2.5 px-3 text-center">
                          {item.deviationKm > 0 ? (
                            <span
                              className="font-mono text-[11px] text-rose-400 font-bold bg-rose-500/10 px-2 py-0.5 rounded border border-rose-500/20 inline-block"
                              title="KM gasto em desvios e paradas fora da rota (não reembolsável)"
                            >
                              +{item.deviationKm.toFixed(1)} km
                            </span>
                          ) : (
                            <span className="text-slate-500 text-[11px] font-mono">0.0 km</span>
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
                    ))
                  )}
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
                        +{selectedItemForDetails.deviationKm.toFixed(1)} km
                      </span>
                      <span className="text-[9px] text-slate-400">Descontado da rota</span>
                    </div>
                  </div>
                </div>

                {/* Auditoria Matemática e Fechamento de Telemetria */}
                <div className="p-3 rounded-lg bg-[#0E1738] border border-blue-500/30 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-bold text-[#60A5FA] block">
                      Auditoria de Telemetria & Odômetro
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
                        {selectedItemForDetails.kmRodado.toFixed(1)} km
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
                        {selectedItemForDetails.totalGpsKm.toFixed(1)} km
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
