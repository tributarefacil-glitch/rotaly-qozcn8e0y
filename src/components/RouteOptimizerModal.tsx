import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Sparkles,
  Truck,
  MapPin,
  Clock,
  Navigation,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  RefreshCw,
  Users,
  User,
  ChevronRight,
  ArrowRight,
  Zap,
  RotateCcw,
  Check,
  Building,
  Edit3,
  Plus,
  Play,
  ArrowUp,
  ArrowDown,
  Trash2,
  Pencil,
  UserPlus,
  Fuel,
  Gauge,
  Package,
  Flag,
  Move,
  GripVertical,
  Search,
  ChevronDown,
  Phone,
  FileText,
  Loader2,
  X,
  Compass,
  Ban,
} from 'lucide-react'
import { fetchStreetRoute, type LatLngPoint } from '@/services/osrmRoutingService'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import { CreateCustomerModal } from '@/components/CreateCustomerModal'
import {
  BaseAddressAutocomplete,
  type BaseAddressResult,
} from '@/components/BaseAddressAutocomplete'
import type {
  OrderRecord,
  UserRecord,
  CustomerRecord,
  LocationRecord,
  CourierOptimizationPlan,
  MultiCourierOptimizationResult,
  OptimizedStop,
  AppSettingsRecord,
  BaseAddressRecord,
} from '@/types/delivery'
import {
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
  fallbackGeocodeAddress,
} from '@/lib/googleMaps'
import {
  calculateRouteWorkShift,
  formatRemainingDuration,
  type RouteWorkShiftMetrics,
} from '@/lib/routeWorkShift'
import {
  optimizeRouteSequence,
  type StopCandidate,
  areAddressesOnSameStreet,
  calcDistanceMeters,
} from '@/services/intelligentRoadRouter'
import { toast } from 'sonner'

interface RouteOptimizerModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  orders: OrderRecord[]
  couriers: UserRecord[]
  customers: CustomerRecord[]
  locations: LocationRecord[]
  onRoutesApplied: () => void
}

// Visual color palette for distinct courier routes
const COURIER_PALETTE = [
  {
    name: 'Roxo Elétrico',
    color: '#8b5cf6',
    stroke: '#7c3aed',
    bg: 'bg-purple-500/10 text-purple-700 border-purple-300 dark:text-purple-300',
  },
  {
    name: 'Azul Real',
    color: '#2563eb',
    stroke: '#1d4ed8',
    bg: 'bg-blue-500/10 text-blue-700 border-blue-300 dark:text-blue-300',
  },
  {
    name: 'Esmeralda',
    color: '#059669',
    stroke: '#047857',
    bg: 'bg-emerald-500/10 text-emerald-700 border-emerald-300 dark:text-emerald-300',
  },
  {
    name: 'Âmbar Solar',
    color: '#d97706',
    stroke: '#b45309',
    bg: 'bg-amber-500/10 text-amber-700 border-amber-300 dark:text-amber-300',
  },
  {
    name: 'Rosa Vibrante',
    color: '#db2777',
    stroke: '#be185d',
    bg: 'bg-pink-500/10 text-pink-700 border-pink-300 dark:text-pink-300',
  },
  {
    name: 'Ciano',
    color: '#0891b2',
    stroke: '#0e7490',
    bg: 'bg-cyan-500/10 text-cyan-700 border-cyan-300 dark:text-cyan-300',
  },
]

// Distância máxima permitida em linha reta (Haversine) entre a base de saída e o centróide das entregas
const MAX_BASE_TO_CENTROID_DISTANCE_KM = 100

// Haversine distance in meters
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

export const RouteOptimizerModal: React.FC<RouteOptimizerModalProps> = ({
  open,
  onOpenChange,
  orders: initialOrders,
  couriers,
  customers: initialCustomers,
  locations,
  onRoutesApplied,
}) => {
  // Estado local sincronizado de pedidos e clientes para atualização e exclusão instantâneas no modal
  const [localOrders, setLocalOrders] = useState<OrderRecord[]>(initialOrders)
  const [localCustomers, setLocalCustomers] = useState<CustomerRecord[]>(initialCustomers)

  useEffect(() => {
    setLocalOrders(initialOrders)
  }, [initialOrders])

  useEffect(() => {
    setLocalCustomers(initialCustomers)
  }, [initialCustomers])

  // Estados para Edição e Exclusão de Clientes na Etapa 2
  const [customerToEdit, setCustomerToEdit] = useState<CustomerRecord | null>(null)
  const [isEditCustomerModalOpen, setIsEditCustomerModalOpen] = useState(false)
  const [customerToDelete, setCustomerToDelete] = useState<CustomerRecord | null>(null)
  const [isDeletingCustomer, setIsDeletingCustomer] = useState(false)

  // Selected available couriers (ids) - ETAPA 1
  const [selectedCourierIds, setSelectedCourierIds] = useState<string[]>([])

  // Selected pending orders to optimize (ids) - ETAPA 2 (Seleção dos Clientes/Entregas)
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([])
  const [searchOrderFilter, setSearchOrderFilter] = useState<string>('')

  // Pending orders eligible for routing optimization
  // Regras de Negócio:
  // 1. Somente clientes com venda/entrega PENDENTE cadastrada pelo vendedor (pedidos criados e ainda não incluídos em rota liberada/atribuída). Cliente sem venda/entrega pendente NÃO aparece.
  // 2. Após "Salvar & Liberar Rota", as entregas incluídas na rota SAEM da Etapa 2 (não aparecem mais como pendentes na busca de uma nova otimização).
  // 3. Se a rota for desfeita/cancelada e a entrega voltar para pendente (sem rota liberada nem iniciada), ela reaparece na busca.
  // 4. REOTIMIZAÇÃO: Pedidos já selecionados (selectedOrderIds) que pertencem a uma rota que está sendo reotimizada também ficam disponíveis na Etapa 2.
  const pendingOrders = useMemo(() => {
    return localOrders.filter((o) => {
      // Pedidos entregues ou cancelados nunca devem aparecer
      if (o.status === 'delivered' || o.status === 'cancelled') return false
      // Se este pedido foi pré-selecionado para reotimização de rota, mantê-lo visível na Etapa 2!
      if (selectedOrderIds.includes(o.id)) return true
      // Se a rota foi liberada (route_released = true), NÃO aparece na Etapa 2
      if (o.route_released) return false
      // Se a rota já foi iniciada pelo entregador, NÃO aparece
      if (o.route_started) return false
      // Se já estiver em trânsito ou finalizado, não aparece
      if (o.status === 'in_transit' || o.status === 'address_error' || o.status === 'client_absent')
        return false
      // Se já foi atribuído e salvo para um entregador (status 'assigned' com courier_id), já está em rota salva
      if (o.status === 'assigned' && Boolean(o.courier_id)) return false
      // Retorna pedidos pendentes de roteirização
      return o.status === 'pending' || !o.courier_id
    })
  }, [localOrders, selectedOrderIds])

  // Wizard active step: 'couriers' | 'orders' | 'review'
  const [wizardStep, setWizardStep] = useState<'couriers' | 'orders' | 'review'>('couriers')

  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [activeCourierTab, setActiveCourierTab] = useState<string>('all')
  const [searchCourierFilter, setSearchCourierFilter] = useState<string>('')
  const [vehicleFilter, setVehicleFilter] = useState<string>('all')

  // App Settings for Fuel Calculation
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(null)

  // Base Addresses (Regras 3, 4 e 5: Cadastro e Edição de Base e Endereço Final)
  const [baseAddresses, setBaseAddresses] = useState<BaseAddressRecord[]>([])
  const [selectedStartBaseId, setSelectedStartBaseId] = useState<string>('')
  const [selectedEndBaseId, setSelectedEndBaseId] = useState<string>('')
  const [isEditingBases, setIsEditingBases] = useState(false)
  const [newBaseName, setNewBaseName] = useState('')
  const [newBaseAddress, setNewBaseAddress] = useState('')
  const [newBaseLat, setNewBaseLat] = useState<number | null>(null)
  const [newBaseLng, setNewBaseLng] = useState<number | null>(null)
  const [newBaseType, setNewBaseType] = useState<'base' | 'end_point'>('base')
  const [isCreatingBase, setIsCreatingBase] = useState(false)

  // Busca e Seleção do Ponto de Partida (Bases + Clientes por Nome, Telefone, CPF e CNPJ)
  const [startPointSearchQuery, setStartPointSearchQuery] = useState('')
  const [isStartPointDropdownOpen, setIsStartPointDropdownOpen] = useState(false)
  const [endPointSearchQuery, setEndPointSearchQuery] = useState('')
  const [isEndPointDropdownOpen, setIsEndPointDropdownOpen] = useState(false)
  const [isGeocodingStartCustomer, setIsGeocodingStartCustomer] = useState(false)
  const [startPointGeocodeWarning, setStartPointGeocodeWarning] = useState<string | null>(null)
  const startPointDropdownRef = useRef<HTMLDivElement>(null)
  const endPointDropdownRef = useRef<HTMLDivElement>(null)

  // Optimization Result
  const [optimizationResult, setOptimizationResult] =
    useState<MultiCourierOptimizationResult | null>(null)

  // Blindagem / Confirmação de distância excessiva entre a Base de Saída e as entregas (> 100 km)
  const [distanceAlertOpen, setDistanceAlertOpen] = useState(false)
  const [distanceAlertInfo, setDistanceAlertInfo] = useState<{
    distanceKm: number
    baseName: string
    baseAddress: string
  } | null>(null)

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersAndPolylinesRef = useRef<any[]>([])
  const [isMapsLoaded, setIsMapsLoaded] = useState(false)
  const [mapsAuthError, setMapsAuthError] = useState(() => isGoogleMapsAuthError())
  // Detecta se os tiles reais do Google Maps foram pintados dentro do tempo limite
  const [mapTilesLoaded, setMapTilesLoaded] = useState(false)
  const [vectorFallbackActive, setVectorFallbackActive] = useState(false)
  const tilesLoadedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Drag interativo no mapa vetorial (fallback)
  const [draggingStop, setDraggingStop] = useState<{
    courierId: string
    stopId: string
    initialLat: number
    initialLng: number
    currentLat: number
    currentLng: number
  } | null>(null)
  const vectorCanvasRef = useRef<HTMLDivElement>(null)

  const getGoogle = () =>
    typeof window !== 'undefined' ? (window as unknown as { google?: any }).google : undefined

  // Regra do Usuário: "ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL"
  // Verificar se um entregador tem rota em andamento (iniciada e ainda não finalizada na base)
  const isCourierWithActiveRoute = useCallback(
    (courierId: string) => {
      return localOrders.some(
        (o) =>
          o.courier_id === courierId &&
          o.route_started === true &&
          (o.route_finished === false ||
            o.route_finished === null ||
            o.route_finished === undefined),
      )
    },
    [localOrders],
  )

  // ==========================================
  // ESPECIFICAÇÃO: ROTAS ATIVAS & LIBERADAS EM ANDAMENTO
  // Agrupar pedidos locais por courier_id para exibir na Etapa 1
  // ==========================================
  interface ActiveCourierRouteGroup {
    courier: UserRecord
    orders: OrderRecord[]
    pendingStops: OrderRecord[]
    deliveredStops: OrderRecord[]
    isStarted: boolean
    isReleased: boolean
    isReturningToBase: boolean
  }

  const activeCourierRoutes = useMemo((): ActiveCourierRouteGroup[] => {
    // Agrupar pedidos que estão com rota liberada ou iniciada e não finalizados
    const groupsMap = new Map<string, OrderRecord[]>()

    localOrders.forEach((order) => {
      if (!order.courier_id) return
      if (order.status === 'cancelled') return
      if (order.route_finished === true) return

      // Deve ser uma rota liberada ou já iniciada
      const isRel = order.route_released === true
      const isStart = order.route_started === true
      if (!isRel && !isStart) return

      const list = groupsMap.get(order.courier_id) || []
      list.push(order)
      groupsMap.set(order.courier_id, list)
    })

    const result: ActiveCourierRouteGroup[] = []

    groupsMap.forEach((ordersList, courierId) => {
      const courier = couriers.find((c) => c.id === courierId)
      if (!courier) return

      // Ordenar por sequência
      ordersList.sort((a, b) => (a.sequence || 0) - (b.sequence || 0))

      const pendingStops = ordersList.filter((o) => o.status !== 'delivered')
      const deliveredStops = ordersList.filter((o) => o.status === 'delivered')

      const isStarted = ordersList.some((o) => o.route_started === true)
      const isReleased = ordersList.some((o) => o.route_released === true)
      // Se todas as entregas foram concluídas mas a rota ainda não foi finalizada na base
      const isReturningToBase = isStarted && pendingStops.length === 0 && deliveredStops.length > 0

      // Só adiciona se houver paradas pendentes OU se estiver retornando à base
      if (pendingStops.length > 0 || isReturningToBase) {
        result.push({
          courier,
          orders: ordersList,
          pendingStops,
          deliveredStops,
          isStarted,
          isReleased,
          isReturningToBase,
        })
      }
    })

    return result
  }, [localOrders, couriers])

  // Modais de ação para Rotas Ativas
  const [includeOrderModalOpen, setIncludeOrderModalOpen] = useState(false)
  const [targetCourierForInclude, setTargetCourierForInclude] = useState<UserRecord | null>(null)
  const [selectedIncludeOrderId, setSelectedIncludeOrderId] = useState<string>('')
  const [isSubmittingInclude, setIsSubmittingInclude] = useState(false)

  const [cancelRouteAlertOpen, setCancelRouteAlertOpen] = useState(false)
  const [targetCourierForCancel, setTargetCourierForCancel] = useState<UserRecord | null>(null)
  const [isSubmittingCancel, setIsSubmittingCancel] = useState(false)

  // Abrir modal de inclusão de cliente em rota ativa
  const handleOpenIncludeCustomerModal = (courier: UserRecord) => {
    setTargetCourierForInclude(courier)
    setSelectedIncludeOrderId('')
    setIncludeOrderModalOpen(true)
  }

  // Executar inclusão de cliente em rota ativa
  const handleConfirmIncludeCustomer = async () => {
    if (!targetCourierForInclude || !selectedIncludeOrderId) {
      toast.error('Selecione uma entrega para incluir na rota.')
      return
    }

    try {
      setIsSubmittingInclude(true)
      const res = await deliveryService.addOrderToActiveRoute({
        orderId: selectedIncludeOrderId,
        courierId: targetCourierForInclude.id,
        settings: appSettings,
      })

      // Atualizar localOrders instantaneamente
      setLocalOrders((prev) =>
        prev.map((o) => (o.id === res.order.id ? { ...o, ...res.order } : o)),
      )

      // Remover o id incluído de selectedOrderIds se estivesse marcado
      setSelectedOrderIds((prev) => prev.filter((id) => id !== selectedIncludeOrderId))

      toast.success(
        `Cliente incluído com sucesso na rota de ${targetCourierForInclude.name}! Parada #${res.order.sequence}`,
      )
      setIncludeOrderModalOpen(false)
      setTargetCourierForInclude(null)
      setSelectedIncludeOrderId('')
      onRoutesApplied()
    } catch (err: any) {
      console.error('Erro ao incluir cliente na rota ativa:', err)
      toast.error(`Falha ao incluir cliente na rota: ${err?.message || 'Erro desconhecido'}`)
    } finally {
      setIsSubmittingInclude(false)
    }
  }

  // Abrir confirmação de cancelamento de rota ativa
  const handleOpenCancelRouteConfirm = (courier: UserRecord) => {
    setTargetCourierForCancel(courier)
    setCancelRouteAlertOpen(true)
  }

  // Confirmar cancelamento da rota ativa
  const handleConfirmCancelRoute = async () => {
    if (!targetCourierForCancel) return

    try {
      setIsSubmittingCancel(true)
      const res = await deliveryService.cancelActiveRoute(targetCourierForCancel.id)

      // Atualizar localOrders no estado: pedidos pendentes deste courier voltam a pending
      setLocalOrders((prev) =>
        prev.map((o) => {
          if (
            o.courier_id === targetCourierForCancel.id &&
            o.status !== 'delivered' &&
            o.status !== 'cancelled'
          ) {
            return {
              ...o,
              courier_id: undefined,
              status: 'pending',
              sequence: undefined,
              route_released: false,
              route_released_at: undefined,
              route_started: false,
              route_started_at: undefined,
              route_finished: false,
              route_finished_at: undefined,
            }
          }
          return o
        }),
      )

      toast.success(
        `Rota de ${targetCourierForCancel.name} cancelada! ${res.cancelledOrdersCount} entrega(s) voltaram para a Etapa 2.` +
          (res.preservedOrdersCount > 0
            ? ` (${res.preservedOrdersCount} entrega(s) concluída(s) preservada(s))`
            : ''),
      )

      setCancelRouteAlertOpen(false)
      setTargetCourierForCancel(null)
      onRoutesApplied()
    } catch (err: any) {
      console.error('Erro ao cancelar rota ativa:', err)
      toast.error(`Falha ao cancelar rota: ${err?.message || 'Erro desconhecido'}`)
    } finally {
      setIsSubmittingCancel(false)
    }
  }

  // Pedidos disponíveis para inclusão avulsa em rota ativa:
  // Deve listar TODOS os pedidos pendentes disponíveis, incluindo os que estão atualmente
  // selecionados/marcados na Etapa 2 (selectedOrderIds) ou pendentes sem rota ativa/liberada.
  const strictlyPendingOrders = useMemo(() => {
    return localOrders.filter((o) => {
      if (o.status === 'delivered' || o.status === 'cancelled') return false
      // Se já está com rota liberada ou já iniciada, já está rodando em outra rota ativa
      if (o.route_released || o.route_started) return false
      if (o.status === 'in_transit' || o.status === 'address_error' || o.status === 'client_absent')
        return false
      // Se está marcado na Etapa 2 atual do otimizador, está disponível para inclusão avulsa
      if (selectedOrderIds.includes(o.id)) return true
      // Se já foi atribuído a um entregador e não está marcado para reotimização/Etapa 2
      if (o.status === 'assigned' && Boolean(o.courier_id)) return false
      // Pedido pendente ou sem entregador
      return o.status === 'pending' || !o.courier_id
    })
  }, [localOrders, selectedOrderIds])

  // Reotimizar Rota: pré-seleciona o entregador na Etapa 1 e as paradas pendentes da rota na Etapa 2
  const handleReoptimizeRoute = (routeGroup: ActiveCourierRouteGroup) => {
    // 1. Selecionar o entregador na Etapa 1
    setSelectedCourierIds([routeGroup.courier.id])

    // 2. Selecionar os pedidos pendentes dessa rota na Etapa 2
    const pendingIds = routeGroup.pendingStops.map((o) => o.id)
    setSelectedOrderIds(pendingIds)

    // 3. Mudar wizard para a Etapa 2 para o vendedor poder ver/acrescentar mais vendas
    setWizardStep('orders')
    toast.info(
      `Rota de ${routeGroup.courier.name} carregada (${pendingIds.length} parada(s) pendente(s))! Você pode marcar novas entregas e avançar para a Etapa 3.`,
    )
  }

  const wasOpenRef = useRef(false)

  // Initialize selected couriers and load app settings when opened
  useEffect(() => {
    if (open) {
      // Re-sincronizar seleção SEMPRE que couriers carregar/mudar:
      // Se couriers chegou com dados e nenhum entregador está selecionado ainda, popular automaticamente
      if (couriers.length > 0 && selectedCourierIds.length === 0) {
        const availableIds = couriers.filter((c) => c.status !== 'inactive').map((c) => c.id)
        setSelectedCourierIds(
          availableIds.length > 0 ? availableIds : couriers.slice(0, 3).map((c) => c.id),
        )
      }

      if (!wasOpenRef.current) {
        // ETAPA 2: Abre vazia sem clientes pré-marcados; vendedor busca e marca os pedidos
        setSelectedOrderIds([])
        setSearchOrderFilter('')
        setWizardStep('couriers')
        setOptimizationResult(null)
        deliveryService.getSettings().then((s) => setAppSettings(s))
        deliveryService.getBaseAddresses().then((bases) => {
          setBaseAddresses(bases)
          const defaultStart = bases.find((b) => b.is_default) || bases[0]
          const defaultEnd =
            bases.find((b) => b.is_end_default || b.type === 'end_point') || defaultStart
          if (defaultStart) setSelectedStartBaseId(defaultStart.id)
          if (defaultEnd) setSelectedEndBaseId(defaultEnd.id)
        })
        setMapTilesLoaded(false)
        setVectorFallbackActive(false)
        loadGoogleMapsScript().then((success) => {
          const isAuthErr = isGoogleMapsAuthError()
          const ok = success && !isAuthErr
          setIsMapsLoaded(ok)
          setMapsAuthError(isAuthErr)
        })
      }
    } else {
      if (tilesLoadedTimeoutRef.current) {
        clearTimeout(tilesLoadedTimeoutRef.current)
        tilesLoadedTimeoutRef.current = null
      }
      setDraggingStop(null)
    }
    wasOpenRef.current = open
  }, [open, couriers, selectedCourierIds.length])

  // Assinar realtime da coleção app_settings para refletir qualquer alteração de jornada na hora
  useRealtime<AppSettingsRecord>(
    'app_settings',
    (e) => {
      if (e.action === 'create' || e.action === 'update') {
        setAppSettings(e.record)
      }
    },
    open,
  )

  useEffect(() => {
    const unsub = onGoogleMapsAuthError(() => {
      setMapsAuthError(true)
      setIsMapsLoaded(false)
      setVectorFallbackActive(true)
    })
    return unsub
  }, [])

  // Fechar dropdowns de busca ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        startPointDropdownRef.current &&
        !startPointDropdownRef.current.contains(e.target as Node)
      ) {
        setIsStartPointDropdownOpen(false)
      }
      if (endPointDropdownRef.current && !endPointDropdownRef.current.contains(e.target as Node)) {
        setIsEndPointDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const toggleCourierSelection = (id: string) => {
    setSelectedCourierIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const selectAllCouriers = () => {
    const eligible = filteredCouriers.map((c) => c.id)
    setSelectedCourierIds(eligible)
  }

  const deselectAllCouriers = () => {
    setSelectedCourierIds([])
  }

  const selectOnlyCourier = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelectedCourierIds([id])
  }

  // Filtered couriers for smart search & filtering
  const filteredCouriers = useMemo(() => {
    return couriers.filter((c) => {
      const matchesSearch =
        c.name.toLowerCase().includes(searchCourierFilter.toLowerCase()) ||
        (c.vehicle_model || '').toLowerCase().includes(searchCourierFilter.toLowerCase()) ||
        (c.vehicle_plate || '').toLowerCase().includes(searchCourierFilter.toLowerCase())
      const courierVeh = deliveryService.normalizeVehicleCategory(c.vehicle_type || 'moto')
      const targetVeh =
        vehicleFilter === 'all' ? 'all' : deliveryService.normalizeVehicleCategory(vehicleFilter)
      const matchesVehicle = vehicleFilter === 'all' || courierVeh === targetVeh
      return matchesSearch && matchesVehicle
    })
  }, [couriers, searchCourierFilter, vehicleFilter])

  // Toggle/Select Orders for Step 2
  const toggleOrderSelection = (id: string) => {
    setSelectedOrderIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const selectAllOrders = () => {
    if (filteredPendingOrders.length === 0) return
    const idsToAdd = filteredPendingOrders.map((o) => o.id)
    setSelectedOrderIds((prev) => Array.from(new Set([...prev, ...idsToAdd])))
  }

  const deselectAllOrders = () => {
    if (searchOrderFilter.trim()) {
      const idsToRemove = new Set(filteredPendingOrders.map((o) => o.id))
      setSelectedOrderIds((prev) => prev.filter((id) => !idsToRemove.has(id)))
    } else {
      setSelectedOrderIds([])
    }
  }

  // Filtered pending orders for Step 2
  // Regra Atualizada: Não abre mais vazia! Todas as entregas com venda pendente aparecem visíveis de cara.
  // O campo de busca funciona como filtro OPCIONAL em tempo real por Nome, CPF, CNPJ, Telefone e Rastreio.
  // Entregas pendentes com cliente recém-criado ou com dados via expand aparecem normalmente.
  const filteredPendingOrders = useMemo(() => {
    const q = searchOrderFilter.toLowerCase().trim()
    if (!q) return pendingOrders

    const digits = searchOrderFilter.replace(/\D/g, '')

    return pendingOrders.filter((o) => {
      // 1. Código de rastreio ou id
      if (o.tracking_code && o.tracking_code.toLowerCase().includes(q)) return true
      if (o.id && o.id.toLowerCase().includes(q)) return true

      // Localizar cliente local ou expand
      const cust = localCustomers.find((c) => c.id === o.customer_id) || o.expand?.customer_id

      if (!cust) {
        // Se ainda não encontrou o cliente no array nem no expand, ainda permite buscar por rastreio (já checado acima)
        return false
      }

      // 2. Nome do cliente
      if (cust.name && cust.name.toLowerCase().includes(q)) return true

      // 3. Documento (CPF / CNPJ) - com e sem máscara
      if (cust.document) {
        if (cust.document.toLowerCase().includes(q)) return true
        if (digits && cust.document.replace(/\D/g, '').includes(digits)) return true
      }

      // 4. Telefones (phone, phone2, phone3) - com e sem máscara
      const phones = [cust.phone, (cust as any).phone2, (cust as any).phone3].filter(
        Boolean,
      ) as string[]
      for (const p of phones) {
        if (p.toLowerCase().includes(q)) return true
        if (digits && p.replace(/\D/g, '').includes(digits)) return true
      }

      // 5. Endereço (bônus útil para localização do cliente)
      if (cust.address && cust.address.toLowerCase().includes(q)) return true

      return false
    })
  }, [pendingOrders, localCustomers, searchOrderFilter])

  // Helper para resolver informações do Ponto de Partida ou Chegada
  // Seja uma Base (id puro) ou um Cliente (prefixo "cust_")
  const resolveLocationEntity = useCallback(
    (
      id: string,
    ): {
      id: string
      type: 'base' | 'customer'
      name: string
      address: string
      lat?: number
      lng?: number
      phone?: string
      document?: string
      isDefault?: boolean
    } | null => {
      if (!id) return null

      if (id.startsWith('cust_')) {
        const custId = id.replace('cust_', '')
        const cust = localCustomers.find((c) => c.id === custId)
        if (!cust) return null
        return {
          id,
          type: 'customer',
          name: cust.name,
          address: cust.address,
          lat: cust.lat,
          lng: cust.lng,
          phone: cust.phone,
          document: cust.document,
          isDefault: false,
        }
      }

      const base = baseAddresses.find((b) => b.id === id)
      if (base) {
        return {
          id: base.id,
          type: 'base',
          name: base.name,
          address: base.address,
          lat: base.lat,
          lng: base.lng,
          isDefault: base.is_default,
        }
      }

      return null
    },
    [baseAddresses, localCustomers],
  )

  // Entidade de partida selecionada
  const resolvedStartEntity = useMemo(() => {
    const found = resolveLocationEntity(selectedStartBaseId)
    if (found) return found

    // Buscar base padrão nas bases cadastradas antes de qualquer fallback
    const defaultInBases = baseAddresses.find((b) => b.is_default) || baseAddresses[0]
    if (defaultInBases) {
      return {
        id: defaultInBases.id,
        type: 'base' as const,
        name: defaultInBases.name,
        address: defaultInBases.address,
        lat: defaultInBases.lat,
        lng: defaultInBases.lng,
        isDefault: true,
      }
    }

    return {
      id: 'default-base',
      type: 'base' as const,
      name: 'Mais Saudavel',
      address: 'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085',
      lat: -22.7001402,
      lng: -43.2982834,
      isDefault: true,
    }
  }, [resolveLocationEntity, selectedStartBaseId, baseAddresses])

  // Entidade de chegada selecionada
  const resolvedEndEntity = useMemo(() => {
    return resolveLocationEntity(selectedEndBaseId) || resolvedStartEntity
  }, [resolveLocationEntity, selectedEndBaseId, resolvedStartEntity])

  // Itens unificados filtrados para a seleção de Ponto de Partida (Bases + Clientes)
  // Busca em tempo real por NOME, TELEFONE, CPF e CNPJ
  const filteredStartPointOptions = useMemo(() => {
    const q = startPointSearchQuery.toLowerCase().trim()
    const digits = startPointSearchQuery.replace(/\D/g, '')

    // 1. Bases cadastradas
    const basesList = baseAddresses.map((base) => ({
      id: base.id,
      type: 'base' as const,
      name: base.name,
      address: base.address,
      lat: base.lat,
      lng: base.lng,
      isDefault: base.is_default,
      phone: undefined,
      document: undefined,
    }))

    // 2. Clientes cadastrados
    const customersList = localCustomers.map((c) => ({
      id: `cust_${c.id}`,
      type: 'customer' as const,
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      isDefault: false,
      phone: c.phone,
      phone2: c.phone2,
      phone3: c.phone3,
      document: c.document,
    }))

    if (!q) {
      return {
        bases: basesList,
        customers: customersList,
        total: basesList.length + customersList.length,
      }
    }

    const matchesSearch = (item: {
      name: string
      address: string
      phone?: string
      phone2?: string
      phone3?: string
      document?: string
    }) => {
      // Busca textual no Nome e Endereço
      if (item.name.toLowerCase().includes(q)) return true
      if (item.address.toLowerCase().includes(q)) return true

      // Busca no Documento (CPF / CNPJ) formatado ou números limpos
      if (item.document) {
        if (item.document.toLowerCase().includes(q)) return true
        if (digits && item.document.replace(/\D/g, '').includes(digits)) return true
      }

      // Busca nos Telefones (formatados ou apenas dígitos)
      const phones = [item.phone, item.phone2, item.phone3].filter(Boolean) as string[]
      for (const p of phones) {
        if (p.toLowerCase().includes(q)) return true
        if (digits && p.replace(/\D/g, '').includes(digits)) return true
      }

      return false
    }

    const filteredBases = basesList.filter(matchesSearch)
    const filteredCusts = customersList.filter(matchesSearch)

    return {
      bases: filteredBases,
      customers: filteredCusts,
      total: filteredBases.length + filteredCusts.length,
    }
  }, [baseAddresses, localCustomers, startPointSearchQuery])

  // Itens unificados filtrados para a seleção de Ponto de Chegada
  const filteredEndPointOptions = useMemo(() => {
    const q = endPointSearchQuery.toLowerCase().trim()
    const digits = endPointSearchQuery.replace(/\D/g, '')

    const basesList = baseAddresses.map((base) => ({
      id: base.id,
      type: 'base' as const,
      name: base.name,
      address: base.address,
      lat: base.lat,
      lng: base.lng,
      isDefault: base.is_default,
      phone: undefined,
      document: undefined,
    }))

    const customersList = localCustomers.map((c) => ({
      id: `cust_${c.id}`,
      type: 'customer' as const,
      name: c.name,
      address: c.address,
      lat: c.lat,
      lng: c.lng,
      isDefault: false,
      phone: c.phone,
      phone2: c.phone2,
      phone3: c.phone3,
      document: c.document,
    }))

    if (!q) {
      return {
        bases: basesList,
        customers: customersList,
        total: basesList.length + customersList.length,
      }
    }

    const matchesSearch = (item: {
      name: string
      address: string
      phone?: string
      phone2?: string
      phone3?: string
      document?: string
    }) => {
      if (item.name.toLowerCase().includes(q)) return true
      if (item.address.toLowerCase().includes(q)) return true
      if (item.document) {
        if (item.document.toLowerCase().includes(q)) return true
        if (digits && item.document.replace(/\D/g, '').includes(digits)) return true
      }
      const phones = [item.phone, item.phone2, item.phone3].filter(Boolean) as string[]
      for (const p of phones) {
        if (p.toLowerCase().includes(q)) return true
        if (digits && p.replace(/\D/g, '').includes(digits)) return true
      }
      return false
    }

    const filteredBases = basesList.filter(matchesSearch)
    const filteredCusts = customersList.filter(matchesSearch)

    return {
      bases: filteredBases,
      customers: filteredCusts,
      total: filteredBases.length + filteredCusts.length,
    }
  }, [baseAddresses, localCustomers, endPointSearchQuery])

  // Ação ao selecionar um ponto de partida (com geocodificação automática e validação)
  const handleSelectStartPoint = async (option: {
    id: string
    type: 'base' | 'customer'
    name: string
    address: string
    lat?: number
    lng?: number
  }) => {
    setStartPointGeocodeWarning(null)
    setSelectedStartBaseId(option.id)
    setIsStartPointDropdownOpen(false)
    setStartPointSearchQuery('')

    // Se for cliente e não tiver coordenadas lat/lng, tenta geocodificar pelo endereço
    if (option.type === 'customer' && (!option.lat || !option.lng)) {
      if (!option.address || option.address.trim().length < 5) {
        const warning = `O cliente "${option.name}" não possui endereço completo nem coordenadas cadastradas. Cadastre o endereço para usar como ponto de partida.`
        setStartPointGeocodeWarning(warning)
        toast.warning(warning)
        return
      }

      setIsGeocodingStartCustomer(true)
      toast.info(`Geocodificando endereço de "${option.name}"...`)
      try {
        const geo = await fallbackGeocodeAddress(option.address)
        if (geo && typeof geo.lat === 'number' && typeof geo.lng === 'number') {
          // Atualiza as coordenadas do cliente no PocketBase para persistência
          const rawCustId = option.id.replace('cust_', '')
          await deliveryService.updateCustomer(rawCustId, {
            lat: geo.lat,
            lng: geo.lng,
          })
          // Atualiza o estado local de customers
          setLocalCustomers((prev) =>
            prev.map((c) => (c.id === rawCustId ? { ...c, lat: geo.lat, lng: geo.lng } : c)),
          )
          toast.success(
            `Localização de "${option.name}" obtida com sucesso (${geo.lat.toFixed(4)}, ${geo.lng.toFixed(4)})!`,
          )
        } else {
          const warning = `Não foi possível geocodificar o endereço de "${option.name}". Verifique o cadastro do cliente.`
          setStartPointGeocodeWarning(warning)
          toast.error(warning)
        }
      } catch (e) {
        console.warn('Geocoding error for start customer:', e)
        const warning = `Erro ao geocodificar endereço de "${option.name}".`
        setStartPointGeocodeWarning(warning)
        toast.error(warning)
      } finally {
        setIsGeocodingStartCustomer(false)
      }
    }
  }

  // Ação ao selecionar um ponto de chegada
  const handleSelectEndPoint = async (option: {
    id: string
    type: 'base' | 'customer'
    name: string
    address: string
    lat?: number
    lng?: number
  }) => {
    setSelectedEndBaseId(option.id)
    setIsEndPointDropdownOpen(false)
    setEndPointSearchQuery('')

    if (option.type === 'customer' && (!option.lat || !option.lng)) {
      if (option.address && option.address.trim().length >= 5) {
        try {
          const geo = await fallbackGeocodeAddress(option.address)
          if (geo) {
            const rawCustId = option.id.replace('cust_', '')
            await deliveryService.updateCustomer(rawCustId, { lat: geo.lat, lng: geo.lng })
            setLocalCustomers((prev) =>
              prev.map((c) => (c.id === rawCustId ? { ...c, lat: geo.lat, lng: geo.lng } : c)),
            )
          }
        } catch {
          /* intentionally ignored */
        }
      }
    }
  }

  // Recompute plan distances and metrics when stops order changes (Drag or manual shift)
  // Utiliza fator de malha viária urbana (1.28x) e identificação de mesma rua (1.05x)
  const recalculatePlanMetrics = useCallback(
    (
      stops: OptimizedStop[],
      startLat: number,
      startLng: number,
      endLat: number,
      endLng: number,
      courierVehicleType?: string,
    ): {
      updatedStops: OptimizedStop[]
      totalDistKm: string
      outboundKm: number
      returnKm: number
      durationMins: number
      fuelCost: number
    } => {
      let curLat = startLat
      let curLng = startLng
      let cumMeters = 0

      const updatedStops: OptimizedStop[] = stops.map((stop, idx) => {
        const directMeters = haversineDistance(curLat, curLng, stop.lat, stop.lng)
        const prevAddr = idx === 0 ? '' : stops[idx - 1].address
        const isSameStreet = prevAddr ? areAddressesOnSameStreet(prevAddr, stop.address) : false
        const roadFactor = isSameStreet ? 1.05 : 1.28
        const stepDist = Math.round(directMeters * roadFactor)
        cumMeters += stepDist
        curLat = stop.lat
        curLng = stop.lng
        return {
          ...stop,
          step_distance_meters: stepDist,
          cumulative_distance_meters: cumMeters,
        }
      })

      const directReturn = stops.length > 0 ? haversineDistance(curLat, curLng, endLat, endLng) : 0
      const returnMeters = Math.round(directReturn * 1.28)
      const totalMeters = cumMeters + returnMeters
      const outboundKm = Number((cumMeters / 1000).toFixed(2))
      const returnKm = Number((returnMeters / 1000).toFixed(2))
      const totalDistKmNum = Number((totalMeters / 1000).toFixed(2))
      const durationMins = Math.round((totalDistKmNum / 22) * 60 + stops.length * 5)

      const { pricePerLiter, consumptionKml } = deliveryService.getVehicleFuelParams(
        appSettings,
        courierVehicleType,
      )
      const fuelCost = consumptionKml > 0 ? (totalDistKmNum * pricePerLiter) / consumptionKml : 0

      return {
        updatedStops,
        totalDistKm: totalDistKmNum.toFixed(1),
        outboundKm,
        returnKm,
        durationMins,
        fuelCost: Number(fuelCost.toFixed(2)),
      }
    },
    [appSettings],
  )

  // Cache de geometrias de rua reais computadas (OSRM/Google Directions) por entregador/rota
  const [streetRouteGeometries, setStreetRouteGeometries] = useState<
    Record<string, { points: LatLngPoint[]; color: string }>
  >({})
  const [isLoadingStreetRoutes, setIsLoadingStreetRoutes] = useState(false)

  // Deslocamento de parada por drag & drop no mapa: reordena a parada arrastada para a nova posição
  const handleMarkerDragEnd = (
    courierId: string,
    stopId: string,
    newLat: number,
    newLng: number,
  ) => {
    setOptimizationResult((prev) => {
      if (!prev) return prev

      const plan = prev.courierPlans.find((p) => p.courier.id === courierId)
      if (!plan) return prev

      const currentStopIdx = plan.stops.findIndex((s) => s.id === stopId)
      if (currentStopIdx === -1) return prev

      // Atualiza as coordenadas do stop arrastado
      const targetStop = { ...plan.stops[currentStopIdx], lat: newLat, lng: newLng }
      const otherStops = plan.stops.filter((s) => s.id !== stopId)

      // Encontra o melhor ponto de inserção baseado no vizinho mais próximo
      let bestInsertIdx = 0
      let bestDist = Infinity

      for (let i = 0; i <= otherStops.length; i++) {
        const prevPoint =
          i === 0
            ? { lat: plan.start_base?.lat || -22.906847, lng: plan.start_base?.lng || -43.172896 }
            : otherStops[i - 1]
        const nextPoint =
          i === otherStops.length
            ? { lat: plan.end_base?.lat || -22.906847, lng: plan.end_base?.lng || -43.172896 }
            : otherStops[i]

        const d1 = haversineDistance(prevPoint.lat, prevPoint.lng, newLat, newLng)
        const d2 = haversineDistance(newLat, newLng, nextPoint.lat, nextPoint.lng)
        const totalCost = d1 + d2

        if (totalCost < bestDist) {
          bestDist = totalCost
          bestInsertIdx = i
        }
      }

      const reorderedStops = [...otherStops]
      reorderedStops.splice(bestInsertIdx, 0, targetStop)

      let grandTotalDistMeters = 0

      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id !== courierId) {
          grandTotalDistMeters += Number(p.total_distance_km) * 1000
          return p
        }

        const metrics = recalculatePlanMetrics(
          reorderedStops,
          p.start_base?.lat || -22.906847,
          p.start_base?.lng || -43.172896,
          p.end_base?.lat || -22.906847,
          p.end_base?.lng || -43.172896,
          p.courier.vehicle_type,
        )

        grandTotalDistMeters += Number(metrics.totalDistKm) * 1000

        return {
          ...p,
          stops: metrics.updatedStops,
          total_distance_km: metrics.totalDistKm,
          outbound_distance_km: metrics.outboundKm,
          return_distance_km: metrics.returnKm,
          estimated_duration_minutes: metrics.durationMins,
          estimated_fuel_cost: metrics.fuelCost,
        }
      })

      const grandDistKm = (grandTotalDistMeters / 1000).toFixed(1)
      const totalFuel = newPlans.reduce((acc, p) => acc + (p.estimated_fuel_cost || 0), 0)
      const totalMins = newPlans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      return {
        ...prev,
        courierPlans: newPlans,
        totalDistanceKm: grandDistKm,
        totalEstimatedFuelCost: Number(totalFuel.toFixed(2)),
        totalDurationMinutes: totalMins,
      }
    })

    toast.success('Ponto reposicionado na rota e sequência recalculada!')
  }

  // Helper to handle base creation
  const handleCreateNewBase = async () => {
    if (!newBaseName.trim() || !newBaseAddress.trim()) {
      toast.error('Informe o nome e o endereço completo da base / local.')
      return
    }

    setIsCreatingBase(true)
    try {
      let lat = newBaseLat
      let lng = newBaseLng

      // Se não tiver coordenadas do autocomplete, tenta geocodificar com fallback
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        const geo = await fallbackGeocodeAddress(newBaseAddress.trim())
        if (geo) {
          lat = geo.lat
          lng = geo.lng
        } else {
          // Fallback dinâmico: se houver alguma base já cadastrada, usa ela como referência, senão centro do RJ
          const refBase = baseAddresses[0]
          lat = refBase?.lat || -22.906847
          lng = refBase?.lng || -43.172896
        }
      }

      const created = await deliveryService.createBaseAddress({
        name: newBaseName.trim(),
        type: newBaseType,
        address: newBaseAddress.trim(),
        lat,
        lng,
        is_default: baseAddresses.length === 0,
      })

      setBaseAddresses((prev) => [...prev, created])
      if (newBaseType === 'base') {
        setSelectedStartBaseId(created.id)
      } else {
        setSelectedEndBaseId(created.id)
      }
      setNewBaseName('')
      setNewBaseAddress('')
      setNewBaseLat(null)
      setNewBaseLng(null)
      toast.success('Local cadastrado com sucesso!')
    } catch (err) {
      console.error('Erro ao cadastrar base:', err)
      toast.error('Erro ao salvar novo local.')
    } finally {
      setIsCreatingBase(false)
    }
  }

  // Multi-Courier Geographic K-Means Clustering + Nearest Neighbor Sequencing Algorithm (com IDA E VOLTA)
  const runRouteOptimization = async (skipCentroidCheck = false) => {
    if (selectedCourierIds.length === 0) {
      toast.warning('Selecione pelo menos um entregador disponível na Etapa 1.')
      setWizardStep('couriers')
      return
    }

    // Filtra apenas as entregas que o vendedor buscou e selecionou na Etapa 2
    const ordersToOptimize = pendingOrders.filter((o) => selectedOrderIds.includes(o.id))

    if (ordersToOptimize.length === 0) {
      toast.info('Busque e marque pelo menos um cliente/entrega na Etapa 2 para roteirizar.')
      setWizardStep('orders')
      return
    }

    // 1. Determine Start Base and End Base coordinates (suporta tanto BaseAddressRecord quanto CustomerRecord)
    const startEntity = resolvedStartEntity
    const startBase = {
      name: startEntity.name,
      address: startEntity.address,
      lat: startEntity.lat || -22.7001402,
      lng: startEntity.lng || -43.2982834,
    }

    // Blindagem de distância excessiva entre a base padrão de partida e as entregas selecionadas
    if (!skipCentroidCheck) {
      // Coletar coordenadas válidas dos clientes selecionados para calcular o centróide
      const validPoints: Array<{ lat: number; lng: number }> = []
      for (const ord of ordersToOptimize) {
        const cust = localCustomers.find((c) => c.id === ord.customer_id) || ord.expand?.customer_id
        if (
          cust &&
          typeof cust.lat === 'number' &&
          typeof cust.lng === 'number' &&
          !isNaN(cust.lat) &&
          !isNaN(cust.lng)
        ) {
          validPoints.push({ lat: cust.lat, lng: cust.lng })
        }
      }

      if (validPoints.length > 0) {
        const centroidLat = validPoints.reduce((acc, p) => acc + p.lat, 0) / validPoints.length
        const centroidLng = validPoints.reduce((acc, p) => acc + p.lng, 0) / validPoints.length
        const distToCentroidMeters = haversineDistance(
          startBase.lat,
          startBase.lng,
          centroidLat,
          centroidLng,
        )
        const distToCentroidKm = distToCentroidMeters / 1000

        if (distToCentroidKm > MAX_BASE_TO_CENTROID_DISTANCE_KM) {
          const roundedKm = Math.round(distToCentroidKm)
          toast.error(
            `A base de partida "${startBase.name}" está a ${roundedKm} km das entregas!`,
            {
              description:
                'Verifique o cadastro da base ou escolha outra base no seletor de partida.',
              duration: 8000,
            },
          )
          setDistanceAlertInfo({
            distanceKm: roundedKm,
            baseName: startBase.name,
            baseAddress: startBase.address,
          })
          setDistanceAlertOpen(true)
          return
        }
      }
    }

    setIsOptimizing(true)

    try {
      const endEntity = resolvedEndEntity
      const endBase = {
        name: endEntity.name,
        address: endEntity.address,
        lat: endEntity.lat || startBase.lat,
        lng: endEntity.lng || startBase.lng,
      }

      // 2. Prepare courier objects with starting locations (at Start Base or live GPS)
      const selectedCouriers = couriers.filter((c) => selectedCourierIds.includes(c.id))
      const k = selectedCouriers.length

      const courierOrigins = selectedCouriers.map((c) => {
        return {
          courier: c,
          lat: startBase.lat || -22.906847,
          lng: startBase.lng || -43.172896,
        }
      })

      // 2. Prepare orders with valid coordinates
      const validOrdersWithCoords: Array<{
        order: OrderRecord
        lat: number
        lng: number
        customer: CustomerRecord | undefined
      }> = []

      const unassignedWithoutCoords: OrderRecord[] = []

      for (const ord of ordersToOptimize) {
        const cust = localCustomers.find((c) => c.id === ord.customer_id) || ord.expand?.customer_id
        if (cust && cust.lat && cust.lng) {
          validOrdersWithCoords.push({
            order: ord,
            lat: cust.lat,
            lng: cust.lng,
            customer: cust,
          })
        } else {
          // Fallback coords around hub center if missing (usa a base de saída como âncora)
          const hubCenterLat = startBase.lat || -22.906847
          const hubCenterLng = startBase.lng || -43.172896
          const hubLat = hubCenterLat + (Math.random() - 0.5) * 0.02
          const hubLng = hubCenterLng + (Math.random() - 0.5) * 0.02
          validOrdersWithCoords.push({
            order: ord,
            lat: hubLat,
            lng: hubLng,
            customer: cust,
          })
        }
      }

      // 3. OTIMIZAÇÃO POR TIPO DE VEÍCULO (Bicicleta raio <= 3km, Moto mais distantes, múltiplos de Moto balanceados)
      // Classificamos os entregadores selecionados
      const isBike = (c: UserRecord) =>
        c.vehicle_type === 'bicicleta' || c.vehicle_type === 'bicycle'
      const isMoto = (c: UserRecord) => {
        const v = (c.vehicle_type || '').toLowerCase()
        return (
          v === 'moto' ||
          v === 'motocicleta' ||
          (!isBike(c) && v !== 'carro' && v !== 'caminhao' && v !== 'van')
        )
      }

      // Pré-computa a distância de cada pedido em relação à base de saída
      const ordersWithBaseDist = validOrdersWithCoords.map((item) => {
        const distFromBaseMeters = haversineDistance(
          startBase.lat,
          startBase.lng,
          item.lat,
          item.lng,
        )
        return {
          ...item,
          distFromBaseMeters,
          distFromBaseKm: distFromBaseMeters / 1000,
        }
      })

      let clusters: Array<typeof validOrdersWithCoords> = Array.from({ length: k }, () => [])

      const bikeIndices: number[] = []
      const motorizedIndices: number[] = []

      selectedCouriers.forEach((c, idx) => {
        if (isBike(c)) {
          bikeIndices.push(idx)
        } else {
          motorizedIndices.push(idx)
        }
      })

      // REGRA ESPECIAL: Se houver combinação de Bicicleta(s) e Veículos Motorizados (ex: Moto)
      if (bikeIndices.length > 0 && motorizedIndices.length > 0) {
        // Pedidos dentro do raio de 3km da base de saída são elegíveis para bicicleta
        const BIKE_MAX_RADIUS_METERS = 3000

        // Separar pedidos dentro do raio (≤ 3km) e fora do raio (> 3km)
        const insideBikeRadius = ordersWithBaseDist.filter(
          (o) => o.distFromBaseMeters <= BIKE_MAX_RADIUS_METERS,
        )
        const outsideBikeRadius = ordersWithBaseDist.filter(
          (o) => o.distFromBaseMeters > BIKE_MAX_RADIUS_METERS,
        )

        // Se houver pedidos fora do raio, eles DEVEM ir obrigatoriamente para as motos/veículos motorizados
        // Se todos forem <= 3km, as motos também podem receber a fatia restante para não sobrecarregar as bikes
        const bikeCapacityTarget = Math.max(
          1,
          Math.round((validOrdersWithCoords.length * bikeIndices.length) / k),
        )

        // Ordena os pedidos de dentro do raio do mais próximo ao mais distante
        insideBikeRadius.sort((a, b) => a.distFromBaseMeters - b.distFromBaseMeters)

        const ordersForBikes: typeof validOrdersWithCoords = []
        const remainingForMotos: typeof validOrdersWithCoords = [...outsideBikeRadius]

        // Atribui os mais próximos (até a capacidade) para as bicicletas
        for (const item of insideBikeRadius) {
          if (
            ordersForBikes.length < bikeCapacityTarget * bikeIndices.length ||
            remainingForMotos.length >= validOrdersWithCoords.length - ordersForBikes.length
          ) {
            ordersForBikes.push(item)
          } else {
            remainingForMotos.push(item)
          }
        }

        // Se ainda não deu pelo menos 1 pedido para a bike e tem pedidos no raio, garante 1
        if (ordersForBikes.length === 0 && insideBikeRadius.length > 0) {
          ordersForBikes.push(insideBikeRadius[0])
          const idxInRemaining = remainingForMotos.findIndex(
            (o) => o.order.id === insideBikeRadius[0].order.id,
          )
          if (idxInRemaining >= 0) remainingForMotos.splice(idxInRemaining, 1)
        }

        // Se não tiver nenhum pedido <= 3km, mas houver bike, atribui os mais próximos disponíveis para a bike
        if (ordersForBikes.length === 0 && validOrdersWithCoords.length > 0) {
          const sortedAll = [...ordersWithBaseDist].sort(
            (a, b) => a.distFromBaseMeters - b.distFromBaseMeters,
          )
          const takeCount = Math.min(
            sortedAll.length,
            Math.max(1, Math.round(sortedAll.length / k)),
          )
          for (let i = 0; i < takeCount; i++) {
            ordersForBikes.push(sortedAll[i])
          }
          const bikeIds = new Set(ordersForBikes.map((o) => o.order.id))
          remainingForMotos.length = 0
          for (const item of validOrdersWithCoords) {
            if (!bikeIds.has(item.order.id)) remainingForMotos.push(item)
          }
        }

        // Distribuir ordersForBikes entre as bikes (se houver mais de uma)
        if (bikeIndices.length === 1) {
          clusters[bikeIndices[0]] = ordersForBikes
        } else {
          // K-means entre as bikes
          let bikeCentroids = bikeIndices.map((bi) => ({
            lat: courierOrigins[bi].lat,
            lng: courierOrigins[bi].lng,
          }))
          for (let iter = 0; iter < 5; iter++) {
            const subClusters: Array<typeof validOrdersWithCoords> = Array.from(
              { length: bikeIndices.length },
              () => [],
            )
            for (const item of ordersForBikes) {
              let bBest = 0
              let bDist = Infinity
              for (let b = 0; b < bikeIndices.length; b++) {
                const cDist = haversineDistance(
                  item.lat,
                  item.lng,
                  bikeCentroids[b].lat,
                  bikeCentroids[b].lng,
                )
                if (cDist < bDist) {
                  bDist = cDist
                  bBest = b
                }
              }
              subClusters[bBest].push(item)
            }
            bikeCentroids = subClusters.map((sc, b) => {
              if (sc.length === 0) return bikeCentroids[b]
              return {
                lat: sc.reduce((s, o) => s + o.lat, 0) / sc.length,
                lng: sc.reduce((s, o) => s + o.lng, 0) / sc.length,
              }
            })
            if (iter === 4) {
              bikeIndices.forEach((bi, bIdx) => {
                clusters[bi] = subClusters[bIdx]
              })
            }
          }
        }

        // Distribuir remainingForMotos entre as motos/veículos motorizados
        if (motorizedIndices.length === 1) {
          clusters[motorizedIndices[0]] = remainingForMotos
        } else if (motorizedIndices.length > 1) {
          // Dois ou mais entregadores de moto: clusterização geográfica balanceada para menor km rodado
          // Inicializa centróides espaçados ou baseados nas coordenadas dos pedidos mais distantes
          let motoCentroids: Array<{ lat: number; lng: number }> = []

          // Usa K-Means++ initialization para espalhar os centróides das motos e cobrir setores geográficos distintos
          if (remainingForMotos.length > 0) {
            motoCentroids.push({ lat: remainingForMotos[0].lat, lng: remainingForMotos[0].lng })
            while (
              motoCentroids.length < motorizedIndices.length &&
              motoCentroids.length < remainingForMotos.length
            ) {
              let bestCand = remainingForMotos[0]
              let maxMinDist = -1
              for (const ord of remainingForMotos) {
                const minDistToCent = Math.min(
                  ...motoCentroids.map((mc) => haversineDistance(ord.lat, ord.lng, mc.lat, mc.lng)),
                )
                if (minDistToCent > maxMinDist) {
                  maxMinDist = minDistToCent
                  bestCand = ord
                }
              }
              motoCentroids.push({ lat: bestCand.lat, lng: bestCand.lng })
            }
          }
          while (motoCentroids.length < motorizedIndices.length) {
            motoCentroids.push({ lat: startBase.lat, lng: startBase.lng })
          }

          for (let iter = 0; iter < 8; iter++) {
            const subClusters: Array<typeof validOrdersWithCoords> = Array.from(
              { length: motorizedIndices.length },
              () => [],
            )
            for (const item of remainingForMotos) {
              let mBest = 0
              let mScore = Infinity
              for (let m = 0; m < motorizedIndices.length; m++) {
                const cent = motoCentroids[m]
                const dist = haversineDistance(item.lat, item.lng, cent.lat, cent.lng)
                const sizePenalty =
                  1 +
                  (subClusters[m].length /
                    Math.max(1, remainingForMotos.length / motorizedIndices.length)) *
                    0.35
                const score = dist * sizePenalty
                if (score < mScore) {
                  mScore = score
                  mBest = m
                }
              }
              subClusters[mBest].push(item)
            }

            motoCentroids = subClusters.map((sc, m) => {
              if (sc.length === 0) return motoCentroids[m]
              return {
                lat: sc.reduce((s, o) => s + o.lat, 0) / sc.length,
                lng: sc.reduce((s, o) => s + o.lng, 0) / sc.length,
              }
            })

            if (iter === 7) {
              motorizedIndices.forEach((mi, mIdx) => {
                clusters[mi] = subClusters[mIdx]
              })
            }
          }
        }
      } else {
        // CASO PADRÃO: Somente Motos (ou somente Bikes, ou frotas homogêneas)
        // Quando ocorrer dois ou mais entregadores de moto: balancear entregas por proximidade geográfica
        // e menor custo de km rodado (clusterização com K-Means++ e penalidade de capacidade balanceada).
        let centroids = courierOrigins.map((co) => ({ lat: co.lat, lng: co.lng }))

        // Se todos começam no mesmo ponto de partida (startBase), usa K-Means++ para semear os centróides
        // espalhados geograficamente nos pedidos, garantindo agrupamento regional nítido sem sobreposição de rotas
        if (validOrdersWithCoords.length >= k && k > 1) {
          centroids = [{ lat: validOrdersWithCoords[0].lat, lng: validOrdersWithCoords[0].lng }]
          while (centroids.length < k) {
            let bestCandidate = validOrdersWithCoords[0]
            let maxMinDist = -1
            for (const ord of validOrdersWithCoords) {
              const minDist = Math.min(
                ...centroids.map((c) => haversineDistance(ord.lat, ord.lng, c.lat, c.lng)),
              )
              if (minDist > maxMinDist) {
                maxMinDist = minDist
                bestCandidate = ord
              }
            }
            centroids.push({ lat: bestCandidate.lat, lng: bestCandidate.lng })
          }
        }

        const maxIter = 10
        for (let iter = 0; iter < maxIter; iter++) {
          clusters = Array.from({ length: k }, () => [])

          // Assign each order to closest centroid (balanced with capacity weighting)
          for (const item of validOrdersWithCoords) {
            let bestIdx = 0
            let bestDist = Infinity

            for (let ci = 0; ci < k; ci++) {
              const cent = centroids[ci]
              const dist = haversineDistance(item.lat, item.lng, cent.lat, cent.lng)
              // Balance penalty factor based on current cluster size
              const sizePenalty =
                1 + (clusters[ci].length / Math.max(1, validOrdersWithCoords.length / k)) * 0.3
              const score = dist * sizePenalty

              if (score < bestDist) {
                bestDist = score
                bestIdx = ci
              }
            }

            clusters[bestIdx].push(item)
          }

          // Recompute centroids
          centroids = clusters.map((cluster, ci) => {
            if (cluster.length === 0)
              return { lat: courierOrigins[ci].lat, lng: courierOrigins[ci].lng }
            const avgLat = cluster.reduce((sum, item) => sum + item.lat, 0) / cluster.length
            const avgLng = cluster.reduce((sum, item) => sum + item.lng, 0) / cluster.length
            return { lat: avgLat, lng: avgLng }
          })
        }
      }

      // 4. For each courier cluster, sequence stops via Intelligent Road Routing
      // (Google Maps Directions optimize:true + 2-Opt Same-Street Cohesion)
      const plans: CourierOptimizationPlan[] = []
      let grandTotalDistanceMeters = 0

      for (let ci = 0; ci < k; ci++) {
        const courierData = courierOrigins[ci]
        const clusterOrders = clusters[ci]
        const colorItem = COURIER_PALETTE[ci % COURIER_PALETTE.length]

        const originPoint = {
          lat: startBase.lat || -22.906847,
          lng: startBase.lng || -43.172896,
        }
        const destinationPoint = {
          lat: endBase.lat || originPoint.lat,
          lng: endBase.lng || originPoint.lng,
        }

        const candidates: StopCandidate[] = clusterOrders.map((co) => ({
          id: co.order.id,
          tracking_code: co.order.tracking_code,
          priority: co.order.priority || 'normal',
          status: co.order.status,
          customer_name: co.customer?.name || 'Cliente',
          address: co.customer?.address || 'Endereço a confirmar',
          lat: co.lat,
          lng: co.lng,
          rawOrder: co.order,
          rawCustomer: co.customer,
        }))

        const { pricePerLiter: planFuelPrice, consumptionKml: planFuelCons } =
          deliveryService.getVehicleFuelParams(appSettings, courierData.courier.vehicle_type)

        // Roteamento viário inteligente com Google Directions optimize:true e fallback determinístico de rua
        const roadRouteResult = await optimizeRouteSequence({
          origin: originPoint,
          destination: destinationPoint,
          stops: candidates,
          vehicleType: courierData.courier.vehicle_type,
          pricePerLiter: planFuelPrice,
          consumptionKml: planFuelCons,
        })

        const stops: OptimizedStop[] = roadRouteResult.stops.map((s) => ({
          id: s.id,
          tracking_code: s.tracking_code,
          priority: s.priority || 'normal',
          status: s.status || 'pending',
          customer_name: s.customer_name,
          address: s.address,
          lat: s.lat,
          lng: s.lng,
          step_distance_meters: s.step_distance_meters,
          cumulative_distance_meters: s.cumulative_distance_meters,
        }))

        const totalClusterMetersWithReturn = Math.round(roadRouteResult.total_distance_km * 1000)
        grandTotalDistanceMeters += totalClusterMetersWithReturn

        plans.push({
          courier: courierData.courier,
          color: colorItem.color,
          orders: clusterOrders.map((co) => co.order),
          stops,
          total_distance_km: roadRouteResult.total_distance_km.toFixed(1),
          outbound_distance_km: roadRouteResult.outbound_distance_km,
          return_distance_km: roadRouteResult.return_distance_km,
          estimated_duration_minutes: roadRouteResult.estimated_duration_minutes,
          estimated_fuel_cost: roadRouteResult.estimated_fuel_cost,
          start_base: {
            name: startBase.name,
            address: startBase.address,
            lat: startBase.lat || -22.906847,
            lng: startBase.lng || -43.172896,
          },
          end_base: {
            name: endBase.name,
            address: endBase.address,
            lat: endBase.lat || -22.906847,
            lng: endBase.lng || -43.172896,
          },
        })
      }

      const grandDistKm = grandTotalDistanceMeters / 1000
      const totalFuelCost = plans.reduce((acc, p) => acc + (p.estimated_fuel_cost || 0), 0)
      const totalEstDuration = plans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      const finalResult: MultiCourierOptimizationResult = {
        courierPlans: plans,
        unassignedOrders: unassignedWithoutCoords,
        totalOrders: validOrdersWithCoords.length,
        totalDistanceKm: grandDistKm.toFixed(1),
        totalEstimatedFuelCost: Number(totalFuelCost.toFixed(2)),
        totalDurationMinutes: totalEstDuration,
        startBase,
        endBase,
      }

      setOptimizationResult(finalResult)
      setActiveCourierTab('all')
      setWizardStep('review')
      toast.success(
        `✨ ${finalResult.totalOrders} entregas divididas pelo menor trajeto entre ${plans.length} entregadores!`,
      )
    } catch (err) {
      console.error('Optimization calculation error:', err)
      toast.error('Erro ao calcular otimização de rotas.')
    } finally {
      setIsOptimizing(false)
    }
  }

  // Render Visual Routes and Colored Markers on Google Map with Draggable Pins and Start/End Anchors
  useEffect(() => {
    if (!open) return

    const google = getGoogle()
    if (!mapContainerRef.current || !google?.maps || !isMapsLoaded || mapsAuthError) {
      if (mapsAuthError || !isMapsLoaded) {
        setVectorFallbackActive(true)
      }
      return
    }

    try {
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
          center: { lat: -22.7001402, lng: -43.2982834 },
          zoom: 12,
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          styles: [
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            { featureType: 'administrative', stylers: [{ visibility: 'simplified' }] },
          ],
        })

        // Ouvinte de tiles carregados: desativa o fallback vetorial e limpa timeout
        mapInstanceRef.current.addListener('tilesloaded', () => {
          setMapTilesLoaded(true)
          setVectorFallbackActive(false)
          if (tilesLoadedTimeoutRef.current) {
            clearTimeout(tilesLoadedTimeoutRef.current)
            tilesLoadedTimeoutRef.current = null
          }
        })
      } else {
        google.maps.event.trigger(mapInstanceRef.current, 'resize')
      }

      // Timeout de contingência: se em 2.2s tilesloaded não disparar, exibe fallback vetorial
      if (tilesLoadedTimeoutRef.current) {
        clearTimeout(tilesLoadedTimeoutRef.current)
      }
      tilesLoadedTimeoutRef.current = setTimeout(() => {
        // Se após 2.2s os tiles não foram marcados como carregados, ativar fallback vetorial
        setMapTilesLoaded((alreadyLoaded) => {
          if (!alreadyLoaded) {
            setVectorFallbackActive(true)
          }
          return alreadyLoaded
        })
      }, 2200)

      // Clear previous overlays
      markersAndPolylinesRef.current.forEach((obj) => obj.setMap(null))
      markersAndPolylinesRef.current = []

      const bounds = new google.maps.LatLngBounds()
      let hasPoints = false

      if (optimizationResult) {
        // Draw each courier plan with its own color
        optimizationResult.courierPlans.forEach((plan) => {
          const isTabActive = activeCourierTab === 'all' || activeCourierTab === plan.courier.id
          if (!isTabActive) return

          const pathCoords: Array<{ lat: number; lng: number }> = []

          // 1. PONTO DE PARTIDA (Base de Saída do Entregador) - Verde
          const startLat = plan.start_base?.lat || -22.906847
          const startLng = plan.start_base?.lng || -43.172896
          pathCoords.push({ lat: startLat, lng: startLng })
          bounds.extend(new google.maps.LatLng(startLat, startLng))
          hasPoints = true

          const startMarker = new google.maps.Marker({
            position: { lat: startLat, lng: startLng },
            map: mapInstanceRef.current,
            title: `🟢 PARTIDA: ${plan.start_base?.name || 'Base de Saída'} (${plan.courier.name})`,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#10b981', // Emerald green
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#ffffff',
              rotation: 0,
            },
            zIndex: 100,
          })

          const startInfo = new google.maps.InfoWindow({
            content: `
              <div style="padding: 6px; font-family: sans-serif; color: #0f172a;">
                <span style="background: #10b981; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold;">
                  🟢 PONTO DE PARTIDA
                </span>
                <p style="font-weight: bold; margin: 4px 0 2px; font-size: 12px;">${plan.start_base?.name || 'Base'}</p>
                <p style="font-size: 11px; margin: 0; color: #475569;">${plan.start_base?.address || ''}</p>
                <p style="font-size: 10px; margin: 4px 0 0; color: #059669;">Entregador: <b>${plan.courier.name}</b></p>
              </div>
            `,
          })
          startMarker.addListener('click', () =>
            startInfo.open(mapInstanceRef.current, startMarker),
          )
          markersAndPolylinesRef.current.push(startMarker)

          // 2. PARADAS ORDENADAS (Numeradas, com suporte a ARRASTE MANUAL)
          plan.stops.forEach((stop, stopIdx) => {
            pathCoords.push({ lat: stop.lat, lng: stop.lng })
            bounds.extend(new google.maps.LatLng(stop.lat, stop.lng))

            // Marcador arrastável para ajuste manual no mapa
            const stopMarker = new google.maps.Marker({
              position: { lat: stop.lat, lng: stop.lng },
              map: mapInstanceRef.current,
              title: `Parada #${stopIdx + 1}: ${stop.customer_name} (Arraste para ajustar)`,
              draggable: true, // HABILITA ARRASTE MANUAL
              label: {
                text: `${stopIdx + 1}`,
                color: '#ffffff',
                fontWeight: 'bold',
                fontSize: '11px',
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 13,
                fillColor: plan.color,
                fillOpacity: 0.95,
                strokeWeight: 2.5,
                strokeColor: '#ffffff',
              },
              zIndex: 50 + stopIdx,
            })

            // Evento de final de arraste manual do ponto
            stopMarker.addListener('dragend', (e: any) => {
              if (e.latLng) {
                const newLat = e.latLng.lat()
                const newLng = e.latLng.lng()
                handleMarkerDragEnd(plan.courier.id, stop.id, newLat, newLng)
              }
            })

            const infoWindow = new google.maps.InfoWindow({
              content: `
                <div style="padding: 8px; font-family: sans-serif; color: #1e293b; max-width: 220px;">
                  <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
                    <span style="background: ${plan.color}; color: white; border-radius: 999px; padding: 2px 6px; font-size: 10px; font-weight: bold;">
                      Parada #${stopIdx + 1}
                    </span>
                    <strong style="font-size: 12px;">${stop.customer_name}</strong>
                  </div>
                  <p style="font-size: 11px; margin: 0; color: #475569;">📍 ${stop.address}</p>
                  <p style="font-size: 10px; margin: 4px 0 0; color: #64748b;">Código: <b>${stop.tracking_code}</b></p>
                  <p style="font-size: 10px; margin: 2px 0 0; color: #8b5cf6;">Entregador: <b>${plan.courier.name}</b></p>
                  <p style="font-size: 10px; margin: 4px 0 0; color: #d97706; font-style: italic;">✋ Arraste este marcador para reposicionar na sequência</p>
                </div>
              `,
            })

            stopMarker.addListener('click', () => {
              infoWindow.open(mapInstanceRef.current, stopMarker)
            })

            markersAndPolylinesRef.current.push(stopMarker)
          })

          // 3. PONTO DE CHEGADA / RETORNO (End Base) - Vermelho / Bandeira
          const endLat = plan.end_base?.lat || startLat
          const endLng = plan.end_base?.lng || startLng
          pathCoords.push({ lat: endLat, lng: endLng })
          bounds.extend(new google.maps.LatLng(endLat, endLng))

          const endMarker = new google.maps.Marker({
            position: { lat: endLat, lng: endLng },
            map: mapInstanceRef.current,
            title: `🏁 CHEGADA: ${plan.end_base?.name || 'Ponto de Retorno'} (${plan.courier.name})`,
            icon: {
              path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#ef4444', // Red
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#ffffff',
              rotation: 0,
            },
            zIndex: 99,
          })

          const endInfo = new google.maps.InfoWindow({
            content: `
              <div style="padding: 6px; font-family: sans-serif; color: #0f172a;">
                <span style="background: #ef4444; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold;">
                  🏁 PONTO DE CHEGADA / RETORNO
                </span>
                <p style="font-weight: bold; margin: 4px 0 2px; font-size: 12px;">${plan.end_base?.name || 'Chegada'}</p>
                <p style="font-size: 11px; margin: 0; color: #475569;">${plan.end_base?.address || ''}</p>
                <p style="font-size: 10px; margin: 4px 0 0; color: #dc2626;">Retorno da rota de: <b>${plan.courier.name}</b></p>
              </div>
            `,
          })
          endMarker.addListener('click', () => endInfo.open(mapInstanceRef.current, endMarker))
          markersAndPolylinesRef.current.push(endMarker)

          // 4. LINHA DA ROTA (Polyline: Partida → Paradas 1..N → Chegada)
          // Usa geometria viária real de ruas se disponível, com fallback para pathCoords direto
          const geom = streetRouteGeometries[plan.courier.id]
          const finalRouteCoords = geom && geom.points.length >= 2 ? geom.points : pathCoords

          if (finalRouteCoords.length > 1) {
            // Linha externa de destaque (azul real ou cor do entregador)
            const polyline = new google.maps.Polyline({
              path: finalRouteCoords,
              geodesic: true,
              strokeColor: plan.color || '#2563eb',
              strokeOpacity: 0.9,
              strokeWeight: 5,
              map: mapInstanceRef.current,
            })
            markersAndPolylinesRef.current.push(polyline)

            // Linha interna suave para efeito de rodovia/rua iluminada
            const innerLine = new google.maps.Polyline({
              path: finalRouteCoords,
              geodesic: true,
              strokeColor: '#ffffff',
              strokeOpacity: 0.5,
              strokeWeight: 1.5,
              map: mapInstanceRef.current,
            })
            markersAndPolylinesRef.current.push(innerLine)
          }
        })
      } else {
        // Exibição antes da otimização: inclui PONTO DE PARTIDA 🟢 e PONTO DE CHEGADA 🏁
        const startBaseObj = resolvedStartEntity
        const endBaseObj = resolvedEndEntity

        // 1. Ponto de Partida selecionado
        if (startBaseObj.lat && startBaseObj.lng) {
          bounds.extend(new google.maps.LatLng(startBaseObj.lat, startBaseObj.lng))
          hasPoints = true
          const startMarker = new google.maps.Marker({
            position: { lat: startBaseObj.lat, lng: startBaseObj.lng },
            map: mapInstanceRef.current,
            title: `🟢 PARTIDA: ${startBaseObj.name}`,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#10b981',
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#ffffff',
            },
            zIndex: 100,
          })
          const startInfo = new google.maps.InfoWindow({
            content: `
              <div style="padding: 6px; font-family: sans-serif; color: #0f172a;">
                <span style="background: #10b981; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold;">
                  🟢 PONTO DE PARTIDA
                </span>
                <p style="font-weight: bold; margin: 4px 0 2px; font-size: 12px;">${startBaseObj.name}</p>
                <p style="font-size: 11px; margin: 0; color: #475569;">${startBaseObj.address || ''}</p>
              </div>
            `,
          })
          startMarker.addListener('click', () =>
            startInfo.open(mapInstanceRef.current, startMarker),
          )
          markersAndPolylinesRef.current.push(startMarker)
        }

        // 2. Ponto de Chegada selecionado
        if (
          endBaseObj.lat &&
          endBaseObj.lng &&
          (endBaseObj.id !== startBaseObj.id ||
            endBaseObj.lat !== startBaseObj.lat ||
            endBaseObj.lng !== startBaseObj.lng)
        ) {
          bounds.extend(new google.maps.LatLng(endBaseObj.lat, endBaseObj.lng))
          hasPoints = true
          const endMarker = new google.maps.Marker({
            position: { lat: endBaseObj.lat, lng: endBaseObj.lng },
            map: mapInstanceRef.current,
            title: `🏁 CHEGADA: ${endBaseObj.name}`,
            icon: {
              path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
              scale: 7,
              fillColor: '#ef4444',
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#ffffff',
            },
            zIndex: 99,
          })
          const endInfo = new google.maps.InfoWindow({
            content: `
              <div style="padding: 6px; font-family: sans-serif; color: #0f172a;">
                <span style="background: #ef4444; color: white; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-weight: bold;">
                  🏁 PONTO DE CHEGADA / RETORNO
                </span>
                <p style="font-weight: bold; margin: 4px 0 2px; font-size: 12px;">${endBaseObj.name}</p>
                <p style="font-size: 11px; margin: 0; color: #475569;">${endBaseObj.address || ''}</p>
              </div>
            `,
          })
          endMarker.addListener('click', () => endInfo.open(mapInstanceRef.current, endMarker))
          markersAndPolylinesRef.current.push(endMarker)
        }

        // 3. Entregas pendentes selecionadas com pin numerado 📍
        const ordersToShow = pendingOrders.filter((o) => selectedOrderIds.includes(o.id))

        ordersToShow.forEach((o, idx) => {
          const cust = localCustomers.find((c) => c.id === o.customer_id) || o.expand?.customer_id
          if (cust && cust.lat && cust.lng) {
            bounds.extend(new google.maps.LatLng(cust.lat, cust.lng))
            hasPoints = true

            const m = new google.maps.Marker({
              position: { lat: cust.lat, lng: cust.lng },
              map: mapInstanceRef.current,
              title: `#${idx + 1} - ${cust.name || 'Cliente'} (${o.tracking_code})`,
              label: {
                text: `${idx + 1}`,
                color: '#ffffff',
                fontWeight: 'bold',
                fontSize: '11px',
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: '#f97316', // Orange pin
                fillOpacity: 0.95,
                strokeWeight: 2,
                strokeColor: '#ffffff',
              },
            })
            const info = new google.maps.InfoWindow({
              content: `
                <div style="padding: 6px; font-family: sans-serif; color: #0f172a; max-width: 220px;">
                  <strong style="font-size: 12px; color: #f97316;">Parada #${idx + 1}: ${cust.name || 'Cliente'}</strong>
                  <p style="font-size: 11px; margin: 2px 0; color: #475569;">📍 ${cust.address || 'Sem endereço'}</p>
                  <p style="font-size: 10px; margin: 0; color: #64748b;">Código: <b>${o.tracking_code}</b></p>
                </div>
              `,
            })
            m.addListener('click', () => info.open(mapInstanceRef.current, m))
            markersAndPolylinesRef.current.push(m)
          }
        })

        // Mostra entregadores disponíveis
        couriers
          .filter((c) => selectedCourierIds.includes(c.id))
          .forEach((c) => {
            const loc = locations.find((l) => l.user_id === c.id)
            if (loc && loc.lat && loc.lng) {
              bounds.extend(new google.maps.LatLng(loc.lat, loc.lng))
              hasPoints = true
              const cm = new google.maps.Marker({
                position: { lat: loc.lat, lng: loc.lng },
                map: mapInstanceRef.current,
                title: `🛵 ${c.name} (Disponível)`,
                icon: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png',
              })
              markersAndPolylinesRef.current.push(cm)
            }
          })
      }

      if (hasPoints && mapInstanceRef.current) {
        mapInstanceRef.current.fitBounds(bounds, { top: 35, right: 35, bottom: 35, left: 35 })
      }
    } catch (e) {
      console.warn('Error rendering routes on map:', e)
    }
  }, [
    open,
    optimizationResult,
    activeCourierTab,
    pendingOrders,
    selectedOrderIds,
    selectedCourierIds,
    couriers,
    localCustomers,
    locations,
    selectedStartBaseId,
    selectedEndBaseId,
    baseAddresses,
    streetRouteGeometries,
    isMapsLoaded,
    mapsAuthError,
  ])

  // Computar geometrias de trajeto de rua real (linha viária azul/colorida) com OSRM/Google
  useEffect(() => {
    if (!open || !optimizationResult) return

    let cancelled = false
    setIsLoadingStreetRoutes(true)

    const computeAllStreetRoutes = async () => {
      const newGeoms: Record<string, { points: LatLngPoint[]; color: string }> = {}

      for (const plan of optimizationResult.courierPlans) {
        if (cancelled) return
        const waypoints: LatLngPoint[] = []

        // Início: base de partida
        const startLat = plan.start_base?.lat || -22.906847
        const startLng = plan.start_base?.lng || -43.172896
        waypoints.push({ lat: startLat, lng: startLng })

        // Paradas ordenadas
        for (const stop of plan.stops) {
          waypoints.push({ lat: stop.lat, lng: stop.lng })
        }

        // Chegada: base de chegada
        const endLat = plan.end_base?.lat || startLat
        const endLng = plan.end_base?.lng || startLng
        waypoints.push({ lat: endLat, lng: endLng })

        // Buscar segmentos de rua reais entre waypoints consecutivos
        const allStreetPoints: LatLngPoint[] = []
        for (let i = 0; i < waypoints.length - 1; i++) {
          if (cancelled) return
          const from = waypoints[i]
          const to = waypoints[i + 1]
          try {
            const leg = await fetchStreetRoute(from, to)
            if (leg.coordinates && leg.coordinates.length > 0) {
              if (allStreetPoints.length > 0) {
                allStreetPoints.push(...leg.coordinates.slice(1))
              } else {
                allStreetPoints.push(...leg.coordinates)
              }
            } else {
              if (allStreetPoints.length === 0) allStreetPoints.push(from)
              allStreetPoints.push(to)
            }
          } catch {
            if (allStreetPoints.length === 0) allStreetPoints.push(from)
            allStreetPoints.push(to)
          }
        }

        newGeoms[plan.courier.id] = {
          points: allStreetPoints.length >= 2 ? allStreetPoints : waypoints,
          color: plan.color,
        }
      }

      if (!cancelled) {
        setStreetRouteGeometries(newGeoms)
        setIsLoadingStreetRoutes(false)
      }
    }

    computeAllStreetRoutes().catch(() => {
      if (!cancelled) setIsLoadingStreetRoutes(false)
    })

    return () => {
      cancelled = true
    }
  }, [open, optimizationResult])

  // Trigger map resize when modal opens or step changes to avoid black/blank map
  useEffect(() => {
    if (!open) return
    const timers = [50, 150, 300, 600, 1000, 1500].map((delay) =>
      setTimeout(() => {
        const google = getGoogle()
        if (mapInstanceRef.current && google?.maps) {
          google.maps.event.trigger(mapInstanceRef.current, 'resize')
        }
      }, delay),
    )
    return () => timers.forEach(clearTimeout)
  }, [open, wizardStep, isMapsLoaded, optimizationResult])

  // ResizeObserver no container do mapa: detecta quando o container ganha dimensões reais
  // (ex: ao abrir o modal ou mudar de etapa 1->2->3) e aciona resize do Google Maps imediatamente
  useEffect(() => {
    if (!open) return
    const container = mapContainerRef.current
    if (!container || typeof ResizeObserver === 'undefined') return

    let lastW = 0
    let lastH = 0

    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (
          width > 0 &&
          height > 0 &&
          (Math.abs(width - lastW) > 5 || Math.abs(height - lastH) > 5)
        ) {
          lastW = width
          lastH = height
          const google = getGoogle()
          if (mapInstanceRef.current && google?.maps) {
            google.maps.event.trigger(mapInstanceRef.current, 'resize')
          }
        }
      }
    })

    ro.observe(container)
    return () => ro.disconnect()
  }, [open, wizardStep, isMapsLoaded])

  // Apply & Save Distribution (com opção de atribuir ou já Liberar Rota diretamente)
  // REGRA INVIOLÁVEL: Todas as rotas só podem ser salvas e liberadas após otimização 100% pelo motor viário
  const handleApplyDistribution = async (releaseDirectly = false) => {
    if (!optimizationResult || optimizationResult.courierPlans.length === 0) {
      toast.error('Gere a otimização antes de confirmar a distribuição.')
      return
    }

    // Validação estrita de otimização 100%: nenhuma parada pode estar vazia ou sem sequência válida >= 1
    const totalStopsInPlans = optimizationResult.courierPlans.reduce(
      (sum, p) => sum + p.stops.length,
      0,
    )
    if (totalStopsInPlans === 0) {
      toast.error('Não é possível salvar: nenhuma entrega foi otimizada nas rotas.')
      return
    }

    for (const plan of optimizationResult.courierPlans) {
      if (plan.stops.length === 0) continue
      const invalidStop = plan.stops.find(
        (s) => !s.id || typeof s.lat !== 'number' || typeof s.lng !== 'number',
      )
      if (invalidStop) {
        toast.error(
          `A rota de ${plan.courier.name} possui paradas incompletas. Execute a otimização novamente.`,
        )
        return
      }
    }

    const startBase = resolvedStartEntity
    const endBase = resolvedEndEntity

    // Regra: "não precisa bloquear o entregador para vendedor. apenas não deixar a rota entrar no app do entregador enquanto ele estiver na rota atual"
    // Avisamos de forma discreta se algum entregador selecionado já possui rota ativa: a nova rota entrará na fila
    const couriersWithActiveRoute = optimizationResult.courierPlans.filter(
      (p) => p.stops.length > 0 && isCourierWithActiveRoute(p.courier.id),
    )
    if (couriersWithActiveRoute.length > 0) {
      const names = couriersWithActiveRoute.map((p) => p.courier.name).join(', ')
      toast.info(
        `Rotas atribuídas para ${names} entrarão na fila até finalizarem a rota atual na base.`,
        {
          duration: 4500,
        },
      )
    }

    setIsApplying(true)
    let assignedCount = 0

    try {
      const now = Date.now()
      const isoNow = new Date(now).toISOString()

      for (const plan of optimizationResult.courierPlans) {
        // Rateio exato do percurso total (ida + paradas + volta) entre as entregas do lote
        // para garantir COERÊNCIA MATEMÁTICA ESTRITA:
        // soma das linhas (distance_km + return_trip_km) === plan.total_distance_km
        // soma dos fuel_cost === plan.estimated_fuel_cost
        const totalPlanStops = plan.stops.length
        const planTotalKm = Number(plan.total_distance_km) || 0
        const planTotalFuel = Number(plan.estimated_fuel_cost) || 0

        const totalOutboundPlanMeters = plan.stops.reduce(
          (sum, s) => sum + (s.step_distance_meters || 0),
          0,
        )
        const totalReturnKm = plan.return_distance_km || 0

        let allocatedReturnSum = 0
        let allocatedFuelSum = 0

        for (let i = 0; i < plan.stops.length; i++) {
          const stop = plan.stops[i]
          const isLastStop = i === plan.stops.length - 1
          const etaTimestamp = new Date(now + (20 + i * 15) * 60 * 1000).toISOString()
          const stopDistanceKm = Number((stop.step_distance_meters / 1000).toFixed(2))

          let stopReturnKm = 0
          if (totalPlanStops === 1) {
            stopReturnKm = Number(totalReturnKm.toFixed(2))
            allocatedReturnSum += stopReturnKm
          } else if (!isLastStop) {
            const rawShare =
              totalOutboundPlanMeters > 0
                ? (totalReturnKm * (stop.step_distance_meters || 1)) / totalOutboundPlanMeters
                : totalReturnKm / totalPlanStops
            stopReturnKm = Number(rawShare.toFixed(2))
            allocatedReturnSum += stopReturnKm
          } else {
            // Última parada: absorve o resíduo de arredondamento para a soma bater 100% com totalReturnKm
            stopReturnKm = Number(Math.max(0, totalReturnKm - allocatedReturnSum).toFixed(2))
          }

          const { pricePerLiter: courierFuelPrice, consumptionKml: courierFuelCons } =
            deliveryService.getVehicleFuelParams(appSettings, plan.courier.vehicle_type)

          let stopFuelCost = 0
          if (!isLastStop) {
            stopFuelCost =
              courierFuelCons > 0
                ? Number(
                    (
                      ((stopDistanceKm + stopReturnKm) * courierFuelPrice) /
                      courierFuelCons
                    ).toFixed(2),
                  )
                : 0
            allocatedFuelSum += stopFuelCost
          } else {
            // Última parada: garante que a soma dos combustíveis feche exatamente em planTotalFuel
            stopFuelCost = Number(Math.max(0, planTotalFuel - allocatedFuelSum).toFixed(2))
          }

          await deliveryService.updateOrder(stop.id, {
            courier_id: plan.courier.id,
            status: 'assigned', // Permite que o entregador veja na fila e acione "Iniciar Rota"
            sequence: i + 1,
            distance_km: stopDistanceKm,
            return_trip_km: Number(stopReturnKm.toFixed(2)),
            total_route_with_return_km: Number(plan.total_distance_km),
            total_route_fuel_cost: plan.estimated_fuel_cost,
            estimated_duration_minutes: Math.round((stop.step_distance_meters / 1000) * 3.5 + 5),
            fuel_cost: stopFuelCost,
            estimated_arrival: etaTimestamp,
            route_started: false, // Regra 1: Entregador deve clicar em "Iniciar Rota"
            route_released: releaseDirectly, // PEDIDO 1: Flag de liberação
            route_released_at: releaseDirectly ? isoNow : undefined,
            start_base_name: startBase?.name || 'Base Central Rotaly',
            start_base_address: startBase?.address,
            start_base_lat: startBase?.lat,
            start_base_lng: startBase?.lng,
            end_address_name: endBase?.name || startBase?.name || 'Base Central Rotaly',
            end_address_text: endBase?.address || startBase?.address,
            end_address_lat: endBase?.lat || startBase?.lat,
            end_address_lng: endBase?.lng || startBase?.lng,
          })
          assignedCount++
        }

        // Send push notification to courier
        if (plan.stops.length > 0) {
          await deliveryService.createNotification({
            user_id: plan.courier.id,
            title: releaseDirectly
              ? '🚀 ROTA LIBERADA PARA VOCÊ!'
              : '📦 Nova Rota Atribuída (Aguardando Liberação)',
            message: releaseDirectly
              ? `Sua rota com ${plan.stops.length} entregas (${plan.total_distance_km} km ida/volta) foi liberada pelo vendedor! Abra o app para iniciar.`
              : `Você recebeu ${plan.stops.length} entregas (${plan.total_distance_km} km ida/volta). O vendedor liberará a rota em breve.`,
            type: 'order',
            read: false,
          })
        }
      }

      if (releaseDirectly) {
        toast.success(
          `🚀 Sucesso! ${assignedCount} entregas otimizadas e ROTA LIBERADA para os entregadores!`,
        )
      } else {
        toast.success(
          `🎉 Sucesso! ${assignedCount} entregas distribuídas. Clique em "Liberar Rota" no painel quando quiser enviar aos entregadores.`,
        )
      }
      onRoutesApplied()
      onOpenChange(false)
    } catch (err) {
      console.error('Error applying route distribution:', err)
      toast.error('Falha ao salvar atribuição das rotas.')
    } finally {
      setIsApplying(false)
    }
  }

  // Reordenação de parada dentro de uma rota com recálculo automático de métricas (ida e volta)
  const moveStopInPlan = (courierId: string, stopIndex: number, direction: 'up' | 'down') => {
    if (!optimizationResult) return

    setOptimizationResult((prev) => {
      if (!prev) return prev
      let grandTotalDistMeters = 0

      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id !== courierId) {
          grandTotalDistMeters += Number(p.total_distance_km) * 1000
          return p
        }

        const newStops = [...p.stops]
        const targetIndex = direction === 'up' ? stopIndex - 1 : stopIndex + 1
        if (targetIndex < 0 || targetIndex >= newStops.length) {
          grandTotalDistMeters += Number(p.total_distance_km) * 1000
          return p
        }

        const temp = newStops[stopIndex]
        newStops[stopIndex] = newStops[targetIndex]
        newStops[targetIndex] = temp

        const metrics = recalculatePlanMetrics(
          newStops,
          p.start_base?.lat || -22.906847,
          p.start_base?.lng || -43.172896,
          p.end_base?.lat || -22.906847,
          p.end_base?.lng || -43.172896,
          p.courier.vehicle_type,
        )

        grandTotalDistMeters += Number(metrics.totalDistKm) * 1000

        return {
          ...p,
          stops: metrics.updatedStops,
          total_distance_km: metrics.totalDistKm,
          outbound_distance_km: metrics.outboundKm,
          return_distance_km: metrics.returnKm,
          estimated_duration_minutes: metrics.durationMins,
          estimated_fuel_cost: metrics.fuelCost,
        }
      })

      const grandDistKm = (grandTotalDistMeters / 1000).toFixed(1)
      const totalFuel = newPlans.reduce((acc, p) => acc + (p.estimated_fuel_cost || 0), 0)
      const totalMins = newPlans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      return {
        ...prev,
        courierPlans: newPlans,
        totalDistanceKm: grandDistKm,
        totalEstimatedFuelCost: Number(totalFuel.toFixed(2)),
        totalDurationMinutes: totalMins,
      }
    })
  }

  const removeStopFromPlan = (courierId: string, stopIndex: number) => {
    if (!optimizationResult) return

    setOptimizationResult((prev) => {
      if (!prev) return prev
      let grandTotalDistMeters = 0

      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id !== courierId) {
          grandTotalDistMeters += Number(p.total_distance_km) * 1000
          return p
        }
        const newStops = p.stops.filter((_, idx) => idx !== stopIndex)
        const metrics = recalculatePlanMetrics(
          newStops,
          p.start_base?.lat || -22.906847,
          p.start_base?.lng || -43.172896,
          p.end_base?.lat || -22.906847,
          p.end_base?.lng || -43.172896,
          p.courier.vehicle_type,
        )

        grandTotalDistMeters += Number(metrics.totalDistKm) * 1000

        return {
          ...p,
          stops: metrics.updatedStops,
          total_distance_km: metrics.totalDistKm,
          outbound_distance_km: metrics.outboundKm,
          return_distance_km: metrics.returnKm,
          estimated_duration_minutes: metrics.durationMins,
          estimated_fuel_cost: metrics.fuelCost,
        }
      })

      const grandDistKm = (grandTotalDistMeters / 1000).toFixed(1)
      const totalFuel = newPlans.reduce((acc, p) => acc + (p.estimated_fuel_cost || 0), 0)
      const totalMins = newPlans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      return {
        ...prev,
        courierPlans: newPlans,
        totalDistanceKm: grandDistKm,
        totalEstimatedFuelCost: Number(totalFuel.toFixed(2)),
        totalDurationMinutes: totalMins,
      }
    })
    toast.info('Parada removida da rota calculada.')
  }

  // Manipuladores de Edição e Exclusão em Cascata de Cliente na Etapa 2
  const handleOpenEditCustomer = (cust: CustomerRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setCustomerToEdit(cust)
    setIsEditCustomerModalOpen(true)
  }

  const handleCustomerSaved = (savedCust: CustomerRecord) => {
    // Atualiza localmente no estado do modal
    setLocalCustomers((prev) => prev.map((c) => (c.id === savedCust.id ? savedCust : c)))
    toast.success(`Cliente "${savedCust.name}" atualizado com sucesso!`)
    setIsEditCustomerModalOpen(false)
    setCustomerToEdit(null)
    // Notifica o painel pai para recarregar dados
    onRoutesApplied()
  }

  const handleOpenDeleteConfirm = (cust: CustomerRecord, e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    setCustomerToDelete(cust)
  }

  const handleConfirmDeleteCustomer = async () => {
    if (!customerToDelete) return
    const targetCust = customerToDelete
    setIsDeletingCustomer(true)
    try {
      const res = await deliveryService.deleteCustomerCascade(targetCust.id)
      const countDeleted = res.deletedOrdersCount || 0

      // Encontrar todos os ids de pedidos vinculados a esse cliente
      const affectedOrderIds = localOrders
        .filter((o) => o.customer_id === targetCust.id)
        .map((o) => o.id)

      // 1. Remover pedidos da seleção (setSelectedOrderIds filter)
      setSelectedOrderIds((prev) => prev.filter((id) => !affectedOrderIds.includes(id)))

      // 2. Remover pedidos da listagem local
      setLocalOrders((prev) => prev.filter((o) => o.customer_id !== targetCust.id))

      // 3. Remover cliente da listagem local
      setLocalCustomers((prev) => prev.filter((c) => c.id !== targetCust.id))

      toast.success(
        `Cliente "${targetCust.name}" e ${countDeleted} entrega(s) pendente(s) excluídos com sucesso!`,
      )

      // 4. Disparar callback de recarregamento do painel pai
      onRoutesApplied()

      setCustomerToDelete(null)
    } catch (err: unknown) {
      console.error('Erro ao excluir cliente:', err)
      const message =
        err instanceof Error ? err.message : 'Falha ao excluir cliente e entregas vinculadas.'
      toast.error(message)
    } finally {
      setIsDeletingCustomer(false)
    }
  }

  const reassignStopToAnotherCourier = (
    fromCourierId: string,
    toCourierId: string,
    stopIndex: number,
  ) => {
    if (!optimizationResult || fromCourierId === toCourierId) return

    setOptimizationResult((prev) => {
      if (!prev) return prev
      const fromPlan = prev.courierPlans.find((p) => p.courier.id === fromCourierId)
      if (!fromPlan || !fromPlan.stops[stopIndex]) return prev

      const stopToMove = fromPlan.stops[stopIndex]
      let grandTotalDistMeters = 0

      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id === fromCourierId) {
          const newStops = p.stops.filter((_, idx) => idx !== stopIndex)
          const metrics = recalculatePlanMetrics(
            newStops,
            p.start_base?.lat || -22.906847,
            p.start_base?.lng || -43.172896,
            p.end_base?.lat || -22.906847,
            p.end_base?.lng || -43.172896,
            p.courier.vehicle_type,
          )
          grandTotalDistMeters += Number(metrics.totalDistKm) * 1000
          return {
            ...p,
            stops: metrics.updatedStops,
            total_distance_km: metrics.totalDistKm,
            outbound_distance_km: metrics.outboundKm,
            return_distance_km: metrics.returnKm,
            estimated_duration_minutes: metrics.durationMins,
            estimated_fuel_cost: metrics.fuelCost,
          }
        }
        if (p.courier.id === toCourierId) {
          const newStops = [...p.stops, stopToMove]
          const metrics = recalculatePlanMetrics(
            newStops,
            p.start_base?.lat || -22.906847,
            p.start_base?.lng || -43.172896,
            p.end_base?.lat || -22.906847,
            p.end_base?.lng || -43.172896,
            p.courier.vehicle_type,
          )
          grandTotalDistMeters += Number(metrics.totalDistKm) * 1000
          return {
            ...p,
            stops: metrics.updatedStops,
            total_distance_km: metrics.totalDistKm,
            outbound_distance_km: metrics.outboundKm,
            return_distance_km: metrics.returnKm,
            estimated_duration_minutes: metrics.durationMins,
            estimated_fuel_cost: metrics.fuelCost,
          }
        }
        grandTotalDistMeters += Number(p.total_distance_km) * 1000
        return p
      })

      const grandDistKm = (grandTotalDistMeters / 1000).toFixed(1)
      const totalFuel = newPlans.reduce((acc, p) => acc + (p.estimated_fuel_cost || 0), 0)
      const totalMins = newPlans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      return {
        ...prev,
        courierPlans: newPlans,
        totalDistanceKm: grandDistKm,
        totalEstimatedFuelCost: Number(totalFuel.toFixed(2)),
        totalDurationMinutes: totalMins,
      }
    })
    toast.success('Entrega reatribuída para outro entregador.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[94vh] overflow-y-auto p-4 sm:p-6"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Otimizador de Rotas & Distribuição da Frota
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agrupe as entregas por proximidade geográfica e ordene automaticamente o melhor trajeto
            para cada entregador (Bike prioriza raio de 3 km da base; Moto prioriza mais distantes
            ou balanceia menor km rodado).
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* REQUISITO 4 & 5: CADASTRO E SELEÇÃO DE BASE E ENDEREÇO FINAL EDITÁVEL */}
          <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-r from-indigo-50/90 to-blue-50/90 p-4 dark:border-indigo-900 dark:bg-slate-900/90 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Building className="h-4 w-4 text-indigo-600" />
                <Label className="text-xs font-black uppercase tracking-wider text-slate-900 dark:text-slate-100">
                  Base de Saída &amp; Endereço de Finalização (Ida e Volta)
                </Label>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsEditingBases(!isEditingBases)}
                className="h-7 px-2 text-xs text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
              >
                <Plus className="h-3.5 w-3.5" />
                {isEditingBases ? 'Fechar Cadastro' : '+ Cadastrar Nova Base / Local'}
              </Button>
            </div>

            {/* Quick selectors for Start Base (Bases + Clientes com busca por Nome, Telefone, CPF/CNPJ) and Final Address */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* PONTO DE PARTIDA COM BUSCA POR NOME, TELEFONE, CPF E CNPJ */}
              <div className="relative" ref={startPointDropdownRef}>
                <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    🏢 Base da Empresa / Loja (Ponto de Partida):
                  </span>
                  <span className="text-[10px] font-normal text-indigo-600 dark:text-indigo-400">
                    Bases &amp; Clientes
                  </span>
                </Label>

                {/* Caixa Seletora / Botão de abertura com resumo do selecionado */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setIsStartPointDropdownOpen((prev) => !prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setIsStartPointDropdownOpen((prev) => !prev)
                    }
                  }}
                  className={`h-9 px-3 rounded-lg border text-xs flex items-center justify-between bg-white dark:bg-slate-800 cursor-pointer transition select-none ${
                    isStartPointDropdownOpen
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="shrink-0 text-sm">
                      {resolvedStartEntity.type === 'customer' ? '👤' : '🏢'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white truncate leading-none">
                        {resolvedStartEntity.name}{' '}
                        {resolvedStartEntity.isDefault ? '★ (Padrão)' : ''}
                      </p>
                    </div>
                    {resolvedStartEntity.type === 'customer' && (
                      <Badge
                        variant="secondary"
                        className="text-[9px] px-1.5 py-0 h-4 bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300 shrink-0"
                      >
                        Cliente
                      </Badge>
                    )}
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${
                      isStartPointDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {/* Dropdown Flutuante com Campo de Busca e Resultados */}
                {isStartPointDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
                    {/* Input de Busca Dinâmica por Nome, Telefone, CPF e CNPJ */}
                    <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/50">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          value={startPointSearchQuery}
                          onChange={(e) => setStartPointSearchQuery(e.target.value)}
                          placeholder="Buscar por nome, telefone, CPF ou CNPJ..."
                          className="w-full h-8 pl-8 pr-7 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        {startPointSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setStartPointSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <p className="text-[10px] text-slate-400 mt-1 px-1">
                        Ex: &ldquo;Central&rdquo;, &ldquo;Pimenta&rdquo;, celular ou CPF/CNPJ
                      </p>
                    </div>

                    {/* Lista com seções separadas de Bases e Clientes */}
                    <div className="max-h-64 overflow-y-auto p-1.5 space-y-2 text-xs">
                      {/* Seção 1: Bases Cadastradas */}
                      {filteredStartPointOptions.bases.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <Building className="h-3 w-3 text-indigo-500" />
                            <span>
                              Bases de Saída Cadastradas ({filteredStartPointOptions.bases.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {filteredStartPointOptions.bases.map((base) => {
                              const isSelected = selectedStartBaseId === base.id
                              return (
                                <button
                                  key={base.id}
                                  type="button"
                                  onClick={() => handleSelectStartPoint(base)}
                                  className={`w-full text-left p-2 rounded-lg transition flex items-start gap-2 ${
                                    isSelected
                                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100 border border-indigo-200 dark:border-indigo-800 font-semibold'
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  <span className="text-base shrink-0">🏢</span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className="font-bold text-slate-900 dark:text-white truncate">
                                        {base.name}
                                      </p>
                                      {base.isDefault && (
                                        <Badge
                                          variant="secondary"
                                          className="text-[9px] px-1 py-0 h-3.5 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                                        >
                                          ★ Padrão
                                        </Badge>
                                      )}
                                    </div>
                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                      📍 {base.address}
                                    </p>
                                  </div>
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-indigo-600 shrink-0 self-center" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Seção 2: Clientes Cadastrados */}
                      {filteredStartPointOptions.customers.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <User className="h-3 w-3 text-sky-500" />
                            <span>Clientes ({filteredStartPointOptions.customers.length})</span>
                          </div>
                          <div className="space-y-0.5">
                            {filteredStartPointOptions.customers.map((cust) => {
                              const isSelected = selectedStartBaseId === cust.id
                              return (
                                <button
                                  key={cust.id}
                                  type="button"
                                  onClick={() => handleSelectStartPoint(cust)}
                                  className={`w-full text-left p-2 rounded-lg transition flex items-start gap-2 ${
                                    isSelected
                                      ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-950 dark:text-sky-100 border border-sky-200 dark:border-sky-800 font-semibold'
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  <span className="text-base shrink-0">👤</span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center justify-between gap-1">
                                      <p className="font-bold text-slate-900 dark:text-white truncate">
                                        {cust.name}
                                      </p>
                                      <Badge
                                        variant="outline"
                                        className="text-[9px] px-1 py-0 h-3.5 text-sky-700 dark:text-sky-300 border-sky-300 shrink-0"
                                      >
                                        Cliente
                                      </Badge>
                                    </div>
                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                      📍 {cust.address || 'Sem endereço informado'}
                                    </p>
                                    {/* Exibe Telefone e CPF/CNPJ quando existirem */}
                                    {(cust.phone || cust.document) && (
                                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 truncate">
                                        {cust.phone && (
                                          <span className="flex items-center gap-0.5">
                                            <Phone className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                                            {cust.phone}
                                          </span>
                                        )}
                                        {cust.document && (
                                          <span className="flex items-center gap-0.5 font-mono">
                                            <FileText className="h-2.5 w-2.5 text-indigo-500 shrink-0" />
                                            {cust.document}
                                          </span>
                                        )}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-sky-600 shrink-0 self-center" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Vazio se não encontrar nada */}
                      {filteredStartPointOptions.total === 0 && (
                        <div className="p-4 text-center text-xs text-slate-400">
                          <p>
                            Nenhuma base ou cliente encontrado para &ldquo;{startPointSearchQuery}
                            &rdquo;.
                          </p>
                          <p className="text-[10px] text-slate-500 mt-1">
                            Tente buscar por nome, telefone ou CPF/CNPJ.
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Endereço real da origem selecionada */}
                <div className="flex items-center justify-between gap-1 mt-1">
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                    📍 {resolvedStartEntity.address || 'Endereço da base / cliente'}
                  </p>
                  {isGeocodingStartCustomer && (
                    <span className="flex items-center gap-1 text-[10px] text-amber-600 font-semibold shrink-0 animate-pulse">
                      <Loader2 className="h-3 w-3 animate-spin" /> Buscando coordenadas...
                    </span>
                  )}
                </div>

                {/* Aviso quando o cliente selecionado não tem coordenadas e não foi possível geocodificar */}
                {startPointGeocodeWarning && (
                  <div className="mt-1 p-1.5 rounded-md bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 text-[10px] text-amber-800 dark:text-amber-200 flex items-start gap-1">
                    <AlertCircle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-0.5" />
                    <span>{startPointGeocodeWarning}</span>
                  </div>
                )}
              </div>

              {/* PONTO DE CHEGADA / RETORNO (Bases e Clientes com busca e opção Mesma Base de Saída) */}
              <div className="relative" ref={endPointDropdownRef}>
                <Label className="text-[11px] font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between mb-1">
                  <span className="flex items-center gap-1.5">
                    🔄 Endereço Final da Rota (Retorno / Ponto de Chegada):
                  </span>
                  <span className="text-[10px] font-normal text-slate-400">Retorno</span>
                </Label>

                {/* Caixa Seletora / Botão de abertura */}
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setIsEndPointDropdownOpen((prev) => !prev)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setIsEndPointDropdownOpen((prev) => !prev)
                    }
                  }}
                  className={`h-9 px-3 rounded-lg border text-xs flex items-center justify-between bg-white dark:bg-slate-800 cursor-pointer transition select-none ${
                    isEndPointDropdownOpen
                      ? 'border-indigo-500 ring-2 ring-indigo-500/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="shrink-0 text-sm">
                      {resolvedEndEntity.id === resolvedStartEntity.id
                        ? '🔄'
                        : resolvedEndEntity.type === 'customer'
                          ? '👤'
                          : '🏁'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 dark:text-white truncate leading-none">
                        {resolvedEndEntity.name}{' '}
                        {resolvedEndEntity.id === resolvedStartEntity.id
                          ? '(Mesma Base de Saída)'
                          : ''}
                      </p>
                    </div>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-slate-400 shrink-0 transition-transform ${
                      isEndPointDropdownOpen ? 'rotate-180' : ''
                    }`}
                  />
                </div>

                {/* Dropdown Flutuante de Chegada com Busca */}
                {isEndPointDropdownOpen && (
                  <div className="absolute z-50 left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl overflow-hidden animate-in fade-in-50 zoom-in-95 duration-100">
                    {/* Input de Busca Dinâmica */}
                    <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/50">
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                        <input
                          type="text"
                          autoFocus
                          value={endPointSearchQuery}
                          onChange={(e) => setEndPointSearchQuery(e.target.value)}
                          placeholder="Buscar base ou cliente final por nome, fone, CPF/CNPJ..."
                          className="w-full h-8 pl-8 pr-7 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                        />
                        {endPointSearchQuery && (
                          <button
                            type="button"
                            onClick={() => setEndPointSearchQuery('')}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="max-h-64 overflow-y-auto p-1.5 space-y-2 text-xs">
                      {/* Opção rápida: Mesma Origem/Ponto de Partida */}
                      <div>
                        <button
                          type="button"
                          onClick={() => handleSelectEndPoint(resolvedStartEntity)}
                          className={`w-full text-left p-2 rounded-lg transition flex items-center gap-2 ${
                            selectedEndBaseId === selectedStartBaseId || !selectedEndBaseId
                              ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100 border border-indigo-200 dark:border-indigo-800 font-semibold'
                              : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                          }`}
                        >
                          <span className="text-base shrink-0">🔄</span>
                          <div className="min-w-0 flex-1">
                            <p className="font-bold text-slate-900 dark:text-white truncate">
                              Mesma Base de Saída (Ida e Volta)
                            </p>
                            <p className="text-[11px] text-slate-500 truncate">
                              📍 {resolvedStartEntity.name} ({resolvedStartEntity.address})
                            </p>
                          </div>
                          {(selectedEndBaseId === selectedStartBaseId || !selectedEndBaseId) && (
                            <Check className="h-4 w-4 text-indigo-600 shrink-0" />
                          )}
                        </button>
                      </div>

                      {/* Bases Alternativas */}
                      {filteredEndPointOptions.bases.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <Building className="h-3 w-3 text-indigo-500" />
                            <span>Bases Cadastradas ({filteredEndPointOptions.bases.length})</span>
                          </div>
                          <div className="space-y-0.5">
                            {filteredEndPointOptions.bases.map((base) => {
                              const isSelected = selectedEndBaseId === base.id
                              return (
                                <button
                                  key={base.id}
                                  type="button"
                                  onClick={() => handleSelectEndPoint(base)}
                                  className={`w-full text-left p-2 rounded-lg transition flex items-start gap-2 ${
                                    isSelected
                                      ? 'bg-indigo-50 dark:bg-indigo-950/60 text-indigo-950 dark:text-indigo-100 border border-indigo-200 dark:border-indigo-800 font-semibold'
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  <span className="text-base shrink-0">🏢</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-900 dark:text-white truncate">
                                      {base.name}
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                      📍 {base.address}
                                    </p>
                                  </div>
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-indigo-600 shrink-0 self-center" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}

                      {/* Clientes Alternativos de Chegada */}
                      {filteredEndPointOptions.customers.length > 0 && (
                        <div>
                          <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1">
                            <User className="h-3 w-3 text-sky-500" />
                            <span>
                              Clientes para Retorno ({filteredEndPointOptions.customers.length})
                            </span>
                          </div>
                          <div className="space-y-0.5">
                            {filteredEndPointOptions.customers.map((cust) => {
                              const isSelected = selectedEndBaseId === cust.id
                              return (
                                <button
                                  key={cust.id}
                                  type="button"
                                  onClick={() => handleSelectEndPoint(cust)}
                                  className={`w-full text-left p-2 rounded-lg transition flex items-start gap-2 ${
                                    isSelected
                                      ? 'bg-sky-50 dark:bg-sky-950/60 text-sky-950 dark:text-sky-100 border border-sky-200 dark:border-sky-800 font-semibold'
                                      : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'
                                  }`}
                                >
                                  <span className="text-base shrink-0">👤</span>
                                  <div className="min-w-0 flex-1">
                                    <p className="font-bold text-slate-900 dark:text-white truncate">
                                      {cust.name}
                                    </p>
                                    <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                      📍 {cust.address}
                                    </p>
                                    {(cust.phone || cust.document) && (
                                      <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400 truncate">
                                        {cust.phone && <span>📞 {cust.phone}</span>}
                                        {cust.document && <span>📄 {cust.document}</span>}
                                      </div>
                                    )}
                                  </div>
                                  {isSelected && (
                                    <Check className="h-4 w-4 text-sky-600 shrink-0 self-center" />
                                  )}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 truncate">
                  🏁 {resolvedEndEntity.address || 'Endereço de finalização'}
                </p>
              </div>
            </div>

            {/* Form to add a new base / store / alternate finish address */}
            {isEditingBases && (
              <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 space-y-2 mt-2">
                <p className="text-xs font-bold text-indigo-900 dark:text-indigo-200">
                  Cadastrar Nova Empresa, Loja ou Ponto de Finalização:
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <Input
                    placeholder="Nome da Base / Loja / Galpão"
                    value={newBaseName}
                    onChange={(e) => setNewBaseName(e.target.value)}
                    className="h-8 text-xs"
                  />
                  <div className="sm:col-span-2">
                    <BaseAddressAutocomplete
                      value={newBaseAddress}
                      onChange={(val) => {
                        setNewBaseAddress(val)
                      }}
                      onAddressSelect={(res: BaseAddressResult) => {
                        setNewBaseAddress(res.address)
                        setNewBaseLat(res.lat)
                        setNewBaseLng(res.lng)
                        if (res.name && !newBaseName.trim()) {
                          setNewBaseName(res.name)
                        }
                      }}
                      placeholder="Endereço completo com número, bairro e cidade (busca Maps)..."
                      inputClassName="h-8 text-xs bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700"
                      biasCoordinates={
                        resolvedStartEntity?.lat && resolvedStartEntity?.lng
                          ? {
                              lat: resolvedStartEntity.lat,
                              lng: resolvedStartEntity.lng,
                            }
                          : baseAddresses.length > 0 && baseAddresses[0].lat && baseAddresses[0].lng
                            ? { lat: baseAddresses[0].lat, lng: baseAddresses[0].lng }
                            : null
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="flex items-center gap-2">
                    <label className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <input
                        type="radio"
                        checked={newBaseType === 'base'}
                        onChange={() => setNewBaseType('base')}
                      />
                      Base Principal / Loja
                    </label>
                    <label className="text-[11px] text-slate-600 dark:text-slate-300 flex items-center gap-1">
                      <input
                        type="radio"
                        checked={newBaseType === 'end_point'}
                        onChange={() => setNewBaseType('end_point')}
                      />
                      Ponto de Finalização Alternativo
                    </label>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleCreateNewBase}
                    disabled={isCreatingBase}
                    className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 text-white"
                  >
                    {isCreatingBase ? 'Salvando...' : 'Salvar Local'}
                  </Button>
                </div>
              </div>
            )}
          </div>
          {/* FLUXO PASSO A PASSO NA ORDEM EXATA DO PEDIDO LITERAL: */}
          {/* 1. SELECIONAR ENTREGADORES -> 2. SELECIONAR CLIENTES/ENTREGAS -> 3. OTIMIZAR / MAPA / AJUSTE MANUAL -> 4. LIBERAR */}
          <div className="grid grid-cols-3 gap-2 border-b border-slate-200 dark:border-slate-800 pb-3">
            <button
              type="button"
              onClick={() => setWizardStep('couriers')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition text-left ${
                wizardStep === 'couriers'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Users className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">1. Entregadores</p>
                <p className="text-[10px] font-normal opacity-85 truncate">
                  {selectedCourierIds.length} selecionado(s)
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setWizardStep('orders')}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition text-left ${
                wizardStep === 'orders'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Package className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">2. Clientes / Entregas</p>
                <p className="text-[10px] font-normal opacity-85 truncate">
                  {selectedOrderIds.length === 0
                    ? 'Buscar & selecionar'
                    : `${selectedOrderIds.length} selecionada(s)`}
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                if (optimizationResult) setWizardStep('review')
                else runRouteOptimization()
              }}
              className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-bold transition text-left ${
                wizardStep === 'review'
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }`}
            >
              <Navigation className="h-4 w-4 shrink-0" />
              <div className="min-w-0">
                <p className="truncate">3. Mapa & Ajuste Manual</p>
                <p className="text-[10px] font-normal opacity-85 truncate">
                  {optimizationResult ? `${optimizationResult.totalDistanceKm} km` : 'Otimizar'}
                </p>
              </div>
            </button>
          </div>
          {/* ETAPA 1: PRIMEIRO SELECIONA OS ENTREGADORES */}
          {wizardStep === 'couriers' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50 space-y-4">
              {/* CARD: ROTAS ATIVAS & LIBERADAS EM ANDAMENTO */}
              {activeCourierRoutes.length > 0 && (
                <div className="rounded-xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/90 to-blue-50/70 p-3.5 dark:border-indigo-900/70 dark:from-slate-900/90 dark:to-indigo-950/40 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <h4 className="text-xs font-bold uppercase tracking-wider text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
                        <Navigation className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        Rotas Ativas & Liberadas em Andamento ({activeCourierRoutes.length})
                      </h4>
                    </div>
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-white/80 dark:bg-slate-800 border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300"
                    >
                      Operação ao vivo
                    </Badge>
                  </div>

                  <p className="text-[11px] text-slate-600 dark:text-slate-400 leading-snug">
                    Entregadores com rota liberada ou em trânsito. Você pode{' '}
                    <strong>acrescentar novos clientes</strong> sem reiniciar a rota,{' '}
                    <strong>reotimizar</strong> todo o circuito ou <strong>cancelar</strong> a rota
                    devolvendo os clientes pendentes para a Etapa 2.
                  </p>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {activeCourierRoutes.map((routeGroup) => {
                      const {
                        courier,
                        pendingStops,
                        deliveredStops,
                        isStarted,
                        isReleased,
                        isReturningToBase,
                      } = routeGroup
                      const vehicleIcon =
                        courier.vehicle_type === 'bicicleta' || courier.vehicle_type === 'bicycle'
                          ? '🚲'
                          : courier.vehicle_type === 'carro'
                            ? '🚗'
                            : courier.vehicle_type === 'caminhao'
                              ? '🚚'
                              : courier.vehicle_type === 'van'
                                ? '🚐'
                                : '🛵'

                      return (
                        <div
                          key={courier.id}
                          className="rounded-lg border border-indigo-200/90 dark:border-indigo-900/60 bg-white dark:bg-slate-900 p-3 shadow-xs space-y-2.5 transition hover:shadow-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-xl shrink-0" role="img" aria-label="veículo">
                                {vehicleIcon}
                              </span>
                              <div className="min-w-0">
                                <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                                  {courier.name}
                                </p>
                                <p className="text-[10px] text-slate-500 truncate">
                                  {courier.vehicle_model || courier.vehicle_type || 'Moto'}
                                  {courier.vehicle_plate ? ` • ${courier.vehicle_plate}` : ''}
                                </p>
                              </div>
                            </div>

                            {/* Badge de Status */}
                            <div className="shrink-0">
                              {isReturningToBase ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300 border border-purple-300 dark:border-purple-800">
                                  🟣 Retornando à Base
                                </span>
                              ) : isStarted ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                                  🔵 Em Rota Ativa
                                </span>
                              ) : isReleased ? (
                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                                  🟡 Rota Liberada
                                </span>
                              ) : null}
                            </div>
                          </div>

                          {/* Métricas de Paradas */}
                          <div className="flex items-center justify-between text-[11px] bg-slate-50 dark:bg-slate-800/60 rounded-md px-2.5 py-1.5 border border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-1 text-slate-700 dark:text-slate-300">
                              <Clock className="h-3.5 w-3.5 text-amber-600" />
                              <span>
                                Pendentes: <strong>{pendingStops.length}</strong>
                              </span>
                            </div>
                            <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              <span>
                                Concluídas: <strong>{deliveredStops.length}</strong>
                              </span>
                            </div>
                            <div className="text-slate-500">
                              Total: <strong>{pendingStops.length + deliveredStops.length}</strong>
                            </div>
                          </div>

                          {/* Pílula de Tempo Restante + Término e Carga Horária */}
                          {(() => {
                            const courierLoc = locations.find((l) => l.user_id === courier.id)
                            const effectiveSpeedKmh =
                              courierLoc &&
                              typeof courierLoc.speed === 'number' &&
                              courierLoc.speed > 5
                                ? courierLoc.speed
                                : 25
                            const speedMps = effectiveSpeedKmh * (1000 / 3600)

                            const primaryOrder = routeGroup.orders[0]
                            const defaultBase =
                              baseAddresses.find((b) => b.is_default) || baseAddresses[0]
                            const fallbackBasePos = {
                              lat: defaultBase?.lat || -22.7001402,
                              lng: defaultBase?.lng || -43.2982834,
                            }

                            const startPos =
                              courierLoc?.lat && courierLoc?.lng
                                ? { lat: Number(courierLoc.lat), lng: Number(courierLoc.lng) }
                                : primaryOrder?.start_base_lat && primaryOrder?.start_base_lng
                                  ? {
                                      lat: Number(primaryOrder.start_base_lat),
                                      lng: Number(primaryOrder.start_base_lng),
                                    }
                                  : fallbackBasePos

                            const returnBasePos =
                              primaryOrder?.end_address_lat && primaryOrder?.end_address_lng
                                ? {
                                    lat: Number(primaryOrder.end_address_lat),
                                    lng: Number(primaryOrder.end_address_lng),
                                  }
                                : primaryOrder?.start_base_lat && primaryOrder?.start_base_lng
                                  ? {
                                      lat: Number(primaryOrder.start_base_lat),
                                      lng: Number(primaryOrder.start_base_lng),
                                    }
                                  : fallbackBasePos

                            const pendingStopsList = pendingStops
                              .map((o) => {
                                const cust =
                                  localCustomers.find((c) => c.id === o.customer_id) ||
                                  o.expand?.customer_id
                                return cust?.lat && cust?.lng
                                  ? { lat: Number(cust.lat), lng: Number(cust.lng) }
                                  : null
                              })
                              .filter(Boolean) as { lat: number; lng: number }[]

                            let totalDist = 0
                            let curPos = startPos
                            for (const stop of pendingStopsList) {
                              totalDist +=
                                haversineDistance(curPos.lat, curPos.lng, stop.lat, stop.lng) * 1.3
                              curPos = stop
                            }
                            totalDist +=
                              haversineDistance(
                                curPos.lat,
                                curPos.lng,
                                returnBasePos.lat,
                                returnBasePos.lng,
                              ) * 1.3
                            const serviceMins = pendingStopsList.length * 6
                            const travelMins = Math.round(totalDist / speedMps / 60)
                            const etaMins = Math.max(1, travelMins + serviceMins)

                            const routeStartTimestamp =
                              primaryOrder?.route_started_at ||
                              primaryOrder?.route_released_at ||
                              primaryOrder?.created ||
                              undefined

                            const shift = calculateRouteWorkShift(
                              etaMins,
                              routeStartTimestamp,
                              Date.now(),
                              appSettings
                                ? {
                                    workStartTime: appSettings.work_start_time,
                                    lunchStartTime: appSettings.lunch_start_time,
                                    lunchEndTime: appSettings.lunch_end_time,
                                    workEndTime: appSettings.work_end_time,
                                  }
                                : undefined,
                            )

                            return (
                              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-semibold text-[10px] border border-slate-200 dark:border-slate-700">
                                  ⏱ {shift.remainingFormatted} • Término:{' '}
                                  {shift.projectedEndTimeFormatted}
                                </span>

                                {shift.isOvertime ? (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-bold text-[10px] border border-amber-300 dark:border-amber-800">
                                    ⚠️ Passa da carga horária (+{shift.overtimeMinutes} min)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 font-bold text-[10px] border border-emerald-300 dark:border-emerald-800">
                                    ✓ Dentro da carga horária
                                  </span>
                                )}
                              </div>
                            )
                          })()}

                          {/* Ações da Rota Ativa */}
                          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800/80">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenIncludeCustomerModal(courier)}
                              disabled={strictlyPendingOrders.length === 0}
                              className="h-7 text-[11px] px-2 text-indigo-700 border-indigo-300 hover:bg-indigo-50 dark:text-indigo-300 dark:border-indigo-800 dark:hover:bg-indigo-950/50 flex items-center gap-1 flex-1"
                              title={
                                strictlyPendingOrders.length === 0
                                  ? 'Nenhuma entrega pendente disponível para incluir'
                                  : 'Acrescentar cliente na rota em andamento deste entregador'
                              }
                            >
                              <Plus className="h-3 w-3" />
                              Incluir Cliente
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleReoptimizeRoute(routeGroup)}
                              className="h-7 text-[11px] px-2 text-blue-700 border-blue-300 hover:bg-blue-50 dark:text-blue-300 dark:border-blue-800 dark:hover:bg-blue-950/50 flex items-center gap-1 flex-1"
                              title="Reabrir paradas e entregador para reotimizar rota"
                            >
                              <RefreshCw className="h-3 w-3" />
                              Reotimizar Rota
                            </Button>

                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => handleOpenCancelRouteConfirm(courier)}
                              className="h-7 text-[11px] px-2 text-rose-700 border-rose-300 hover:bg-rose-50 dark:text-rose-300 dark:border-rose-800 dark:hover:bg-rose-950/50 flex items-center gap-1"
                              title="Cancelar rota em andamento (clientes voltam para pendentes)"
                            >
                              <Ban className="h-3 w-3" />
                              Cancelar Rota
                            </Button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-indigo-600" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Etapa 1: Selecionar Entregadores Disponíveis ({selectedCourierIds.length}{' '}
                    selecionados)
                  </Label>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={selectAllCouriers}
                    className="h-6 px-2 text-[11px] text-indigo-600 hover:text-indigo-700"
                  >
                    Marcar Todos
                  </Button>
                  <span className="text-slate-300">|</span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={deselectAllCouriers}
                    className="h-6 px-2 text-[11px] text-slate-500 hover:text-slate-700"
                  >
                    Desmarcar Todos
                  </Button>
                </div>
              </div>

              {/* Filtros de Entregadores */}
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <input
                  type="text"
                  placeholder="Filtrar por nome, veículo ou placa..."
                  value={searchCourierFilter}
                  onChange={(e) => setSearchCourierFilter(e.target.value)}
                  className="h-7 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full sm:w-60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                />
                <div className="flex items-center gap-1 overflow-x-auto w-full sm:w-auto">
                  <button
                    type="button"
                    onClick={() => setVehicleFilter('all')}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      vehicleFilter === 'all'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    Todos
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleFilter('bicicleta')}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      vehicleFilter === 'bicicleta'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    🚲 Bike (Raio ≤3km)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleFilter('moto')}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      vehicleFilter === 'moto'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    🛵 Moto (35 km/L)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleFilter('carro')}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      vehicleFilter === 'carro'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    🚗 Carro (12 km/L)
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleFilter('caminhao')}
                    className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                      vehicleFilter === 'caminhao'
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    🚚 Caminhão (7 km/L)
                  </button>
                </div>
              </div>

              {/* Grid de Entregadores */}
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
                {filteredCouriers.map((courier, idx) => {
                  const isSelected = selectedCourierIds.includes(courier.id)
                  const palette = COURIER_PALETTE[idx % COURIER_PALETTE.length]
                  const hasActiveRoute = isCourierWithActiveRoute(courier.id)
                  const isBusy = courier.status === 'busy' || hasActiveRoute

                  return (
                    <label
                      key={courier.id}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition select-none group relative cursor-pointer ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/80 shadow-sm dark:bg-indigo-950/50 dark:border-indigo-500 ring-2 ring-indigo-500/30'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 opacity-90 hover:opacity-100'
                      }`}
                    >
                      <Checkbox
                        id={`courier-chk-${courier.id}`}
                        checked={isSelected}
                        onCheckedChange={() => toggleCourierSelection(courier.id)}
                        className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600 h-4 w-4"
                      />

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {courier.vehicle_type === 'bicicleta' ||
                            courier.vehicle_type === 'bicycle'
                              ? '🚲'
                              : courier.vehicle_type === 'carro'
                                ? '🚗'
                                : courier.vehicle_type === 'caminhao'
                                  ? '🚚'
                                  : courier.vehicle_type === 'van'
                                    ? '🚐'
                                    : '🛵'}{' '}
                            {courier.name}
                          </p>
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: palette.color }}
                            title={`Cor da rota: ${palette.name}`}
                          />
                        </div>
                        <div className="flex items-center justify-between text-[10px] text-slate-500 mt-0.5">
                          <span className="truncate">
                            {hasActiveRoute
                              ? '🔄 Em rota — entrará na fila'
                              : isBusy
                                ? '⚠️ Ocupado'
                                : '🟢 Disponível'}{' '}
                            • {courier.vehicle_model || courier.vehicle_type || 'Moto'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => selectOnlyCourier(courier.id, e)}
                            className="text-[9px] text-indigo-600 hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300 hover:underline font-semibold ml-1 shrink-0"
                            title="Marcar somente este entregador"
                          >
                            Só este
                          </button>
                        </div>
                        {hasActiveRoute && (
                          <div className="mt-1">
                            <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 font-medium">
                              Em rota — entrará na fila
                            </span>
                          </div>
                        )}
                      </div>
                    </label>
                  )
                })}
                {filteredCouriers.length === 0 && (
                  <div className="col-span-full py-4 text-center text-xs text-slate-400">
                    Nenhum entregador corresponde ao filtro de busca.
                  </div>
                )}
              </div>

              {/* Botão de Avanço para Etapa 2 */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-200/80 dark:border-slate-800">
                <span className="text-xs text-slate-500">
                  {selectedCourierIds.length === 0
                    ? '⚠️ Selecione pelo menos 1 entregador para continuar'
                    : `✓ ${selectedCourierIds.length} entregador(es) selecionado(s)`}
                </span>
                <Button
                  type="button"
                  onClick={() => setWizardStep('orders')}
                  disabled={selectedCourierIds.length === 0}
                  className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold flex items-center gap-1"
                >
                  Próximo: Selecionar Clientes / Entregas <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          )}
          {/* ETAPA 2: DEPOIS SELECIONA OS CLIENTES / ENTREGAS A ROTEIRIZAR */}
          {wizardStep === 'orders' && (
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-indigo-600" />
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Etapa 2: Selecionar Clientes / Entregas ({selectedOrderIds.length}{' '}
                    selecionada(s) de {pendingOrders.length} pendentes)
                  </Label>
                </div>

                <div className="flex items-center gap-2 text-xs">
                  {filteredPendingOrders.length > 0 && (
                    <>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={selectAllOrders}
                        className="h-6 px-2 text-[11px] text-indigo-600 hover:text-indigo-700 font-semibold"
                      >
                        Marcar{' '}
                        {filteredPendingOrders.length > 1
                          ? `todas da busca (${filteredPendingOrders.length})`
                          : 'resultado'}
                      </Button>
                      <span className="text-slate-300">|</span>
                    </>
                  )}
                  {selectedOrderIds.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={deselectAllOrders}
                      className="h-6 px-2 text-[11px] text-slate-500 hover:text-slate-700"
                    >
                      {searchOrderFilter.trim() ? 'Desmarcar da busca' : 'Desmarcar Todas'}
                    </Button>
                  )}
                </div>
              </div>

              {/* Campo de Busca em Destaque — Nome, CPF, CNPJ ou Telefone */}
              <div className="space-y-1.5">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-indigo-600 dark:text-indigo-400">
                    <Search className="h-4 w-4" />
                  </div>
                  <input
                    type="text"
                    autoFocus
                    placeholder="Buscar cliente por Nome, CPF, CNPJ ou Telefone..."
                    value={searchOrderFilter}
                    onChange={(e) => setSearchOrderFilter(e.target.value)}
                    className="h-10 pl-9 pr-9 text-xs sm:text-sm rounded-xl border-2 border-indigo-200 dark:border-indigo-900/60 bg-white dark:bg-slate-800 text-slate-900 dark:text-white w-full placeholder:text-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 shadow-sm transition"
                  />
                  {searchOrderFilter && (
                    <button
                      type="button"
                      onClick={() => setSearchOrderFilter('')}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                      title="Limpar busca"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
                  <span>
                    💡 Digite com ou sem pontos/traços para encontrar CPF, CNPJ ou Telefone
                  </span>
                  {selectedOrderIds.length > 0 && (
                    <span className="font-semibold text-indigo-600 dark:text-indigo-400">
                      ✓ {selectedOrderIds.length} entrega(s) selecionada(s) para a rota
                    </span>
                  )}
                </div>
              </div>

              {/* Lista Selecionável de Pedidos Pendentes */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto pr-1">
                {/* 1. SE NÃO HOUVER PEDIDOS PENDENTES NO SISTEMA */}
                {pendingOrders.length === 0 && (
                  <div className="col-span-full py-8 px-4 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-800 bg-white/50 dark:bg-slate-900/40">
                    <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 mx-auto flex items-center justify-center mb-2">
                      <Package className="h-5 w-5" />
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-700 dark:text-slate-200">
                      Nenhum cliente com entrega pendente no momento
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1 max-w-md mx-auto">
                      Todos os pedidos já foram liberados, iniciados ou finalizados. Novos pedidos
                      cadastrados com venda aparecerão aqui automaticamente.
                    </p>
                  </div>
                )}

                {/* 2. LISTAGEM DIRETA DOS CLIENTES / ENTREGAS PENDENTES (com ou sem filtro de busca) */}
                {filteredPendingOrders.map((ord) => {
                  const cust =
                    localCustomers.find((c) => c.id === ord.customer_id) || ord.expand?.customer_id
                  const isSelected = selectedOrderIds.includes(ord.id)

                  return (
                    <div
                      key={ord.id}
                      onClick={() => toggleOrderSelection(ord.id)}
                      className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none group relative ${
                        isSelected
                          ? 'border-indigo-500 bg-indigo-50/80 dark:bg-indigo-950/50 dark:border-indigo-500 ring-1 ring-indigo-500/40'
                          : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 opacity-90 hover:opacity-100'
                      }`}
                    >
                      <div
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center mt-0.5"
                      >
                        <Checkbox
                          id={`ord-chk-${ord.id}`}
                          checked={isSelected}
                          onCheckedChange={() => toggleOrderSelection(ord.id)}
                          className="data-[state=checked]:bg-indigo-600 data-[state=checked]:border-indigo-600 h-4 w-4"
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1.5">
                          <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                            {cust?.name || 'Cliente'}
                          </p>
                          <div className="flex items-center gap-1 shrink-0">
                            <Badge
                              variant="outline"
                              className="text-[9px] px-1.5 py-0 uppercase font-mono"
                            >
                              {ord.tracking_code || ord.id.slice(0, 8)}
                            </Badge>

                            {/* Botões de Ação Rápida: Editar e Excluir Cliente */}
                            {cust && (
                              <div
                                className="flex items-center gap-0.5 ml-1"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  title="Editar cadastro do cliente"
                                  aria-label="Editar cliente"
                                  onClick={(e) => handleOpenEditCustomer(cust, e)}
                                  className="h-6 w-6 text-slate-400 hover:text-indigo-600 hover:bg-indigo-100/60 dark:hover:bg-indigo-950/50 rounded-md transition"
                                >
                                  <Pencil className="h-3 w-3" />
                                </Button>
                                <Button
                                  type="button"
                                  size="icon"
                                  variant="ghost"
                                  title="Excluir cliente e entregas vinculadas"
                                  aria-label="Excluir cliente"
                                  onClick={(e) => handleOpenDeleteConfirm(cust, e)}
                                  className="h-6 w-6 text-slate-400 hover:text-red-600 hover:bg-red-100/60 dark:hover:bg-red-950/50 rounded-md transition"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </Button>
                              </div>
                            )}
                          </div>
                        </div>
                        {(cust?.document || cust?.phone) && (
                          <div className="flex items-center gap-2 text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 flex-wrap">
                            {cust?.document && (
                              <span>
                                Doc: <b>{cust.document}</b>
                              </span>
                            )}
                            {cust?.phone && (
                              <span>
                                Tel: <b>{cust.phone}</b>
                              </span>
                            )}
                          </div>
                        )}
                        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate mt-0.5">
                          📍 {cust?.address || 'Endereço cadastrado'}
                        </p>
                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-1">
                          <span>
                            Prioridade:{' '}
                            <b className="text-slate-700 dark:text-slate-300">
                              {ord.priority || 'Normal'}
                            </b>
                          </span>
                          <span>Valor: R$ {ord.total_price?.toFixed(2) || '0.00'}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}

                {/* 3. ESTADO DE BUSCA SEM RESULTADOS (quando há pendentes, mas a busca digitada não bateu) */}
                {pendingOrders.length > 0 &&
                  searchOrderFilter.trim() &&
                  filteredPendingOrders.length === 0 && (
                    <div className="col-span-full py-8 px-4 text-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-white/40 dark:bg-slate-900/30">
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Nenhum cliente ou entrega pendente encontrado para &ldquo;
                        <b className="text-slate-700 dark:text-slate-200">{searchOrderFilter}</b>
                        &rdquo;.
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">
                        Verifique se digitou o nome, CPF, CNPJ ou telefone correto do cliente.
                      </p>
                    </div>
                  )}
              </div>

              {/* Botão de Executar Otimização com Menor Trajeto */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-200/80 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setWizardStep('couriers')}
                  className="h-8 px-3 text-xs"
                >
                  ← Voltar para Entregadores
                </Button>

                <Button
                  type="button"
                  onClick={() => runRouteOptimization()}
                  disabled={
                    isOptimizing || selectedCourierIds.length === 0 || selectedOrderIds.length === 0
                  }
                  className="h-9 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-2"
                >
                  <Sparkles className="h-4 w-4" />
                  {isOptimizing
                    ? 'Otimizando Menor Trajeto...'
                    : `Otimizar Rota para ${selectedCourierIds.length} Entregador(es)`}
                </Button>
              </div>
            </div>
          )}
          {/* Step 3: Visual Map & Draggable Editing (sempre visível ou focado quando em review) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                  <Navigation className="h-3.5 w-3.5 text-indigo-600" />
                  Mapa Interativo &amp; Roteamento (Ponto de Partida 🟢 → Paradas 1..N 📍 → Chegada
                  🏁)
                </Label>
                <p className="text-[11px] text-slate-500">
                  Arraste qualquer marcador no mapa para ajustar a rota manualmente, ou use as setas
                  na lista abaixo.
                </p>
              </div>
              {optimizationResult && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="text-emerald-700 bg-emerald-50 border-emerald-200 font-mono text-[11px]"
                  >
                    ✓ Total: {optimizationResult.totalDistanceKm} km
                  </Badge>
                  <Badge
                    variant="outline"
                    className="text-indigo-700 bg-indigo-50 border-indigo-200 text-[11px] flex items-center gap-1"
                  >
                    <Move className="h-3 w-3" /> Arraste ativo no mapa
                  </Badge>
                </div>
              )}
            </div>

            {/* Google Map Display Container */}
            <div className="relative w-full h-72 sm:h-80 rounded-2xl overflow-hidden border border-slate-300 dark:border-slate-700 shadow-inner bg-slate-900">
              <div
                ref={mapContainerRef}
                className={`absolute inset-0 w-full h-full ${isMapsLoaded && !mapsAuthError && !vectorFallbackActive ? 'z-10 opacity-100' : 'z-0 opacity-0 pointer-events-none'}`}
              />

              {/* Fallback canvas overlay if Google Maps is not available, auth error or tiles failed to paint */}
              {(!isMapsLoaded || mapsAuthError || vectorFallbackActive) && (
                <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white z-20 select-none overflow-hidden">
                  <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#6366f1_1px,transparent_1px)] [background-size:20px_20px]" />

                  {/* Visual Route Lines */}
                  <svg className="absolute inset-0 w-full h-full opacity-30 pointer-events-none">
                    <path
                      d="M 50,120 Q 200,50 400,100 T 750,180"
                      fill="none"
                      stroke="#8b5cf6"
                      strokeWidth="3"
                      strokeDasharray="4,4"
                    />
                    <path
                      d="M 80,200 Q 300,240 550,160 T 800,90"
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeDasharray="4,4"
                    />
                  </svg>

                  <div className="relative z-20 flex items-center justify-between">
                    <span className="text-xs font-semibold text-slate-300 flex items-center gap-1.5 bg-slate-900/80 px-2.5 py-1 rounded-lg border border-slate-700">
                      <Sparkles className="h-3.5 w-3.5 text-indigo-400" /> Distribuição Espacial de
                      Entregas
                    </span>
                    {optimizationResult && (
                      <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                        {optimizationResult.courierPlans.length} rotas otimizadas
                      </span>
                    )}
                  </div>

                  {/* Botão de Contingência / Alternar Modo Fallback / Retry Maps */}
                  <div className="absolute top-3 right-3 z-30 flex items-center gap-1.5">
                    {mapTilesLoaded && !mapsAuthError && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setVectorFallbackActive(false)}
                        className="h-6 px-2 text-[10px] bg-indigo-900/90 text-indigo-100 border-indigo-700 hover:bg-indigo-800 hover:text-white rounded-md shadow gap-1"
                      >
                        <Navigation className="h-3 w-3" />
                        <span>Ver Google Maps</span>
                      </Button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setVectorFallbackActive(false)
                        setMapTilesLoaded(false)
                        loadGoogleMapsScript().then((success) => {
                          const isAuthErr = isGoogleMapsAuthError()
                          const ok = success && !isAuthErr
                          setIsMapsLoaded(ok)
                          setMapsAuthError(isAuthErr)
                          if (ok && mapInstanceRef.current) {
                            const google = getGoogle()
                            google?.maps?.event?.trigger(mapInstanceRef.current, 'resize')
                          } else {
                            setVectorFallbackActive(true)
                          }
                        })
                      }}
                      className="h-6 px-2 text-[10px] bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800 hover:text-white rounded-md shadow gap-1"
                    >
                      <RefreshCw className="h-3 w-3" />
                      <span>Tentar Google Maps</span>
                    </Button>
                  </div>

                  {/* Cartographic canvas with interactive pins: Ponto de Partida 🟢, Chegada 🏁 and Stops 📍 */}
                  {(() => {
                    const fallbackStartBase = resolvedStartEntity
                    const fallbackEndBase = resolvedEndEntity
                    const selectedOrdersList = pendingOrders.filter((o) =>
                      selectedOrderIds.includes(o.id),
                    )

                    // Coleta todos os pontos conhecidos para calcular min/max e enquadramento relativo
                    interface MapPoint {
                      id: string
                      label: string
                      sublabel?: string
                      lat: number
                      lng: number
                      color: string
                      badge?: string
                      type: 'start' | 'end' | 'stop' | 'courier'
                      courierId?: string
                      stopId?: string
                    }

                    const points: MapPoint[] = []
                    if (
                      typeof fallbackStartBase.lat === 'number' &&
                      typeof fallbackStartBase.lng === 'number' &&
                      !isNaN(fallbackStartBase.lat) &&
                      !isNaN(fallbackStartBase.lng)
                    ) {
                      points.push({
                        id: 'start-base',
                        label: `🟢 ${fallbackStartBase.name}`,
                        sublabel: fallbackStartBase.address,
                        lat: fallbackStartBase.lat,
                        lng: fallbackStartBase.lng,
                        color: '#10b981',
                        badge: 'PARTIDA',
                        type: 'start',
                      })
                    }

                    if (
                      typeof fallbackEndBase.lat === 'number' &&
                      typeof fallbackEndBase.lng === 'number' &&
                      !isNaN(fallbackEndBase.lat) &&
                      !isNaN(fallbackEndBase.lng) &&
                      (fallbackEndBase.id !== fallbackStartBase.id ||
                        fallbackEndBase.lat !== fallbackStartBase.lat ||
                        fallbackEndBase.lng !== fallbackStartBase.lng)
                    ) {
                      points.push({
                        id: 'end-base',
                        label: `🏁 ${fallbackEndBase.name}`,
                        sublabel: fallbackEndBase.address,
                        lat: fallbackEndBase.lat,
                        lng: fallbackEndBase.lng,
                        color: '#ef4444',
                        badge: 'CHEGADA',
                        type: 'end',
                      })
                    }

                    if (optimizationResult) {
                      optimizationResult.courierPlans.forEach((plan) => {
                        const isTabActive =
                          activeCourierTab === 'all' || activeCourierTab === plan.courier.id
                        if (!isTabActive) return
                        plan.stops.forEach((stop, sIdx) => {
                          if (
                            typeof stop.lat === 'number' &&
                            typeof stop.lng === 'number' &&
                            !isNaN(stop.lat) &&
                            !isNaN(stop.lng)
                          ) {
                            points.push({
                              id: `opt-stop-${stop.id}`,
                              label: `#${sIdx + 1} ${stop.customer_name}`,
                              sublabel: stop.address,
                              lat: stop.lat,
                              lng: stop.lng,
                              color: plan.color,
                              badge: `${sIdx + 1}`,
                              type: 'stop',
                              courierId: plan.courier.id,
                              stopId: stop.id,
                            })
                          }
                        })
                      })
                    } else {
                      selectedOrdersList.forEach((ord, oIdx) => {
                        const cust =
                          localCustomers.find((c) => c.id === ord.customer_id) ||
                          ord.expand?.customer_id
                        const lat =
                          cust?.lat ||
                          (fallbackStartBase.lat || -22.906847) + (((oIdx * 17) % 7) - 3) * 0.008
                        const lng =
                          cust?.lng ||
                          (fallbackStartBase.lng || -43.172896) + (((oIdx * 13) % 7) - 3) * 0.008
                        points.push({
                          id: `ord-stop-${ord.id}`,
                          label: `#${oIdx + 1} ${cust?.name || 'Cliente'}`,
                          sublabel: cust?.address || ord.tracking_code,
                          lat,
                          lng,
                          color: '#f97316',
                          badge: `${oIdx + 1}`,
                          type: 'stop',
                        })
                      })
                    }

                    // Bounds calculation for proportional canvas placement with fallback to center
                    let minLat = Infinity
                    let maxLat = -Infinity
                    let minLng = Infinity
                    let maxLng = -Infinity
                    points.forEach((p) => {
                      if (p.lat < minLat) minLat = p.lat
                      if (p.lat > maxLat) maxLat = p.lat
                      if (p.lng < minLng) minLng = p.lng
                      if (p.lng > maxLng) maxLng = p.lng
                    })

                    const hasValidBounds =
                      isFinite(minLat) && isFinite(maxLat) && isFinite(minLng) && isFinite(maxLng)
                    const centerLat = hasValidBounds
                      ? (minLat + maxLat) / 2
                      : fallbackStartBase.lat || -22.7001402
                    const centerLng = hasValidBounds
                      ? (minLng + maxLng) / 2
                      : fallbackStartBase.lng || -43.2982834

                    const latSpan =
                      hasValidBounds && maxLat > minLat
                        ? Math.max(0.015, (maxLat - minLat) * 1.35)
                        : 0.04
                    const lngSpan =
                      hasValidBounds && maxLng > minLng
                        ? Math.max(0.015, (maxLng - minLng) * 1.35)
                        : 0.04

                    const calcX = (lng: number) => {
                      const rel = 50 + ((lng - centerLng) / lngSpan) * 80
                      return Math.max(8, Math.min(92, rel))
                    }
                    const calcY = (lat: number) => {
                      const rel = 50 - ((lat - centerLat) / latSpan) * 75
                      return Math.max(12, Math.min(88, rel))
                    }

                    return (
                      <div
                        ref={vectorCanvasRef}
                        onMouseMove={(e) => {
                          if (!draggingStop || !vectorCanvasRef.current) return
                          const rect = vectorCanvasRef.current.getBoundingClientRect()
                          if (rect.width <= 0 || rect.height <= 0) return
                          const xRel = ((e.clientX - rect.left) / rect.width) * 100
                          const yRel = ((e.clientY - rect.top) / rect.height) * 100
                          // Inverter projeção: relX -> lng, relY -> lat
                          const newLng = centerLng + ((xRel - 50) / 80) * lngSpan
                          const newLat = centerLat - ((yRel - 50) / 75) * latSpan
                          setDraggingStop((prev) =>
                            prev ? { ...prev, currentLat: newLat, currentLng: newLng } : null,
                          )
                        }}
                        onMouseUp={() => {
                          if (!draggingStop) return
                          handleMarkerDragEnd(
                            draggingStop.courierId,
                            draggingStop.stopId,
                            draggingStop.currentLat,
                            draggingStop.currentLng,
                          )
                          setDraggingStop(null)
                        }}
                        className="relative z-20 flex-1 my-1 w-full rounded-xl bg-slate-950/80 border border-slate-700/60 p-2 overflow-hidden flex flex-col justify-between"
                      >
                        {/* Cartographic canvas overlay with real route lines and interactive draggable pins */}
                        <div className="relative w-full h-full min-h-[140px]">
                          {/* Trajeto viário real (Linha Azul / Linha colorida por entregador) */}
                          <svg
                            viewBox="0 0 100 100"
                            preserveAspectRatio="none"
                            className="absolute inset-0 w-full h-full pointer-events-none z-10"
                          >
                            <defs>
                              <filter
                                id="route-blue-glow"
                                x="-20%"
                                y="-20%"
                                width="140%"
                                height="140%"
                              >
                                <feDropShadow
                                  dx="0"
                                  dy="0"
                                  stdDeviation="1"
                                  floodColor="#3b82f6"
                                  floodOpacity="0.8"
                                />
                              </filter>
                            </defs>

                            {optimizationResult
                              ? optimizationResult.courierPlans.map((plan) => {
                                  const isTabActive =
                                    activeCourierTab === 'all' ||
                                    activeCourierTab === plan.courier.id
                                  if (!isTabActive) return null

                                  const geom = streetRouteGeometries[plan.courier.id]
                                  const effectiveStops = plan.stops.map((s) => {
                                    if (
                                      draggingStop &&
                                      draggingStop.courierId === plan.courier.id &&
                                      draggingStop.stopId === s.id
                                    ) {
                                      return {
                                        lat: draggingStop.currentLat,
                                        lng: draggingStop.currentLng,
                                      }
                                    }
                                    return { lat: s.lat, lng: s.lng }
                                  })

                                  const routeCoords: LatLngPoint[] =
                                    !draggingStop && geom && geom.points.length >= 2
                                      ? geom.points
                                      : [
                                          {
                                            lat: plan.start_base?.lat || centerLat,
                                            lng: plan.start_base?.lng || centerLng,
                                          },
                                          ...effectiveStops,
                                          {
                                            lat: plan.end_base?.lat || centerLat,
                                            lng: plan.end_base?.lng || centerLng,
                                          },
                                        ]

                                  if (routeCoords.length < 2) return null

                                  const pathD = routeCoords
                                    .map((pt, idx) => {
                                      const x = calcX(pt.lng).toFixed(1)
                                      const y = calcY(pt.lat).toFixed(1)
                                      return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
                                    })
                                    .join(' ')

                                  return (
                                    <g key={plan.courier.id}>
                                      {/* Linha externa larga azul viária com glow */}
                                      <path
                                        d={pathD}
                                        fill="none"
                                        stroke="#2563eb"
                                        strokeWidth="3.2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        filter="url(#route-blue-glow)"
                                        opacity="0.9"
                                      />
                                      {/* Linha interna colorida específica do entregador */}
                                      <path
                                        d={pathD}
                                        fill="none"
                                        stroke={plan.color || '#93c5fd'}
                                        strokeWidth="1.8"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        opacity="0.95"
                                      />
                                    </g>
                                  )
                                })
                              : /* Polyline para pedidos antes da otimização */
                                points.length > 1 && (
                                  <path
                                    d={points
                                      .map((p, idx) => {
                                        const x = calcX(p.lng).toFixed(1)
                                        const y = calcY(p.lat).toFixed(1)
                                        return `${idx === 0 ? 'M' : 'L'} ${x} ${y}`
                                      })
                                      .join(' ')}
                                    fill="none"
                                    stroke="#6366f1"
                                    strokeWidth="2"
                                    strokeDasharray="4,3"
                                    opacity="0.7"
                                  />
                                )}
                          </svg>

                          {/* Render pins on vector canvas */}
                          {points.map((p) => {
                            const isBeingDragged =
                              draggingStop &&
                              p.type === 'stop' &&
                              draggingStop.courierId === p.courierId &&
                              draggingStop.stopId === p.stopId

                            const renderLat = isBeingDragged ? draggingStop.currentLat : p.lat
                            const renderLng = isBeingDragged ? draggingStop.currentLng : p.lng

                            const x = calcX(renderLng)
                            const y = calcY(renderLat)

                            return (
                              <div
                                key={p.id}
                                style={{ left: `${x}%`, top: `${y}%` }}
                                onMouseDown={(e) => {
                                  if (p.type === 'stop' && p.courierId && p.stopId) {
                                    e.preventDefault()
                                    e.stopPropagation()
                                    setDraggingStop({
                                      courierId: p.courierId,
                                      stopId: p.stopId,
                                      initialLat: p.lat,
                                      initialLng: p.lng,
                                      currentLat: p.lat,
                                      currentLng: p.lng,
                                    })
                                  }
                                }}
                                className={`absolute -translate-x-1/2 -translate-y-1/2 group select-none ${
                                  p.type === 'stop' && p.courierId && p.stopId
                                    ? 'cursor-grab active:cursor-grabbing z-40'
                                    : 'cursor-pointer z-30'
                                } ${isBeingDragged ? 'scale-125 z-50' : ''}`}
                                title={`${p.label}${p.sublabel ? ` - ${p.sublabel}` : ''}`}
                              >
                                <div
                                  className={`flex items-center justify-center rounded-full text-white font-bold shadow-lg ring-2 ring-white/70 transition-transform ${
                                    isBeingDragged
                                      ? 'ring-amber-400 scale-125 shadow-amber-500/50'
                                      : 'hover:scale-125'
                                  } ${
                                    p.type === 'start'
                                      ? 'h-6 px-2 bg-emerald-600 text-[10px] gap-1 shadow-emerald-500/30'
                                      : p.type === 'end'
                                        ? 'h-6 px-2 bg-rose-600 text-[10px] gap-1 shadow-rose-500/30'
                                        : 'h-6 w-6 bg-orange-500 text-[10px] shadow-orange-500/30'
                                  }`}
                                  style={
                                    p.type === 'stop' ? { backgroundColor: p.color } : undefined
                                  }
                                >
                                  {p.type === 'start' && <span>🟢 Partida</span>}
                                  {p.type === 'end' && <span>🏁 Chegada</span>}
                                  {p.type === 'stop' && <span>{p.badge}</span>}
                                </div>

                                {/* Tooltip on hover */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 hidden group-hover:flex flex-col z-50 whitespace-nowrap bg-slate-900 text-white text-[10px] px-2.5 py-1.5 rounded-lg shadow-2xl border border-slate-700 pointer-events-none">
                                  <strong className="text-slate-100">{p.label}</strong>
                                  {p.sublabel && (
                                    <p className="text-slate-400 text-[9px] max-w-[220px] truncate">
                                      {p.sublabel}
                                    </p>
                                  )}
                                  {p.type === 'stop' && (
                                    <span className="text-[9px] text-amber-400 mt-0.5">
                                      ✋ Clique e arraste para reposicionar na rota
                                    </span>
                                  )}
                                </div>
                              </div>
                            )
                          })}
                        </div>

                        {/* Bottom legend with departure, finish and stops summary */}
                        <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800 text-[10px] text-slate-300">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="font-bold text-emerald-400">🟢 Partida:</span>
                            <span className="truncate max-w-[140px] text-slate-200 font-medium">
                              {fallbackStartBase.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 text-slate-400">
                            <span className="flex items-center gap-1 text-blue-300">
                              <span className="h-1.5 w-3 rounded-full bg-blue-500 inline-block" />
                              Rota Real
                            </span>
                            <span>•</span>
                            <span>📍 {points.filter((p) => p.type === 'stop').length} paradas</span>
                          </div>
                          <div className="flex items-center gap-1.5 truncate justify-end">
                            <span className="font-bold text-rose-400">🏁 Chegada:</span>
                            <span className="truncate max-w-[140px] text-slate-200 font-medium">
                              {fallbackEndBase.name}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })()}

                  <div className="relative z-20 text-[10px] text-slate-400 flex items-center justify-between">
                    <span>🟢 Partida | 📍 Paradas Ordenadas | 🏁 Ponto de Chegada</span>
                    <span>💡 Menor trajeto TSP com Ida e Volta</span>
                  </div>
                </div>
              )}
            </div>
          </div>
          {/* Step 3: Courier Route Cards Breakdown & Reordering */}
          {optimizationResult && (
            <div className="space-y-3 pt-1">
              {/* Summary Bar: Total Distância, Tempo e Custo de Combustível */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 p-3 rounded-xl bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 text-xs">
                <div className="flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-indigo-600" />
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">
                      Distância Total (Ida + Volta)
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      {optimizationResult.totalDistanceKm} km
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-amber-600" />
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">
                      Previsão de Tempo
                    </span>
                    <span className="font-bold text-slate-900 dark:text-white">
                      ~{optimizationResult.totalDurationMinutes} minutos
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Fuel className="h-4 w-4 text-emerald-600" />
                  <div>
                    <span className="text-slate-500 block text-[10px] uppercase font-bold">
                      Custo de Combustível Estimado
                    </span>
                    <span className="font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                      R$ {optimizationResult.totalEstimatedFuelCost.toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-indigo-600" />
                    Sequência das Rotas &amp; Ajuste Manual (Sincronizado com o Mapa)
                  </Label>
                  <p className="text-[11px] text-slate-500">
                    Ponto de partida 🟢 → paradas ordenadas 1..N → ponto de chegada 🏁. Suba/desça
                    posições ou arraste os pins no mapa.
                  </p>
                </div>

                {/* Filter Tab Buttons */}
                <div className="flex items-center gap-1 overflow-x-auto pb-1 max-w-[280px] sm:max-w-none">
                  <Button
                    type="button"
                    variant={activeCourierTab === 'all' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setActiveCourierTab('all')}
                    className="h-6 text-[10px] px-2 rounded-full"
                  >
                    Ver Todos
                  </Button>
                  {optimizationResult.courierPlans.map((plan) => (
                    <Button
                      key={plan.courier.id}
                      type="button"
                      variant={activeCourierTab === plan.courier.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveCourierTab(plan.courier.id)}
                      className="h-6 text-[10px] px-2 rounded-full flex items-center gap-1"
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: plan.color }}
                      />
                      {plan.courier.name.split(' ')[0]}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Plans Grid with Editable Stops */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-80 overflow-y-auto pr-1">
                {optimizationResult.courierPlans
                  .filter((p) => activeCourierTab === 'all' || activeCourierTab === p.courier.id)
                  .map((plan) => (
                    <div
                      key={plan.courier.id}
                      className="rounded-xl border border-slate-200 bg-white p-3.5 dark:border-slate-800 dark:bg-slate-900 shadow-sm space-y-2.5"
                    >
                      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-2">
                        <div className="flex items-center gap-2">
                          <span
                            className="h-3 w-3 rounded-full shrink-0 ring-2 ring-white shadow"
                            style={{ backgroundColor: plan.color }}
                          />
                          <div>
                            <p className="text-xs font-bold text-slate-900 dark:text-white">
                              {plan.courier.name}
                            </p>
                            <p className="text-[10px] text-slate-500">
                              Veículo: {plan.courier.vehicle_type || 'Moto'} (
                              {plan.courier.vehicle_plate || 'Sem placa'})
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap justify-end">
                          <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] border">
                            {plan.stops.length} paradas • {plan.total_distance_km} km
                          </Badge>
                          {plan.courier.vehicle_type === 'bicicleta' ||
                          plan.courier.vehicle_type === 'bicycle' ? (
                            <Badge className="bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300 text-[10px] border-sky-200">
                              🚲 Telemetria GPS (0L)
                            </Badge>
                          ) : (
                            <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] border-emerald-200">
                              ⛽ R$ {plan.estimated_fuel_cost.toFixed(2)}
                            </Badge>
                          )}
                        </div>
                      </div>

                      {/* Ponto de Partida visual */}
                      <div className="p-2 rounded-lg bg-emerald-50/80 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-2 text-[11px]">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white font-bold text-[10px]">
                          🟢
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-emerald-900 dark:text-emerald-200 truncate">
                            Partida: {plan.start_base?.name || 'Base Central Rotaly'}
                          </p>
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-300 truncate">
                            {plan.start_base?.address}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-white text-emerald-700 border-emerald-300"
                        >
                          Início
                        </Badge>
                      </div>

                      {/* Sequence stops list with reordering controls */}
                      <div className="space-y-1.5 text-xs max-h-48 overflow-y-auto">
                        {plan.stops.length === 0 ? (
                          <p className="text-xs text-slate-400 py-2 text-center">
                            Nenhuma entrega nesta rota.
                          </p>
                        ) : (
                          plan.stops.map((stop, sIdx) => (
                            <div
                              key={stop.id}
                              className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-[11px] gap-2"
                            >
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <span
                                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-white font-bold text-[9px]"
                                  style={{ backgroundColor: plan.color }}
                                >
                                  {sIdx + 1}
                                </span>
                                <div className="min-w-0">
                                  <p className="font-semibold text-slate-900 dark:text-white truncate">
                                    {stop.customer_name}
                                  </p>
                                  <p className="text-[10px] text-slate-400 truncate max-w-[150px]">
                                    {stop.address}
                                  </p>
                                </div>
                              </div>

                              {/* Action Controls: Move Up, Move Down, Reassign, Remove */}
                              <div className="flex items-center gap-1 shrink-0">
                                {/* Move Up */}
                                <button
                                  type="button"
                                  disabled={sIdx === 0}
                                  onClick={() => moveStopInPlan(plan.courier.id, sIdx, 'up')}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25"
                                  title="Mover para cima"
                                >
                                  <ArrowUp className="h-3 w-3 text-slate-600 dark:text-slate-300" />
                                </button>

                                {/* Move Down */}
                                <button
                                  type="button"
                                  disabled={sIdx === plan.stops.length - 1}
                                  onClick={() => moveStopInPlan(plan.courier.id, sIdx, 'down')}
                                  className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25"
                                  title="Mover para baixo"
                                >
                                  <ArrowDown className="h-3 w-3 text-slate-600 dark:text-slate-300" />
                                </button>

                                {/* Reassign to another courier */}
                                {optimizationResult.courierPlans.length > 1 && (
                                  <select
                                    className="h-6 text-[10px] px-1 bg-white dark:bg-slate-800 border rounded text-slate-700 dark:text-slate-300 max-w-[70px]"
                                    value=""
                                    onChange={(e) => {
                                      if (e.target.value) {
                                        reassignStopToAnotherCourier(
                                          plan.courier.id,
                                          e.target.value,
                                          sIdx,
                                        )
                                      }
                                    }}
                                    title="Reatribuir a outro entregador"
                                  >
                                    <option value="" disabled>
                                      Mover...
                                    </option>
                                    {optimizationResult.courierPlans
                                      .filter((p) => p.courier.id !== plan.courier.id)
                                      .map((other) => (
                                        <option key={other.courier.id} value={other.courier.id}>
                                          → {other.courier.name.split(' ')[0]}
                                        </option>
                                      ))}
                                  </select>
                                )}

                                {/* Remove Stop from route */}
                                <button
                                  type="button"
                                  onClick={() => removeStopFromPlan(plan.courier.id, sIdx)}
                                  className="p-1 rounded hover:bg-rose-100 dark:hover:bg-rose-950 text-rose-500"
                                  title="Remover desta rota"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Ponto de Chegada visual */}
                      <div className="p-2 rounded-lg bg-rose-50/80 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800/50 flex items-center gap-2 text-[11px]">
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-rose-600 text-white font-bold text-[10px]">
                          🏁
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-bold text-rose-900 dark:text-rose-200 truncate">
                            Chegada / Retorno:{' '}
                            {plan.end_base?.name || plan.start_base?.name || 'Base'}
                          </p>
                          <p className="text-[10px] text-rose-700 dark:text-rose-300 truncate">
                            {plan.end_base?.address || plan.start_base?.address}
                          </p>
                        </div>
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-white text-rose-700 border-rose-300"
                        >
                          Fim
                        </Badge>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}{' '}
        </div>

        <DialogFooter className="gap-2 sm:gap-2 pt-2 border-t border-slate-100 dark:border-slate-800 flex-col sm:flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            onClick={() => handleApplyDistribution(false)}
            disabled={
              isApplying ||
              isOptimizing ||
              !optimizationResult ||
              optimizationResult.courierPlans.length === 0
            }
            className="bg-slate-700 hover:bg-slate-800 text-white font-semibold text-xs flex items-center gap-1.5"
            title="Apenas salva a ordem otimizada sem liberar no app do entregador ainda"
          >
            {isOptimizing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span>Otimizando rota com motor viário...</span>
              </>
            ) : isApplying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Salvando...</span>
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                <span>Salvar Ordem (Sem Liberar)</span>
              </>
            )}
          </Button>
          <Button
            type="button"
            onClick={() => handleApplyDistribution(true)}
            disabled={
              isApplying ||
              isOptimizing ||
              !optimizationResult ||
              optimizationResult.courierPlans.length === 0
            }
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/25 flex items-center gap-1.5"
            title="Salva a rota otimizada e já libera no app do entregador com alerta sonoro/push"
          >
            {isOptimizing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-300" />
                <span>Otimizando rota com motor viário...</span>
              </>
            ) : isApplying ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Liberando...</span>
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 text-amber-300" />
                <span>🚀 Salvar & Liberar Rota</span>
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Modal de Edição de Cliente na Etapa 2 */}
      {customerToEdit && (
        <CreateCustomerModal
          open={isEditCustomerModalOpen}
          onOpenChange={(isOpen) => {
            setIsEditCustomerModalOpen(isOpen)
            if (!isOpen) setCustomerToEdit(null)
          }}
          customerToEdit={customerToEdit}
          onCustomerCreated={handleCustomerSaved}
        />
      )}

      {/* Confirmação de Exclusão de Cliente e Entregas em Cascata */}
      <AlertDialog
        open={Boolean(customerToDelete)}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isDeletingCustomer) {
            setCustomerToDelete(null)
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Trash2 className="h-5 w-5 text-rose-600 shrink-0" />
              Excluir Cliente e Entregas Pendentes?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2 text-slate-700 dark:text-slate-300">
              <p>
                Tem certeza que deseja excluir o cliente{' '}
                <strong className="text-slate-900 dark:text-white">
                  &ldquo;{customerToDelete?.name}&rdquo;
                </strong>
                ?
              </p>
              <div className="text-xs bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/50 p-2.5 rounded-lg text-rose-800 dark:text-rose-300">
                ⚠️ <strong>Atenção:</strong> Esta ação apagará permanentemente o cadastro do cliente
                e <strong>todas as entregas pendentes vinculadas a ele</strong>. Pedidos já em
                trânsito ou em rota iniciada bloquearão a exclusão por segurança.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel disabled={isDeletingCustomer} className="w-full sm:w-auto">
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDeleteCustomer}
              disabled={isDeletingCustomer}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white flex items-center justify-center gap-1.5"
            >
              <Trash2 className="h-4 w-4" />
              {isDeletingCustomer ? 'Excluindo...' : 'Sim, Excluir Cliente'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Modal: Incluir Cliente / Entrega em Rota Já Iniciada */}
      <Dialog
        open={includeOrderModalOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            setIncludeOrderModalOpen(false)
            setTargetCourierForInclude(null)
            setSelectedIncludeOrderId('')
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-indigo-700 dark:text-indigo-400">
              <Plus className="h-5 w-5" />
              Incluir Cliente em Rota Já Iniciada
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {targetCourierForInclude && (
              <div className="p-3 rounded-lg bg-indigo-50 dark:bg-indigo-950/50 border border-indigo-200 dark:border-indigo-900/60 text-xs space-y-1">
                <p className="font-semibold text-slate-800 dark:text-slate-200">
                  Entregador:{' '}
                  <span className="text-indigo-700 dark:text-indigo-300 font-bold">
                    {targetCourierForInclude.name}
                  </span>
                </p>
                <p className="text-slate-600 dark:text-slate-400">
                  Veículo:{' '}
                  {targetCourierForInclude.vehicle_model ||
                    targetCourierForInclude.vehicle_type ||
                    'Moto'}
                  {targetCourierForInclude.vehicle_plate
                    ? ` • Placa: ${targetCourierForInclude.vehicle_plate}`
                    : ''}
                </p>
                <p className="text-[11px] text-slate-500">
                  O cliente será incluído como a próxima parada da rota atual. O entregador receberá
                  a notificação em tempo real.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Selecione a entrega pendente a adicionar:
                </Label>
                <span className="text-[11px] text-slate-500 font-medium">
                  {strictlyPendingOrders.length} disponível(is)
                </span>
              </div>

              {strictlyPendingOrders.length === 0 ? (
                <div className="p-4 text-center rounded-lg border border-dashed border-slate-300 text-xs text-slate-500">
                  Nenhuma entrega pendente disponível para inclusão.
                </div>
              ) : (
                <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                  {strictlyPendingOrders.map((ord) => {
                    const cust =
                      localCustomers.find((c) => c.id === ord.customer_id) ||
                      ord.expand?.customer_id
                    const isSelected = selectedIncludeOrderId === ord.id
                    const isInStep2 = selectedOrderIds.includes(ord.id)

                    return (
                      <div
                        key={ord.id}
                        onClick={() => setSelectedIncludeOrderId(ord.id)}
                        className={`p-2.5 rounded-lg border transition cursor-pointer select-none text-xs flex items-center justify-between gap-2 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 ring-2 ring-indigo-500/30'
                            : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="font-bold text-slate-900 dark:text-white truncate">
                              {cust?.name || 'Cliente'}
                            </p>
                            {isInStep2 && (
                              <Badge
                                variant="secondary"
                                className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200 border-indigo-200 dark:border-indigo-800 font-semibold shrink-0"
                              >
                                Na Etapa 2
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {cust?.address || 'Sem endereço'}
                          </p>
                          <p className="text-[10px] text-indigo-600 dark:text-indigo-400 font-mono mt-0.5">
                            Rastreio: {ord.tracking_code || ord.id.slice(0, 8)}
                          </p>
                        </div>
                        <input
                          type="radio"
                          name="include-order-choice"
                          checked={isSelected}
                          onChange={() => setSelectedIncludeOrderId(ord.id)}
                          className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 shrink-0 ml-2 cursor-pointer"
                        />
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Impacto no Término Projetado e Carga Horária ao incluir */}
            {targetCourierForInclude &&
              selectedIncludeOrderId &&
              (() => {
                const courierOrders = localOrders.filter(
                  (o) =>
                    o.courier_id === targetCourierForInclude.id &&
                    (o.status === 'in_transit' ||
                      (o.route_started && o.status !== 'delivered' && o.status !== 'cancelled')),
                )
                const courierLoc = locations.find((l) => l.user_id === targetCourierForInclude.id)
                const effectiveSpeedKmh =
                  courierLoc && typeof courierLoc.speed === 'number' && courierLoc.speed > 5
                    ? courierLoc.speed
                    : 25
                const speedMps = effectiveSpeedKmh * (1000 / 3600)

                const primaryOrder = courierOrders[0]
                const defaultBase = baseAddresses.find((b) => b.is_default) || baseAddresses[0]
                const fallbackBasePos = {
                  lat: defaultBase?.lat || -22.7001402,
                  lng: defaultBase?.lng || -43.2982834,
                }

                const startPos =
                  courierLoc?.lat && courierLoc?.lng
                    ? { lat: Number(courierLoc.lat), lng: Number(courierLoc.lng) }
                    : primaryOrder?.start_base_lat && primaryOrder?.start_base_lng
                      ? {
                          lat: Number(primaryOrder.start_base_lat),
                          lng: Number(primaryOrder.start_base_lng),
                        }
                      : fallbackBasePos

                const returnBasePos =
                  primaryOrder?.end_address_lat && primaryOrder?.end_address_lng
                    ? {
                        lat: Number(primaryOrder.end_address_lat),
                        lng: Number(primaryOrder.end_address_lng),
                      }
                    : primaryOrder?.start_base_lat && primaryOrder?.start_base_lng
                      ? {
                          lat: Number(primaryOrder.start_base_lat),
                          lng: Number(primaryOrder.start_base_lng),
                        }
                      : fallbackBasePos

                const pendingStopsSorted = [...courierOrders].sort(
                  (a, b) => (a.sequence || 0) - (b.sequence || 0),
                )
                const currentPendingStops = pendingStopsSorted
                  .map((o) => {
                    const cust =
                      localCustomers.find((c) => c.id === o.customer_id) || o.expand?.customer_id
                    return cust?.lat && cust?.lng
                      ? { lat: Number(cust.lat), lng: Number(cust.lng) }
                      : null
                  })
                  .filter(Boolean) as { lat: number; lng: number }[]

                // Rota atual
                let currentRoadDist = 0
                let curPos = startPos
                for (const stop of currentPendingStops) {
                  currentRoadDist +=
                    haversineDistance(curPos.lat, curPos.lng, stop.lat, stop.lng) * 1.3
                  curPos = stop
                }
                currentRoadDist +=
                  haversineDistance(curPos.lat, curPos.lng, returnBasePos.lat, returnBasePos.lng) *
                  1.3
                const currentServiceMins = currentPendingStops.length * 6
                const currentTravelMins = Math.round(currentRoadDist / speedMps / 60)
                const currentEtaMins = Math.max(1, currentTravelMins + currentServiceMins)

                // Rota com inclusão
                const candOrder = localOrders.find((o) => o.id === selectedIncludeOrderId)
                const candCust = candOrder
                  ? localCustomers.find((c) => c.id === candOrder.customer_id) ||
                    candOrder.expand?.customer_id
                  : null
                const candPos =
                  candCust?.lat && candCust?.lng
                    ? { lat: Number(candCust.lat), lng: Number(candCust.lng) }
                    : null

                const withCandidateStops = candPos
                  ? [...currentPendingStops, candPos]
                  : currentPendingStops

                let withCandidateRoadDist = 0
                let curPosCand = startPos
                for (const stop of withCandidateStops) {
                  withCandidateRoadDist +=
                    haversineDistance(curPosCand.lat, curPosCand.lng, stop.lat, stop.lng) * 1.3
                  curPosCand = stop
                }
                withCandidateRoadDist +=
                  haversineDistance(
                    curPosCand.lat,
                    curPosCand.lng,
                    returnBasePos.lat,
                    returnBasePos.lng,
                  ) * 1.3
                const withCandidateServiceMins = withCandidateStops.length * 6
                const withCandidateTravelMins = Math.round(withCandidateRoadDist / speedMps / 60)
                const withCandidateEtaMins = Math.max(
                  1,
                  withCandidateTravelMins + withCandidateServiceMins,
                )

                const routeStartTimestamp =
                  primaryOrder?.route_started_at ||
                  primaryOrder?.route_released_at ||
                  primaryOrder?.created ||
                  undefined

                const shiftConfig = appSettings
                  ? {
                      workStartTime: appSettings.work_start_time,
                      lunchStartTime: appSettings.lunch_start_time,
                      lunchEndTime: appSettings.lunch_end_time,
                      workEndTime: appSettings.work_end_time,
                    }
                  : undefined

                const shiftBefore = calculateRouteWorkShift(
                  currentEtaMins,
                  routeStartTimestamp,
                  Date.now(),
                  shiftConfig,
                )
                const shiftAfter = calculateRouteWorkShift(
                  withCandidateEtaMins,
                  routeStartTimestamp,
                  Date.now(),
                  shiftConfig,
                )
                const diffMinutes = Math.max(
                  0,
                  shiftAfter.remainingRouteMinutes - shiftBefore.remainingRouteMinutes,
                )

                return (
                  <div className="p-3 rounded-lg border border-indigo-200 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/70 to-slate-50/70 dark:from-slate-900/80 dark:to-indigo-950/40 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                        Impacto no Término Projetado da Rota:
                      </p>
                      <span className="text-[10px] text-indigo-700 dark:text-indigo-300 font-semibold">
                        +{diffMinutes} min na rota
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="p-2 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
                        <p className="text-slate-500 dark:text-slate-400 text-[10px]">
                          Previsão Atual
                        </p>
                        <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                          ⏱ {shiftBefore.remainingFormatted}
                        </p>
                        <p className="text-slate-600 dark:text-slate-400 text-[10px]">
                          Término: {shiftBefore.projectedEndTimeFormatted}
                        </p>
                      </div>

                      <div className="p-2 rounded bg-indigo-100/60 dark:bg-indigo-950/80 border border-indigo-300 dark:border-indigo-800">
                        <p className="text-indigo-800 dark:text-indigo-300 font-semibold text-[10px]">
                          Após Inclusão
                        </p>
                        <p className="font-bold text-indigo-950 dark:text-indigo-100 mt-0.5">
                          ⏱ {shiftAfter.remainingFormatted}
                        </p>
                        <p className="text-indigo-900 dark:text-indigo-200 text-[10px] font-medium">
                          Término: {shiftAfter.projectedEndTimeFormatted}
                        </p>
                      </div>
                    </div>

                    {/* Badge de Impacto de Carga Horária */}
                    <div className="pt-1 flex items-center justify-between">
                      {shiftAfter.isOvertime ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300 font-bold text-[10px] border border-amber-300 dark:border-amber-800">
                          ⚠️ Passa da carga horária (+{shiftAfter.overtimeMinutes} min)
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300 font-bold text-[10px] border border-emerald-300 dark:border-emerald-800">
                          ✓ Dentro da carga horária
                        </span>
                      )}

                      {shiftAfter.isOvertime && (
                        <span className="text-[10px] text-amber-700 dark:text-amber-400 font-medium">
                          ⚠️ Aceitar este pedido fará o entregador exceder a carga horária em +
                          {shiftAfter.overtimeMinutes} min.
                        </span>
                      )}
                    </div>
                  </div>
                )
              })()}
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIncludeOrderModalOpen(false)
                setTargetCourierForInclude(null)
                setSelectedIncludeOrderId('')
              }}
              disabled={isSubmittingInclude}
              className="w-full sm:w-auto text-xs"
            >
              Cancelar
            </Button>
            <Button
              type="button"
              onClick={handleConfirmIncludeCustomer}
              disabled={isSubmittingInclude || !selectedIncludeOrderId}
              className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              {isSubmittingInclude ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Incluindo...
                </>
              ) : (
                <>
                  <Check className="h-3.5 w-3.5" />
                  Confirmar Inclusão
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* AlertDialog: Cancelar Rota Já Iniciada */}
      <AlertDialog
        open={cancelRouteAlertOpen}
        onOpenChange={(isOpen) => {
          if (!isOpen && !isSubmittingCancel) {
            setCancelRouteAlertOpen(false)
            setTargetCourierForCancel(null)
          }
        }}
      >
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <Ban className="h-5 w-5 text-rose-600 shrink-0" />
              Cancelar Rota em Andamento?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2 text-slate-700 dark:text-slate-300 text-xs">
              <p>
                Tem certeza que deseja cancelar a rota de{' '}
                <strong className="text-slate-900 dark:text-white">
                  {targetCourierForCancel?.name}
                </strong>
                ?
              </p>
              <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200 space-y-1">
                <p className="font-semibold flex items-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" /> Regra do cancelamento:
                </p>
                <ul className="list-disc list-inside space-y-0.5 text-[11px]">
                  <li>
                    Todas as entregas <strong>pendentes</strong> voltam para a{' '}
                    <strong>Etapa 2</strong> disponíveis para nova roteirização.
                  </li>
                  <li>
                    Entregas <strong>já concluídas</strong> continuam salvas no histórico com
                    comprovante.
                  </li>
                  <li>O entregador será liberado para novas rotas e notificado em tempo real.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              disabled={isSubmittingCancel}
              onClick={() => {
                setCancelRouteAlertOpen(false)
                setTargetCourierForCancel(null)
              }}
              className="w-full sm:w-auto text-xs"
            >
              Manter Rota
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmittingCancel}
              onClick={handleConfirmCancelRoute}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold flex items-center gap-1.5"
            >
              {isSubmittingCancel ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Cancelando...
                </>
              ) : (
                <>
                  <Ban className="h-3.5 w-3.5" />
                  Sim, Cancelar Rota
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Alerta de Blindagem: Base de Partida a mais de 100 km do centróide das entregas */}
      <AlertDialog open={distanceAlertOpen} onOpenChange={setDistanceAlertOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-rose-600 dark:text-rose-400">
              <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
              Atenção: Base de partida muito distante
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 pt-2 text-slate-700 dark:text-slate-300">
              <p>
                A base de partida selecionada (
                <strong className="text-slate-900 dark:text-white">
                  {distanceAlertInfo?.baseName}
                </strong>
                ) está a aproximadamente{' '}
                <span className="font-bold text-rose-600 dark:text-rose-400 text-base">
                  {distanceAlertInfo?.distanceKm} km
                </span>{' '}
                do grupo de entregas selecionadas.
              </p>
              {distanceAlertInfo?.baseAddress && (
                <p className="text-xs bg-slate-100 dark:bg-slate-800 p-2 rounded text-slate-600 dark:text-slate-400">
                  📍 {distanceAlertInfo.baseAddress}
                </p>
              )}
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Isso pode gerar quilometragens absurdas e rotas entre estados incorretos.
                Recomendamos verificar o cadastro da base ou escolher outra base no seletor de
                partida.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel
              onClick={() => {
                setDistanceAlertOpen(false)
                setIsEditingBases(true)
              }}
              className="w-full sm:w-auto"
            >
              Trocar ou Corrigir Base
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setDistanceAlertOpen(false)
                runRouteOptimization(true)
              }}
              className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white"
            >
              Continuar Mesmo Assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
