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
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { DeliveryConfirmationModal } from '@/components/DeliveryConfirmationModal'
import { deliveryService } from '@/services/deliveryService'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { OrderRecord, OptimizedRouteResult } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from 'sonner'

export default function CourierApp() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [selectedOrderForConfirmation, setSelectedOrderForConfirmation] =
    useState<OrderRecord | null>(null)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [isGpsActive, setIsGpsActive] = useState(true)
  const [currentCoords, setCurrentCoords] = useState<{ lat: number; lng: number }>({
    lat: -23.55052,
    lng: -46.633308,
  })
  const [optimizedRoute, setOptimizedRoute] = useState<OptimizedRouteResult | null>(null)
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  // Load orders assigned to this courier (or all active if none assigned)
  const loadCourierOrders = async () => {
    try {
      const allOrders = await deliveryService.getOrders(
        user?.id ? `courier_id = '${user.id}' || courier_id = ''` : '',
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

  // Realtime hook for orders
  useRealtime<OrderRecord>('orders', (e) => {
    if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
      loadCourierOrders()
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
            const lat = -23.55052 + (Math.random() - 0.5) * 0.008
            const lng = -46.633308 + (Math.random() - 0.5) * 0.008
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
  const handleOptimizeRoute = async () => {
    const activeOrderIds = orders
      .filter((o) => o.status === 'in_transit' || o.status === 'pending')
      .map((o) => o.id)

    if (activeOrderIds.length === 0) {
      toast.info('Não há entregas pendentes para otimizar.')
      return
    }

    setIsOptimizing(true)
    try {
      const res = await deliveryService.optimizeRoute(
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

  const activeDeliveries = orders.filter((o) => o.status === 'in_transit')
  const pendingDeliveries = orders.filter((o) => o.status === 'pending')
  const completedToday = orders.filter((o) => o.status === 'delivered')

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100 flex flex-col pb-20 md:pb-6">
      <Header />

      <main className="flex-1 max-w-2xl mx-auto w-full p-4 space-y-4">
        {/* Courier Status & Live GPS Telemetry Card */}
        <div className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-slate-950 to-purple-950/40 p-4 shadow-xl backdrop-blur">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-purple-600 text-white shadow-lg shadow-purple-600/30">
                <Navigation2 className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  {user?.name || 'Entregador'}
                  <Badge
                    variant="outline"
                    className="bg-purple-500/10 text-purple-300 border-purple-500/30 text-[10px]"
                  >
                    🛵 Online
                  </Badge>
                </h2>
                <p className="text-xs text-slate-400">
                  Transmissão GPS ativa (atualiza a cada 30s)
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-500"></span>
              </span>
              <span className="text-xs font-semibold text-emerald-400">GPS Conectado</span>
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-slate-800/80 text-center">
            <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Em Rota</p>
              <p className="text-lg font-black text-amber-400 mt-0.5">{activeDeliveries.length}</p>
            </div>
            <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Aguardando</p>
              <p className="text-lg font-black text-blue-400 mt-0.5">{pendingDeliveries.length}</p>
            </div>
            <div className="p-2 rounded-xl bg-slate-900/80 border border-slate-800">
              <p className="text-[10px] uppercase font-bold text-slate-400">Entregues</p>
              <p className="text-lg font-black text-emerald-400 mt-0.5">{completedToday.length}</p>
            </div>
          </div>
        </div>

        {/* Route Optimization Button */}
        <div className="flex items-center justify-between gap-3">
          <Button
            onClick={handleOptimizeRoute}
            disabled={
              isOptimizing || (activeDeliveries.length === 0 && pendingDeliveries.length === 0)
            }
            className="flex-1 h-12 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg shadow-purple-600/25 flex items-center justify-center gap-2"
          >
            <Sparkles className="h-4 w-4 animate-spin" style={{ animationDuration: '3s' }} />
            {isOptimizing ? 'Calculando Rota Ótima...' : 'Otimizar Sequência de Entregas (IA)'}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={loadCourierOrders}
            className="h-12 w-12 rounded-xl border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300"
          >
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        {/* AI Route Sequence Preview (If Optimized) */}
        {optimizedRoute && (
          <div className="rounded-2xl border border-indigo-500/40 bg-indigo-950/30 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-indigo-300 font-bold text-xs">
                <Zap className="h-4 w-4 text-amber-400" />
                <span>
                  Sequência Recomendada pelo Copilot ({optimizedRoute.stops_count} paradas)
                </span>
              </div>
              <Badge className="bg-indigo-600 text-white text-[10px]">
                {optimizedRoute.total_distance_km} km • ~{optimizedRoute.estimated_duration_minutes}{' '}
                min
              </Badge>
            </div>

            <div className="space-y-1.5 text-xs text-slate-300">
              {optimizedRoute.optimized_orders.map((stop, idx) => (
                <div
                  key={stop.id}
                  className="flex items-center justify-between p-2 rounded-lg bg-slate-900/80 border border-slate-800"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-purple-600 text-white font-bold text-[10px]">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-white">{stop.customer_name}</p>
                      <p className="text-[10px] text-slate-400 truncate max-w-[200px]">
                        {stop.address}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] text-indigo-300 font-mono">
                    +{stop.step_distance_meters}m
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ACTIVE DELIVERIES LIST (Touch-first cards, min 48px targets) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
              <Clock className="h-4 w-4 text-amber-400" />
              Entregas em Andamento ({activeDeliveries.length})
            </h3>
          </div>

          {activeDeliveries.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-slate-400 space-y-2">
              <p className="text-xs">Nenhuma entrega em trânsito no momento.</p>
              <p className="text-[11px] text-slate-500">
                Veja abaixo os pedidos pendentes para iniciar.
              </p>
            </div>
          ) : (
            activeDeliveries.map((order) => {
              const customer = order.expand?.customer_id
              return (
                <Card
                  key={order.id}
                  className="border-amber-500/30 bg-slate-950/90 text-white shadow-xl overflow-hidden rounded-2xl"
                >
                  <CardHeader className="p-4 pb-2 flex flex-row items-start justify-between border-b border-slate-800/80">
                    <div>
                      <div className="flex items-center gap-2">
                        <Badge className="bg-amber-500 text-slate-950 font-bold text-xs">
                          EM ROTA
                        </Badge>
                        <span className="font-mono font-bold text-xs text-amber-400">
                          {order.tracking_code}
                        </span>
                        {order.priority === 'urgent' && (
                          <Badge variant="destructive" className="text-[10px]">
                            URGENTE
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-base font-bold text-white mt-1.5">
                        {customer?.name || 'Cliente'}
                      </CardTitle>
                    </div>

                    <div className="text-right font-bold text-sm text-emerald-400">
                      R$ {Number(order.total_price || 0).toFixed(2)}
                    </div>
                  </CardHeader>

                  <CardContent className="p-4 space-y-3">
                    {/* Destination Address */}
                    <div className="flex items-start gap-2.5 text-xs text-slate-300">
                      <MapPin className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                      <div>
                        <p className="font-medium text-white">
                          {customer?.address || 'Endereço a confirmar'}
                        </p>
                        {customer?.phone && (
                          <p className="text-slate-400 text-[11px] mt-0.5">📞 {customer.phone}</p>
                        )}
                      </div>
                    </div>

                    {/* Notes / Instructions */}
                    {order.notes && (
                      <div className="rounded-lg bg-slate-900 p-2.5 text-[11px] text-slate-300 border border-slate-800">
                        <span className="font-semibold text-amber-400">Instruções: </span>
                        {order.notes}
                      </div>
                    )}

                    {/* TOUCH ACTION BUTTONS (Min 48px height) */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                      {/* Open GPS Nav */}
                      <Button
                        type="button"
                        onClick={() =>
                          openExternalNavigation(
                            customer?.address || '',
                            customer?.lat,
                            customer?.lng,
                          )
                        }
                        className="h-12 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-xl shadow-md flex items-center justify-center gap-2"
                      >
                        <Compass className="h-4 w-4" />
                        <span>Abrir no Google Maps</span>
                      </Button>

                      {/* Confirm Delivery button */}
                      <Button
                        type="button"
                        onClick={() => {
                          setSelectedOrderForConfirmation(order)
                          setIsConfirmModalOpen(true)
                        }}
                        className="h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2"
                      >
                        <CheckCircle className="h-4 w-4" />
                        <span>Confirmar Entrega</span>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        {/* PENDING ORDERS (Waiting to be started) */}
        {pendingDeliveries.length > 0 && (
          <div className="space-y-3 pt-2">
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 px-1">
              <CheckSquare className="h-4 w-4 text-blue-400" />
              Pedidos Aguardando Coleta / Início ({pendingDeliveries.length})
            </h3>

            <div className="space-y-2.5">
              {pendingDeliveries.map((order) => {
                const customer = order.expand?.customer_id
                return (
                  <div
                    key={order.id}
                    className="p-3.5 rounded-2xl border border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3 hover:border-slate-700 transition"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-blue-400">
                          {order.tracking_code}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] border-blue-500/30 text-blue-400"
                        >
                          Pendente
                        </Badge>
                      </div>
                      <p className="text-xs font-semibold text-white mt-1 truncate">
                        {customer?.name || 'Cliente'}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate">{customer?.address}</p>
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
                      className="h-10 px-4 bg-purple-600 hover:bg-purple-500 text-white font-bold text-xs rounded-xl shrink-0"
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
    </div>
  )
}
