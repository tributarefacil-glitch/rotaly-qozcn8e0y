import React, { useState, useEffect } from 'react'
import {
  Package,
  Plus,
  Truck,
  Users,
  Clock,
  Filter,
  Search,
  CheckCircle,
  AlertCircle,
  ExternalLink,
  ChevronRight,
  TrendingUp,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { LiveMap, type MapMarkerItem } from '@/components/LiveMap'
import { CreateOrderModal } from '@/components/CreateOrderModal'
import { RouteOptimizerModal } from '@/components/RouteOptimizerModal'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import type {
  OrderRecord,
  CustomerRecord,
  UserRecord,
  LocationRecord,
  NotificationRecord,
} from '@/types/delivery'
import { playOffRouteWarningSound, sendBrowserPushNotification } from '@/lib/notificationSound'
import { useAuth } from '@/contexts/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Label } from '@/components/ui/label'
import { Link } from 'react-router-dom'
import {
  Ban,
  Undo2,
  UserPlus,
  Send,
  MoreVertical,
  CheckCircle2,
  XCircle,
  HelpCircle,
} from 'lucide-react'
import { toast } from 'sonner'

export default function SellerDashboard() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [couriers, setCouriers] = useState<UserRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isOptimizerModalOpen, setIsOptimizerModalOpen] = useState(false)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  // Modal: Adicionar Entrega à Rota Já Iniciada de um Entregador
  const [isAddToRouteModalOpen, setIsAddToRouteModalOpen] = useState(false)
  const [selectedOrderForAddToRoute, setSelectedOrderForAddToRoute] = useState<OrderRecord | null>(
    null,
  )
  const [targetCourierId, setTargetCourierId] = useState<string>('')
  const [isAddingToRoute, setIsAddingToRoute] = useState(false)

  const loadData = async () => {
    try {
      const [ordersData, custData, couriersData, locsData] = await Promise.all([
        deliveryService.getOrders(),
        deliveryService.getCustomers(),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
      ])
      setOrders(ordersData)
      setCustomers(custData)
      setCouriers(couriersData)
      setLocations(locsData)
    } catch (err) {
      console.error('Error loading seller dashboard data:', err)
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Realtime subscriptions for orders and courier locations
  useRealtime<OrderRecord>('orders', (e) => {
    if (e.action === 'create') {
      setOrders((prev) => [e.record, ...prev])
      toast.info(`📦 Novo pedido criado: ${e.record.tracking_code}`)
    } else if (e.action === 'update') {
      setOrders((prev) => prev.map((o) => (o.id === e.record.id ? e.record : o)))
    } else if (e.action === 'delete') {
      setOrders((prev) => prev.filter((o) => o.id !== e.record.id))
    }
  })

  useRealtime<LocationRecord>('locations', (e) => {
    if (e.action === 'create') {
      setLocations((prev) => [e.record, ...prev.filter((l) => l.user_id !== e.record.user_id)])
    }
  })

  // Realtime hook for seller notifications (off-route alerts with audible warning for seller)
  useRealtime<NotificationRecord>('notifications', (e) => {
    if (
      e.action === 'create' &&
      (!e.record.user_id ||
        e.record.user_id === user?.id ||
        user?.role === 'admin' ||
        user?.role === 'seller')
    ) {
      if (e.record.type === 'off_route') {
        playOffRouteWarningSound()
        sendBrowserPushNotification(e.record.title, e.record.message)
        toast.error(e.record.title, {
          description: e.record.message,
          duration: 9000,
        })
      }
    }
  })

  // Map markers computation
  const mapMarkers: MapMarkerItem[] = []

  // Add active couriers markers
  couriers.forEach((c) => {
    const courierLoc = locations.find((l) => l.user_id === c.id)
    if (courierLoc) {
      mapMarkers.push({
        id: `courier-${c.id}`,
        title: `🛵 ${c.name}`,
        subtitle: `Status: ${c.status === 'busy' ? 'Em Entrega' : 'Disponível'}`,
        lat: courierLoc.lat,
        lng: courierLoc.lng,
        type: 'courier',
        speed: courierLoc.speed || 32,
      })
    }
  })

  // Add delivery destination markers for in_transit and pending orders
  orders.forEach((o) => {
    const cust = customers.find((c) => c.id === o.customer_id)
    if (cust && cust.lat && cust.lng) {
      mapMarkers.push({
        id: `order-${o.id}`,
        title: `${o.tracking_code} (${cust.name})`,
        subtitle: `${cust.address} • R$ ${Number(o.total_price || 0).toFixed(2)}`,
        lat: cust.lat,
        lng: cust.lng,
        type:
          o.status === 'in_transit'
            ? 'order_transit'
            : o.status === 'delivered'
              ? 'order_delivered'
              : 'order_pending',
        tracking_code: o.tracking_code,
      })
    }
  })

  // Filtered orders list
  const filteredOrders = orders.filter((o) => {
    const matchesStatus = selectedStatus === 'all' ? true : o.status === selectedStatus
    const customerName = o.expand?.customer_id?.name || ''
    const matchesSearch =
      o.tracking_code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      customerName.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesStatus && matchesSearch
  })

  // REQUISITO 2: PERMISSÕES DO VENDEDOR/ADMIN sobre entregas
  // 1. Cancelar entrega
  const handleCancelOrder = async (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    if (!window.confirm('Tem certeza que deseja cancelar esta entrega?')) return

    try {
      await deliveryService.updateOrder(orderId, {
        status: 'cancelled',
      })
      toast.warning('Entrega cancelada com sucesso.')
      loadData()
    } catch (err) {
      console.error('Error cancelling order:', err)
      toast.error('Erro ao cancelar entrega.')
    }
  }

  // 2. Retirar da rota (volta para status "pending" sem entregador atribuído)
  const handleRemoveFromRoute = async (orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()

    try {
      await deliveryService.updateOrder(orderId, {
        status: 'pending',
        courier_id: '',
        sequence: undefined,
      })
      toast.info('Entrega retirada da rota e retornada para o status "Pendente" (sem entregador).')
      loadData()
    } catch (err) {
      console.error('Error removing order from route:', err)
      toast.error('Erro ao retirar entrega da rota.')
    }
  }

  // 3. Adicionar cliente/entrega a uma rota JÁ INICIADA (Entra no FIM da fila do entregador)
  const handleConfirmAddToActiveRoute = async () => {
    if (!selectedOrderForAddToRoute || !targetCourierId) {
      toast.error('Selecione um entregador.')
      return
    }

    setIsAddingToRoute(true)
    try {
      // Find maximum sequence among current in_transit orders for this courier
      const courierOrders = orders.filter(
        (o) => o.courier_id === targetCourierId && o.status === 'in_transit',
      )
      const nextSequence = courierOrders.reduce((max, o) => Math.max(max, o.sequence || 0), 0) + 1

      await deliveryService.updateOrder(selectedOrderForAddToRoute.id, {
        courier_id: targetCourierId,
        status: 'in_transit',
        sequence: nextSequence,
        estimated_arrival: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      })

      // Send realtime notification to courier
      await deliveryService.createNotification({
        user_id: targetCourierId,
        title: '📦 Nova Entrega Adicionada à sua Rota!',
        message: `O pedido ${selectedOrderForAddToRoute.tracking_code} foi adicionado ao fim da sua fila de entregas.`,
        type: 'order',
        read: false,
        order_id: selectedOrderForAddToRoute.id,
      })

      toast.success(
        `Entrega ${selectedOrderForAddToRoute.tracking_code} adicionada ao fim da rota do entregador com sucesso!`,
      )
      setIsAddToRouteModalOpen(false)
      setSelectedOrderForAddToRoute(null)
      setTargetCourierId('')
      loadData()
    } catch (err) {
      console.error('Error adding to active route:', err)
      toast.error('Erro ao adicionar entrega à rota.')
    } finally {
      setIsAddingToRoute(false)
    }
  }

  // Quick stats
  const pendingCount = orders.filter((o) => o.status === 'pending').length
  const inTransitCount = orders.filter((o) => o.status === 'in_transit').length
  const deliveredCount = orders.filter((o) => o.status === 'delivered').length
  const totalRevenue = orders
    .filter((o) => o.status !== 'cancelled')
    .reduce((acc, o) => acc + (Number(o.total_price) || 0), 0)

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Header />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-[1600px] mx-auto w-full">
          {/* Top Title & Actions Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                Painel do Vendedor & Frotas
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Acompanhamento em tempo real de pedidos, mapa interativo e inserção ágil de vendas.
              </p>
            </div>

            <div className="flex items-center gap-2.5 flex-wrap sm:flex-nowrap">
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                className="h-9 gap-1.5 text-xs text-slate-600 dark:text-slate-300"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </Button>
              <Button
                onClick={() => setIsOptimizerModalOpen(true)}
                className="h-9 gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Otimizar Rotas da Frota
              </Button>
              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="h-9 gap-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-md shadow-blue-500/25"
              >
                <Plus className="h-4 w-4" />
                Nova Venda / Entrega
              </Button>
            </div>
          </div>

          {/* KPI Summary Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Em Trânsito
                  </p>
                  <p className="text-2xl font-bold text-amber-600 dark:text-amber-400 mt-1">
                    {inTransitCount}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600 dark:bg-amber-950/40">
                  <Truck className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Pendentes
                  </p>
                  <p className="text-2xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {pendingCount}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600 dark:bg-blue-950/40">
                  <Clock className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Concluídas
                  </p>
                  <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    {deliveredCount}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600 dark:bg-emerald-950/40">
                  <CheckCircle className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>

            <Card className="border-slate-200/80 dark:border-slate-800 shadow-sm">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    Volume Total
                  </p>
                  <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">
                    R$ {totalRevenue.toFixed(2)}
                  </p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-500/10 text-purple-600 dark:bg-purple-950/40">
                  <TrendingUp className="h-5 w-5" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Full-width Interactive Live Map */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900 dark:text-white uppercase tracking-wider">
                  Mapa da Frota & Destinos ao Vivo
                </h2>
              </div>
              <span className="text-xs text-slate-500">
                {couriers.length} entregadores monitorados • {orders.length} pedidos
              </span>
            </div>

            <LiveMap
              markers={mapMarkers}
              selectedMarkerId={selectedMarkerId}
              onSelectMarker={(m) => {
                setSelectedMarkerId(m.id)
                if (m.tracking_code) {
                  setSearchQuery(m.tracking_code)
                }
              }}
              height="440px"
            />
          </div>

          {/* Orders Management Table with Filters */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-blue-600" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Gerenciador de Pedidos ({filteredOrders.length})
                </h3>
              </div>

              {/* Status Filters & Search */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <Tabs
                  value={selectedStatus}
                  onValueChange={setSelectedStatus}
                  className="w-full sm:w-auto"
                >
                  <TabsList className="grid grid-cols-4 h-9">
                    <TabsTrigger value="all" className="text-xs">
                      Todos ({orders.length})
                    </TabsTrigger>
                    <TabsTrigger value="pending" className="text-xs">
                      Pendentes ({pendingCount})
                    </TabsTrigger>
                    <TabsTrigger value="in_transit" className="text-xs">
                      Em Trânsito ({inTransitCount})
                    </TabsTrigger>
                    <TabsTrigger value="delivered" className="text-xs">
                      Entregues ({deliveredCount})
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                <div className="relative min-w-[200px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    placeholder="Filtrar por código ou cliente..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 pl-8 text-xs bg-slate-50 dark:bg-slate-800"
                  />
                </div>
              </div>
            </div>

            {/* Orders Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-800 dark:bg-slate-800/50 uppercase tracking-wider">
                    <th className="py-3 px-3 font-semibold">Código</th>
                    <th className="py-3 px-3 font-semibold">Cliente & Destino</th>
                    <th className="py-3 px-3 font-semibold">Entregador / Fila</th>
                    <th className="py-3 px-3 font-semibold">Status / Motivo</th>
                    <th className="py-3 px-3 font-semibold">Prioridade</th>
                    <th className="py-3 px-3 font-semibold text-right">Valor Total</th>
                    <th className="py-3 px-3 font-semibold text-right">Ações da Venda</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredOrders.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-slate-400">
                        Nenhum pedido encontrado para o filtro aplicado.
                      </td>
                    </tr>
                  ) : (
                    filteredOrders.map((order) => {
                      const customer = customers.find((c) => c.id === order.customer_id)
                      const courier = couriers.find((c) => c.id === order.courier_id)

                      const statusBadge = {
                        pending: (
                          <Badge
                            variant="outline"
                            className="bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300"
                          >
                            Pendente
                          </Badge>
                        ),
                        in_transit: (
                          <Badge
                            variant="outline"
                            className="bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 animate-pulse"
                          >
                            🛵 Em Trânsito
                          </Badge>
                        ),
                        delivered: (
                          <Badge
                            variant="outline"
                            className="bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300"
                          >
                            ✓ Entregue
                          </Badge>
                        ),
                        cancelled: (
                          <Badge
                            variant="outline"
                            className="bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400"
                          >
                            Cancelado
                          </Badge>
                        ),
                      }[order.status]

                      const priorityBadge = {
                        urgent: <span className="text-rose-600 font-bold">🔴 Urgente</span>,
                        high: <span className="text-amber-600 font-medium">🟡 Alta</span>,
                        normal: <span className="text-slate-500">🟢 Normal</span>,
                      }[order.priority || 'normal']

                      return (
                        <tr
                          key={order.id}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/60 transition group cursor-pointer"
                          onClick={() => setSelectedMarkerId(`order-${order.id}`)}
                        >
                          <td className="py-3 px-3 font-mono font-bold text-slate-900 dark:text-white">
                            {order.tracking_code}
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-semibold text-slate-800 dark:text-slate-200">
                              {customer?.name || 'Cliente'}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">
                              {customer?.address || 'Endereço não cadastrado'}
                            </p>
                          </td>
                          <td className="py-3 px-3 text-slate-600 dark:text-slate-300">
                            {courier ? (
                              <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-purple-500 shrink-0"></span>
                                <span className="font-semibold text-slate-900 dark:text-white">
                                  {courier.name}
                                </span>
                                {order.sequence && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1 py-0 bg-slate-100 dark:bg-slate-800"
                                  >
                                    #{order.sequence}
                                  </Badge>
                                )}
                              </div>
                            ) : (
                              <span className="text-slate-400 italic">Não atribuído</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div>
                              {statusBadge}
                              {order.completion_reason &&
                                order.completion_reason !== 'delivered' && (
                                  <span className="block text-[10px] text-amber-600 dark:text-amber-400 font-medium mt-0.5">
                                    {order.completion_reason === 'address_error'
                                      ? '⚠️ Erro de Endereço'
                                      : '⚠️ Cliente Ausente'}
                                  </span>
                                )}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-xs">{priorityBadge}</td>
                          <td className="py-3 px-3 text-right font-bold text-slate-900 dark:text-white">
                            R$ {Number(order.total_price || 0).toFixed(2)}
                          </td>
                          <td className="py-3 px-3 text-right" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-end gap-1.5 flex-wrap">
                              {/* Link Rastreio */}
                              <Link
                                to={`/track/${order.tracking_code}`}
                                className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-700 hover:underline text-xs font-semibold px-2 py-1"
                              >
                                <span>Rastrear</span>
                                <ExternalLink className="h-3 w-3" />
                              </Link>

                              {/* Adicionar a Rota Já Iniciada */}
                              {order.status === 'pending' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => {
                                    setSelectedOrderForAddToRoute(order)
                                    setIsAddToRouteModalOpen(true)
                                  }}
                                  className="h-7 px-2 text-[11px] text-purple-600 border-purple-200 hover:bg-purple-50 dark:border-purple-800 gap-1"
                                  title="Adicionar à rota de um entregador em andamento"
                                >
                                  <UserPlus className="h-3 w-3" />+ Rota
                                </Button>
                              )}

                              {/* Retirar da Rota */}
                              {order.status === 'in_transit' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleRemoveFromRoute(order.id, e)}
                                  className="h-7 px-2 text-[11px] text-amber-600 border-amber-200 hover:bg-amber-50 dark:border-amber-800 gap-1"
                                  title="Retirar da rota e voltar para pendente"
                                >
                                  <Undo2 className="h-3 w-3" />
                                  Retirar
                                </Button>
                              )}

                              {/* Cancelar Entrega */}
                              {order.status !== 'cancelled' && order.status !== 'delivered' && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => handleCancelOrder(order.id, e)}
                                  className="h-7 px-2 text-[11px] text-rose-600 border-rose-200 hover:bg-rose-50 dark:border-rose-800 gap-1"
                                  title="Cancelar entrega"
                                >
                                  <Ban className="h-3 w-3" />
                                  Cancelar
                                </Button>
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
          </div>
        </main>
      </div>

      {/* Floating AI Logistics Copilot Chat Assistant */}
      <AiLogisticsAssistant />

      {/* Modal for Quick Sales / Order Creation */}
      <CreateOrderModal
        open={isCreateModalOpen}
        onOpenChange={setIsCreateModalOpen}
        customers={customers}
        couriers={couriers}
        onOrderCreated={loadData}
      />

      {/* Multi-Courier Route Optimizer Assistant Modal */}
      <RouteOptimizerModal
        open={isOptimizerModalOpen}
        onOpenChange={setIsOptimizerModalOpen}
        orders={orders}
        couriers={couriers}
        customers={customers}
        locations={locations}
        onRoutesApplied={loadData}
      />

      {/* MODAL: Adicionar Entrega a Rota JÁ INICIADA do Entregador */}
      <Dialog open={isAddToRouteModalOpen} onOpenChange={setIsAddToRouteModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-slate-900 dark:text-white">
              <UserPlus className="h-5 w-5 text-indigo-600" />
              Adicionar Entrega à Rota em Andamento
            </DialogTitle>
            <DialogDescription className="text-xs">
              A nova entrega entrará automaticamente no <strong>FIM da fila</strong> do entregador
              selecionado e ele receberá um alerta sonoro e notificação push instantânea.
            </DialogDescription>
          </DialogHeader>

          {selectedOrderForAddToRoute && (
            <div className="space-y-3.5 py-2">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border text-xs space-y-1">
                <p className="font-bold text-slate-900 dark:text-white">
                  Pedido: {selectedOrderForAddToRoute.tracking_code}
                </p>
                <p className="text-slate-600 dark:text-slate-300">
                  Cliente:{' '}
                  {customers.find((c) => c.id === selectedOrderForAddToRoute.customer_id)?.name ||
                    'Cliente'}
                </p>
                <p className="text-slate-500 text-[11px]">
                  Endereço:{' '}
                  {customers.find((c) => c.id === selectedOrderForAddToRoute.customer_id)?.address}
                </p>
              </div>

              <div>
                <Label className="text-xs font-semibold">
                  Selecione o Entregador com Rota Ativa
                </Label>
                <Select value={targetCourierId} onValueChange={setTargetCourierId}>
                  <SelectTrigger className="mt-1 text-xs">
                    <SelectValue placeholder="Escolha um entregador..." />
                  </SelectTrigger>
                  <SelectContent>
                    {couriers
                      .filter((c) => c.status !== 'inactive')
                      .map((c) => {
                        const inTransitCount = orders.filter(
                          (o) => o.courier_id === c.id && o.status === 'in_transit',
                        ).length
                        return (
                          <SelectItem key={c.id} value={c.id}>
                            🛵 {c.name} ({inTransitCount} entregas ativas)
                          </SelectItem>
                        )
                      })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setIsAddToRouteModalOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isAddingToRoute || !targetCourierId}
              onClick={handleConfirmAddToActiveRoute}
              className="bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs"
            >
              {isAddingToRoute ? 'Enviando...' : 'Despachar para o Fim da Fila'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
