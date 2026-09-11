import React, { useState, useEffect } from 'react'
import {
  Navigation2,
  MapPin,
  CheckCircle,
  ExternalLink,
  Phone,
  Clock,
  Compass,
  AlertTriangle,
  RefreshCw,
  Sparkles,
  ChevronRight,
  ShieldAlert,
  Zap,
  CheckSquare,
  Play,
  Fuel,
  Building,
  RotateCcw,
  CheckCircle2,
  Lock,
  MapPinOff,
  UserX,
  AlertCircle,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { DeliveryConfirmationModal } from '@/components/DeliveryConfirmationModal'
import { deliveryService } from '@/services/deliveryService'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { OrderRecord, OptimizedRouteResult } from '@/types/delivery'
import {
  notifyCourierNewDelivery,
  playOffRouteWarningSound,
  sendBrowserPushNotification,
} from '@/lib/notificationSound'
import type { NotificationRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'
import { CourierFuelSummaryCard } from '@/components/CourierFuelSummaryCard'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'
import { useCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import type {
  FuelAdvanceRecord,
  LocationRecord,
  OffRouteEventRecord,
  AppSettingsRecord,
} from '@/types/delivery'

export default function CourierApp() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [advances, setAdvances] = useState<FuelAdvanceRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [offRouteEvents, setOffRouteEvents] = useState<OffRouteEventRecord[]>([])
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)
  const [selectedOrderForConfirmation, setSelectedOrderForConfirmation] =
    useState<OrderRecord | null>(null)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)
  const [isGpsActive, setIsGpsActive] = useState(true)
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({
    lat: -22.906847,
    lng: -43.172896,
  })
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRouteResult | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isStartingRoute, setIsStartingRoute] = useState(false)

  // Carregar dados de conta corrente e configurações para manter paridade 100% com o Admin
  const loadFuelAndAccountData = async () => {
    if (!user?.id) return
    try {
      const [userAdvances, appSettings, userLocations, userEvents] = await Promise.all([
        deliveryService.getFuelAdvances(`courier_id = '${user.id}'`, '-date,-created'),
        deliveryService.getSettings(),
        deliveryService.getLatestLocations(`user_id = '${user.id}'`),
        deliveryService.getOffRouteEvents(`courier_id = '${user.id}'`),
      ])
      setAdvances(userAdvances)
      setSettings(appSettings)
      setLocations(userLocations)
      setOffRouteEvents(userEvents)
    } catch (err) {
      console.warn('Erro ao carregar dados de telemetria e conta de combustível:', err)
    }
  }

  useEffect(() => {
    loadFuelAndAccountData()
  }, [user])

  // Load orders assigned to this courier (apenas pedidos liberados pelo vendedor OU já em trânsito/entregues)
  const loadCourierOrders = async () => {
    try {
      if (!user?.id) {
        setOrders([])
        return
      }
      // PEDIDO 1: O cliente só fica disponível para os entregadores após o vendedor otimizar e liberar a rota
      // Mostra apenas pedidos atribuídos a este entregador com route_released = true OU status in_transit/delivered
      const courierFilter = `courier_id = '${user.id}' && (route_released = true || status = 'in_transit' || status = 'delivered')`
      const allOrders = await deliveryService.getOrders(
        courierFilter,
        'sequence,-created',
        'customer_id,courier_id,seller_id',
      )
      setOrders(allOrders)
    } catch (err) {
      console.error('Error loading courier orders:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCourierOrders()
  }, [user])

  // Realtime hook for orders with audio alert on new route or assigned deliveries
  useRealtime<OrderRecord>('orders', (e) => {
    if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
      if (
        (e.action === 'create' || e.action === 'update') &&
        e.record.courier_id === user?.id &&
        (e.record.route_released === true ||
          e.record.status === 'in_transit' ||
          e.record.status === 'delivered')
      ) {
        // Play notification chime and dispatch push
        notifyCourierNewDelivery(
          '📦 Nova Rota Liberada!',
          `Pedido ${e.record.tracking_code} está liberado para entrega na sua rota.`,
        )
      }
      loadCourierOrders()
      loadFuelAndAccountData()
    }
  })

  // Realtime hook for fuel advances
  useRealtime<FuelAdvanceRecord>('fuel_advances', (e) => {
    if (e.record.courier_id === user?.id) {
      if (e.action === 'create') {
        toast.success(
          `⛽ Novo adiantamento recebido: R$ ${Number(e.record.amount || 0).toFixed(2)}`,
        )
      }
      loadFuelAndAccountData()
    }
  })

  // Realtime hook for off-route events
  useRealtime<OffRouteEventRecord>('off_route_events', (e) => {
    if (e.record.courier_id === user?.id) {
      loadFuelAndAccountData()
    }
  })

  // Realtime hook for notifications (off-route alerts with audible warning for courier)
  useRealtime<NotificationRecord>('notifications', (e) => {
    if (e.action === 'create' && (!e.record.user_id || e.record.user_id === user?.id)) {
      if (e.record.type === 'off_route') {
        playOffRouteWarningSound()
        sendBrowserPushNotification(e.record.title, e.record.message)
        toast.error(e.record.title, {
          description: e.record.message,
          duration: 8000,
        })
      }
    }
  })

  // Live location GPS routine: updates locations collection every 30 seconds
  useEffect(() => {
    if (!user || !isGpsActive) return

    const updateLocation = async () => {
      // If browser geolocation is available, get real position; otherwise simulate slight movement in SP
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const speed = pos.coords.speed ? Math.round(pos.coords.speed * 3.6) : 28
            setCurrentCoords({ lat, lng })
            try {
              await deliveryService.updateCourierLocation(user.id, lat, lng, speed, 90)
            } catch (e) {
              console.error('Failed to post live location:', e)
            }
          },
          async () => {
            // Simulated slight jitter around SP Center
            const lat = -22.906847 + (Math.random() - 0.5) * 0.008
            const lng = -43.172896 + (Math.random() - 0.5) * 0.008
            setCurrentCoords({ lat, lng })
            try {
              await deliveryService.updateCourierLocation(user.id, lat, lng, 34, 110)
            } catch {
              /* intentionally ignored */
            }
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      }
    }

    // Initial update
    updateLocation()

    // 30 seconds interval
    const interval = setInterval(updateLocation, 30000)
    return () => clearInterval(interval)
  }, [user, isGpsActive])

  // Optimize route calculation via backend AI routing hook
  // Regra 1: Iniciar Rota (acionável após receber a rota; começa a contabilizar km e consumo de combustível)
  const handleStartRoute = async () => {
    if (!user?.id) {
      toast.error('Entregador não autenticado.')
      return
    }

    const unstartedOrders = orders.filter(
      (o) =>
        (o.status === 'assigned' || o.status === 'in_transit' || o.status === 'pending') &&
        !o.route_started,
    )

    if (unstartedOrders.length === 0 && activeDeliveries.length === 0) {
      toast.info('Não há entregas aguardando início de rota.')
      return
    }

    setIsStartingRoute(true)
    try {
      const orderIdsToStart = unstartedOrders.map((o) => o.id)
      await deliveryService.startCourierRoute(user.id, orderIdsToStart)
      toast.success(
        '🚀 Rota iniciada com sucesso! A telemetria, quilometragem e combustível agora estão ativos.',
        {
          duration: 5000,
        },
      )
      await loadCourierOrders()
    } catch (err: any) {
      console.error('Erro ao iniciar rota:', err)
      toast.error('Falha ao iniciar rota. Tente novamente.')
    } finally {
      setIsStartingRoute(false)
    }
  }

  const handleOptimizeRoute = async () => {
    const activeOrderIds = orders
      .filter((o) => o.status === 'in_transit' || o.status === 'pending' || o.status === 'assigned')
      .map((o) => o.id)

    if (activeOrderIds.length === 0) {
      toast.info('Não há entregas pendentes para otimizar.')
      return
    }

    setIsOptimizing(true)
    try {
      const res = await deliveryService.clientSideOptimizeRoute(
        activeOrderIds,
        currentCoords.lat,
        currentCoords.lng,
      )
      setOptimizedRoute(res)
      toast.success('✨ Rota inteligente otimizada com sucesso!')
    } catch (err: unknown) {
      console.error('Routing optimization error:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao otimizar'
      toast.error(msg)
    } finally {
      setIsOptimizing(false)
    }
  }

  // Open GPS Navigation (Google Maps or Waze)
  const openExternalNavigation = (address: string, lat?: number, lng?: number) => {
    const destination = lat && lng ? `${lat},${lng}` : encodeURIComponent(address)
    const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destination}`
    window.open(googleMapsUrl, '_blank')
  }

  const openWazeNavigation = (lat?: number, lng?: number, address?: string) => {
    const wazeUrl =
      lat && lng
        ? `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
        : `https://waze.com/ul?q=${encodeURIComponent(address || '')}`
    window.open(wazeUrl, '_blank')
  }

  // Active deliveries ordered by sequence (or list index if sequence not set)
  const activeDeliveries = [
    ...orders.filter((o) => o.status === 'in_transit' || o.status === 'assigned'),
  ].sort((a, b) => {
    const seqA = a.sequence ?? 9999
    const seqB = b.sequence ?? 9999
    return seqA - seqB
  })

  // Has route already been started for active deliveries?
  const isRouteStarted = activeDeliveries.some((o) => o.route_started === true)

  // Motor de Telemetria e Conta Corrente Compartilhado (Exatamente idêntico ao Admin)
  const courierMetrics = useCourierFuelMetrics({
    courier: user,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter: 'all',
  })

  const totalRouteFuelSpent = courierMetrics.totalSpent
  const totalOfficialKm = courierMetrics.totalOfficialKm

  // Start Base / End Base Info from the first active order
  const startBaseName =
    activeDeliveries.find((o) => o.start_base_name)?.start_base_name || 'Base Central LOGHYPE'
  const startBaseAddress = activeDeliveries.find((o) => o.start_base_address)?.start_base_address
  const endBaseName =
    activeDeliveries.find((o) => o.end_address_name)?.end_address_name || startBaseName
  const endBaseAddress =
    activeDeliveries.find((o) => o.end_address_text)?.end_address_text || startBaseAddress

  // The current active delivery is strictly the FIRST in the queue (index 0)
  const currentActiveDelivery = activeDeliveries.length > 0 ? activeDeliveries[0] : null
  const subsequentDeliveries = activeDeliveries.slice(1)

  const pendingDeliveries = orders.filter((o) => o.status === 'pending')
  const completedToday = orders.filter(
    (o) => o.status === 'delivered' || o.status === 'address_error' || o.status === 'client_absent',
  )

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col pb-20 md:pb-6 font-sans">
      <Header />

      <main className="flex-1 max-w-2xl mx-auto w-full p-4 space-y-4">
        {/* Courier Status & Live GPS Telemetry Card */}
        <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-4 shadow-brand-dark">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-tr from-[#0052CC] to-[#60A5FA] text-white shadow-brand">
                <Navigation2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="font-heading text-base font-bold text-white flex items-center gap-2">
                  {user?.name || 'Entregador'}
                  <Badge
                    variant="outline"
                    className="bg-[#0052CC]/30 text-[#60A5FA] border-[#60A5FA]/40 text-[10px] font-bold"
                  >
                    🛵 LOGHYPE Online
                  </Badge>
                </h2>
                <p className="font-sans text-xs text-slate-400">
                  Transmissão GPS ativa (atualiza a cada 30s)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#22C55E] opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-[#22C55E]"></span>
              </span>
              <span className="text-xs font-bold text-[#22C55E]">GPS Conectado</span>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-[#1E2B58] text-center">
            <div className="p-2.5 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
              <p className="font-heading text-[10px] uppercase font-bold text-slate-400">Em Rota</p>
              <p className="font-heading text-lg font-black text-[#FF6B35] mt-0.5">
                {activeDeliveries.length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
              <p className="font-heading text-[10px] uppercase font-bold text-slate-400">
                Aguardando
              </p>
              <p className="font-heading text-lg font-black text-[#60A5FA] mt-0.5">
                {pendingDeliveries.length}
              </p>
            </div>
            <div className="p-2.5 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
              <p className="font-heading text-[10px] uppercase font-bold text-slate-400">
                Entregues
              </p>
              <p className="font-heading text-lg font-black text-[#22C55E] mt-0.5">
                {completedToday.length}
              </p>
            </div>
          </div>
        </div>

        {/* REQUISITO 1 & 3: CARD DE ROTA E BOTÃO "INICIAR ROTA" */}
        {activeDeliveries.length > 0 && (
          <div className="rounded-xl border border-[#1E2B58] bg-gradient-to-b from-[#0E1738] to-[#0A1128] p-4 shadow-brand-dark space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1E2B58]/80 pb-3">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold font-heading uppercase text-slate-300 flex items-center gap-1.5">
                    <Building className="h-4 w-4 text-[#22C55E]" />🟢 Ponto de Partida:{' '}
                    <span className="text-white">{startBaseName}</span>
                  </span>
                </div>
                {startBaseAddress && (
                  <p className="text-[10px] text-slate-400 pl-5 truncate max-w-sm">
                    {startBaseAddress}
                  </p>
                )}
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-1">
                  <RotateCcw className="h-3.5 w-3.5 text-rose-400" />
                  <span>
                    🏁 Ponto de Chegada (Ida e Volta):{' '}
                    <strong className="text-slate-200">{endBaseName}</strong>
                  </span>
                </div>
                {endBaseAddress && (
                  <p className="text-[10px] text-slate-400 pl-5 truncate max-w-sm">
                    {endBaseAddress}
                  </p>
                )}
              </div>

              {isRouteStarted ? (
                <Badge className="bg-[#22C55E]/20 text-[#22C55E] border border-[#22C55E]/40 font-bold px-3 py-1 text-xs flex items-center gap-1.5 self-start sm:self-center">
                  <span className="h-2 w-2 rounded-full bg-[#22C55E] animate-ping" />
                  ROTA INICIADA (KM ATIVA)
                </Badge>
              ) : (
                <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/40 font-bold px-3 py-1 text-xs self-start sm:self-center">
                  Aguardando Início da Rota
                </Badge>
              )}
            </div>

            {/* Status da Contabilização de KM e Combustível (Regras 1, 2 e 3) */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <div className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58]">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">
                  Status Contabilização
                </span>
                <span
                  className={`font-bold font-heading text-xs mt-0.5 block ${isRouteStarted ? 'text-[#22C55E]' : 'text-slate-400'}`}
                >
                  {isRouteStarted ? '● Contabilizando KM' : '⏸ Pausada (inicie a rota)'}
                </span>
              </div>

              <div
                className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58] cursor-pointer hover:border-[#60A5FA]/60 transition"
                onClick={() => setIsHistoryModalOpen(true)}
              >
                <span className="text-[10px] text-slate-400 block uppercase font-bold flex items-center gap-1">
                  <Fuel className="h-3 w-3 text-[#FF6B35]" /> Consumo Oficial
                </span>
                <span className="font-bold font-mono text-xs mt-0.5 text-white block">
                  R$ {totalRouteFuelSpent.toFixed(2)}
                </span>
              </div>

              <div className="p-2.5 rounded-lg bg-[#070D1E] border border-[#1E2B58] col-span-2 sm:col-span-1">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">
                  Regra de Desvio
                </span>
                <span className="font-semibold text-[11px] mt-0.5 text-[#60A5FA] block">
                  Filtro &gt;300m Ativo
                </span>
              </div>
            </div>

            {/* BOTÃO PRINCIPAL: INICIAR ROTA */}
            {!isRouteStarted ? (
              <Button
                type="button"
                onClick={handleStartRoute}
                disabled={isStartingRoute}
                className="w-full h-14 bg-gradient-to-r from-[#22C55E] to-[#16A34A] hover:from-[#16A34A] hover:to-[#15803D] text-slate-950 font-black text-sm uppercase tracking-wider rounded-xl shadow-lg shadow-green-900/30 flex items-center justify-center gap-3 border border-green-400/30"
              >
                <Play className="h-5 w-5 fill-current" />
                {isStartingRoute
                  ? 'Iniciando Rota...'
                  : '▶ Iniciar Rota (Liberar KM e Combustível)'}
              </Button>
            ) : (
              <div className="p-2.5 rounded-lg bg-[#22C55E]/10 border border-[#22C55E]/30 text-[11px] text-[#22C55E] flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                <span>
                  <strong>Rota em execução!</strong> A quilometragem ida e volta e o consumo de
                  combustível estão sendo registrados oficialmente.
                </span>
              </div>
            )}
          </div>
        )}

        {/* CARD DE CONTA CORRENTE & COMBUSTÍVEL COMPARTILHADO (MESMO DO ADMIN) */}
        <CourierFuelSummaryCard
          metrics={courierMetrics}
          courier={user}
          onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
          subtitle="Valores idênticos aos registrados pelo gestor/administrador"
        />

        {/* Route Optimization Button */}
        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={handleOptimizeRoute}
            disabled={
              isOptimizing || (activeDeliveries.length === 0 && pendingDeliveries.length === 0)
            }
            className="flex-1 h-12 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs rounded-input shadow-brand transition duration-100 flex items-center justify-center gap-2"
          >
            <Sparkles
              className="h-4 w-4 animate-spin text-[#FF6B35]"
              style={{ animationDuration: '3s' }}
            />
            {isOptimizing ? 'Calculando Rota Ótima...' : 'Otimizar Sequência de Entregas (IA)'}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={loadCourierOrders}
            className="h-12 w-12 rounded-card border-slate-200 bg-white hover:bg-slate-50 text-[#0052CC]"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* AI Route Sequence Preview (If Optimized) */}
        {optimizedRoute && (
          <div className="rounded-card border border-blue-200 bg-blue-50/70 p-4 space-y-3 shadow-brand">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[#0052CC] font-bold text-xs font-heading">
                <Zap className="h-4 w-4 text-[#FF6B35]" />
                <span>Sequência Recomendada LOGHYPE ({optimizedRoute.stops_count} paradas)</span>
              </div>
              <Badge className="bg-[#0052CC] text-white text-[10px] font-bold">
                {optimizedRoute.total_distance_km} km • ~{optimizedRoute.estimated_duration_minutes}{' '}
                min
              </Badge>
            </div>

            <div className="space-y-1.5 text-xs text-slate-700 font-sans">
              {optimizedRoute.optimized_orders.map((stop, idx) => (
                <div
                  key={stop.id}
                  className="flex items-center justify-between p-2 rounded-md bg-white border border-slate-200 shadow-xs"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#0052CC] text-white font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-[#1a1a1a]">{stop.customer_name}</p>
                      <p className="text-[10px] text-slate-500 truncate max-w-[200px]">
                        {stop.address}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-[#0052CC] font-mono font-semibold">
                    +{stop.step_distance_meters}m
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* REQUISITO 1: FLUXO DO ENTREGADOR (Bloqueio Sequencial) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-[#1a1a1a] flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-[#FF6B35]" />
              Rota de Entregas ({activeDeliveries.length})
            </h3>
            {activeDeliveries.length > 0 && (
              <span className="font-heading text-[11px] font-bold text-[#FF6B35]">
                1 ativa • {subsequentDeliveries.length} na fila
              </span>
            )}
          </div>

          {activeDeliveries.length === 0 ? (
            <div className="rounded-card border border-dashed border-slate-300 bg-[#F5F5F5] p-8 text-center text-slate-500 space-y-2">
              <p className="text-xs font-semibold">Nenhuma entrega em trânsito no momento.</p>
              <p className="text-[11px] text-slate-400">
                Veja abaixo os pedidos pendentes para iniciar sua rota.
              </p>
            </div>
          ) : (
            <>
              {/* 1. ENTREGA ATUAL DESBLOQUEADA */}
              {currentActiveDelivery && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 px-1">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#22C55E] text-white font-black text-[11px]">
                      1
                    </span>
                    <span className="font-heading text-xs font-bold text-[#22C55E] uppercase tracking-wide">
                      Entrega Atual (Disponível para Finalização)
                    </span>
                  </div>

                  <Card className="border-2 border-[#22C55E] bg-[#0E1738] text-white shadow-brand-dark overflow-hidden rounded-xl">
                    <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between border-b border-[#1E2B58] bg-[#0A1128]/80">
                      <div>
                        <div className="flex items-center gap-2">
                          <Badge className="bg-[#22C55E] text-slate-950 font-bold text-xs animate-pulse">
                            EM ANDAMENTO
                          </Badge>
                          <span className="font-mono font-bold text-xs text-[#60A5FA]">
                            {currentActiveDelivery.tracking_code}
                          </span>
                          {currentActiveDelivery.priority === 'urgent' && (
                            <Badge variant="destructive" className="text-[10px] bg-[#EF4444]">
                              URGENTE
                            </Badge>
                          )}
                        </div>
                        <CardTitle className="font-heading text-base font-bold text-white mt-1.5">
                          {currentActiveDelivery.expand?.customer_id?.name || 'Cliente'}
                        </CardTitle>
                      </div>

                      <div className="font-heading text-right font-black text-sm text-[#22C55E]">
                        R$ {Number(currentActiveDelivery.total_price || 0).toFixed(2)}
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 space-y-3 font-sans">
                      {/* Destination Address */}
                      <div className="flex items-start gap-2.5 text-xs text-slate-300">
                        <MapPin className="h-4 w-4 text-[#FF6B35] shrink-0 mt-0.5" />
                        <div>
                          <p className="font-medium text-white">
                            {currentActiveDelivery.expand?.customer_id?.street
                              ? `${currentActiveDelivery.expand.customer_id.street}${currentActiveDelivery.expand.customer_id.complement ? `, ${currentActiveDelivery.expand.customer_id.complement}` : ''} - ${currentActiveDelivery.expand.customer_id.neighborhood || ''}, ${currentActiveDelivery.expand.customer_id.city || ''} (${currentActiveDelivery.expand.customer_id.state || ''})`
                              : currentActiveDelivery.expand?.customer_id?.address ||
                                'Endereço a confirmar'}
                          </p>
                          {currentActiveDelivery.expand?.customer_id?.postal_code && (
                            <p className="text-slate-400 text-[10px] font-mono mt-0.5">
                              CEP: {currentActiveDelivery.expand.customer_id.postal_code}
                            </p>
                          )}
                          {currentActiveDelivery.expand?.customer_id?.phone && (
                            <p className="text-slate-300 text-[11px] mt-0.5">
                              📞 {currentActiveDelivery.expand.customer_id.phone}
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Notes / Instructions */}
                      {currentActiveDelivery.notes && (
                        <div className="rounded-lg bg-[#0A1128] p-2.5 text-[11px] text-slate-300 border border-[#1E2B58]">
                          <span className="font-semibold text-[#FF6B35]">Instruções: </span>
                          {currentActiveDelivery.notes}
                        </div>
                      )}

                      {/* TOUCH ACTION BUTTONS (Min 48px height) */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {/* Open GPS Nav */}
                        <Button
                          type="button"
                          onClick={() =>
                            openExternalNavigation(
                              currentActiveDelivery.expand?.customer_id?.address || '',
                              currentActiveDelivery.expand?.customer_id?.lat,
                              currentActiveDelivery.expand?.customer_id?.lng,
                            )
                          }
                          className="h-12 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs rounded-lg shadow-brand flex items-center justify-center gap-2 border border-blue-400/30"
                        >
                          <Compass className="h-4 w-4 text-[#60A5FA]" />
                          <span>Abrir no Google Maps</span>
                        </Button>

                        {/* Finalizar Entrega button (Abre modal de motivos) */}
                        <Button
                          type="button"
                          onClick={() => {
                            setSelectedOrderForConfirmation(currentActiveDelivery)
                            setIsConfirmModalOpen(true)
                          }}
                          className="h-12 bg-[#22C55E] hover:bg-[#16A34A] text-slate-950 font-bold text-xs rounded-lg shadow-brand flex items-center justify-center gap-2"
                        >
                          <CheckCircle className="h-4 w-4" />
                          <span>Finalizar / Informar Motivo</span>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )}

              {/* 2. PRÓXIMAS ENTREGAS BLOQUEADAS SEQUENCIALMENTE */}
              {subsequentDeliveries.length > 0 && (
                <div className="space-y-2 pt-3">
                  <div className="flex items-center gap-2 px-1">
                    <Lock className="h-4 w-4 text-slate-400" />
                    <span className="font-heading text-xs font-bold text-slate-500 uppercase tracking-wide">
                      Próximas Entregas na Fila (Bloqueadas até concluir a atual)
                    </span>
                  </div>

                  <div className="space-y-2 font-sans">
                    {subsequentDeliveries.map((order, idx) => {
                      const customer = order.expand?.customer_id
                      const stopNumber = idx + 2

                      return (
                        <div
                          key={order.id}
                          className="p-3.5 rounded-xl border border-[#1E2B58] bg-[#0E1738]/80 opacity-90 flex flex-col sm:flex-row sm:items-center justify-between gap-3 relative overflow-hidden"
                        >
                          <div className="flex items-start gap-3">
                            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#121E46] border border-[#1E2B58] text-slate-300 font-bold text-xs shrink-0 mt-0.5">
                              {stopNumber}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold text-[#60A5FA]">
                                  {order.tracking_code}
                                </span>
                                <Badge
                                  variant="outline"
                                  className="text-[10px] bg-[#0A1128] border-[#1E2B58] text-slate-400 flex items-center gap-1 font-bold"
                                >
                                  <Lock className="h-2.5 w-2.5" />
                                  Na fila (#{stopNumber})
                                </Badge>
                              </div>
                              <p className="text-xs font-semibold text-white mt-1 truncate">
                                {customer?.name || 'Cliente'}
                              </p>
                              <p className="text-[10px] text-slate-400 truncate">
                                {customer?.street || customer?.address}
                              </p>
                            </div>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#1E2B58]">
                            <span className="font-heading text-xs font-bold text-white font-mono">
                              R$ {Number(order.total_price || 0).toFixed(2)}
                            </span>
                            <Button
                              disabled
                              size="sm"
                              className="h-8 px-3 bg-[#121E46] text-slate-400 font-semibold text-[11px] rounded-lg cursor-not-allowed flex items-center gap-1.5 border border-[#1E2B58]"
                            >
                              <Lock className="h-3 w-3" />
                              Bloqueado
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* PENDING ORDERS (Waiting to be started) */}
        {pendingDeliveries.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-[#1a1a1a] flex items-center gap-1.5 px-1">
              <CheckSquare className="h-4 w-4 text-[#0052CC]" />
              Pedidos Aguardando Coleta / Início ({pendingDeliveries.length})
            </h3>

            <div className="space-y-2.5 font-sans">
              {pendingDeliveries.map((order) => {
                const customer = order.expand?.customer_id
                return (
                  <div
                    key={order.id}
                    className="p-3.5 rounded-xl border border-[#1E2B58] bg-[#0E1738] shadow-brand-dark flex items-center justify-between gap-3 hover:border-[#60A5FA]/50 transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[#60A5FA]">
                          {order.tracking_code}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] border-[#0052CC]/40 text-[#60A5FA] font-bold bg-[#0052CC]/20"
                        >
                          Pendente
                        </Badge>
                      </div>
                      <p className="text-xs font-semibold text-white mt-1 truncate">
                        {customer?.name || 'Cliente'}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">
                        {customer?.street || customer?.address}
                      </p>
                    </div>

                    <Button
                      size="sm"
                      onClick={async () => {
                        try {
                          await deliveryService.updateOrder(order.id, {
                            status: 'in_transit',
                            courier_id: user?.id,
                            estimated_arrival: new Date(Date.now() + 45 * 60 * 1000).toISOString(),
                          })
                          toast.success(`Pedido ${order.tracking_code} marcado como EM TRÂNSITO!`)
                          loadCourierOrders()
                        } catch {
                          toast.error('Erro ao iniciar entrega.')
                        }
                      }}
                      className="h-10 px-4 bg-[#FF6B35] hover:bg-[#E5531E] text-white font-bold text-xs rounded-lg shrink-0 shadow-brand"
                    >
                      Iniciar
                    </Button>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <CourierBottomNav />

      {/* Delivery Confirmation & Signature Capture Modal */}
      <DeliveryConfirmationModal
        order={selectedOrderForConfirmation}
        open={isConfirmModalOpen}
        onOpenChange={setIsConfirmModalOpen}
        onConfirmed={loadCourierOrders}
      />

      {/* CourierDeliveryHistoryModal (MESMO MODAL DO ADMIN, RESTRITO AO PRÓPRIO ENTREGADOR) */}
      <CourierDeliveryHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        courier={user}
        fuelAccount={courierMetrics.fuelAccount}
        orders={orders}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
      />
    </div>
  )
}
