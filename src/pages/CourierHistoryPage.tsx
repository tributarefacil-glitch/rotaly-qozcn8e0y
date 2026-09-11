import React, { useState, useMemo } from 'react'
import {
  Package,
  Search,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Compass,
  MapPin,
  Calendar,
  Navigation,
  RefreshCw,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { deliveryService } from '@/services/deliveryService'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import { useCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import type {
  OrderRecord,
  FuelAdvanceRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
} from '@/types/delivery'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'

export default function CourierHistoryPage() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [advances, setAdvances] = useState<FuelAdvanceRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [offRouteEvents, setOffRouteEvents] = useState<OffRouteEventRecord[]>([])
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'delivered' | 'in_transit' | 'issues'>(
    'all',
  )
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  const loadData = async () => {
    if (!user?.id) return
    try {
      const [userOrders, userAdvances, appSettings, userLocations, userEvents] = await Promise.all([
        deliveryService.getOrders(`courier_id = '${user.id}'`, '-created'),
        deliveryService.getFuelAdvances(`courier_id = '${user.id}'`, '-date,-created'),
        deliveryService.getSettings(),
        deliveryService.getLatestLocations(`user_id = '${user.id}'`),
        deliveryService.getOffRouteEvents(`courier_id = '${user.id}'`),
      ])

      setOrders(userOrders)
      setAdvances(userAdvances)
      setSettings(appSettings)
      setLocations(userLocations)
      setOffRouteEvents(userEvents)
    } catch (err) {
      console.error('Erro ao carregar histórico de entregas do entregador:', err)
    } finally {
      setIsLoading(false)
    }
  }

  React.useEffect(() => {
    loadData()
  }, [user])

  // Realtime updates
  useRealtime<OrderRecord>('orders', (e) => {
    if (e.record.courier_id === user?.id) {
      loadData()
    }
  })

  // Telemetria GPS a cada 30 segundos em nível de app/página
  React.useEffect(() => {
    if (!user?.id) return

    const updateLocation = async () => {
      if (navigator.geolocation) {
        let batteryLevel: number | null = null
        try {
          const nav = typeof navigator !== 'undefined' ? (navigator as any) : null
          if (nav && typeof nav.getBattery === 'function') {
            const b = await nav.getBattery()
            if (typeof b?.level === 'number') batteryLevel = Math.round(b.level * 100)
          }
        } catch {
          /* ignore */
        }

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const speed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 28
            try {
              await deliveryService.updateCourierLocation(
                user.id,
                lat,
                lng,
                speed,
                90,
                batteryLevel,
              )
            } catch (e) {
              console.error('Failed to post live location in history page:', e)
            }
          },
          async () => {
            const lat = -22.906847 + (Math.random() - 0.5) * 0.008
            const lng = -43.172896 + (Math.random() - 0.5) * 0.008
            try {
              await deliveryService.updateCourierLocation(user.id, lat, lng, 30, 110, batteryLevel)
            } catch {
              /* ignore */
            }
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      }
    }

    updateLocation()
    const interval = setInterval(updateLocation, 30000)
    return () => clearInterval(interval)
  }, [user])

  // Hook de métricas para obter km oficial consolidado
  const metrics = useCourierFuelMetrics({
    courier: user,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter: 'all',
  })

  // Itens calculados por entrega
  const calculationsByOrderId = useMemo(() => {
    const map = new Map<string, (typeof metrics.orderCalculations)[0]>()
    metrics.orderCalculations.forEach((calc) => {
      map.set(calc.order.id, calc)
    })
    return map
  }, [metrics.orderCalculations])

  // Resumo de totais do topo
  const totals = useMemo(() => {
    const totalDeliveries = orders.length
    const deliveredCount = orders.filter((o) => o.status === 'delivered').length
    const issuesCount = orders.filter(
      (o) =>
        o.status === 'address_error' || o.status === 'client_absent' || o.status === 'cancelled',
    ).length
    const inTransitCount = orders.filter(
      (o) => o.status === 'in_transit' || o.status === 'assigned',
    ).length

    return {
      totalDeliveries,
      deliveredCount,
      issuesCount,
      inTransitCount,
      totalOfficialKm: metrics.totalOfficialKm,
      totalDeviationKm: metrics.totalDeviationKm,
    }
  }, [orders, metrics.totalOfficialKm, metrics.totalDeviationKm])

  // Lista filtrada por busca e status
  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      // Filtro de status
      if (statusFilter === 'delivered' && order.status !== 'delivered') return false
      if (
        statusFilter === 'in_transit' &&
        order.status !== 'in_transit' &&
        order.status !== 'assigned'
      )
        return false
      if (statusFilter === 'issues') {
        const isIssue =
          order.status === 'address_error' ||
          order.status === 'client_absent' ||
          order.status === 'cancelled'
        if (!isIssue) return false
      }

      // Filtro de busca
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchCode = order.tracking_code?.toLowerCase().includes(q)
        const matchCustomer = order.expand?.customer_id?.name?.toLowerCase().includes(q)
        const matchAddress =
          order.expand?.customer_id?.street?.toLowerCase().includes(q) ||
          order.expand?.customer_id?.address?.toLowerCase().includes(q)
        if (!matchCode && !matchCustomer && !matchAddress) return false
      }

      return true
    })
  }, [orders, statusFilter, searchQuery])

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col pb-24 md:pb-8 font-sans antialiased selection:bg-[#0052CC]/30">
      <Header />

      <main className="flex-1 max-w-xl mx-auto w-full p-4 space-y-4">
        {/* CABEÇALHO DA ABA HISTÓRICO */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                App do Entregador
              </span>
              <h1 className="font-heading text-lg font-black text-white flex items-center gap-2">
                <Package className="h-5 w-5 text-[#60A5FA]" />
                Histórico de Entregas
              </h1>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={loadData}
              className="h-8 gap-1.5 border-[#1E2B58] bg-[#0A1128] hover:bg-[#121E46] text-slate-200 text-xs shrink-0"
            >
              <RefreshCw className="h-3 w-3 text-[#60A5FA]" />
              Atualizar
            </Button>
          </div>

          {/* TOTAIS NO TOPO (Requisito 3) */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3 pt-3 border-t border-[#1E2B58]/80 text-xs">
            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Total Entregas
              </span>
              <span className="font-heading text-lg font-black text-white">
                {totals.totalDeliveries}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                Entregues
              </span>
              <span className="font-heading text-lg font-black text-emerald-400">
                {totals.deliveredCount}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">Exceções</span>
              <span className="font-heading text-lg font-black text-[#FF6B35]">
                {totals.issuesCount}
              </span>
            </div>

            <div className="p-2.5 rounded-xl bg-[#0A1128] border border-[#1E2B58]">
              <span className="text-[10px] text-slate-400 uppercase font-bold block">
                KM Real Total
              </span>
              <span className="font-heading text-lg font-black text-[#60A5FA]">
                {totals.totalOfficialKm.toFixed(1)} km
              </span>
            </div>
          </div>
        </div>

        {/* BARRA DE PESQUISA E FILTROS */}
        <div className="space-y-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input
              type="text"
              placeholder="Buscar por código ou cliente..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-10 pl-9 bg-[#0E1738] border-[#1E2B58] text-xs text-white placeholder:text-slate-400 rounded-xl focus:border-[#60A5FA]"
            />
          </div>

          {/* CHIPS DE FILTRO */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs shrink-0 transition ${
                statusFilter === 'all'
                  ? 'bg-[#0052CC] text-white shadow-sm'
                  : 'bg-[#0E1738] text-slate-400 hover:text-white border border-[#1E2B58]'
              }`}
            >
              Todas ({orders.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('delivered')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs shrink-0 transition ${
                statusFilter === 'delivered'
                  ? 'bg-emerald-600 text-white shadow-sm'
                  : 'bg-[#0E1738] text-slate-400 hover:text-white border border-[#1E2B58]'
              }`}
            >
              Concluídas ({totals.deliveredCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('issues')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs shrink-0 transition ${
                statusFilter === 'issues'
                  ? 'bg-rose-600 text-white shadow-sm'
                  : 'bg-[#0E1738] text-slate-400 hover:text-white border border-[#1E2B58]'
              }`}
            >
              Exceções ({totals.issuesCount})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('in_transit')}
              className={`px-3 py-1.5 rounded-lg font-bold text-xs shrink-0 transition ${
                statusFilter === 'in_transit'
                  ? 'bg-[#FF6B35] text-white shadow-sm'
                  : 'bg-[#0E1738] text-slate-400 hover:text-white border border-[#1E2B58]'
              }`}
            >
              Em Trânsito ({totals.inTransitCount})
            </button>
          </div>
        </div>

        {/* LOADING STATE */}
        {isLoading && (
          <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-8 text-center text-slate-400">
            <div className="h-7 w-7 border-2 border-[#60A5FA] border-t-transparent animate-spin rounded-full mx-auto mb-2" />
            <p className="text-xs">Carregando histórico completo...</p>
          </div>
        )}

        {/* ESTADO VAZIO */}
        {!isLoading && filteredOrders.length === 0 && (
          <div className="rounded-2xl border border-dashed border-[#1E2B58] bg-[#0E1738]/60 p-8 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-[#121E46] text-slate-400 flex items-center justify-center mx-auto mb-1">
              <Package className="h-6 w-6" />
            </div>
            <h3 className="font-heading text-sm font-bold text-white">
              Nenhuma entrega encontrada
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              {searchQuery
                ? 'Nenhum resultado corresponde à sua pesquisa.'
                : 'Você ainda não possui entregas atribuídas registradas no histórico.'}
            </p>
          </div>
        )}

        {/* LISTAGEM PERSISTENTE NA ABA (Requisito 3 — somente leitura) */}
        {!isLoading && filteredOrders.length > 0 && (
          <div className="space-y-2.5">
            {filteredOrders.map((order) => {
              const customer = order.expand?.customer_id
              const calc = calculationsByOrderId.get(order.id)
              const officialKm = calc?.officialKm ?? order.distance_km ?? 0
              const deviationKm = calc?.deviationKm ?? 0

              let statusBadge = (
                <Badge className="bg-slate-500/20 text-slate-300 border-slate-700 text-[10px] font-bold">
                  {order.status}
                </Badge>
              )

              if (order.status === 'delivered') {
                statusBadge = (
                  <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 text-[10px] font-bold">
                    ✓ Entregue
                  </Badge>
                )
              } else if (order.status === 'in_transit') {
                statusBadge = (
                  <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/30 text-[10px] font-bold">
                    🛵 Em Rota
                  </Badge>
                )
              } else if (order.status === 'client_absent') {
                statusBadge = (
                  <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] font-bold">
                    ⚠️ Cliente Ausente
                  </Badge>
                )
              } else if (order.status === 'address_error') {
                statusBadge = (
                  <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px] font-bold">
                    ⚠️ Erro de Endereço
                  </Badge>
                )
              } else if (order.status === 'cancelled') {
                statusBadge = (
                  <Badge className="bg-rose-500/20 text-rose-400 border-rose-500/30 text-[10px] font-bold">
                    ✕ Cancelada
                  </Badge>
                )
              } else if (order.status === 'assigned') {
                statusBadge = (
                  <Badge className="bg-purple-500/20 text-purple-300 border-purple-500/30 text-[10px] font-bold">
                    Na Fila
                  </Badge>
                )
              }

              const formattedDate = new Date(order.created || Date.now()).toLocaleDateString(
                'pt-BR',
                {
                  day: '2-digit',
                  month: '2-digit',
                  year: '2-digit',
                  hour: '2-digit',
                  minute: '2-digit',
                },
              )

              return (
                <div
                  key={order.id}
                  className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-3.5 shadow-md space-y-2 hover:border-[#60A5FA]/40 transition"
                >
                  {/* Cabeçalho do Card: Código e Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-[#60A5FA]">
                        {order.tracking_code}
                      </span>
                      {statusBadge}
                    </div>

                    <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {formattedDate}
                    </span>
                  </div>

                  {/* Informações do Cliente */}
                  <div>
                    <p className="text-xs font-bold text-white truncate">
                      {customer?.name || 'Cliente'}
                    </p>
                    <p className="text-[11px] text-slate-400 truncate mt-0.5 flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                      <span className="truncate">
                        {customer?.street
                          ? `${customer.street}${customer.complement ? `, ${customer.complement}` : ''} - ${customer.neighborhood || customer.city || ''}`
                          : customer?.address || 'Endereço não informado'}
                      </span>
                    </p>
                  </div>

                  {/* Telemetria e KM (Requisito 3) */}
                  <div className="grid grid-cols-2 gap-2 pt-1 border-t border-[#1E2B58]/60 text-[11px]">
                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#0A1128] border border-[#1E2B58]/80">
                      <span className="text-slate-400 text-[10px]">KM Oficial:</span>
                      <span className="font-mono font-bold text-emerald-400">
                        {Number(officialKm).toFixed(1)} km
                      </span>
                    </div>

                    <div className="flex items-center justify-between p-2 rounded-lg bg-[#0A1128] border border-[#1E2B58]/80">
                      <span className="text-slate-400 text-[10px]">KM Desvios:</span>
                      <span
                        className={`font-mono font-bold ${
                          deviationKm > 0 ? 'text-rose-400' : 'text-slate-400'
                        }`}
                      >
                        {deviationKm > 0 ? `+${deviationKm.toFixed(1)} km` : '+0.0 km'}
                      </span>
                    </div>
                  </div>

                  {/* Observações ou motivo de cancelamento se existir */}
                  {(order.notes || order.completion_reason) && (
                    <div className="p-2 rounded-lg bg-[#0A1128] text-[10px] text-slate-300">
                      {order.completion_reason && (
                        <p className="font-semibold text-rose-300">
                          Motivo: {order.completion_reason}
                        </p>
                      )}
                      {order.notes && <p className="text-slate-400">{order.notes}</p>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Botão de Histórico Detalhado em Modal (se o entregador quiser auditar telemetria ponto a ponto) */}
        <div className="pt-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setIsHistoryModalOpen(true)}
            className="w-full h-11 border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-slate-200 text-xs font-semibold rounded-xl flex items-center justify-center gap-2"
          >
            <Compass className="h-4 w-4 text-[#60A5FA]" />
            <span>Auditoria Detalhada de Telemetria GPS &amp; Exportar CSV</span>
          </Button>
        </div>
      </main>

      {/* Navegação Inferior Mobile */}
      <CourierBottomNav />

      {/* Modal de auditoria profunda de telemetria */}
      <CourierDeliveryHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        courier={user}
        fuelAccount={metrics.fuelAccount}
        orders={orders}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
      />
    </div>
  )
}
