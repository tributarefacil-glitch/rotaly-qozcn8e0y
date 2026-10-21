import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Wallet,
  CreditCard,
  Receipt,
  Search,
  Fuel,
  TrendingUp,
  AlertTriangle,
  FileSpreadsheet,
  RefreshCw,
  Bike,
  ShieldCheck,
  ChevronRight,
  Info,
} from 'lucide-react'
import type {
  UserRecord,
  OrderRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
  FuelAdvanceRecord,
  CourierFuelAccount,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import { fuelAccountService } from '@/services/fuelAccountService'
import {
  formatPbTimestamp,
  getOperationalWindow,
  getOperationalMonthStart,
  isCurrentMonthInTz,
} from '@/lib/operationalWindow'
import { CourierFuelSummaryCard } from '@/components/CourierFuelSummaryCard'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
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

interface SellerFuelSectionProps {
  couriers: UserRecord[]
  orders: OrderRecord[]
  fuelAdvances: FuelAdvanceRecord[]
  locations: LocationRecord[]
  offRouteEvents: OffRouteEventRecord[]
  settings: AppSettingsRecord | null
  onRefresh: () => void
  isReadOnly?: boolean
}

export const SellerFuelSection: React.FC<SellerFuelSectionProps> = ({
  couriers,
  orders,
  fuelAdvances,
  locations,
  offRouteEvents,
  settings,
  onRefresh,
  isReadOnly = true,
}) => {
  const [fuelPeriodFilter, setFuelPeriodFilter] = useState<'all' | 'month' | 'week'>('week')
  const [selectedCourierFilter, setSelectedCourierFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [vehicleCategoryFilter, setVehicleCategoryFilter] = useState<
    'all' | 'moto' | 'carro' | 'caminhao' | 'bicicleta'
  >('all')

  // Pedidos históricos de combustível com cache e paginação em lote (idêntico ao AdminDashboard)
  const [fuelHistoryOrders, setFuelHistoryOrders] = useState<OrderRecord[]>([])
  const [isLoadingFuelOrders, setIsLoadingFuelOrders] = useState(false)
  const [loadedFuelPeriod, setLoadedFuelPeriod] = useState<string>('')
  const [telemetryBatches, setTelemetryBatches] = useState<RouteBatchTelemetryRecord[]>([])
  const fuelOrdersCacheRef = useRef<Map<string, { data: OrderRecord[]; timestamp: number }>>(
    new Map(),
  )

  useEffect(() => {
    let isMounted = true
    deliveryService
      .listRouteBatchTelemetry()
      .then((data) => {
        if (isMounted) setTelemetryBatches(data || [])
      })
      .catch((err) => {
        console.warn('[SellerFuelSection] Erro ao carregar route_batch_telemetry:', err)
      })
    return () => {
      isMounted = false
    }
  }, [])

  // Versão de sincronização global para invalidar caches legados e forçar recarga imediata
  const FUEL_GLOBAL_VERSION = 'v0325_period_pool_sync'

  const fetchFuelHistoryOrders = useCallback(
    async (forceRefresh = false) => {
      const cacheKey = `${fuelPeriodFilter}_${FUEL_GLOBAL_VERSION}`
      const now = Date.now()
      const cached = fuelOrdersCacheRef.current.get(cacheKey)

      if (!forceRefresh && cached && now - cached.timestamp < 5 * 60 * 1000) {
        setFuelHistoryOrders(cached.data)
        setLoadedFuelPeriod(fuelPeriodFilter)
        return
      }

      let filter = ''
      const currentDate = new Date()
      const opWindow = getOperationalWindow(currentDate)

      if (fuelPeriodFilter === 'month') {
        const monthStart = getOperationalMonthStart(currentDate)
        filter = `created >= '${monthStart.pbString}' || route_finished_at >= '${monthStart.pbString}' || actual_arrival >= '${monthStart.pbString}'`
      } else if (fuelPeriodFilter === 'week') {
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        const startStr = formatPbTimestamp(new Date(sevenDaysAgoStart))
        filter = `created >= '${startStr}' || route_finished_at >= '${startStr}' || actual_arrival >= '${startStr}'`
      } else {
        filter = ''
      }

      setIsLoadingFuelOrders(true)
      try {
        const targetCompanyId =
          deliveryService.getActiveCompanyId() || (await deliveryService.getMatrizCompanyId())
        const fetched = await deliveryService.getOrdersInBatches(
          filter,
          '-created',
          'customer_id,courier_id,seller_id',
          200,
          targetCompanyId,
        )
        fuelOrdersCacheRef.current.set(cacheKey, { data: fetched, timestamp: Date.now() })
        setFuelHistoryOrders(fetched)
        setLoadedFuelPeriod(fuelPeriodFilter)
      } catch (err) {
        console.error('Erro ao carregar pedidos de combustível do período no seller:', err)
        // Nunca silenciar o período ativo caindo em pool truncado do dia
        setFuelHistoryOrders((prev) => (prev.length > 0 ? prev : []))
        setLoadedFuelPeriod('')
      } finally {
        setIsLoadingFuelOrders(false)
      }
    },
    [fuelPeriodFilter],
  )

  useEffect(() => {
    fetchFuelHistoryOrders()
  }, [fuelPeriodFilter, fetchFuelHistoryOrders])

  // Pool de pedidos ativo para combustível:
  // Garante que o pool usado cubra SEMPRE a janela do filtro ativo.
  // Quando o histórico ainda está sendo buscado pela primeira vez, mantemos vazio/aguardamos a busca própria,
  // nunca caindo no pool orders do SellerDashboard (que só traz pedidos de hoje: created >= windowStart).
  const isPeriodLoaded = loadedFuelPeriod === fuelPeriodFilter && !isLoadingFuelOrders
  const activeFuelOrdersPool = isPeriodLoaded
    ? fuelHistoryOrders
    : fuelHistoryOrders.length > 0
      ? fuelHistoryOrders
      : []

  // Modal de Histórico Detalhado
  const [selectedCourierForHistory, setSelectedCourierForHistory] = useState<UserRecord | null>(
    null,
  )
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  // 1. Calcular métricas de cada entregador usando o MESMO fuelAccountService unificado (/admin e /seller)
  // REGRA CONTRATUAL DO ROTALY:
  // Os cards da Conta Corrente dos Entregadores mostram SEMPRE a visão do MÊS CORRENTE:
  // - Saldo = carry-over (saldo acumulado até o mês anterior) + adiantamentos do mês corrente − gasto do mês corrente
  // - Km rodado = SOMENTE do mês corrente (zera no dia 1)
  // - Total Adiantado = SOMENTE do mês corrente
  // - Gasto Rota Oficial = SOMENTE do mês corrente
  // Meses anteriores ficam acessíveis exclusivamente no Histórico detalhado / Histórico Viário.
  const calculatedAccounts = useMemo(() => {
    // REGRA DE OURO (v0.0.464): registro inválido de entregador é pulado — nunca derruba a tela.
    // fleetTotals e o Exportar CSV herdam a proteção automaticamente (mesma lista filtrada).
    return couriers
      .filter((c) => c && c.id)
      .map((courier) => {
        const unifiedAccount = fuelAccountService.calculateAccountForCourier({
          courier,
          advances: fuelAdvances,
          orders: activeFuelOrdersPool,
          settings,
          locations,
          offRouteEvents,
          periodFilter: fuelPeriodFilter,
          telemetryBatches,
        })

        const fuelAccount: CourierFuelAccount = {
          courier: unifiedAccount.courier,
          totalAdvances: unifiedAccount.totalAdvances,
          totalRouteKm: unifiedAccount.totalRouteKm,
          totalSpent: unifiedAccount.totalSpent,
          balance: unifiedAccount.balance,
          advanceCount: unifiedAccount.advanceCount,
          deliveriesCount: unifiedAccount.deliveriesCount,
          advances: unifiedAccount.advances,
          calculationSource: unifiedAccount.calculationSource,
          carryOverBalance: unifiedAccount.carryOverBalance,
        }

        return {
          courier: unifiedAccount.courier,
          metrics: unifiedAccount.metrics,
          fuelAccount,
          unifiedAccount,
        }
      })
  }, [
    couriers,
    fuelAdvances,
    activeFuelOrdersPool,
    locations,
    offRouteEvents,
    settings,
    fuelPeriodFilter,
    telemetryBatches,
  ])

  // 2. Filtrar os cards dos entregadores por busca e categoria
  const filteredAccounts = useMemo(() => {
    return calculatedAccounts.filter(({ courier, metrics }) => {
      if (selectedCourierFilter !== 'all' && courier.id !== selectedCourierFilter) {
        return false
      }

      if (vehicleCategoryFilter !== 'all') {
        const cat = deliveryService.normalizeVehicleCategory(courier.vehicle_type)
        if (cat !== vehicleCategoryFilter) return false
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = (courier.name || '').toLowerCase().includes(q)
        const matchPlate = (courier.vehicle_plate || '').toLowerCase().includes(q)
        const matchModel = (courier.vehicle_model || '').toLowerCase().includes(q)
        if (!matchName && !matchPlate && !matchModel) return false
      }

      return true
    })
  }, [calculatedAccounts, selectedCourierFilter, vehicleCategoryFilter, searchQuery])

  // 3. Totais consolidados da frota do vendedor
  // O Saldo da Frota = soma dos saldos individuais de cada entregador
  // (abertura + movimentos pós-corte − gasto pós-corte), batendo com a soma dos cards individuais
  const fleetTotals = useMemo(() => {
    let totalAdvances = 0
    let totalSpent = 0
    let totalOfficialKm = 0
    let totalDeviationKm = 0
    let totalFleetBalance = 0
    let positiveCount = 0
    let negativeCount = 0
    let bicycleCount = 0

    calculatedAccounts.forEach(({ courier, metrics }) => {
      totalAdvances += metrics.totalAdvances
      totalSpent += metrics.totalSpent
      totalOfficialKm += metrics.totalOfficialKm
      totalDeviationKm += metrics.totalDeviationKm
      totalFleetBalance += metrics.balance

      if (metrics.balance >= 0) positiveCount++
      else negativeCount++

      const cat = deliveryService.normalizeVehicleCategory(courier.vehicle_type)
      if (cat === 'bicicleta') bicycleCount++
    })

    const netBalance = Number(totalFleetBalance.toFixed(2))

    return {
      totalAdvances,
      totalSpent,
      totalOfficialKm,
      totalDeviationKm,
      netBalance,
      positiveCount,
      negativeCount,
      bicycleCount,
    }
  }, [calculatedAccounts])

  // 4. Filtrar lista de adiantamentos vinculados aos entregadores do vendedor
  const filteredAdvances = useMemo(() => {
    // REGRA DE OURO (v0.0.464): id só entra no conjunto se o registro for válido.
    const courierIdSet = new Set(couriers.filter((c) => c && c.id).map((c) => c.id))

    return fuelAdvances.filter((adv) => {
      // Garantir escopo: apenas adiantamentos dos entregadores deste vendedor
      if (!courierIdSet.has(adv.courier_id)) return false

      if (selectedCourierFilter !== 'all' && adv.courier_id !== selectedCourierFilter) {
        return false
      }

      const advDate = new Date(adv.date || adv.created || Date.now())
      const now = new Date()
      const opWindow = getOperationalWindow(now)

      if (fuelPeriodFilter === 'month') {
        return isCurrentMonthInTz(advDate, now)
      }

      if (fuelPeriodFilter === 'week') {
        const sevenDaysAgoStart = opWindow.start - 6 * 24 * 60 * 60 * 1000
        return advDate.getTime() >= sevenDaysAgoStart
      }

      return true
    })
  }, [fuelAdvances, couriers, selectedCourierFilter, fuelPeriodFilter])

  // Exportar resumo da frota em CSV
  const handleExportFleetSummaryCSV = () => {
    if (calculatedAccounts.length === 0) return

    const headers = [
      'Entregador',
      'Veículo',
      'Placa',
      'Categoria',
      'Total Adiantado (R$)',
      'Gasto Rota Oficial (R$)',
      'Saldo Conta Corrente (R$)',
      'KM Real Oficial',
      'KM Desvios',
      'Nº Adiantamentos',
      'Nº Entregas',
    ]

    const rows = calculatedAccounts.map(({ courier, metrics }) => [
      `"${courier.name || 'Entregador'}"`,
      `"${courier.vehicle_model || '-'}"`,
      `"${courier.vehicle_plate || '-'}"`,
      deliveryService.normalizeVehicleCategory(courier.vehicle_type),
      metrics.totalAdvances.toFixed(2),
      metrics.totalSpent.toFixed(2),
      metrics.balance.toFixed(2),
      metrics.totalOfficialKm.toFixed(1),
      metrics.totalDeviationKm.toFixed(1),
      metrics.advanceCount,
      metrics.deliveriesCount,
    ])

    const csvContent =
      'data:text/csv;charset=utf-8,\uFEFF' +
      [headers.join(';'), ...rows.map((r) => r.join(';'))].join('\n')

    const encodedUri = encodeURI(csvContent)
    const link = document.createElement('a')
    link.setAttribute('href', encodedUri)
    link.setAttribute(
      'download',
      `controle_combustivel_lojista_${new Date().toISOString().split('T')[0]}.csv`,
    )
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const selectedCourierAccount = selectedCourierForHistory
    ? calculatedAccounts.find((a) => a.courier.id === selectedCourierForHistory.id)?.fuelAccount ||
      null
    : null

  return (
    <div className="space-y-6">
      {/* CABEÇALHO DO MÓDULO */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-[#22C55E]">
              <Wallet className="h-5 w-5" />
            </div>
            <h2 className="font-heading text-lg sm:text-xl font-black text-white tracking-tight">
              Controle de Combustível &amp; Conta Corrente
            </h2>
          </div>
          <p className="font-sans text-xs text-slate-400 mt-1">
            Acompanhamento em tempo real do saldo de cada entregador vinculado à sua operação:{' '}
            <strong className="text-emerald-400">Total Adiantado</strong> menos{' '}
            <strong className="text-amber-400">
              Gasto em Rotas Oficiais (Histórico Viário das Rotas)
            </strong>
            .
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchFuelHistoryOrders(true)
              onRefresh()
            }}
            disabled={isLoadingFuelOrders}
            className="h-9 gap-1.5 border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-slate-200 text-xs rounded-lg"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 text-[#60A5FA] ${isLoadingFuelOrders ? 'animate-spin' : ''}`}
            />
            <span>Atualizar</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportFleetSummaryCSV}
            className="h-9 gap-1.5 border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-emerald-400 text-xs rounded-lg"
            title="Exportar resumo de combustível em CSV"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </Button>
        </div>
      </div>

      {/* CARDS COM KPI CONSOLIDADO DA FROTA DO VENDEDOR */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Card 1: Saldo Líquido Consolidado */}
        <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark relative overflow-hidden">
          <div
            className={`absolute top-0 left-0 right-0 h-1 ${
              fleetTotals.netBalance >= 0 ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
            }`}
          />
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-heading uppercase tracking-wider text-[10px] font-bold">
                Saldo da Frota
              </span>
              <Wallet
                className={`h-4 w-4 ${
                  fleetTotals.netBalance >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
                }`}
              />
            </div>
            <p
              className={`text-xl sm:text-2xl font-black font-mono mt-1 ${
                fleetTotals.netBalance >= 0 ? 'text-[#22C55E]' : 'text-[#EF4444]'
              }`}
            >
              R$ {fleetTotals.netBalance.toFixed(2)}
            </p>
            <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-1">
              <span className="text-emerald-400 font-semibold">
                {fleetTotals.positiveCount} em crédito
              </span>
              <span>•</span>
              <span className="text-rose-400 font-semibold">
                {fleetTotals.negativeCount} a repor
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Card 2: Total Adiantado */}
        <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-heading uppercase tracking-wider text-[10px] font-bold">
                (+) Total Adiantado
              </span>
              <Receipt className="h-4 w-4 text-[#22C55E]" />
            </div>
            <p className="text-xl sm:text-2xl font-black font-mono mt-1 text-[#22C55E]">
              R$ {fleetTotals.totalAdvances.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {filteredAdvances.length} adiantamento(s) no período
            </p>
          </CardContent>
        </Card>

        {/* Card 3: Gasto em Rotas Oficiais */}
        <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-heading uppercase tracking-wider text-[10px] font-bold">
                (-) Gasto Rotas Oficiais
              </span>
              <Fuel className="h-4 w-4 text-[#FF6B35]" />
            </div>
            <p className="text-xl sm:text-2xl font-black font-mono mt-1 text-[#FF6B35]">
              R$ {fleetTotals.totalSpent.toFixed(2)}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              {fleetTotals.totalOfficialKm.toFixed(1)} km oficiais apurados
            </p>
          </CardContent>
        </Card>

        {/* Card 4: KM Viário Oficial Pago */}
        <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
          <CardContent className="p-4">
            <div className="flex items-center justify-between text-slate-400 text-xs">
              <span className="font-heading uppercase tracking-wider text-[10px] font-bold">
                KM Viário Oficial Pago
              </span>
              <TrendingUp className="h-4 w-4 text-[#60A5FA]" />
            </div>
            <p className="text-xl sm:text-2xl font-black font-mono mt-1 text-white">
              {fleetTotals.totalOfficialKm.toFixed(1)}{' '}
              <span className="text-xs font-normal text-slate-400">km</span>
            </p>
            <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1">
              <span className="text-slate-300">Auditoria GPS e Desvios:</span>{' '}
              {fleetTotals.totalDeviationKm > 0 ? (
                <span className="text-rose-400 font-mono font-semibold">
                  +{fleetTotals.totalDeviationKm.toFixed(1)} km
                </span>
              ) : (
                <span className="text-emerald-400 font-semibold">0 km</span>
              )}
              {fleetTotals.bicycleCount > 0 && (
                <span className="text-slate-400">• 🚲 {fleetTotals.bicycleCount} bike</span>
              )}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* BARRA DE FILTROS */}
      <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-3.5 sm:p-4 shadow-brand-dark flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <div className="flex items-center gap-2 flex-1 flex-wrap">
          {/* Busca por texto */}
          <div className="relative min-w-[200px] flex-1 sm:flex-initial">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
            <Input
              placeholder="Buscar entregador, placa ou modelo..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg focus:border-[#60A5FA]"
            />
          </div>

          {/* Filtro por Entregador */}
          <Select value={selectedCourierFilter} onValueChange={setSelectedCourierFilter}>
            <SelectTrigger className="h-9 w-44 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
              <SelectValue placeholder="Entregador" />
            </SelectTrigger>
            <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
              <SelectItem value="all">
                Todos os Entregadores ({couriers.filter((c) => c && c.id).length})
              </SelectItem>
              {couriers
                .filter((c) => c && c.id)
                .map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name || 'Entregador'} {c.vehicle_plate ? `(${c.vehicle_plate})` : ''}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>

          {/* Filtro por Categoria de Veículo */}
          <Select
            value={vehicleCategoryFilter}
            onValueChange={(v) =>
              setVehicleCategoryFilter(v as 'all' | 'moto' | 'carro' | 'caminhao' | 'bicicleta')
            }
          >
            <SelectTrigger className="h-9 w-36 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
              <SelectValue placeholder="Veículo" />
            </SelectTrigger>
            <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
              <SelectItem value="all">Todos os Veículos</SelectItem>
              <SelectItem value="moto">🏍️ Moto</SelectItem>
              <SelectItem value="carro">🚗 Carro</SelectItem>
              <SelectItem value="caminhao">🚚 Caminhão</SelectItem>
              <SelectItem value="bicicleta">🚲 Bicicleta</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Filtro por Período */}
        <div className="flex items-center gap-1.5 self-end md:self-center">
          <Select
            value={fuelPeriodFilter}
            onValueChange={(v: 'all' | 'month' | 'week') => setFuelPeriodFilter(v)}
          >
            <SelectTrigger className="h-9 w-36 text-xs bg-[#070D1E] border-[#1E2B58] text-white font-medium">
              <SelectValue placeholder="Período" />
            </SelectTrigger>
            <SelectContent className="bg-[#0E1738] border-[#1E2B58] text-white">
              <SelectItem value="all">Todo Histórico</SelectItem>
              <SelectItem value="month">Este Mês</SelectItem>
              <SelectItem value="week">Últimos 7 dias</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* AVISO INFORMATIVO DE REGRAS E TELEMETRIA */}
      <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] flex items-start gap-3 text-xs text-slate-300">
        <Info className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
        <div className="space-y-0.5">
          <p className="font-semibold text-white">
            Conta Corrente Oficial Sincronizada com o Painel Admin
          </p>
          <p className="text-slate-400 text-[11px] leading-relaxed">
            O valor gasto é apurado com a precedência oficial do{' '}
            <strong>Histórico Viário das Rotas</strong> (Base → Paradas → Retorno). O GPS é
            utilizado para auditoria de desvios. Para entregadores de bicicleta (🚲), o combustível
            é isento e é exibido o KM real percorrido. Clique em qualquer card para abrir o
            histórico detalhado de entregas.
          </p>
        </div>
      </div>

      {/* GRID DE CARDS DOS ENTREGADORES */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-heading text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
            <CreditCard className="h-4 w-4 text-emerald-500" />
            Conta Corrente dos Entregadores ({filteredAccounts.length})
          </h3>
          <span className="text-xs text-slate-400">
            💡 Clique no card para abrir o histórico detalhado
          </span>
        </div>

        {filteredAccounts.length === 0 ? (
          <div className="p-10 rounded-2xl border border-dashed border-[#1E2B58] bg-[#0E1738] text-center text-slate-400 space-y-2">
            <Fuel className="h-8 w-8 mx-auto text-slate-500" />
            <p className="text-sm font-semibold text-white">
              Nenhum entregador encontrado para os filtros selecionados.
            </p>
            <p className="text-xs text-slate-400">
              Verifique se os entregadores cadastrados estão vinculados à sua loja ou ajuste a
              busca.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredAccounts.map(({ courier, metrics }) => (
              <CourierFuelSummaryCard
                key={courier.id}
                metrics={metrics}
                courier={courier}
                onOpenHistoryModal={() => {
                  setSelectedCourierForHistory(courier)
                  setIsHistoryModalOpen(true)
                }}
                title="Saldo da Conta Corrente"
                subtitle="Calculado via rota viária oficial (Google)"
                showPricingExplanation={true}
              />
            ))}
          </div>
        )}
      </div>

      {/* TABELA: HISTÓRICO DE PAGAMENTOS E ADIANTAMENTOS CADASTRADOS */}
      <Card className="border-[#1E2B58] bg-[#0E1738] shadow-brand-dark">
        <CardHeader className="p-4 sm:p-5 pb-3 border-b border-[#1E2B58]">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold text-white flex items-center gap-2 font-heading">
                <Receipt className="h-4 w-4 text-emerald-400" />
                Histórico de Adiantamentos Registrados ({filteredAdvances.length})
              </CardTitle>
              <CardDescription className="text-xs text-slate-400">
                Créditos antecipados lançados para os seus entregadores (modo somente leitura).
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-[#1E2B58] bg-[#0A1128] text-slate-400 font-heading uppercase tracking-wider text-[11px]">
                  <th className="py-3 px-4 font-bold">Data</th>
                  <th className="py-3 px-4 font-bold">Entregador</th>
                  <th className="py-3 px-4 font-bold">Forma de Pagamento</th>
                  <th className="py-3 px-4 font-bold">Observações / Justificativa</th>
                  <th className="py-3 px-4 font-bold text-right">Valor Pago</th>
                  <th className="py-3 px-4 font-bold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E2B58]/60 text-slate-200">
                {filteredAdvances.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      Nenhum adiantamento registrado para os entregadores no período selecionado.
                    </td>
                  </tr>
                ) : (
                  filteredAdvances.map((adv) => {
                    const courier = couriers.find((c) => c.id === adv.courier_id)
                    return (
                      <tr key={adv.id} className="hover:bg-[#121E46]/60 transition-colors">
                        <td className="py-3 px-4 font-mono text-slate-300">
                          {adv.date
                            ? new Date(adv.date).toLocaleDateString('pt-BR')
                            : new Date(adv.created).toLocaleDateString('pt-BR')}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white">
                          <div className="flex items-center gap-2">
                            <span>{courier?.name || 'Entregador'}</span>
                            {courier?.vehicle_plate && (
                              <span className="text-[10px] font-mono text-slate-400">
                                ({courier.vehicle_plate})
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <Badge
                            variant="outline"
                            className="uppercase font-mono text-[10px] bg-[#0A1128] border-[#1E2B58] text-slate-300"
                          >
                            {adv.payment_method || 'PIX'}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-slate-400 max-w-xs truncate">
                          {adv.notes || 'Adiantamento de combustível para rotas'}
                        </td>
                        <td className="py-3 px-4 text-right font-black text-emerald-400 font-mono text-sm">
                          R$ {Number(adv.amount || 0).toFixed(2)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold">
                            Creditado
                          </Badge>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* MODAL DETALHADO DE HISTÓRICO DE ENTREGAS, KM, COMBUSTÍVEL E TELEMETRIA GPS */}
      <CourierDeliveryHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => {
          setIsHistoryModalOpen(false)
          setSelectedCourierForHistory(null)
        }}
        courier={selectedCourierForHistory}
        fuelAccount={selectedCourierAccount}
        orders={activeFuelOrdersPool}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
      />
    </div>
  )
}

export default SellerFuelSection
