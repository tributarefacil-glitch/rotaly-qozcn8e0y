import React, { useState, useEffect, useMemo, useRef } from 'react'
import { haversineDistanceMeters } from '@/lib/geo'
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
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { DeliveryConfirmationModal } from '@/components/DeliveryConfirmationModal'
import { CancelDeliveryModal } from '@/components/CancelDeliveryModal'
import { IPhoneGpsGuideModal } from '@/components/IPhoneGpsGuideModal'
import { deliveryService } from '@/services/deliveryService'
import { offlineTelemetryBuffer } from '@/services/offlineTelemetryBuffer'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { OrderRecord } from '@/types/delivery'
import {
  notifyCourierNewDelivery,
  playOffRouteWarningSound,
  sendBrowserPushNotification,
} from '@/lib/notificationSound'
import { shouldDisplayToast } from '@/lib/notificationDedupe'
import type { NotificationRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Camera } from 'lucide-react'
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

  // Status de GPS e rede em tempo real com distinção de motivo
  const [gpsStatus, setGpsStatus] = useState<'active' | 'disabled' | 'offline'>('active')
  const [gpsFailureDetail, setGpsFailureDetail] = useState<
    'none' | 'permission_denied' | 'weak_signal' | 'position_unavailable' | 'unsupported'
  >('none')
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  )
  const [pendingBufferedPoints, setPendingBufferedPoints] = useState<number>(0)
  const [isFlushingBuffer, setIsFlushingBuffer] = useState<boolean>(false)
  const [isIPhoneGuideOpen, setIsIPhoneGuideOpen] = useState(false)
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>(true)
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false)

  const [isGpsActive] = useState(true)

  const [isLoading, setIsLoading] = useState(true)
  const [isStartingRoute, setIsStartingRoute] = useState(false)
  const [isFinishingRoute, setIsFinishingRoute] = useState(false)

  // Estados opcionais de odômetro e foto do painel (auditoria informativa, nunca bloqueante)
  const [odometroInicialInput, setOdometroInicialInput] = useState<string>('')
  const [odometroFinalInput, setOdometroFinalInput] = useState<string>('')
  const [fotoOdometroInicial, setFotoOdometroInicial] = useState<File | null>(null)
  const [fotoOdometroFinal, setFotoOdometroFinal] = useState<File | null>(null)
  const [currentCourierLocation, setCurrentCourierLocation] = useState<{
    lat: number
    lng: number
  } | null>(null)

  // Carregar dados de conta corrente e configurações para manter paridade com o motor de combustível
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

  // Ref para controle de throttle/dedupe das chamadas de loadCourierOrders
  const lastLoadOrdersTimestampRef = useRef<number>(0)
  const isOrdersFetchingRef = useRef<boolean>(false)

  // Carrega apenas pedidos liberados pelo vendedor ("assigned" com route_released=true ou em rota)
  const loadCourierOrders = async (options?: { force?: boolean }) => {
    const now = Date.now()
    if (!options?.force && isOrdersFetchingRef.current) return
    if (!options?.force && now - lastLoadOrdersTimestampRef.current < 2000) return

    try {
      isOrdersFetchingRef.current = true
      lastLoadOrdersTimestampRef.current = now

      if (!user?.id) {
        setOrders([])
        return
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
    } catch (err) {
      console.error('Error loading courier orders:', err)
    } finally {
      isOrdersFetchingRef.current = false
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadCourierOrders({ force: true })
  }, [user])

  // REFORÇO DE RECEPÇÃO: Polling periódico a cada 30 segundos + foco de tela + reconexão de rede
  useEffect(() => {
    if (!user?.id) return

    // 1. Polling a cada 30 segundos
    const intervalTimer = setInterval(() => {
      loadCourierOrders()
    }, 30000)

    // 2. Ao voltar para foco (visibilitychange / focus)
    const handleVisibilityOrFocus = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        loadCourierOrders({ force: true })
        loadFuelAndAccountData()
      }
    }

    // 3. Ao voltar a ficar online
    const handleNetworkOnline = () => {
      loadCourierOrders({ force: true })
      loadFuelAndAccountData()
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

  // Realtime para notificações / avisos de desvio
  useRealtime<NotificationRecord>('notifications', (e) => {
    if (e.action === 'create' && (!e.record.user_id || e.record.user_id === user?.id)) {
      if (e.record.type === 'off_route') {
        const dedupeKey = `notif-${e.record.id || `${e.record.type}-${e.record.order_id}-${e.record.created}`}`
        if (shouldDisplayToast(dedupeKey)) {
          playOffRouteWarningSound()
          sendBrowserPushNotification(e.record.title, e.record.message)
          toast.error(e.record.title, {
            description: e.record.message,
            duration: 8000,
          })
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
      // As entregas executáveis no app são apenas as da rota ativa que ainda não foram finalizadas
      const executables = current
        .filter((o) => o.status === 'in_transit' || o.status === 'assigned')
        .sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999))

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

    // Ordenar por sequência e liberação/criação
    // Todas as entregas liberadas não iniciadas compõem a rota pronta para ser aceita
    const currentSorted = [...unstartedReleased].sort((a, b) => {
      const seqA = a.sequence ?? 9999
      const seqB = b.sequence ?? 9999
      if (seqA !== seqB) return seqA - seqB
      const timeA = new Date(a.route_released_at || a.created || 0).getTime()
      const timeB = new Date(b.route_released_at || b.created || 0).getTime()
      return timeA - timeB
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

  // Assinatura reativa da contagem do buffer offline e listeners de conectividade online/offline
  useEffect(() => {
    const courierId = user?.id || ''
    // Inscrever na contagem de pontos do buffer
    const unsubscribeBuffer = offlineTelemetryBuffer.subscribe(courierId, (count) => {
      setPendingBufferedPoints(count)
    })

    const handleOnline = async () => {
      setIsOnline(true)
      // Ao voltar online, disparar flush idempotente do buffer E ping fresco imediato
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

  // Gerenciamento de Wake Lock para manter a tela ativa e o Safari iOS executando durante a rota ativa
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

    return () => {
      released = true
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

      // A) THROTTLE RÍGIDO DE 30s & DEDUPLICAÇÃO
      // Garantir intervalo mínimo de 30s entre envios reais.
      // Deduplicação: se a posição mudou menos de ~10m OU accuracy continua >= 500m (sem fix),
      // não criar pings repetidos; aguarda rigorosamente a janela de 30s.
      if (last && !forceSend) {
        const timeDiffSeconds = (now - last.timestamp) / 1000
        const distanceDiffMeters = haversineDistanceMeters(last.lat, last.lng, lat, lng)
        const isWeakFix = (accuracyVal ?? 2000) >= 500 || (last.accuracy ?? 2000) >= 500

        // Throttle rígido: nunca envia antes de 30 segundos
        if (timeDiffSeconds < 30) {
          return
        }

        // Se mudou menos de 10m e acurácia continua fraca/sem-fix, rejeita novo envio imediato
        if (distanceDiffMeters < 10 && isWeakFix && timeDiffSeconds < 60) {
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

        // Tentar envio normal online
        await deliveryService.updateCourierLocation(
          user.id,
          lat,
          lng,
          speed,
          90,
          batteryLevel ?? undefined,
          {
            gps_status: 'active',
            gps_reason: gpsReason,
            offline_buffered: false,
            accuracy: accuracyVal,
          },
        )

        // Registrar timestamp do último ping online transmitido com sucesso
        offlineTelemetryBuffer.recordSuccessfulOnlinePing(user.id, now)

        // Sucesso: atualiza referência e reseta contador de retry
        lastRecordedGpsRef.current = { lat, lng, accuracy: accuracyVal, timestamp: now }
        retryCountRef.current = 0
        if (retryTimeoutRef.current) {
          clearTimeout(retryTimeoutRef.current)
          retryTimeoutRef.current = null
        }

        // Se houver pontos no buffer que aguardavam sinal, tenta flush agora que a rede respondeu
        if (offlineTelemetryBuffer.size(user.id) > 0 && !isFlushingBufferRef.current) {
          offlineTelemetryBuffer.flush(user.id).catch(() => {})
        }
      } catch (e) {
        console.error(
          'Failed to post live location (aplicando backoff exponencial máx 3 tentativas):',
          e,
        )

        // Salvar no buffer offline se em rota ativa E não estiver online (bloquear enfileiramento se navigator.onLine)
        const isActuallyOnline = typeof navigator !== 'undefined' && navigator.onLine === true
        if (hasActiveStartedRoute && !isActuallyOnline) {
          offlineTelemetryBuffer.enqueuePoint({
            userId: user.id,
            lat,
            lng,
            speed,
            heading: 90,
            accuracy: accuracyVal,
            batteryLevel: batteryLevel ?? undefined,
            timestamp: now,
            reason: (accuracyVal ?? 2000) >= 500 ? 'sem-fix' : 'network_offline',
          })
        }

        // RETRY COM BACKOFF EXPONENCIAL (10s, 30s, 60s) — NO MÁXIMO 3 TENTATIVAS
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

    // Iniciar watchPosition contínuo (ideal enquanto há rota ativa ou app aberto)
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

    // REAVALIAÇÃO QUANDO A TELA VOLTA / VISIBILITYCHANGE (item 3: flush de buffer E ping fresco com maximumAge: 0)
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

      // 1. Flush imediato do buffer offline
      if (user?.id && offlineTelemetryBuffer.size(user.id) > 0) {
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

    const handlePageShow = (e: PageTransitionEvent) => {
      // Quando a página é restaurada pelo bfcache do Safari iOS
      if (e.persisted || document.visibilityState === 'visible') {
        handleResume()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)

    return () => {
      isEffectActive = false
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
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [user, isGpsActive, hasActiveStartedRoute])

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

  // Identificar coordenadas da base para guiar o retorno
  const baseCoordinates = useMemo(() => {
    const anchor = currentRouteOrders[0] || orders[0]
    return {
      name: anchor?.start_base_name || 'Base Operacional',
      address: anchor?.start_base_address || 'Base de Distribuição',
      lat: anchor?.start_base_lat || -22.906847,
      lng: anchor?.start_base_lng || -43.172896,
    }
  }, [currentRouteOrders, orders])

  // Distância do entregador até a base no momento (em metros)
  const distanceToBaseMeters = useMemo(() => {
    if (!currentCourierLocation || !baseCoordinates.lat || !baseCoordinates.lng) return null
    const R = 6371000 // metros
    const dLat = ((baseCoordinates.lat - currentCourierLocation.lat) * Math.PI) / 180
    const dLng = ((baseCoordinates.lng - currentCourierLocation.lng) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((currentCourierLocation.lat * Math.PI) / 180) *
        Math.cos((baseCoordinates.lat * Math.PI) / 180) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return Math.round(R * c)
  }, [currentCourierLocation, baseCoordinates])

  // O primeiro cliente não finalizado da sequência é o único ativo
  const currentActiveDelivery = activeDeliveries.length > 0 ? activeDeliveries[0] : null
  const subsequentDeliveries = activeDeliveries.slice(1)

  // Ação: Aceitar / Iniciar Rota (dispara telemetria, quilometragem e consumo)
  const handleAcceptRoute = async () => {
    if (!user?.id) {
      toast.error('Entregador não autenticado.')
      return
    }

    if (activeDeliveries.length === 0) {
      toast.info('Não há clientes na rota liberada.')
      return
    }

    setIsStartingRoute(true)
    try {
      const orderIdsToStart = activeDeliveries.map((o) => o.id)
      const odomInitVal = odometroInicialInput
        ? parseFloat(odometroInicialInput.replace(',', '.'))
        : undefined

      await deliveryService.startCourierRoute(user.id, orderIdsToStart, {
        odometro_inicial:
          !isNaN(odomInitVal as number) && (odomInitVal as number) > 0
            ? (odomInitVal as number)
            : undefined,
        foto_odometro_inicial: fotoOdometroInicial,
      })
      toast.success('🚀 Rota aceita! Telemetria ativa e primeira entrega desbloqueada.', {
        duration: 4000,
      })
      await loadCourierOrders()
    } catch (err) {
      console.error('Erro ao aceitar rota:', err)
      toast.error('Falha ao aceitar rota. Tente novamente.')
    } finally {
      setIsStartingRoute(false)
    }
  }

  // Navegação externa (Google Maps / Waze)
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

  // Ação "Iniciar Entrega" do cliente atual (marca em andamento se ainda não estiver e abre GPS)
  const handleStartDelivery = async (order: OrderRecord) => {
    try {
      if (order.status !== 'in_transit') {
        await deliveryService.updateOrder(order.id, {
          status: 'in_transit',
          courier_id: user?.id,
          estimated_arrival: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        })
        await loadCourierOrders()
      }
      toast.success(`Navegação iniciada para ${order.expand?.customer_id?.name || 'o cliente'}!`)
      // Abrir navegação
      const cust = order.expand?.customer_id
      openExternalNavigation(cust?.address || '', cust?.lat, cust?.lng)
    } catch {
      toast.error('Erro ao iniciar entrega.')
    }
  }

  // Ação: Retornar à Base (abre navegação para a base)
  const handleNavigateToBase = () => {
    toast.info(`Navegando de volta para a base: ${baseCoordinates.name}`)
    openExternalNavigation(baseCoordinates.address, baseCoordinates.lat, baseCoordinates.lng)
  }

  // Ação: Finalizar Rota Inteira na Chegada à Base
  // Regra do Usuário: "O APP DO ENTREGADOR PRECISA FINALIZAR CADA ENTREGA E NO FINAL DA BASE PONTO DE CHEGADA ELE FINALIZA ROTA INTEIRA. ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL."
  const handleFinishFullRoute = async () => {
    if (!user?.id) {
      toast.error('Entregador não autenticado.')
      return
    }

    if (currentRouteOrders.length === 0) {
      toast.info('Nenhuma rota ativa pendente de encerramento.')
      return
    }

    setIsFinishingRoute(true)
    try {
      const orderIdsToFinish = currentRouteOrders.map((o) => o.id)
      const odomFinalVal = odometroFinalInput
        ? parseFloat(odometroFinalInput.replace(',', '.'))
        : undefined

      await deliveryService.finishCourierRoute(user.id, orderIdsToFinish, {
        odometro_final:
          !isNaN(odomFinalVal as number) && (odomFinalVal as number) > 0
            ? (odomFinalVal as number)
            : undefined,
        foto_odometro_final: fotoOdometroFinal,
      })
      toast.success(
        '🏁 Rota finalizada com sucesso na base! Odômetro oficial apurado e você já está liberado para receber uma nova rota.',
        {
          duration: 5000,
        },
      )
      setOdometroFinalInput('')
      setFotoOdometroFinal(null)
      await loadCourierOrders()
      await loadFuelAndAccountData()
    } catch (err) {
      console.error('Erro ao finalizar rota inteira:', err)
      toast.error('Falha ao finalizar rota. Tente novamente.')
    } finally {
      setIsFinishingRoute(false)
    }
  }

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
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-amber-500" />
                  </span>
                  <span className="text-xs font-semibold text-amber-400">Sem Internet</span>
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
                <div className="min-w-0">
                  <p className="text-xs font-bold text-white">{baseCoordinates.name}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                    {baseCoordinates.address}
                  </p>
                  {distanceToBaseMeters !== null && (
                    <p className="text-[11px] font-mono text-[#60A5FA] mt-1 font-semibold">
                      Distância atual estimada:{' '}
                      {distanceToBaseMeters >= 1000
                        ? `${(distanceToBaseMeters / 1000).toFixed(1)} km`
                        : `${distanceToBaseMeters} metros`}
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Regra de finalização explicada */}
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-200/90 leading-relaxed">
              <p className="font-semibold flex items-center gap-1.5 text-amber-300 mb-1">
                <Clock className="h-3.5 w-3.5" />
                Todas as entregas da rota foram concluídas!
              </p>
              No ponto de chegada na base, informe opcionalmente o odômetro final para registro e
              finalize a rota inteira abaixo.
            </div>

            {/* Campos de Odômetro Final e Foto (Opcional - Nunca bloqueia) */}
            <div className="p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-300 flex items-center gap-1.5">
                  <span>🏍️</span> Odômetro Final da Moto (Opcional)
                </span>
                <Badge variant="outline" className="text-[9px] border-slate-700 text-slate-400">
                  Auditoria
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">
                    KM Final do Painel
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 12543.8"
                    value={odometroFinalInput}
                    onChange={(e) => setOdometroFinalInput(e.target.value)}
                    className="h-9 bg-[#070D1E] border-[#1E2B58] text-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">
                    Foto do Painel (Opcional)
                  </label>
                  <label className="flex items-center justify-center h-9 px-3 rounded-lg border border-dashed border-[#1E2B58] bg-[#070D1E] hover:border-emerald-500/50 cursor-pointer text-slate-300 text-xs gap-1.5 truncate">
                    <Camera className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      {fotoOdometroFinal ? fotoOdometroFinal.name : 'Tirar Foto'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setFotoOdometroFinal(e.target.files[0])
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Botões de Ação: Navegar até a base & Finalizar Rota Inteira */}
            <div className="space-y-2 pt-1">
              <Button
                type="button"
                onClick={handleNavigateToBase}
                className="w-full h-12 bg-[#121E46] hover:bg-[#1A2A5E] text-[#60A5FA] font-bold text-xs rounded-xl border border-blue-400/30 flex items-center justify-center gap-2"
              >
                <Navigation className="h-4 w-4" />
                <span>Navegar até a Base (GPS / Waze)</span>
              </Button>

              <Button
                type="button"
                onClick={handleFinishFullRoute}
                disabled={isFinishingRoute}
                className="w-full h-14 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black text-sm uppercase tracking-wider rounded-xl shadow-xl shadow-emerald-950/40 flex items-center justify-center gap-3 border border-emerald-400/40"
              >
                <CheckCircle className="h-5 w-5" />
                {isFinishingRoute
                  ? 'Finalizando Rota...'
                  : 'Finalizar Rota Inteira (Chegada à Base)'}
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
            {/* Odômetro Inicial e Foto (Opcional - Nunca bloqueia o aceite da rota) */}
            <div className="p-3.5 rounded-2xl border border-[#1E2B58] bg-[#0E1738] space-y-2.5 text-xs shadow-md">
              <div className="flex items-center justify-between">
                <span className="font-bold text-white flex items-center gap-1.5 font-heading">
                  <span>🏍️</span> Odômetro Inicial da Moto (Opcional)
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] border-emerald-500/40 text-emerald-400 bg-emerald-950/20"
                >
                  Prioridade 1
                </Badge>
              </div>
              <p className="text-[11px] text-slate-400">
                Se desejar, anote o odômetro e fotografe o painel da moto antes de sair da base. Não
                bloqueia o início da rota.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">
                    KM Inicial do Painel
                  </label>
                  <Input
                    type="number"
                    step="0.1"
                    placeholder="Ex: 12500.0"
                    value={odometroInicialInput}
                    onChange={(e) => setOdometroInicialInput(e.target.value)}
                    className="h-9 bg-[#070D1E] border-[#1E2B58] text-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1">
                    Foto do Painel (Opcional)
                  </label>
                  <label className="flex items-center justify-center h-9 px-3 rounded-lg border border-dashed border-[#1E2B58] bg-[#070D1E] hover:border-emerald-500/50 cursor-pointer text-slate-300 text-xs gap-1.5 truncate">
                    <Camera className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                    <span className="truncate">
                      {fotoOdometroInicial ? fotoOdometroInicial.name : 'Tirar Foto'}
                    </span>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={(e) => {
                        if (e.target.files && e.target.files[0]) {
                          setFotoOdometroInicial(e.target.files[0])
                        }
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>

            {/* Botão Principal Aceitar Rota */}
            <Button
              type="button"
              onClick={handleAcceptRoute}
              disabled={isStartingRoute}
              className="w-full h-14 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black text-sm uppercase tracking-wider rounded-2xl shadow-xl shadow-emerald-950/40 flex items-center justify-center gap-3 border border-emerald-400/40"
            >
              <Play className="h-5 w-5 fill-current" />
              {isStartingRoute ? 'Aceitando Rota...' : 'Aceitar Rota'}
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
                    <div>
                      <p className="font-medium text-white leading-relaxed">
                        {currentActiveDelivery.expand?.customer_id?.street
                          ? `${currentActiveDelivery.expand.customer_id.street}${currentActiveDelivery.expand.customer_id.complement ? `, ${currentActiveDelivery.expand.customer_id.complement}` : ''} - ${currentActiveDelivery.expand.customer_id.neighborhood || ''}, ${currentActiveDelivery.expand.customer_id.city || ''}`
                          : currentActiveDelivery.expand?.customer_id?.address ||
                            'Endereço a confirmar'}
                      </p>
                      {currentActiveDelivery.expand?.customer_id?.postal_code && (
                        <p className="text-[10px] font-mono text-slate-400 mt-0.5">
                          CEP: {currentActiveDelivery.expand.customer_id.postal_code}
                        </p>
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

                {/* BOTÕES DE AÇÃO: APENAS DUAS AÇÕES POR CLIENTE */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                  {/* Iniciar Entrega */}
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
                    className="h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 hover:from-emerald-600 hover:to-emerald-700 text-slate-950 font-black text-xs rounded-xl shadow-lg flex items-center justify-center gap-2 border border-emerald-400/40"
                  >
                    <CheckCircle className="h-4 w-4" />
                    <span>Concluir Entrega</span>
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
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-2 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#1E2B58]/50">
                          <span className="font-mono text-xs text-slate-400">
                            {order.tracking_code}
                          </span>
                          <Badge
                            variant="outline"
                            className="bg-[#0A1128] border-[#1E2B58] text-slate-400 text-[10px] flex items-center gap-1 font-semibold"
                          >
                            <Lock className="h-2.5 w-2.5" />
                            Aguardando
                          </Badge>
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

      {/* Link de ajuda no rodapé para o entregador resolver GPS sozinho a qualquer momento */}
      <div className="max-w-xl mx-auto w-full px-4 pt-1 pb-2 flex items-center justify-center">
        <button
          type="button"
          onClick={() => setIsIPhoneGuideOpen(true)}
          className="text-[11px] text-slate-400 hover:text-[#60A5FA] flex items-center gap-1.5 transition underline decoration-dotted"
        >
          <HelpCircle className="h-3.5 w-3.5" />
          <span>Problemas com GPS no iPhone? Veja como liberar</span>
        </button>
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

      {/* Modal de Conclusão com Foto e Assinatura (Fluxo de Comprovante) */}
      <DeliveryConfirmationModal
        order={selectedOrderForConfirmation}
        open={isConfirmModalOpen}
        onOpenChange={setIsConfirmModalOpen}
        onConfirmed={loadCourierOrders}
      />

      {/* Modal de Cancelamento de Entrega com os 4 Motivos Exatos */}
      <CancelDeliveryModal
        order={selectedOrderForCancel}
        open={isCancelModalOpen}
        onOpenChange={setIsCancelModalOpen}
        onCancelled={loadCourierOrders}
      />
    </div>
  )
}
