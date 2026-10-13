import React, { useState, useEffect, useMemo, useRef } from 'react'
import { haversineDistanceMeters } from '@/lib/geo'
import { reverseGeocodeCoordinates } from '@/lib/googleMaps'
import {
  MapPin,
  CheckCircle,
  Phone,
  Play,
  RotateCcw,
  CheckCircle2,
  Lock,
  Navigation,
  XCircle,
  Clock,
  Smartphone,
  HelpCircle,
  Sun,
  Radio,
  AlertTriangle,
  WifiOff,
  Database,
  Compass,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { DeliveryConfirmationModal } from '@/components/DeliveryConfirmationModal'
import { CancelDeliveryModal } from '@/components/CancelDeliveryModal'
import { RedirectDeliveryModal } from '@/components/RedirectDeliveryModal'
import {
  CourierRedirectionTutorialModal,
  COURIER_REDIRECTION_TUTORIAL_KEY,
  COURIER_POINT_A_HINT_KEY,
} from '@/components/CourierRedirectionTutorialModal'
import { IPhoneGpsGuideModal } from '@/components/IPhoneGpsGuideModal'
import { NavigationAppChoiceModal } from '@/components/NavigationAppChoiceModal'
import {
  CourierBatteryGuideModal,
  BATTERY_OPTIMIZATION_ACK_KEY,
} from '@/components/CourierBatteryGuideModal'
import {
  CourierBackgroundPermissionModal,
  BACKGROUND_PERMISSION_ACK_KEY,
} from '@/components/CourierBackgroundPermissionModal'
import pb from '@/lib/pocketbase/client'
import { getUserGeolocation } from '@/components/BaseAddressAutocomplete'
import { deliveryService } from '@/services/deliveryService'
import { offlineTelemetryBuffer } from '@/services/offlineTelemetryBuffer'
import { offlineRouteStorage } from '@/services/offlineRouteStorage'
import { nativeGpsBridge } from '@/services/nativeGpsBridge'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import { APP_VERSION_LABEL } from '@/lib/version'
import type { OrderRecord } from '@/types/delivery'
import {
  notifyCourierNewDelivery,
  playOffRouteWarningSound,
  playLongPresenceAlarm,
  stopLongPresenceAlarm,
  sendBrowserPushNotification,
} from '@/lib/notificationSound'
import { ForcedPresenceAlert, ForcedPresenceReason } from '@/components/ForcedPresenceAlert'
import { shouldDisplayToast } from '@/lib/notificationDedupe'
import type { NotificationRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Camera, Gauge } from 'lucide-react'
import { toast } from 'sonner'
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

  // Modais de ação
  const [selectedOrderForConfirmation, setSelectedOrderForConfirmation] =
    useState<OrderRecord | null>(null)
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false)
  const [selectedOrderForCancel, setSelectedOrderForCancel] = useState<OrderRecord | null>(null)
  const [isCancelModalOpen, setIsCancelModalOpen] = useState(false)
  const [selectedOrderForRedirect, setSelectedOrderForRedirect] = useState<OrderRecord | null>(null)
  const [isRedirectModalOpen, setIsRedirectModalOpen] = useState(false)
  const [isTutorialModalOpen, setIsTutorialModalOpen] = useState(false)
  const [isStartRouteModalOpen, setIsStartRouteModalOpen] = useState(false)
  const [isFinishRouteModalOpen, setIsFinishRouteModalOpen] = useState(false)
  const [isNavigationChoiceOpen, setIsNavigationChoiceOpen] = useState(false)
  const [navigationTarget, setNavigationTarget] = useState<{
    name: string
    address?: string
    lat?: number
    lng?: number
  } | null>(null)

  // Estado de envio das macros de ocorrência de 1 clique (Item O)
  const [isSubmittingMacro, setIsSubmittingMacro] = useState<string | null>(null)

  // Disparo de macro de ocorrência de 1 clique
  const handleSendMacroOccurrence = async (
    type: 'blitz_transito' | 'rua_bloqueada' | 'beco_a_pe',
    label: string,
  ) => {
    if (!user?.id) {
      toast.error('Entregador não identificado.')
      return
    }
    const currentBatchKey =
      currentRouteOrders[0]?.route_batch_key ||
      orders[0]?.route_batch_key ||
      `batch_${user.id}_${new Date().toISOString().slice(0, 10)}`

    setIsSubmittingMacro(type)
    try {
      let lat = -22.6977499
      let lng = -43.2936013
      try {
        const coords = await getUserGeolocation()
        if (coords?.lat && coords?.lng) {
          lat = coords.lat
          lng = coords.lng
        }
      } catch {
        /* intentionally ignored */
      }

      const nowIso = new Date().toISOString()
      const firstOrderId = currentRouteOrders[0]?.id || orders[0]?.id || ''

      // Gravar na coleção off_route_events vinculando ao route_batch_key
      await pb.collection('off_route_events').create({
        courier_id: user.id,
        order_id: firstOrderId,
        event_type: type,
        deviation_distance_meters: 0,
        address: `Macro 1 clique: ${label} [lote: ${currentBatchKey}]`,
        notes: `Sinalização do entregador: ${label} vinculada ao lote ${currentBatchKey}`,
        location_lat: lat,
        location_lng: lng,
      })

      // Gravar no audit_trail para trilha transparente
      try {
        await pb.collection('audit_trail').create({
          user_id: user.id,
          collection: 'off_route_events',
          record_id: firstOrderId,
          courier_id: user.id,
          action: 'ocorrencia_macro_entregador',
          field: 'event_type',
          old_value: '',
          new_value: label,
          timestamp: nowIso,
          metadata: {
            system_trigger: false,
            actor_name: user.name || user.email || 'Entregador',
            route_batch_key: currentBatchKey,
            macro_type: type,
            lat,
            lng,
          },
        })
      } catch {
        /* intentionally ignored */
      }

      toast.success(`✅ Ocorrência "${label}" registrada!`, {
        description: 'Sua sinalização foi gravada para a triagem e fechamento das 21h30.',
        duration: 5000,
      })
    } catch (err: any) {
      console.warn('[CourierApp] Erro ao registrar macro:', err)
      toast.error('Falha ao registrar ocorrência. Tente novamente.')
    } finally {
      setIsSubmittingMacro(null)
    }
  }

  // Alerta com Presença Forçada em Tela Cheia Vermelha (Bloco 1)
  const [forcedAlertOpen, setForcedAlertOpen] = useState(false)
  const [forcedAlertReason, setForcedAlertReason] = useState<ForcedPresenceReason>('off_route')
  const [forcedAlertDetails, setForcedAlertDetails] = useState<{
    distanceMeters?: number
    durationMinutes?: number
    trackingCode?: string
    timeAtBase?: string
    openRouteDuration?: string
  }>({})
  const alarmControllerRef = useRef<{ stop: () => void } | null>(null)

  const stopActiveAlarm = () => {
    if (alarmControllerRef.current) {
      alarmControllerRef.current.stop()
      alarmControllerRef.current = null
    }
    stopLongPresenceAlarm()
  }

  const triggerForcedAlert = (
    reason: ForcedPresenceReason,
    details?: {
      distanceMeters?: number
      durationMinutes?: number
      trackingCode?: string
      timeAtBase?: string
      openRouteDuration?: string
    },
  ) => {
    setForcedAlertReason(reason)
    setForcedAlertDetails(details || {})
    setForcedAlertOpen(true)
    // Iniciar alarme longo de ~30s
    stopActiveAlarm()
    alarmControllerRef.current = playLongPresenceAlarm(30)
  }

  const handleAcknowledgeForcedAlert = async () => {
    stopActiveAlarm()
    setForcedAlertOpen(false)
    // Registrar em audit_trail que o entregador foi alertado e reagiu
    try {
      if (user?.id) {
        await deliveryService.logAuditTrail({
          user_id: user.id,
          actor_name: user.name || user.email || 'Entregador',
          action: 'forced_presence_acknowledged',
          collection: 'users',
          record_id: user.id,
          field: 'status',
          metadata: {
            reason: forcedAlertReason,
            details: forcedAlertDetails,
            acknowledged_at: new Date().toISOString(),
          },
        })
      }
    } catch (err) {
      console.warn('Erro ao registrar ciência em audit_trail:', err)
    }
  }

  // Status de GPS e rede em tempo real com distinção de motivo
  const [gpsStatus, setGpsStatus] = useState<'active' | 'disabled' | 'offline'>('active')
  const [gpsFailureDetail, setGpsFailureDetail] = useState<
    | 'none'
    | 'permission_denied'
    | 'background_permission_missing'
    | 'weak_signal'
    | 'position_unavailable'
    | 'unsupported'
  >('none')
  const [hasBackgroundPermission, setHasBackgroundPermission] = useState<boolean>(true)
  const [isBackgroundPermissionModalOpen, setIsBackgroundPermissionModalOpen] = useState(false)
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [isServingFromOfflineCache, setIsServingFromOfflineCache] = useState(false)
  const [offlineCacheSavedAt, setOfflineCacheSavedAt] = useState<number | null>(null)
  const [pendingBufferedPoints, setPendingBufferedPoints] = useState<number>(0)
  const [isFlushingBuffer, setIsFlushingBuffer] = useState<boolean>(false)
  const [isIPhoneGuideOpen, setIsIPhoneGuideOpen] = useState(false)
  const [isBatteryGuideOpen, setIsBatteryGuideOpen] = useState(false)
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>(true)
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false)

  const [isGpsActive] = useState(true)

  const [isLoading, setIsLoading] = useState(true)
  const [isStartingRoute, setIsStartingRoute] = useState(false)
  const [isFinishingRoute, setIsFinishingRoute] = useState(false)
  const [isSubmittingPin, setIsSubmittingPin] = useState(false)

  const [resequenceFailureBanner, setResequenceFailureBanner] = useState<{
    message: string
    timestamp: string
  } | null>(null)
  const [currentCourierLocation, setCurrentCourierLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)
  const [lastSuccessfulPingTimestamp, setLastSuccessfulPingTimestamp] = useState<number>(Date.now())
  const [minutesSinceLastPing, setMinutesSinceLastPing] = useState<number>(0)

  // Ref para controle de throttle/dedupe das chamadas de loadCourierOrders e loadFuelAndAccountData
  const lastLoadOrdersTimestampRef = useRef<number>(0)
  const isOrdersFetchingRef = useRef<boolean>(false)
  const lastLoadFuelTimestampRef = useRef<number>(0)
  const isFuelFetchingRef = useRef<boolean>(false)

  // Health check de permissão de GPS e segundo plano (Item K3)
  const checkBackgroundPermissionHealth = async (): Promise<boolean> => {
    if (!nativeGpsBridge.isNativeEnvironment()) {
      setHasBackgroundPermission(true)
      return true
    }
    try {
      const status = await nativeGpsBridge.getServiceStatus()
      if (!status.hasBackgroundPermission) {
        setHasBackgroundPermission(false)
        setGpsStatus('disabled')
        setGpsFailureDetail('background_permission_missing')
        return false
      }
      setHasBackgroundPermission(true)
      if (gpsFailureDetail === 'background_permission_missing') {
        setGpsStatus('active')
        setGpsFailureDetail('none')
      }
      return true
    } catch (err) {
      console.warn('Erro ao checar permissão de segundo plano:', err)
      return true
    }
  }

  // Carregar dados de conta corrente e configurações para manter paridade com o motor de combustível
  const loadFuelAndAccountData = async (options?: { force?: boolean }) => {
    if (!user?.id) return
    const now = Date.now()
    if (!options?.force && isFuelFetchingRef.current) return
    if (!options?.force && now - lastLoadFuelTimestampRef.current < 5000) return

    try {
      isFuelFetchingRef.current = true
      lastLoadFuelTimestampRef.current = now

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
    } finally {
      isFuelFetchingRef.current = false
    }
  }

  // Carrega apenas pedidos liberados pelo vendedor ("assigned" com route_released=true ou em rota)
  // Com suporte completo offline: salva no IndexedDB a cada sucesso e lê do cache local na ausência de rede
  const loadCourierOrders = async (options?: { force?: boolean }) => {
    const now = Date.now()
    if (!options?.force && isOrdersFetchingRef.current) return
    if (!options?.force && now - lastLoadOrdersTimestampRef.current < 3000) return

    if (!user?.id) {
      setOrders([])
      setIsLoading(false)
      return
    }

    try {
      isOrdersFetchingRef.current = true
      lastLoadOrdersTimestampRef.current = now

      // Se o navegador já está offline, tenta carregar direto do cache local (IndexedDB)
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        const cached = await offlineRouteStorage.getCachedRouteOrders(user.id)
        if (cached && cached.orders && cached.orders.length > 0) {
          setOrders(cached.orders)
          setIsServingFromOfflineCache(true)
          setOfflineCacheSavedAt(cached.savedAt)
          isOrdersFetchingRef.current = false
          setIsLoading(false)
          return
        }
      }

      // Regra: O cliente fica disponível após o vendedor otimizar e liberar a rota (Salvar & Liberar Rota)
      // Inclui tanto route_released=true quanto status assigned/in_transit/delivered
      const courierFilter = `courier_id = '${user.id}' && (route_released = true || status = 'assigned' || status = 'in_transit' || status = 'delivered' || status = 'address_error' || status = 'client_absent')`
      const allOrders = await deliveryService.getOrders(
        courierFilter,
        'sequence,-created',
        'customer_id,courier_id,seller_id',
      )
      setOrders(allOrders)
      setIsServingFromOfflineCache(false)

      // Salva no IndexedDB para persistência offline da rota do dia
      if (allOrders.length > 0) {
        await offlineRouteStorage.saveRouteOrders(user.id, allOrders)
        setOfflineCacheSavedAt(Date.now())
      }
    } catch (err) {
      console.warn('Falha na rede ao carregar pedidos, recorrendo ao cache offline IndexedDB:', err)
      // Fallback gracioso: ler do IndexedDB
      try {
        const cached = await offlineRouteStorage.getCachedRouteOrders(user.id)
        if (cached && cached.orders && cached.orders.length > 0) {
          setOrders(cached.orders)
          setIsServingFromOfflineCache(true)
          setOfflineCacheSavedAt(cached.savedAt)
          toast.info('Modo Offline: exibindo a rota salva no dispositivo.')
        } else {
          toast.error('Sem conexão e sem rota pré-carregada neste aparelho.')
        }
      } catch (cacheErr) {
        console.error('Erro ao ler cache offline de pedidos:', cacheErr)
      }
    } finally {
      isOrdersFetchingRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCourierOrders({ force: true })
    loadFuelAndAccountData({ force: true })
    checkBackgroundPermissionHealth()

    // Checar se é a primeira abertura do app do entregador para exibir o tutorial de boas-vindas
    if (typeof window !== 'undefined' && user?.id) {
      try {
        const tutorialSeen = localStorage.getItem(COURIER_REDIRECTION_TUTORIAL_KEY)
        if (!tutorialSeen) {
          // Delay sutil para carregar a tela primeiro
          const timer = setTimeout(() => {
            setIsTutorialModalOpen(true)
          }, 800)
          return () => clearTimeout(timer)
        }
      } catch (err) {
        console.warn('Erro ao verificar tutorial em localStorage:', err)
      }
    }
  }, [user?.id])

  // REFORÇO DE RECEPÇÃO ECONÔMICO:
  // - Pausa polling de pedidos quando app está em background (document.hidden) para economizar bateria e rede
  // - Retoma com força única ao voltar ao foco (visibilitychange / focus) ou online
  useEffect(() => {
    if (!user?.id) return

    // 1. Polling a cada 35 segundos APENAS se a janela estiver visível
    const intervalTimer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return // Economiza rede e bateria quando tela apagada / app em background
      }
      loadCourierOrders()
    }, 35000)

    // 2. Ao voltar para foco (visibilitychange / focus) — dispara apenas 1 recarga com throttle
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadCourierOrders({ force: true })
        loadFuelAndAccountData({ force: true })
        checkBackgroundPermissionHealth()
      }
    }

    // 3. Ao voltar a ficar online
    const handleNetworkOnline = () => {
      loadCourierOrders({ force: true })
      loadFuelAndAccountData({ force: true })
    }

    document.addEventListener('visibilitychange', handleVisibilityOrFocus)
    window.addEventListener('focus', handleVisibilityOrFocus)
    window.addEventListener('online', handleNetworkOnline)

    return () => {
      clearInterval(intervalTimer)
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus)
      window.removeEventListener('focus', handleVisibilityOrFocus)
      window.removeEventListener('online', handleNetworkOnline)
    }
  }, [user?.id])

  // Realtime hook para pedidos
  useRealtime<OrderRecord>('orders', (e) => {
    if (e.action === 'create' || e.action === 'update' || e.action === 'delete') {
      if (
        (e.action === 'create' || e.action === 'update') &&
        e.record.courier_id === user?.id &&
        (e.record.route_released === true ||
          e.record.status === 'in_transit' ||
          e.record.status === 'delivered')
      ) {
        // Se a rota já está iniciada e chega um pedido novo com sequence maior, notifica inclusão
        const isAlreadyInRoute = activeStartedOrders.some((o) => o.id === e.record.id)
        if (hasActiveStartedRoute && !isAlreadyInRoute && e.record.status === 'in_transit') {
          notifyCourierNewDelivery(
            '📦 Nova Parada Incluída na Rota!',
            `O pedido ${e.record.tracking_code} foi adicionado como parada #${e.record.sequence || 'nova'} na sua rota atual.`,
          )
        } else {
          notifyCourierNewDelivery(
            '📦 Nova Rota Liberada!',
            `Pedido ${e.record.tracking_code} está liberado para entrega na sua rota.`,
          )
        }
      }
      loadCourierOrders({ force: true })
      loadFuelAndAccountData()
    }
  })

  // Realtime para adiantamentos de combustível
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

  // Realtime para desvios de rota
  useRealtime<OffRouteEventRecord>('off_route_events', (e) => {
    if (e.record.courier_id === user?.id) {
      loadFuelAndAccountData()
    }
  })

  // Realtime para notificações / avisos de desvio e chegada à base
  useRealtime<NotificationRecord>('notifications', (e) => {
    if (e.action === 'create' && (!e.record.user_id || e.record.user_id === user?.id)) {
      if (e.record.type === 'off_route') {
        const dedupeKey = `notif-${e.record.id || `${e.record.type}-${e.record.order_id}-${e.record.created}`}`
        if (shouldDisplayToast(dedupeKey)) {
          triggerForcedAlert('off_route', {
            trackingCode: e.record.order_id,
          })
          sendBrowserPushNotification(e.record.title, e.record.message)
        }
      } else if (
        e.record.type === 'warning' &&
        (e.record.title?.includes('Chegada à Base') || e.record.title?.includes('chegou à base'))
      ) {
        const dedupeKey = `notif-base-${e.record.id || `${e.record.type}-${e.record.created}`}`
        if (shouldDisplayToast(dedupeKey)) {
          triggerForcedAlert('at_base_unfinalized', {
            openRouteDuration: e.record.message,
          })
          sendBrowserPushNotification(e.record.title, e.record.message)
        }
      }
    }
  })

  // Captura do nível de bateria com fallback gracioso:
  // Se navigator.getBattery não existir (iOS/Safari) ou falhar, retorna null/undefined — NUNCA 0.
  const getBatteryLevel = async (): Promise<number | null> => {
    try {
      const nav = typeof navigator !== 'undefined' ? (navigator as any) : null
      if (nav && typeof nav.getBattery === 'function') {
        const battery = await nav.getBattery()
        if (typeof battery?.level === 'number' && !isNaN(battery.level) && battery.level > 0) {
          return Math.round(battery.level * 100)
        }
      }
    } catch {
      /* ignore */
    }
    return null
  }

  // Pedidos da rota atual que já foram iniciados mas ainda NÃO foram finalizados na base
  // Regra do Usuário: "O APP DO ENTREGADOR PRECISA FINALIZAR CADA ENTREGA E NO FINAL DA BASE PONTO DE CHEGADA ELE FINALIZA ROTA INTEIRA. ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL."
  // Proteção: apenas pedidos válidos e não cancelados contam como rota iniciada ativa.
  const activeStartedOrders = orders.filter(
    (o) =>
      o.route_started === true &&
      (o.route_finished === false || o.route_finished === null || o.route_finished === undefined) &&
      o.status !== 'cancelled',
  )

  const hasActiveStartedRoute = activeStartedOrders.length > 0

  // FILA DE ROTAS:
  // Se houver uma rota em andamento (route_started=true e route_finished!=true):
  // 1. A rota visível e executável no app é EXCLUSIVAMENTE composta pelos pedidos dessa rota ativa.
  // 2. Pedidos liberados depois (route_released=true mas com route_started!=true) NÃO entram nas paradas executáveis; ficam na fila de espera.
  // Se NÃO houver rota em andamento ativa:
  // Todas as entregas atribuídas/liberadas formam a próxima rota pronta para ser aceita/iniciada.
  const { currentRouteOrders, queuedOrders, activeDeliveries } = useMemo(() => {
    if (hasActiveStartedRoute) {
      // Pedidos da rota ativa em andamento
      const current = activeStartedOrders
      // Pedidos liberados pelo vendedor que aguardam a conclusão da rota atual
      const queued = orders.filter(
        (o) =>
          o.route_released === true &&
          !o.route_started &&
          o.status !== 'delivered' &&
          o.status !== 'cancelled',
      )
      // As entregas executáveis no app são apenas as da rota ativa que ainda não foram finalizadas.
      // Elimina fallback silencioso ?? 9999: usa ordem canônica por sequence válida,
      // desempate determinístico por created e ID.
      const executables = [...current]
        .filter((o) => o.status === 'in_transit' || o.status === 'assigned')
        .sort((a, b) => {
          const hasSeqA = a.sequence !== null && a.sequence !== undefined && a.sequence > 0
          const hasSeqB = b.sequence !== null && b.sequence !== undefined && b.sequence > 0
          if (hasSeqA && hasSeqB && a.sequence !== b.sequence) {
            return (a.sequence as number) - (b.sequence as number)
          }
          if (hasSeqA && !hasSeqB) return -1
          if (!hasSeqA && hasSeqB) return 1
          const timeA = new Date(a.route_released_at || a.created || 0).getTime()
          const timeB = new Date(b.route_released_at || b.created || 0).getTime()
          if (timeA !== timeB) return timeA - timeB
          return a.id.localeCompare(b.id)
        })

      return {
        currentRouteOrders: current,
        queuedOrders: queued,
        activeDeliveries: executables,
      }
    }

    // Não há rota ativa iniciada: pedidos liberados pelo vendedor prontos para aceite
    // Regra: Qualquer pedido liberado e não iniciado (ou assigned) fica IMEDIATAMENTE disponível
    // para o entregador aceitar a rota. Se existirem lotes diferentes, a rota mais recente liberada
    // ou todos os pedidos liberados ficam visíveis para início imediato, sem ficar oculto.
    const unstartedReleased = orders.filter(
      (o) =>
        (o.route_released === true || o.status === 'assigned') &&
        !o.route_started &&
        o.status !== 'delivered' &&
        o.status !== 'cancelled',
    )

    if (unstartedReleased.length === 0) {
      return {
        currentRouteOrders: [],
        queuedOrders: [],
        activeDeliveries: [],
      }
    }

    // Ordenar por sequência e liberação/criação SEM fallback arbitrário 9999
    // Todas as entregas liberadas não iniciadas compõem a rota pronta para ser aceita
    const currentSorted = [...unstartedReleased].sort((a, b) => {
      const hasSeqA = a.sequence !== null && a.sequence !== undefined && a.sequence > 0
      const hasSeqB = b.sequence !== null && b.sequence !== undefined && b.sequence > 0
      if (hasSeqA && hasSeqB && a.sequence !== b.sequence) {
        return (a.sequence as number) - (b.sequence as number)
      }
      if (hasSeqA && !hasSeqB) return -1
      if (!hasSeqA && hasSeqB) return 1
      const timeA = new Date(a.route_released_at || a.created || 0).getTime()
      const timeB = new Date(b.route_released_at || b.created || 0).getTime()
      if (timeA !== timeB) return timeA - timeB
      return a.id.localeCompare(b.id)
    })

    return {
      currentRouteOrders: currentSorted,
      queuedOrders: [],
      activeDeliveries: currentSorted,
    }
  }, [hasActiveStartedRoute, activeStartedOrders, orders])

  // Estado da rota: já foi aceita / iniciada pelo entregador?
  const isRouteStarted = hasActiveStartedRoute

  // Refs de controle para DEDUPE e LOCK contra concorrência no envio de GPS:
  // - Intervalo mínimo RÍGIDO de 30s entre envios reais (throttle estrito contra rajadas).
  // - Deduplicação: não enviar novo se mudou < 10m OU accuracy continua >= 500m (sem fix).
  // - Retry com backoff exponencial (10s, 30s, 60s), máx 3 tentativas, nunca loop infinito.
  const lastRecordedGpsRef = useRef<{
    lat: number
    lng: number
    accuracy?: number
    timestamp: number
  } | null>(null)
  const isSendingLocationRef = useRef<boolean>(false)
  const isFlushingBufferRef = useRef(false)
  const isFetchingPositionRef = useRef<boolean>(false)
  const retryCountRef = useRef<number>(0)
  const retryTimeoutRef = useRef<any>(null)
  const triggerImmediateGpsRef = useRef<(() => void) | null>(null)
  const wakeLockSentinelRef = useRef<any>(null)

  // Geofence de chegada à base: confirmação por 2 leituras consecutivas <= 120m
  const baseGeofenceHitCountRef = useRef<number>(0)
  const isAutoFinishingRouteRef = useRef<boolean>(false)

  // Escuta evento global de falha de resequenciamento para exibir banner na rota do entregador
  useEffect(() => {
    const handleResequenceFailure = (evt: any) => {
      const detail = evt?.detail
      if (!detail) return
      // Se a falha afeta este entregador ou é global
      if (!detail.courierId || detail.courierId === user?.id) {
        setResequenceFailureBanner({
          message:
            'Aviso de Rota: a sincronização do menor trajeto viário encontrou oscilação de rede. A ordem segura foi preservada e novas tentativas serão feitas automaticamente.',
          timestamp: detail.timestamp || new Date().toISOString(),
        })
      }
    }
    window.addEventListener('rotaly_resequence_failed', handleResequenceFailure)
    return () => {
      window.removeEventListener('rotaly_resequence_failed', handleResequenceFailure)
    }
  }, [user?.id])

  // Assinatura reativa da contagem do buffer offline e listeners de conectividade online/offline
  useEffect(() => {
    const courierId = user?.id || ''
    // Inscrever na contagem de pontos do buffer
    const unsubscribeBuffer = offlineTelemetryBuffer.subscribe(courierId, (count) => {
      setPendingBufferedPoints(count)
    })

    const handleOnline = async () => {
      setIsOnline(true)
      // Ao voltar online, disparar flush idempotente do buffer E sincronização de ações de redirecionamento
      if (user?.id) {
        setIsFlushingBuffer(true)
        isFlushingBufferRef.current = true
        try {
          const res = await offlineTelemetryBuffer.flush(user.id)
          if (res.sent > 0) {
            toast.success(`📶 Conexão restabelecida! ${res.sent} pontos sincronizados com a Torre.`)
          }
        } catch (e) {
          console.warn('Falha ao flush do buffer offline:', e)
        } finally {
          setIsFlushingBuffer(false)
          isFlushingBufferRef.current = false
        }

        // Sincronizar ações de redirecionamento pendentes no IndexedDB
        try {
          const pendingRedirs = await offlineRouteStorage.getPendingRedirectionActions(user.id)
          if (pendingRedirs.length > 0) {
            const syncedIds: string[] = []
            for (const act of pendingRedirs) {
              try {
                if (act.action === 'initiate' && act.pointA) {
                  await deliveryService.initiateDeliveryRedirection({
                    orderId: act.orderId,
                    courierId: act.courierId,
                    pointALat: act.pointA.lat,
                    pointALng: act.pointA.lng,
                    pointAAt: act.pointA.at,
                    newAddressText: act.newAddress,
                  })
                  syncedIds.push(act.id)
                } else if (act.action === 'confirm' && act.pointB) {
                  const targetOrder = orders.find((o) => o.id === act.orderId)
                  if (targetOrder) {
                    await deliveryService.confirmDeliveryRedirection({
                      order: targetOrder,
                      courierId: act.courierId,
                      pointBLat: act.pointB.lat,
                      pointBLng: act.pointB.lng,
                      pointBAt: act.pointB.at,
                      newAddressText: act.newAddress || '',
                      updateCustomerAddressOfficial: act.updateCustomerAddress ?? true,
                      receiverName: act.receiverName,
                      notes: act.notes,
                    })
                    syncedIds.push(act.id)
                  }
                }
              } catch (actErr) {
                console.warn('[CourierApp] Falha ao sincronizar ação offline:', act.id, actErr)
              }
            }
            if (syncedIds.length > 0) {
              await offlineRouteStorage.removeRedirectionActions(user.id, syncedIds)
              loadCourierOrders()
              toast.success(`Redirecionamento offline sincronizado com sucesso!`)
            }
          }
        } catch (syncErr) {
          console.warn('[CourierApp] Erro na sincronização de redirecionamento offline:', syncErr)
        }

        // Ping imediato de posição fresca (maximumAge: 0)
        if (triggerImmediateGpsRef.current) {
          triggerImmediateGpsRef.current()
        }
      }
    }

    const handleOffline = () => {
      setIsOnline(false)
      toast.warning('📴 Sem sinal de internet. Os pontos de GPS serão salvos no buffer offline.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    // Se já estiver online e tiver pontos pendentes, tenta flush na montagem
    if (navigator.onLine && user?.id && offlineTelemetryBuffer.size(user.id) > 0) {
      handleOnline()
    }

    return () => {
      unsubscribeBuffer()
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [user?.id])

  // Gerenciamento de Wake Lock para manter a tela ativa durante a rota ativa
  // PATCH 5: Wake lock contínuo — re-adquire no visibilitychange quando visível, libera ao encerrar/cancelar rota
  useEffect(() => {
    let released = false

    const requestWakeLock = async () => {
      if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
        setWakeLockSupported(false)
        return
      }
      // Solicitar apenas se estiver em rota ativa
      if (!hasActiveStartedRoute) {
        if (wakeLockSentinelRef.current) {
          try {
            await wakeLockSentinelRef.current.release()
          } catch {
            /* ignore */
          }
          wakeLockSentinelRef.current = null
          setIsWakeLockActive(false)
        }
        return
      }

      try {
        if (!wakeLockSentinelRef.current || wakeLockSentinelRef.current.released) {
          const sentinel = await (navigator as any).wakeLock.request('screen')
          if (released) {
            sentinel.release().catch(() => {})
            return
          }
          wakeLockSentinelRef.current = sentinel
          setIsWakeLockActive(true)
          sentinel.addEventListener('release', () => {
            if (wakeLockSentinelRef.current === sentinel) {
              wakeLockSentinelRef.current = null
              setIsWakeLockActive(false)
            }
          })
        }
      } catch (err) {
        console.warn('Wake Lock request falhou ou não permitido no navegador:', err)
        setWakeLockSupported(false)
        setIsWakeLockActive(false)
      }
    }

    requestWakeLock()

    const handleVisibilityChangeForWakeLock = () => {
      if (document.visibilityState === 'visible' && hasActiveStartedRoute) {
        requestWakeLock()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChangeForWakeLock)

    return () => {
      released = true
      document.removeEventListener('visibilitychange', handleVisibilityChangeForWakeLock)
      if (wakeLockSentinelRef.current) {
        wakeLockSentinelRef.current.release().catch(() => {})
        wakeLockSentinelRef.current = null
        setIsWakeLockActive(false)
      }
    }
  }, [hasActiveStartedRoute])

  // Telemetria GPS contínua via watchPosition enquanto houver rota ativa
  // Com fallback automático, flush em online/visibilitychange e ping imediato fresco (maximumAge: 0)
  useEffect(() => {
    if (!user || !isGpsActive) return

    let isEffectActive = true
    let watchId: number | null = null
    let fallbackPollTimer: any = null

    const clearFallbackTimer = () => {
      if (fallbackPollTimer) {
        clearTimeout(fallbackPollTimer)
        fallbackPollTimer = null
      }
    }

    const processAndSendGps = async (
      lat: number,
      lng: number,
      speedVal?: number | null,
      accuracyVal?: number,
      forceSend = false,
    ) => {
      setCurrentCourierLocation({ lat, lng })
      // Se conseguiu ler o GPS com sucesso, restaura imediatamente para ativo
      setGpsStatus('active')
      setGpsFailureDetail('none')

      // Se outra gravação já estiver em voo, não enviar simultaneamente
      if (isSendingLocationRef.current) return

      const now = Date.now()
      const last = lastRecordedGpsRef.current

      // ITEM K2: GATILHO DE DISTÂNCIA / TEMPO ADAPTATIVO
      // Disparar ping no MENOR entre 30 segundos de intervalo MÁXIMO OU 15–20 metros de deslocamento.
      // O intervalo de 30 segundos é MÁXIMO, nunca cadência fixa exclusiva.
      // Perto da parada (<300m), o tempo máximo reduz para 10s ou 10m de deslocamento.
      let distToTargetStopMeters = 9999
      if (
        currentActiveDelivery &&
        currentActiveDelivery.end_address_lat &&
        currentActiveDelivery.end_address_lng
      ) {
        distToTargetStopMeters = haversineDistanceMeters(
          lat,
          lng,
          currentActiveDelivery.end_address_lat,
          currentActiveDelivery.end_address_lng,
        )
      } else if (isReturningToBase && baseCoordinates.lat && baseCoordinates.lng) {
        distToTargetStopMeters = haversineDistanceMeters(
          lat,
          lng,
          baseCoordinates.lat,
          baseCoordinates.lng,
        )
      }

      const isNearStop = distToTargetStopMeters < 300
      const maxTimeIntervalSeconds = isNearStop ? 10 : 30
      const distanceThresholdMeters = isNearStop ? 10 : 18

      if (last && !forceSend) {
        const timeDiffSeconds = (now - last.timestamp) / 1000
        const distanceDiffMeters = haversineDistanceMeters(last.lat, last.lng, lat, lng)
        const isWeakFix = (accuracyVal ?? 2000) >= 500 || (last.accuracy ?? 2000) >= 500

        // Dispara se atingiu o deslocamento de 15-20m (distanceThresholdMeters) OU se atingiu o tempo máximo (30s)
        const triggeredByDistance =
          distanceDiffMeters >= distanceThresholdMeters && timeDiffSeconds >= 3
        const triggeredByMaxTime = timeDiffSeconds >= maxTimeIntervalSeconds

        if (!triggeredByDistance && !triggeredByMaxTime) {
          return
        }

        // Se mudou menos de 5m e acurácia continua fraca/sem-fix, rejeita novo envio imediato antes de 45s
        if (distanceDiffMeters < 5 && isWeakFix && timeDiffSeconds < 45) {
          return
        }
      }

      isSendingLocationRef.current = true
      let batteryLevel: number | null = null
      let speed = 0
      try {
        batteryLevel = await getBatteryLevel()

        // Cálculo de velocidade com proteção contra velocidade residual antiga:
        // Quando a velocidade real < 2 km/h ou delta de distância < 2m, FORÇAR speed = 0.
        const deltaDist = last ? haversineDistanceMeters(last.lat, last.lng, lat, lng) : 0
        const deltaSeconds = last ? (now - last.timestamp) / 1000 : 0
        const calculatedSpeedKmh =
          deltaSeconds > 0 && deltaSeconds < 120 ? (deltaDist / deltaSeconds) * 3.6 : 0

        if (deltaDist < 2 || calculatedSpeedKmh < 2) {
          speed = 0
        } else if (typeof speedVal === 'number' && !isNaN(speedVal) && speedVal > 0) {
          const rawSpeedKmh = Math.round(speedVal * 3.6)
          speed = rawSpeedKmh < 2 ? 0 : rawSpeedKmh
        } else {
          speed = Math.round(calculatedSpeedKmh)
        }

        const isWeak = (accuracyVal ?? 2000) >= 500
        const gpsReason = isWeak ? 'sem-fix' : ''
        const sanitizedHeading = typeof (last ? 0 : 0) === 'number' ? 0 : 0 // heading real ou 0
        // Sanitizar payload antes do envio
        const sanitizedPayload = deliveryService.sanitizeLocationPayload({
          userId: user.id,
          lat,
          lng,
          speed,
          heading: sanitizedHeading,
          batteryLevel: batteryLevel ?? undefined,
          accuracy: accuracyVal,
          gpsStatus: 'active',
          gpsReason,
          offlineBuffered: false,
        })

        // Tentar envio normal online
        await deliveryService.updateCourierLocation(
          sanitizedPayload.user_id!,
          sanitizedPayload.lat!,
          sanitizedPayload.lng!,
          sanitizedPayload.speed,
          sanitizedPayload.heading,
          sanitizedPayload.battery_level,
          {
            gps_status: sanitizedPayload.gps_status,
            gps_reason: sanitizedPayload.gps_reason,
            offline_buffered: false,
            accuracy: sanitizedPayload.accuracy,
          },
        )

        // Registrar timestamp do último ping online transmitido com sucesso
        offlineTelemetryBuffer.recordSuccessfulOnlinePing(user.id, now)
        setLastSuccessfulPingTimestamp(now)
        setMinutesSinceLastPing(0)

        // Sucesso: atualiza referência e reseta contador de retry
        lastRecordedGpsRef.current = { lat, lng, accuracy: accuracyVal, timestamp: now }
        retryCountRef.current = 0
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
          retryTimeoutRef.current = null
        }

        // Se houver pontos no buffer que aguardavam sinal, tenta flush agora que a rede respondeu (protegido pela trava isSendingLocationRef)
        if (
          offlineTelemetryBuffer.size(user.id) > 0 &&
          !isFlushingBufferRef.current &&
          !isSendingLocationRef.current
        ) {
          offlineTelemetryBuffer.flush(user.id).catch(() => {})
        }
      } catch (e: any) {
        // Log de falha padronizado
        console.warn('[TELEMETRIA POCKETBASE 400/FAIL]', {
          status: e?.status,
          message: e?.message,
          fieldErrors: e?.data?.data || e?.data,
          payload: {
            userId: user.id,
            lat,
            lng,
            speed,
            heading: 0,
            accuracy: accuracyVal,
            batteryLevel: batteryLevel ?? undefined,
          },
        })

        // REQUISITO: Aceitar 400 descartando o payload rejeitado (evita loop infinito de rejeição do backend)
        // Apenas falhas de rede / sinal fraco entram no buffer offline para retry controlado (1/min)
        if (hasActiveStartedRoute && e?.status !== 400) {
          const reasonCode = (accuracyVal ?? 2000) >= 500 ? 'sem-fix' : 'network_offline'
          offlineTelemetryBuffer.enqueuePoint({
            userId: user.id,
            lat,
            lng,
            speed,
            heading: 0,
            accuracy: accuracyVal,
            batteryLevel: batteryLevel ?? undefined,
            timestamp: now,
            reason: reasonCode,
          })
        }

        if (e?.status === 400) {
          retryCountRef.current = 0
          if (retryTimeoutRef.current) {
            clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = null
          }
        } else {
          // RETRY COM BACKOFF EXPONENCIAL (10s, 30s, 60s) — NO MÁXIMO 3 TENTATIVAS PARA REDE/5xx
          if (retryCountRef.current < 3 && isEffectActive) {
            retryCountRef.current += 1
            const backoffDelays = [10000, 30000, 60000] // 10s, 30s, 60s
            const delayMs = backoffDelays[retryCountRef.current - 1] || 60000

            if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current)
            retryTimeoutRef.current = setTimeout(() => {
              if (isEffectActive) {
                processAndSendGps(lat, lng, speedVal, accuracyVal, true)
              }
            }, delayMs)
          } else {
            // Atingiu o teto de 3 tentativas: encerra o ciclo de retries para nunca entrar em loop de rajada
            retryCountRef.current = 0
          }
        }
      } finally {
        isSendingLocationRef.current = false
      }
    }

    // Leitura fresca imediata de posição (maximumAge: 0)
    const requestFreshImmediatePosition = () => {
      if (!isEffectActive || typeof navigator === 'undefined' || !navigator.geolocation) return
      if (isFetchingPositionRef.current) return
      isFetchingPositionRef.current = true

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          isFetchingPositionRef.current = false
          if (!isEffectActive) return
          processAndSendGps(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.speed,
            pos.coords.accuracy,
            true, // forceSend imediato
          )
        },
        (err) => {
          isFetchingPositionRef.current = false
          console.warn('Fresh immediate position falhou:', err?.code, err?.message)
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
      )
    }

    // Iniciar Foreground Service nativo Android caso estejamos no APK nativo
    if (hasActiveStartedRoute && nativeGpsBridge.isNativeEnvironment()) {
      nativeGpsBridge
        .startTracking({
          userId: user.id,
          notificationTitle: 'Rotaly Courier',
          notificationText: 'Rotaly Courier está monitorando sua rota de entregas',
          minIntervalMs: 30000,
          minDistanceMeters: 18,
        })
        .catch((e) => console.warn('Erro ao iniciar native foreground GPS:', e))
    }

    // Escutar coordenadas da ponte nativa Android
    const unsubscribeNativeGps = nativeGpsBridge.onLocation((coord) => {
      if (!isEffectActive) return
      processAndSendGps(coord.latitude, coord.longitude, coord.speed, coord.accuracy, false)
    })

    // Iniciar watchPosition contínuo (fallback web ou padrão enquanto app aberto)
    if (typeof navigator !== 'undefined' && navigator.geolocation) {
      try {
        watchId = navigator.geolocation.watchPosition(
          (pos) => {
            if (!isEffectActive) return
            processAndSendGps(
              pos.coords.latitude,
              pos.coords.longitude,
              pos.coords.speed,
              pos.coords.accuracy,
              false,
            )
          },
          async (err) => {
            if (!isEffectActive) return
            console.warn('watchPosition erro de telemetria:', err?.code, err?.message)

            if (err.code === err.PERMISSION_DENIED) {
              setGpsStatus('disabled')
              setGpsFailureDetail('permission_denied')
            } else if (err.code === err.TIMEOUT) {
              setGpsStatus('offline')
              setGpsFailureDetail('weak_signal')
            } else if (err.code === err.POSITION_UNAVAILABLE) {
              setGpsStatus('offline')
              setGpsFailureDetail('position_unavailable')
            } else {
              setGpsStatus('offline')
              setGpsFailureDetail('weak_signal')
            }

            // Agendar retry de fallback se o watchPosition pausar silenciosamente
            clearFallbackTimer()
            fallbackPollTimer = setTimeout(() => {
              if (isEffectActive) requestFreshImmediatePosition()
            }, 12000)
          },
          {
            enableHighAccuracy: true,
            maximumAge: 5000,
            timeout: 20000,
          },
        )
      } catch (errWatch) {
        console.warn('Erro ao registrar watchPosition:', errWatch)
      }
    } else {
      setGpsStatus('disabled')
      setGpsFailureDetail('unsupported')
    }

    // Expor função de disparo imediato para listeners externos (botão retry, reconexão etc)
    triggerImmediateGpsRef.current = () => {
      requestFreshImmediatePosition()
    }

    // Disparo inicial com maximumAge 0 para garantir que a Torre receba a coordenada fresca imediatamente
    requestFreshImmediatePosition()

    // REAVALIAÇÃO QUANDO A TELA VOLTA / VISIBILITYCHANGE (item 1: flush de buffer E ping fresco com maximumAge: 0)
    const handleResume = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      // Re-adquirir Wake Lock se rota estiver ativa
      if (hasActiveStartedRoute && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        try {
          const sentinel = await (navigator as any).wakeLock?.request('screen')
          wakeLockSentinelRef.current = sentinel
          setIsWakeLockActive(true)
        } catch {
          /* ignore */
        }
      }

      // 1. Flush imediato do buffer offline (protegido contra disparos paralelos)
      if (
        user?.id &&
        offlineTelemetryBuffer.size(user.id) > 0 &&
        !isSendingLocationRef.current &&
        !isFlushingBufferRef.current
      ) {
        setIsFlushingBuffer(true)
        isFlushingBufferRef.current = true
        offlineTelemetryBuffer
          .flush(user.id)
          .catch(() => {})
          .finally(() => {
            setIsFlushingBuffer(false)
            isFlushingBufferRef.current = false
          })
      }

      // 2. Ping fresco imediato com maximumAge: 0
      requestFreshImmediatePosition()
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        handleResume()
      }
    }

    const handleWindowFocus = () => {
      handleResume()
    }

    const handlePageShow = (e: PageTransitionEvent) => {
      // Quando a página é restaurada pelo bfcache do Safari iOS
      if (e.persisted || document.visibilityState === 'visible') {
        handleResume()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      isEffectActive = false
      unsubscribeNativeGps()
      if (watchId !== null && typeof navigator !== 'undefined' && navigator.geolocation) {
        navigator.geolocation.clearWatch(watchId)
        watchId = null
      }
      clearFallbackTimer()
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current)
        retryTimeoutRef.current = null
      }
      triggerImmediateGpsRef.current = null
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [user, isGpsActive, hasActiveStartedRoute])

  // Monitoramento periódico e flush a cada ciclo de 30s do buffer offline
  useEffect(() => {
    if (!user?.id) return

    const cycleInterval = setInterval(() => {
      if (
        navigator.onLine &&
        offlineTelemetryBuffer.size(user.id) > 0 &&
        !isFlushingBufferRef.current &&
        !isSendingLocationRef.current
      ) {
        setIsFlushingBuffer(true)
        isFlushingBufferRef.current = true
        offlineTelemetryBuffer
          .flush(user.id)
          .catch(() => {})
          .finally(() => {
            setIsFlushingBuffer(false)
            isFlushingBufferRef.current = false
          })
      }
    }, 30000)

    return () => clearInterval(cycleInterval)
  }, [user?.id])

  // Monitoramento periódico de "pings presos" em rota ativa (a cada 20 segundos)
  useEffect(() => {
    if (!hasActiveStartedRoute) {
      setMinutesSinceLastPing(0)
      return
    }

    const checkStalledPings = () => {
      const now = Date.now()
      const diffMs = now - lastSuccessfulPingTimestamp
      const diffMins = Math.floor(diffMs / 60000)
      setMinutesSinceLastPing(diffMins)
    }

    checkStalledPings()
    const timer = setInterval(checkStalledPings, 20000)
    return () => clearInterval(timer)
  }, [hasActiveStartedRoute, lastSuccessfulPingTimestamp])

  // Se todas as entregas individuais da rota ativa já foram concluídas (ou não há mais activeDeliveries pendentes)
  // mas a rota ainda não foi finalizada na base, o entregador está na etapa de RETORNO À BASE!
  const isReturningToBase =
    isRouteStarted &&
    activeDeliveries.length === 0 &&
    currentRouteOrders.length > 0 &&
    currentRouteOrders.every(
      (o) =>
        o.status === 'delivered' ||
        o.status === 'address_error' ||
        o.status === 'client_absent' ||
        o.status === 'cancelled',
    )

  // Identificar coordenadas da base para guiar o retorno (end_address_lat/lng ou start_base_lat/lng)
  const baseCoordinates = useMemo(() => {
    const anchor = currentRouteOrders[0] || orders[0]
    const effectiveLat = anchor?.end_address_lat || anchor?.start_base_lat || -22.6977499
    const effectiveLng = anchor?.end_address_lng || anchor?.start_base_lng || -43.2936013
    return {
      name: anchor?.start_base_name || 'Base Operacional',
      address: anchor?.start_base_address || 'Base de Distribuição',
      lat: effectiveLat,
      lng: effectiveLng,
    }
  }, [currentRouteOrders, orders])

  // Distância do entregador até a base no momento (em metros)
  const distanceToBaseMeters = useMemo(() => {
    if (!currentCourierLocation || !baseCoordinates.lat || !baseCoordinates.lng) return null
    const dMeters = haversineDistanceMeters(
      currentCourierLocation.lat,
      currentCourierLocation.lng,
      baseCoordinates.lat,
      baseCoordinates.lng,
    )
    return Math.round(dMeters)
  }, [currentCourierLocation, baseCoordinates])

  // O primeiro cliente não finalizado da sequência é o único ativo
  const currentActiveDelivery = activeDeliveries.length > 0 ? activeDeliveries[0] : null
  const subsequentDeliveries = activeDeliveries.slice(1)

  // Ação: Início imediato de Rota (SEM odômetro nem foto - ITEM 3: telemetria pura)
  const handleConfirmStartRoute = async () => {
    if (!user?.id) {
      toast.error('Entregador não autenticado.')
      return
    }

    if (activeDeliveries.length === 0) {
      toast.info('Não há clientes na rota liberada.')
      return
    }

    // ITEM K3: HEALTH CHECK DE PERMISSÃO OBRIGATÓRIO ANTES DE INICIAR ROTA
    // Se a permissão ACCESS_BACKGROUND_LOCATION não estiver concedida no Android nativo, BLOQUEAR
    const isPermitted = await checkBackgroundPermissionHealth()
    if (!isPermitted) {
      setIsBackgroundPermissionModalOpen(true)
      toast.error('Permissão de segundo plano necessária para iniciar a rota.', {
        description:
          'Selecione "Permitir o tempo todo" para que seu trajeto não seja interrompido.',
        duration: 6000,
      })
      return
    }

    setIsStartingRoute(true)
    try {
      const orderIdsToStart = activeDeliveries.map((o) => o.id)
      await deliveryService.startCourierRoute(user.id, orderIdsToStart)
      setIsStartRouteModalOpen(false)
      toast.success('🚀 Rota iniciada! Telemetria ativa e rastreamento oficial em tempo real.', {
        duration: 4000,
      })

      // PATCH 5: Exibir modal de instruções de bateria ao iniciar rota
      // Se já reconhecido anteriormente no aparelho, exibe um lembrete curto via toast;
      // se não reconhecido ainda ou no primeiro uso do dia, abre o modal completo
      try {
        const lastAck = localStorage.getItem(BATTERY_OPTIMIZATION_ACK_KEY)
        if (!lastAck) {
          setIsBatteryGuideOpen(true)
        } else {
          toast.info(
            '🔋 Dica de Bateria: Mantenha a otimização de bateria desativada para GPS contínuo.',
            {
              duration: 4000,
            },
          )
        }
      } catch {
        setIsBatteryGuideOpen(true)
      }

      await loadCourierOrders()
    } catch (err) {
      console.error('Erro ao iniciar rota:', err)
      toast.error('Falha ao iniciar rota. Tente novamente.')
    } finally {
      setIsStartingRoute(false)
    }
  }

  // Ação: Iniciar rota diretamente ao aceitar
  const handleOpenStartRouteModal = () => {
    handleConfirmStartRoute()
  }

  // Navegação externa (Google Maps / Waze) com escolha do entregador
  const openExternalNavigation = (
    address: string,
    lat?: number | string | null,
    lng?: number | string | null,
    label = 'Destino',
  ) => {
    const parsedLat =
      lat !== undefined && lat !== null && lat !== '' && !isNaN(Number(lat))
        ? Number(lat)
        : undefined
    const parsedLng =
      lng !== undefined && lng !== null && lng !== '' && !isNaN(Number(lng))
        ? Number(lng)
        : undefined

    setNavigationTarget({
      name: label,
      address,
      lat: parsedLat,
      lng: parsedLng,
    })
    setIsNavigationChoiceOpen(true)
  }

  const openWazeNavigation = (
    lat?: number | string | null,
    lng?: number | string | null,
    address?: string,
    label?: string,
  ) => {
    nativeGpsBridge.openNavigation({
      lat,
      lng,
      address,
      label,
      app: 'waze',
    })
  }

  // Ação: "Marcar endereço correto no local (GPS)"
  // NOVA REGRA pin_entregador:
  // (1) Ao marcar o endereço, o entregador SEMPRE corrige o pin do cliente, independente de distância.
  // (2) Se o desvio for de ATÉ 500m (<= 500m): aplicar a correção AUTOMATICAMENTE no cadastro — pin novo +
  //     endereço completo via reverseGeocodeCoordinates (preservando número se o reverso não retornar),
  //     sem criar card e sem aprovação; toast de confirmação ("Endereço do cliente atualizado"); registrar
  //     na audit_trail com autor = entregador, motivo "correção automática de pin pelo entregador", antes/depois.
  // (3) Se o desvio for ACIMA de 500m (> 500m): manter fluxo com card pendente em address_alerts para aprovação,
  //     com endereço completo do GPS no card e aviso de precisão.
  // (4) Remoção da tranca anti-falso-positivo antiga (bloqueio <50m).
  // (5) Recálculo de km e combustível segue automático pelo hook customers_recalc_orders_km.
  // (6) NÃO alterar saldos.
  const handleMarkCorrectAddress = async (order: OrderRecord) => {
    const customer = order.expand?.customer_id
    if (!customer?.id) {
      toast.error('Dados do cliente não disponíveis para marcação de endereço.')
      return
    }

    if (!user?.id) {
      toast.error('Entregador não autenticado.')
      return
    }

    if (isSubmittingPin) return

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      toast.error('GPS não suportado neste navegador/aparelho.')
      return
    }

    setIsSubmittingPin(true)
    const toastId = toast.loading('Capturando coordenada precisa do GPS no local...')

    try {
      // 1. Captura do GPS via navigator.geolocation.getCurrentPosition
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 15000,
          maximumAge: 0,
        })
      })

      const courierLat = position.coords.latitude
      const courierLng = position.coords.longitude
      const accuracy = Math.round(position.coords.accuracy || 0)

      // 2. Calcular distance_meters entre o pin cadastrado do cliente e o GPS capturado
      let distanceMeters: number | undefined
      const hasCustomerCoords =
        customer.lat !== undefined &&
        customer.lat !== null &&
        customer.lng !== undefined &&
        customer.lng !== null &&
        !isNaN(Number(customer.lat)) &&
        !isNaN(Number(customer.lng)) &&
        (Number(customer.lat) !== 0 || Number(customer.lng) !== 0)

      if (hasCustomerCoords) {
        distanceMeters = Math.round(
          haversineDistanceMeters(
            Number(customer.lat),
            Number(customer.lng),
            courierLat,
            courierLng,
          ),
        )
      }

      // 3. Executar reverseGeocodeCoordinates sobre a coordenada marcada pelo entregador
      // Obtém o endereço completo real do ponto GPS (street, number, neighborhood, city, state, postalCode)
      let geocodedAddress: any = null
      try {
        geocodedAddress = await reverseGeocodeCoordinates(courierLat, courierLng, {
          timeoutMs: 7000,
          toleranceMeters: 25,
        })
      } catch (geoErr) {
        console.warn('[CourierApp] Falha na geocodificação reversa do ponto GPS:', geoErr)
      }

      // Extrair número atual do cadastro do cliente caso o reverso não traga número (fallback)
      const currentNumberMatch = (customer.address || '').match(
        /(?:,\s*|\s+nº\s*|\s+n°\s*|\s+num\s*|\s+N\s*)(\d+[\w\s\-/]*?)(?=\s*[,-]|\s*$)/i,
      )
      const fallbackNumber =
        (currentNumberMatch && currentNumberMatch[1]?.trim()) || (customer as any).number || ''

      const resolvedStreet =
        geocodedAddress?.street ||
        geocodedAddress?.streetAndNumber?.split(',')[0]?.trim() ||
        customer.street ||
        ''
      const resolvedNumber = geocodedAddress?.number || fallbackNumber
      const resolvedNeighborhood = geocodedAddress?.neighborhood || customer.neighborhood || ''
      const resolvedCity = geocodedAddress?.city || customer.city || ''
      const resolvedState = geocodedAddress?.state || customer.state || ''
      const resolvedPostalCode = geocodedAddress?.postalCode || customer.postal_code || ''

      // Montar string de endereço formatado completo para suggested_address.address
      let resolvedAddressString = ''
      if (resolvedStreet) {
        resolvedAddressString = resolvedStreet
        if (resolvedNumber) resolvedAddressString += `, ${resolvedNumber}`
        if (resolvedNeighborhood) resolvedAddressString += ` - ${resolvedNeighborhood}`
        if (resolvedCity) {
          resolvedAddressString += `, ${resolvedCity}`
          if (resolvedState) resolvedAddressString += ` - ${resolvedState}`
        }
        if (resolvedPostalCode) resolvedAddressString += `, ${resolvedPostalCode}`
      } else if (geocodedAddress?.formattedAddress) {
        resolvedAddressString = geocodedAddress.formattedAddress
      } else {
        resolvedAddressString = customer.address || ''
      }

      const suggestedAddressPayload = {
        address: resolvedAddressString,
        street: resolvedStreet,
        number: resolvedNumber,
        neighborhood: resolvedNeighborhood,
        city: resolvedCity,
        state: resolvedState,
        postal_code: resolvedPostalCode,
        lat: courierLat,
        lng: courierLng,
        accuracy_meters: accuracy,
        source: geocodedAddress?.source || 'gps_reverse',
      }

      // DECISÃO PELA NOVA REGRA:
      // Se distanceMeters for indefinido (cliente sem coordenadas) ou <= 500m:
      // Correção AUTOMÁTICA no cadastro (sem criar card e sem aprovação).
      // Se distanceMeters > 500m:
      // Cria card pendente em address_alerts para aprovação do vendedor/admin.
      const isAutoCorrection = distanceMeters === undefined || distanceMeters <= 500

      if (isAutoCorrection) {
        // Fluxo (2): Correção automática no cadastro
        await deliveryService.applyAddressCorrectionAutomatic({
          customerId: customer.id,
          currentCustomer: customer,
          courierUser: {
            id: user.id,
            name: user.name,
            email: user.email,
          },
          suggestedAddress: suggestedAddressPayload,
          distanceMeters,
        })

        toast.dismiss(toastId)
        toast.success('Endereço do cliente atualizado', {
          description: `Pin e endereço corrigidos automaticamente no cadastro (desvio: ${distanceMeters !== undefined ? `${distanceMeters}m` : 'novo pin'}, precisão: ~${accuracy}m).`,
          duration: 5000,
        })

        // Recarregar pedidos para refletir coordenadas e endereço atualizados
        await loadCourierOrders({ force: true })
      } else {
        // Fluxo (3): Desvio > 500m — Card pendente em address_alerts para aprovação
        // Checagem prévia de duplicidade de card pendente
        const existingAlert = await deliveryService.getPendingAlertForCustomer(customer.id)
        if (existingAlert) {
          toast.dismiss(toastId)
          toast.info('Este cliente já possui uma marcação pendente de revisão na central.', {
            description: 'Aguarde o vendedor ou administrador avaliar o endereço.',
            duration: 5000,
          })
          setIsSubmittingPin(false)
          return
        }

        const currentAddressJson = {
          address: customer.address || '',
          street: customer.street || '',
          neighborhood: customer.neighborhood || '',
          city: customer.city || '',
          state: customer.state || '',
          postal_code: customer.postal_code || '',
          lat: customer.lat ?? null,
          lng: customer.lng ?? null,
        }

        const companyId = order.empresa_id || customer.empresa_id || undefined

        await deliveryService.createAddressAlert({
          company: companyId,
          customer: customer.id,
          current_address: currentAddressJson,
          suggested_address: suggestedAddressPayload,
          origin: 'pin_entregador',
          distance_meters: distanceMeters,
          notes: `Marcado no local pelo entregador ${user.name || user.email} com desvio de ${distanceMeters}m (>500m, requer aprovação da central). Precisão GPS: ~${accuracy}m. Endereço obtido via GPS reverso: ${resolvedAddressString}`,
        })

        toast.dismiss(toastId)
        toast.success('Marcação enviada para revisão!', {
          description: `Desvio de ${distanceMeters}m (>500m). Enviado para a caixa de Endereços Suspeitos para aprovação da central.`,
          duration: 6000,
        })
      }
    } catch (err: any) {
      toast.dismiss(toastId)
      console.error('[CourierApp] Erro ao marcar endereço do cliente:', err)

      if (err?.code === 1 /* PERMISSION_DENIED */) {
        toast.error('Permissão de GPS negada', {
          description:
            'Habilite a localização nas configurações do navegador/iPhone para marcar o local.',
          duration: 6000,
        })
        setIsIPhoneGuideOpen(true)
      } else if (err?.code === 3 /* TIMEOUT */) {
        toast.error('Tempo esgotado ao buscar GPS', {
          description:
            'Sinal fraco ou indisponível no momento. Tente novamente com visão aberta do céu.',
          duration: 5000,
        })
      } else if (err?.code === 2 /* POSITION_UNAVAILABLE */) {
        toast.error('Posição GPS indisponível', {
          description: 'Verifique se o serviço de localização está ativado no aparelho.',
          duration: 5000,
        })
      } else {
        toast.error('Não foi possível registrar o endereço', {
          description: err?.message || 'Tente novamente em instantes.',
          duration: 5000,
        })
      }
    } finally {
      setIsSubmittingPin(false)
    }
  }

  // Ação "Iniciar Entrega" do cliente atual (marca em andamento se ainda não estiver e abre GPS / Como Chegar)
  // REGRA ESTRITA DE ORDEM: Apenas a primeira parada não entregue da rota (#1 pendente)
  // pode liberar navegação e início de entrega. Pedidos subsequentes ficam travados com "Aguarde, parada #N".
  const handleStartDelivery = async (order: OrderRecord) => {
    if (!currentActiveDelivery || order.id !== currentActiveDelivery.id) {
      const targetSeq = order.sequence ?? activeDeliveries.findIndex((d) => d.id === order.id) + 1
      toast.warning(
        `Aguarde, parada #${targetSeq}. Siga a ordem da rota: conclua primeiro a entrega de ${currentActiveDelivery?.expand?.customer_id?.name || 'Parada #1'}.`,
        {
          duration: 5000,
        },
      )
      return
    }

    const cust = order.expand?.customer_id

    // Exibe o ponto de referência em destaque sonoro/toast antes de abrir o mapa
    if (cust?.reference_point) {
      toast.info(`📍 Ponto de Referência: "${cust.reference_point}"`, {
        description: cust.plus_code
          ? `Plus Code: ${cust.plus_code}`
          : 'Confira os detalhes na chegada ao local.',
        duration: 7000,
      })
    }

    try {
      if (order.status !== 'in_transit') {
        await deliveryService.updateOrder(order.id, {
          status: 'in_transit',
          courier_id: user?.id,
          estimated_arrival: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
        await loadCourierOrders()
      }
      toast.success(`Navegação iniciada para ${cust?.name || 'o cliente'}!`)
      // Abrir modal de escolha de navegação (Waze ou Google Maps)
      // Prioriza coordenadas do pin cadastrado no cliente; fallback para coordenadas do pedido
      const targetLat =
        cust?.lat !== undefined && cust?.lat !== null && !isNaN(Number(cust.lat))
          ? cust.lat
          : order.end_address_lat
      const targetLng =
        cust?.lng !== undefined && cust?.lng !== null && !isNaN(Number(cust.lng))
          ? cust.lng
          : order.end_address_lng
      const targetAddress =
        cust?.address ||
        (cust?.street
          ? `${cust.street}${cust.complement ? `, ${cust.complement}` : ''} - ${cust.neighborhood || cust.city || ''}`
          : order.end_address_text || '')

      openExternalNavigation(
        targetAddress,
        targetLat,
        targetLng,
        cust?.name || order.end_address_name || 'Cliente',
      )
    } catch {
      toast.error('Erro ao iniciar entrega.')
    }
  }

  // Ação: Retornar à Base (abre navegação para a base com escolha Waze/Maps)
  const handleNavigateToBase = () => {
    toast.info(`Navegando de volta para a base: ${baseCoordinates.name}`)
    openExternalNavigation(
      baseCoordinates.address,
      baseCoordinates.lat,
      baseCoordinates.lng,
      baseCoordinates.name,
    )
  }

  // Ação: Finalizar Rota Inteira na Chegada à Base (manual ou automático por geofence)
  // ITEM 3: SEM odômetro nem fotos. KM oficial = telemetria mapeada na rua reconciliada com viário.
  const handleFinishFullRoute = async (isAutomatic = false) => {
    if (!user?.id) {
      if (!isAutomatic) toast.error('Entregador não autenticado.')
      return
    }

    if (currentRouteOrders.length === 0) {
      if (!isAutomatic) toast.info('Nenhuma rota ativa pendente de encerramento.')
      return
    }

    if (isFinishingRoute || isAutoFinishingRouteRef.current) return
    isAutoFinishingRouteRef.current = true
    setIsFinishingRoute(true)

    try {
      const orderIdsToFinish = currentRouteOrders.map((o) => o.id)
      const currentBatchKey = currentRouteOrders[0]?.route_batch_key || ''

      // Forçar offlineTelemetryBuffer.flush() antes de finalizar rota
      setIsFlushingBuffer(true)
      isFlushingBufferRef.current = true
      try {
        await offlineTelemetryBuffer.flush(user.id)
      } catch (eF) {
        console.warn('[CourierApp] Tentativa inicial de flush antes de finalizar falhou:', eF)
      } finally {
        setIsFlushingBuffer(false)
        isFlushingBufferRef.current = false
      }

      const finishResult = await deliveryService.finishCourierRoute(
        user.id,
        orderIdsToFinish,
        undefined,
        currentBatchKey,
      )

      if (finishResult.pendingPingsRemaining && finishResult.pendingPingsRemaining > 0) {
        toast.warning(
          `Aviso: ${finishResult.pendingPingsRemaining} pontos de GPS ficaram salvos no celular e serão sincronizados assim que tiver sinal estável.`,
          { duration: 8000 },
        )
      }

      if (isAutomatic) {
        toast.success(
          '🏁 Você chegou à base! Rota finalizada automaticamente. Telemetria real computada com sucesso.',
          {
            duration: 6000,
          },
        )
      } else {
        toast.success(
          '🏁 Rota finalizada com sucesso na base! Telemetria apurada e você já está liberado para a próxima rota.',
          {
            duration: 5000,
          },
        )
      }

      setIsFinishRouteModalOpen(false)
      baseGeofenceHitCountRef.current = 0
      await loadCourierOrders({ force: true })
      await loadFuelAndAccountData({ force: true })
    } catch (err) {
      console.error('Erro ao finalizar rota inteira:', err)
      if (!isAutomatic) {
        toast.error('Falha ao finalizar rota. Tente novamente.')
      }
    } finally {
      setIsFinishingRoute(false)
      isAutoFinishingRouteRef.current = false
    }
  }

  // AUTO-FINALIZAÇÃO POR GEOFENCE:
  // Se está na etapa de retorno à base (todas as entregas feitas) e o entregador chega à base
  // (raio <= 120m confirmado em 2 leituras consecutivas para evitar falsos positivos por imprecisão de GPS)
  useEffect(() => {
    if (!isReturningToBase) {
      baseGeofenceHitCountRef.current = 0
      return
    }

    if (distanceToBaseMeters === null) return

    const GEOFENCE_BASE_RADIUS_METERS = 120

    if (distanceToBaseMeters <= GEOFENCE_BASE_RADIUS_METERS) {
      baseGeofenceHitCountRef.current += 1
      if (
        baseGeofenceHitCountRef.current >= 2 &&
        !isAutoFinishingRouteRef.current &&
        !isFinishingRoute
      ) {
        handleFinishFullRoute(true)
      }
    } else {
      // Se estiver mais longe que 180m, reinicia a contagem de proximidade
      if (distanceToBaseMeters > 180) {
        baseGeofenceHitCountRef.current = 0
      }
    }
  }, [isReturningToBase, distanceToBaseMeters, isFinishingRoute])

  return (
    <div className="min-h-screen bg-white text-[#002855] flex flex-col pb-20 md:pb-6 font-sans">
      <Header />
      <main className="flex-1 max-w-xl mx-auto w-full p-4 space-y-4">
        {/* CABEÇALHO LIMPO DA ROTA COM STATUS DE GPS E CONECTIVIDADE */}
        <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                App do Entregador
              </span>
              <h1 className="font-heading text-lg font-black text-white truncate">Minha Rota</h1>
            </div>

            <div className="flex items-center gap-2">
              {gpsStatus === 'active' && isOnline ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="text-xs font-semibold text-emerald-400">GPS Ativo</span>
                </div>
              ) : gpsFailureDetail === 'background_permission_missing' ? (
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500 animate-ping" />
                  </span>
                  <span className="text-xs font-semibold text-rose-400 truncate max-w-[170px] sm:max-w-none">
                    Permissão insuficiente para segundo plano
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsBackgroundPermissionModalOpen(true)}
                    className="ml-1 text-[11px] font-bold text-rose-300 underline hover:text-white whitespace-nowrap"
                  >
                    Liberar
                  </button>
                </div>
              ) : gpsFailureDetail === 'permission_denied' ? (
                <div className="flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                  </span>
                  <span className="text-xs font-semibold text-rose-400 truncate max-w-[170px] sm:max-w-none">
                    Permissão Negada
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsIPhoneGuideOpen(true)}
                    className="ml-1 text-[11px] font-bold text-rose-300 underline hover:text-white"
                  >
                    Como liberar
                  </button>
                </div>
              ) : !isOnline ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                  </span>
                  <span className="text-xs font-semibold text-amber-400">Modo Offline</span>
                </div>
              ) : gpsFailureDetail === 'weak_signal' ||
                gpsFailureDetail === 'position_unavailable' ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500 animate-pulse" />
                  </span>
                  <span className="text-xs font-semibold text-amber-400">
                    Sinal GPS fraco — tentando novamente...
                  </span>
                </div>
              ) : gpsFailureDetail === 'unsupported' ? (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-500" />
                  </span>
                  <span className="text-xs font-semibold text-rose-400">GPS Desligado</span>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                  </span>
                  <span className="text-xs font-semibold text-amber-400">Aguardando Sinal</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* MACROS DE OCORRÊNCIA DE 1 CLIQUE (Item O) */}
        {/* Barra com 3 botões rápidos: 🚦 Blitz/Trânsito, ❌ Rua Bloqueada, 🏃 Beco a Pé */}
        <div className="rounded-2xl border border-slate-200 bg-white p-3 shadow-md">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-100">
            <span className="text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
              <span>⚡</span> Sinalizar Ocorrência (1 Clique)
            </span>
            <span className="text-[10px] text-slate-400 font-medium">Geolocalizado no lote</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              disabled={isSubmittingMacro !== null}
              onClick={() => handleSendMacroOccurrence('blitz_transito', 'Blitz/Trânsito')}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-amber-300 bg-amber-50 hover:bg-amber-100 active:scale-95 transition text-slate-800 disabled:opacity-50 text-center"
            >
              <span className="text-lg">🚦</span>
              <span className="text-[11px] font-bold mt-0.5 leading-tight">Blitz/Trânsito</span>
            </button>
            <button
              type="button"
              disabled={isSubmittingMacro !== null}
              onClick={() => handleSendMacroOccurrence('rua_bloqueada', 'Rua Bloqueada')}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-rose-300 bg-rose-50 hover:bg-rose-100 active:scale-95 transition text-slate-800 disabled:opacity-50 text-center"
            >
              <span className="text-lg">❌</span>
              <span className="text-[11px] font-bold mt-0.5 leading-tight">Rua Bloqueada</span>
            </button>
            <button
              type="button"
              disabled={isSubmittingMacro !== null}
              onClick={() => handleSendMacroOccurrence('beco_a_pe', 'Beco a Pé')}
              className="flex flex-col items-center justify-center p-2 rounded-xl border border-blue-300 bg-blue-50 hover:bg-blue-100 active:scale-95 transition text-slate-800 disabled:opacity-50 text-center"
            >
              <span className="text-lg">🏃</span>
              <span className="text-[11px] font-bold mt-0.5 leading-tight">Beco a Pé</span>
            </button>
          </div>
        </div>

        {/* BANNER DE AVISO DE RESEQUENCIAMENTO COM RETRY / INSTABILIDADE */}
        {resequenceFailureBanner && (
          <div className="rounded-xl border border-amber-500/60 bg-amber-950/70 p-3.5 space-y-2 text-xs text-amber-200 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="text-xl shrink-0 mt-0.5">⚠️</span>
                <div className="min-w-0">
                  <p className="font-bold text-white text-xs">
                    Sincronização de Rota com Proteção Ativa
                  </p>
                  <p className="text-[11px] text-amber-200/90 mt-0.5 leading-relaxed">
                    {resequenceFailureBanner.message}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setResequenceFailureBanner(null)}
                className="text-amber-400 hover:text-white p-1 text-sm font-bold shrink-0"
                title="Fechar aviso"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {/* INDICADOR VISUAL DESTACADO: MODO OFFLINE COM DADOS EM CACHE LOCAL */}
        {(!isOnline || isServingFromOfflineCache) && (
          <div className="rounded-xl border border-amber-500/50 bg-gradient-to-r from-amber-950/80 to-amber-900/50 p-3.5 space-y-2 text-xs text-amber-200 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <div className="p-1.5 rounded-lg bg-amber-500/20 text-amber-400 shrink-0 mt-0.5">
                  <WifiOff className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className="bg-amber-500 text-slate-950 text-[10px] font-black uppercase px-2 py-0.5">
                      Modo Offline Ativo
                    </Badge>
                    {isServingFromOfflineCache && (
                      <span className="text-[10px] font-mono font-semibold text-amber-300 flex items-center gap-1">
                        <Database className="h-3 w-3" /> Rota Salva no Aparelho
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-white text-xs mt-1">
                    Sem conexão com a internet. Rota do dia aberta via cache local.
                  </p>
                  <p className="text-[11px] text-amber-200/90 mt-0.5 leading-relaxed">
                    Você pode consultar clientes, endereços, telefones e abrir navegação no Google
                    Maps/Waze normalmente. Posições de GPS e ações serão sincronizadas
                    automaticamente assim que o sinal voltar.
                  </p>
                  {offlineCacheSavedAt && (
                    <p className="text-[10px] text-amber-300/70 mt-1 font-mono">
                      Última atualização da rota:{' '}
                      {new Date(offlineCacheSavedAt).toLocaleTimeString('pt-BR', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* AVISO PERSISTENTE E AMIGÁVEL: DETECÇÃO DE PINGS PRESOS (> 3 MINUTOS) EM ROTA ATIVA */}
        {hasActiveStartedRoute && minutesSinceLastPing >= 3 && (
          <div className="rounded-xl border-2 border-amber-500 bg-amber-950/70 p-4 space-y-3 text-xs text-amber-100 shadow-2xl animate-pulse">
            <div className="flex items-start gap-3">
              <span className="text-2xl shrink-0">📡</span>
              <div className="min-w-0 flex-1">
                <p className="font-bold text-white text-sm leading-snug">
                  Sinal interrompido há {minutesSinceLastPing} min
                </p>
                <p className="text-xs text-amber-200/90 mt-1 leading-relaxed">
                  Abra o app e mantenha a tela ligada para continuar rastreando a entrega em tempo
                  real na Torre de Controle.
                </p>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1 border-t border-amber-500/30">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  if (triggerImmediateGpsRef.current) {
                    triggerImmediateGpsRef.current()
                    toast.info('Reativando GPS e enviando posição atual...')
                  }
                }}
                className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black text-xs h-9 px-4 rounded-xl flex items-center gap-1.5 shadow"
              >
                <RotateCcw className="h-4 w-4" />
                Reativar Rastreamento Agora
              </Button>
            </div>
          </div>
        )}

        {/* INDICADOR VISÍVEL DE BUFFER OFFLINE: aviso persistente quando há pontos aguardando sincronização */}
        {pendingBufferedPoints > 0 && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 flex items-center justify-between gap-3 text-xs text-amber-200 shadow-lg animate-pulse">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="text-lg shrink-0">📴</span>
              <div className="min-w-0">
                <p className="font-bold text-white text-xs">
                  {pendingBufferedPoints}{' '}
                  {pendingBufferedPoints === 1
                    ? 'ponto de trajeto salvo offline'
                    : 'pontos de trajeto salvos offline'}
                </p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  {!isOnline
                    ? 'Sem internet no momento. Sincronização automática assim que o sinal voltar.'
                    : 'Sincronizando pontos com a Torre de Controle...'}
                </p>
              </div>
            </div>
            {isFlushingBuffer && (
              <div className="h-5 w-5 border-2 border-amber-400 border-t-transparent animate-spin rounded-full shrink-0" />
            )}
          </div>
        )}

        {/* BANNER DISTINTO DE PERMISSÃO NEGADA */}
        {gpsFailureDetail === 'permission_denied' && (
          <div className="rounded-xl border border-rose-500/50 bg-rose-950/60 p-3.5 space-y-2.5 text-xs text-rose-200 shadow-xl">
            <div className="flex items-start justify-between gap-2.5">
              <div className="flex items-start gap-2.5 min-w-0">
                <span className="text-xl shrink-0 mt-0.5">🚫</span>
                <div className="min-w-0">
                  <p className="font-bold text-white text-xs">
                    Permissão de Localização Negada no Navegador
                  </p>
                  <p className="text-[11px] text-rose-300/90 mt-0.5 leading-relaxed">
                    O Safari/navegador está bloqueando o acesso ao GPS. A Torre de Controle não
                    consegue receber seus pontos e o cálculo de km rodado fica suspenso.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <Button
                type="button"
                size="sm"
                onClick={() => setIsIPhoneGuideOpen(true)}
                className="bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs h-9 px-3 rounded-lg flex items-center gap-1.5 shadow"
              >
                <Smartphone className="h-3.5 w-3.5" />
                Como liberar no iPhone
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  if (triggerImmediateGpsRef.current) {
                    triggerImmediateGpsRef.current()
                  }
                }}
                className="border-rose-400/40 text-rose-200 hover:bg-rose-900/40 text-xs h-9 px-3 rounded-lg flex items-center gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Tentar novamente
              </Button>
            </div>
          </div>
        )}

        {/* BANNER DE SINAL FRACO / TIMEOUT (AMBAR, SEM MARCAR COMO GPS DESLIGADO) */}
        {gpsFailureDetail === 'weak_signal' || gpsFailureDetail === 'position_unavailable' ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/40 p-3.5 flex items-center justify-between gap-3 text-xs text-amber-200 shadow-lg">
            <div className="flex items-center gap-2.5 min-w-0">
              <Radio className="h-5 w-5 text-amber-400 shrink-0 animate-pulse" />
              <div className="min-w-0">
                <p className="font-bold text-white text-xs">
                  Sinal GPS fraco — tentando novamente em ciclo curto...
                </p>
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Em áreas com prédios altos o sinal pode oscilar. Mantenha o aparelho próximo ao
                  suporte ou com visão aberta do céu.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (triggerImmediateGpsRef.current) {
                  triggerImmediateGpsRef.current()
                }
              }}
              className="border-amber-400/40 text-amber-200 hover:bg-amber-900/40 text-[11px] h-8 px-2 shrink-0"
            >
              Forçar Leitura
            </Button>
          </div>
        ) : null}

        {/* DICA DE TELA LIGADA / WAKE LOCK CASO NÃO SUPORTADO PELO BROWSER EM ROTA ATIVA */}
        {hasActiveStartedRoute && !wakeLockSupported && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-950/40 p-3 flex items-start gap-2.5 text-xs text-blue-200">
            <Sun className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
            <p className="text-[11px] text-blue-300 leading-relaxed">
              <strong className="text-white font-semibold">Dica para iPhone:</strong> mantenha o app
              aberto com a tela ligada no suporte do veículo durante a entrega para evitar que o iOS
              suspenda o rastreamento.
            </p>
          </div>
        )}

        {/* AVISO DISCRETO DE FILA: quando há rota aguardando na fila */}
        {queuedOrders.length > 0 && (
          <div className="rounded-xl border border-blue-500/30 bg-blue-950/40 p-3 flex items-center gap-3 text-xs text-blue-200">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-500/20 text-[#60A5FA] shrink-0 font-bold">
              ℹ️
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-white">
                Você tem {queuedOrders.length}{' '}
                {queuedOrders.length === 1
                  ? 'entrega/rota aguardando na fila'
                  : 'entregas/rotas aguardando na fila'}
              </p>
              <p className="text-[11px] text-blue-300/80 mt-0.5">
                Será liberada automaticamente ao finalizar a rota atual na base.
              </p>
            </div>
          </div>
        )}

        {/* LOADING STATE */}
        {isLoading && (
          <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-8 text-center text-slate-400">
            <div className="h-7 w-7 border-2 border-[#60A5FA] border-t-transparent animate-spin rounded-full mx-auto mb-2" />
            <p className="text-xs">Carregando clientes da rota...</p>
          </div>
        )}

        {/* CASO: TODAS AS ENTREGAS CONCLUÍDAS - RETORNO À BASE E FINALIZAÇÃO DA ROTA */}
        {/* Regra do Usuário: "O APP DO ENTREGADOR PRECISA FINALIZAR CADA ENTREGA E NO FINAL DA BASE PONTO DE CHEGADA ELE FINALIZA ROTA INTEIRA. ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL." */}
        {!isLoading && isReturningToBase && (
          <div className="rounded-2xl border-2 border-[#0052CC] bg-[#0E1738] p-5 shadow-2xl shadow-blue-950/40 space-y-4">
            <div className="flex items-start justify-between gap-3 border-b border-[#1E2B58] pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[#0052CC] to-[#1D4ED8] text-white shadow-brand">
                  <Navigation className="h-6 w-6" />
                </div>
                <div>
                  <Badge className="bg-[#0052CC] text-white text-[10px] font-black uppercase px-2 py-0.5">
                    Etapa Final da Rota
                  </Badge>
                  <h2 className="font-heading text-base font-bold text-white mt-1">
                    Retorne à Base de Origem
                  </h2>
                </div>
              </div>

              <div className="text-right">
                <span className="text-[10px] text-slate-400 block uppercase font-bold">Status</span>
                <span className="text-xs font-black text-amber-400">Em Trânsito à Base</span>
              </div>
            </div>

            {/* Informações da Base */}
            <div className="p-3.5 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-2">
              <div className="flex items-start gap-2.5">
                <MapPin className="h-4 w-4 text-[#FF6B35] shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-bold text-white">{baseCoordinates.name}</p>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      Geofence Ativo (120m)
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {baseCoordinates.address}
                  </p>
                  {distanceToBaseMeters !== null && (
                    <p className="text-[11px] font-mono text-[#60A5FA] mt-1.5 font-semibold flex items-center gap-1.5">
                      <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                      Distância atual da base:{' '}
                      <span className="text-white font-bold">
                        {distanceToBaseMeters >= 1000
                          ? `${(distanceToBaseMeters / 1000).toFixed(1)} km`
                          : `${distanceToBaseMeters} metros`}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Regra de finalização automática explicada */}
            <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-200 leading-relaxed space-y-1.5">
              <p className="font-bold flex items-center gap-1.5 text-emerald-300 text-sm">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                Todas as entregas concluídas! Retorne à base.
              </p>
              <p className="text-[11px] text-emerald-100/90 leading-relaxed">
                Você não precisa clicar em nada. Ao se aproximar da base (~120m), o sistema finaliza
                a rota inteira automaticamente com o cálculo oficial de km e combustível.
              </p>
            </div>

            {/* Informação da rota concluída com KM viário oficial */}
            <div className="p-3.5 rounded-2xl border border-emerald-500/30 bg-emerald-950/20 text-xs text-emerald-200 space-y-1">
              <span className="font-bold flex items-center gap-1.5 text-emerald-300">
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                Todas as paradas foram concluídas!
              </span>
              <p className="text-[11px] text-slate-300">
                Retorne à base para concluir o ciclo viário oficial. O encerramento ocorre
                automaticamente por proximidade (geofence) ou tocando no botão abaixo.
              </p>
            </div>

            {/* Botões de Ação: Navegar até a base & Finalizar Rota Inteira (Fallback manual) */}
            <div className="space-y-2 pt-1">
              <Button
                type="button"
                onClick={handleNavigateToBase}
                className="w-full h-12 bg-gradient-to-r from-[#0052CC] to-[#0066FF] hover:from-[#0047B3] hover:to-[#0052CC] text-white font-bold text-xs rounded-xl border border-blue-400/30 flex items-center justify-center gap-2 shadow-lg"
              >
                <Navigation className="h-4 w-4 text-[#60A5FA]" />
                <span>Navegar até a Base (GPS / Waze)</span>
              </Button>

              <Button
                type="button"
                onClick={() => handleFinishFullRoute(false)}
                disabled={isFinishingRoute}
                variant="outline"
                className="w-full h-11 border-emerald-500/40 bg-emerald-950/20 hover:bg-emerald-900/40 text-emerald-300 font-semibold text-xs rounded-xl flex items-center justify-center gap-2"
              >
                <CheckCircle className="h-4 w-4 text-emerald-400" />
                {isFinishingRoute
                  ? 'Finalizando Rota...'
                  : 'Finalizar Manualmente (se geofence oscilar)'}
              </Button>
            </div>
          </div>
        )}

        {/* CASO: NENHUMA ENTREGA LIBERADA E NENHUMA ROTA AGUARDANDO RETORNO */}
        {!isLoading && activeDeliveries.length === 0 && !isReturningToBase && (
          <div className="rounded-2xl border border-dashed border-[#1E2B58] bg-[#0E1738]/60 p-8 text-center space-y-2">
            <div className="h-12 w-12 rounded-full bg-[#121E46] text-slate-400 flex items-center justify-center mx-auto mb-1">
              <CheckCircle className="h-6 w-6" />
            </div>
            <h3 className="font-heading text-sm font-bold text-white">
              Nenhuma rota liberada no momento
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Quando o vendedor otimizar e liberar suas entregas pelo painel, a lista de clientes
              aparecerá aqui automaticamente em tempo real.
            </p>
          </div>
        )}

        {/* ============================================================== */}
        {/* ESTADO 1: ROTA NÃO INICIADA (AGUARDANDO ACEITAR ROTA)           */}
        {/* Apenas a listagem de clientes em ordem + Botão "Aceitar Rota" */}
        {/* ============================================================== */}
        {!isLoading && activeDeliveries.length > 0 && !isRouteStarted && (
          <div className="space-y-3">
            {/* Informações da rota planejada oficial */}
            <div className="p-3.5 rounded-2xl border border-[#1E2B58] bg-[#0E1738] space-y-1.5 text-xs shadow-md">
              <span className="font-bold text-white flex items-center gap-1.5 font-heading">
                <span>🛣️</span> Trajeto Viário Oficial Planejado
              </span>
              <p className="text-[11px] text-slate-400">
                O trajeto viário oficial das paradas é apurado pelo otimizador de rota. Toque em
                &quot;Aceitar Rota&quot; para iniciar as entregas.
              </p>
            </div>

            {/* Botão Principal Aceitar Rota (Bloqueado se faltar permissão de segundo plano no nativo) */}
            <Button
              type="button"
              onClick={() => {
                if (!hasBackgroundPermission) {
                  setIsBackgroundPermissionModalOpen(true)
                  return
                }
                handleOpenStartRouteModal()
              }}
              disabled={isStartingRoute}
              className={`w-full h-14 font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl flex items-center justify-center gap-3 border transition ${
                !hasBackgroundPermission
                  ? 'bg-rose-950/70 border-rose-500 text-rose-300 hover:bg-rose-900/80 shadow-rose-950/50'
                  : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 border-emerald-400/40 shadow-emerald-950/40'
              }`}
            >
              {!hasBackgroundPermission ? (
                <>
                  <AlertTriangle className="h-5 w-5 text-rose-400" />
                  <span>Liberar GPS Segundo Plano para Iniciar</span>
                </>
              ) : (
                <>
                  <Play className="h-5 w-5 fill-current" />
                  <span>{isStartingRoute ? 'Aceitando Rota...' : 'Aceitar Rota'}</span>
                </>
              )}
            </Button>

            <div className="flex items-center justify-between px-1 pt-1">
              <span className="text-xs font-bold font-heading uppercase text-slate-400">
                Sequência de Clientes ({activeDeliveries.length})
              </span>
              <span className="text-[11px] text-amber-400 font-semibold">
                Toque em &quot;Aceitar Rota&quot; para iniciar
              </span>
            </div>

            {/* Listagem simples de clientes na rota antes de iniciar */}
            <div className="space-y-2">
              {activeDeliveries.map((order, index) => {
                const customer = order.expand?.customer_id
                const stopNum = index + 1
                return (
                  <div
                    key={order.id}
                    className="p-3.5 rounded-xl border border-[#1E2B58] bg-[#0E1738] flex items-center gap-3 shadow-md"
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#121E46] border border-[#1E2B58] text-white font-bold text-xs shrink-0 font-heading">
                      {stopNum}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-bold text-white truncate">
                        {customer?.name || 'Cliente'}
                      </p>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5">
                        {customer?.street
                          ? `${customer.street}${customer.complement ? `, ${customer.complement}` : ''} - ${customer.neighborhood || customer.city || ''}`
                          : customer?.address || 'Endereço a confirmar'}
                      </p>
                      {customer?.reference_point && (
                        <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                          <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                          <span className="truncate max-w-[240px]">
                            Ref: {customer.reference_point}
                          </span>
                        </div>
                      )}
                      {customer?.plus_code && (
                        <span className="ml-1.5 text-[9px] font-mono text-blue-300 bg-blue-500/20 px-1 py-0.2 rounded border border-blue-400/30">
                          {customer.plus_code}
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] font-mono font-bold text-[#60A5FA] shrink-0">
                      {order.tracking_code}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* ESTADO 2: ROTA ACEITA / INICIADA (EXECUÇÃO SEQUENCIAL ESTRITA)  */}
        {/* Cada cliente com "Iniciar Entrega" ou "Cancelar Entrega"       */}
        {/* Apenas o cliente 1 ativo; demais aguardando/bloqueados         */}
        {/* ============================================================== */}
        {!isLoading && activeDeliveries.length > 0 && isRouteStarted && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-bold font-heading uppercase tracking-wide text-slate-300 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-[#FF6B35]" />
                Clientes para Entrega ({activeDeliveries.length})
              </span>
              <span className="text-[11px] text-emerald-400 font-bold">
                1 ativo • {subsequentDeliveries.length} aguardando
              </span>
            </div>

            {/* 1. CLIENTE ATUAL (PRIMEIRO NÃO FINALIZADO) — BOTÕES ATIVOS */}
            {currentActiveDelivery && (
              <div className="rounded-2xl border-2 border-emerald-500 bg-[#0E1738] p-4 shadow-xl shadow-emerald-950/30 space-y-3">
                {/* Cabeçalho do Cliente 1 */}
                <div className="flex items-start justify-between gap-2 border-b border-[#1E2B58] pb-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-slate-950 font-black text-xs shrink-0 font-heading">
                      1
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className="bg-emerald-500 text-slate-950 text-[10px] font-black uppercase px-2 py-0.5">
                          Entrega Atual
                        </Badge>
                        <span className="font-mono text-xs font-bold text-[#60A5FA]">
                          {currentActiveDelivery.tracking_code}
                        </span>
                      </div>
                      <h2 className="font-heading text-base font-bold text-white mt-1 truncate">
                        {currentActiveDelivery.expand?.customer_id?.name || 'Cliente'}
                      </h2>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[10px] text-slate-400 block">Total</span>
                    <span className="font-heading text-sm font-black text-emerald-400">
                      R$ {Number(currentActiveDelivery.total_price || 0).toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* Endereço e Detalhes */}
                <div className="space-y-2 text-xs text-slate-300">
                  <div className="flex items-start gap-2">
                    <MapPin className="h-4 w-4 text-[#FF6B35] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-white leading-relaxed">
                        {currentActiveDelivery.expand?.customer_id?.street
                          ? `${currentActiveDelivery.expand.customer_id.street}${currentActiveDelivery.expand.customer_id.complement ? `, ${currentActiveDelivery.expand.customer_id.complement}` : ''} - ${currentActiveDelivery.expand.customer_id.neighborhood || ''}, ${currentActiveDelivery.expand.customer_id.city || ''}`
                          : currentActiveDelivery.expand?.customer_id?.address ||
                            'Endereço a confirmar'}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        {currentActiveDelivery.expand?.customer_id?.postal_code ? (
                          <span className="text-[10px] font-mono text-slate-400">
                            CEP: {currentActiveDelivery.expand.customer_id.postal_code}
                          </span>
                        ) : (
                          <span className="text-[10px] font-mono text-amber-400/90 bg-amber-500/10 px-1.5 py-0.2 rounded border border-amber-500/30">
                            Sem CEP
                          </span>
                        )}
                        {currentActiveDelivery.expand?.customer_id?.plus_code && (
                          <span className="text-[10px] font-mono text-blue-300 bg-blue-500/20 px-1.5 py-0.2 rounded border border-blue-400/30">
                            Plus Code: {currentActiveDelivery.expand.customer_id.plus_code}
                          </span>
                        )}
                      </div>

                      {/* ITEM 1: Ponto de Referência em DESTAQUE AMARELO (Alerta Prioritário) */}
                      {currentActiveDelivery.expand?.customer_id?.reference_point && (
                        <div className="mt-2 p-2.5 rounded-xl bg-amber-500/20 border-2 border-amber-500/60 text-amber-100 shadow-md">
                          <div className="flex items-center gap-1.5 font-bold text-amber-300 text-xs">
                            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />
                            <span>Ponto de Referência (Atenção ao Chegar):</span>
                          </div>
                          <p className="mt-1 text-xs font-semibold text-white leading-snug">
                            {currentActiveDelivery.expand.customer_id.reference_point}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {currentActiveDelivery.expand?.customer_id?.phone && (
                    <div className="flex items-center gap-2 text-slate-300 pt-0.5">
                      <Phone className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <a
                        href={`tel:${currentActiveDelivery.expand.customer_id.phone}`}
                        className="hover:underline font-mono text-xs"
                      >
                        {currentActiveDelivery.expand.customer_id.phone}
                      </a>
                    </div>
                  )}

                  {currentActiveDelivery.notes && (
                    <div className="p-2 rounded-lg bg-[#0A1128] border border-[#1E2B58] text-[11px] text-slate-300">
                      <span className="font-bold text-[#FF6B35]">Obs: </span>
                      {currentActiveDelivery.notes}
                    </div>
                  )}
                </div>

                {/* AVISO QUANDO REDIRECIONAMENTO JÁ ESTIVER INICIADO */}
                {currentActiveDelivery.redirection_status === 'initiated' && (
                  <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-200 text-xs space-y-1">
                    <div className="flex items-center gap-2 font-bold text-amber-300">
                      <Compass className="h-4 w-4 shrink-0 text-amber-400" />
                      <span>Redirecionamento em Andamento</span>
                    </div>
                    <p className="text-[11px] text-amber-100/90 leading-relaxed">
                      Ponto A registrado. Novo destino:{' '}
                      <strong>
                        {currentActiveDelivery.redirection_new_address || 'Endereço informado'}
                      </strong>
                      . Ao chegar lá, toque em <em>Concluir Entrega Redirecionada</em> para capturar
                      o Ponto B e o comprovante.
                    </p>
                    {currentActiveDelivery.redirection_new_address && (
                      <div className="pt-1">
                        <Button
                          type="button"
                          size="sm"
                          onClick={() => {
                            openExternalNavigation(
                              currentActiveDelivery.redirection_new_address!,
                              undefined,
                              undefined,
                              `Novo endereço (${currentActiveDelivery.expand?.customer_id?.name || 'Cliente'})`,
                            )
                          }}
                          className="h-8 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-[11px] rounded-lg flex items-center gap-1.5"
                        >
                          <Navigation className="h-3.5 w-3.5" />
                          <span>Abrir navegação para o novo endereço</span>
                        </Button>
                      </div>
                    )}
                  </div>
                )}

                {/* BOTÕES DE AÇÃO: NAVEGAR / REDIRECIONAR / CONCLUIR */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {/* Iniciar Entrega / Navegar */}
                  <Button
                    type="button"
                    onClick={() => handleStartDelivery(currentActiveDelivery)}
                    className="h-12 bg-gradient-to-r from-[#0052CC] to-[#0066FF] hover:from-[#0047B3] hover:to-[#0052CC] text-white font-bold text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 border border-blue-400/30"
                  >
                    <Navigation className="h-4 w-4 text-[#60A5FA]" />
                    <span>Iniciar Entrega (GPS)</span>
                  </Button>

                  {/* Finalizar / Comprovante */}
                  <Button
                    type="button"
                    onClick={() => {
                      setSelectedOrderForConfirmation(currentActiveDelivery)
                      setIsConfirmModalOpen(true)
                    }}
                    className={`h-12 text-slate-950 font-black text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 border ${
                      currentActiveDelivery.redirection_status === 'initiated'
                        ? 'bg-gradient-to-r from-amber-400 to-amber-500 hover:from-amber-500 hover:to-amber-600 border-amber-300'
                        : 'bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 border-emerald-400/40'
                    }`}
                  >
                    <CheckCircle className="h-4 w-4" />
                    <span>
                      {currentActiveDelivery.redirection_status === 'initiated'
                        ? 'Confirmar Entrega Redirecionada'
                        : 'Concluir Entrega'}
                    </span>
                  </Button>
                </div>

                {/* FLUXO ENTREGA REDIRECIONADA: CLIENTE EM OUTRO ENDEREÇO */}
                <div className="pt-0.5">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedOrderForRedirect(currentActiveDelivery)

                      // Requisito 3: Dica contextual na primeira vez que tocar no botão
                      if (typeof window !== 'undefined') {
                        try {
                          const hintSeen = localStorage.getItem(COURIER_POINT_A_HINT_KEY)
                          if (!hintSeen) {
                            localStorage.setItem(COURIER_POINT_A_HINT_KEY, 'true')
                            toast.info('📍 Gravando Ponto A no local atual', {
                              description:
                                'Sua posição GPS está sendo registrada para comprovar sua chegada física antes de ir ao novo endereço.',
                              duration: 6500,
                            })
                          }
                        } catch (err) {
                          console.warn('Erro ao acessar localStorage:', err)
                        }
                      }

                      setIsRedirectModalOpen(true)
                    }}
                    className="w-full h-11 border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 hover:text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition shadow-sm"
                  >
                    <Compass className="h-4 w-4 text-amber-400 shrink-0" />
                    <span>
                      {currentActiveDelivery.redirection_status === 'initiated'
                        ? 'Alterar Novo Endereço / Ponto A'
                        : 'Cliente em outro endereço (Gravar Ponto A)'}
                    </span>
                  </Button>
                </div>

                {/* Cancelar Entrega com Motivos Obrigatórios */}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setSelectedOrderForCancel(currentActiveDelivery)
                    setIsCancelModalOpen(true)
                  }}
                  className="w-full h-11 border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300 font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition"
                >
                  <XCircle className="h-4 w-4 text-rose-400" />
                  <span>Cancelar Entrega (Motivos)</span>
                </Button>
              </div>
            )}

            {/* 2. DEMAIS CLIENTES NA SEQUÊNCIA (BLOQUEADOS / AGUARDANDO) */}
            {subsequentDeliveries.length > 0 && (
              <div className="space-y-2 pt-2">
                <div className="flex items-center gap-2 px-1">
                  <Lock className="h-3.5 w-3.5 text-slate-400" />
                  <span className="text-xs font-bold font-heading uppercase text-slate-400">
                    Próximos Clientes (Aguardando — finalize o atual)
                  </span>
                </div>

                <div className="space-y-2">
                  {subsequentDeliveries.map((order, idx) => {
                    const customer = order.expand?.customer_id
                    const stopNum = idx + 2
                    return (
                      <div
                        key={order.id}
                        className="p-3.5 rounded-xl border border-[#1E2B58] bg-[#0E1738]/50 opacity-60 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 cursor-not-allowed select-none"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#121E46] border border-[#1E2B58] text-slate-400 font-bold text-xs shrink-0 font-heading">
                            {stopNum}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-300 truncate">
                              {customer?.name || 'Cliente'}
                            </p>
                            <p className="text-[11px] text-slate-400 truncate mt-0.5">
                              {customer?.street
                                ? `${customer.street}${customer.complement ? `, ${customer.complement}` : ''} - ${customer.neighborhood || customer.city || ''}`
                                : customer?.address || 'Endereço a confirmar'}
                            </p>
                            {customer?.reference_point && (
                              <div className="mt-1 inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold">
                                <AlertTriangle className="h-3 w-3 shrink-0 text-amber-400" />
                                <span className="truncate max-w-[220px]">
                                  Ref: {customer.reference_point}
                                </span>
                              </div>
                            )}
                            {customer?.plus_code && (
                              <span className="ml-1.5 text-[9px] font-mono text-blue-300 bg-blue-500/20 px-1 py-0.2 rounded border border-blue-400/30">
                                {customer.plus_code}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#1E2B58]/50">
                          <span className="font-mono text-xs text-slate-400">
                            {order.tracking_code}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                playOffRouteWarningSound()
                                toast.warning(
                                  `Entrega fora de ordem! Conclua primeiro a parada #${currentActiveDelivery ? currentActiveDelivery.sequence || 1 : 1} (${currentActiveDelivery?.expand?.customer_id?.name || 'Cliente atual'}).`,
                                  {
                                    description: `Parada #${stopNum} (${customer?.name || 'Cliente'}) só pode ser atendida após a conclusão da entrega atual.`,
                                    duration: 5000,
                                  },
                                )
                              }}
                              className="h-7 px-2 border-amber-500/30 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 text-[10px] font-bold rounded-lg flex items-center gap-1 cursor-pointer transition shadow-none"
                              title={`Parada #${stopNum} bloqueada. Toque para ouvir o alerta de fora de ordem.`}
                            >
                              <Lock className="h-3 w-3 text-amber-400" />
                              <span>Aguarde, parada #{stopNum}</span>
                            </Button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Links de suporte e download do APK Nativo no rodapé */}
      <div className="max-w-xl mx-auto w-full px-4 pt-1 pb-2 flex flex-col items-center justify-center gap-1.5 text-center">
        <div className="flex items-center justify-center gap-3 flex-wrap">
          {nativeGpsBridge.isNativeEnvironment() ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              <CheckCircle2 className="h-3 w-3 text-emerald-400" />
              <span>Você já está usando o app nativo</span>
            </span>
          ) : (
            <a
              href="/app-download"
              className="text-[11px] text-cyan-400 hover:text-cyan-300 flex items-center gap-1 font-semibold underline decoration-dotted"
            >
              <Smartphone className="h-3.5 w-3.5" />
              <span>Baixar APK Nativo (GPS em 2º plano)</span>
            </a>
          )}

          <span className="text-slate-600">•</span>

          <button
            type="button"
            onClick={() => setIsIPhoneGuideOpen(true)}
            className="text-[11px] text-slate-400 hover:text-[#60A5FA] flex items-center gap-1.5 transition underline decoration-dotted"
          >
            <HelpCircle className="h-3.5 w-3.5" />
            <span>GPS no iPhone? Como liberar</span>
          </button>
        </div>
        <span className="font-mono text-[10px] text-slate-500">{APP_VERSION_LABEL}</span>
      </div>

      {/* Navegação Inferior Mobile Mantida Intacta */}
      <CourierBottomNav />

      {/* Guia Modal Interativo de Liberação de GPS no iPhone */}
      <IPhoneGpsGuideModal
        open={isIPhoneGuideOpen}
        onOpenChange={setIsIPhoneGuideOpen}
        onRetry={() => {
          if (triggerImmediateGpsRef.current) {
            triggerImmediateGpsRef.current()
          }
        }}
      />

      {/* Modal de Instruções de Otimização de Bateria e GPS Contínuo (PATCH 5) */}
      <CourierBatteryGuideModal
        open={isBatteryGuideOpen}
        onClose={() => setIsBatteryGuideOpen(false)}
        onAcknowledge={() => {
          setIsBatteryGuideOpen(false)
        }}
      />

      {/* Modal de Instruções de Permissão de Segundo Plano (Item K3) */}
      <CourierBackgroundPermissionModal
        open={isBackgroundPermissionModalOpen}
        onClose={() => setIsBackgroundPermissionModalOpen(false)}
        onAcknowledge={async () => {
          setIsBackgroundPermissionModalOpen(false)
          // Registrar em audit_trail a ciência do entregador
          if (user?.id) {
            try {
              await pb.collection('audit_trail').create({
                user_id: user.id,
                collection: 'users',
                record_id: user.id,
                courier_id: user.id,
                action: 'ciencia_permissao_background_location',
                field: 'status',
                old_value: 'permissao_insuficiente',
                new_value: 'orientado_permitir_o_tempo_todo',
                timestamp: new Date().toISOString(),
                metadata: {
                  system_trigger: false,
                  actor_name: user.name || user.email || 'Entregador',
                  tutorial_acknowledged_at: new Date().toISOString(),
                  key: BACKGROUND_PERMISSION_ACK_KEY,
                },
              })
            } catch (auditErr) {
              console.warn('Erro ao registrar ciência no audit_trail:', auditErr)
            }
          }
          await checkBackgroundPermissionHealth()
        }}
      />

      {/* Modal de Conclusão com Foto e Assinatura (Fluxo de Comprovante) */}
      <DeliveryConfirmationModal
        order={selectedOrderForConfirmation}
        open={isConfirmModalOpen}
        onOpenChange={setIsConfirmModalOpen}
        onConfirmed={loadCourierOrders}
        courierId={user?.id}
        locations={locations}
        allOrders={orders}
      />

      {/* Modal de Entrega Redirecionada (Grava Ponto A e pede novo endereço) */}
      <RedirectDeliveryModal
        order={selectedOrderForRedirect}
        courierId={user?.id}
        open={isRedirectModalOpen}
        onOpenChange={setIsRedirectModalOpen}
        onRedirectionStarted={(updatedOrder) => {
          setOrders((prev) => prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o)))
          loadCourierOrders()
        }}
      />

      {/* Modal de Cancelamento de Entrega com os 4 Motivos Exatos */}
      <CancelDeliveryModal
        order={selectedOrderForCancel}
        open={isCancelModalOpen}
        onOpenChange={setIsCancelModalOpen}
        onCancelled={loadCourierOrders}
      />

      {/* Tutorial Ilustrado de Onboarding (Primeira Abertura e Redireção) */}
      <CourierRedirectionTutorialModal
        open={isTutorialModalOpen}
        onOpenChange={setIsTutorialModalOpen}
      />

      {/* ITEM 3: Odômetro removido por completo (sem modal de foto/leitura de odômetro) */}

      {/* Alerta de Presença Forçada em Tela Cheia Vermelha (Bloco 1) */}
      <ForcedPresenceAlert
        open={forcedAlertOpen}
        reason={forcedAlertReason}
        details={forcedAlertDetails}
        onAcknowledge={handleAcknowledgeForcedAlert}
        actionLabel={
          forcedAlertReason === 'at_base_unfinalized' ? 'Finalizar Rota Agora' : undefined
        }
        onAction={
          forcedAlertReason === 'at_base_unfinalized'
            ? () => {
                handleAcknowledgeForcedAlert()
                handleFinishFullRoute(false)
              }
            : undefined
        }
      />

      {/* Modal de Escolha de Navegação Externa (Waze ou Google Maps) */}
      <NavigationAppChoiceModal
        open={isNavigationChoiceOpen}
        onOpenChange={setIsNavigationChoiceOpen}
        destinationName={navigationTarget?.name}
        destinationAddress={navigationTarget?.address}
        lat={navigationTarget?.lat}
        lng={navigationTarget?.lng}
      />
    </div>
  )
}
