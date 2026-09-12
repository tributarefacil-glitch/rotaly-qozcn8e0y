import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
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
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import {
  Truck,
  Phone,
  MessageCircle,
  Clock,
  MapPin,
  RefreshCw,
  Search,
  CheckCircle2,
  AlertTriangle,
  AlertCircle,
  Package,
  Car,
  Bike,
  Activity,
  UserCheck,
  ChevronRight,
  Navigation,
  ExternalLink,
  Copy,
  Check,
  Sparkles,
  Maximize2,
  Layers,
  Map as MapIcon,
  Columns3,
  Calendar,
  Compass,
  ArrowRight,
  ShieldCheck,
  Route,
  AlertOctagon,
  Star,
  Share2,
} from 'lucide-react'
import { OrderRecord, UserRecord, LocationRecord, ReviewRecord } from '@/types/delivery'
import {
  LiveMap,
  type MapMarkerItem,
  getVehicleEmoji,
  getVehicleLabel,
  makeCourierSvgIcon,
  makeCustomerSvgIcon,
} from '@/components/LiveMap'
import pb from '@/lib/pocketbase/client'
import { deliveryService } from '@/services/deliveryService'
import {
  loadGoogleMapsScript,
  isGoogleMapsAuthError,
  onGoogleMapsAuthError,
  reverseGeocodeCoordinates,
} from '@/lib/googleMaps'
import { useToast } from '@/hooks/use-toast'
import {
  fetchStreetRoute,
  findNearestPointOnRoute,
  distanceMeters,
  type LatLngPoint,
  type OsrmRouteResult,
} from '@/services/osrmRoutingService'
import { playRouteAlertSound, playOffRouteWarningSound } from '@/lib/notificationSound'
import { DEVIATION_THRESHOLD_METERS, UNEXPECTED_STOP_THRESHOLD_METERS } from '@/lib/geo'
import { useAuth } from '@/contexts/AuthContext'

interface ControlTowerProps {
  orders?: OrderRecord[]
  couriers?: UserRecord[]
  onRefresh?: () => void
  userRole?: 'seller' | 'admin'
}

type KanbanColumnKey = 'pending' | 'in_transit' | 'delivered' | 'issues'

interface KanbanColumnConfig {
  key: KanbanColumnKey
  title: string
  subtitle: string
  badgeBg: string
  badgeText: string
  borderColor: string
  headerBg: string
  columnBg: string
  indicatorColor: string
}

const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    key: 'pending',
    title: 'Aguardando Início',
    subtitle: 'Atribuídas / Fila do entregador',
    badgeBg: 'bg-slate-700/60',
    badgeText: 'text-slate-200',
    borderColor: 'border-slate-700/80',
    headerBg: 'bg-slate-900/90 border-b border-slate-800',
    columnBg: 'bg-[#0c142e]/70',
    indicatorColor: '#94A3B8',
  },
  {
    key: 'in_transit',
    title: 'Em Trânsito',
    subtitle: 'Rota iniciada / A caminho',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-[#60A5FA]',
    borderColor: 'border-blue-500/40',
    headerBg: 'bg-[#0f214d]/90 border-b border-blue-900/60',
    columnBg: 'bg-[#0d1b3e]/70',
    indicatorColor: '#3B82F6',
  },
  {
    key: 'delivered',
    title: 'Entregue',
    subtitle: 'Concluídas com sucesso',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-[#34D399]',
    borderColor: 'border-emerald-500/40',
    headerBg: 'bg-[#0e2a27]/90 border-b border-emerald-900/60',
    columnBg: 'bg-[#0b2120]/60',
    indicatorColor: '#10B981',
  },
  {
    key: 'issues',
    title: 'Exceções & Problemas',
    subtitle: 'Ausente / Endereço / Desvio',
    badgeBg: 'bg-rose-500/20',
    badgeText: 'text-[#F87171]',
    borderColor: 'border-rose-500/40',
    headerBg: 'bg-[#2a1322]/90 border-b border-rose-900/60',
    columnBg: 'bg-[#20101b]/60',
    indicatorColor: '#EF4444',
  },
]

export const ControlTower: React.FC<ControlTowerProps> = ({
  orders: initialOrders,
  couriers: initialCouriers,
  onRefresh,
  userRole: propUserRole = 'seller',
}) => {
  const { toast } = useToast()
  const { user } = useAuth()
  const userRole = user?.role || propUserRole
  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders || [])
  const [couriers, setCouriers] = useState<UserRecord[]>(initialCouriers || [])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // Filters & views
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [courierFilter, setCourierFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [activeTab, setActiveTab] = useState<'kanban' | 'map' | 'split'>('split')

  // Selected for Modal/Drawer details
  const [selectedCourier, setSelectedCourier] = useState<UserRecord | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false)
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [isRemovingOrderFromRoute, setIsRemovingOrderFromRoute] = useState(false)
  const [orderToRemoveFromRoute, setOrderToRemoveFromRoute] = useState<OrderRecord | null>(null)

  // Global in-transit orders (para mapear todos os entregadores em rota do sistema)
  const [globalInTransitOrders, setGlobalInTransitOrders] = useState<OrderRecord[]>([])

  // Google Maps state
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [mapsError, setMapsError] = useState(false)
  const [mapInstance, setMapInstance] = useState<any>(null)
  const [markersRef, setMarkersRef] = useState<any[]>([])
  const courierMarkersMapRef = useRef<Map<string, any>>(new Map())
  const courierAnimFramesRef = useRef<Map<string, number>>(new Map())
  const [polylineRef, setPolylineRef] = useState<any>(null)
  const googlePolylinesRef = useRef<any[]>([])
  const mapContainerRef = useRef<HTMLDivElement | null>(null)

  // Modo de exibição das abas do mapa: 'in_transit' (Em Rota) ou 'delivered' (Entregues)
  const [mapDisplayMode, setMapDisplayMode] = useState<'in_transit' | 'delivered'>('in_transit')

  // Set de controle para não disparar alerta sonoro/toast repetidamente para o mesmo evento de exceção
  const notifiedEventsRef = useRef<Set<string>>(new Set())
  // Cache de rotas ativas viárias calculadas para a Torre
  const [activeRoutesData, setActiveRoutesData] = useState<
    Array<{
      courierId: string
      orderId: string
      points: LatLngPoint[]
      forwardPoints?: LatLngPoint[]
      returnPoints?: LatLngPoint[]
      courierPos: LatLngPoint
      custPos: LatLngPoint
      basePos?: LatLngPoint
      returnBasePos?: LatLngPoint
      isDeviated: boolean
      deviationMeters: number
      nearestPointOnRoute: LatLngPoint
      isUnexpectedStop: boolean
      etaMinutes: number
      etaNextDeliveryTime?: string
      etaReturnBaseMinutes?: number
      etaReturnBaseTime?: string
      order: OrderRecord
      courier: UserRecord
    }>
  >([])
  // Banner de alerta de entrega em tempo real
  const [latestDeliveredNotice, setLatestDeliveredNotice] = useState<{
    orderId: string
    trackingCode: string
    customerName: string
    courierName: string
    timestamp: Date
  } | null>(null)

  // Estado para dispensar banners temporários no mapa
  const [isDeviationBannerDismissed, setIsDeviationBannerDismissed] = useState(false)
  const [isStopBannerDismissed, setIsStopBannerDismissed] = useState(false)
  const [dismissedGpsAlertIds, setDismissedGpsAlertIds] = useState<string[]>([])
  const [isLegendExpanded, setIsLegendExpanded] = useState(false)

  // Retry maps loading
  const handleRetryMaps = () => {
    setMapsError(false)
    loadGoogleMapsScript().then((loaded) => {
      if (loaded && !isGoogleMapsAuthError()) {
        setMapsLoaded(true)
        setMapsError(false)
      } else {
        setMapsError(true)
        setMapsLoaded(false)
      }
    })
  }

  // Cache de rotas ativas para evitar refetch viário (OSRM/Google) sem necessidade:
  // courierId -> { courierPos, stopIdsHash, result }
  const activeRoutesCacheRef = useRef<
    Map<
      string,
      {
        courierPos: LatLngPoint
        stopIdsHash: string
        result: any
      }
    >
  >(new Map())

  // Drawer mini-map state
  const drawerMiniMapRef = useRef<HTMLDivElement | null>(null)
  const [drawerMapInstance, setDrawerMapInstance] = useState<any>(null)
  const [drawerMapFailed, setDrawerMapFailed] = useState(false)
  const [drawerTilesLoaded, setDrawerTilesLoaded] = useState(false)
  const [drawerReview, setDrawerReview] = useState<ReviewRecord | null>(null)
  const [isLoadingDrawerReview, setIsLoadingDrawerReview] = useState(false)
  const [drawerDeviationInfo, setDrawerDeviationInfo] = useState<{
    isDeviated: boolean
    meters: number
  } | null>(null)
  const [drawerUnexpectedStop, setDrawerUnexpectedStop] = useState(false)
  const drawerMarkersRef = useRef<any[]>([])
  const drawerPolylineRef = useRef<any>(null)
  const drawerDeviationPolylineRef = useRef<any>(null)
  const drawerBoundsRef = useRef<any>(null)
  const drawerCenterRef = useRef<{ lat: number; lng: number } | null>(null)

  // Geometria de rota real via OSRM e telemetria de desvio do pedido selecionado
  const [streetRoute, setStreetRoute] = useState<OsrmRouteResult | null>(null)
  const [isLoadingStreetRoute, setIsLoadingStreetRoute] = useState(false)
  const [recentDeviations, setRecentDeviations] = useState<any[]>([])

  // Remover cliente/pedido da rota em andamento (Realtime, recalcula paradas e ETA)
  const handleConfirmRemoveOrderFromRoute = async () => {
    if (!orderToRemoveFromRoute) return
    const orderId = orderToRemoveFromRoute.id
    const courierId = orderToRemoveFromRoute.courier_id
    const customerName = orderToRemoveFromRoute.expand?.customer_id?.name || 'Cliente'

    setIsRemovingOrderFromRoute(true)
    try {
      // 1. Atualizar o pedido para status "pending", desvinculando da rota ativa
      await deliveryService.updateOrder(orderId, {
        status: 'pending',
        courier_id: '',
        sequence: undefined,
        route_released: false,
        route_started: false,
        route_started_at: undefined,
      })

      // 2. Se houver entregador vinculado, reordenar a sequência das paradas restantes dele
      if (courierId) {
        try {
          const remainingOrders = orders
            .filter(
              (o) =>
                o.courier_id === courierId &&
                o.id !== orderId &&
                o.status !== 'delivered' &&
                o.status !== 'cancelled',
            )
            .sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999))

          for (let i = 0; i < remainingOrders.length; i++) {
            const nextSeq = i + 1
            if (remainingOrders[i].sequence !== nextSeq) {
              await deliveryService.updateOrder(remainingOrders[i].id, {
                sequence: nextSeq,
              })
            }
          }

          // Notificar o entregador via push/notificação em tempo real
          await deliveryService.createNotification({
            user_id: courierId,
            title: '⚠️ Rota Atualizada: Parada Removida',
            message: `A entrega para ${customerName} foi removida da sua rota pela central.`,
            type: 'order',
            read: false,
          })
        } catch (reorderErr) {
          console.warn('Erro ao reordenar sequência do entregador:', reorderErr)
        }
      }

      toast({
        title: '✓ Cliente removido da rota',
        description: `O pedido de ${customerName} foi retirado da rota e retornou para "Pendente".`,
      })

      // Fechar modal de confirmação e drawer se era esse pedido
      setOrderToRemoveFromRoute(null)
      setIsDrawerOpen(false)
      setSelectedOrder(null)

      // Atualizar dados locais imediatamente
      fetchData()
      if (onRefresh) onRefresh()
    } catch (err: unknown) {
      console.error('Erro ao remover pedido da rota:', err)
      const msg = err instanceof Error ? err.message : 'Falha ao remover cliente da rota.'
      toast({
        title: 'Erro ao remover cliente',
        description: msg,
        variant: 'destructive',
      })
    } finally {
      setIsRemovingOrderFromRoute(false)
    }
  }

  // Fetch initial/refreshed data
  const fetchData = async () => {
    try {
      const isSeller = user?.role === 'seller'
      const sellerOrdersFilter = isSeller && user?.id ? `seller_id = '${user.id}'` : ''

      // Separar em duas buscas:
      // 1. sellerOrders (com filtro seller_id quando logado como vendedor — para pins de clientes, kanban e drawer)
      // 2. globalInTransitOrders (todos os pedidos do sistema em rota ativa não finalizada: route_started=true && (route_finished=false || route_finished=null), sem seller_id)
      const globalTransitFilter = `route_started = true && (route_finished = false || route_finished = null)`

      const [
        fetchedOrders,
        fetchedGlobalTransitOrders,
        fetchedCouriers,
        fetchedLocations,
        fetchedDeviations,
      ] = await Promise.all([
        deliveryService.getOrders(
          sellerOrdersFilter,
          '-created',
          'customer_id,courier_id,seller_id',
        ),
        deliveryService.getOrders(
          globalTransitFilter,
          '-created',
          'customer_id,courier_id,seller_id',
        ),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
        deliveryService.getOffRouteEvents('', '-created', 'courier_id,order_id').catch(() => []),
      ])
      setOrders(fetchedOrders)
      setGlobalInTransitOrders(fetchedGlobalTransitOrders || [])
      setCouriers(fetchedCouriers)
      setLocations(fetchedLocations)
      setRecentDeviations(fetchedDeviations || [])
      setLastUpdated(new Date())
    } catch (err) {
      console.warn('Erro ao atualizar dados da Torre de Controle:', err)
    }
  }

  // Sincronização inicial e periódica:
  // Como as subscrições Realtime já cobrem 'locations', 'orders' e 'off_route_events' sem duplicar,
  // mantemos busca inicial e apenas atualização de dados estáticos/auxiliares.
  // NÃO chamamos onRefresh() do pai no timer periódico de 10s para evitar ciclo de renderização.
  useEffect(() => {
    fetchData()
    const interval = setInterval(() => {
      fetchData()
    }, 30000) // 30s de segurança apenas para sincronização de fundo, sem chamar onRefresh do pai
    return () => clearInterval(interval)
  }, [user?.id, user?.role])

  // Sync with incoming props com comparação estável por conteúdo (IDs + timestamps)
  const prevOrdersHashRef = useRef<string>('')
  useEffect(() => {
    if (!initialOrders) return
    const newHash = initialOrders
      .map((o) => `${o.id}-${o.status}-${o.updated || o.created}-${o.route_started}-${o.sequence}`)
      .join('|')
    if (newHash !== prevOrdersHashRef.current) {
      prevOrdersHashRef.current = newHash
      setOrders(initialOrders)
    }
  }, [initialOrders])

  const prevCouriersHashRef = useRef<string>('')
  useEffect(() => {
    if (!initialCouriers) return
    const newHash = initialCouriers
      .map((c) => `${c.id}-${c.status}-${c.updated || c.created}`)
      .join('|')
    if (newHash !== prevCouriersHashRef.current) {
      prevCouriersHashRef.current = newHash
      setCouriers(initialCouriers)
    }
  }, [initialCouriers])

  // Realtime PocketBase subscriptions: 'orders' and 'locations'
  useEffect(() => {
    let isSubscribed = true

    // Subscribe to locations (courier GPS movements)
    pb.collection('locations')
      .subscribe('*', (e) => {
        if (!isSubscribed) return
        if (e.action === 'create' || e.action === 'update') {
          const newLoc = e.record as unknown as LocationRecord
          setLocations((prev) => {
            const existingIndex = prev.findIndex((l) => l.user_id === newLoc.user_id)
            if (existingIndex >= 0) {
              const updated = [...prev]
              updated[existingIndex] = newLoc
              return updated
            }
            return [newLoc, ...prev]
          })
          setLastUpdated(new Date())
        }
      })
      .catch((err) => {
        console.warn('Torre de Controle: erro subscrição locations:', err)
      })

    // Subscribe to orders (live delivery status updates & delivery alert)
    pb.collection('orders')
      .subscribe('*', (e) => {
        if (!isSubscribed) return
        const rec = e.record as unknown as OrderRecord

        // Manter lista global de pedidos em trânsito sempre sincronizada (para todos os lojistas)
        if (e.action === 'delete') {
          setGlobalInTransitOrders((prev) => prev.filter((o) => o.id !== rec.id))
        } else {
          const isRecActiveRoute =
            rec.route_started === true &&
            (rec.route_finished === false ||
              rec.route_finished === null ||
              rec.route_finished === undefined)
          setGlobalInTransitOrders((prev) => {
            const exists = prev.some((o) => o.id === rec.id)
            if (isRecActiveRoute) {
              return exists
                ? prev.map((o) => (o.id === rec.id ? { ...o, ...rec } : o))
                : [rec, ...prev]
            } else {
              return prev.filter((o) => o.id !== rec.id)
            }
          })
        }

        // Filtro seller_id: eventos de pedidos locais da loja (para pins de pedidos, kanban e drawer)
        const isSeller = user?.role === 'seller'
        if (isSeller && user?.id && rec?.seller_id && rec.seller_id !== user.id) {
          return
        }

        if (e.action === 'create') {
          setOrders((prev) => [rec, ...prev])
          setLastUpdated(new Date())
        } else if (e.action === 'update') {
          setOrders((prev) => {
            const previousOrder = prev.find((o) => o.id === rec.id)
            // Se o status mudou para 'delivered' em tempo real -> AVISO DE ENTREGA
            if (rec.status === 'delivered' && previousOrder?.status !== 'delivered') {
              const custName =
                rec.expand?.customer_id?.name ||
                previousOrder?.expand?.customer_id?.name ||
                'Cliente'
              const courierName =
                rec.expand?.courier_id?.name ||
                previousOrder?.expand?.courier_id?.name ||
                'Entregador'

              // Som de sucesso e banner visível
              playRouteAlertSound()
              toast({
                title: '🎉 ENTREGA CONCLUÍDA EM TEMPO REAL!',
                description: `${rec.tracking_code} • ${custName} finalizado por ${courierName}`,
              })

              setLatestDeliveredNotice({
                orderId: rec.id,
                trackingCode: rec.tracking_code,
                customerName: custName,
                courierName,
                timestamp: new Date(),
              })
            }
            return prev.map((o) => (o.id === rec.id ? { ...o, ...rec } : o))
          })
          // If drawer is open on this order, refresh it
          setSelectedOrder((curr) => (curr && curr.id === rec.id ? { ...curr, ...rec } : curr))
          setLastUpdated(new Date())
        } else if (e.action === 'delete') {
          setOrders((prev) => prev.filter((o) => o.id !== rec.id))
          setLastUpdated(new Date())
        }
      })
      .catch((err) => {
        console.warn('Torre de Controle: erro subscrição orders:', err)
      })

    // Subscribe to off_route_events (live deviation events)
    pb.collection('off_route_events')
      .subscribe('*', (e) => {
        if (!isSubscribed) return
        if (e.action === 'create') {
          setRecentDeviations((prev) => [e.record, ...prev])
          setLastUpdated(new Date())
        } else if (e.action === 'update') {
          setRecentDeviations((prev) =>
            prev.map((item) => (item.id === e.record.id ? e.record : item)),
          )
        }
      })
      .catch((err) => {
        console.warn('Torre de Controle: erro subscrição off_route_events:', err)
      })

    return () => {
      isSubscribed = false
      pb.collection('locations')
        .unsubscribe('*')
        .catch(() => {})
      pb.collection('orders')
        .unsubscribe('*')
        .catch(() => {})
      pb.collection('off_route_events')
        .unsubscribe('*')
        .catch(() => {})
    }
  }, [user?.id, user?.role])

  // Load Google Maps Script
  useEffect(() => {
    const unsub = onGoogleMapsAuthError(() => {
      setMapsError(true)
      setMapsLoaded(false)
    })

    loadGoogleMapsScript().then((loaded) => {
      if (loaded && !isGoogleMapsAuthError()) {
        setMapsLoaded(true)
        setMapsError(false)
      } else {
        setMapsError(true)
        setMapsLoaded(false)
      }
    })

    return () => {
      unsub()
    }
  }, [])

  // Today's orders
  const todayStr = useMemo(() => new Date().toISOString().split('T')[0], [])
  const todayOrders = useMemo(() => {
    return orders.filter((o) => {
      const createdDate = o.created ? o.created.split('T')[0] : ''
      return (
        createdDate === todayStr ||
        o.status === 'in_transit' ||
        o.status === 'pending' ||
        o.status === 'assigned'
      )
    })
  }, [orders, todayStr])

  // Helpers to categorize orders into kanban columns
  const getOrderKanbanCategory = (order: OrderRecord): KanbanColumnKey => {
    if (
      order.status === 'address_error' ||
      order.status === 'client_absent' ||
      order.status === 'cancelled' ||
      order.completion_reason === 'address_error' ||
      order.completion_reason === 'client_absent' ||
      (order.notes && order.notes.toLowerCase().includes('problema'))
    ) {
      return 'issues'
    }

    if (order.status === 'delivered') {
      return 'delivered'
    }

    if (
      order.status === 'in_transit' ||
      order.route_started === true ||
      Boolean(order.route_started_at)
    ) {
      return 'in_transit'
    }

    return 'pending'
  }

  // Summary Metrics
  const metrics = useMemo(() => {
    let pending = 0
    let inTransit = 0
    let delivered = 0
    let issues = 0

    todayOrders.forEach((o) => {
      const cat = getOrderKanbanCategory(o)
      if (cat === 'pending') pending++
      else if (cat === 'in_transit') inTransit++
      else if (cat === 'delivered') delivered++
      else if (cat === 'issues') issues++
    })

    const total = todayOrders.length
    return { total, pending, inTransit, delivered, issues }
  }, [todayOrders])

  // Map couriers data with latest GPS coordinates & active route status
  // CORREÇÃO A & B:
  // 1. Sem coordenadas inventadas: usar estritamente latestLoc.lat/lng ou start_base_lat/lng do pedido ativo
  // 2. hasRouteStarted / activeInTransitOrders verificados contra a lista GLOBAL de pedidos em trânsito
  const allCourierData = useMemo(() => {
    return couriers.map((courier) => {
      const courierLocs = locations.filter((l) => l.user_id === courier.id)
      const latestLoc = courierLocs[0]

      // Pedidos atribuídos ao entregador na visão global (todos os pedidos do sistema)
      const globalCourierTransit = globalInTransitOrders.filter((o) => o.courier_id === courier.id)
      // Pedidos locais da loja (para métricas e kanban da loja)
      const courierLocalOrders = todayOrders.filter((o) => o.courier_id === courier.id)

      // Rota ativa do entregador considerada tanto globalmente quanto localmente
      const allTransitOrders = [
        ...globalCourierTransit,
        ...courierLocalOrders.filter((o) => o.status === 'in_transit' && o.route_started === true),
      ]
      const uniqueActiveTransitOrders = Array.from(
        new Map(allTransitOrders.map((o) => [o.id, o])).values(),
      )

      // Coordenadas válidas: estritamente telemetria real do entregador.
      // Se ainda não houver telemetria, fallback para a base de partida do pedido ativo.
      // Se nenhum existir, lat/lng ficam undefined (não renderiza marcador com coordenada inventada).
      const firstActiveOrder = uniqueActiveTransitOrders[0]
      let lat: number | undefined =
        typeof latestLoc?.lat === 'number' && !isNaN(latestLoc.lat)
          ? latestLoc.lat
          : firstActiveOrder?.start_base_lat
            ? Number(firstActiveOrder.start_base_lat)
            : undefined

      let lng: number | undefined =
        typeof latestLoc?.lng === 'number' && !isNaN(latestLoc.lng)
          ? latestLoc.lng
          : firstActiveOrder?.start_base_lng
            ? Number(firstActiveOrder.start_base_lng)
            : undefined

      const speed = latestLoc?.speed ?? 0

      const activeInTransitOrders = uniqueActiveTransitOrders
      const inTransitOrders = activeInTransitOrders
      const pendingOrders = courierLocalOrders.filter(
        (o) =>
          o.status === 'pending' ||
          o.status === 'assigned' ||
          (o.status === 'in_transit' && !o.route_started),
      )
      const problemOrders = courierLocalOrders.filter(
        (o) =>
          o.status === 'address_error' ||
          o.status === 'client_absent' ||
          o.completion_reason === 'address_error' ||
          o.completion_reason === 'client_absent',
      )
      const finishedOrders = courierLocalOrders.filter((o) => o.status === 'delivered')

      // Entregas da rota iniciada atribuídas ao entregador que ainda não foram marcadas como route_finished
      const activeRouteOrdersForCourier = [
        ...globalCourierTransit,
        ...courierLocalOrders.filter(
          (o) =>
            o.route_started === true && (o.route_finished === false || o.route_finished == null),
        ),
      ]
      const uniqueCourierRouteOrders = Array.from(
        new Map(activeRouteOrdersForCourier.map((o) => [o.id, o])).values(),
      )

      // Rota ativa existe se há rota iniciada e ainda não finalizada
      const hasRouteStarted = uniqueCourierRouteOrders.length > 0

      // Verifica se todas as entregas já foram entregues (mas rota ainda não foi finalizada na base)
      const pendingStops = uniqueCourierRouteOrders.filter((o) => o.status !== 'delivered')
      const isReturningToBase = hasRouteStarted && pendingStops.length === 0

      let statusColor: 'green' | 'yellow' | 'red' = 'green'
      let statusLabel = 'Disponível — rota não iniciada'

      if (problemOrders.length > 0) {
        statusColor = 'red'
        statusLabel = 'Ocorrência na Rota'
      } else if (isReturningToBase) {
        statusColor = 'yellow'
        statusLabel = 'Retornando à Base'
      } else if (hasRouteStarted) {
        statusColor = 'yellow'
        statusLabel = 'Em Rota Oficial'
      } else if (courier.status === 'inactive') {
        statusColor = 'red'
        statusLabel = 'Inativo'
      } else if (inTransitOrders.length > 0) {
        statusColor = 'green'
        statusLabel = 'Aguardando Início da Rota'
      } else {
        statusColor = 'green'
        statusLabel = 'Disponível — rota não iniciada'
      }

      const nextOrder = activeInTransitOrders[0] || null
      const lastDelivered = finishedOrders[finishedOrders.length - 1] || null

      return {
        courier,
        lat: lat as number,
        lng: lng as number,
        hasValidCoords: typeof lat === 'number' && typeof lng === 'number',
        speed,
        battery_level: latestLoc?.battery_level,
        location_timestamp: latestLoc?.updated || latestLoc?.created,
        gps_status: latestLoc?.gps_status,
        offline_buffered: latestLoc?.offline_buffered,
        accuracy: latestLoc?.accuracy,
        hasRouteStarted,
        statusColor,
        statusLabel,
        activeOrdersCount: inTransitOrders.length + pendingOrders.length,
        inTransitCount: inTransitOrders.length,
        pendingCount: pendingOrders.length,
        problemCount: problemOrders.length,
        finishedCount: finishedOrders.length,
        nextOrder,
        lastDelivered,
        vehicle: courier.vehicle_type || 'moto',
        allAssignedOrders:
          uniqueActiveTransitOrders.length > 0 ? uniqueActiveTransitOrders : courierLocalOrders,
      }
    })
  }, [couriers, locations, todayOrders, globalInTransitOrders])

  // REQUISITO: No mapa aparecem APENAS entregadores com rota iniciada (e com coordenadas válidas)
  const activeRouteCouriers = useMemo(() => {
    return allCourierData.filter((c) => c.hasRouteStarted && c.hasValidCoords)
  }, [allCourierData])

  // Entregadores disponíveis (mantido para cálculos internos se necessário)
  const availableCouriers = useMemo(() => {
    return allCourierData.filter((c) => !c.hasRouteStarted)
  }, [allCourierData])

  // Atualização e cálculo contínuo de rotas viárias ativas, desvio de rota, parada fora do local e ETA
  useEffect(() => {
    let isCurrent = true

    // Para cada entregador com rota iniciada, buscar/atualizar o trajeto oficial:
    // Base de partida → sequência de clientes da rota iniciada (route_started = true)
    // OTIMIZAÇÃO: Cache e debounce inteligente. Só recalcular rota viária (OSRM/Google)
    // se a posição do entregador mudou >50m OU a lista de pedidos da rota mudou.
    const computeActiveRoutes = async () => {
      const activePromises = activeRouteCouriers.map(async (item) => {
        // Obter todos os pedidos ativos da rota iniciada ordenados por sequência
        const activeRouteOrders = item.allAssignedOrders
          .filter(
            (o) =>
              o.route_started === true &&
              o.route_finished !== true &&
              (o.status === 'in_transit' || o.status === 'pending' || o.status === 'delivered'),
          )
          .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))

        if (activeRouteOrders.length === 0) {
          activeRoutesCacheRef.current.delete(item.courier.id)
          return null
        }

        // O primeiro pedido ativo define a base e o alvo primário de telemetria
        const primaryOrder =
          activeRouteOrders.find((o) => o.status === 'in_transit') ||
          activeRouteOrders.find((o) => o.status === 'pending') ||
          activeRouteOrders[0]

        const baseLat = primaryOrder.start_base_lat ? Number(primaryOrder.start_base_lat) : item.lat
        const baseLng = primaryOrder.start_base_lng ? Number(primaryOrder.start_base_lng) : item.lng
        const origin: LatLngPoint = { lat: baseLat, lng: baseLng }
        const courierPos: LatLngPoint = { lat: item.lat, lng: item.lng }

        // Base de retorno: end_address_lat/lng ou fallback start_base_lat/lng
        const returnBaseLat = primaryOrder.end_address_lat
          ? Number(primaryOrder.end_address_lat)
          : baseLat
        const returnBaseLng = primaryOrder.end_address_lng
          ? Number(primaryOrder.end_address_lng)
          : baseLng
        const returnBasePos: LatLngPoint = { lat: returnBaseLat, lng: returnBaseLng }

        // Coletar paradas válidas com lat/lng dos clientes
        const stops: LatLngPoint[] = []
        const pendingStopsList: LatLngPoint[] = []
        activeRouteOrders.forEach((o) => {
          const c = o.expand?.customer_id
          if (c?.lat && c?.lng) {
            const pt = { lat: Number(c.lat), lng: Number(c.lng) }
            stops.push(pt)
            if (o.status !== 'delivered') {
              pendingStopsList.push(pt)
            }
          }
        })

        if (stops.length === 0 && !returnBasePos) return null

        // Hash para verificar se a composição de pedidos/paradas mudou
        const stopIdsHash = activeRouteOrders
          .map((o) => `${o.id}:${o.status}:${o.sequence}`)
          .join(',')
        const cached = activeRoutesCacheRef.current.get(item.courier.id)

        // Se cache existente for válido e posição mudou <= 50 metros e pedidos não mudaram:
        // reutilizar a geometria calculada (evita chamadas de rede e re-criação de linhas)
        if (
          cached &&
          cached.stopIdsHash === stopIdsHash &&
          distanceMeters(cached.courierPos, courierPos) < 50
        ) {
          // Atualiza apenas dados leves de telemetria instantânea (velocidade/posição/status do entregador)
          return {
            ...cached.result,
            courierPos,
            courier: item.courier,
          }
        }

        try {
          // Traçar trajeto viário:
          // Perna de ida + paradas: origin → cliente 1 → cliente 2 ... → último cliente
          // Perna de retorno (separada): último cliente (ou origin se não houver paradas) → base de retorno
          const forwardWaypoints: LatLngPoint[] = stops.length > 0 ? [origin, ...stops] : [origin]
          const forwardSegments: LatLngPoint[] = []
          let prevPoint = origin

          for (let sIdx = 1; sIdx < forwardWaypoints.length; sIdx++) {
            const targetPoint = forwardWaypoints[sIdx]
            try {
              const segRes = await fetchStreetRoute(prevPoint, targetPoint)
              if (segRes.coordinates.length >= 2) {
                if (forwardSegments.length > 0) {
                  forwardSegments.push(...segRes.coordinates.slice(1))
                } else {
                  forwardSegments.push(...segRes.coordinates)
                }
              } else {
                if (forwardSegments.length === 0) forwardSegments.push(prevPoint)
                forwardSegments.push(targetPoint)
              }
            } catch {
              if (forwardSegments.length === 0) forwardSegments.push(prevPoint)
              forwardSegments.push(targetPoint)
            }
            prevPoint = targetPoint
          }

          const forwardPoints = forwardSegments.length >= 2 ? forwardSegments : forwardWaypoints

          // Perna de retorno à base dedicada
          const lastDeliveryPoint = stops.length > 0 ? stops[stops.length - 1] : origin
          let returnPoints: LatLngPoint[] = [lastDeliveryPoint, returnBasePos]
          try {
            const retRes = await fetchStreetRoute(lastDeliveryPoint, returnBasePos)
            if (retRes.coordinates.length >= 2) {
              returnPoints = retRes.coordinates
            }
          } catch {
            returnPoints = [lastDeliveryPoint, returnBasePos]
          }

          const points = [...forwardPoints, ...returnPoints.slice(1)]

          // Projeção e desvio
          const nearest = findNearestPointOnRoute(courierPos, points)
          const nextTargetPos = pendingStopsList[0] || returnBasePos
          const distToClientMeters = distanceMeters(courierPos, nextTargetPos)

          const hasActiveRouteStarted = Boolean(primaryOrder.route_started) && item.hasRouteStarted

          const routeStartTime = primaryOrder.route_started_at
            ? new Date(primaryOrder.route_started_at).getTime()
            : 0
          const hasDeviationEvent =
            hasActiveRouteStarted &&
            recentDeviations.some((dev) => {
              if (dev.courier_id !== item.courier.id) return false
              if (dev.order_id !== primaryOrder.id) return false
              if (dev.resolved === true) return false
              if (routeStartTime && dev.created) {
                const devTime = new Date(dev.created).getTime()
                if (!isNaN(devTime) && devTime < routeStartTime) return false
              }
              return true
            })
          const isDeviated =
            hasActiveRouteStarted &&
            (hasDeviationEvent || nearest.distanceMeters > DEVIATION_THRESHOLD_METERS)

          // Parada fora do local
          const distToBaseMeters = distanceMeters(courierPos, origin)
          const isStopped = typeof item.speed === 'number' && item.speed <= 2
          const isFarFromClient = distToClientMeters > UNEXPECTED_STOP_THRESHOLD_METERS
          const isFarFromBase = distToBaseMeters > UNEXPECTED_STOP_THRESHOLD_METERS
          const isUnexpectedStop =
            hasActiveRouteStarted && isStopped && isFarFromClient && isFarFromBase

          // ETA
          const effectiveSpeedKmh =
            typeof item.speed === 'number' && item.speed > 5 ? item.speed : 25
          const speedMps = effectiveSpeedKmh * (1000 / 3600)
          const remainingDistNextClient = distanceMeters(courierPos, nextTargetPos)
          const etaMinutesNextClient = Math.max(
            1,
            Math.round(remainingDistNextClient / speedMps / 60),
          )

          let totalDistToReturnBase = 0
          let currentLegPoint = courierPos
          for (const pStop of pendingStopsList) {
            totalDistToReturnBase += distanceMeters(currentLegPoint, pStop)
            currentLegPoint = pStop
          }
          totalDistToReturnBase += distanceMeters(currentLegPoint, returnBasePos)
          const serviceTimeMinutes = pendingStopsList.length * 5
          const etaMinutesReturnBase = Math.max(
            etaMinutesNextClient,
            Math.round(totalDistToReturnBase / speedMps / 60) + serviceTimeMinutes,
          )

          const nowTime = Date.now()
          const etaNextDeliveryDate = new Date(nowTime + etaMinutesNextClient * 60 * 1000)
          const etaReturnBaseDate = new Date(nowTime + etaMinutesReturnBase * 60 * 1000)
          const etaNextDeliveryTime = etaNextDeliveryDate.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })
          const etaReturnBaseTime = etaReturnBaseDate.toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit',
          })

          const routeResult = {
            courierId: item.courier.id,
            orderId: primaryOrder.id,
            points,
            forwardPoints,
            returnPoints,
            courierPos,
            custPos: nextTargetPos,
            basePos: primaryOrder.start_base_lat ? origin : undefined,
            returnBasePos,
            isDeviated,
            deviationMeters: Math.round(nearest.distanceMeters),
            nearestPointOnRoute: nearest.nearestPoint,
            isUnexpectedStop,
            etaMinutes: etaMinutesNextClient,
            etaNextDeliveryTime: pendingStopsList.length > 0 ? etaNextDeliveryTime : undefined,
            etaReturnBaseMinutes: etaMinutesReturnBase,
            etaReturnBaseTime,
            order: primaryOrder,
            courier: item.courier,
          }

          // Salvar em cache
          activeRoutesCacheRef.current.set(item.courier.id, {
            courierPos,
            stopIdsHash,
            result: routeResult,
          })

          return routeResult
        } catch {
          return null
        }
      })

      const results = (await Promise.all(activePromises)).filter(Boolean) as any[]
      if (isCurrent) {
        setActiveRoutesData(results)

        // 3. Alerta sonoro de exceção na Torre com deduplicação por Set:
        // Ao detectar desvio (isDeviated) ou parada fora do local / atraso relevante (isUnexpectedStop ou ETA > 60 min em entrega in_transit)
        const currentActiveEventKeys = new Set<string>()

        results.forEach((r) => {
          const courierId = r.courierId
          const orderId = r.orderId
          const courierName = r.courier?.name || r.courier?.email || 'Entregador'

          // Caso de desvio
          if (r.isDeviated) {
            const devKey = `dev-${courierId}-${orderId}`
            currentActiveEventKeys.add(devKey)
            if (!notifiedEventsRef.current.has(devKey)) {
              notifiedEventsRef.current.add(devKey)
              playOffRouteWarningSound()
              toast({
                title: '⚠️ ALERTA DE EXCEÇÃO NA ROTA',
                description: `Desvio de rota detectado: ${courierName} está a ${r.deviationMeters}m fora do trajeto oficial!`,
                variant: 'destructive',
              })
            }
          }

          // Caso de parada fora do local
          if (r.isUnexpectedStop) {
            const stopKey = `stop-${courierId}`
            currentActiveEventKeys.add(stopKey)
            if (!notifiedEventsRef.current.has(stopKey)) {
              notifiedEventsRef.current.add(stopKey)
              playOffRouteWarningSound()
              toast({
                title: '⚠️ ALERTA DE EXCEÇÃO NA ROTA',
                description: `Parada fora do local: ${courierName} parado longe do cliente e da base!`,
                variant: 'destructive',
              })
            }
          }

          // Caso de atraso relevante (ETA > 60 min em entrega em trânsito)
          if (r.etaMinutes > 60) {
            const etaKey = `eta-${courierId}-${orderId}`
            currentActiveEventKeys.add(etaKey)
            if (!notifiedEventsRef.current.has(etaKey)) {
              notifiedEventsRef.current.add(etaKey)
              playOffRouteWarningSound()
              toast({
                title: '⚠️ ALERTA DE EXCEÇÃO NA ROTA',
                description: `Atraso relevante: ${courierName} com previsão de entrega acima de ${r.etaMinutes} min!`,
                variant: 'destructive',
              })
            }
          }
        })

        // 4. Alerta de GPS desligado ou Perda de sinal para entregadores em rota ativa
        activeRouteCouriers.forEach((courierItem) => {
          const courierId = courierItem.courier.id
          const courierName = courierItem.courier.name || courierItem.courier.email || 'Entregador'
          const locTime = courierItem.location_timestamp
            ? new Date(courierItem.location_timestamp).getTime()
            : 0
          const isGpsDisabled = courierItem.gps_status === 'disabled'
          const isSignalLost =
            courierItem.gps_status === 'offline' ||
            (locTime > 0 && Date.now() - locTime > 2 * 60 * 1000)

          if (isGpsDisabled) {
            const gpsKey = `gps-disabled-${courierId}`
            currentActiveEventKeys.add(gpsKey)
            if (!notifiedEventsRef.current.has(gpsKey)) {
              notifiedEventsRef.current.add(gpsKey)
              playOffRouteWarningSound()
              toast({
                title: '📡 GPS DESLIGADO NA ROTA',
                description: `${courierName} desligou o GPS ou negou permissão durante a rota!`,
                variant: 'destructive',
              })
            }
          } else if (isSignalLost) {
            const signalKey = `signal-lost-${courierId}`
            currentActiveEventKeys.add(signalKey)
            if (!notifiedEventsRef.current.has(signalKey)) {
              notifiedEventsRef.current.add(signalKey)
              playOffRouteWarningSound()
              toast({
                title: '📴 PERDA DE SINAL NA ROTA',
                description: `${courierName} está sem comunicação GPS há mais de 2 minutos!`,
                variant: 'destructive',
              })
            }
          }
        })

        // Remover do Set ocorrências que voltaram à rota ou foram concluídas
        notifiedEventsRef.current.forEach((k) => {
          if (!currentActiveEventKeys.has(k)) {
            notifiedEventsRef.current.delete(k)
          }
        })

        // Limpar da lista de alertas dispensados os eventos que já normalizaram
        // para que, se voltar a falhar no futuro, o banner reapareça corretamente
        setDismissedGpsAlertIds((prev) => {
          if (prev.length === 0) return prev
          return prev.filter((dismissedId) => {
            if (dismissedId.startsWith('gps-')) {
              const cId = dismissedId.replace('gps-', '')
              return currentActiveEventKeys.has(`gps-disabled-${cId}`)
            }
            if (dismissedId.startsWith('sig-')) {
              const cId = dismissedId.replace('sig-', '')
              return currentActiveEventKeys.has(`signal-lost-${cId}`)
            }
            return false
          })
        })
      }
    }

    if (activeRouteCouriers.length > 0) {
      computeActiveRoutes()
    } else {
      setActiveRoutesData([])
      notifiedEventsRef.current.clear()
    }

    return () => {
      isCurrent = false
    }
  }, [activeRouteCouriers, recentDeviations, toast])

  // Marcadores formatados para o mapa vetorial e Google Maps
  const controlTowerMapMarkers = useMemo<MapMarkerItem[]>(() => {
    const list: MapMarkerItem[] = []

    if (mapDisplayMode === 'delivered') {
      // No modo 'delivered', mostra APENAS entregas concluídas com type: 'order_delivered' (pin verde #10B981)
      todayOrders
        .filter((o) => o.status === 'delivered')
        .forEach((order) => {
          const cust = order.expand?.customer_id
          if (cust?.lat && cust?.lng) {
            const courier = order.expand?.courier_id
            const seqText = order.sequence ? `[#${order.sequence}] ` : ''
            list.push({
              id: `order-${order.id}`,
              title: `${seqText}${cust.name || 'Cliente'} • ${order.tracking_code} (✓ Entregue)`,
              subtitle: `${cust.address || 'Endereço'} • Concluído por ${courier?.name || 'Entregador'}`,
              lat: cust.lat,
              lng: cust.lng,
              type: 'order_delivered',
              tracking_code: order.tracking_code,
              customer_name: cust.name,
              customer_address: cust.address,
              total_price: Number(order.total_price || 0),
              estimated_arrival: order.estimated_arrival,
              courier_name: courier?.name,
              delivery_sequence: order.sequence,
            })
          }
        })

      return list
    }

    // Modo 'in_transit': mostra entregadores ativos + pedidos in_transit/pending (pin laranja com nome e sequência)
    // 1. Entregadores em rota ativa (marcador azul com ícone de veículo)
    activeRouteCouriers.forEach((item) => {
      const courierName = item.courier.name || item.courier.email
      const plate = item.courier.vehicle_plate ? ` • Placa: ${item.courier.vehicle_plate}` : ''
      const routeInfo = activeRoutesData.find((r) => r.courierId === item.courier.id)
      const warningSuffix = routeInfo?.isDeviated
        ? ` • ⚠️ DESVIO (${routeInfo.deviationMeters}m)`
        : routeInfo?.isUnexpectedStop
          ? ' • ⛔ PARADA FORA DO LOCAL'
          : ''
      const emoji = getVehicleEmoji(item.vehicle)
      const stateSuffix =
        item.statusLabel === 'Retornando à Base' ? ' (Retornando à Base)' : ' (Em Rota)'

      list.push({
        id: `courier-${item.courier.id}`,
        title: `${emoji} ${courierName}${stateSuffix}${warningSuffix}`,
        subtitle: `${formatVehicle(item.vehicle)}${plate} • ${item.inTransitCount} em rota`,
        lat: item.lat,
        lng: item.lng,
        type: 'courier',
        speed: item.speed,
        courier_name: courierName,
        vehicle_type: item.vehicle,
        isDeviated: routeInfo?.isDeviated,
        deviationMeters: routeInfo?.deviationMeters,
        isUnexpectedStop: routeInfo?.isUnexpectedStop,
        etaMinutes: routeInfo?.etaMinutes,
        etaNextDeliveryTime: routeInfo?.etaNextDeliveryTime,
        etaReturnBaseMinutes: routeInfo?.etaReturnBaseMinutes,
        etaReturnBaseTime: routeInfo?.etaReturnBaseTime,
        battery_level: item.battery_level,
        location_timestamp: item.location_timestamp,
        gps_status: item.gps_status as 'active' | 'disabled' | 'offline' | undefined,
        offline_buffered: item.offline_buffered,
      })
    }) // 2. Destinos de entregas em trânsito e pendentes (marcador laranja com nome e número de sequência)
    todayOrders
      .filter((o) => o.status === 'in_transit' || o.status === 'pending')
      .forEach((order) => {
        const cust = order.expand?.customer_id
        if (cust?.lat && cust?.lng) {
          const courier = order.expand?.courier_id
          const isTransit = order.status === 'in_transit' || order.route_started
          const routeInfo = activeRoutesData.find((r) => r.orderId === order.id)
          const etaSuffix = routeInfo ? ` • Prazo ETA: ~${routeInfo.etaMinutes} min` : ''
          const seqText = order.sequence ? `[#${order.sequence}] ` : ''

          list.push({
            id: `order-${order.id}`,
            title: `${seqText}${cust.name || 'Cliente'} • ${order.tracking_code}${etaSuffix}`,
            subtitle: `${cust.address || 'Endereço'} • R$ ${Number(order.total_price || 0).toFixed(2)}`,
            lat: cust.lat,
            lng: cust.lng,
            type: isTransit ? 'order_transit' : 'order_pending',
            tracking_code: order.tracking_code,
            customer_name: cust.name,
            customer_address: cust.address,
            total_price: Number(order.total_price || 0),
            estimated_arrival: order.estimated_arrival,
            courier_name: courier?.name,
            delivery_sequence: order.sequence,
          })
        }
      })

    return list
  }, [mapDisplayMode, activeRouteCouriers, todayOrders, activeRoutesData])

  // Filtered orders for Kanban
  const filteredOrders = useMemo(() => {
    return todayOrders.filter((order) => {
      const cat = getOrderKanbanCategory(order)
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'issues'
            ? cat === 'issues'
            : cat === statusFilter

      const matchesCourier = courierFilter === 'all' ? true : order.courier_id === courierFilter

      const cust = order.expand?.customer_id
      const query = searchQuery.toLowerCase().trim()
      const matchesSearch =
        !query ||
        order.tracking_code.toLowerCase().includes(query) ||
        (cust?.name && cust.name.toLowerCase().includes(query)) ||
        (cust?.address && cust.address.toLowerCase().includes(query)) ||
        (order.expand?.courier_id?.name &&
          order.expand.courier_id.name.toLowerCase().includes(query))

      return matchesStatus && matchesCourier && matchesSearch
    })
  }, [todayOrders, statusFilter, courierFilter, searchQuery])

  // Group filtered orders by Kanban column
  const kanbanColumnsData = useMemo(() => {
    const grouped: Record<KanbanColumnKey, OrderRecord[]> = {
      pending: [],
      in_transit: [],
      delivered: [],
      issues: [],
    }

    filteredOrders.forEach((o) => {
      const cat = getOrderKanbanCategory(o)
      grouped[cat].push(o)
    })

    // Sort: sequence ascending, or created desc
    Object.keys(grouped).forEach((k) => {
      grouped[k as KanbanColumnKey].sort((a, b) => {
        if (a.sequence && b.sequence) return a.sequence - b.sequence
        return (b.created || '').localeCompare(a.created || '')
      })
    })

    return grouped
  }, [filteredOrders])

  // Interactive Main Google Map
  useEffect(() => {
    if (!mapsLoaded || typeof window === 'undefined') return
    const win = window as any
    if (!win.google || !win.google.maps) return

    const mapElement = mapContainerRef.current
    if (!mapElement) return

    let map = mapInstance
    if (!map) {
      try {
        map = new win.google.maps.Map(mapElement, {
          center: { lat: -22.906847, lng: -43.172896 },
          zoom: 12,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          styles: [],
        })
        setMapInstance(map)
      } catch (err) {
        console.warn('Erro ao instanciar Google Maps na Torre:', err)
        setMapsError(true)
        setMapsLoaded(false)
        return
      }
    }

    // Clear old markers (preservando marcadores animados de entregadores)
    markersRef.forEach((m) => {
      // Se não for um dos marcadores de entregador ativos, limpar do mapa
      const isManagedCourierMarker = Array.from(courierMarkersMapRef.current.values()).includes(m)
      if (!isManagedCourierMarker) {
        m.setMap(null)
      }
    })
    const newMarkers: any[] = []
    const bounds = new win.google.maps.LatLngBounds()
    let hasCoords = false

    // Clear old Google Maps polylines
    googlePolylinesRef.current.forEach((p) => p.setMap(null))
    googlePolylinesRef.current = []

    // No modo 'delivered', não desenhamos as linhas viárias ativas nem linhas de desvio
    if (mapDisplayMode !== 'delivered') {
      // 1. DESENHAR ROTAS REAIS VIÁRIAS NO GOOGLE MAPS NATIVO:
      // Perna de ida/entregas em azul (#2563EB) e Perna de retorno à base em azul claro tracejado (#60A5FA)
      activeRoutesData.forEach((routeData) => {
        const fPoints = routeData.forwardPoints || routeData.points
        if (fPoints && fPoints.length >= 2) {
          // LINHA AZUL VIÁRIA: Trajeto de ida e paradas
          const mainPolyline = new win.google.maps.Polyline({
            path: fPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })),
            geodesic: true,
            strokeColor: '#2563EB',
            strokeOpacity: 0.95,
            strokeWeight: 5,
            map,
          })
          googlePolylinesRef.current.push(mainPolyline)

          // Traço interno suave para efeito visual e destaque do percurso
          const innerPolyline = new win.google.maps.Polyline({
            path: fPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })),
            geodesic: true,
            strokeColor: '#93C5FD',
            strokeOpacity: 0.85,
            strokeWeight: 2,
            map,
          })
          googlePolylinesRef.current.push(innerPolyline)

          fPoints.forEach((p: any) => bounds.extend(p))
          hasCoords = true
        }

        // Perna de retorno à base (último cliente → base de retorno): #60A5FA tracejado
        const retPoints = routeData.returnPoints
        if (retPoints && retPoints.length >= 2) {
          const returnPolyline = new win.google.maps.Polyline({
            path: retPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })),
            geodesic: true,
            strokeColor: '#60A5FA',
            strokeOpacity: 0,
            strokeWeight: 4,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2.5 },
                repeat: '8px',
              },
            ],
            map,
          })
          googlePolylinesRef.current.push(returnPolyline)
          retPoints.forEach((p: any) => bounds.extend(p))
        }

        // 2. DESVIO DE ROTA NO GOOGLE MAPS NATIVO: LINHA VERMELHA TRACEJADA
        if (routeData.isDeviated && routeData.nearestPointOnRoute) {
          const deviationPolyline = new win.google.maps.Polyline({
            path: [
              { lat: routeData.courierPos.lat, lng: routeData.courierPos.lng },
              { lat: routeData.nearestPointOnRoute.lat, lng: routeData.nearestPointOnRoute.lng },
            ],
            geodesic: true,
            strokeColor: '#EF4444',
            strokeOpacity: 1.0,
            strokeWeight: 4,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
                offset: '0',
                repeat: '10px',
              },
            ],
            map,
          })
          googlePolylinesRef.current.push(deviationPolyline)
        }

        // Base Marker se presente
        if (routeData.basePos) {
          const baseMarker = new win.google.maps.Marker({
            position: routeData.basePos,
            map,
            title: `🟢 Base de Partida (${routeData.courier.name})`,
            icon: {
              path: win.google.maps.SymbolPath.CIRCLE,
              scale: 7,
              fillColor: '#10B981',
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#FFFFFF',
            },
          })
          newMarkers.push(baseMarker)
        }
      })
    }
    // Helpers de ícones SVG reaproveitados de LiveMap.tsx com adaptação para win.google.maps
    const makeNativeCourierSvg = (vehicle?: string, pinColor = '#0052CC') => {
      const generated = makeCourierSvgIcon(vehicle, pinColor, 46)
      return {
        url: generated.url,
        scaledSize: new win.google.maps.Size(46, 46),
        anchor: new win.google.maps.Point(23, 23),
      }
    }

    const makeNativeCustomerSvg = (customerName?: string, seq?: number, isTransit = false) => {
      // Pin compacto sem texto aberto para evitar sobreposição caótica de etiquetas
      const generated = makeCustomerSvgIcon(customerName, seq, isTransit, 72, 42, undefined, false)
      return {
        url: generated.url,
        scaledSize: new win.google.maps.Size(
          generated.scaledSize.width,
          generated.scaledSize.height,
        ),
        anchor: new win.google.maps.Point(generated.anchor.x, generated.anchor.y),
      }
    }

    // InfoWindow reutilizável para hover nos marcadores do Google Maps nativo
    const hoverInfoWindow = new win.google.maps.InfoWindow({
      disableAutoPan: true,
    })

    if (mapDisplayMode === 'delivered') {
      // Pins: Apenas entregas concluídas ('order_delivered') com pin verde
      todayOrders
        .filter((o) => o.status === 'delivered')
        .forEach((order) => {
          const cust = order.expand?.customer_id
          if (cust?.lat && cust?.lng) {
            const destPos = { lat: cust.lat, lng: cust.lng }
            bounds.extend(destPos)
            hasCoords = true

            const seqText = order.sequence ? `[Parada #${order.sequence}] ` : ''
            const destMarker = new win.google.maps.Marker({
              position: destPos,
              map,
              title: `✓ ${seqText}Entregue: ${cust.name || 'Cliente'} (${order.tracking_code})`,
              // pin verde #10B981 gerado via makeCustomerSvgIcon compacto
              icon: (() => {
                const generated = makeCustomerSvgIcon(
                  cust.name,
                  order.sequence,
                  false,
                  72,
                  42,
                  '#10B981',
                  false,
                )
                return {
                  url: generated.url,
                  scaledSize: new win.google.maps.Size(
                    generated.scaledSize.width,
                    generated.scaledSize.height,
                  ),
                  anchor: new win.google.maps.Point(generated.anchor.x, generated.anchor.y),
                }
              })(),
            })

            // Hover: exibir tooltip compacto com endereço de entrega e status
            destMarker.addListener('mouseover', () => {
              const html = `
                <div style="padding: 6px 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 240px; line-height: 1.3;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 2px;">
                    <strong style="font-size: 11.5px; color: #0f172a;">${cust.name || 'Cliente'}</strong>
                    ${order.sequence ? `<span style="font-size: 9px; font-weight: 800; background: #dcfce7; color: #15803d; padding: 1px 4px; border-radius: 3px;">#${order.sequence}</span>` : ''}
                  </div>
                  <div style="font-size: 10px; color: #15803d; font-weight: 700; margin-bottom: 3px;">✓ Entregue (${order.tracking_code})</div>
                  <div style="font-size: 10px; color: #334155; line-height: 1.25; background: #f8fafc; padding: 4px 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    📍 ${cust.address || cust.street || `${cust.lat.toFixed(4)}, ${cust.lng.toFixed(4)}`}
                  </div>
                </div>
              `
              hoverInfoWindow.setContent(html)
              hoverInfoWindow.open(map, destMarker)
            })

            destMarker.addListener('mouseout', () => {
              hoverInfoWindow.close()
            })

            destMarker.addListener('click', () => {
              hoverInfoWindow.close()
              handleOpenOrderDetails(order)
            })

            newMarkers.push(destMarker)
          }
        })
    } else {
      // Modo 'in_transit': Entregadores ativos + destinos em trânsito/pendentes
      // Pins: Entregadores com rota iniciada com interpolação suave (transição animada ~2-3s)
      const currentCourierIds = new Set(activeRouteCouriers.map((c) => c.courier.id))

      // Limpar marcadores de entregadores que não estão mais ativos
      courierMarkersMapRef.current.forEach((marker, cId) => {
        if (!currentCourierIds.has(cId)) {
          marker.setMap(null)
          courierMarkersMapRef.current.delete(cId)
          const animId = courierAnimFramesRef.current.get(cId)
          if (animId) {
            cancelAnimationFrame(animId)
            courierAnimFramesRef.current.delete(cId)
          }
        }
      })

      activeRouteCouriers.forEach((item) => {
        const targetPos = { lat: item.lat, lng: item.lng }
        bounds.extend(targetPos)
        hasCoords = true

        const routeInfo = activeRoutesData.find((r) => r.courierId === item.courier.id)
        const isDeviated = routeInfo?.isDeviated ?? false
        const isStoppedOut = routeInfo?.isUnexpectedStop ?? false

        // Cor do marcador do entregador: destaque vermelho para desvio, âmbar para parada fora do local
        const pinColor = isDeviated
          ? '#EF4444'
          : isStoppedOut
            ? '#F59E0B'
            : item.statusColor === 'red'
              ? '#EF4444'
              : '#0052CC'

        const statusTag = isDeviated
          ? `⚠️ [DESVIO DETECTADO: ${routeInfo?.deviationMeters || 0}m]`
          : isStoppedOut
            ? '⛔ [PARADA FORA DO LOCAL]'
            : '[Em Rota]'

        const vehicleLabel = getVehicleLabel(item.vehicle)
        const vehicleEmoji = getVehicleEmoji(item.vehicle)
        const courierName = item.courier.name || item.courier.email
        const markerTitle = `${vehicleEmoji} ${statusTag} ${courierName} (${vehicleLabel})`
        const markerIcon = makeNativeCourierSvg(item.vehicle, pinColor)

        let courierMarker = courierMarkersMapRef.current.get(item.courier.id)

        if (courierMarker) {
          // Atualizar mapa, título e ícone
          courierMarker.setMap(map)
          courierMarker.setTitle(markerTitle)
          courierMarker.setIcon(markerIcon)

          // Interpolação e animação suave do marcador da posição antiga para a nova (~2.5s)
          const prevPosition = courierMarker.getPosition()
          if (prevPosition) {
            const startLat = prevPosition.lat()
            const startLng = prevPosition.lng()
            const deltaLat = targetPos.lat - startLat
            const deltaLng = targetPos.lng - startLng

            // Se houve mudança de posição significativa (> 0.00001 graus), animar suavemente
            if (Math.abs(deltaLat) > 0.00001 || Math.abs(deltaLng) > 0.00001) {
              const prevAnim = courierAnimFramesRef.current.get(item.courier.id)
              if (prevAnim) cancelAnimationFrame(prevAnim)

              const animStartTime = performance.now()
              const duration = 2500 // 2.5s animação suave

              const step = (now: number) => {
                const elapsed = now - animStartTime
                const progress = Math.min(1, elapsed / duration)
                // Curva de interpolação ease-in-out suave
                const ease =
                  progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress

                const curLat = startLat + deltaLat * ease
                const curLng = startLng + deltaLng * ease
                courierMarker.setPosition({ lat: curLat, lng: curLng })

                if (progress < 1) {
                  const reqId = requestAnimationFrame(step)
                  courierAnimFramesRef.current.set(item.courier.id, reqId)
                } else {
                  courierMarker.setPosition(targetPos)
                  courierAnimFramesRef.current.delete(item.courier.id)
                }
              }

              const reqId = requestAnimationFrame(step)
              courierAnimFramesRef.current.set(item.courier.id, reqId)
            } else {
              courierMarker.setPosition(targetPos)
            }
          } else {
            courierMarker.setPosition(targetPos)
          }
        } else {
          // Criar novo marcador nativo
          courierMarker = new win.google.maps.Marker({
            position: targetPos,
            map,
            title: markerTitle,
            icon: markerIcon,
          })
          courierMarkersMapRef.current.set(item.courier.id, courierMarker)
        }

        // Tooltip com Local + Bateria + GPS + Desvio ao passar o mouse no entregador
        courierMarker.addListener('mouseover', async () => {
          const fallbackCoords = `${item.lat.toFixed(4)}, ${item.lng.toFixed(4)}`

          // Status do GPS por idade do ponto (> 2 minutos = off/sem sinal)
          let isGpsActive = false
          if (item.location_timestamp) {
            const locTime = new Date(item.location_timestamp).getTime()
            if (!isNaN(locTime)) {
              isGpsActive = Date.now() - locTime <= 2 * 60 * 1000
            }
          } else {
            // Se tem coordenadas recentes associadas a item
            isGpsActive = true
          }

          const hasBattery = typeof item.battery_level === 'number' && !isNaN(item.battery_level)
          const batteryVal = Math.round(item.battery_level || 0)
          const batteryColor =
            batteryVal <= 20 ? '#dc2626' : batteryVal <= 50 ? '#d97706' : '#16a34a'

          const locTime = item.location_timestamp ? new Date(item.location_timestamp).getTime() : 0
          const minutesSinceLastPoint = locTime ? Math.floor((Date.now() - locTime) / 60000) : 0
          const isOutdated = locTime ? Date.now() - locTime > 2 * 60 * 1000 : false
          const isGpsDisabled = item.gps_status === 'disabled'
          const isSignalLost = item.gps_status === 'offline' || isOutdated

          let gpsBadgeText = '📡 GPS ativo'
          let gpsBadgeBg = '#ecfdf5'
          let gpsBadgeColor = '#047857'
          let gpsBadgeBorder = '#a7f3d0'

          if (isGpsDisabled) {
            gpsBadgeText = '📡 GPS off'
            gpsBadgeBg = '#fef2f2'
            gpsBadgeColor = '#b91c1c'
            gpsBadgeBorder = '#fecaca'
          } else if (isSignalLost) {
            gpsBadgeText = `📴 Sem sinal (${minutesSinceLastPoint > 0 ? `${minutesSinceLastPoint} min` : '<2 min'})`
            gpsBadgeBg = '#fffbeb'
            gpsBadgeColor = '#b45309'
            gpsBadgeBorder = '#fde68a'
          }

          const buildCourierTooltipContent = (addressText: string) => `
        <div style="padding: 8px 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 260px; line-height: 1.35;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span style="font-size: 15px;">${vehicleEmoji}</span>
              <strong style="font-size: 12px; color: #0f172a; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${courierName}</strong>
            </div>
            <span style="font-size: 9px; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 1px 5px; border-radius: 4px;">${vehicleLabel}</span>
          </div>

          <!-- Badges de Bateria e GPS -->
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 10px; font-weight: 700; flex-wrap: wrap;">
            <span style="display: inline-flex; align-items: center; gap: 3px; background: ${gpsBadgeBg}; color: ${gpsBadgeColor}; border: 1px solid ${gpsBadgeBorder}; padding: 2px 5px; border-radius: 4px;">
              ${gpsBadgeText}
            </span>
            ${
              hasBattery
                ? `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #f8fafc; color: ${batteryColor}; border: 1px solid #e2e8f0; padding: 2px 5px; border-radius: 4px;">
                <span>🔋</span> ${batteryVal}%
              </span>
            `
                : ''
            }
            ${
              item.offline_buffered
                ? `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 5px; border-radius: 4px; font-size: 9px;">
                🔄 Buffer sincronizado
              </span>
            `
                : ''
            }
          </div>

          ${
            isDeviated && routeInfo?.deviationMeters
              ? `
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 4px 6px; margin-bottom: 5px; display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 10px;">⚠️</span>
              <span style="font-size: 11px; font-weight: 800; color: #dc2626;">Desvio: ${Math.round(routeInfo.deviationMeters)} m</span>
            </div>
          `
              : ''
          }

          <div style="background-color: #f8fafc; border-radius: 6px; padding: 5px 7px; margin-top: 3px; border: 1px solid #e2e8f0;">
            <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: #2563eb; display: block; margin-bottom: 2px;">
              📍 Endereço Atual em Tempo Real:
            </span>
            <span style="font-size: 10.5px; color: #1e293b; font-weight: 500; display: block; line-height: 1.3;">
              ${addressText}
            </span>
          </div>

          ${
            routeInfo?.etaNextDeliveryTime || routeInfo?.etaReturnBaseTime
              ? `
            <div style="background-color: #f0fdf4; border-radius: 6px; padding: 5px 7px; margin-top: 4px; border: 1px solid #bbf7d0;">
              <div style="font-size: 10px; color: #15803d; font-weight: 700;">
                ${
                  routeInfo?.etaNextDeliveryTime && routeInfo?.etaReturnBaseTime
                    ? `⏱️ Entrega ~${routeInfo.etaNextDeliveryTime} • Volta à base ~${routeInfo.etaReturnBaseTime}`
                    : routeInfo?.etaNextDeliveryTime
                      ? `⏱️ Entrega ~${routeInfo.etaNextDeliveryTime}`
                      : `🏢 Retornando à base • Chegada ~${routeInfo?.etaReturnBaseTime}`
                }
              </div>
            </div>
          `
              : ''
          }

          ${item.speed ? `<p style="font-size: 10px; margin: 4px 0 0; color: #6d28d9; font-weight: 600;">🚀 ${item.speed} km/h</p>` : ''}
        </div>
      `
          // Exibe inicialmente com carregando/fallback se demorar
          hoverInfoWindow.setContent(buildCourierTooltipContent('Localizando endereço...'))
          hoverInfoWindow.open(map, courierMarker)

          try {
            const parsed = await reverseGeocodeCoordinates(item.lat, item.lng, {
              toleranceMeters: 100,
            })
            const fullAddress = parsed?.formattedAddress || parsed?.street || fallbackCoords
            hoverInfoWindow.setContent(buildCourierTooltipContent(fullAddress))
          } catch (e) {
            hoverInfoWindow.setContent(buildCourierTooltipContent(fallbackCoords))
          }
        })

        courierMarker.addListener('mouseout', () => {
          hoverInfoWindow.close()
        })

        courierMarker.addListener('click', () => {
          hoverInfoWindow.close()
          setSelectedCourier(item.courier)
        })

        newMarkers.push(courierMarker)
      })

      // Pins: Destinos das entregas em trânsito e pendentes
      todayOrders
        .filter((o) => o.status === 'in_transit' || o.status === 'pending')
        .forEach((order) => {
          const cust = order.expand?.customer_id
          if (cust?.lat && cust?.lng) {
            const destPos = { lat: cust.lat, lng: cust.lng }
            bounds.extend(destPos)
            hasCoords = true

            const isTransit = order.status === 'in_transit'
            const routeInfo = activeRoutesData.find((r) => r.orderId === order.id)
            const etaText = routeInfo ? ` • ETA: ~${routeInfo.etaMinutes} min` : ''
            const seqText = order.sequence ? `[Parada #${order.sequence}] ` : ''

            const destMarker = new win.google.maps.Marker({
              position: destPos,
              map,
              title: `🏁 ${seqText}Destino: ${cust.name || 'Cliente'} (${order.tracking_code})${etaText}`,
              icon: makeNativeCustomerSvg(cust.name, order.sequence, isTransit),
            })

            // Hover: tooltip compacto de cliente
            destMarker.addListener('mouseover', () => {
              const html = `
                <div style="padding: 6px 8px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 240px; line-height: 1.3;">
                  <div style="display: flex; align-items: center; justify-content: space-between; gap: 4px; margin-bottom: 2px;">
                    <strong style="font-size: 11.5px; color: #0f172a;">${cust.name || 'Cliente'}</strong>
                    ${order.sequence ? `<span style="font-size: 9px; font-weight: 800; background: #ffedd5; color: #c2410c; padding: 1px 4px; border-radius: 3px;">#${order.sequence}</span>` : ''}
                  </div>
                  <div style="font-size: 10px; color: ${isTransit ? '#c2410c' : '#2563eb'}; font-weight: 700; margin-bottom: 3px;">
                    ${isTransit ? 'Em Trânsito' : 'Aguardando Início'} (${order.tracking_code})
                  </div>
                  <div style="font-size: 10px; color: #334155; line-height: 1.25; background: #f8fafc; padding: 4px 6px; border-radius: 4px; border: 1px solid #e2e8f0;">
                    📍 ${cust.address || cust.street || `${cust.lat.toFixed(4)}, ${cust.lng.toFixed(4)}`}
                  </div>
                  ${routeInfo?.etaMinutes ? `<div style="font-size: 9.5px; color: #0369a1; font-weight: 600; margin-top: 3px;">⏱️ ETA estimado: ~${routeInfo.etaMinutes} min</div>` : ''}
                </div>
              `
              hoverInfoWindow.setContent(html)
              hoverInfoWindow.open(map, destMarker)
            })

            destMarker.addListener('mouseout', () => {
              hoverInfoWindow.close()
            })

            destMarker.addListener('click', () => {
              hoverInfoWindow.close()
              handleOpenOrderDetails(order)
            })

            newMarkers.push(destMarker)
          }
        })
    }

    setMarkersRef(newMarkers)

    if (hasCoords && newMarkers.length > 0) {
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
      const listener = win.google.maps.event.addListener(map, 'idle', () => {
        if (map.getZoom() > 15) map.setZoom(15)
        win.google.maps.event.removeListener(listener)
      })
    }
  }, [mapsLoaded, activeRouteCouriers, todayOrders, activeRoutesData, mapDisplayMode])

  // Open Drawer for Order
  const handleOpenOrderDetails = (order: OrderRecord) => {
    setSelectedOrder(order)
    setStreetRoute(null)
    setDrawerMapFailed(false)
    setDrawerTilesLoaded(false)
    setDrawerReview(null)
    setIsDrawerOpen(true)
  }

  // Carregar avaliação (review) vinculada ao pedido quando o Drawer abrir
  useEffect(() => {
    if (!isDrawerOpen || !selectedOrder?.id) {
      setDrawerReview(null)
      return
    }

    let isCurrent = true
    setIsLoadingDrawerReview(true)
    deliveryService
      .getReviewByOrderId(selectedOrder.id)
      .then((rev) => {
        if (isCurrent) {
          setDrawerReview(rev)
          setIsLoadingDrawerReview(false)
        }
      })
      .catch((err) => {
        console.warn('Erro ao carregar review do pedido:', err)
        if (isCurrent) {
          setDrawerReview(null)
          setIsLoadingDrawerReview(false)
        }
      })

    return () => {
      isCurrent = false
    }
  }, [isDrawerOpen, selectedOrder?.id])

  // Get courier data for the selected order
  const orderCourierInfo = useMemo(() => {
    if (!selectedOrder) return null
    const courierId = selectedOrder.courier_id
    if (!courierId) return null
    return allCourierData.find((c) => c.courier.id === courierId) || null
  }, [selectedOrder, allCourierData])

  // Buscar rota viária real via OSRM quando um pedido é selecionado no Drawer
  useEffect(() => {
    if (!isDrawerOpen || !selectedOrder) return

    const cust = selectedOrder.expand?.customer_id
    if (!cust?.lat || !cust?.lng) return

    // Ponto de origem: base de partida ou localização atual do entregador ou ponto do cliente como fallback
    const originLat = selectedOrder.start_base_lat || orderCourierInfo?.lat || cust.lat
    const originLng = selectedOrder.start_base_lng || orderCourierInfo?.lng || cust.lng

    const origin: LatLngPoint = { lat: Number(originLat), lng: Number(originLng) }
    const destination: LatLngPoint = { lat: Number(cust.lat), lng: Number(cust.lng) }

    let isCurrent = true
    setIsLoadingStreetRoute(true)

    fetchStreetRoute(origin, destination)
      .then((res) => {
        if (isCurrent) {
          setStreetRoute(res)
          setIsLoadingStreetRoute(false)
        }
      })
      .catch((err) => {
        console.warn('Erro ao buscar rota viária:', err)
        if (isCurrent) setIsLoadingStreetRoute(false)
      })

    return () => {
      isCurrent = false
    }
  }, [
    isDrawerOpen,
    selectedOrder?.id,
    selectedOrder?.start_base_lat,
    selectedOrder?.start_base_lng,
    selectedOrder?.expand?.customer_id?.lat,
    selectedOrder?.expand?.customer_id?.lng,
    orderCourierInfo?.lat,
    orderCourierInfo?.lng,
  ])

  // Courier's route stops for the selected order
  const courierRouteOrders = useMemo(() => {
    if (!selectedOrder || !selectedOrder.courier_id) return []
    return todayOrders
      .filter((o) => o.courier_id === selectedOrder.courier_id)
      .sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
  }, [selectedOrder, todayOrders])

  // Render Mini-Map inside the Drawer com ResizeObserver e timeout de fallback de tiles
  useEffect(() => {
    if (!isDrawerOpen || !selectedOrder) {
      setDrawerTilesLoaded(false)
      setDrawerMapFailed(false)
      return
    }

    if (!mapsLoaded || mapsError || typeof window === 'undefined') {
      setDrawerMapFailed(true)
      return
    }

    const win = window as any
    if (!win.google || !win.google.maps) {
      setDrawerMapFailed(true)
      return
    }

    const container = drawerMiniMapRef.current
    if (!container) return

    const cust = selectedOrder.expand?.customer_id
    const courierData = orderCourierInfo

    // Coordinates for center: courier lat/lng or customer lat/lng
    const centerLat =
      courierData?.lat ||
      cust?.lat ||
      (selectedOrder.start_base_lat ? Number(selectedOrder.start_base_lat) : -22.906847)
    const centerLng =
      courierData?.lng ||
      cust?.lng ||
      (selectedOrder.start_base_lng ? Number(selectedOrder.start_base_lng) : -43.172896)
    drawerCenterRef.current = { lat: centerLat, lng: centerLng }

    let miniMap = drawerMapInstance
    let isMounted = true

    if (!miniMap) {
      try {
        miniMap = new win.google.maps.Map(container, {
          center: { lat: centerLat, lng: centerLng },
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          styles: [],
        })
        setDrawerMapInstance(miniMap)
      } catch (err) {
        console.warn('Mini-map init failed:', err)
        setDrawerMapFailed(true)
        return
      }
    } else {
      miniMap.setCenter({ lat: centerLat, lng: centerLng })
    }

    // Monitoramento do carregamento dos tiles e estado idle do Google Maps
    let tilesOrIdleReceived = false
    const onTileSuccess = () => {
      tilesOrIdleReceived = true
      if (isMounted) {
        setDrawerTilesLoaded(true)
        setDrawerMapFailed(false)
      }
    }

    const tilesListener = miniMap.addListener('tilesloaded', onTileSuccess)
    const idleListener = miniMap.addListener('idle', () => {
      // Se já disparou idle e o container tem dimensões, considerar renderizado
      if (container.clientWidth > 0 && container.clientHeight > 0) {
        onTileSuccess()
      }
    })

    // Timeout de 1.8s: se não disparar tilesloaded/idle em dimensões válidas, marcar como falho e acionar o fallback vetorial
    const fallbackTimer = setTimeout(() => {
      if (!tilesOrIdleReceived && isMounted) {
        console.warn(
          'Google Maps no Drawer não respondeu tilesloaded/idle a tempo; acionando fallback vetorial.',
        )
        setDrawerMapFailed(true)
      }
    }, 1800)

    // ResizeObserver: enquanto o Drawer anima e container ganha dimensões > 0, dispara o resize do Google Maps
    let resizeObserver: ResizeObserver | null = null
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const { width, height } = entry.contentRect
          if (width > 0 && height > 0 && miniMap) {
            try {
              win.google.maps.event.trigger(miniMap, 'resize')
              if (drawerBoundsRef.current && !drawerBoundsRef.current.isEmpty()) {
                miniMap.fitBounds(drawerBoundsRef.current, {
                  top: 30,
                  right: 30,
                  bottom: 30,
                  left: 30,
                })
              } else if (drawerCenterRef.current) {
                miniMap.setCenter(drawerCenterRef.current)
              }
            } catch (e) {
              console.warn('Erro ao disparar resize no mini-mapa:', e)
            }
          }
        }
      })
      resizeObserver.observe(container)
    }

    // Clear old drawer markers and lines
    drawerMarkersRef.current.forEach((m) => m.setMap(null))
    drawerMarkersRef.current = []
    if (drawerPolylineRef.current) {
      drawerPolylineRef.current.setMap(null)
      drawerPolylineRef.current = null
    }

    const bounds = new win.google.maps.LatLngBounds()
    const pathCoordinates: any[] = []

    // 1. Base / Partida pin if available
    if (selectedOrder.start_base_lat && selectedOrder.start_base_lng) {
      const basePos = { lat: selectedOrder.start_base_lat, lng: selectedOrder.start_base_lng }
      bounds.extend(basePos)
      pathCoordinates.push(basePos)

      const baseMarker = new win.google.maps.Marker({
        position: basePos,
        map: miniMap,
        title: `Partida / Base: ${selectedOrder.start_base_name || 'Base Central'}`,
        icon: {
          path: win.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#10B981',
          fillOpacity: 1,
          strokeWeight: 2,
          strokeColor: '#FFFFFF',
        },
      })
      drawerMarkersRef.current.push(baseMarker)
    }

    // Helpers de SVG para o mini mapa do Drawer (reaproveita os geradores de LiveMap)
    const makeMiniCourierSvg = (vehicle?: string) => {
      const generated = makeCourierSvgIcon(vehicle, '#0052CC', 40)
      return {
        url: generated.url,
        scaledSize: new win.google.maps.Size(40, 40),
        anchor: new win.google.maps.Point(20, 20),
      }
    }

    const makeMiniCustomerSvg = (customerName?: string, seq?: number) => {
      const generated = makeCustomerSvgIcon(customerName, seq, true, 110, 48)
      return {
        url: generated.url,
        scaledSize: new win.google.maps.Size(110, 48),
        anchor: new win.google.maps.Point(generated.anchor.x, generated.anchor.y),
      }
    }

    // 2. Entregador pin
    if (courierData && courierData.hasRouteStarted) {
      const courierPos = { lat: courierData.lat, lng: courierData.lng }
      bounds.extend(courierPos)
      pathCoordinates.push(courierPos)

      const courierMarker = new win.google.maps.Marker({
        position: courierPos,
        map: miniMap,
        title: `Entregador: ${courierData.courier.name} (${formatVehicle(courierData.courier.vehicle_type)})`,
        icon: makeMiniCourierSvg(courierData.courier.vehicle_type),
      })
      drawerMarkersRef.current.push(courierMarker)
    }

    // 3. Cliente destino pin (highlighted com nome visível e número de sequência)
    if (cust?.lat && cust?.lng) {
      const clientPos = { lat: cust.lat, lng: cust.lng }
      bounds.extend(clientPos)
      pathCoordinates.push(clientPos)

      const clientMarker = new win.google.maps.Marker({
        position: clientPos,
        map: miniMap,
        title: `Cliente: ${cust.name}`,
        icon: makeMiniCustomerSvg(cust.name, selectedOrder.sequence),
      })
      drawerMarkersRef.current.push(clientMarker)
    }

    // Limpar polilinhas antigas de desvio
    if (drawerDeviationPolylineRef.current) {
      drawerDeviationPolylineRef.current.setMap(null)
      drawerDeviationPolylineRef.current = null
    }

    // Desenhar a rota indicada pelo sistema (LINHA AZUL)
    // Se temos a geometria de ruas do OSRM, usamos a sequência completa de ruas; caso contrário os pontos chave
    const blueLinePoints =
      streetRoute && streetRoute.coordinates.length >= 2
        ? streetRoute.coordinates.map((c) => ({ lat: c.lat, lng: c.lng }))
        : pathCoordinates

    if (blueLinePoints.length >= 2) {
      blueLinePoints.forEach((p) => bounds.extend(p))

      const polyline = new win.google.maps.Polyline({
        path: blueLinePoints,
        geodesic: true,
        strokeColor: '#2563EB', // LINHA AZUL INDICADA PELO SISTEMA
        strokeOpacity: 0.9,
        strokeWeight: 5,
      })
      polyline.setMap(miniMap)
      drawerPolylineRef.current = polyline
    }

    // Verificar se o entregador está em desvio de rota e desenhar LINHA VERMELHA
    // REQUISITO ESTRITO: Linha vermelha apenas quando hasActiveRouteStarted && isDeviated
    const isSelectedOrderInActiveRoute =
      Boolean(selectedOrder.route_started) &&
      (selectedOrder.status === 'in_transit' || selectedOrder.status === 'pending')

    if (
      isSelectedOrderInActiveRoute &&
      courierData &&
      courierData.hasRouteStarted &&
      blueLinePoints.length >= 2
    ) {
      const courierPoint: LatLngPoint = { lat: courierData.lat, lng: courierData.lng }
      const nearest = findNearestPointOnRoute(courierPoint, blueLinePoints)

      // Verificar desvio registrado pelo sistema (coleção off_route_events ou distância > DEVIATION_THRESHOLD_METERS)
      const selectedRouteStartTime = selectedOrder.route_started_at
        ? new Date(selectedOrder.route_started_at).getTime()
        : 0
      const hasSystemDeviationEvent = recentDeviations.some((dev) => {
        if (dev.courier_id !== courierData.courier.id) return false
        if (dev.order_id !== selectedOrder.id) return false
        if (dev.resolved === true) return false
        if (selectedRouteStartTime && dev.created) {
          const devTime = new Date(dev.created).getTime()
          if (!isNaN(devTime) && devTime < selectedRouteStartTime) return false
        }
        return true
      })

      const isOffRoute =
        isSelectedOrderInActiveRoute &&
        (hasSystemDeviationEvent || nearest.distanceMeters > DEVIATION_THRESHOLD_METERS)
      const isDeviatedStrict = isSelectedOrderInActiveRoute && isOffRoute
      setDrawerDeviationInfo({
        isDeviated: isDeviatedStrict,
        meters: Math.round(nearest.distanceMeters),
      })

      // Detectar parada fora do local: >600m do cliente e >600m da base com velocidade <= 2 km/h
      const distToCust =
        cust?.lat && cust?.lng
          ? distanceMeters(courierPoint, { lat: cust.lat, lng: cust.lng })
          : 999
      const basePoint: LatLngPoint = {
        lat: selectedOrder.start_base_lat ? Number(selectedOrder.start_base_lat) : courierPoint.lat,
        lng: selectedOrder.start_base_lng ? Number(selectedOrder.start_base_lng) : courierPoint.lng,
      }
      const distToDrawerBase = distanceMeters(courierPoint, basePoint)
      const isSpeedZero = typeof courierData.speed === 'number' && courierData.speed <= 2
      const isFarFromCust = distToCust > UNEXPECTED_STOP_THRESHOLD_METERS
      const isFarFromDrawerBase =
        !selectedOrder.start_base_lat || distToDrawerBase > UNEXPECTED_STOP_THRESHOLD_METERS

      setDrawerUnexpectedStop(
        isSelectedOrderInActiveRoute && isSpeedZero && isFarFromCust && isFarFromDrawerBase,
      )

      if (isDeviatedStrict) {
        // LINHA VERMELHA do desvio: liga a posição atual do entregador ao ponto correspondente na rota azul
        const deviationPath = [courierPoint, nearest.nearestPoint]

        const deviationPolyline = new win.google.maps.Polyline({
          path: deviationPath,
          geodesic: true,
          strokeColor: '#EF4444', // LINHA VERMELHA DE DESVIO
          strokeOpacity: 1,
          strokeWeight: 4,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
              offset: '0',
              repeat: '10px',
            },
          ],
        })
        deviationPolyline.setMap(miniMap)
        drawerDeviationPolylineRef.current = deviationPolyline
      }
    } else {
      setDrawerDeviationInfo(null)
      setDrawerUnexpectedStop(false)
    }

    drawerBoundsRef.current = bounds
    if (!bounds.isEmpty()) {
      miniMap.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 })
    }

    return () => {
      isMounted = false
      clearTimeout(fallbackTimer)
      if (tilesListener && win.google?.maps?.event) {
        win.google.maps.event.removeListener(tilesListener)
      }
      if (idleListener && win.google?.maps?.event) {
        win.google.maps.event.removeListener(idleListener)
      }
      if (resizeObserver) {
        resizeObserver.disconnect()
      }
    }
  }, [
    isDrawerOpen,
    selectedOrder,
    mapsLoaded,
    mapsError,
    orderCourierInfo,
    streetRoute,
    recentDeviations,
  ])

  // Contact helpers
  const openWhatsApp = (phone?: string, text?: string) => {
    if (!phone) {
      toast({
        title: 'Telefone não cadastrado',
        description: 'Não há número de WhatsApp salvo para este contato.',
        variant: 'destructive',
      })
      return
    }
    const cleanNumber = phone.replace(/\D/g, '')
    const finalNumber = cleanNumber.startsWith('55') ? cleanNumber : `55${cleanNumber}`
    const defaultMsg = encodeURIComponent(text || 'Olá! Mensagem da Torre de Controle Rotaly.')
    window.open(`https://wa.me/${finalNumber}?text=${defaultMsg}`, '_blank')
  }

  const makePhoneCall = (phone?: string) => {
    if (!phone) {
      toast({
        title: 'Telefone não cadastrado',
        description: 'Não há telefone cadastrado para efetuar a chamada.',
        variant: 'destructive',
      })
      return
    }
    window.location.href = `tel:${phone.replace(/\D/g, '')}`
  }

  const copyTracking = (code: string) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/track/${code}`
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).catch(() => {})
    }
    setCopiedCode(code)
    toast({
      title: 'Link copiado com sucesso!',
      description: url,
    })
    setTimeout(() => setCopiedCode(null), 2500)
  }

  // Compartilhamento com o cliente via WhatsApp com mensagem pronta
  const shareTrackingViaWhatsApp = (order: OrderRecord) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/track/${order.tracking_code}`
    const custName = order.expand?.customer_id?.name || 'Cliente'
    const phone = order.expand?.customer_id?.phone || ''
    const text = `Olá ${custName}! Acompanhe sua entrega em tempo real: ${url}`

    if (!phone) {
      // Se não houver telefone salvo, abre wa.me apenas com o texto para escolha do contato
      const msgEncoded = encodeURIComponent(text)
      window.open(`https://wa.me/?text=${msgEncoded}`, '_blank')
      return
    }

    const cleanNumber = phone.replace(/\D/g, '')
    const finalNumber = cleanNumber.startsWith('55') ? cleanNumber : `55${cleanNumber}`
    const msgEncoded = encodeURIComponent(text)
    window.open(`https://wa.me/${finalNumber}?text=${msgEncoded}`, '_blank')
  }

  function formatVehicle(type?: string) {
    return getVehicleLabel(type)
  }

  function renderVehicleIcon(type?: string) {
    const norm = (type || '').toLowerCase().trim()
    if (norm === 'carro' || norm === 'car' || norm === 'van') {
      return <Car className="h-4 w-4 text-blue-400" />
    }
    if (norm === 'caminhao' || norm === 'caminhão' || norm === 'truck') {
      return <Truck className="h-4 w-4 text-purple-400" />
    }
    if (norm === 'bicicleta' || norm === 'bicycle' || norm === 'bike') {
      return <span className="text-sm select-none leading-none">🚲</span>
    }
    return <span className="text-sm select-none leading-none">🛵</span>
  }

  // Calculate ETA display consolidado com duplo ETA quando em rota ativa
  const getEtaDisplay = (order: OrderRecord) => {
    // Se o pedido tiver entregador associado com rota ativa, buscar informações na activeRoutesData
    const courierId = order.courier_id || order.expand?.courier_id?.id
    const routeInfo = courierId
      ? activeRoutesData.find((r) => r.courierId === courierId)
      : undefined

    if (routeInfo) {
      if (routeInfo.etaNextDeliveryTime && routeInfo.etaReturnBaseTime) {
        return `Entrega ~${routeInfo.etaNextDeliveryTime} • Volta à base ~${routeInfo.etaReturnBaseTime}`
      }
      if (routeInfo.etaReturnBaseTime && !routeInfo.etaNextDeliveryTime) {
        return `Retornando à base • Chegada ~${routeInfo.etaReturnBaseTime}`
      }
      if (routeInfo.etaNextDeliveryTime) {
        return `Entrega ~${routeInfo.etaNextDeliveryTime}`
      }
    }

    if (order.estimated_arrival) {
      const d = new Date(order.estimated_arrival)
      if (!isNaN(d.getTime())) {
        return `Entrega ~${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
      }
    }
    if (order.estimated_duration_minutes) {
      return `~${order.estimated_duration_minutes} min`
    }
    return '--:--'
  }

  return (
    <div className="space-y-6 text-slate-100 font-sans">
      {/* BANNER DE AVISO DE ENTREGA CONCLUÍDA EM TEMPO REAL */}
      {latestDeliveredNotice && (
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-900 border-2 border-emerald-400 p-4 sm:p-5 shadow-2xl animate-in slide-in-from-top-4 duration-300">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-emerald-500/30 border border-emerald-400 text-emerald-300 flex items-center justify-center shrink-0">
                <Check className="h-6 w-6 text-emerald-300 stroke-[3]" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-emerald-500 text-slate-950 font-black text-xs uppercase px-2 py-0.5">
                    NOVA ENTREGA CONCLUÍDA AGORA
                  </Badge>
                  <span className="font-mono text-xs font-bold text-emerald-200">
                    {latestDeliveredNotice.trackingCode}
                  </span>
                </div>
                <h3 className="text-base font-bold text-white mt-0.5">
                  Destinatário:{' '}
                  <span className="text-emerald-200">{latestDeliveredNotice.customerName}</span>
                  <span className="text-slate-300 text-xs font-normal ml-2">
                    • Finalizado por:{' '}
                    <strong className="text-white">{latestDeliveredNotice.courierName}</strong>
                  </span>
                </h3>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center">
              <Button
                size="sm"
                onClick={() => {
                  const targetOrder = orders.find((o) => o.id === latestDeliveredNotice.orderId)
                  if (targetOrder) handleOpenOrderDetails(targetOrder)
                }}
                className="h-8 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-lg shadow"
              >
                Ver Detalhes
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setLatestDeliveredNotice(null)}
                className="h-8 text-xs text-slate-300 hover:text-white hover:bg-emerald-800/40"
              >
                Fechar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* 1. VUUPT-INSPIRED HERO BANNER "ACOMPANHE EM TEMPO REAL" */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0A1128] via-[#0E1E4A] to-[#122B68] border border-[#1E2B58] p-5 sm:p-6 shadow-xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-1/3 -mb-8 w-48 h-48 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />

        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0052CC]/30 border border-[#60A5FA]/40 text-[#60A5FA] text-xs font-bold tracking-wide">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              <span>SISTEMA DE MONITORAMENTO LOGÍSTICO EM TEMPO REAL</span>
            </div>

            <div className="flex items-center gap-3">
              <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-heading">
                Torre de Controle
              </h1>
              <Badge className="bg-[#0052CC] text-white hover:bg-[#0052CC] font-bold text-xs uppercase px-2.5 py-0.5 shadow-sm">
                Rotaly • Dark Navy
              </Badge>
            </div>

            <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
              Painel estilo Kanban logístico (inspirado no modelo VUUPT): clique no card de cada
              cliente para abrir o drawer com o entregador responsável, rota e previsão de chegada
              em tempo real via PocketBase.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* View Switcher: Split / Kanban / Map */}
            <div className="bg-[#070D1E] p-1 rounded-xl border border-[#1E2B58] flex items-center gap-1">
              <button
                type="button"
                onClick={() => setActiveTab('split')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'split'
                    ? 'bg-[#0052CC] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span>Kanban + Mapa</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('kanban')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'kanban'
                    ? 'bg-[#0052CC] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                <Columns3 className="h-3.5 w-3.5" />
                <span>Apenas Kanban</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('map')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                  activeTab === 'map'
                    ? 'bg-[#0052CC] text-white shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
                }`}
              >
                <MapIcon className="h-3.5 w-3.5" />
                <span>Apenas Mapa</span>
              </button>
            </div>

            <div className="flex items-center text-xs text-slate-300 bg-[#070D1E]/80 border border-[#1E2B58] px-3 py-2 rounded-xl">
              <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
              <span>10s • {lastUpdated.toLocaleTimeString('pt-BR')}</span>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setIsLoading(true)
                fetchData().finally(() => setIsLoading(false))
              }}
              disabled={isLoading}
              className="h-9 gap-1.5 text-xs bg-[#070D1E] text-slate-200 border-[#1E2B58] hover:bg-[#121E46] hover:text-white rounded-xl"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
              Atualizar
            </Button>
          </div>
        </div>

        {/* Banner "Acompanhe em tempo real" pills */}
        <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-[#070D1E]/60 border border-slate-700/50 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Aguardando Início:</span>
            <span className="font-bold font-mono text-slate-200 text-sm">{metrics.pending}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-blue-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-blue-300 font-medium">Em Trânsito:</span>
            <span className="font-bold font-mono text-blue-400 text-sm">{metrics.inTransit}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-emerald-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-emerald-300 font-medium">Entregues hoje:</span>
            <span className="font-bold font-mono text-emerald-400 text-sm">
              {metrics.delivered}
            </span>
          </div>
          <div className="bg-[#070D1E]/60 border border-rose-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-rose-300 font-medium">Exceções / Falhas:</span>
            <span className="font-bold font-mono text-rose-400 text-sm">{metrics.issues}</span>
          </div>
        </div>
      </div>

      {/* 2. BARRA DE FILTROS & BUSCA RÁPIDA */}
      <div className="rounded-xl border border-[#1E2B58] bg-[#0A1128] p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            Filtros do Fluxo:
          </span>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="h-8 text-xs w-[160px] bg-[#070D1E] border-[#1E2B58] text-slate-200">
              <SelectValue placeholder="Coluna / Status" />
            </SelectTrigger>
            <SelectContent className="bg-[#0A1128] border-[#1E2B58] text-slate-200">
              <SelectItem value="all">Todas as Colunas</SelectItem>
              <SelectItem value="pending">Aguardando Início</SelectItem>
              <SelectItem value="in_transit">Em Trânsito</SelectItem>
              <SelectItem value="delivered">Entregue</SelectItem>
              <SelectItem value="issues">Exceções / Problemas</SelectItem>
            </SelectContent>
          </Select>

          <Select value={courierFilter} onValueChange={setCourierFilter}>
            <SelectTrigger className="h-8 text-xs w-[180px] bg-[#070D1E] border-[#1E2B58] text-slate-200">
              <SelectValue placeholder="Entregador" />
            </SelectTrigger>
            <SelectContent className="bg-[#0A1128] border-[#1E2B58] text-slate-200">
              <SelectItem value="all">Todos os Entregadores</SelectItem>
              {couriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name || c.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="relative min-w-[220px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
          <Input
            placeholder="Buscar por cliente, rastreio, rua..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 text-xs bg-[#070D1E] border-[#1E2B58] text-white placeholder:text-slate-500 rounded-lg focus:border-[#60A5FA]"
          />
        </div>
      </div>

      {/* 3. KANBAN LOGÍSTICO (COLUNAS HORIZONTAIS ESTILO VUUPT) */}
      {(activeTab === 'kanban' || activeTab === 'split') && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Columns3 className="h-4 w-4 text-[#60A5FA]" />
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
                Fluxo de Entregas por Status (Kanban VUUPT)
              </h2>
            </div>
            <span className="text-xs text-slate-400">
              Arraste lateralmente • {filteredOrders.length} cards carregados
            </span>
          </div>

          <div className="flex gap-4 overflow-x-auto pb-4 pt-1 snap-x scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {KANBAN_COLUMNS.map((col) => {
              const columnOrders = kanbanColumnsData[col.key]

              return (
                <div
                  key={col.key}
                  className={`w-[320px] sm:w-[340px] shrink-0 rounded-2xl border ${col.borderColor} ${col.columnBg} shadow-lg flex flex-col max-h-[720px] overflow-hidden`}
                >
                  {/* Cabeçalho colorido da coluna */}
                  <div className={`p-3.5 ${col.headerBg} flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shrink-0 shadow-sm"
                        style={{ backgroundColor: col.indicatorColor }}
                      />
                      <div>
                        <h3 className="font-heading text-sm font-bold text-white tracking-wide">
                          {col.title}
                        </h3>
                        <p className="text-[10px] text-slate-400">{col.subtitle}</p>
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={`text-xs font-mono font-bold ${col.badgeBg} ${col.badgeText} border-transparent`}
                    >
                      {columnOrders.length}
                    </Badge>
                  </div>

                  {/* Lista de Cards da Coluna */}
                  <div className="p-3 space-y-3 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-800">
                    {columnOrders.length === 0 ? (
                      <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-[#070D1E]/40">
                        Nenhuma entrega nesta etapa
                      </div>
                    ) : (
                      columnOrders.map((order) => {
                        const cust = order.expand?.customer_id
                        const courier = order.expand?.courier_id
                        const etaTime = getEtaDisplay(order)

                        // Styling per card based on column
                        const isRecentlyDelivered = latestDeliveredNotice?.orderId === order.id
                        const borderAccent = isRecentlyDelivered
                          ? 'border-l-4 border-l-emerald-400 ring-2 ring-emerald-400 animate-pulse'
                          : col.key === 'delivered'
                            ? 'border-l-4 border-l-emerald-500'
                            : col.key === 'issues'
                              ? 'border-l-4 border-l-rose-500'
                              : col.key === 'in_transit'
                                ? 'border-l-4 border-l-blue-500'
                                : 'border-l-4 border-l-slate-400'

                        const bgTint = isRecentlyDelivered
                          ? 'bg-emerald-950/80 hover:bg-emerald-900/90'
                          : col.key === 'delivered'
                            ? 'bg-[#0f2425]/90 hover:bg-[#133031]'
                            : col.key === 'issues'
                              ? 'bg-[#29131e]/90 hover:bg-[#341827]'
                              : col.key === 'in_transit'
                                ? 'bg-[#0f1f45]/90 hover:bg-[#132857]'
                                : 'bg-[#0e1738]/90 hover:bg-[#121e46]'

                        return (
                          <div
                            key={order.id}
                            onClick={() => handleOpenOrderDetails(order)}
                            className={`rounded-xl p-3.5 border border-slate-700/60 ${borderAccent} ${bgTint} cursor-pointer transition-all duration-200 shadow-md hover:shadow-xl hover:-translate-y-0.5 group`}
                          >
                            {/* Linha superior: Rastreio & ETA / Horário de Entrega */}
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs font-black text-[#60A5FA] group-hover:text-white transition">
                                {order.tracking_code}
                              </span>
                              <div className="flex items-center gap-1 text-[11px] text-slate-300 font-mono bg-slate-900/60 px-2 py-0.5 rounded-md border border-slate-700/50">
                                <Clock className="h-3 w-3 text-slate-400" />
                                <span>
                                  {order.status === 'delivered' && order.actual_arrival
                                    ? `Entregue às ${new Date(order.actual_arrival).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                                    : etaTime}
                                </span>
                              </div>
                            </div>

                            {/* Nome do Cliente */}
                            <div className="mt-2">
                              <h4 className="text-sm font-bold text-white truncate">
                                {cust?.name || 'Cliente sem nome'}
                              </h4>
                              <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                                <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                                <span>{cust?.address || 'Endereço não cadastrado'}</span>
                              </p>
                            </div>

                            {/* Informações do Entregador Responsável */}
                            <div className="mt-3 pt-2.5 border-t border-slate-700/50 flex items-center justify-between">
                              {courier ? (
                                <div className="flex items-center gap-1.5 text-xs text-slate-200">
                                  {renderVehicleIcon(courier.vehicle_type)}
                                  <span className="font-semibold truncate max-w-[150px]">
                                    {courier.name || courier.email}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-[11px] text-slate-500 italic">
                                  Sem entregador
                                </span>
                              )}

                              <div className="flex items-center gap-1">
                                {order.sequence && (
                                  <Badge
                                    variant="outline"
                                    className="text-[9px] px-1.5 py-0 bg-blue-500/20 text-[#60A5FA] border-blue-500/30 font-bold"
                                  >
                                    #{order.sequence}
                                  </Badge>
                                )}
                                <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition" />
                              </div>
                            </div>

                            {/* Badges de ocorrência se houver */}
                            {col.key === 'issues' && (
                              <div className="mt-2 text-[10px] text-rose-300 bg-rose-950/60 border border-rose-800/60 px-2 py-1 rounded font-medium truncate flex items-center gap-1">
                                <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
                                <span>
                                  {order.completion_reason === 'address_error' ||
                                  order.status === 'address_error'
                                    ? 'Erro de Endereço'
                                    : order.completion_reason === 'client_absent' ||
                                        order.status === 'client_absent'
                                      ? 'Cliente Ausente'
                                      : order.notes || 'Atenção necessária'}
                                </span>
                              </div>
                            )}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 4. MAPA DE TELEMETRIA EM TEMPO REAL */}
      {(activeTab === 'map' || activeTab === 'split') && (
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0A1128] overflow-hidden shadow-xl">
          <div className="p-4 bg-[#070D1E] border-b border-[#1E2B58] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-[#60A5FA]" />
              <h3 className="font-heading text-base font-bold text-white">
                Mapa de Rastreamento &amp; Frotas em Tempo Real
              </h3>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-blue-500 inline-block" />
                <span className="text-slate-300">Em Rota (no mapa)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
                <span className="text-slate-300">Disponível (na lista)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500 inline-block" />
                <span className="text-slate-300">Destino de Entrega</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 min-h-[460px]">
            {/* Mapa Interativo Principal: Google Maps nativo ou Canvas Vetorial de Contingência (LiveMap) */}
            <div className="relative w-full h-[400px] lg:h-[540px] bg-[#070D1E] overflow-hidden">
              {mapsLoaded && !mapsError ? (
                <>
                  <div ref={mapContainerRef} className="w-full h-full" />

                  {/* Abas sobre o mapa no canto superior direito */}
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5 bg-[#0A1128]/90 backdrop-blur-md p-1 rounded-xl border border-[#1E2B58] shadow-lg">
                    <button
                      type="button"
                      onClick={() => setMapDisplayMode('in_transit')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                        mapDisplayMode === 'in_transit'
                          ? 'bg-blue-600 text-white shadow'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      <span>🛵 Em Rota ({activeRouteCouriers.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setMapDisplayMode('delivered')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                        mapDisplayMode === 'delivered'
                          ? 'bg-emerald-600 text-white shadow'
                          : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                      }`}
                    >
                      <span>✓ Entregues ({metrics.delivered})</span>
                    </button>
                  </div>

                  {/* Painel de status no canto superior esquerdo do Google Maps */}
                  <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 max-w-[280px]">
                    <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                      <span className="font-semibold text-white truncate text-[11px]">
                        {mapDisplayMode === 'delivered'
                          ? `${metrics.delivered} entregas concluídas`
                          : `${activeRouteCouriers.length} entregadores em rota`}
                      </span>
                    </div>

                    {/* Alertas ativos na Torre: Desvios ou Paradas detectadas (dispensáveis) */}
                    {mapDisplayMode === 'in_transit' &&
                      !isDeviationBannerDismissed &&
                      activeRoutesData.some((r) => r.isDeviated) && (
                        <div className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/60 shadow-md text-[10.5px] font-bold text-rose-300 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <AlertOctagon className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                            <span className="truncate">
                              {activeRoutesData.filter((r) => r.isDeviated).length} desvio(s) de
                              rota
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsDeviationBannerDismissed(true)}
                            className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                    {mapDisplayMode === 'in_transit' &&
                      !isStopBannerDismissed &&
                      activeRoutesData.some((r) => r.isUnexpectedStop) && (
                        <div className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/60 shadow-md text-[10.5px] font-bold text-amber-300 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="truncate">
                              {activeRoutesData.filter((r) => r.isUnexpectedStop).length} parada(s)
                              fora
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsStopBannerDismissed(true)}
                            className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                    {/* Alertas de GPS desligado na Torre */}
                    {mapDisplayMode === 'in_transit' &&
                      activeRouteCouriers
                        .filter(
                          (c) =>
                            c.gps_status === 'disabled' &&
                            !dismissedGpsAlertIds.includes(`gps-${c.courier.id}`),
                        )
                        .map((c) => (
                          <div
                            key={`gps-banner-${c.courier.id}`}
                            className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/70 shadow-md text-[10.5px] font-bold text-rose-200 flex items-center justify-between gap-2 animate-pulse"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="text-sm shrink-0">📡</span>
                              <span className="truncate">
                                GPS desligado: {c.courier.name || c.courier.email}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedGpsAlertIds((prev) => [...prev, `gps-${c.courier.id}`])
                              }
                              className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                              title="Dispensar alerta"
                            >
                              ✕
                            </button>
                          </div>
                        ))}

                    {/* Alertas de Perda de sinal (>2 min) na Torre */}
                    {mapDisplayMode === 'in_transit' &&
                      activeRouteCouriers
                        .filter((c) => {
                          if (c.gps_status === 'disabled') return false
                          const locTime = c.location_timestamp
                            ? new Date(c.location_timestamp).getTime()
                            : 0
                          const isSignalLost =
                            c.gps_status === 'offline' ||
                            (locTime > 0 && Date.now() - locTime > 2 * 60 * 1000)
                          return (
                            isSignalLost && !dismissedGpsAlertIds.includes(`sig-${c.courier.id}`)
                          )
                        })
                        .map((c) => (
                          <div
                            key={`sig-banner-${c.courier.id}`}
                            className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/70 shadow-md text-[10.5px] font-bold text-amber-200 flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="text-sm shrink-0">📴</span>
                              <span className="truncate">
                                Perda de sinal: {c.courier.name || c.courier.email}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedGpsAlertIds((prev) => [...prev, `sig-${c.courier.id}`])
                              }
                              className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                              title="Dispensar alerta"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                  </div>

                  {/* Legenda explicativa enxuta e recolhível no rodapé do Google Maps nativo */}
                  <div className="absolute bottom-2.5 left-2.5 z-10 bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-xl text-[10px] text-slate-200 flex items-center gap-2 font-sans">
                    {mapDisplayMode === 'delivered' ? (
                      <>
                        <span className="flex items-center gap-1 font-medium">
                          <span className="h-2 w-2 rounded-full bg-[#10B981] inline-block shadow-sm" />
                          <span className="text-emerald-400 font-bold">Entregue</span>
                        </span>
                        <span className="border-l border-slate-700/80 pl-2 text-slate-400 font-mono text-[9.5px]">
                          Total: {metrics.delivered}
                        </span>
                      </>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="flex items-center gap-1 font-medium text-blue-300">
                            <span className="h-1.5 w-3 rounded-full bg-blue-600 inline-block" />
                            Rota
                          </span>
                          <span className="flex items-center gap-1 font-medium text-sky-400 border-l border-slate-700/80 pl-2">
                            <span className="h-1.5 w-3 rounded-full bg-[#60A5FA] border border-dashed border-[#2563EB] inline-block" />
                            Volta à base
                          </span>
                          <span className="flex items-center gap-1 font-medium text-rose-400 border-l border-slate-700/80 pl-2">
                            <span className="h-1.5 w-3 rounded-full bg-rose-500 inline-block" />
                            Desvio &gt;600m
                          </span>
                          <span className="border-l border-slate-700/80 pl-2 text-slate-300 flex items-center gap-1">
                            <span>🛵/🚗</span>
                            <span>Entregador</span>
                          </span>
                        </div>

                        {/* Botão de expansão para ver detalhes da legenda se desejado */}
                        <button
                          type="button"
                          onClick={() => setIsLegendExpanded(!isLegendExpanded)}
                          className="ml-1 text-slate-400 hover:text-white text-[9px] underline focus:outline-none"
                        >
                          {isLegendExpanded ? 'Menos' : 'Mais'}
                        </button>

                        {isLegendExpanded && (
                          <span className="border-l border-slate-700/80 pl-2 text-slate-400 flex items-center gap-1">
                            <span className="flex h-3 w-3 items-center justify-center rounded-full bg-[#FF6B35] text-[8px] font-bold text-white">
                              1
                            </span>
                            <span>Parada</span>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="relative w-full h-full flex flex-col">
                  {/* Abas sobre o mapa e botão Retry no canto superior direito do mapa vetorial */}
                  <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-[#0A1128]/90 backdrop-blur-md p-1 rounded-xl border border-[#1E2B58] shadow-lg">
                      <button
                        type="button"
                        onClick={() => setMapDisplayMode('in_transit')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          mapDisplayMode === 'in_transit'
                            ? 'bg-blue-600 text-white shadow'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                        }`}
                      >
                        <span>🛵 Em Rota ({activeRouteCouriers.length})</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setMapDisplayMode('delivered')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                          mapDisplayMode === 'delivered'
                            ? 'bg-emerald-600 text-white shadow'
                            : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                        }`}
                      >
                        <span>✓ Entregues ({metrics.delivered})</span>
                      </button>
                    </div>

                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleRetryMaps}
                      className="h-8 px-2.5 text-xs bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800 hover:text-white rounded-lg shadow-md gap-1.5 backdrop-blur"
                      title="Tentar carregar Google Maps novamente"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span className="hidden sm:inline">Tentar Google Maps</span>
                    </Button>
                  </div>

                  {/* Status e avisos no canto superior esquerdo também no Canvas vetorial */}
                  <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 max-w-[280px] pointer-events-auto">
                    <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                      <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                      <span className="font-semibold text-white truncate text-[11px]">
                        {mapDisplayMode === 'delivered'
                          ? `${metrics.delivered} entregas concluídas`
                          : `${activeRouteCouriers.length} entregadores em rota`}
                      </span>
                    </div>

                    {mapDisplayMode === 'in_transit' &&
                      !isDeviationBannerDismissed &&
                      activeRoutesData.some((r) => r.isDeviated) && (
                        <div className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/60 shadow-md text-[10.5px] font-bold text-rose-300 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <AlertOctagon className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                            <span className="truncate">
                              {activeRoutesData.filter((r) => r.isDeviated).length} desvio(s) de
                              rota
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsDeviationBannerDismissed(true)}
                            className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                    {mapDisplayMode === 'in_transit' &&
                      !isStopBannerDismissed &&
                      activeRoutesData.some((r) => r.isUnexpectedStop) && (
                        <div className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/60 shadow-md text-[10.5px] font-bold text-amber-300 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 truncate">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                            <span className="truncate">
                              {activeRoutesData.filter((r) => r.isUnexpectedStop).length} parada(s)
                              fora
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => setIsStopBannerDismissed(true)}
                            className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )}

                    {/* Alertas de GPS desligado no canvas */}
                    {mapDisplayMode === 'in_transit' &&
                      activeRouteCouriers
                        .filter(
                          (c) =>
                            c.gps_status === 'disabled' &&
                            !dismissedGpsAlertIds.includes(`gps-${c.courier.id}`),
                        )
                        .map((c) => (
                          <div
                            key={`canvas-gps-banner-${c.courier.id}`}
                            className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/70 shadow-md text-[10.5px] font-bold text-rose-200 flex items-center justify-between gap-2 animate-pulse"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="text-sm shrink-0">📡</span>
                              <span className="truncate">
                                GPS desligado: {c.courier.name || c.courier.email}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedGpsAlertIds((prev) => [...prev, `gps-${c.courier.id}`])
                              }
                              className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                              title="Dispensar alerta"
                            >
                              ✕
                            </button>
                          </div>
                        ))}

                    {/* Alertas de Perda de sinal (>2 min) no canvas */}
                    {mapDisplayMode === 'in_transit' &&
                      activeRouteCouriers
                        .filter((c) => {
                          if (c.gps_status === 'disabled') return false
                          const locTime = c.location_timestamp
                            ? new Date(c.location_timestamp).getTime()
                            : 0
                          const isSignalLost =
                            c.gps_status === 'offline' ||
                            (locTime > 0 && Date.now() - locTime > 2 * 60 * 1000)
                          return (
                            isSignalLost && !dismissedGpsAlertIds.includes(`sig-${c.courier.id}`)
                          )
                        })
                        .map((c) => (
                          <div
                            key={`canvas-sig-banner-${c.courier.id}`}
                            className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/70 shadow-md text-[10.5px] font-bold text-amber-200 flex items-center justify-between gap-2"
                          >
                            <div className="flex items-center gap-1.5 truncate">
                              <span className="text-sm shrink-0">📴</span>
                              <span className="truncate">
                                Perda de sinal: {c.courier.name || c.courier.email}
                              </span>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setDismissedGpsAlertIds((prev) => [...prev, `sig-${c.courier.id}`])
                              }
                              className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                              title="Dispensar alerta"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                  </div>

                  {/* Canvas vetorial de contingência idêntico ao LiveMap.tsx com marcadores interativos e rotas viárias */}
                  <LiveMap
                    markers={controlTowerMapMarkers}
                    center={
                      activeRouteCouriers[0]
                        ? { lat: activeRouteCouriers[0].lat, lng: activeRouteCouriers[0].lng }
                        : { lat: -22.906847, lng: -43.172896 }
                    }
                    zoom={13}
                    height="100%"
                    routeLines={
                      mapDisplayMode === 'delivered'
                        ? []
                        : activeRoutesData
                            .filter((routeData) => Boolean(routeData.order?.route_started))
                            .flatMap((routeData) => {
                              const lines: any[] = []
                              const fPoints = routeData.forwardPoints || routeData.points
                              if (fPoints && fPoints.length >= 2) {
                                lines.push({
                                  origin: fPoints[0] || routeData.courierPos,
                                  destination: routeData.custPos,
                                  courierPosition: routeData.courierPos,
                                  streetCoordinates: fPoints,
                                  isDeviated: Boolean(
                                    routeData.order?.route_started && routeData.isDeviated,
                                  ),
                                  isReturnLeg: false,
                                })
                              }
                              const retPoints = routeData.returnPoints
                              if (retPoints && retPoints.length >= 2) {
                                lines.push({
                                  origin: retPoints[0],
                                  destination: retPoints[retPoints.length - 1],
                                  streetCoordinates: retPoints,
                                  isDeviated: false,
                                  isReturnLeg: true,
                                })
                              }
                              return lines
                            })
                    }
                    onSelectMarker={(m) => {
                      if (m.type === 'courier') {
                        const courierId = m.id.replace('courier-', '')
                        const targetCourier = couriers.find((c) => c.id === courierId)
                        if (targetCourier) setSelectedCourier(targetCourier)
                      } else {
                        const orderId = m.id.replace('order-', '')
                        const targetOrder = orders.find((o) => o.id === orderId)
                        if (targetOrder) handleOpenOrderDetails(targetOrder)
                      }
                    }}
                    customLegend={
                      mapDisplayMode === 'delivered' ? (
                        <div className="flex items-center gap-2 text-[10px] text-slate-200">
                          <div className="flex items-center gap-1">
                            <span className="h-2 w-2 rounded-full bg-[#10B981] inline-block shadow-sm"></span>
                            <span className="font-semibold text-emerald-400">Entregue</span>
                          </div>
                          <div className="border-l border-slate-700 pl-2 text-slate-400 font-mono text-[9.5px]">
                            Total: {metrics.delivered}
                          </div>
                        </div>
                      ) : undefined
                    }
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 5. DRAWER / SHEET DE DETALHE EM TEMPO REAL AO CLICAR NO CARD DO CLIENTE */}
      <Sheet open={isDrawerOpen} onOpenChange={setIsDrawerOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md md:max-w-lg bg-[#0A1128] border-l border-[#1E2B58] text-slate-100 p-0 flex flex-col overflow-hidden"
        >
          {selectedOrder && (
            <>
              {/* Drawer Header */}
              <div className="p-5 border-b border-[#1E2B58] bg-[#070D1E]/80">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-black text-[#60A5FA]">
                        {selectedOrder.tracking_code}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-slate-400 hover:text-white"
                        title="Copiar link de rastreio"
                        onClick={() => copyTracking(selectedOrder.tracking_code)}
                      >
                        {copiedCode === selectedOrder.tracking_code ? (
                          <Check className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                    <SheetTitle className="text-xl font-black text-white font-heading mt-1">
                      {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                    </SheetTitle>
                    <SheetDescription className="text-xs text-slate-400 mt-0.5">
                      Monitoramento em tempo real com GPS e trajeto
                    </SheetDescription>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {selectedOrder.status === 'delivered' ? (
                      <Badge className="bg-emerald-600 text-white font-bold text-xs">
                        ✓ Entregue
                      </Badge>
                    ) : selectedOrder.status === 'in_transit' || selectedOrder.route_started ? (
                      <Badge className="bg-blue-600 text-white font-bold text-xs animate-pulse">
                        🛵 Em Trânsito
                      </Badge>
                    ) : selectedOrder.status === 'address_error' ||
                      selectedOrder.status === 'client_absent' ? (
                      <Badge className="bg-rose-600 text-white font-bold text-xs">
                        ⚠️ Ocorrência
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="border-slate-600 text-slate-300 font-bold text-xs"
                      >
                        Aguardando Início
                      </Badge>
                    )}
                  </div>
                </div>
              </div>

              {/* Drawer Body (Scrollable) */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 scrollbar-thin scrollbar-thumb-slate-800">
                {/* CARD 1: QUAL ENTREGADOR ESTÁ COM A ENTREGA */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Truck className="h-3.5 w-3.5 text-[#60A5FA]" />
                      Entregador Responsável
                    </span>
                    {orderCourierInfo?.hasRouteStarted && (
                      <span className="text-[10px] text-blue-400 font-bold bg-blue-500/10 px-2 py-0.5 rounded-full border border-blue-500/30">
                        GPS Ativo
                      </span>
                    )}
                  </div>

                  {orderCourierInfo ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="h-11 w-11 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center text-blue-300 font-bold text-sm">
                            {orderCourierInfo.courier.name
                              ? orderCourierInfo.courier.name.slice(0, 2).toUpperCase()
                              : 'EN'}
                          </div>
                          <div>
                            <h4 className="font-bold text-white text-sm">
                              {orderCourierInfo.courier.name || orderCourierInfo.courier.email}
                            </h4>
                            <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                              {renderVehicleIcon(orderCourierInfo.vehicle)}
                              <span>{formatVehicle(orderCourierInfo.vehicle)}</span>
                              <span>
                                • Placa: {orderCourierInfo.courier.vehicle_plate || 'S/N'}
                              </span>
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Botões de Ação Imediata: WhatsApp & Ligação */}
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() =>
                            openWhatsApp(
                              orderCourierInfo.courier.phone,
                              `Olá ${orderCourierInfo.courier.name || ''}, sobre a entrega ${selectedOrder.tracking_code} do cliente ${selectedOrder.expand?.customer_id?.name || ''}:`,
                            )
                          }
                          className="h-9 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-xl shadow-sm"
                        >
                          <MessageCircle className="h-4 w-4" />
                          WhatsApp
                        </Button>

                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => makePhoneCall(orderCourierInfo.courier.phone)}
                          className="h-9 border-blue-500/40 bg-blue-950/40 hover:bg-blue-900/60 text-blue-300 hover:text-white font-bold text-xs gap-1.5 rounded-xl"
                        >
                          <Phone className="h-4 w-4" />
                          Ligar
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="p-3 text-center text-xs text-slate-400 border border-dashed border-slate-700 rounded-xl bg-[#070D1E]/40">
                      Nenhum entregador atribuído ainda a este pedido.
                    </div>
                  )}
                </div>

                {/* CARD 2: PREVISÃO DE CHEGADA (ETA) & STATUS */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-blue-500/40 bg-[#0E1F47] p-3.5 space-y-1">
                    <span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1">
                      <Clock className="h-3.5 w-3.5 text-blue-400" />
                      Previsão &amp; Volta à Base
                    </span>
                    <p className="text-base sm:text-lg font-black text-white font-mono leading-tight">
                      {(() => {
                        const rInfo = activeRoutesData.find(
                          (r) =>
                            r.orderId === selectedOrder.id ||
                            r.courierId === selectedOrder.courier_id,
                        )
                        if (rInfo?.etaNextDeliveryTime && rInfo?.etaReturnBaseTime) {
                          return `Entrega ~${rInfo.etaNextDeliveryTime}`
                        }
                        if (rInfo?.etaReturnBaseTime && !rInfo?.etaNextDeliveryTime) {
                          return `Chegada Base ~${rInfo.etaReturnBaseTime}`
                        }
                        if (rInfo?.etaNextDeliveryTime) {
                          return `Entrega ~${rInfo.etaNextDeliveryTime}`
                        }
                        return getEtaDisplay(selectedOrder)
                      })()}
                    </p>
                    <p className="text-[10px] text-slate-300">
                      {(() => {
                        const rInfo = activeRoutesData.find(
                          (r) =>
                            r.orderId === selectedOrder.id ||
                            r.courierId === selectedOrder.courier_id,
                        )
                        if (rInfo?.etaReturnBaseTime) {
                          return `🏢 Volta à base ~${rInfo.etaReturnBaseTime}`
                        }
                        return selectedOrder.estimated_duration_minutes
                          ? `Trajeto de aprox. ${selectedOrder.estimated_duration_minutes} min`
                          : 'Calculada com velocidade real do GPS'
                      })()}
                    </p>
                  </div>

                  <div className="rounded-xl border border-[#1E2B58] bg-[#0E1738] p-3.5 space-y-1">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                      <Navigation className="h-3.5 w-3.5 text-orange-400" />
                      Posição na Rota
                    </span>
                    <p className="text-xl font-black text-white font-mono">
                      {selectedOrder.sequence ? `Parada #${selectedOrder.sequence}` : 'Fila Geral'}
                    </p>
                    <p className="text-[10px] text-slate-400">
                      {selectedOrder.distance_km ? `${selectedOrder.distance_km} km` : 'Em rota'}
                    </p>
                  </div>
                </div>

                {/* CARD 3: DADOS DO CLIENTE & ENDEREÇO DE ENTREGA */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <MapPin className="h-3.5 w-3.5 text-[#FF6B35]" />
                      Destino da Entrega
                    </span>
                    {selectedOrder.expand?.customer_id?.phone && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          openWhatsApp(
                            selectedOrder.expand?.customer_id?.phone,
                            `Olá ${selectedOrder.expand?.customer_id?.name || ''}! Somos da Rotaly acompanhando sua entrega cód ${selectedOrder.tracking_code}.`,
                          )
                        }
                        className="h-6 text-[11px] text-emerald-400 hover:bg-emerald-500/10 px-2 font-bold"
                      >
                        <MessageCircle className="h-3 w-3 mr-1" />
                        Falar c/ Cliente
                      </Button>
                    )}
                  </div>

                  <div>
                    <h5 className="font-bold text-white text-sm">
                      {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                    </h5>
                    <p className="text-xs text-slate-300 mt-1 leading-relaxed">
                      {selectedOrder.expand?.customer_id?.address || 'Endereço não informado'}
                    </p>
                    {selectedOrder.expand?.customer_id?.phone && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Telefone: {selectedOrder.expand?.customer_id?.phone}
                      </p>
                    )}
                  </div>
                </div>

                {/* CARD 4: MINI-MAPA DA ROTA DO ENTREGADOR */}
                <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                      <Compass className="h-3.5 w-3.5 text-[#60A5FA]" />
                      Posição no Mapa &amp; Trajeto
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">
                      {orderCourierInfo?.lat.toFixed(4)}, {orderCourierInfo?.lng.toFixed(4)}
                    </span>
                  </div>

                  {/* Badges de alerta em tempo real no topo do card do mini-mapa */}
                  {(drawerDeviationInfo?.isDeviated || drawerUnexpectedStop) && (
                    <div className="flex flex-wrap items-center gap-2">
                      {drawerDeviationInfo?.isDeviated && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-500/60 text-rose-300 text-xs font-bold animate-pulse">
                          <AlertOctagon className="h-3.5 w-3.5 text-rose-400" />
                          <span>
                            DESVIO DETECTADO ({drawerDeviationInfo.meters} metros da rota indicada)
                          </span>
                        </div>
                      )}
                      {drawerUnexpectedStop && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/60 text-amber-300 text-xs font-bold">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-400" />
                          <span>PARADA FORA DO LOCAL (Entregador parado fora do destino)</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* SEÇÃO DESTACADA: COMPARTILHAMENTO DO LINK DE RASTREIO DO CLIENTE */}
                  <div className="rounded-xl border border-blue-500/30 bg-gradient-to-r from-blue-950/70 via-[#0B1A40] to-slate-900 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                        <Share2 className="h-3.5 w-3.5 text-blue-400" />
                        Link de Acompanhamento do Cliente
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        /track/{selectedOrder.tracking_code}
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-0.5">
                      <Button
                        size="sm"
                        onClick={() => copyTracking(selectedOrder.tracking_code)}
                        className={`h-8 text-xs font-bold gap-1.5 rounded-lg transition-all ${
                          copiedCode === selectedOrder.tracking_code
                            ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm'
                            : 'bg-blue-600 hover:bg-blue-700 text-white shadow-brand'
                        }`}
                        title="Copiar URL pública completa para a área de transferência"
                      >
                        {copiedCode === selectedOrder.tracking_code ? (
                          <>
                            <Check className="h-3.5 w-3.5 text-white" />
                            <span>Link Copiado!</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3.5 w-3.5" />
                            <span>Copiar Link de Acompanhamento</span>
                          </>
                        )}
                      </Button>

                      <Button
                        size="sm"
                        onClick={() => shareTrackingViaWhatsApp(selectedOrder)}
                        className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs gap-1.5 rounded-lg shadow-sm"
                        title="Enviar link formatado diretamente para o WhatsApp do cliente"
                      >
                        <MessageCircle className="h-3.5 w-3.5" />
                        <span>Enviar por WhatsApp</span>
                      </Button>
                    </div>
                  </div>

                  {/* AVALIAÇÃO DO CLIENTE (SE HOUVER REGISTRO EM reviews) */}
                  {drawerReview && (
                    <div className="rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-950/40 via-[#1a1408] to-slate-950 p-3.5 space-y-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-amber-300 uppercase tracking-wider flex items-center gap-1.5">
                          <Star className="h-3.5 w-3.5 text-amber-400 fill-amber-400" />
                          Avaliação do Cliente
                        </span>
                        {drawerReview.created && (
                          <span className="text-[10px] text-slate-400">
                            {new Date(drawerReview.created).toLocaleDateString('pt-BR', {
                              day: '2-digit',
                              month: '2-digit',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        )}
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            Nota Entregador:
                          </span>
                          <div className="flex items-center gap-1">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-3 w-3 ${
                                    star <= (drawerReview.courier_rating || 0)
                                      ? 'text-amber-400 fill-amber-400'
                                      : 'text-slate-600'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="font-bold text-white text-xs ml-1 font-mono">
                              {drawerReview.courier_rating}/5
                            </span>
                          </div>
                        </div>

                        <div className="p-2 rounded-lg bg-slate-900/80 border border-slate-800">
                          <span className="text-[10px] text-slate-400 block mb-0.5">
                            Nota Loja:
                          </span>
                          <div className="flex items-center gap-1">
                            <div className="flex">
                              {[1, 2, 3, 4, 5].map((star) => (
                                <Star
                                  key={star}
                                  className={`h-3 w-3 ${
                                    star <= (drawerReview.seller_rating || 0)
                                      ? 'text-amber-400 fill-amber-400'
                                      : 'text-slate-600'
                                  }`}
                                />
                              ))}
                            </div>
                            <span className="font-bold text-white text-xs ml-1 font-mono">
                              {drawerReview.seller_rating}/5
                            </span>
                          </div>
                        </div>
                      </div>

                      {drawerReview.comment && (
                        <div className="p-2.5 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-200 text-xs italic">
                          &ldquo;{drawerReview.comment}&rdquo;
                          {drawerReview.customer_name && (
                            <span className="block not-italic text-[10px] text-slate-400 mt-1 text-right font-medium">
                              — {drawerReview.customer_name}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="relative w-full h-[250px] rounded-xl overflow-hidden border border-[#1E2B58] bg-[#070D1E]">
                    {/* Google Mini Map Container (visível SOMENTE se mapsLoaded && !mapsError && !drawerMapFailed && drawerTilesLoaded) */}
                    <div
                      ref={drawerMiniMapRef}
                      className={`w-full h-full ${
                        mapsLoaded && !mapsError && !drawerMapFailed && drawerTilesLoaded
                          ? 'block'
                          : 'hidden'
                      }`}
                    />

                    {/* Fallback Vetorial Interativo com Ruas Reais OSRM, Linha Azul e Linha Vermelha de Desvio: ativo quando Google não renderizou ou falhou */}
                    {(!mapsLoaded || mapsError || drawerMapFailed || !drawerTilesLoaded) &&
                      (() => {
                        const cust = selectedOrder.expand?.customer_id
                        const baseLat = selectedOrder.start_base_lat
                          ? Number(selectedOrder.start_base_lat)
                          : cust?.lat
                            ? Number(cust.lat)
                            : -22.906847
                        const baseLng = selectedOrder.start_base_lng
                          ? Number(selectedOrder.start_base_lng)
                          : cust?.lng
                            ? Number(cust.lng)
                            : -43.172896
                        const clientLat = cust?.lat ? Number(cust.lat) : baseLat
                        const clientLng = cust?.lng ? Number(cust.lng) : baseLng

                        // Posição do entregador se houver telemetria válida
                        const courierLat =
                          typeof orderCourierInfo?.lat === 'number'
                            ? orderCourierInfo.lat
                            : (baseLat + clientLat) / 2
                        const courierLng =
                          typeof orderCourierInfo?.lng === 'number'
                            ? orderCourierInfo.lng
                            : (baseLng + clientLng) / 2

                        // Coordenadas da rota real (ou pontos interpolados de rua)
                        const routeCoords: LatLngPoint[] =
                          streetRoute && streetRoute.coordinates.length >= 2
                            ? streetRoute.coordinates
                            : [
                                { lat: baseLat, lng: baseLng },
                                { lat: baseLat + 0.008, lng: baseLng + 0.004 },
                                { lat: baseLat + 0.016, lng: baseLng + 0.018 },
                                { lat: clientLat - 0.009, lng: clientLng - 0.012 },
                                { lat: clientLat, lng: clientLng },
                              ]

                        // Cálculo de bounding box para projeção SVG no canvas
                        const allLats = [
                          ...routeCoords.map((c) => c.lat),
                          baseLat,
                          clientLat,
                          courierLat,
                        ]
                        const allLngs = [
                          ...routeCoords.map((c) => c.lng),
                          baseLng,
                          clientLng,
                          courierLng,
                        ]
                        const minLat = Math.min(...allLats)
                        const maxLat = Math.max(...allLats)
                        const minLng = Math.min(...allLngs)
                        const maxLng = Math.max(...allLngs)

                        const latSpan = Math.max(maxLat - minLat, 0.004)
                        const lngSpan = Math.max(maxLng - minLng, 0.004)

                        // Função de projeção lat/lng -> porcentagem (%) no canvas com margem de 10%
                        const padPercent = 12
                        const toCanvas = (lat: number, lng: number) => {
                          const x = padPercent + ((lng - minLng) / lngSpan) * (100 - 2 * padPercent)
                          // Inversão do eixo Y (latitude sobe para o norte / topo do mapa)
                          const y =
                            100 - padPercent - ((lat - minLat) / latSpan) * (100 - 2 * padPercent)
                          return {
                            x: Math.max(4, Math.min(96, x)),
                            y: Math.max(4, Math.min(96, y)),
                          }
                        }

                        // Gerar string SVG Path com o percurso real pelas ruas (LINHA AZUL)
                        const blueSvgPath = routeCoords
                          .map((c, i) => {
                            const p = toCanvas(c.lat, c.lng)
                            return `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`
                          })
                          .join(' ')

                        // Identificar se o entregador está em desvio (coleção off_route_events ou distância > DEVIATION_THRESHOLD_METERS)
                        // REQUISITO: Apenas se selectedOrder.status === 'in_transit' && selectedOrder.route_started === true
                        const isSelectedOrderInActiveRoute =
                          selectedOrder.status === 'in_transit' &&
                          selectedOrder.route_started === true

                        const courierPoint: LatLngPoint = { lat: courierLat, lng: courierLng }
                        const nearest = findNearestPointOnRoute(courierPoint, routeCoords)
                        const selectedRouteStartTime = selectedOrder.route_started_at
                          ? new Date(selectedOrder.route_started_at).getTime()
                          : 0
                        const hasDeviationFlag =
                          isSelectedOrderInActiveRoute &&
                          recentDeviations.some((dev) => {
                            if (dev.courier_id !== orderCourierInfo?.courier?.id) return false
                            if (dev.order_id !== selectedOrder.id) return false
                            if (dev.resolved === true) return false
                            if (selectedRouteStartTime && dev.created) {
                              const devTime = new Date(dev.created).getTime()
                              if (!isNaN(devTime) && devTime < selectedRouteStartTime) return false
                            }
                            return true
                          })
                        const isDeviated =
                          isSelectedOrderInActiveRoute &&
                          orderCourierInfo?.hasRouteStarted &&
                          (hasDeviationFlag || nearest.distanceMeters > DEVIATION_THRESHOLD_METERS)

                        const courierPos = toCanvas(courierLat, courierLng)
                        const nearestPos = toCanvas(
                          nearest.nearestPoint.lat,
                          nearest.nearestPoint.lng,
                        )
                        const basePos = toCanvas(baseLat, baseLng)
                        const clientPos = toCanvas(clientLat, clientLng)

                        return (
                          <div className="relative w-full h-full flex flex-col justify-between p-2.5 bg-gradient-to-br from-slate-950 via-[#071126] to-[#040915] text-white select-none overflow-hidden">
                            {/* Malha de ruas vetorial estilizada (map tile feeling) */}
                            <div className="absolute inset-0 opacity-20 pointer-events-none bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px]" />

                            {/* SVG do Percurso Real com Ruas (LINHA AZUL) + Desvio (LINHA VERMELHA) */}
                            <svg
                              viewBox="0 0 100 100"
                              preserveAspectRatio="none"
                              className="absolute inset-0 w-full h-full pointer-events-none z-0"
                            >
                              <defs>
                                {/* Efeito glow para a linha azul */}
                                <filter id="blue-glow" x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow
                                    dx="0"
                                    dy="0"
                                    stdDeviation="1"
                                    floodColor="#3B82F6"
                                    floodOpacity="0.8"
                                  />
                                </filter>
                                {/* Efeito glow para a linha vermelha */}
                                <filter id="red-glow" x="-20%" y="-20%" width="140%" height="140%">
                                  <feDropShadow
                                    dx="0"
                                    dy="0"
                                    stdDeviation="1.5"
                                    floodColor="#EF4444"
                                    floodOpacity="0.9"
                                  />
                                </filter>
                              </defs>

                              {/* LINHA AZUL: Trajeto Viário Indicado pelo Sistema */}
                              {blueSvgPath && (
                                <>
                                  {/* Traçado de fundo largo para contraste de rua */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke="#1E3A8A"
                                    strokeWidth="4"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    opacity="0.8"
                                  />
                                  {/* Traçado principal azul brilhante */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke="#2563EB"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    filter="url(#blue-glow)"
                                  />
                                  {/* Linha interna guia ciano */}
                                  <path
                                    d={blueSvgPath}
                                    fill="none"
                                    stroke="#60A5FA"
                                    strokeWidth="0.8"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </>
                              )}

                              {/* LINHA VERMELHA: Caso o entregador faça um desvio de rota */}
                              {isDeviated && (
                                <>
                                  {/* Linha de desvio conectando a posição do entregador até o ponto de retorno na rota */}
                                  <line
                                    x1={courierPos.x}
                                    y1={courierPos.y}
                                    x2={nearestPos.x}
                                    y2={nearestPos.y}
                                    stroke="#EF4444"
                                    strokeWidth="2.5"
                                    strokeDasharray="2,1.5"
                                    strokeLinecap="round"
                                    filter="url(#red-glow)"
                                  />
                                  {/* Marcador circular no ponto onde o entregador saiu da rota */}
                                  <circle
                                    cx={nearestPos.x}
                                    cy={nearestPos.y}
                                    r="1.8"
                                    fill="#EF4444"
                                    stroke="#FFFFFF"
                                    strokeWidth="0.5"
                                  />
                                </>
                              )}
                            </svg>

                            {/* Top bar do mini-mapa com tags de Trajeto Real, Alerta de Desvio e Retry */}
                            <div className="relative z-10 flex items-center justify-between text-[11px] gap-2">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-950/90 border border-blue-500/40 text-blue-300 font-bold text-[10px]">
                                  <Route className="h-3 w-3 text-blue-400" />
                                  {streetRoute?.isRealStreetRoute
                                    ? `Trajeto Viário Real (${streetRoute.coordinates.length} nós)`
                                    : 'Trajeto de Ruas'}
                                </span>

                                {isDeviated ? (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-rose-950/90 border border-rose-500/60 text-rose-300 font-bold text-[10px] animate-pulse">
                                    <AlertOctagon className="h-3 w-3 text-rose-400" />
                                    DESVIO DETECTADO ({Math.round(nearest.distanceMeters)}m)
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-950/80 border border-emerald-500/30 text-emerald-300 text-[10px]">
                                    <ShieldCheck className="h-3 w-3 text-emerald-400" />
                                    Na rota indicada
                                  </span>
                                )}
                              </div>

                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={handleRetryMaps}
                                className="h-6 px-2 text-[10px] bg-slate-800/90 hover:bg-slate-700 text-slate-200 border border-slate-700 gap-1 rounded-md shrink-0"
                                title="Tentar carregar Google Maps nativo"
                              >
                                <RefreshCw className="h-3 w-3" />
                                <span>Tentar Google Maps</span>
                              </Button>
                            </div>

                            {/* Pontos Marcadores no Canvas Vetorial */}
                            <div className="relative w-full flex-1 pointer-events-none">
                              {/* 1. Base de Partida 🟢 */}
                              <div
                                style={{ left: `${basePos.x}%`, top: `${basePos.y}%` }}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto"
                              >
                                <div className="h-6 w-6 rounded-full bg-emerald-500/25 border-2 border-emerald-400 text-emerald-300 flex items-center justify-center text-[10px] shadow-lg shadow-emerald-500/30">
                                  🟢
                                </div>
                                <span className="mt-0.5 px-1.5 py-0.2 rounded bg-slate-900/90 border border-slate-800 text-[8px] font-bold text-emerald-300 whitespace-nowrap shadow">
                                  {selectedOrder.start_base_name || 'Partida'}
                                </span>
                              </div>

                              {/* 2. Entregador 🛵 (Com indicador de desvio em vermelho se aplicável) */}
                              {orderCourierInfo && (
                                <div
                                  style={{ left: `${courierPos.x}%`, top: `${courierPos.y}%` }}
                                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto z-20"
                                >
                                  {isDeviated && (
                                    <span className="absolute -top-3 px-1 py-0.2 rounded bg-rose-600 text-white text-[7px] font-extrabold uppercase tracking-wider animate-bounce shadow">
                                      Desvio
                                    </span>
                                  )}
                                  <span
                                    className={`absolute -inset-1 rounded-full animate-ping ${
                                      isDeviated ? 'bg-rose-500/50' : 'bg-blue-400/40'
                                    }`}
                                  />
                                  <div
                                    className={`h-7 w-7 rounded-full border-2 text-white flex items-center justify-center text-[13px] shadow-lg ${
                                      isDeviated
                                        ? 'bg-rose-600 border-rose-300 shadow-rose-500/50'
                                        : 'bg-blue-600 border-blue-300 shadow-blue-500/50'
                                    }`}
                                  >
                                    {getVehicleEmoji(orderCourierInfo.courier?.vehicle_type)}
                                  </div>
                                  <span
                                    className={`mt-0.5 px-1.5 py-0.2 rounded text-[8px] font-bold whitespace-nowrap shadow border ${
                                      isDeviated
                                        ? 'bg-rose-950/95 border-rose-500 text-rose-200'
                                        : 'bg-blue-950/95 border-blue-500 text-blue-200'
                                    }`}
                                  >
                                    {orderCourierInfo.courier?.name
                                      ? orderCourierInfo.courier.name.split(' ')[0]
                                      : 'Entregador'}
                                    {orderCourierInfo.speed
                                      ? ` • ${orderCourierInfo.speed}km/h`
                                      : ''}
                                  </span>
                                </div>
                              )}

                              {/* 3. Cliente Destino 🏁 com Badge de Ordem de entrega e nome completo */}
                              <div
                                style={{ left: `${clientPos.x}%`, top: `${clientPos.y}%` }}
                                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-auto"
                              >
                                {typeof selectedOrder.sequence === 'number' &&
                                  selectedOrder.sequence > 0 && (
                                    <span className="absolute -top-2 -right-2 z-10 flex h-3.5 min-w-3.5 px-1 items-center justify-center rounded-full bg-white text-[#FF6B35] text-[8px] font-black shadow border border-[#FF6B35]">
                                      {selectedOrder.sequence}
                                    </span>
                                  )}
                                <div className="h-6 w-6 rounded-full bg-orange-500/25 border-2 border-orange-400 text-orange-300 flex items-center justify-center text-[10px] shadow-lg shadow-orange-500/30">
                                  🏁
                                </div>
                                <span className="mt-0.5 px-1.5 py-0.2 rounded bg-slate-900/95 border border-[#1E2B58] text-[8px] font-bold text-white whitespace-nowrap shadow max-w-[120px] truncate">
                                  {selectedOrder.sequence ? `#${selectedOrder.sequence} ` : ''}
                                  {selectedOrder.expand?.customer_id?.name || 'Cliente'}
                                </span>
                              </div>
                            </div>

                            {/* Barra inferior: dados de trajeto real e legenda explicativa das cores */}
                            <div className="relative z-10 bg-slate-900/95 border border-slate-800/80 rounded-lg p-1.5 px-2 text-[10px] text-slate-300 flex items-center justify-between">
                              <span className="truncate max-w-[210px] text-slate-300">
                                🏁{' '}
                                {selectedOrder.expand?.customer_id?.address || 'Destino da Entrega'}
                              </span>
                              <div className="flex items-center gap-1.5 shrink-0 ml-1">
                                {isLoadingStreetRoute && (
                                  <span className="text-[9px] text-blue-300 flex items-center gap-1">
                                    <RefreshCw className="h-2.5 w-2.5 animate-spin" /> Ruas...
                                  </span>
                                )}
                                <span className="font-mono text-blue-300 font-bold">
                                  {getEtaDisplay(selectedOrder)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )
                      })()}
                  </div>

                  {/* Legenda explicativa com as linhas AZUL e VERMELHA e símbolos no drawer */}
                  <div className="flex flex-wrap items-center justify-between text-[10px] text-slate-300 pt-2 border-t border-[#1E2B58] gap-2 font-sans">
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-1.5 w-4 rounded-full bg-blue-500 shadow-[0_0_8px_#3b82f6] inline-block" />
                      <span className="text-blue-300 font-bold">Linha Azul:</span> Rota Indicada
                      (Ruas)
                    </span>
                    <span className="flex items-center gap-1.5 font-medium">
                      <span className="h-1.5 w-4 rounded-full bg-rose-500 shadow-[0_0_8px_#ef4444] inline-block" />
                      <span className="text-rose-400 font-bold">Linha Vermelha:</span> Desvio
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <span>🛵 🚗 🚛 🚲</span>
                      <span>Veículo</span>
                    </span>
                    <span className="flex items-center gap-1 text-slate-300">
                      <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FF6B35] text-[8px] font-bold text-white">
                        1
                      </span>
                      <span>Ordem &amp; Nome</span>
                    </span>
                  </div>
                </div>

                {/* CARD 5: FLUXO DE PARADAS DA ROTA DAQUELE ENTREGADOR */}
                {courierRouteOrders.length > 0 && (
                  <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                        <Layers className="h-3.5 w-3.5 text-emerald-400" />
                        Rota do Entregador ({courierRouteOrders.length} paradas)
                      </span>
                    </div>

                    <div className="space-y-2">
                      {/* Partida */}
                      <div className="flex items-center gap-2.5 text-xs text-slate-300">
                        <span className="h-5 w-5 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 font-bold flex items-center justify-center text-[10px] shrink-0">
                          🟢
                        </span>
                        <div className="truncate">
                          <p className="font-semibold text-white truncate">
                            {selectedOrder.start_base_name || 'Base de Partida'}
                          </p>
                          <p className="text-[10px] text-slate-400 truncate">
                            {selectedOrder.start_base_address || 'Ponto inicial'}
                          </p>
                        </div>
                      </div>

                      {/* Paradas numeradas */}
                      {courierRouteOrders.map((o, idx) => {
                        const isCurrent = o.id === selectedOrder.id
                        const isDone = o.status === 'delivered'

                        return (
                          <div
                            key={o.id}
                            onClick={() => handleOpenOrderDetails(o)}
                            className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition text-xs ${
                              isCurrent
                                ? 'bg-blue-950/80 border border-blue-500/50 text-white font-bold'
                                : 'bg-[#070D1E]/60 hover:bg-[#121E46]/60 border border-transparent text-slate-300'
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <span
                                className={`h-5 w-5 rounded-full font-bold flex items-center justify-center text-[10px] shrink-0 ${
                                  isDone
                                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                    : isCurrent
                                      ? 'bg-blue-500 text-white'
                                      : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {isDone ? '✓' : idx + 1}
                              </span>
                              <span className="truncate">
                                {o.expand?.customer_id?.name || o.tracking_code}
                              </span>
                            </div>

                            <span className="text-[10px] text-slate-400 font-mono shrink-0 ml-2">
                              {o.status === 'delivered'
                                ? o.actual_arrival
                                  ? `Entregue às ${new Date(o.actual_arrival).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                                  : 'Entregue'
                                : o.estimated_arrival
                                  ? new Date(o.estimated_arrival).toLocaleTimeString([], {
                                      hour: '2-digit',
                                      minute: '2-digit',
                                    })
                                  : 'Pendente'}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Comprovante Digital se Entregue */}
                {selectedOrder.status === 'delivered' &&
                  (selectedOrder.proof_photo || selectedOrder.signature) && (
                    <div className="rounded-2xl border border-emerald-500/30 bg-[#0b2120]/60 p-4 space-y-3">
                      <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider flex items-center gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Comprovante Digital de Entrega
                      </span>

                      <div className="grid grid-cols-2 gap-2">
                        {selectedOrder.proof_photo && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-1">Foto da Entrega:</p>
                            <img
                              src={selectedOrder.proof_photo}
                              alt="Foto da Entrega"
                              className="w-full h-24 object-cover rounded-xl border border-emerald-500/30"
                            />
                          </div>
                        )}
                        {selectedOrder.signature && (
                          <div>
                            <p className="text-[10px] text-slate-400 mb-1">
                              Assinatura do Recebedor:
                            </p>
                            <img
                              src={selectedOrder.signature}
                              alt="Assinatura"
                              className="w-full h-24 object-contain bg-white rounded-xl border border-slate-700"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  )}
              </div>

              {/* Drawer Footer Actions */}
              <div className="p-4 border-t border-[#1E2B58] bg-[#070D1E] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsDrawerOpen(false)}
                    className="border-[#1E2B58] text-slate-300 hover:text-white hover:bg-slate-800"
                  >
                    Fechar
                  </Button>

                  {/* REQUISITO: "o vendedor pode excluir o cliente da rota em andamento" */}
                  {selectedOrder.status !== 'delivered' &&
                    selectedOrder.status !== 'cancelled' &&
                    (selectedOrder.route_started ||
                      selectedOrder.status === 'in_transit' ||
                      selectedOrder.status === 'assigned' ||
                      selectedOrder.route_released) && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setOrderToRemoveFromRoute(selectedOrder)}
                        className="border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-bold text-xs gap-1.5 rounded-xl transition"
                        title="Remover cliente desta rota e retornar para status Pendente"
                      >
                        <AlertTriangle className="h-3.5 w-3.5 text-rose-400" />
                        Remover da Rota
                      </Button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      const origin = typeof window !== 'undefined' ? window.location.origin : ''
                      window.open(`${origin}/track/${selectedOrder.tracking_code}`, '_blank')
                    }}
                    className="bg-[#0052CC] hover:bg-[#003E99] text-white font-bold text-xs gap-1.5 rounded-xl"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Abrir Rastreio Público
                  </Button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* MODAL DE CONFIRMAÇÃO: REMOVER CLIENTE DA ROTA EM ANDAMENTO */}
      <Dialog
        open={Boolean(orderToRemoveFromRoute)}
        onOpenChange={(open) =>
          !open && !isRemovingOrderFromRoute && setOrderToRemoveFromRoute(null)
        }
      >
        <DialogContent className="sm:max-w-md bg-[#0A1128] border border-rose-500/30 text-slate-100">
          <DialogHeader>
            <div className="flex items-center gap-2.5 text-rose-400">
              <div className="p-2 rounded-xl bg-rose-500/10 border border-rose-500/30">
                <AlertTriangle className="h-5 w-5 text-rose-400" />
              </div>
              <DialogTitle className="text-base font-bold text-white font-heading">
                Remover Cliente da Rota em Andamento?
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-slate-300 pt-2 space-y-2">
              <p>
                Você está prestes a remover o cliente{' '}
                <strong className="text-white">
                  {orderToRemoveFromRoute?.expand?.customer_id?.name || 'Cliente'}
                </strong>{' '}
                (pedido{' '}
                <span className="font-mono text-[#60A5FA]">
                  {orderToRemoveFromRoute?.tracking_code}
                </span>
                ) da rota do entregador.
              </p>
              <div className="p-3 rounded-xl bg-[#070D1E] border border-slate-800 space-y-1 text-[11px] text-slate-400">
                <p>• O pedido sairá imediatamente do app do entregador em tempo real.</p>
                <p>• A sequência e quilometragem da rota serão recalculadas automaticamente.</p>
                <p>
                  • O pedido retornará para o status <strong>Pendente</strong> no painel de vendas.
                </p>
              </div>
            </DialogDescription>
          </DialogHeader>

          <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#1E2B58]">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isRemovingOrderFromRoute}
              onClick={() => setOrderToRemoveFromRoute(null)}
              className="border-[#1E2B58] text-slate-300 hover:text-white hover:bg-slate-800"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={isRemovingOrderFromRoute}
              onClick={handleConfirmRemoveOrderFromRoute}
              className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs gap-1.5 shadow-md shadow-rose-950/40"
            >
              {isRemovingOrderFromRoute ? 'Removendo...' : 'Sim, Remover da Rota'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 6. MODAL DO ENTREGADOR (Ao clicar no entregador na lista lateral ou mapa) */}
      <Dialog open={!!selectedCourier} onOpenChange={(open) => !open && setSelectedCourier(null)}>
        <DialogContent className="sm:max-w-md bg-[#0A1128] border border-[#1E2B58] text-slate-100">
          {selectedCourier &&
            (() => {
              const data = allCourierData.find((c) => c.courier.id === selectedCourier.id)
              const nextCust = data?.nextOrder?.expand?.customer_id
              const lastCust = data?.lastDelivered?.expand?.customer_id

              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-500/20 border border-blue-500/40 rounded-full text-blue-400">
                        {renderVehicleIcon(selectedCourier.vehicle_type)}
                      </div>
                      <div>
                        <DialogTitle className="text-lg font-bold text-white font-heading">
                          {selectedCourier.name || selectedCourier.email}
                        </DialogTitle>
                        <DialogDescription className="text-xs text-slate-400">
                          {formatVehicle(selectedCourier.vehicle_type)} • Placa:{' '}
                          {selectedCourier.vehicle_plate || 'Não informada'}
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-4 py-2 text-xs">
                    <div className="grid grid-cols-2 gap-2 bg-[#070D1E] p-3 rounded-xl border border-[#1E2B58]">
                      <div>
                        <span className="text-slate-400 block">Status Atual:</span>
                        <span className="font-semibold text-white mt-0.5 inline-flex items-center gap-1.5">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              data?.statusColor === 'green'
                                ? 'bg-emerald-400'
                                : data?.statusColor === 'yellow'
                                  ? 'bg-amber-400'
                                  : 'bg-rose-500'
                            }`}
                          />
                          {data?.statusLabel}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block">GPS (Lat / Lng):</span>
                        <span className="font-mono text-slate-300">
                          {data?.lat.toFixed(4)}, {data?.lng.toFixed(4)}
                        </span>
                      </div>
                    </div>

                    {/* Próxima Entrega e Previsão de Volta à Base */}
                    {(() => {
                      const courierRouteInfo = activeRoutesData.find(
                        (r) => r.courierId === selectedCourier.id,
                      )
                      return (
                        <div className="border border-blue-500/40 rounded-xl p-3 space-y-2 bg-[#0d1b3e]/60">
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-blue-300 flex items-center gap-1">
                              <Navigation className="h-3.5 w-3.5 text-blue-400" />
                              Próxima Entrega na Rota:
                            </span>
                            {data?.nextOrder && (
                              <Badge className="bg-blue-600 text-white font-bold text-[10px]">
                                {data.nextOrder.tracking_code}
                              </Badge>
                            )}
                          </div>
                          {data?.nextOrder ? (
                            <div className="text-slate-300 space-y-1">
                              <p className="font-bold text-white">
                                {nextCust?.name || 'Cliente'} ({data.nextOrder.tracking_code})
                              </p>
                              <p className="text-slate-400 text-[11px] truncate">
                                {nextCust?.address || 'Endereço'}
                              </p>
                              <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-[11px]">
                                <span className="bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 px-2 py-0.5 rounded">
                                  {courierRouteInfo?.etaNextDeliveryTime &&
                                  courierRouteInfo?.etaReturnBaseTime
                                    ? `⏱️ Entrega ~${courierRouteInfo.etaNextDeliveryTime} • Volta à base ~${courierRouteInfo.etaReturnBaseTime}`
                                    : courierRouteInfo?.etaNextDeliveryTime
                                      ? `⏱️ Previsão Entrega: ${courierRouteInfo.etaNextDeliveryTime}`
                                      : courierRouteInfo?.etaReturnBaseTime
                                        ? `🏢 Retornando à base • Chegada ~${courierRouteInfo.etaReturnBaseTime}`
                                        : `Previsão: ${getEtaDisplay(data.nextOrder)}`}
                                </span>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1">
                              <p className="text-slate-400 italic text-[11px]">
                                {data?.statusLabel === 'Retornando à Base'
                                  ? 'Todas as entregas concluídas — em trânsito de volta à base.'
                                  : 'Nenhuma entrega na fila atual'}
                              </p>
                              {courierRouteInfo?.etaReturnBaseTime && (
                                <p className="text-blue-300 font-bold font-mono text-xs">
                                  🏢 Retornando à base • Chegada ~
                                  {courierRouteInfo.etaReturnBaseTime}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })()}

                    {/* Contato Direto */}
                    <div className="pt-2 flex gap-2">
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs"
                        size="sm"
                        onClick={() => openWhatsApp(selectedCourier.phone)}
                      >
                        <MessageCircle className="h-4 w-4 mr-1.5" />
                        Conversar no WhatsApp
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 border-[#1E2B58] bg-[#070D1E] hover:bg-[#121E46] text-slate-200 text-xs"
                        onClick={() => makePhoneCall(selectedCourier.phone)}
                      >
                        <Phone className="h-4 w-4 mr-1.5" />
                        Ligar para Entregador
                      </Button>
                    </div>
                  </div>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
export default ControlTower
