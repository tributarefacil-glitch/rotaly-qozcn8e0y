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
  Building,
  RotateCcw,
  Edit3,
} from 'lucide-react'
import type { BaseAddressRecord } from '@/types/delivery'
import { Header } from '@/components/Header'
import { Sidebar } from '@/components/Sidebar'
import { LiveMap, type MapMarkerItem } from '@/components/LiveMap'
import { CreateOrderModal } from '@/components/CreateOrderModal'
import { CreateCourierModal } from '@/components/CreateCourierModal'
import { CreateCustomerModal } from '@/components/CreateCustomerModal'
import { RouteOptimizerModal } from '@/components/RouteOptimizerModal'
import { AiLogisticsAssistant } from '@/components/AiLogisticsAssistant'
import { ControlTower } from '@/components/ControlTower'
import { ReportsSection } from '@/components/ReportsSection'
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

interface SellerDashboardProps {
  defaultTab?: 'overview' | 'control-tower' | 'reports'
}

export default function SellerDashboard({ defaultTab = 'overview' }: SellerDashboardProps) {
  const { user } = useAuth()
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [customers, setCustomers] = useState<CustomerRecord[]>([])
  const [couriers, setCouriers] = useState<UserRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [selectedStatus, setSelectedStatus] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const [isCreateCourierModalOpen, setIsCreateCourierModalOpen] = useState(false)
  const [isCreateCustomerModalOpen, setIsCreateCustomerModalOpen] = useState(false)
  const [isOptimizerModalOpen, setIsOptimizerModalOpen] = useState(false)
  const [selectedMarkerId, setSelectedMarkerId] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mainViewTab, setMainViewTab] = useState<'overview' | 'control-tower' | 'reports'>(
    defaultTab,
  )

  // Base Addresses & Editable Quick Config beside Iniciar Despacho (Regras 4 e 5)
  const [baseAddresses, setBaseAddresses] = useState<BaseAddressRecord[]>([])
  const [selectedBaseId, setSelectedBaseId] = useState<string>('')
  const [selectedEndAddressId, setSelectedEndAddressId] = useState<string>('')
  const [isBaseConfigOpen, setIsBaseConfigOpen] = useState(false)
  const [newBaseName, setNewBaseName] = useState('')
  const [newBaseAddress, setNewBaseAddress] = useState('')
  const [newBaseType, setNewBaseType] = useState<'base' | 'end_point'>('base')
  const [isSavingBase, setIsSavingBase] = useState(false)

  useEffect(() => {
    if (defaultTab) {
      setMainViewTab(defaultTab)
    }
  }, [defaultTab])

  // Modal: Adicionar Entrega à Rota Já Iniciada de um Entregador
  const [isAddToRouteModalOpen, setIsAddToRouteModalOpen] = useState(false)
  const [selectedOrderForAddToRoute, setSelectedOrderForAddToRoute] = useState<OrderRecord | null>(
    null,
  )
  const [targetCourierId, setTargetCourierId] = useState<string>('')
  const [isAddingToRoute, setIsAddingToRoute] = useState(false)
  const [copiedOrderId, setCopiedOrderId] = useState<string | null>(null)

  const handleCopyTrackingLink = (trackingCode: string, orderId: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const fullUrl = `${origin}/track/${trackingCode}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(fullUrl)
    }
    setCopiedOrderId(orderId)
    toast.success(`Link de rastreio copiado!`, {
      description: fullUrl,
    })
    setTimeout(() => {
      setCopiedOrderId(null)
    }, 2000)
  }

  const loadData = async () => {
    try {
      const [ordersData, custData, couriersData, locsData, basesData] = await Promise.all([
        deliveryService.getOrders(),
        deliveryService.getCustomers(),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
        deliveryService.getBaseAddresses(),
      ])
      setOrders(ordersData)
      setCustomers(custData)
      setCouriers(couriersData)
      setLocations(locsData)
      setBaseAddresses(basesData)
      const defaultBase = basesData.find((b) => b.is_default) || basesData[0]
      const defaultEnd =
        basesData.find((b) => b.is_end_default || b.type === 'end_point') || defaultBase
      if (defaultBase && !selectedBaseId) setSelectedBaseId(defaultBase.id)
      if (defaultEnd && !selectedEndAddressId) setSelectedEndAddressId(defaultEnd.id)
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

  // REQUISITO 2: Entregadores aparecem no mapa apenas com rota iniciada
  couriers.forEach((c) => {
    // Verificar se tem rota iniciada ou pedidos em trânsito
    const courierOrders = orders.filter((o) => o.courier_id === c.id)
    const hasRouteStarted =
      courierOrders.some((o) => o.route_started === true) ||
      courierOrders.some((o) => o.status === 'in_transit')

    if (hasRouteStarted) {
      const courierLoc = locations.find((l) => l.user_id === c.id)
      if (courierLoc) {
        mapMarkers.push({
          id: `courier-${c.id}`,
          title: `🛵 ${c.name} (Em Rota)`,
          subtitle: `Status: Em Rota • ${courierOrders.filter((o) => o.status === 'in_transit').length} em trânsito`,
          lat: courierLoc.lat,
          lng: courierLoc.lng,
          type: 'courier',
          speed: courierLoc.speed || 32,
        })
      }
    }
  })

  // Add delivery destination markers for in_transit, pending and delivered orders
  orders.forEach((o) => {
    const cust = customers.find((c) => c.id === o.customer_id)
    const courier = couriers.find((c) => c.id === o.courier_id)
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
        customer_name: cust.name,
        customer_address: cust.address,
        total_price: Number(o.total_price || 0),
        estimated_arrival: o.estimated_arrival,
        courier_name: courier?.name,
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
        route_released: true,
        route_released_at: new Date().toISOString(),
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

  // 4. Liberar rota individual de um pedido ou liberar todas as rotas pendentes de um entregador
  const [releasingOrderId, setReleasingOrderId] = useState<string | null>(null)
  const [isReleasingAllForCourier, setIsReleasingAllForCourier] = useState<string | null>(null)

  const handleReleaseOrderRoute = async (
    orderId: string,
    courierId?: string,
    e?: React.MouseEvent,
  ) => {
    if (e) e.stopPropagation()
    setReleasingOrderId(orderId)
    try {
      await deliveryService.releaseRouteForOrders([orderId], courierId)
      toast.success(
        '🚀 Rota liberada com sucesso! O entregador já pode visualizar a entrega no app.',
      )
      loadData()
    } catch (err) {
      console.error('Error releasing order route:', err)
      toast.error('Erro ao liberar rota.')
    } finally {
      setReleasingOrderId(null)
    }
  }

  const handleReleaseAllForCourier = async (courierId: string) => {
    setIsReleasingAllForCourier(courierId)
    try {
      const courierOrders = orders.filter(
        (o) =>
          o.courier_id === courierId &&
          o.route_released !== true &&
          o.status !== 'delivered' &&
          o.status !== 'cancelled',
      )
      const ids = courierOrders.map((o) => o.id)
      if (ids.length === 0) {
        toast.info('Não há entregas pendentes de liberação para este entregador.')
        return
      }
      await deliveryService.releaseRouteForOrders(ids, courierId)
      toast.success(`🚀 Todas as ${ids.length} entregas foram liberadas para o entregador!`)
      loadData()
    } catch (err) {
      console.error('Error releasing all orders for courier:', err)
      toast.error('Erro ao liberar rota em lote.')
    } finally {
      setIsReleasingAllForCourier(null)
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
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col">
      <Header />

      <div className="flex flex-1">
        <Sidebar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 space-y-6 overflow-y-auto max-w-[1600px] mx-auto w-full">
          {/* Top Title & Actions Bar */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="font-heading text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center gap-2.5">
                Painel do Lojista LOGHYPE
              </h1>
              <p className="font-sans text-xs sm:text-sm text-slate-400">
                Acompanhamento em tempo real de pedidos, mapa de frotas, Torre de Controle e
                Relatórios.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={loadData}
                className="h-10 min-h-[44px] gap-1.5 text-xs text-slate-300 border-[#1E2B58] hover:bg-[#1E2B58] hover:text-white"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Atualizar
              </Button>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsBaseConfigOpen(!isBaseConfigOpen)}
                className={`h-10 min-h-[44px] gap-1.5 text-xs border border-[#60A5FA]/40 font-bold ${
                  isBaseConfigOpen
                    ? 'bg-[#0052CC] text-white'
                    : 'bg-[#0E1738] text-[#60A5FA] hover:bg-[#121E46]'
                }`}
                title="Configurar a Base da Empresa e Endereço Final de Retorno da Rota"
              >
                <Building className="h-3.5 w-3.5 text-[#FF6B35]" />
                <span className="hidden lg:inline">Base &amp; Retorno:</span>
                <span className="max-w-[110px] truncate text-white">
                  {baseAddresses.find((b) => b.id === selectedBaseId)?.name || 'Base Central'}
                </span>
                <Edit3 className="h-3 w-3 text-slate-400" />
              </Button>

              <Button
                onClick={() => setIsCreateCustomerModalOpen(true)}
                className="h-10 min-h-[44px] gap-1.5 bg-[#0A1128] hover:bg-[#121E46] text-[#22C55E] border border-[#22C55E]/40 font-bold text-xs rounded-input shadow-sm transition"
              >
                <UserPlus className="h-4 w-4 text-[#22C55E]" />
                <span>+ Cliente</span>
              </Button>

              <Button
                onClick={() => setIsCreateCourierModalOpen(true)}
                className="h-10 min-h-[44px] gap-1.5 bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs shadow-brand rounded-input transition"
              >
                <Truck className="h-4 w-4 text-[#FF6B35]" />
                <span>+ Entregador</span>
              </Button>

              <Button
                onClick={() => setIsOptimizerModalOpen(true)}
                className="h-10 min-h-[44px] gap-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-bold text-xs shadow-md shadow-indigo-500/20 rounded-input"
              >
                <Sparkles className="h-4 w-4 text-[#FBBF24]" />
                <span>Otimizar Rota</span>
              </Button>

              <Button
                onClick={() => setIsCreateModalOpen(true)}
                className="h-10 min-h-[44px] gap-2 bg-[#FF6B35] hover:bg-[#E5531E] text-white font-black text-xs shadow-brand rounded-input transition duration-100"
              >
                <Plus className="h-4 w-4" />
                <span>Nova Entrega / Venda</span>
              </Button>
            </div>
          </div>

          {/* Quick Actions Ribbon (LOGHYPE Visual: Dark Navy #0A1128, Fita Verde→Amarelo→Laranja→Vermelho, Mínimo 44px mobile touch) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 font-heading flex items-center gap-2">
                <Sparkles className="h-3.5 w-3.5 text-[#FF6B35]" />
                Ações Rápidas do Lojista
              </span>
              <span className="text-[11px] text-slate-500 hidden sm:inline">
                Acesso direto aos fluxos centrais da sua operação
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
              {/* Card 1: Nova Entrega / Venda */}
              <button
                type="button"
                onClick={() => setIsCreateModalOpen(true)}
                className="group relative overflow-hidden text-left p-4 rounded-2xl bg-[#0A1128] border border-[#1E2B58] hover:border-[#FF6B35]/60 hover:bg-[#0E1738] transition-all duration-200 shadow-brand-dark min-h-[80px] flex items-center gap-3.5 focus:outline-none focus:ring-2 focus:ring-[#FF6B35]"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#FF6B35] to-[#E74C3C]" />
                <div className="h-12 w-12 rounded-xl bg-[#FF6B35]/15 border border-[#FF6B35]/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Package className="h-6 w-6 text-[#FF6B35]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-heading font-black text-sm text-white group-hover:text-[#FF6B35] transition-colors">
                      Nova Entrega / Venda
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#FF6B35] group-hover:translate-x-0.5 transition-all shrink-0 ml-auto" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                    Registrar pedido, buscar cliente e calcular rota inteligente
                  </p>
                </div>
              </button>

              {/* Card 2: Cadastrar Cliente */}
              <button
                type="button"
                onClick={() => setIsCreateCustomerModalOpen(true)}
                className="group relative overflow-hidden text-left p-4 rounded-2xl bg-[#0A1128] border border-[#1E2B58] hover:border-[#22C55E]/60 hover:bg-[#0E1738] transition-all duration-200 shadow-brand-dark min-h-[80px] flex items-center gap-3.5 focus:outline-none focus:ring-2 focus:ring-[#22C55E]"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-[#22C55E]" />
                <div className="h-12 w-12 rounded-xl bg-[#22C55E]/15 border border-[#22C55E]/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <UserPlus className="h-6 w-6 text-[#22C55E]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-heading font-black text-sm text-white group-hover:text-[#22C55E] transition-colors">
                      Cadastrar Cliente
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#22C55E] group-hover:translate-x-0.5 transition-all shrink-0 ml-auto" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                    Até 3 telefones, busca CEP e deduplicação automática
                  </p>
                </div>
              </button>

              {/* Card 3: Cadastrar Entregador */}
              <button
                type="button"
                onClick={() => setIsCreateCourierModalOpen(true)}
                className="group relative overflow-hidden text-left p-4 rounded-2xl bg-[#0A1128] border border-[#1E2B58] hover:border-[#60A5FA]/60 hover:bg-[#0E1738] transition-all duration-200 shadow-brand-dark min-h-[80px] flex items-center gap-3.5 focus:outline-none focus:ring-2 focus:ring-[#0052CC]"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#0052CC] to-[#60A5FA]" />
                <div className="h-12 w-12 rounded-xl bg-[#0052CC]/20 border border-[#0052CC]/40 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Truck className="h-6 w-6 text-[#60A5FA]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-heading font-black text-sm text-white group-hover:text-[#60A5FA] transition-colors">
                      Cadastrar Entregador
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#60A5FA] group-hover:translate-x-0.5 transition-all shrink-0 ml-auto" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                    Moto, Carro ou Caminhão, placa e acesso ao App
                  </p>
                </div>
              </button>

              {/* Card 4: Otimizar / Iniciar Rota */}
              <button
                type="button"
                onClick={() => setIsOptimizerModalOpen(true)}
                className="group relative overflow-hidden text-left p-4 rounded-2xl bg-[#0A1128] border border-[#1E2B58] hover:border-[#FBBF24]/60 hover:bg-[#0E1738] transition-all duration-200 shadow-brand-dark min-h-[80px] flex items-center gap-3.5 focus:outline-none focus:ring-2 focus:ring-[#FBBF24]"
              >
                <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-[#22C55E] via-[#FBBF24] to-[#FF6B35]" />
                <div className="h-12 w-12 rounded-xl bg-[#FBBF24]/15 border border-[#FBBF24]/30 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                  <Sparkles className="h-6 w-6 text-[#FBBF24]" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="font-heading font-black text-sm text-white group-hover:text-[#FBBF24] transition-colors">
                      Otimizar / Iniciar Rota
                    </span>
                    <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-[#FBBF24] group-hover:translate-x-0.5 transition-all shrink-0 ml-auto" />
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 line-clamp-1">
                    Divisão por múltiplos entregadores e despacho de frotas
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Navigation Tabs between Overview, Control Tower and Reports */}
          <div className="flex border-b border-[#1E2B58] gap-2">
            <button
              onClick={() => setMainViewTab('overview')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                mainViewTab === 'overview'
                  ? 'border-[#60A5FA] text-[#60A5FA] bg-[#0E1738]/50 rounded-t-lg'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Painel Geral &amp; Pedidos
            </button>
            <button
              onClick={() => setMainViewTab('control-tower')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                mainViewTab === 'control-tower'
                  ? 'border-[#60A5FA] text-[#60A5FA] bg-[#0E1738]/50 rounded-t-lg'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Torre de Controle
              <span className="h-2 w-2 rounded-full bg-[#22C55E] animate-ping inline-block ml-0.5" />
            </button>
            <button
              onClick={() => setMainViewTab('reports')}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold border-b-2 transition ${
                mainViewTab === 'reports'
                  ? 'border-[#60A5FA] text-[#60A5FA] bg-[#0E1738]/50 rounded-t-lg'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              Relatórios Operacionais
            </button>
          </div>

          {/* REQUISITO 5: PAINEL EDITÁVEL DE BASE E ENDEREÇO FINAL AO LADO DE DESPACHO */}
          {isBaseConfigOpen && (
            <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-4 shadow-brand-dark space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#1E2B58] pb-2">
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-[#FF6B35]" />
                  <h3 className="text-xs font-bold font-heading uppercase text-white">
                    Definição de Base de Saída &amp; Ponto de Finalização (Ida e Volta)
                  </h3>
                </div>
                <span className="text-[11px] text-slate-400">
                  Defina onde os entregadores retiram as entregas e onde finalizam para cálculo
                  exato de combustível.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                {/* Seleção de Base */}
                <div className="space-y-1.5 p-3 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
                  <label className="font-bold text-slate-300 block">
                    🏢 Base da Empresa / Loja de Saída:
                  </label>
                  <Select value={selectedBaseId} onValueChange={setSelectedBaseId}>
                    <SelectTrigger className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                      <SelectValue placeholder="Selecione a base de saída..." />
                    </SelectTrigger>
                    <SelectContent>
                      {baseAddresses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.is_default ? '★ (Padrão)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-400">
                    {baseAddresses.find((b) => b.id === selectedBaseId)?.address ||
                      'Endereço da base selecionada'}
                  </p>
                </div>

                {/* Seleção de Endereço Final */}
                <div className="space-y-1.5 p-3 rounded-lg bg-[#0A1128] border border-[#1E2B58]">
                  <label className="font-bold text-slate-300 block">
                    🔄 Endereço de Finalização da Rota (Retorno):
                  </label>
                  <Select value={selectedEndAddressId} onValueChange={setSelectedEndAddressId}>
                    <SelectTrigger className="h-9 text-xs bg-[#070D1E] border-[#1E2B58] text-white">
                      <SelectValue placeholder="Selecione o ponto de retorno..." />
                    </SelectTrigger>
                    <SelectContent>
                      {baseAddresses.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name} {b.id === selectedBaseId ? '(Mesma Base de Saída)' : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[11px] text-slate-400">
                    {baseAddresses.find((b) => b.id === selectedEndAddressId)?.address ||
                      'Endereço de retorno'}
                  </p>
                </div>
              </div>

              {/* Cadastro Rápido de Novo Local */}
              <div className="p-3 rounded-lg bg-[#070D1E] border border-[#1E2B58] space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[11px] text-[#60A5FA] uppercase">
                    + Cadastrar Outra Empresa, Loja ou Ponto de Apoio
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    placeholder="Nome da Base / Galpão / Loja"
                    value={newBaseName}
                    onChange={(e) => setNewBaseName(e.target.value)}
                    className="h-8 text-xs bg-[#0A1128] border-[#1E2B58] text-white placeholder:text-slate-500"
                  />
                  <Input
                    placeholder="Endereço completo (Rua, Número, Bairro, Cidade)"
                    value={newBaseAddress}
                    onChange={(e) => setNewBaseAddress(e.target.value)}
                    className="h-8 text-xs sm:col-span-2 bg-[#0A1128] border-[#1E2B58] text-white placeholder:text-slate-500"
                  />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-3 text-slate-300">
                    <label className="text-[11px] flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="sellerBaseType"
                        checked={newBaseType === 'base'}
                        onChange={() => setNewBaseType('base')}
                      />
                      Base Principal / Loja
                    </label>
                    <label className="text-[11px] flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="sellerBaseType"
                        checked={newBaseType === 'end_point'}
                        onChange={() => setNewBaseType('end_point')}
                      />
                      Ponto de Finalização
                    </label>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={isSavingBase}
                    onClick={async () => {
                      if (!newBaseName.trim() || !newBaseAddress.trim()) {
                        toast.error('Informe o nome e endereço da base.')
                        return
                      }
                      setIsSavingBase(true)
                      try {
                        const created = await deliveryService.createBaseAddress({
                          name: newBaseName.trim(),
                          address: newBaseAddress.trim(),
                          type: newBaseType,
                          lat: -22.906847 + (Math.random() - 0.5) * 0.04,
                          lng: -43.172896 + (Math.random() - 0.5) * 0.04,
                          is_default: baseAddresses.length === 0,
                        })
                        setBaseAddresses((prev) => [...prev, created])
                        if (newBaseType === 'base') setSelectedBaseId(created.id)
                        else setSelectedEndAddressId(created.id)
                        setNewBaseName('')
                        setNewBaseAddress('')
                        toast.success('Novo local cadastrado com sucesso!')
                      } catch {
                        toast.error('Erro ao cadastrar local.')
                      } finally {
                        setIsSavingBase(false)
                      }
                    }}
                    className="h-7 text-xs bg-[#0052CC] hover:bg-[#003E99] text-white font-bold"
                  >
                    {isSavingBase ? 'Salvando...' : 'Cadastrar Local'}
                  </Button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 1: TORRE DE CONTROLE (MÓDULO 1) */}
          {mainViewTab === 'control-tower' && (
            <ControlTower
              orders={orders}
              couriers={couriers}
              onRefresh={loadData}
              userRole="seller"
            />
          )}

          {/* TAB 2: RELATÓRIOS (MÓDULO 4) */}
          {mainViewTab === 'reports' && <ReportsSection orders={orders} couriers={couriers} />}

          {/* TAB 3: VISÃO GERAL & GESTÃO DE PEDIDOS (PRESERVANDO FLUXO ORIGINAL) */}
          {mainViewTab === 'overview' && (
            <div className="space-y-6">
              {/* KPI Summary Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Em Trânsito
                      </p>
                      <p className="text-2xl font-black text-[#FBBF24] mt-1">{inTransitCount}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FBBF24]/15 text-[#FBBF24] border border-[#FBBF24]/30">
                      <Truck className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Pendentes
                      </p>
                      <p className="text-2xl font-black text-[#60A5FA] mt-1">{pendingCount}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#60A5FA]/15 text-[#60A5FA] border border-[#60A5FA]/30">
                      <Clock className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Concluídas
                      </p>
                      <p className="text-2xl font-black text-[#22C55E] mt-1">{deliveredCount}</p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#22C55E]/15 text-[#22C55E] border border-[#22C55E]/30">
                      <CheckCircle className="h-5 w-5" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark">
                  <CardContent className="p-4 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                        Volume Total
                      </p>
                      <p className="text-2xl font-black text-[#FF6B35] mt-1">
                        R$ {totalRevenue.toFixed(2)}
                      </p>
                    </div>
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FF6B35]/15 text-[#FF6B35] border border-[#FF6B35]/30">
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
              <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 sm:p-6 shadow-brand-dark space-y-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Package className="h-5 w-5 text-[#60A5FA]" />
                    <h3 className="text-base font-bold text-white font-heading">
                      Gerenciador de Pedidos ({filteredOrders.length})
                    </h3>
                  </div>

                  {/* Status Filters & Search */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-wrap">
                    {/* Botão de Liberação em Lote se houver entregas atribuídas não liberadas */}
                    {orders.some(
                      (o) =>
                        o.courier_id &&
                        !o.route_released &&
                        o.status !== 'delivered' &&
                        o.status !== 'cancelled',
                    ) && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={async () => {
                          const unreleasedOrders = orders.filter(
                            (o) =>
                              o.courier_id &&
                              !o.route_released &&
                              o.status !== 'delivered' &&
                              o.status !== 'cancelled',
                          )
                          if (unreleasedOrders.length === 0) return
                          try {
                            const ids = unreleasedOrders.map((o) => o.id)
                            await deliveryService.releaseRouteForOrders(ids)
                            toast.success(
                              `🚀 Todas as ${ids.length} entregas atribuídas foram liberadas para os entregadores!`,
                            )
                            loadData()
                          } catch (err) {
                            console.error('Error releasing all:', err)
                            toast.error('Erro ao liberar todas as rotas.')
                          }
                        }}
                        className="h-9 px-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm flex items-center gap-1.5"
                        title="Liberar todas as rotas atribuídas para os respectivos entregadores"
                      >
                        <Sparkles className="h-3.5 w-3.5 text-amber-300" />
                        Liberar Todas as Rotas (
                        {
                          orders.filter(
                            (o) =>
                              o.courier_id &&
                              !o.route_released &&
                              o.status !== 'delivered' &&
                              o.status !== 'cancelled',
                          ).length
                        }
                        )
                      </Button>
                    )}
                    <Tabs
                      value={selectedStatus}
                      onValueChange={setSelectedStatus}
                      className="w-full sm:w-auto"
                    >
                      <TabsList className="grid grid-cols-4 h-9 bg-[#0A1128] border border-[#1E2B58]">
                        <TabsTrigger
                          value="all"
                          className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white"
                        >
                          Todos ({orders.length})
                        </TabsTrigger>
                        <TabsTrigger
                          value="pending"
                          className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white"
                        >
                          Pendentes ({pendingCount})
                        </TabsTrigger>
                        <TabsTrigger
                          value="in_transit"
                          className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white"
                        >
                          Em Trânsito ({inTransitCount})
                        </TabsTrigger>
                        <TabsTrigger
                          value="delivered"
                          className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white"
                        >
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
                        className="h-9 pl-8 text-xs bg-[#0A1128] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg focus:border-[#60A5FA]"
                      />
                    </div>
                  </div>
                </div>

                {/* Orders Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse font-sans">
                    <thead>
                      <tr className="border-b border-[#1E2B58] bg-[#0A1128]/80 text-slate-300 font-heading uppercase tracking-wider">
                        <th className="py-3 px-3 font-bold">Código</th>
                        <th className="py-3 px-3 font-bold">Cliente & Destino</th>
                        <th className="py-3 px-3 font-bold">Entregador / Fila</th>
                        <th className="py-3 px-3 font-bold">Status / Motivo</th>
                        <th className="py-3 px-3 font-bold">Liberação da Rota</th>
                        <th className="py-3 px-3 font-bold">Prioridade</th>
                        <th className="py-3 px-3 font-bold text-right">Valor Total</th>
                        <th className="py-3 px-3 font-bold text-right">Ações da Venda</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOrders.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400">
                            Nenhum pedido encontrado para o filtro aplicado.
                          </td>
                        </tr>
                      ) : (
                        filteredOrders.map((order) => {
                          const customer = customers.find((c) => c.id === order.customer_id)
                          const courier = couriers.find((c) => c.id === order.courier_id)

                          const isRouteStarted = Boolean(
                            order.route_started || order.route_started_at,
                          )

                          const statusBadge = {
                            pending: (
                              <Badge
                                variant="outline"
                                className="bg-blue-50 text-[#0052CC] border-[#0052CC]/30 font-bold"
                              >
                                Pendente
                              </Badge>
                            ),
                            in_transit: isRouteStarted ? (
                              <Badge
                                variant="outline"
                                className="bg-orange-50 text-[#FF6B35] border-[#FF6B35]/30 font-bold animate-pulse"
                              >
                                🛵 Em Trânsito
                              </Badge>
                            ) : (
                              <Badge
                                variant="outline"
                                className="bg-slate-800/80 text-slate-300 border-slate-600/50 font-bold"
                              >
                                ⏸️ Não iniciada
                              </Badge>
                            ),
                            delivered: (
                              <Badge
                                variant="outline"
                                className="bg-emerald-50 text-[#00AA44] border-[#00AA44]/30 font-bold"
                              >
                                ✓ Entregue
                              </Badge>
                            ),
                            cancelled: (
                              <Badge
                                variant="outline"
                                className="bg-slate-100 text-slate-600 border-slate-200"
                              >
                                Cancelado
                              </Badge>
                            ),
                          }[order.status]

                          const priorityBadge = {
                            urgent: <span className="text-[#E74C3C] font-bold">🔴 Urgente</span>,
                            high: <span className="text-[#FF6B35] font-medium">🟡 Alta</span>,
                            normal: <span className="text-[#00AA44]">🟢 Normal</span>,
                          }[order.priority || 'normal']

                          return (
                            <tr
                              key={order.id}
                              className="hover:bg-[#121E46]/60 transition group cursor-pointer border-b border-[#1E2B58]/60 text-slate-200"
                              onClick={() => setSelectedMarkerId(`order-${order.id}`)}
                            >
                              <td className="py-3 px-3 font-mono font-bold text-[#60A5FA]">
                                {order.tracking_code}
                              </td>
                              <td className="py-3 px-3">
                                <p className="font-semibold text-white">
                                  {customer?.name || 'Cliente'}
                                </p>
                                <p className="text-[11px] text-slate-400 truncate max-w-xs">
                                  {customer?.address || 'Endereço não cadastrado'}
                                </p>
                              </td>
                              <td className="py-3 px-3 text-slate-300">
                                {courier ? (
                                  <div className="flex items-center gap-1.5">
                                    <span className="h-2 w-2 rounded-full bg-[#FF6B35] shrink-0"></span>
                                    <span className="font-semibold text-white">{courier.name}</span>
                                    {order.sequence && (
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 bg-[#0052CC]/30 text-[#60A5FA] border-[#60A5FA]/30 font-bold"
                                      >
                                        #{order.sequence}
                                      </Badge>
                                    )}
                                  </div>
                                ) : (
                                  <span className="text-slate-500 italic">Não atribuído</span>
                                )}
                              </td>
                              <td className="py-3 px-3">
                                <div>
                                  {statusBadge}
                                  {order.completion_reason &&
                                    order.completion_reason !== 'delivered' && (
                                      <span className="block text-[10px] text-[#FF6B35] font-medium mt-0.5">
                                        {order.completion_reason === 'address_error'
                                          ? '⚠️ Erro de Endereço'
                                          : '⚠️ Cliente Ausente'}
                                      </span>
                                    )}
                                </div>
                              </td>
                              <td className="py-3 px-3">
                                {order.status === 'delivered' ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-emerald-950/40 text-emerald-400 border-emerald-500/30 text-[10px] font-bold"
                                  >
                                    ✓ Concluída
                                  </Badge>
                                ) : order.route_released ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-emerald-950/40 text-[#22C55E] border-[#22C55E]/40 text-[10px] font-bold"
                                    title={`Rota liberada em ${order.route_released_at ? new Date(order.route_released_at).toLocaleTimeString() : 'sim'}`}
                                  >
                                    ✓ Rota Liberada
                                  </Badge>
                                ) : order.courier_id ? (
                                  <div className="flex items-center gap-1.5">
                                    <Badge
                                      variant="outline"
                                      className="bg-amber-950/40 text-[#FBBF24] border-[#FBBF24]/40 text-[10px] font-bold"
                                    >
                                      ⏸ Rota Não Liberada
                                    </Badge>
                                    <Button
                                      size="sm"
                                      type="button"
                                      disabled={releasingOrderId === order.id}
                                      onClick={(e) =>
                                        handleReleaseOrderRoute(order.id, order.courier_id, e)
                                      }
                                      className="h-6 px-1.5 text-[10px] bg-emerald-600 hover:bg-emerald-700 text-white font-bold"
                                      title="Liberar imediatamente para o entregador visualizar no app"
                                    >
                                      {releasingOrderId === order.id ? '...' : 'Liberar'}
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-[11px] text-slate-500 italic">
                                    Sem entregador
                                  </span>
                                )}
                              </td>
                              <td className="py-3 px-3 text-xs">{priorityBadge}</td>
                              <td className="py-3 px-3 text-right font-bold text-white font-mono">
                                R$ {Number(order.total_price || 0).toFixed(2)}
                              </td>
                              <td
                                className="py-3 px-3 text-right"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <div className="flex items-center justify-end gap-1.5 flex-wrap">
                                  {/* Copiar Link de Rastreio Rápido para o Vendedor */}
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) =>
                                      handleCopyTrackingLink(order.tracking_code, order.id, e)
                                    }
                                    className={`h-7 px-2 text-[11px] gap-1 transition-all rounded-input ${
                                      copiedOrderId === order.id
                                        ? 'bg-emerald-50 border-emerald-300 text-[#00AA44] font-bold'
                                        : 'text-[#0052CC] border-[#0052CC]/30 hover:bg-blue-50'
                                    }`}
                                    title="Copiar link de rastreamento para enviar ao cliente"
                                  >
                                    {copiedOrderId === order.id ? (
                                      <>
                                        <CheckCircle2 className="h-3 w-3 text-[#00AA44]" />
                                        <span>Copiado!</span>
                                      </>
                                    ) : (
                                      <>
                                        <ExternalLink className="h-3 w-3" />
                                        <span>Copiar Link</span>
                                      </>
                                    )}
                                  </Button>

                                  {/* Link Rastreio Público */}
                                  <Link
                                    to={`/track/${order.tracking_code}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-slate-500 hover:text-[#0052CC] text-xs px-1.5 py-1 rounded-input"
                                    title="Abrir página de rastreio em nova aba"
                                  >
                                    <span>Abrir</span>
                                  </Link>

                                  {/* Botão Rápido: Liberar Rota na linha da ação */}
                                  {order.courier_id &&
                                    !order.route_released &&
                                    order.status !== 'delivered' &&
                                    order.status !== 'cancelled' && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        type="button"
                                        disabled={releasingOrderId === order.id}
                                        onClick={(e) =>
                                          handleReleaseOrderRoute(order.id, order.courier_id, e)
                                        }
                                        className="h-7 px-2 text-[11px] bg-emerald-950/60 hover:bg-emerald-800 text-emerald-300 border-emerald-500/50 gap-1 rounded-input font-bold"
                                        title="Liberar rota desta entrega para o entregador visualizar"
                                      >
                                        <Sparkles className="h-3 w-3 text-emerald-400" />
                                        {releasingOrderId === order.id
                                          ? 'Liberando...'
                                          : 'Liberar Rota'}
                                      </Button>
                                    )}

                                  {/* Adicionar a Rota Já Iniciada */}
                                  {order.status === 'pending' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={() => {
                                        setSelectedOrderForAddToRoute(order)
                                        setIsAddToRouteModalOpen(true)
                                      }}
                                      className="h-7 px-2 text-[11px] text-[#0052CC] border-[#0052CC]/30 hover:bg-blue-50 gap-1 rounded-input font-medium"
                                      title="Adicionar à rota de um entregador em andamento"
                                    >
                                      <UserPlus className="h-3 w-3 text-[#FF6B35]" />+ Rota
                                    </Button>
                                  )}

                                  {/* Retirar da Rota */}
                                  {order.status === 'in_transit' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      onClick={(e) => handleRemoveFromRoute(order.id, e)}
                                      className="h-7 px-2 text-[11px] text-[#FF6B35] border-[#FF6B35]/30 hover:bg-orange-50 gap-1 rounded-input font-medium"
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
                                      className="h-7 px-2 text-[11px] text-[#E74C3C] border-[#E74C3C]/30 hover:bg-red-50 gap-1 rounded-input font-medium"
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
            </div>
          )}
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

      {/* Modal para Cadastro Rápido de Entregador pelo Vendedor */}
      <CreateCourierModal
        open={isCreateCourierModalOpen}
        onOpenChange={setIsCreateCourierModalOpen}
        onCourierCreated={loadData}
      />

      {/* Modal para Cadastro Direto de Cliente pelo Vendedor */}
      <CreateCustomerModal
        open={isCreateCustomerModalOpen}
        onOpenChange={setIsCreateCustomerModalOpen}
        onCustomerCreated={() => {
          loadData()
        }}
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
        <DialogContent className="max-w-md bg-white text-[#1a1a1a] border-slate-200 rounded-modal">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-bold text-[#1a1a1a] font-heading">
              <UserPlus className="h-5 w-5 text-[#0052CC]" />
              Adicionar Entrega à Rota em Andamento
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 font-sans">
              A nova entrega entrará automaticamente no <strong>FIM da fila</strong> do entregador
              selecionado e ele receberá um alerta sonoro e notificação push instantânea.
            </DialogDescription>
          </DialogHeader>

          {selectedOrderForAddToRoute && (
            <div className="space-y-3.5 py-2">
              <div className="p-3 rounded-card bg-[#F5F5F5] border border-slate-200 text-xs space-y-1">
                <p className="font-bold text-[#1a1a1a]">
                  Pedido: {selectedOrderForAddToRoute.tracking_code}
                </p>
                <p className="text-slate-600">
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
              className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs rounded-input shadow-brand"
            >
              {isAddingToRoute ? 'Enviando...' : 'Despachar para o Fim da Fila'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
