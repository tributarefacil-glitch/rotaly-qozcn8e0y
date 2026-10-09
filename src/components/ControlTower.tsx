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
import { getCourierRouteColor } from '@/lib/courierRouteColors'
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
import { asyncPool } from '@/lib/promisePool'
import { playRouteAlertSound, playOffRouteWarningSound } from '@/lib/notificationSound'
import { DEVIATION_THRESHOLD_METERS, UNEXPECTED_STOP_THRESHOLD_METERS } from '@/lib/geo'
import { formatTimeInTz, formatDateInTz } from '@/lib/operationalWindow'
import { useAuth } from '@/contexts/AuthContext'
import { useCompany } from '@/contexts/CompanyContext'
import { getMyCompany } from '@/lib/companyResolver'
import {
  calculateRouteWorkShift,
  type RouteWorkShiftMetrics,
  type WorkShiftConfig,
} from '@/lib/routeWorkShift'
import {
  getOperationalWindow,
  isNeutralizedSystemError,
  isTodayOrder,
  isOrderIssueToday,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import { isOrderInActiveRoute } from '@/lib/activeRouteHelper'
import type { AppSettingsRecord } from '@/types/delivery'
import {
  ControlTowerDeliveredNotice,
  ControlTowerHeroBanner,
  ControlTowerFilters,
} from '@/components/control-tower/ControlTowerCards'
import { ControlTowerColumns } from '@/components/control-tower/ControlTowerColumns'
import { ControlTowerMap } from '@/components/control-tower/ControlTowerMap'
import { ControlTowerModals } from '@/components/control-tower/ControlTowerModals'

interface ControlTowerProps {
  orders?: OrderRecord[]
  couriers?: UserRecord[]
  locations?: LocationRecord[]
  settings?: AppSettingsRecord | null
  offRouteEvents?: any[]
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

interface ControlTowerErrorBoundaryProps {
  children: React.ReactNode
}

interface ControlTowerErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ControlTowerErrorBoundary extends React.Component<
  ControlTowerErrorBoundaryProps,
  ControlTowerErrorBoundaryState
> {
  constructor(props: ControlTowerErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ControlTowerErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Torre de Controle - Erro capturado pelo ErrorBoundary:', error, errorInfo)
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null })
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full min-h-[500px] flex flex-col items-center justify-center p-8 bg-white border border-rose-200 rounded-2xl text-center text-[#002855] space-y-4 shadow-sm">
          <div className="w-16 h-16 rounded-full bg-red-500/20 border border-red-500/40 flex items-center justify-center text-3xl">
            📡
          </div>
          <div className="max-w-md space-y-2">
            <h3 className="text-xl font-bold text-red-400">
              Ops! A Torre de Controle encontrou um problema
            </h3>
            <p className="text-sm text-slate-300">
              Ocorreu uma instabilidade visual temporária na renderização do mapa ou telemetria.
              Seus dados continuam seguros.
            </p>
            {this.state.error?.message && (
              <p className="text-xs font-mono text-slate-400 bg-slate-900/80 p-2.5 rounded-lg border border-slate-800 text-left overflow-x-auto max-h-24">
                {this.state.error.message}
              </p>
            )}
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={this.handleReload}
              className="px-5 py-2.5 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 text-white shadow-lg transition-colors cursor-pointer"
            >
              🔄 Recarregar Torre de Controle
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-5 py-2.5 rounded-xl font-semibold text-sm bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition-colors cursor-pointer"
            >
              Recarregar Página
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

const ControlTowerInner: React.FC<ControlTowerProps> = ({
  orders: initialOrders,
  couriers: initialCouriers,
  locations: propLocations,
  settings: propSettings,
  offRouteEvents: propOffRouteEvents,
  onRefresh,
  userRole: propUserRole = 'seller',
}) => {
  const { toast } = useToast()
  const { user } = useAuth()
  const { currentCompany } = useCompany()
  const userRole = user?.role || propUserRole
  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders || [])
  const [couriers, setCouriers] = useState<UserRecord[]>(initialCouriers || [])
  const [locations, setLocations] = useState<LocationRecord[]>(propLocations || [])
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(propSettings || null)
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
  const hasInitialFitRef = useRef(false)
  const courierMarkersMapRef = useRef<Map<string, any>>(new Map())
  const customerMarkersMapRef = useRef<Map<string, any>>(new Map())
  const baseMarkersMapRef = useRef<Map<string, any>>(new Map())
  const courierAnimFramesRef = useRef<Map<string, number>>(new Map())
  const [polylineRef, setPolylineRef] = useState<any>(null)
  const googlePolylinesRef = useRef<any[]>([])
  const activePolylinesMapRef = useRef<
    Map<string, { main: any; inner: any; returnLeg?: any; dev?: any }>
  >(new Map())
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
      remainingRouteMinutes?: number
      projectedEndTime?: Date
      projectedEndTimeFormatted?: string
      isOvertime?: boolean
      overtimeMinutes?: number
      shiftMetrics?: RouteWorkShiftMetrics
      order: OrderRecord
      courier: UserRecord
    }>
  >([])
  // Indicador sutil de cálculo de rotas em segundo plano
  const [isComputingRoutes, setIsComputingRoutes] = useState(false)
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

          // Resequenciar a rota restante viariamente pelo menor trajeto
          await deliveryService.resequenceActiveRouteForCourier(courierId, appSettings)

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

  // Determina se o componente pai (SellerDashboard / AdminDashboard) já está fornecendo os dados via props
  // Se initialOrders !== undefined || initialCouriers !== undefined, o pai gerencia os dados
  const hasParentData = initialOrders !== undefined || initialCouriers !== undefined
  const [parentFallbackAutonomous, setParentFallbackAutonomous] = useState(false)
  const parentDataTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Contingência de 3.500 ms: se o pai gerencia os dados mas após 3,5s ainda estiver com 0 registros, a Torre assume busca autônoma
  useEffect(() => {
    if (!hasParentData) return
    const ordersCount = Array.isArray(initialOrders) ? initialOrders.length : 0
    const couriersCount = Array.isArray(initialCouriers) ? initialCouriers.length : 0

    if (ordersCount === 0 && couriersCount === 0 && !parentFallbackAutonomous) {
      parentDataTimeoutRef.current = setTimeout(() => {
        console.info('Torre de Controle: fallback autônomo ativado após 3.5s sem dados do pai')
        setParentFallbackAutonomous(true)
      }, 3500)
    } else if (ordersCount > 0 || couriersCount > 0) {
      if (parentDataTimeoutRef.current) {
        clearTimeout(parentDataTimeoutRef.current)
        parentDataTimeoutRef.current = null
      }
      if (parentFallbackAutonomous) {
        setParentFallbackAutonomous(false)
      }
    }

    return () => {
      if (parentDataTimeoutRef.current) {
        clearTimeout(parentDataTimeoutRef.current)
      }
    }
  }, [initialOrders, initialCouriers, hasParentData, parentFallbackAutonomous])

  // Deve buscar de forma autônoma se NÃO houver gerenciamento pelo pai OU se o fallback autônomo foi ativado
  const shouldFetchAutonomously = !hasParentData || parentFallbackAutonomous

  // Listener de falha de resequenciamento para alertar a Central (admin/operador)
  useEffect(() => {
    const handleResequenceFailure = (evt: any) => {
      const detail = evt?.detail
      const courierName = couriers.find((c) => c.id === detail?.courierId)?.name || 'Entregador'
      toast({
        title: '⚠️ Aviso de Resequenciamento de Rota',
        description: `Falha temporária ao recalcular menor trajeto para ${courierName}. Ordem segura mantida com retry automático.`,
        variant: 'destructive',
      })
    }
    window.addEventListener('rotaly_resequence_failed', handleResequenceFailure)
    return () => {
      window.removeEventListener('rotaly_resequence_failed', handleResequenceFailure)
    }
  }, [couriers, toast])

  // Fetch initial/refreshed data: apenas busca o que não foi fornecido via props pelo pai
  const fetchData = async () => {
    try {
      const globalTransitFilter = `route_started = true && (route_finished = false || route_finished = null)`
      const currentOpWindow = getOperationalWindow(new Date())
      const windowStartIso = new Date(currentOpWindow.start).toISOString()
      const fallbackOrdersFilter = `created >= '${windowStartIso}' || (route_started = true && (route_finished = false || route_finished = null))`

      const needOrders = shouldFetchAutonomously && (!initialOrders || initialOrders.length === 0)
      const needCouriers =
        shouldFetchAutonomously && (!initialCouriers || initialCouriers.length === 0)
      const needLocations = !propLocations || propLocations.length === 0
      const needDeviations = propOffRouteEvents === undefined
      const needSettings = propSettings === undefined

      const [
        fetchedOrders,
        fetchedGlobalTransitOrders,
        fetchedCouriers,
        fetchedLocations,
        fetchedDeviations,
        fetchedSettings,
      ] = await Promise.all([
        needOrders
          ? deliveryService.getOrders(
              fallbackOrdersFilter,
              '-created',
              'customer_id,courier_id,seller_id',
            )
          : Promise.resolve(orders),
        deliveryService.getOrders(
          globalTransitFilter,
          '-created',
          'customer_id,courier_id,seller_id',
        ),
        needCouriers ? deliveryService.getCouriers() : Promise.resolve(couriers),
        needLocations ? deliveryService.getLatestLocations() : Promise.resolve(locations),
        needDeviations
          ? deliveryService.getOffRouteEvents('', '-created', 'courier_id,order_id').catch(() => [])
          : Promise.resolve(propOffRouteEvents || []),
        needSettings
          ? deliveryService.getSettings().catch(() => null)
          : Promise.resolve(propSettings || null),
      ])

      if (needOrders) {
        setOrders(fetchedOrders)
      }
      // Filtrar estritamente pedidos do dia para globalInTransitOrders
      const onlyTodayGlobal = (fetchedGlobalTransitOrders || []).filter((o) =>
        isTodayOrder(o, operationalWindow),
      )
      setGlobalInTransitOrders(onlyTodayGlobal)
      if (needCouriers) {
        setCouriers(fetchedCouriers)
      }
      if (needLocations && fetchedLocations) {
        setLocations(fetchedLocations)
      }
      if (needDeviations && fetchedDeviations) {
        setRecentDeviations(fetchedDeviations || [])
      }
      if (needSettings && fetchedSettings) {
        setAppSettings(fetchedSettings)
      }
      setLastUpdated(new Date())
    } catch (err) {
      console.warn('Erro ao atualizar dados da Torre de Controle:', err)
    }
  }

  // Sincronização inicial e periódica:
  // Executa busca autônoma apenas se props não foram fornecidas pelo componente pai ou se o fallback ativou
  useEffect(() => {
    if (shouldFetchAutonomously) {
      fetchData()
      const interval = setInterval(() => {
        if (shouldFetchAutonomously) {
          fetchData()
        }
      }, 30000)
      return () => clearInterval(interval)
    }
  }, [user?.id, user?.role, currentCompany?.id, shouldFetchAutonomously])

  useEffect(() => {
    const handleCompanyChange = () => {
      if (shouldFetchAutonomously) {
        fetchData()
      }
    }
    window.addEventListener('rotaly_company_changed', handleCompanyChange)
    return () => {
      window.removeEventListener('rotaly_company_changed', handleCompanyChange)
    }
  }, [shouldFetchAutonomously])

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

  // Sincronização de props opcionais passadas pelo componente pai (SellerDashboard / AdminDashboard)
  const prevLocationsHashRef = useRef<string>('')
  useEffect(() => {
    if (!propLocations) return
    const newHash = propLocations
      .map((l) => `${l.user_id}-${l.lat}-${l.lng}-${l.speed}-${l.updated || l.created}`)
      .join('|')
    if (newHash !== prevLocationsHashRef.current) {
      prevLocationsHashRef.current = newHash
      setLocations(propLocations)
    }
  }, [propLocations])

  useEffect(() => {
    if (propSettings !== undefined) {
      setAppSettings(propSettings)
    }
  }, [propSettings])

  useEffect(() => {
    if (propOffRouteEvents !== undefined) {
      setRecentDeviations(propOffRouteEvents)
    }
  }, [propOffRouteEvents])

  // Buffer de telemetria GPS (throttle de 2,5s para evitar dezenas de re-renders por segundo)
  const locationBufferRef = useRef<Map<string, LocationRecord>>(new Map())

  // Realtime PocketBase subscriptions:
  // Se o componente pai fornecer as props memoizadas (locations, settings, offRouteEvents),
  // desligamos as subscrições manuais correspondentes para evitar re-renders duplicados.
  const hasParentSettings = propSettings !== undefined
  const hasParentDeviations = Boolean(propOffRouteEvents)

  useEffect(() => {
    let isSubscribed = true

    // Intervalo de flush único a cada 2,5s para as posições acumuladas em buffer
    const flushInterval = setInterval(() => {
      if (locationBufferRef.current.size === 0) return
      const bufferedMap = new Map(locationBufferRef.current)
      locationBufferRef.current.clear()

      setLocations((prev) => {
        const updated = [...prev]
        bufferedMap.forEach((newLoc, userId) => {
          const idx = updated.findIndex((l) => l.user_id === userId)
          if (idx >= 0) {
            updated[idx] = newLoc
          } else {
            updated.unshift(newLoc)
          }
        })
        return updated
      })
      setLastUpdated(new Date())
    }, 2500)

    // Subscrição SEMPRE ativa para telemetria em tempo real
    pb.collection('locations')
      .subscribe('*', (e) => {
        if (!isSubscribed) return
        if (e.action === 'create' || e.action === 'update') {
          const newLoc = e.record as unknown as LocationRecord
          if (newLoc.user_id) {
            // 1. Grava no buffer sem disparar setState de locations imediatamente
            locationBufferRef.current.set(newLoc.user_id, newLoc)
          }

          // 2. Atualização imediata do pin no mapa nativo para movimento suave em tempo real
          if (
            newLoc.user_id &&
            typeof newLoc.lat === 'number' &&
            typeof newLoc.lng === 'number' &&
            !isNaN(newLoc.lat) &&
            !isNaN(newLoc.lng)
          ) {
            const existingMarker = courierMarkersMapRef.current.get(newLoc.user_id)
            if (existingMarker) {
              const prevPos = existingMarker.getPosition()
              if (prevPos) {
                const sLat = prevPos.lat()
                const sLng = prevPos.lng()
                const dLat = newLoc.lat - sLat
                const dLng = newLoc.lng - sLng
                if (Math.abs(dLat) > 0.00001 || Math.abs(dLng) > 0.00001) {
                  const prevAnim = courierAnimFramesRef.current.get(newLoc.user_id)
                  if (prevAnim) cancelAnimationFrame(prevAnim)
                  const startT = performance.now()
                  const dur = 700
                  const step = (now: number) => {
                    const el = now - startT
                    const prog = Math.min(1, el / dur)
                    existingMarker.setPosition({
                      lat: sLat + dLat * prog,
                      lng: sLng + dLng * prog,
                    })
                    if (prog < 1) {
                      const req = requestAnimationFrame(step)
                      courierAnimFramesRef.current.set(newLoc.user_id, req)
                    } else {
                      existingMarker.setPosition({ lat: newLoc.lat, lng: newLoc.lng })
                      courierAnimFramesRef.current.delete(newLoc.user_id)
                    }
                  }
                  const req = requestAnimationFrame(step)
                  courierAnimFramesRef.current.set(newLoc.user_id, req)
                }
              } else {
                existingMarker.setPosition({ lat: newLoc.lat, lng: newLoc.lng })
              }
            }
          }
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

        // Modo Empresa Única (Rotaly Operações): todos os pedidos pertencem à operação unificada

        // Ao receber update com route_finished === true ou status === 'delivered':
        // remover imediatamente o courier do cache de rotas ativas, remover polilinhas e expurgar de globalInTransitOrders
        const isRouteFinished = Boolean(rec.route_finished)

        const affectedCourierId = rec.courier_id

        if (affectedCourierId && (rec.route_finished === true || rec.status === 'delivered')) {
          // Ao mudar para delivered ou finalizar rota: limpar cache de geometria para recálculo imediato da nova perna
          activeRoutesCacheRef.current.delete(affectedCourierId)

          // Limpar notificações e alertas falsos associados ao entregador/pedido entregue
          const devKey = `dev-${affectedCourierId}-${rec.id}`
          const stopKey = `stop-${affectedCourierId}`
          const etaKey = `eta-${affectedCourierId}-${rec.id}`
          notifiedEventsRef.current.delete(devKey)
          notifiedEventsRef.current.delete(stopKey)
          notifiedEventsRef.current.delete(etaKey)

          // Disparar atualização imediata de estado para recalcular rota sem aguardar refresh
          setLastUpdated(new Date())

          if (rec.route_finished === true) {
            // Remove polilinhas ativas no Google Maps nativo
            const existingLines = activePolylinesMapRef.current.get(affectedCourierId)
            if (existingLines) {
              try {
                existingLines.main?.setMap(null)
                existingLines.inner?.setMap(null)
                existingLines.returnLeg?.setMap(null)
                existingLines.dev?.setMap(null)
              } catch {
                /* intentionally ignored */
              }
              activePolylinesMapRef.current.delete(affectedCourierId)
            }
            if (googlePolylinesRef.current && googlePolylinesRef.current.length > 0) {
              googlePolylinesRef.current.forEach((p) => {
                try {
                  p.setMap(null)
                } catch {
                  /* intentionally ignored */
                }
              })
              googlePolylinesRef.current = []
            }

            // Remove o marcador animado do entregador no Google Maps nativo imediatamente
            const courierMarker = courierMarkersMapRef.current.get(affectedCourierId)
            if (courierMarker) {
              try {
                courierMarker.setMap(null)
              } catch {
                /* intentionally ignored */
              }
              courierMarkersMapRef.current.delete(affectedCourierId)
            }
            const animId = courierAnimFramesRef.current.get(affectedCourierId)
            if (animId) {
              cancelAnimationFrame(animId)
              courierAnimFramesRef.current.delete(affectedCourierId)
            }
          }
        }

        // Manter lista global de pedidos em trânsito sempre sincronizada (para todos os lojistas)
        if (e.action === 'delete') {
          setGlobalInTransitOrders((prev) => prev.filter((o) => o.id !== rec.id))
        } else {
          const isRecActiveRoute =
            rec.route_started === true &&
            rec.route_finished !== true &&
            (rec.route_finished === false ||
              rec.route_finished === null ||
              rec.route_finished === undefined)

          setGlobalInTransitOrders((prev) => {
            if (isRouteFinished || !isRecActiveRoute) {
              // Expurgar imediatamente o registro defasado
              return prev.filter((o) => o.id !== rec.id)
            }
            const exists = prev.some((o) => o.id === rec.id)
            return exists
              ? prev.map((o) => (o.id === rec.id ? { ...o, ...rec } : o))
              : [rec, ...prev]
          })
        }

        // Eventos de pedidos da empresa ativa da filial (aceitos sem amarrar em seller_id)
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

    // Subscribe to off_route_events apenas se o pai NÃO forneceu
    if (!hasParentDeviations) {
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
    }

    // Subscribe to app_settings apenas se o pai NÃO forneceu
    if (!hasParentSettings) {
      pb.collection('app_settings')
        .subscribe('*', (e) => {
          if (!isSubscribed) return
          if (e.action === 'create' || e.action === 'update') {
            setAppSettings(e.record as unknown as AppSettingsRecord)
            setLastUpdated(new Date())
          }
        })
        .catch((err) => {
          console.warn('Torre de Controle: erro subscrição app_settings:', err)
        })
    }

    return () => {
      isSubscribed = false
      clearInterval(flushInterval)
      locationBufferRef.current.clear()
      pb.collection('locations')
        .unsubscribe('*')
        .catch(() => {})
      pb.collection('orders')
        .unsubscribe('*')
        .catch(() => {})
      if (!hasParentDeviations) {
        pb.collection('off_route_events')
          .unsubscribe('*')
          .catch(() => {})
      }
      if (!hasParentSettings) {
        pb.collection('app_settings')
          .unsubscribe('*')
          .catch(() => {})
      }
    }
  }, [user?.id, user?.role, hasParentSettings, hasParentDeviations])

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

  // REQUISITO DO USUÁRIO: "O DIA É CONTABILIZADO DAS 05H:00 DA MANHÃ AS 23:59 DE TODOS OS DIAS."
  // Utiliza o módulo centralizado src/lib/operationalWindow.ts
  const operationalWindow = useMemo(() => {
    return getOperationalWindow(new Date())
  }, [lastUpdated])

  // todayStr mantido para compatibilidade de rotas e chamadas
  const todayStr = operationalWindow.dateStr

  const todayOrders = useMemo(() => {
    return orders.filter((o) => !isNeutralizedSystemError(o) && isTodayOrder(o, operationalWindow))
  }, [orders, operationalWindow])

  // Helpers to categorize orders into kanban columns
  // A coluna "Exceções & Problemas" mostra EXCLUSIVAMENTE ocorrências do dia atual no fuso de Brasília
  const getOrderKanbanCategory = (order: OrderRecord): KanbanColumnKey | null => {
    const isIssue =
      order.status === 'address_error' ||
      order.status === 'client_absent' ||
      order.status === 'cancelled' ||
      order.completion_reason === 'address_error' ||
      order.completion_reason === 'client_absent' ||
      (order.notes && order.notes.toLowerCase().includes('problema'))

    if (isIssue) {
      // Pedidos com problema de dias passados NÃO entram na coluna de Exceções & Problemas da Torre
      if (!isOrderIssueToday(order, operationalWindow)) {
        return null
      }
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
  // 2. hasRouteStarted / activeInTransitOrders verificados contra a lista GLOBAL de pedidos em trânsito filtrada para o dia corrente
  const allCourierData = useMemo(() => {
    // Filtrar globalInTransitOrders estritamente pelo dia corrente (isTodayOrder) para impedir vazamento de pedidos antigos
    const todayGlobalTransitOrders = globalInTransitOrders.filter((o) =>
      isTodayOrder(o, operationalWindow),
    )

    return couriers.map((courier) => {
      const courierLocs = locations.filter((l) => l.user_id === courier.id)
      const latestLoc =
        courierLocs.length > 1
          ? [...courierLocs].sort(
              (a, b) =>
                parseSafeTimestamp(b.updated || b.created) -
                parseSafeTimestamp(a.updated || a.created),
            )[0]
          : courierLocs[0]

      // Pedidos atribuídos ao entregador na visão global do dia
      const globalCourierTransit = todayGlobalTransitOrders.filter(
        (o) => o.courier_id === courier.id,
      )
      // Pedidos locais da loja do dia (para métricas e kanban da loja)
      const courierLocalOrders = todayOrders.filter((o) => o.courier_id === courier.id)

      // Rota ativa do entregador considerada tanto globalmente quanto localmente (estritamente do dia)
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
          (o.status === 'address_error' ||
            o.status === 'client_absent' ||
            o.completion_reason === 'address_error' ||
            o.completion_reason === 'client_absent') &&
          isOrderIssueToday(o, operationalWindow),
      )
      const finishedOrders = courierLocalOrders.filter((o) => o.status === 'delivered')

      // Entregas atribuídas à rota do entregador: iniciada (route_started === true) e ainda não finalizada (route_finished !== true)
      // Inclui pedidos delivered para saber se a rota inteira foi concluída e o entregador está retornando à base
      const routeOrdersRaw = [
        ...globalCourierTransit.filter(
          (o) => o.route_started === true && o.route_finished !== true && o.status !== 'cancelled',
        ),
        ...courierLocalOrders.filter(
          (o) => o.route_started === true && o.route_finished !== true && o.status !== 'cancelled',
        ),
      ]
      const uniqueCourierRouteOrders = Array.from(
        new Map(routeOrdersRaw.map((o) => [o.id, o])).values(),
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
        gps_reason: (latestLoc as any)?.gps_reason,
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
        hasPendingReturnToBase: isReturningToBase,
        nextOrder,
        lastDelivered,
        vehicle: courier.vehicle_type || 'moto',
        allAssignedOrders:
          uniqueActiveTransitOrders.length > 0 ? uniqueActiveTransitOrders : courierLocalOrders,
      }
    })
  }, [couriers, locations, todayOrders, globalInTransitOrders])

  // REQUISITO: No mapa aparecem entregadores com rota iniciada e coordenadas válidas
  // Mantém ativo se há pedidos em trânsito (inTransitCount > 0) OU se está retornando à base (hasPendingReturnToBase)
  const activeRouteCouriers = useMemo(() => {
    return allCourierData.filter(
      (c) =>
        c.hasRouteStarted && c.hasValidCoords && (c.inTransitCount > 0 || c.hasPendingReturnToBase),
    )
  }, [allCourierData])

  // Entregadores disponíveis (mantido para cálculos internos se necessário)
  const availableCouriers = useMemo(() => {
    return allCourierData.filter((c) => !c.hasRouteStarted)
  }, [allCourierData])

  // Atualização e cálculo contínuo de rotas viárias ativas, desvio de rota, parada fora do local e ETA
  useEffect(() => {
    let isCurrent = true
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    // Para cada entregador com rota iniciada, buscar/atualizar o trajeto oficial:
    // Base de partida → sequência de clientes da rota iniciada (route_started = true)
    // OTIMIZAÇÃO: Cache de movimento mínimo de 100m + debounce de ~800ms + asyncPool (concorrência 4)
    const computeActiveRoutes = async () => {
      const computeCourierRoute = async (item: (typeof activeRouteCouriers)[0]) => {
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

        // Fallback oficial da base (Mais Saudável, Rua da Prosperidade, 13 — Pilar)
        const OFFICIAL_BASE_FALLBACK: LatLngPoint = { lat: -22.6990563, lng: -43.296723 }

        // O primeiro pedido ativo (ou o último delivered se todos já foram entregues) define a base
        const primaryOrder =
          activeRouteOrders.find((o) => o.status === 'in_transit') ||
          activeRouteOrders.find((o) => o.status === 'pending') ||
          activeRouteOrders[activeRouteOrders.length - 1] ||
          activeRouteOrders[0]

        const baseLat = primaryOrder.start_base_lat
          ? Number(primaryOrder.start_base_lat)
          : OFFICIAL_BASE_FALLBACK.lat
        const baseLng = primaryOrder.start_base_lng
          ? Number(primaryOrder.start_base_lng)
          : OFFICIAL_BASE_FALLBACK.lng
        const origin: LatLngPoint = { lat: baseLat, lng: baseLng }
        const courierPos: LatLngPoint = { lat: item.lat, lng: item.lng }

        // Base de retorno: end_address_lat/lng ou fallback start_base ou fallback oficial
        const returnBaseLat = primaryOrder.end_address_lat
          ? Number(primaryOrder.end_address_lat)
          : primaryOrder.start_base_lat
            ? Number(primaryOrder.start_base_lat)
            : OFFICIAL_BASE_FALLBACK.lat
        const returnBaseLng = primaryOrder.end_address_lng
          ? Number(primaryOrder.end_address_lng)
          : primaryOrder.start_base_lng
            ? Number(primaryOrder.start_base_lng)
            : OFFICIAL_BASE_FALLBACK.lng
        const returnBasePos: LatLngPoint = { lat: returnBaseLat, lng: returnBaseLng }

        // Separar paradas em pendentes (in_transit/pending) e concluídas (delivered)
        const pendingStopsList: LatLngPoint[] = []
        let lastDeliveredPos: LatLngPoint | null = null

        activeRouteOrders.forEach((o) => {
          const c = o.expand?.customer_id
          if (c?.lat && c?.lng) {
            const pt = { lat: Number(c.lat), lng: Number(c.lng) }
            if (o.status !== 'delivered') {
              pendingStopsList.push(pt)
            } else {
              lastDeliveredPos = pt
            }
          }
        })

        // Hash para verificar se a composição de pedidos/paradas/status mudou
        const stopIdsHash = activeRouteOrders
          .map((o) => `${o.id}:${o.status}:${o.sequence}`)
          .join(',')
        const cached = activeRoutesCacheRef.current.get(item.courier.id)

        // Se cache existente for válido e posição mudou < 100 metros e pedidos não mudaram:
        // reutilizar a geometria calculada (evita chamadas de rede e re-criação de linhas)
        if (
          cached &&
          cached.stopIdsHash === stopIdsHash &&
          distanceMeters(cached.courierPos, courierPos) < 100
        ) {
          // Atualiza apenas dados leves de telemetria instantânea (velocidade/posição/status do entregador)
          return {
            ...cached.result,
            courierPos,
            courier: item.courier,
          }
        }

        try {
          // CORREÇÃO 1 & 4: Traçado ativo em tempo real
          // Se há paradas pendentes:
          // traçado parte da POSIÇÃO GPS ATUAL do entregador (courierPos) → próxima pendente → subsequentes pendentes
          // Perna de retorno (tracejada #60A5FA): última pendente → returnBasePos
          // Se NÃO há pendentes (todas entregues):
          // traçado de ida fica vazio; traçado de retorno é courierPos → returnBasePos viário
          let forwardPoints: LatLngPoint[] = []
          let returnPoints: LatLngPoint[] = []

          if (pendingStopsList.length > 0) {
            // Trajeto vigente: courierPos → pendente 1 → pendente 2 ...
            const activeWaypoints: LatLngPoint[] = [courierPos, ...pendingStopsList]
            const forwardSegments: LatLngPoint[] = []
            let prevPoint = activeWaypoints[0]

            for (let sIdx = 1; sIdx < activeWaypoints.length; sIdx++) {
              const targetPoint = activeWaypoints[sIdx]
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

            forwardPoints = forwardSegments.length >= 2 ? forwardSegments : activeWaypoints

            // Perna de retorno: última pendente → returnBasePos
            const lastPendingStop = pendingStopsList[pendingStopsList.length - 1]
            try {
              const retRes = await fetchStreetRoute(lastPendingStop, returnBasePos)
              if (retRes.coordinates.length >= 2) {
                returnPoints = retRes.coordinates
              } else {
                returnPoints = [lastPendingStop, returnBasePos]
              }
            } catch {
              returnPoints = [lastPendingStop, returnBasePos]
            }
          } else {
            // Sem paradas pendentes: o entregador já cumpriu todas as entregas e deve retornar à base
            // forwardPoints vazio (não há linha azul de cliente a cumprir)
            // returnPoints: courierPos → returnBasePos viário (linha tracejada azul-claro #60A5FA)
            forwardPoints = []
            try {
              const retRes = await fetchStreetRoute(courierPos, returnBasePos)
              if (retRes.coordinates.length >= 2) {
                returnPoints = retRes.coordinates
              } else {
                returnPoints = [courierPos, returnBasePos]
              }
            } catch {
              returnPoints = [courierPos, returnBasePos]
            }
          }

          // Trajeto total vigente (exclusivamente trecho a cumprir: do entregador até a próxima parada / base)
          const activeVigenteRoutePoints: LatLngPoint[] =
            forwardPoints.length >= 2
              ? returnPoints.length >= 2
                ? [...forwardPoints, ...returnPoints.slice(1)]
                : forwardPoints
              : returnPoints.length >= 2
                ? returnPoints
                : [courierPos, returnBasePos]

          const points = activeVigenteRoutePoints

          // Detecção de sinal congelado/obsoleto (> 5 minutos)
          // Pings com gps_status 'active' e offline_buffered false representam sinal vivo (não acusa)
          const locTime = parseSafeTimestamp(item.location_timestamp)
          const isGpsFrozen =
            item.gps_status === 'offline' ||
            (locTime > 0 &&
              Date.now() - locTime > 5 * 60 * 1000 &&
              !(item.gps_status === 'active' && item.offline_buffered === false))

          // CORREÇÃO 2: Projeção e desvio medidos EXCLUSIVAMENTE sobre o trajeto vigente
          // (courierPos → próxima pendente → subsequentes → retorno)
          // NUNCA sobre segmentos de entregas antigas já cumpridas.
          const nearest = findNearestPointOnRoute(courierPos, activeVigenteRoutePoints)
          const nextTargetPos = pendingStopsList[0] || returnBasePos
          const distToClientMeters = distanceMeters(courierPos, nextTargetPos)

          // Só avaliar desvio com rota iniciada (route_started === true) e não finalizada (route_finished !== true)
          const hasActiveRouteStarted =
            Boolean(primaryOrder.route_started) &&
            primaryOrder.route_finished !== true &&
            item.hasRouteStarted

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

          // SE POSIÇÃO ESTÁ CONGELADA (>2min) ou rota não iniciada, SUPRIMIR FALSOS ALARMES DE DESVIO/PARADA
          // Requisitos adicionais de blindagem:
          // (a) Avaliar apenas sinais GPS recentes (descartar sinais de minutos atrás)
          // (b) Debounce: exigir 3 leituras CONSECUTIVAS fora da rota (antes eram 2) antes de alarmar
          // (c) Descartar pings com accuracy > 50m (hoje entravam até 100m)
          // (d) Limiar de 600m mantido blindado
          const currentReadingTimestamp = locTime > 0 ? locTime : Date.now()
          const locAgeMs = Date.now() - currentReadingTimestamp
          const isGpsRecent = locAgeMs <= 3 * 60 * 1000

          const isAccuracyAcceptable =
            item.accuracy === undefined || item.accuracy === null || item.accuracy <= 50

          const previousCached = activeRoutesCacheRef.current.get(item.courier.id)
          const prevConsecutive =
            (previousCached?.result as any)?.consecutiveDeviations ??
            (previousCached?.result?.isDeviated ? 2 : 0)
          const isCurrentReadingDeviated =
            isAccuracyAcceptable && nearest.distanceMeters > DEVIATION_THRESHOLD_METERS
          const consecutiveDeviations = isCurrentReadingDeviated ? prevConsecutive + 1 : 0

          // Exigir 3 leituras consecutivas fora da rota antes de disparar alarme de desvio
          const confirmedDeviation = hasDeviationEvent || consecutiveDeviations >= 3

          const isDeviated =
            !isGpsFrozen && isGpsRecent && hasActiveRouteStarted && confirmedDeviation

          // CORREÇÃO 3: Alerta "parada fora"
          // Não disparar falso alarme se o entregador estiver parado a <= 600m do último cliente entregue (lastDeliveredPos)
          const distToBaseMeters = distanceMeters(courierPos, origin)
          const distToReturnBaseMeters = distanceMeters(courierPos, returnBasePos)
          const isNearBase =
            distToBaseMeters <= UNEXPECTED_STOP_THRESHOLD_METERS ||
            distToReturnBaseMeters <= UNEXPECTED_STOP_THRESHOLD_METERS
          const isNearNextTarget = distToClientMeters <= UNEXPECTED_STOP_THRESHOLD_METERS
          const isNearLastDelivered = lastDeliveredPos
            ? distanceMeters(courierPos, lastDeliveredPos) <= UNEXPECTED_STOP_THRESHOLD_METERS
            : false

          const isStopped = typeof item.speed === 'number' && item.speed <= 2
          const isUnexpectedStop =
            !isGpsFrozen &&
            hasActiveRouteStarted &&
            isStopped &&
            !isNearBase &&
            !isNearNextTarget &&
            !isNearLastDelivered

          // ETA: Quando congelado, não projetar estimativas fictícias
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
          const etaNextDeliveryTime = formatTimeInTz(etaNextDeliveryDate)
          const etaReturnBaseTime = formatTimeInTz(etaReturnBaseDate)

          // Configuração de jornada da empresa para cálculo de carga horária e janela de almoço
          const shiftConfig: WorkShiftConfig | undefined = appSettings
            ? {
                workStartTime: appSettings.work_start_time,
                lunchStartTime: appSettings.lunch_start_time,
                lunchEndTime: appSettings.lunch_end_time,
                workEndTime: appSettings.work_end_time,
              }
            : undefined

          // Cálculo do tempo estimado da rota inteira e cruzamento com a carga horária
          const shiftMetrics = calculateRouteWorkShift(
            etaMinutesReturnBase,
            primaryOrder.route_started_at ||
              primaryOrder.route_released_at ||
              primaryOrder.created ||
              undefined,
            nowTime,
            shiftConfig,
          )

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
            isGpsFrozen,
            isDeviated,
            consecutiveDeviations,
            deviationMeters: Math.round(nearest.distanceMeters),
            nearestPointOnRoute: nearest.nearestPoint,
            isUnexpectedStop,
            etaMinutes: isGpsFrozen ? undefined : etaMinutesNextClient,
            etaNextDeliveryTime: isGpsFrozen
              ? undefined
              : pendingStopsList.length > 0
                ? etaNextDeliveryTime
                : undefined,
            etaReturnBaseMinutes: isGpsFrozen ? undefined : etaMinutesReturnBase,
            etaReturnBaseTime: isGpsFrozen ? undefined : etaReturnBaseTime,
            remainingRouteMinutes: shiftMetrics.remainingRouteMinutes,
            projectedEndTime: shiftMetrics.projectedEndTime,
            projectedEndTimeFormatted: isGpsFrozen
              ? 'Aguardando sinal...'
              : shiftMetrics.projectedEndTimeFormatted,
            isOvertime: shiftMetrics.isOvertime,
            overtimeMinutes: shiftMetrics.overtimeMinutes,
            shiftMetrics,
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
      }

      // Concorrência limitada a 4 em voo via asyncPool existente
      const rawResults = await asyncPool(4, activeRouteCouriers, computeCourierRoute)
      const results = rawResults.filter(Boolean) as any[]
      if (isCurrent) {
        setActiveRoutesData(results)

        // 3. Alerta sonoro de exceção na Torre com deduplicação por Set:
        // Ao detectar desvio (isDeviated) ou parada fora do local / atraso relevante (isUnexpectedStop ou ETA > 60 min em entrega in_transit)
        const currentActiveEventKeys = new Set<string>()

        results.forEach((r) => {
          const courierId = r.courierId
          const orderId = r.orderId
          const courierName = r.courier?.name || r.courier?.email || 'Entregador'

          // Caso de desvio: suprimido se o entregador estiver com posição congelada (>2min)
          if (r.isDeviated && !r.isGpsFrozen) {
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

          // Caso de parada fora do local: suprimido se congelado
          if (r.isUnexpectedStop && !r.isGpsFrozen) {
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

          // Caso de atraso relevante (ETA > 60 min em entrega em trânsito): suprimido se congelado
          if (typeof r.etaMinutes === 'number' && r.etaMinutes > 60 && !r.isGpsFrozen) {
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
          const locTime = parseSafeTimestamp(courierItem.location_timestamp)
          const isGpsDisabled = courierItem.gps_status === 'disabled'
          const isPermissionDenied =
            courierItem.gps_reason === 'permission_denied' ||
            (isGpsDisabled && courierItem.gps_reason !== 'unsupported')
          const isSignalLost =
            courierItem.gps_status === 'offline' ||
            (locTime > 0 &&
              Date.now() - locTime > 5 * 60 * 1000 &&
              !(courierItem.gps_status === 'active' && courierItem.offline_buffered === false))

          if (isGpsDisabled) {
            const gpsKey = `gps-disabled-${courierId}`
            currentActiveEventKeys.add(gpsKey)
            if (!notifiedEventsRef.current.has(gpsKey)) {
              notifiedEventsRef.current.add(gpsKey)
              playOffRouteWarningSound()
              toast({
                title: isPermissionDenied
                  ? '🚫 PERMISSÃO DE GPS NEGADA'
                  : '📡 GPS DESLIGADO NA ROTA',
                description: isPermissionDenied
                  ? `${courierName}: permissão de localização negada no aparelho/Safari!`
                  : `${courierName} está com o GPS desligado no aparelho!`,
                variant: 'destructive',
              })
            }
          } else if (isSignalLost) {
            const signalKey = `signal-lost-${courierId}`
            currentActiveEventKeys.add(signalKey)
            // Notificação única e informativa sem som repetitivo estridente
            if (!notifiedEventsRef.current.has(signalKey)) {
              notifiedEventsRef.current.add(signalKey)
              toast({
                title: '📴 POSIÇÃO CONGELADA NA ROTA',
                description: `${courierName}: sem novos pings GPS há mais de 2 minutos. Cálculos de desvio pausados.`,
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
      // Desacoplamento do primeiro paint: executa via requestIdleCallback (fallback setTimeout 500ms)
      // para que os cards e pins apareçam primeiro antes do trabalho pesado viário (OSRM/Directions)
      const runDeferred = () => {
        if (!isCurrent) return
        setIsComputingRoutes(true)
        computeActiveRoutes().finally(() => {
          if (isCurrent) setIsComputingRoutes(false)
        })
      }

      if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
        const idleId = (window as any).requestIdleCallback(runDeferred, { timeout: 1500 })
        return () => {
          isCurrent = false
          if ((window as any).cancelIdleCallback) {
            ;(window as any).cancelIdleCallback(idleId)
          }
        }
      } else {
        debounceTimer = setTimeout(runDeferred, 500)
        return () => {
          isCurrent = false
          if (debounceTimer) {
            clearTimeout(debounceTimer)
          }
        }
      }
    } else {
      setActiveRoutesData([])
      setIsComputingRoutes(false)
      notifiedEventsRef.current.clear()
    }

    return () => {
      isCurrent = false
      if (debounceTimer) {
        clearTimeout(debounceTimer)
      }
    }
  }, [activeRouteCouriers, recentDeviations, toast, appSettings])

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
        courier_id: item.courier.id,
        hasActiveRoute: true,
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
        remainingRouteMinutes: routeInfo?.remainingRouteMinutes,
        projectedEndTimeFormatted: routeInfo?.projectedEndTimeFormatted,
        isOvertime: routeInfo?.isOvertime,
        overtimeMinutes: routeInfo?.overtimeMinutes,
        battery_level: item.battery_level,
        location_timestamp: item.location_timestamp,
        gps_status: item.gps_status as 'active' | 'disabled' | 'offline' | undefined,
        gps_reason: item.gps_reason,
        offline_buffered: item.offline_buffered,
      })
    })

    // 2. Destinos de entregas em rota ativa (marcador laranja com nome e número de sequência)
    // REQUISITO ESTRITO: um pedido só gera pin se TODAS as condições:
    // status !== 'delivered' && status !== 'cancelled' && route_started === true && route_finished !== true
    // E o courier vinculado está no conjunto de entregadores com rota ativa (activeRouteCouriers)
    const activeRouteCourierIdSet = new Set(activeRouteCouriers.map((c) => c.courier.id))

    todayOrders
      .filter((o) => {
        return (
          o.status !== 'delivered' &&
          o.status !== 'cancelled' &&
          o.route_started === true &&
          o.route_finished !== true &&
          Boolean(o.courier_id && activeRouteCourierIdSet.has(o.courier_id))
        )
      })
      .forEach((order) => {
        const cust = order.expand?.customer_id
        if (cust?.lat && cust?.lng) {
          const courier = order.expand?.courier_id
          const isTransit = order.status === 'in_transit' || order.route_started
          const routeInfo = activeRoutesData.find((r) => r.orderId === order.id)
          const etaSuffix = routeInfo ? ` • Prazo ETA: ~${routeInfo.etaMinutes} min` : ''
          const seqText = order.sequence ? `[#${order.sequence}] ` : ''
          const courierId = order.courier_id || courier?.id
          const courierColor = getCourierRouteColor(courierId)

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
            courier_id: courierId,
            pinColorOverride: courierColor.stroke,
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
      // Se cat for null (ex: pedido cancelado de dia anterior que escapou), descartar do Kanban
      if (!cat) return false

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
  }, [todayOrders, statusFilter, courierFilter, searchQuery, operationalWindow])

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
      if (cat) {
        grouped[cat].push(o)
      }
    })

    // Sort: sequence ascending, or created desc
    Object.keys(grouped).forEach((k) => {
      grouped[k as KanbanColumnKey].sort((a, b) => {
        if (a.sequence && b.sequence) return a.sequence - b.sequence
        return (b.created || '').localeCompare(a.created || '')
      })
    })

    return grouped
  }, [filteredOrders, operationalWindow])

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

    const newMarkers: any[] = []
    const bounds = new win.google.maps.LatLngBounds()
    let hasCoords = false

    // OTIMIZAÇÃO: Reutilizar e mutar polylines existentes via setPath em vez de destruir/recriar
    const currentRouteCourierIds = new Set(
      mapDisplayMode === 'delivered' ? [] : activeRoutesData.map((r) => r.courierId),
    )

    // Limpar do mapa polylines de entregadores que não estão mais ativos
    activePolylinesMapRef.current.forEach((lines, cId) => {
      if (!currentRouteCourierIds.has(cId)) {
        lines.main?.setMap(null)
        lines.inner?.setMap(null)
        lines.returnLeg?.setMap(null)
        lines.dev?.setMap(null)
        activePolylinesMapRef.current.delete(cId)
      }
    })

    // No modo 'delivered', não desenhamos as linhas viárias ativas nem linhas de desvio
    if (mapDisplayMode !== 'delivered') {
      // 1. DESENHAR/MUTAR ROTAS REAIS VIÁRIAS NO GOOGLE MAPS NATIVO
      activeRoutesData.forEach((routeData) => {
        const cId = routeData.courierId
        const fPoints = routeData.forwardPoints || routeData.points
        const hasForward = fPoints && fPoints.length >= 2
        const rawFPath = hasForward ? fPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })) : []

        const retPoints = routeData.returnPoints
        const hasReturn = retPoints && retPoints.length >= 2
        const rawRetPath = hasReturn ? retPoints.map((p: any) => ({ lat: p.lat, lng: p.lng })) : []

        const hasDev = Boolean(routeData.isDeviated && routeData.nearestPointOnRoute)
        const rawDevPath = hasDev
          ? [
              { lat: routeData.courierPos.lat, lng: routeData.courierPos.lng },
              { lat: routeData.nearestPointOnRoute.lat, lng: routeData.nearestPointOnRoute.lng },
            ]
          : []

        const courierColor = getCourierRouteColor(cId)
        let lines = activePolylinesMapRef.current.get(cId)

        if (lines) {
          // Mutar polylines existentes com setPath sem recriar
          if (hasForward) {
            if (!lines.main || !lines.inner) {
              // Rota nasceu só com perna de retorno; criar as linhas principais agora
              if (lines.main) lines.main?.setMap(null)
              if (lines.inner) lines.inner?.setMap(null)
              lines.main = new win.google.maps.Polyline({
                path: rawFPath,
                geodesic: true,
                strokeColor: courierColor.stroke,
                strokeOpacity: 0.95,
                strokeWeight: 5,
                map,
              })
              lines.inner = new win.google.maps.Polyline({
                path: rawFPath,
                geodesic: true,
                strokeColor: courierColor.inner,
                strokeOpacity: 0.85,
                strokeWeight: 2,
                map,
              })
            } else {
              lines.main?.setMap(map)
              lines.main.setPath(rawFPath)
              try {
                lines.main.setOptions({ strokeColor: courierColor.stroke })
              } catch {
                /* safe ignore */
              }
              lines.inner?.setMap(map)
              lines.inner.setPath(rawFPath)
              try {
                lines.inner.setOptions({ strokeColor: courierColor.inner })
              } catch {
                /* safe ignore */
              }
            }
            fPoints.forEach((p: any) => bounds.extend(p))
            hasCoords = true
          } else {
            lines.main?.setMap(null)
            lines.inner?.setMap(null)
          }

          if (hasReturn) {
            if (!lines.returnLeg) {
              lines.returnLeg = new win.google.maps.Polyline({
                path: rawRetPath,
                geodesic: true,
                strokeColor: courierColor.returnLeg,
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
            } else {
              lines.returnLeg?.setMap(map)
              lines.returnLeg.setPath(rawRetPath)
              try {
                lines.returnLeg.setOptions({ strokeColor: courierColor.returnLeg })
              } catch {
                /* safe ignore */
              }
            }
            retPoints.forEach((p: any) => bounds.extend(p))
          } else if (lines.returnLeg) {
            lines.returnLeg?.setMap(null)
          }

          if (hasDev) {
            if (!lines.dev) {
              lines.dev = new win.google.maps.Polyline({
                path: rawDevPath,
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
            } else {
              lines.dev?.setMap(map)
              lines.dev.setPath(rawDevPath)
            }
          } else if (lines.dev) {
            lines.dev?.setMap(null)
          }
        } else if (hasForward || hasReturn) {
          // Criar polylines pela primeira vez para este entregador (mesmo se só tiver perna de retorno)
          let mainPolyline: any = null
          let innerPolyline: any = null

          if (hasForward) {
            mainPolyline = new win.google.maps.Polyline({
              path: rawFPath,
              geodesic: true,
              strokeColor: courierColor.stroke,
              strokeOpacity: 0.95,
              strokeWeight: 5,
              map,
            })
            innerPolyline = new win.google.maps.Polyline({
              path: rawFPath,
              geodesic: true,
              strokeColor: courierColor.inner,
              strokeOpacity: 0.85,
              strokeWeight: 2,
              map,
            })
            fPoints.forEach((p: any) => bounds.extend(p))
            hasCoords = true
          }

          let returnPolyline: any = null
          if (hasReturn) {
            returnPolyline = new win.google.maps.Polyline({
              path: rawRetPath,
              geodesic: true,
              strokeColor: courierColor.returnLeg,
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
            retPoints.forEach((p: any) => bounds.extend(p))
            hasCoords = true
          }

          let devPolyline: any = null
          if (hasDev) {
            devPolyline = new win.google.maps.Polyline({
              path: rawDevPath,
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
          }

          activePolylinesMapRef.current.set(cId, {
            main: mainPolyline,
            inner: innerPolyline,
            returnLeg: returnPolyline,
            dev: devPolyline,
          })
        }

        // Base Marker se presente (atualizado no lugar em vez de destruir/recriar)
        if (routeData.basePos) {
          const baseKey = `base-${cId}`
          let baseMarker = baseMarkersMapRef.current.get(baseKey)
          const baseTitle = `🟢 Base de Partida (${routeData.courier.name})`
          if (baseMarker) {
            baseMarker.setMap(map)
            baseMarker.setPosition(routeData.basePos)
            baseMarker.setTitle(baseTitle)
          } else {
            baseMarker = new win.google.maps.Marker({
              position: routeData.basePos,
              map,
              title: baseTitle,
              icon: {
                path: win.google.maps.SymbolPath.CIRCLE,
                scale: 7,
                fillColor: '#10B981',
                fillOpacity: 1,
                strokeWeight: 2,
                strokeColor: '#FFFFFF',
              },
            })
            baseMarkersMapRef.current.set(baseKey, baseMarker)
          }
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

    const makeNativeCustomerSvg = (
      customerName?: string,
      seq?: number,
      isTransit = false,
      pinColorOverride?: string,
    ) => {
      // Pin compacto sem texto aberto para evitar sobreposição caótica de etiquetas
      const generated = makeCustomerSvgIcon(
        customerName,
        seq,
        isTransit,
        72,
        42,
        pinColorOverride,
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
    }

    // InfoWindow reutilizável para hover nos marcadores do Google Maps nativo
    const hoverInfoWindow = new win.google.maps.InfoWindow({
      disableAutoPan: true,
    })

    if (mapDisplayMode === 'delivered') {
      // Pins: Apenas entregas concluídas ('order_delivered') com pin verde
      // Atualizar marcadores existentes no lugar em vez de destruir/recriar
      const activeDeliveredOrderIds = new Set<string>()

      todayOrders
        .filter((o) => o.status === 'delivered')
        .forEach((order) => {
          const cust = order.expand?.customer_id
          if (cust?.lat && cust?.lng) {
            const destPos = { lat: cust.lat, lng: cust.lng }
            bounds.extend(destPos)
            hasCoords = true
            activeDeliveredOrderIds.add(order.id)

            const seqText = order.sequence ? `[Parada #${order.sequence}] ` : ''
            const markerTitle = `✓ ${seqText}Entregue: ${cust.name || 'Cliente'} (${order.tracking_code})`
            const markerIcon = (() => {
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
            })()

            let destMarker = customerMarkersMapRef.current.get(order.id)
            if (destMarker) {
              destMarker.setMap(map)
              destMarker.setPosition(destPos)
              destMarker.setTitle(markerTitle)
              destMarker.setIcon(markerIcon)
            } else {
              destMarker = new win.google.maps.Marker({
                position: destPos,
                map,
                title: markerTitle,
                icon: markerIcon,
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

              customerMarkersMapRef.current.set(order.id, destMarker)
            }

            newMarkers.push(destMarker)
          }
        })

      // Limpar marcadores de clientes que não estão mais nesta exibição
      customerMarkersMapRef.current.forEach((marker, oId) => {
        if (!activeDeliveredOrderIds.has(oId)) {
          marker.setMap(null)
          customerMarkersMapRef.current.delete(oId)
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

        const courierColor = getCourierRouteColor(item.courier.id)
        const routeInfo = activeRoutesData.find((r) => r.courierId === item.courier.id)
        const isDeviated = routeInfo?.isDeviated ?? false
        const isStoppedOut = routeInfo?.isUnexpectedStop ?? false

        // Cor do marcador do entregador: destaque vermelho para desvio, âmbar para parada fora do local, ou cor estável do entregador
        const pinColor = isDeviated
          ? '#EF4444'
          : isStoppedOut
            ? '#F59E0B'
            : item.statusColor === 'red'
              ? '#EF4444'
              : courierColor.stroke

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

            // Se houve mudança de posição significativa (> 0.00001 graus), animar suave e rápido (~700ms)
            if (Math.abs(deltaLat) > 0.00001 || Math.abs(deltaLng) > 0.00001) {
              const prevAnim = courierAnimFramesRef.current.get(item.courier.id)
              if (prevAnim) cancelAnimationFrame(prevAnim)

              const animStartTime = performance.now()
              const duration = 700 // 700ms para resposta em tempo real

              const step = (now: number) => {
                const elapsed = now - animStartTime
                const progress = Math.min(1, elapsed / duration)
                // Easing linear/leve
                const ease = progress

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

          // Status do GPS por idade do ponto (> 5 minutos = off/sem sinal)
          // Pings com gps_status 'active' e offline_buffered false = sinal vivo
          let isGpsActive = false
          if (item.location_timestamp) {
            const locTime = parseSafeTimestamp(item.location_timestamp)
            if (locTime > 0) {
              isGpsActive =
                (item.gps_status === 'active' && item.offline_buffered === false) ||
                Date.now() - locTime <= 5 * 60 * 1000
            }
          } else {
            // Se tem coordenadas recentes associadas a item
            isGpsActive = true
          }

          // No iOS/iPhone e em aparelhos sem Battery API, battery_level reporta 0 ou undefined.
          // Tratar 0 ou <= 0 como "desconhecida" (hasBattery = false) para não alarmar o operador com bateria 0% falsa.
          const hasBattery =
            typeof item.battery_level === 'number' &&
            !isNaN(item.battery_level) &&
            item.battery_level > 0
          const batteryVal = Math.round(item.battery_level || 0)
          const batteryColor =
            batteryVal <= 20 ? '#dc2626' : batteryVal <= 50 ? '#d97706' : '#16a34a'

          const locTime = parseSafeTimestamp(item.location_timestamp)
          const minutesSinceLastPoint = locTime ? Math.floor((Date.now() - locTime) / 60000) : 0
          const isOutdated =
            locTime > 0 &&
            Date.now() - locTime > 5 * 60 * 1000 &&
            !(item.gps_status === 'active' && item.offline_buffered === false)
          const isGpsDisabled = item.gps_status === 'disabled'
          const isSignalLost = item.gps_status === 'offline' || isOutdated

          let gpsBadgeText = '📡 GPS ativo'
          let gpsBadgeBg = '#ecfdf5'
          let gpsBadgeColor = '#047857'
          let gpsBadgeBorder = '#a7f3d0'

          if (isGpsDisabled) {
            if (item.gps_reason === 'permission_denied') {
              gpsBadgeText = '🚫 Permissão negada no aparelho'
            } else {
              gpsBadgeText = '📡 GPS desligado'
            }
            gpsBadgeBg = '#fef2f2'
            gpsBadgeColor = '#b91c1c'
            gpsBadgeBorder = '#fecaca'
          } else if (isSignalLost) {
            const locTimeFormatted = formatTimeInTz(locTime, true)
            gpsBadgeText = `📴 Posição congelada às ${locTimeFormatted}`
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
                : `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; padding: 2px 5px; border-radius: 4px;" title="Bateria não disponível">
                <span>🔋</span> —
              </span>
            `
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
            !isSignalLost && isDeviated && routeInfo?.deviationMeters
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
              📍 Endereço ${isSignalLost ? 'Último Ponto Gravado' : 'Atual em Tempo Real'}:
            </span>
            <span style="font-size: 10.5px; color: #1e293b; font-weight: 500; display: block; line-height: 1.3;">
              ${addressText}
            </span>
          </div>

          ${
            isSignalLost
              ? `
            <div style="background-color: #fffbeb; border-radius: 6px; padding: 5px 7px; margin-top: 4px; border: 1px solid #fde68a;">
              <div style="font-size: 10px; color: #b45309; font-weight: 700;">
                📴 Posição congelada • Aguardando sinal...
              </div>
            </div>
          `
              : routeInfo?.etaNextDeliveryTime || routeInfo?.etaReturnBaseTime
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

      // Pins: Destinos das entregas em rota ativa (Google Maps nativo)
      // REQUISITO ESTRITO: um pedido só gera pin se TODAS as condições:
      // status !== 'delivered' && status !== 'cancelled' && route_started === true && route_finished !== true
      // E o courier vinculado está no conjunto de entregadores com rota ativa (activeRouteCouriers)
      const nativeActiveCourierIds = new Set(activeRouteCouriers.map((c) => c.courier.id))

      const activeTransitOrderIds = new Set<string>()

      todayOrders
        .filter((o) => {
          return (
            o.status !== 'delivered' &&
            o.status !== 'cancelled' &&
            o.route_started === true &&
            o.route_finished !== true &&
            Boolean(o.courier_id && nativeActiveCourierIds.has(o.courier_id))
          )
        })
        .forEach((order) => {
          const cust = order.expand?.customer_id
          if (cust?.lat && cust?.lng) {
            const destPos = { lat: cust.lat, lng: cust.lng }
            bounds.extend(destPos)
            hasCoords = true
            activeTransitOrderIds.add(order.id)

            const isTransit = order.status === 'in_transit' || order.route_started
            const routeInfo = activeRoutesData.find((r) => r.orderId === order.id)
            const etaText = routeInfo ? ` • ETA: ~${routeInfo.etaMinutes} min` : ''
            const seqText = order.sequence ? `[Parada #${order.sequence}] ` : ''
            const courierId = order.courier_id || order.expand?.courier_id?.id
            const courierColor = getCourierRouteColor(courierId)
            const markerTitle = `🏁 ${seqText}Destino: ${cust.name || 'Cliente'} (${order.tracking_code})${etaText}`
            const markerIcon = makeNativeCustomerSvg(
              cust.name,
              order.sequence,
              isTransit,
              courierColor.stroke,
            )

            let destMarker = customerMarkersMapRef.current.get(order.id)
            if (destMarker) {
              destMarker.setMap(map)
              destMarker.setPosition(destPos)
              destMarker.setTitle(markerTitle)
              destMarker.setIcon(markerIcon)
            } else {
              destMarker = new win.google.maps.Marker({
                position: destPos,
                map,
                title: markerTitle,
                icon: markerIcon,
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

              customerMarkersMapRef.current.set(order.id, destMarker)
            }

            newMarkers.push(destMarker)
          }
        })

      // Limpar marcadores de destinos que não estão mais nesta exibição
      customerMarkersMapRef.current.forEach((marker, oId) => {
        if (!activeTransitOrderIds.has(oId)) {
          marker.setMap(null)
          customerMarkersMapRef.current.delete(oId)
        }
      })
    }

    // Limpar bases órfãs
    const activeBaseCourierIds = new Set(
      mapDisplayMode === 'delivered' ? [] : activeRoutesData.map((r) => `base-${r.courierId}`),
    )
    baseMarkersMapRef.current.forEach((marker, baseKey) => {
      if (!activeBaseCourierIds.has(baseKey)) {
        marker.setMap(null)
        baseMarkersMapRef.current.delete(baseKey)
      }
    })

    setMarkersRef(newMarkers)

    // (a) fitBounds apenas no primeiro carregamento, nunca a cada ping subsequente
    if (hasCoords && newMarkers.length > 0 && !hasInitialFitRef.current) {
      hasInitialFitRef.current = true
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
    const courierDrawerColor = getCourierRouteColor(
      selectedOrder.courier_id || orderCourierInfo?.courier?.id,
    )

    const makeMiniCourierSvg = (vehicle?: string, pinColor = courierDrawerColor.stroke) => {
      const generated = makeCourierSvgIcon(vehicle, pinColor, 40)
      return {
        url: generated.url,
        scaledSize: new win.google.maps.Size(40, 40),
        anchor: new win.google.maps.Point(20, 20),
      }
    }

    const makeMiniCustomerSvg = (
      customerName?: string,
      seq?: number,
      pinColor = courierDrawerColor.stroke,
    ) => {
      const generated = makeCustomerSvgIcon(customerName, seq, true, 110, 48, pinColor)
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
        icon: makeMiniCourierSvg(courierData.courier.vehicle_type, courierDrawerColor.stroke),
      })
      drawerMarkersRef.current.push(courierMarker)
    }

    // 3. Cliente destino pin (highlighted com nome visível e número de sequência na mesma cor do entregador)
    if (cust?.lat && cust?.lng) {
      const clientPos = { lat: cust.lat, lng: cust.lng }
      bounds.extend(clientPos)
      pathCoordinates.push(clientPos)

      const clientMarker = new win.google.maps.Marker({
        position: clientPos,
        map: miniMap,
        title: `Cliente: ${cust.name}`,
        icon: makeMiniCustomerSvg(cust.name, selectedOrder.sequence, courierDrawerColor.stroke),
      })
      drawerMarkersRef.current.push(clientMarker)
    }

    // Limpar polilinhas antigas de desvio
    if (drawerDeviationPolylineRef.current) {
      drawerDeviationPolylineRef.current.setMap(null)
      drawerDeviationPolylineRef.current = null
    }

    // Desenhar a rota indicada pelo sistema na cor fixa do entregador
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
        strokeColor: courierDrawerColor.stroke,
        strokeOpacity: 0.9,
        strokeWeight: 5,
      })
      polyline.setMap(miniMap)
      drawerPolylineRef.current = polyline
    }

    // Verificar se o entregador está em desvio de rota e desenhar LINHA VERMELHA
    // REQUISITO ESTRITO: Linha vermelha apenas quando hasActiveRouteStarted && isDeviated
    // Só avaliar se rota iniciada e não finalizada e pedido não entregue/cancelado
    const isSelectedOrderInActiveRoute =
      Boolean(selectedOrder.route_started) &&
      selectedOrder.route_finished !== true &&
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

      const courierLocList = locations.filter((l) => l.user_id === courierData.courier.id)
      const latestLocForDrawer =
        courierLocList.length > 1
          ? [...courierLocList].sort(
              (a, b) =>
                parseSafeTimestamp(b.updated || b.created) -
                parseSafeTimestamp(a.updated || a.created),
            )[0]
          : courierLocList[0]

      const locAgeMs =
        Date.now() -
        (latestLocForDrawer
          ? parseSafeTimestamp(latestLocForDrawer.updated || latestLocForDrawer.created)
          : 0)
      const isGpsRecent = locAgeMs <= 3 * 60 * 1000

      const isOffRoute =
        isSelectedOrderInActiveRoute &&
        isGpsRecent &&
        (hasSystemDeviationEvent || nearest.distanceMeters > DEVIATION_THRESHOLD_METERS)
      const isDeviatedStrict = isSelectedOrderInActiveRoute && isOffRoute
      setDrawerDeviationInfo({
        isDeviated: isDeviatedStrict,
        meters: Math.round(nearest.distanceMeters),
      })

      // Detectar parada fora do local: verificar distância ao cliente destino, à base e ao último cliente entregue
      const distToCust =
        cust?.lat && cust?.lng
          ? distanceMeters(courierPoint, { lat: cust.lat, lng: cust.lng })
          : 999
      const basePoint: LatLngPoint = {
        lat: selectedOrder.start_base_lat ? Number(selectedOrder.start_base_lat) : -22.6990563,
        lng: selectedOrder.start_base_lng ? Number(selectedOrder.start_base_lng) : -43.296723,
      }
      const distToDrawerBase = distanceMeters(courierPoint, basePoint)
      const isSpeedZero = typeof courierData.speed === 'number' && courierData.speed <= 2
      const isFarFromCust = distToCust > UNEXPECTED_STOP_THRESHOLD_METERS
      const isFarFromDrawerBase = distToDrawerBase > UNEXPECTED_STOP_THRESHOLD_METERS

      // Verificar se o entregador está próximo (<=600m) ao último cliente entregue
      const lastDeliveredOrder = courierRouteOrders
        .filter((o) => o.status === 'delivered')
        .slice(-1)[0]
      const lastDeliveredPos =
        lastDeliveredOrder?.expand?.customer_id?.lat && lastDeliveredOrder?.expand?.customer_id?.lng
          ? {
              lat: Number(lastDeliveredOrder.expand.customer_id.lat),
              lng: Number(lastDeliveredOrder.expand.customer_id.lng),
            }
          : null
      const isNearLastDeliveredInDrawer = lastDeliveredPos
        ? distanceMeters(courierPoint, lastDeliveredPos) <= UNEXPECTED_STOP_THRESHOLD_METERS
        : false

      setDrawerUnexpectedStop(
        isSelectedOrderInActiveRoute &&
          isSpeedZero &&
          isFarFromCust &&
          isFarFromDrawerBase &&
          !isNearLastDeliveredInDrawer,
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
      const formatted = formatTimeInTz(order.estimated_arrival)
      if (formatted && formatted !== '--:--') {
        return `Entrega ~${formatted}`
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
        <ControlTowerDeliveredNotice
          notice={latestDeliveredNotice}
          orders={orders}
          onOpenOrderDetails={handleOpenOrderDetails}
          onDismiss={() => setLatestDeliveredNotice(null)}
        />
      )}

      {/* 1. VUUPT-INSPIRED HERO BANNER "ACOMPANHE EM TEMPO REAL" */}
      <ControlTowerHeroBanner
        metrics={metrics}
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        lastUpdated={lastUpdated}
        isLoading={isLoading}
        onRefresh={() => {
          if (onRefresh) {
            onRefresh()
          } else {
            setIsLoading(true)
            fetchData().finally(() => setIsLoading(false))
          }
        }}
      />

      {/* 2. BARRA DE FILTROS & BUSCA RÁPIDA */}
      <ControlTowerFilters
        statusFilter={statusFilter}
        setStatusFilter={setStatusFilter}
        courierFilter={courierFilter}
        setCourierFilter={setCourierFilter}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        couriers={couriers}
      />

      {/* Indicador sutil de cálculo de rotas em segundo plano */}
      {isComputingRoutes && (
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-blue-950/60 border border-blue-500/30 text-blue-300 text-xs animate-pulse">
          <span className="h-2 w-2 rounded-full bg-blue-400 animate-ping" />
          <span>Calculando traçado viário e previsões de rotas...</span>
        </div>
      )}

      {/* 3. KANBAN LOGÍSTICO (COLUNAS HORIZONTAIS ESTILO VUUPT) */}
      {(activeTab === 'kanban' || activeTab === 'split') && (
        <ControlTowerColumns
          kanbanColumnsData={kanbanColumnsData}
          filteredOrdersCount={filteredOrders.length}
          latestDeliveredNotice={latestDeliveredNotice}
          activeRoutesData={activeRoutesData}
          onOpenOrderDetails={handleOpenOrderDetails}
        />
      )}

      {/* 4. MAPA DE TELEMETRIA EM TEMPO REAL */}
      {(activeTab === 'map' || activeTab === 'split') && (
        <ControlTowerMap
          mapContainerRef={mapContainerRef}
          mapsLoaded={mapsLoaded}
          mapsError={mapsError}
          handleRetryMaps={handleRetryMaps}
          mapDisplayMode={mapDisplayMode}
          setMapDisplayMode={setMapDisplayMode}
          activeRouteCouriers={activeRouteCouriers}
          metrics={metrics}
          activeRoutesData={activeRoutesData}
          setSelectedCourier={setSelectedCourier}
          isDeviationBannerDismissed={isDeviationBannerDismissed}
          setIsDeviationBannerDismissed={setIsDeviationBannerDismissed}
          isStopBannerDismissed={isStopBannerDismissed}
          setIsStopBannerDismissed={setIsStopBannerDismissed}
          dismissedGpsAlertIds={dismissedGpsAlertIds}
          setDismissedGpsAlertIds={setDismissedGpsAlertIds}
          isLegendExpanded={isLegendExpanded}
          setIsLegendExpanded={setIsLegendExpanded}
          controlTowerMapMarkers={controlTowerMapMarkers}
          couriers={couriers}
          orders={orders}
          handleOpenOrderDetails={handleOpenOrderDetails}
        />
      )}

      {/* 5, 6 & 7. MODALS: DETALHES DO PEDIDO, CONFIRMAÇÃO DE REMOÇÃO E DETALHES DO ENTREGADOR */}
      <ControlTowerModals
        isDrawerOpen={isDrawerOpen}
        setIsDrawerOpen={setIsDrawerOpen}
        selectedOrder={selectedOrder}
        orderCourierInfo={orderCourierInfo}
        copiedCode={copiedCode}
        copyTracking={copyTracking}
        openWhatsApp={openWhatsApp}
        makePhoneCall={makePhoneCall}
        activeRoutesData={activeRoutesData}
        shareTrackingViaWhatsApp={shareTrackingViaWhatsApp}
        drawerDeviationInfo={drawerDeviationInfo}
        drawerUnexpectedStop={drawerUnexpectedStop}
        drawerReview={drawerReview}
        drawerMiniMapRef={drawerMiniMapRef}
        mapsLoaded={mapsLoaded}
        mapsError={mapsError}
        drawerMapFailed={drawerMapFailed}
        drawerTilesLoaded={drawerTilesLoaded}
        streetRoute={streetRoute}
        recentDeviations={recentDeviations}
        handleRetryMaps={handleRetryMaps}
        isLoadingStreetRoute={isLoadingStreetRoute}
        courierRouteOrders={courierRouteOrders}
        handleOpenOrderDetails={handleOpenOrderDetails}
        setOrderToRemoveFromRoute={setOrderToRemoveFromRoute}
        orderToRemoveFromRoute={orderToRemoveFromRoute}
        isRemovingOrderFromRoute={isRemovingOrderFromRoute}
        handleConfirmRemoveOrderFromRoute={handleConfirmRemoveOrderFromRoute}
        selectedCourier={selectedCourier}
        setSelectedCourier={setSelectedCourier}
        allCourierData={allCourierData}
        locations={locations}
        appSettings={appSettings}
        fetchData={fetchData}
        onRefresh={onRefresh}
        toast={toast}
        deliveryService={deliveryService}
      />
    </div>
  )
}

/* REMOVED_DUPLICATE_DRAWER_MODALS_START */
// Modais do drawer e entregador migrados para o componente ControlTowerModals
/* REMOVED_DUPLICATE_DRAWER_MODALS_END */

export const ControlTower: React.FC<ControlTowerProps> = (props) => {
  return (
    <ControlTowerErrorBoundary>
      <ControlTowerInner {...props} />
    </ControlTowerErrorBoundary>
  )
}

export default ControlTower
