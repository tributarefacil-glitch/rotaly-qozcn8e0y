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
import { calculateRealKmForOrder, sanitizeGpsPoints } from '@/lib/telemetryKmEngine'

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
}) => {
  const [periodFilter, setPeriodFilter] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemForDetails, setSelectedItemForDetails] =
    useState<CourierDeliveryHistoryItem | null>(null)
  const [fetchedLocations, setFetchedLocations] = useState<LocationRecord[]>([])
  const [isLoadingLocations, setIsLoadingLocations] = useState(false)

  // Carregar locations caso não tenham sido passadas externamente
  React.useEffect(() => {
    if (!isOpen || !courier?.id) return
    if (externalLocations && externalLocations.length > 0) return

    let isMounted = true
    setIsLoadingLocations(true)
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
    return deliveryService.getVehicleFuelParams(settings, courier?.vehicle_type)
  }, [settings, courier])

  // Filtrar as ordens vinculadas ao entregador que tenham iniciado rota ou finalizado
  const courierOrders = useMemo(() => {
    if (!courier?.id) return []
    return orders.filter(
      (o) =>
        o.courier_id === courier.id &&
        (o.route_started === true ||
          o.status === 'delivered' ||
          o.status === 'in_transit' ||
          o.status === 'address_error' ||
          o.status === 'client_absent' ||
          o.status === 'assigned' ||
          o.status === 'cancelled'),
    )
  }, [orders, courier])

  // Eventos de desvio e paradas do entregador
  const courierEvents = useMemo(() => {
    if (!courier?.id) return []
    return offRouteEvents.filter((ev) => ev.courier_id === courier.id)
  }, [offRouteEvents, courier])

  // Processar itens detalhados de cada entrega utilizando o motor de telemetria GPS 100% REAL
  const historyItems: CourierDeliveryHistoryItem[] = useMemo(() => {
    if (!courier) return []

    return courierOrders.map((o) => {
      // Cálculo de KM 100% Real por telemetria de GPS, com desconto de desvios e paradas fora da rota
      const realTelemetry = calculateRealKmForOrder({
        order: o,
        allCourierLocations: allLocations,
        courierEvents,
        allCourierOrders: courierOrders,
      })

      const kmOficial = realTelemetry.officialRealKm
      const liters = fuelParams.consumptionKml > 0 ? kmOficial / fuelParams.consumptionKml : 0
      const cost = liters * fuelParams.pricePerLiter

      // Eventos associados a esta entrega específica
      const associatedEvents = courierEvents.filter(
        (ev) =>
          ev.order_id === o.id ||
          (ev.courier_id === courier.id &&
            ev.created >= (o.route_started_at || o.created) &&
            ev.created <= (o.actual_arrival || o.updated || o.created)),
      )
      const offRouteCount = Math.max(
        realTelemetry.offRouteCount,
        associatedEvents.filter((ev) => ev.event_type === 'route_deviation').length,
      )
      const unexpectedStopsCount = Math.max(
        realTelemetry.unexpectedStopsCount,
        associatedEvents.filter((ev) => ev.event_type === 'unexpected_stop').length,
      )

      let statusLabel = 'Em Espera'
      let statusColor = 'bg-slate-500/15 text-slate-300 border-slate-700'

      if (o.status === 'delivered') {
        statusLabel = '✓ Entregue'
        statusColor = 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
      } else if (o.status === 'in_transit') {
        statusLabel = '🛵 Em Rota'
        statusColor = 'bg-amber-500/15 text-amber-400 border-amber-500/30'
      } else if (o.status === 'address_error') {
        statusLabel = '⚠️ Erro de Endereço (Rota Parcial)'
        statusColor = 'bg-rose-500/15 text-rose-400 border-rose-500/30'
      } else if (o.status === 'client_absent') {
        statusLabel = '⚠️ Cliente Ausente (Rota Parcial)'
        statusColor = 'bg-orange-500/15 text-orange-400 border-orange-500/30'
      } else if (o.status === 'cancelled') {
        statusLabel = 'Cancelado'
        statusColor = 'bg-slate-700/30 text-slate-400 border-slate-700'
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
        isRealTelemetry: realTelemetry.isRealTelemetry,
        deviationKm: realTelemetry.deviationKm,
        totalGpsKm: realTelemetry.totalGpsKm,
        discardedNoiseKm: realTelemetry.discardedNoiseKm,
        samplingCurvatureFactor: realTelemetry.samplingCurvatureFactor,
        auditNotes: realTelemetry.auditNotes,
        plannedKm: realTelemetry.plannedKm,
        gpsPointsCount: realTelemetry.gpsPointsCount,
        filteredNoisePointsCount: realTelemetry.filteredNoisePointsCount,
        hasReturnKm: realTelemetry.hasReturnKm,
        fuelCost: Number(cost.toFixed(2)),
        litersSpent: Number(liters.toFixed(2)),
        offRouteCount,
        unexpectedStopsCount,
        events:
          associatedEvents.length > 0
            ? associatedEvents
            : courierEvents.filter((ev) => ev.order_id === o.id),
      }
    })
  }, [courier, courierOrders, courierEvents, allLocations, fuelParams])

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
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        if (item.dateObj < thirtyDaysAgo) return false
      }

      // Filtro de status
      if (statusFilter !== 'all') {
        if (statusFilter === 'partial') {
          if (item.status !== 'address_error' && item.status !== 'client_absent') return false
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

  // Totais do período filtrado
  const metricsSummary = useMemo(() => {
    const totalKm = filteredItems.reduce((acc, i) => acc + i.kmRodado, 0)
    const totalFuelCost = filteredItems.reduce((acc, i) => acc + i.fuelCost, 0)
    const totalLiters = filteredItems.reduce((acc, i) => acc + i.litersSpent, 0)
    const totalDeviations = filteredItems.reduce((acc, i) => acc + i.offRouteCount, 0)
    const totalStops = filteredItems.reduce((acc, i) => acc + i.unexpectedStopsCount, 0)

    // Se houver fuelAccount e o período for "all", usamos os valores oficiais consolidados da conta corrente
    const saldoContaCorrente = fuelAccount ? fuelAccount.balance : -totalFuelCost
    const totalAdiantado = fuelAccount ? fuelAccount.totalAdvances : 0

    return {
      totalKm: Number(totalKm.toFixed(1)),
      totalFuelCost: Number(totalFuelCost.toFixed(2)),
      totalLiters: Number(totalLiters.toFixed(2)),
      totalDeviations,
      totalStops,
      saldoContaCorrente,
      totalAdiantado,
      totalDeliveries: filteredItems.length,
    }
  }, [filteredItems, fuelAccount])

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
      'Pontos GPS Válidos',
      'Combustível Oficial (R$)',
      'Litros Consumidos',
      'Desvios de Rota (>300m)',
      'Paradas Fora da Rota',
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
      item.gpsPointsCount,
      item.fuelCost.toFixed(2),
      item.litersSpent.toFixed(2),
      item.offRouteCount,
      item.unexpectedStopsCount,
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
                    Desvios (&gt;300m)
                  </h4>
                  <p className="text-[11px] text-slate-400">
                    KM separado (não entra no cálculo de combustível)
                  </p>
                </div>
              </div>
              <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/40 text-xs font-bold font-mono px-2.5 py-1">
                {metricsSummary.totalDeviations} desvio(s)
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
                  <SelectItem value="month">Últimos 30 dias</SelectItem>
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
                    <th className="py-2.5 px-3 font-semibold text-center">Desvio (&gt;300m)</th>
                    <th className="py-2.5 px-3 font-semibold text-right">Detalhes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1E2B58]/60 text-slate-200">
                  {filteredItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-8 text-center text-slate-400">
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
                          <span className="font-mono font-bold text-[#60A5FA] block">
                            {item.trackingCode}
                          </span>
                          <span className="text-[11px] text-slate-300 font-medium truncate max-w-[160px] block">
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
                                title={`KM 100% Real calculado por ${item.gpsPointsCount} pontos de GPS`}
                              >
                                100% real
                              </span>
                            )}
                            <span>{item.kmRodado.toFixed(1)} km</span>
                          </div>
                          {item.hasReturnKm && (
                            <span className="block text-[9px] text-[#22C55E]">c/ retorno</span>
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
                      {selectedItemForDetails.isRealTelemetry ? (
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
                      {selectedItemForDetails.isRealTelemetry
                        ? `${selectedItemForDetails.gpsPointsCount} pontos GPS analisados`
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
                      ~{selectedItemForDetails.litersSpent} L @ R${' '}
                      {fuelParams.pricePerLiter.toFixed(2)}/L
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
                      <span>Pontos GPS Válidos:</span>
                      <span className="text-slate-200 font-mono">
                        {selectedItemForDetails.gpsPointsCount} pontos
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>Pontos Descartados (Filtro Ruído):</span>
                      <span className="text-slate-200 font-mono">
                        {selectedItemForDetails.filteredNoisePointsCount} pontos (
                        {selectedItemForDetails.discardedNoiseKm.toFixed(2)} km)
                      </span>
                    </div>
                    {selectedItemForDetails.samplingCurvatureFactor &&
                      selectedItemForDetails.samplingCurvatureFactor > 1 && (
                        <div className="flex justify-between">
                          <span>Compensação Sinuosidade (Amostragem):</span>
                          <span className="text-[#60A5FA] font-mono">
                            +
                            {Math.round((selectedItemForDetails.samplingCurvatureFactor - 1) * 100)}
                            % (alinhado a odômetro)
                          </span>
                        </div>
                      )}
                    {selectedItemForDetails.auditNotes && (
                      <p className="text-[10px] text-slate-400 italic pt-1 border-t border-[#1E2B58]/60 mt-1">
                        ℹ️ {selectedItemForDetails.auditNotes}
                      </p>
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
                                ? '🚨 Desvio de Rota (>300m)'
                                : '🛑 Parada Não Prevista'}
                            </span>
                            <span className="text-slate-500 font-mono text-[10px]">
                              {new Date(ev.created).toLocaleTimeString('pt-BR')}
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
