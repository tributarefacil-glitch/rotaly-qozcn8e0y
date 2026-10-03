import React, { useState, useMemo, useEffect } from 'react'
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
} from 'lucide-react'
import { toast } from '@/hooks/use-toast'
import { deliveryService } from '@/services/deliveryService'
import {
  OrderRecord,
  UserRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
  RouteKmApprovalRecord,
} from '@/types/delivery'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import { haversineDistanceMeters } from '@/lib/geo'

interface KmAuditReportProps {
  orders: OrderRecord[]
  couriers: UserRecord[]
  locations: LocationRecord[]
  offRouteEvents: OffRouteEventRecord[]
  settings: Partial<AppSettingsRecord> | null
  currentCompanyId?: string
  onDataChange?: () => void
}

export const KmAuditReport: React.FC<KmAuditReportProps> = ({
  orders,
  couriers,
  locations,
  offRouteEvents,
  settings,
  currentCompanyId,
  onDataChange,
}) => {
  // Filtros
  const [selectedCourierId, setSelectedCourierId] = useState<string>('all')
  const [selectedDateFilter, setSelectedDateFilter] = useState<string>('all')
  const [customDate, setCustomDate] = useState<string>('')
  const [selectedBatchKey, setSelectedBatchKey] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [filterDeviationOnly, setFilterDeviationOnly] = useState<boolean>(false)

  // Estado de aprovações
  const [approvals, setApprovals] = useState<RouteKmApprovalRecord[]>([])
  const [isLoadingApprovals, setIsLoadingApprovals] = useState<boolean>(false)

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

  // Carregar aprovações do banco
  const loadApprovals = async () => {
    setIsLoadingApprovals(true)
    try {
      const data = await deliveryService.getRouteKmApprovals(currentCompanyId)
      setApprovals(data)
    } catch (err) {
      console.warn('Erro ao carregar aprovações de KM:', err)
    } finally {
      setIsLoadingApprovals(false)
    }
  }

  useEffect(() => {
    loadApprovals()
  }, [currentCompanyId])

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
    orders.forEach((o) => {
      if (selectedCourierId !== 'all' && o.courier_id !== selectedCourierId) return
      let bKey = 'Avulso'
      if (o.route_started_at && o.route_finished_at) {
        bKey = `Rota ${new Date(o.route_started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      } else if (o.route_started_at) {
        bKey = `Lote ${new Date(o.route_started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      }
      setBatches.add(bKey)
    })
    return Array.from(setBatches)
  }, [orders, selectedCourierId])

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
      deviationMeters: number
      deviationTimeStr: string
      offRoadEventsCount: number
      unexpectedStopsMeters: number
      unexpectedStopsCount: number
      isJointDelivery: boolean
      isJointSecondary: boolean
      statusBadge: string
      hasSignificantDeviation: boolean
      approval?: RouteKmApprovalRecord
      officialAfterApprovalKm: number
    }> = []

    // Agrupa pedidos por entregador
    const ordersByCourier = new Map<string, OrderRecord[]>()
    orders.forEach((ord) => {
      if (!ord.courier_id) return
      const list = ordersByCourier.get(ord.courier_id) || []
      list.push(ord)
      ordersByCourier.set(ord.courier_id, list)
    })

    // Construir map de aprovações para o motor oficial
    const motorApprovalsMap = new Map<
      string,
      { approvedKm: number; justification?: string; status: 'approved' | 'rejected' }
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

      // Rodar motor oficial para este entregador
      const metrics = calculateCourierFuelMetrics({
        courier: courierObj,
        advances: [],
        orders: courierOrders,
        locations,
        offRouteEvents,
        settings,
        periodFilter: 'all',
        approvalsMap: motorApprovalsMap,
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

        // Identificação de lote
        let bKey = 'single_' + order.id
        let batchDisplay = 'Avulso'
        if (order.route_started_at && order.route_finished_at) {
          bKey = `route_${order.route_started_at}_${order.route_finished_at}`
          batchDisplay = `Rota ${new Date(order.route_started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        } else if (order.route_started_at) {
          bKey = `batch_${Math.floor(new Date(order.route_started_at).getTime() / (15 * 60 * 1000))}`
          batchDisplay = `Lote ${new Date(order.route_started_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
        }

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
              const custLat = cust?.lat || order.end_address_lat || 0
              const custLng = cust?.lng || order.end_address_lng || 0
              if (custLat !== 0 && custLng !== 0 && ev.lat && ev.lng) {
                const stopDist = haversineDistanceMeters(ev.lat, ev.lng, custLat, custLng)
                if (stopDist > maxStopDistMeters) maxStopDistMeters = Math.round(stopDist)
              }
            }
          }
        })

        const approval = approvalsMap.get(order.id)
        const roadKmOriginal = originalOrderMap.get(order.id) ?? calc.officialKm
        const officialAfterApprovalKm = calc.officialKm

        // Indicador de desvio relevante para priorizar triagem:
        // - Desvio de rota > 500m
        // - Ou parada fora do local > 300m
        // - Ou discrepância entre viário e GPS > 2.0 km
        const diffGpsRoad = Math.abs(calc.totalGpsKm - roadKmOriginal)
        const hasSignificantDeviation =
          maxDevMeters >= 500 ||
          maxStopDistMeters >= 300 ||
          (diffGpsRoad >= 2.0 && calc.totalGpsKm > 0)

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
          gpsKm: calc.totalGpsKm,
          deviationMeters: maxDevMeters,
          deviationTimeStr: devTimeStr,
          offRoadEventsCount: offRouteCount,
          unexpectedStopsMeters: maxStopDistMeters,
          unexpectedStopsCount,
          isJointDelivery: Boolean(calc.isJointDelivery),
          isJointSecondary: Boolean(calc.isJointSecondary),
          statusBadge: order.status,
          hasSignificantDeviation,
          approval,
          officialAfterApprovalKm,
        })
      })
    })

    // Ordenar decrescente por data/hora da rota
    return rows.sort((a, b) => new Date(b.dateRaw).getTime() - new Date(a.dateRaw).getTime())
  }, [orders, eligibleCouriers, locations, offRouteEvents, settings, approvals, approvalsMap])

  // Filtragem dos registros da tabela
  const filteredRows = useMemo(() => {
    return auditRows.filter((r) => {
      // Filtro de entregador
      if (selectedCourierId !== 'all' && r.order.courier_id !== selectedCourierId) {
        return false
      }

      // Filtro de data
      if (selectedDateFilter === 'custom' && customDate) {
        const rowIso = new Date(r.dateRaw).toISOString().split('T')[0]
        if (rowIso !== customDate) return false
      } else if (selectedDateFilter === 'today') {
        const todayIso = new Date().toISOString().split('T')[0]
        const rowIso = new Date(r.dateRaw).toISOString().split('T')[0]
        if (rowIso !== todayIso) return false
      }

      // Filtro de lote
      if (selectedBatchKey !== 'all' && r.batchDisplay !== selectedBatchKey) {
        return false
      }

      // Filtro apenas desvios relevantes
      if (filterDeviationOnly && !r.hasSignificantDeviation) {
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
    customDate,
    selectedBatchKey,
    filterDeviationOnly,
    searchQuery,
  ])

  // Totais consolidados para o rodapé (Km Oficial Atual, Km GPS, Total Após Aprovações)
  const totals = useMemo(() => {
    let roadKmTotal = 0
    let gpsKmTotal = 0
    let afterApprovalKmTotal = 0
    let approvedItemsCount = 0
    let rejectedItemsCount = 0
    let pendingReviewCount = 0

    filteredRows.forEach((r) => {
      roadKmTotal += r.roadKm
      gpsKmTotal += r.gpsKm
      afterApprovalKmTotal += r.officialAfterApprovalKm

      if (r.approval) {
        if (r.approval.status === 'approved') approvedItemsCount++
        else if (r.approval.status === 'rejected') rejectedItemsCount++
      } else if (r.hasSignificantDeviation) {
        pendingReviewCount++
      }
    })

    return {
      roadKmTotal: Number(roadKmTotal.toFixed(1)),
      gpsKmTotal: Number(gpsKmTotal.toFixed(1)),
      afterApprovalKmTotal: Number(afterApprovalKmTotal.toFixed(1)),
      approvedItemsCount,
      rejectedItemsCount,
      pendingReviewCount,
      totalCount: filteredRows.length,
    }
  }, [filteredRows])

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

    setIsSavingApproval(true)
    try {
      await deliveryService.saveRouteKmApproval({
        orderId: activeItem.orderId,
        courierId: activeItem.courierId,
        empresaId: currentCompanyId,
        routeBatchKey: activeItem.batchKey,
        originalRoadKm: activeItem.originalRoadKm,
        originalGpsKm: activeItem.originalGpsKm,
        approvedKm: modalAction === 'approve' ? kmNum : activeItem.originalRoadKm,
        status: modalAction === 'approve' ? 'approved' : 'rejected',
        justification: justificationInput.trim(),
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
      toast.error(err?.message || 'Falha ao salvar decisão de aprovação de KM.')
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
            disabled={isLoadingApprovals}
            className="h-9 gap-1.5 text-xs text-slate-700 border-slate-200 bg-white hover:bg-slate-50 rounded-xl"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[#00A3FF] ${isLoadingApprovals ? 'animate-spin' : ''}`}
            />
            Atualizar Dados
          </Button>
        </div>
      </div>

      {/* CARDS DE RESUMO RÁPIDO DO RELATÓRIO */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border-slate-200 border-l-4 border-l-[#0052CC] bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              KM Viário Original
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-slate-900 dark:text-white">
                {totals.roadKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Trajeto viário planejado ({totals.totalCount} entregas)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-purple-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              KM GPS Telemetria
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-purple-700 dark:text-purple-300">
                {totals.gpsKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">Distância real auditada via GPS</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-emerald-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Total Oficial Após Aprovações
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {totals.afterApprovalKmTotal.toFixed(1)}
              </span>
              <span className="text-xs text-slate-500 font-semibold">km</span>
            </div>
            <p className="text-[11px] text-emerald-700 font-medium mt-0.5">
              {totals.approvedItemsCount} trecho(s) aprovado(s) com substituição
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 border-l-4 border-l-amber-500 bg-white shadow-sm">
          <CardContent className="p-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block">
              Triagem de Desvios
            </span>
            <div className="flex items-baseline gap-1 mt-1">
              <span className="text-2xl font-black font-mono text-amber-600">
                {totals.pendingReviewCount}
              </span>
              <span className="text-xs text-slate-500 font-semibold">pendentes</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Desvios &gt;500m ou paradas fora do local
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
                  <SelectItem value="all">📅 Todo o Histórico</SelectItem>
                  <SelectItem value="today">☀️ Hoje</SelectItem>
                  <SelectItem value="custom">🔍 Data Específica</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Campo Data Específica */}
            {selectedDateFilter === 'custom' && (
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-slate-600">Data</Label>
                <Input
                  type="date"
                  value={customDate}
                  onChange={(e) => setCustomDate(e.target.value)}
                  className="h-9 text-xs font-mono"
                />
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

          {/* Toggle para Desvios Relevantes */}
          <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
            <button
              type="button"
              onClick={() => setFilterDeviationOnly(!filterDeviationOnly)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-semibold transition-all ${
                filterDeviationOnly
                  ? 'bg-amber-100 border-amber-300 text-amber-900 font-bold shadow-xs'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <AlertTriangle
                className={`h-3.5 w-3.5 ${filterDeviationOnly ? 'text-amber-600' : 'text-slate-400'}`}
              />
              <span>Priorizar Desvios Relevantes (&gt;500m ou paradas)</span>
              {totals.pendingReviewCount > 0 && (
                <Badge className="ml-1 bg-amber-500 text-white text-[10px] px-1.5 py-0 h-4">
                  {totals.pendingReviewCount}
                </Badge>
              )}
            </button>

            <span className="text-slate-400">
              Exibindo <strong>{filteredRows.length}</strong> de {auditRows.length} entregas
            </span>
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
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 uppercase tracking-wider text-[11px] font-bold select-none">
                  <th className="py-3 px-4">a) Cliente / Endereço</th>
                  <th className="py-3 px-3 text-center">b) KM Trajeto Viário</th>
                  <th className="py-3 px-3 text-center">c) KM Trajeto GPS</th>
                  <th className="py-3 px-3 text-center">d) Desvio de Rota</th>
                  <th className="py-3 px-3 text-center">e) Parada Fora do Local</th>
                  <th className="py-3 px-4 text-right">f) Aprovação do Administrador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <Route className="h-10 w-10 mx-auto text-slate-300 mb-2" />
                      <p className="font-semibold text-slate-600">
                        Nenhuma entrega encontrada para os filtros selecionados.
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Tente ajustar os filtros de entregador, data ou desvios relevantes.
                      </p>
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
                              {row.isJointDelivery && (
                                <Badge className="bg-indigo-100 text-indigo-700 border-indigo-200 text-[9px] px-1 py-0 font-semibold">
                                  {row.isJointSecondary
                                    ? 'Entrega Conjunta (2ª)'
                                    : 'Entrega Conjunta (1ª)'}
                                </Badge>
                              )}
                            </div>
                            <p className="text-[11px] text-slate-500 flex items-start gap-1 leading-relaxed">
                              <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
                              <span className="line-clamp-2">{row.address}</span>
                            </p>
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

                        {/* Coluna b: KM Trajeto Viário */}
                        <td className="py-3 px-3 align-top text-center">
                          <div className="space-y-0.5">
                            <span className="font-mono text-sm font-black text-slate-900 dark:text-white">
                              {row.roadKm.toFixed(1)} km
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              Planejado viário
                            </span>
                            {row.isJointSecondary && (
                              <span className="text-[9px] text-indigo-600 block font-semibold">
                                Rateio: 0.0 km (Viagem já inclusa)
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Coluna c: KM Trajeto GPS */}
                        <td className="py-3 px-3 align-top text-center">
                          <div className="space-y-0.5">
                            <span
                              className={`font-mono text-sm font-black ${
                                Math.abs(row.gpsKm - row.roadKm) >= 2.0 && row.gpsKm > 0
                                  ? 'text-amber-700 dark:text-amber-400'
                                  : 'text-purple-700 dark:text-purple-300'
                              }`}
                            >
                              {row.gpsKm > 0 ? `${row.gpsKm.toFixed(1)} km` : '-'}
                            </span>
                            <span className="text-[10px] text-slate-400 block">
                              Telemetria real
                            </span>
                            {row.gpsKm > 0 && Math.abs(row.gpsKm - row.roadKm) >= 0.5 && (
                              <span
                                className={`text-[9px] block font-mono font-bold ${
                                  row.gpsKm > row.roadKm ? 'text-rose-600' : 'text-emerald-600'
                                }`}
                              >
                                {row.gpsKm > row.roadKm
                                  ? `+${(row.gpsKm - row.roadKm).toFixed(1)} km`
                                  : `${(row.gpsKm - row.roadKm).toFixed(1)} km`}
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Coluna d: Desvio de Rota */}
                        <td className="py-3 px-3 align-top text-center">
                          {row.deviationMeters > 0 ? (
                            <div className="space-y-0.5">
                              <Badge
                                className={`text-[10px] font-bold ${
                                  row.deviationMeters >= 500
                                    ? 'bg-rose-100 text-rose-700 border-rose-300'
                                    : 'bg-amber-100 text-amber-700 border-amber-300'
                                }`}
                              >
                                🚨 +{row.deviationMeters} m
                              </Badge>
                              <span className="text-[10px] text-slate-400 block">
                                às {row.deviationTimeStr}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-emerald-600 font-semibold flex items-center justify-center gap-1">
                              <Check className="h-3 w-3" /> Na rota
                            </span>
                          )}
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

                        {/* Coluna f: Botão de Aprovação do Administrador */}
                        <td className="py-3 px-4 align-top text-right">
                          <div className="flex flex-col items-end gap-1.5">
                            {row.approval ? (
                              <div className="text-right space-y-1">
                                {isApproved ? (
                                  <Badge className="bg-emerald-600 text-white font-bold text-[10px] flex items-center gap-1 ml-auto">
                                    <CheckCircle2 className="h-3 w-3" />
                                    Aprovado: {row.approval.approved_km.toFixed(1)} km
                                  </Badge>
                                ) : (
                                  <Badge className="bg-slate-200 text-slate-700 border-slate-300 font-bold text-[10px] flex items-center gap-1 ml-auto">
                                    <XCircle className="h-3 w-3" />
                                    Rejeitado (Viário Mantido)
                                  </Badge>
                                )}

                                {row.approval.justification && (
                                  <p
                                    className="text-[10px] text-slate-500 italic max-w-xs truncate"
                                    title={row.approval.justification}
                                  >
                                    "{row.approval.justification}"
                                  </p>
                                )}

                                <div className="flex items-center justify-end gap-1 pt-0.5">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => handleOpenActionModal(row, 'approve')}
                                    className="h-6 px-2 text-[10px] text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                                  >
                                    Editar Decisão
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center justify-end gap-1.5">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => handleOpenActionModal(row, 'reject')}
                                  className="h-7 px-2.5 text-[11px] border-slate-200 text-slate-600 hover:bg-slate-100"
                                  title="Mantém estritamente o trajeto viário oficial"
                                >
                                  Rejeitar
                                </Button>
                                <Button
                                  size="sm"
                                  onClick={() => handleOpenActionModal(row, 'approve')}
                                  className="h-7 px-2.5 text-[11px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold gap-1 shadow-xs"
                                  title="Aprova e substitui o trecho no cálculo oficial de KM e combustível"
                                >
                                  <Check className="h-3.5 w-3.5" />
                                  Aprovar KM
                                </Button>
                              </div>
                            )}
                          </div>
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
                  KM Oficial Atual
                </span>
                <span className="font-mono font-bold text-slate-900 text-sm">
                  {totals.roadKmTotal.toFixed(1)} km
                </span>
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
    </div>
  )
}
export default KmAuditReport
