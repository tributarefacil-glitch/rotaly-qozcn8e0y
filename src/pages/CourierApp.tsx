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
import type { NotificationRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
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

  // Carrega apenas pedidos liberados pelo vendedor ("assigned" com route_released=true ou em rota)
  const loadCourierOrders = async () => {
    try {
      if (!user?.id) {
        setOrders([])
        return
      }
      // Regra: O cliente só fica disponível após o vendedor otimizar e liberar a rota (Salvar & Liberar Rota)
      const courierFilter = `courier_id = '${user.id}' && (route_released = true || status = 'in_transit' || status = 'delivered' || status = 'address_error' || status = 'client_absent')`
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
      loadCourierOrders()
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
        playOffRouteWarningSound()
        sendBrowserPushNotification(e.record.title, e.record.message)
        toast.error(e.record.title, {
          description: e.record.message,
          duration: 8000,
        })
      }
    }
  })

  // Captura do nível de bateria com fallback gracioso
  const getBatteryLevel = async (): Promise<number | null> => {
    try {
      const nav = typeof navigator !== 'undefined' ? (navigator as any) : null
      if (nav && typeof nav.getBattery === 'function') {
        const battery = await nav.getBattery()
        if (typeof battery?.level === 'number') {
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
  const activeStartedOrders = orders.filter(
    (o) =>
      o.route_started === true &&
      (o.route_finished === false || o.route_finished === null || o.route_finished === undefined),
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

    // Não há rota ativa iniciada: agrupar por lote de liberação/criação
    // Se há múltiplos lotes de rotas liberadas, a primeira rota (mais antiga) é a apresentada; as seguintes aguardam na fila
    const unstartedReleased = orders.filter(
      (o) =>
        (o.route_released === true || o.status === 'assigned') &&
        !o.route_started &&
        (o.status === 'assigned' || o.status === 'in_transit'),
    )

    if (unstartedReleased.length === 0) {
      return {
        currentRouteOrders: [],
        queuedOrders: [],
        activeDeliveries: [],
      }
    }

    // Agrupamento de rotas por data/horário aproximado de liberação ou sequência
    // Se todas têm a mesma liberação ou sem marcação, compõem a rota atual
    // Ordenar por data de liberação / criação
    const sorted = [...unstartedReleased].sort((a, b) => {
      const timeA = new Date(a.route_released_at || a.created || 0).getTime()
      const timeB = new Date(b.route_released_at || b.created || 0).getTime()
      return timeA - timeB
    })

    // Agrupamos na primeira rota os pedidos que pertencem ao mesmo lote (criados/liberados em janela próxima de 15 min)
    const firstTimestamp = new Date(sorted[0].route_released_at || sorted[0].created || 0).getTime()
    const currentBatch: OrderRecord[] = []
    const queuedBatch: OrderRecord[] = []

    for (const ord of sorted) {
      const ordTime = new Date(ord.route_released_at || ord.created || 0).getTime()
      if (Math.abs(ordTime - firstTimestamp) <= 15 * 60 * 1000) {
        currentBatch.push(ord)
      } else {
        queuedBatch.push(ord)
      }
    }

    const currentSorted = currentBatch.sort((a, b) => (a.sequence ?? 9999) - (b.sequence ?? 9999))

    return {
      currentRouteOrders: currentSorted,
      queuedOrders: queuedBatch,
      activeDeliveries: currentSorted,
    }
  }, [hasActiveStartedRoute, activeStartedOrders, orders])

  // Estado da rota: já foi aceita / iniciada pelo entregador?
  const isRouteStarted = hasActiveStartedRoute

  // Refs de controle para DEDUPE e LOCK contra concorrência no envio de GPS:
  // Só grava na coleção locations se passaram > 30s OU se moveu > 20 metros.
  const lastRecordedGpsRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null)
  const isSendingLocationRef = useRef<boolean>(false)
  const isFetchingPositionRef = useRef<boolean>(false)
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
      // Ao voltar online, disparar flush idempotente do buffer
      if (user?.id) {
        setIsFlushingBuffer(true)
        try {
          const res = await offlineTelemetryBuffer.flush(user.id)
          if (res.sent > 0) {
            toast.success(`📶 Conexão restabelecida! ${res.sent} pontos sincronizados com a Torre.`)
          }
        } catch (e) {
          console.warn('Falha ao flush do buffer offline:', e)
        } finally {
          setIsFlushingBuffer(false)
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

  // Telemetria GPS com dedupe, lock, buffer offline, timeout de ~20s, retry curto e reavaliação ao voltar
  useEffect(() => {
    if (!user || !isGpsActive) return

    let isEffectActive = true
    let nextScheduledTimer: any = null

    const clearScheduledTimer = () => {
      if (nextScheduledTimer) {
        clearTimeout(nextScheduledTimer)
        nextScheduledTimer = null
      }
    }

    const scheduleNextCheck = (delayMs: number) => {
      clearScheduledTimer()
      if (!isEffectActive) return
      nextScheduledTimer = setTimeout(() => {
        checkCurrentLocation(false)
      }, delayMs)
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

      if (last && !forceSend) {
        const timeDiffSeconds = (now - last.timestamp) / 1000
        const distanceDiffMeters = haversineDistanceMeters(last.lat, last.lng, lat, lng)

        // Só gravar se passaram > 30s do último envio OU moveu > 20 metros
        if (timeDiffSeconds < 30 && distanceDiffMeters < 20) {
          return
        }
      }

      isSendingLocationRef.current = true
      let batteryLevel = 90
      let speed = 0
      try {
        batteryLevel = await getBatteryLevel()
        if (typeof speedVal === 'number' && !isNaN(speedVal) && speedVal > 0) {
          speed = Math.round(speedVal * 3.6)
        } else if (last) {
          const timeDiffSeconds = (now - last.timestamp) / 1000
          const dist = haversineDistanceMeters(last.lat, last.lng, lat, lng)
          if (dist < 2) {
            speed = 0
          } else if (timeDiffSeconds > 0 && timeDiffSeconds < 120) {
            speed = Math.round((dist / timeDiffSeconds) * 3.6)
          }
        }

        // Tentar envio normal online
        await deliveryService.updateCourierLocation(user.id, lat, lng, speed, 90, batteryLevel, {
          gps_status: 'active',
          gps_reason: '',
          offline_buffered: false,
          accuracy: accuracyVal,
        })
        lastRecordedGpsRef.current = { lat, lng, timestamp: now }

        // Se houver pontos no buffer que aguardavam sinal, tenta flush agora que a rede respondeu
        if (offlineTelemetryBuffer.size(user.id) > 0 && !isFlushingBuffer) {
          offlineTelemetryBuffer.flush(user.id).catch(() => {})
        }
      } catch (e) {
        console.error('Failed to post live location (salvando no buffer offline se em rota):', e)
        if (hasActiveStartedRoute) {
          offlineTelemetryBuffer.enqueuePoint({
            userId: user.id,
            lat,
            lng,
            speed,
            heading: 90,
            accuracy: accuracyVal,
            batteryLevel,
            timestamp: now,
            reason: 'network_offline',
          })
        }
      } finally {
        isSendingLocationRef.current = false
      }
    }

    const checkCurrentLocation = (isImmediate = false) => {
      if (!isEffectActive) return

      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setGpsStatus('disabled')
        setGpsFailureDetail('unsupported')
        scheduleNextCheck(30000)
        return
      }

      // Evitar chamadas simultâneas de getCurrentPosition
      if (isFetchingPositionRef.current) return
      isFetchingPositionRef.current = true

      // Timeout aumentado para 20s (item 2: área urbana no iOS)
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          isFetchingPositionRef.current = false
          if (!isEffectActive) return
          processAndSendGps(
            pos.coords.latitude,
            pos.coords.longitude,
            pos.coords.speed,
            pos.coords.accuracy,
            isImmediate,
          )
          // Se deu certo, ciclo padrão de 30s
          scheduleNextCheck(30000)
        },
        async (err) => {
          isFetchingPositionRef.current = false
          if (!isEffectActive) return

          console.warn('Geolocation getCurrentPosition falhou com código:', err?.code, err?.message)

          // 1. DISTINGUIR O MOTIVO DA FALHA
          // Erro de permissão: code 1 / PERMISSION_DENIED
          if (err.code === err.PERMISSION_DENIED) {
            setGpsStatus('disabled')
            setGpsFailureDetail('permission_denied')
          } else if (err.code === err.TIMEOUT) {
            // Timeout: code 3 -> âmbar "Sinal GPS fraco — tentando novamente..."
            setGpsStatus('offline')
            setGpsFailureDetail('weak_signal')
          } else if (err.code === err.POSITION_UNAVAILABLE) {
            // Posição indisponível temporária: code 2 -> âmbar
            setGpsStatus('offline')
            setGpsFailureDetail('position_unavailable')
          } else {
            setGpsStatus('offline')
            setGpsFailureDetail('weak_signal')
          }

          // Se estiver em rota ativa, notifica Torre com o status e gps_reason correspondente
          if (hasActiveStartedRoute) {
            const now = Date.now()
            const last = lastRecordedGpsRef.current
            const fallbackLat = last ? last.lat : currentCourierLocation?.lat || 0
            const fallbackLng = last ? last.lng : currentCourierLocation?.lng || 0

            const pbStatus: 'disabled' | 'offline' =
              err.code === err.PERMISSION_DENIED ? 'disabled' : 'offline'
            const pbReason =
              err.code === err.PERMISSION_DENIED ? 'permission_denied' : 'weak_signal'

            if (fallbackLat && fallbackLng) {
              try {
                const bLevel = await getBatteryLevel().catch(() => 90)
                await deliveryService.updateCourierLocation(
                  user.id,
                  fallbackLat,
                  fallbackLng,
                  0,
                  0,
                  bLevel,
                  {
                    gps_status: pbStatus,
                    gps_reason: pbReason,
                    offline_buffered: false,
                  },
                )
              } catch {
                offlineTelemetryBuffer.enqueuePoint({
                  userId: user.id,
                  lat: fallbackLat,
                  lng: fallbackLng,
                  speed: 0,
                  heading: 0,
                  accuracy: undefined,
                  batteryLevel: 90,
                  timestamp: now,
                  reason: pbReason as any,
                })
              }
            }
          }

          // Ciclo curto de retry: 12s se for timeout ou posição indisponível (tentar novamente sem spam)
          // Se for permissão negada, espera 20s para re-verificar caso o usuário tenha ido aos Ajustes
          const retryDelay = err.code === err.PERMISSION_DENIED ? 20000 : 12000
          scheduleNextCheck(retryDelay)
        },
        { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 },
      )
    }

    // Expor função de disparo imediato para listeners de visibilidade e botão de retry
    triggerImmediateGpsRef.current = () => {
      checkCurrentLocation(true)
    }

    // Disparo inicial
    checkCurrentLocation(false)

    // REAVALIAÇÃO QUANDO A TELA VOLTA (item 3: visibilitychange e pageshow)
    const handleResume = () => {
      // Se a aba/tela voltou a ficar visível
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }

      // Re-adquirir wakeLock se estiver em rota ativa
      if (hasActiveStartedRoute && typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        ;(navigator as any).wakeLock
          ?.request('screen')
          .then((sentinel: any) => {
            wakeLockSentinelRef.current = sentinel
            setIsWakeLockActive(true)
          })
          .catch(() => {})
      }

      toast.info('Retomando rastreamento após pausa...', {
        duration: 3000,
        id: 'gps-resuming-toast',
      })

      // Limpar timer que pode ter "derretido" ou ficado pendente e disparar leitura de GPS imediata
      clearScheduledTimer()
      checkCurrentLocation(true)
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
      clearScheduledTimer()
      triggerImmediateGpsRef.current = null
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
    }
  }, [user, isGpsActive, hasActiveStartedRoute, isFlushingBuffer, currentCourierLocation])

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
      await deliveryService.startCourierRoute(user.id, orderIdsToStart)
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
      await deliveryService.finishCourierRoute(user.id, orderIdsToFinish)
      toast.success(
        '🏁 Rota finalizada com sucesso na base! Odômetro oficial apurado e você já está liberado para receber uma nova rota.',
        {
          duration: 5000,
        },
      )
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
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col pb-24 md:pb-8 font-sans antialiased selection:bg-[#0052CC]/30">
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
              O km rodado do combustível continua acumulando via telemetria GPS até a sua chegada à
              base. No ponto de chegada na base, finalize a rota inteira abaixo para liberar o
              recebimento de uma nova rota.
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
