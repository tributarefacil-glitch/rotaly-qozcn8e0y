import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import {
  Truck,
  MapPin,
  Clock,
  Package,
  ArrowLeft,
  RefreshCw,
  AlertCircle,
  Star,
  MessageSquare,
  Check,
  ChevronDown,
  ChevronUp,
  Headphones,
  Share2,
  ThumbsUp,
  Crosshair,
  Store,
  ExternalLink,
} from 'lucide-react'
import { LiveMap, type MapMarkerItem, type RouteGeometryItem } from '@/components/LiveMap'
import { getCourierRouteColor } from '@/lib/courierRouteColors'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import { fetchStreetRoute, distanceMeters, type LatLngPoint } from '@/services/osrmRoutingService'
import type { OrderRecord, LocationRecord, ReviewRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { toast } from 'sonner'
import { APP_VERSION_LABEL } from '@/lib/version'

export default function PublicTrackingPage() {
  const { tracking_code: rawTrackingCode } = useParams<{ tracking_code: string }>()
  const navigate = useNavigate()

  // Extração resiliente do código de rastreamento (suporta useParams e window.location se montado por fallback)
  const resolvedTrackingCode = useMemo(() => {
    if (rawTrackingCode && rawTrackingCode.trim()) {
      return rawTrackingCode.trim()
    }
    if (typeof window !== 'undefined') {
      const pathname = window.location.pathname
      const match = pathname.match(/\/track\/([^/?#]+)/i)
      if (match && match[1]) {
        return decodeURIComponent(match[1]).trim()
      }
    }
    return ''
  }, [rawTrackingCode])

  const [order, setOrder] = useState<OrderRecord | null>(null)
  const [courierLocation, setCourierLocation] = useState<LocationRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Rota pública otimizada e cálculo de ETA viária sequencial (+3 min por parada)
  const [publicRouteData, setPublicRouteData] = useState<{
    order_id: string
    tracking_code: string
    status: string
    sequence: number
    courier_id: string | null
    courier_first_name: string | null
    route_released: boolean
    route_started: boolean
    route_finished: boolean
    estimated_arrival: string
    destination: { name: string; lat: number; lng: number; address: string } | null
    courier_location: {
      lat: number
      lng: number
      speed: number
      created: string
      age_seconds: number
    } | null
    is_gps_active: boolean
    stops_before: { sequence: number; lat: number; lng: number }[]
    total_stops_before: number
    completed_stops_before: number
    queue_position: number
    total_deliveries_in_batch: number
  } | null>(null)

  const [realEtaMinutes, setRealEtaMinutes] = useState<number | null>(null)
  const [realDistanceKm, setRealDistanceKm] = useState<number | null>(null)
  const [estimatedArrivalDate, setEstimatedArrivalDate] = useState<Date | null>(null)
  const [calculatedRouteLines, setCalculatedRouteLines] = useState<RouteGeometryItem[]>([])

  // Expansão do "Detalhe do envio"
  const [isDetailsOpen, setIsDetailsOpen] = useState(false)

  // Modais dos botões inferiores e suporte
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false)

  // Review states (Reutilizando a avaliação existente)
  const [existingReview, setExistingReview] = useState<ReviewRecord | null>(null)
  const [courierRating, setCourierRating] = useState<number>(5)
  const [sellerRating, setSellerRating] = useState<number>(5)
  const [reviewComment, setReviewComment] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [hasSubmittedReview, setHasSubmittedReview] = useState(false)

  // Referência da instância do mapa para recentralização suave
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMapInstanceRef = useRef<any>(null)
  const [recenterCount, setRecenterCount] = useState(0)

  const loadOrder = async () => {
    if (!resolvedTrackingCode) {
      setIsLoading(false)
      setErrorMsg('Código de rastreamento não informado na URL. Verifique o link fornecido.')
      return
    }
    setIsLoading(true)
    setErrorMsg(null)
    try {
      // Executa as consultas com tolerância a falhas individuais
      const [orderResult, routeResult] = await Promise.allSettled([
        deliveryService.getOrderByTrackingCode(resolvedTrackingCode),
        deliveryService.getPublicTrackingRoute(resolvedTrackingCode),
      ])

      const orderData = orderResult.status === 'fulfilled' ? orderResult.value : null
      const routeInfo = routeResult.status === 'fulfilled' ? routeResult.value : null

      if (!orderData) {
        setErrorMsg(
          `Código de rastreio "${resolvedTrackingCode}" não foi localizado em nossa base de dados. Verifique se digitou corretamente ou solicite um novo link ao remetente.`,
        )
      } else {
        setOrder(orderData)
        if (routeInfo) {
          setPublicRouteData(routeInfo)
        }

        // Carrega localização apenas se rota ativa (in_transit e NÃO delivered/cancelled)
        if (orderData.status === 'delivered' || orderData.status === 'cancelled') {
          setCourierLocation(null)
        } else if (routeInfo?.courier_location && routeInfo.is_gps_active) {
          setCourierLocation({
            id: 'hook_loc',
            collectionId: 'locations',
            collectionName: 'locations',
            created: routeInfo.courier_location.created,
            updated: routeInfo.courier_location.created,
            user_id: routeInfo.courier_id || orderData.courier_id || '',
            lat: routeInfo.courier_location.lat,
            lng: routeInfo.courier_location.lng,
            speed: routeInfo.courier_location.speed,
            heading: 90,
            accuracy: 10,
            gps_status: 'active',
          } as LocationRecord)
        } else if (orderData.courier_id && orderData.status === 'in_transit') {
          try {
            const loc = await deliveryService.getLatestLocationForCourier(orderData.courier_id)
            if (loc) {
              const locAgeMs = Date.now() - new Date(loc.created).getTime()
              if (locAgeMs <= 15 * 60 * 1000) {
                setCourierLocation(loc)
              } else {
                setCourierLocation(null)
              }
            }
          } catch (locErr) {
            console.warn('Não foi possível obter localização do entregador:', locErr)
          }
        } else {
          setCourierLocation(null)
        }

        // Carrega review existente se já houver
        try {
          const rev = await deliveryService.getReviewByOrderId(orderData.id)
          if (rev) {
            setExistingReview(rev)
            setCourierRating(rev.courier_rating)
            setSellerRating(rev.seller_rating)
            setReviewComment(rev.comment || '')
            setHasSubmittedReview(true)
          }
        } catch (revErr) {
          console.warn('Não foi possível verificar avaliações anteriores:', revErr)
        }
      }
    } catch (err) {
      console.error('Tracking fetch error:', err)
      setErrorMsg('Não foi possível carregar as informações deste rastreamento.')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmitReview = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!order) return
    setIsSubmittingReview(true)
    try {
      const rev = await deliveryService.createReview({
        order_id: order.id,
        courier_id: order.courier_id || undefined,
        seller_id: order.seller_id || undefined,
        courier_rating: courierRating,
        seller_rating: sellerRating,
        comment: reviewComment.trim(),
        customer_name: order.expand?.customer_id?.name || 'Cliente',
      })
      setExistingReview(rev)
      setHasSubmittedReview(true)
      toast.success('🎉 Avaliação enviada com sucesso! Muito obrigado pelo seu feedback.')
      setIsReviewModalOpen(false)
    } catch (err) {
      console.error('Review submit error:', err)
      toast.error('Erro ao registrar avaliação. Tente novamente.')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  useEffect(() => {
    loadOrder()
  }, [resolvedTrackingCode])

  // Recarrega periodicamente a cada ~30s para atualizar o marcador ao vivo e status de rota
  useEffect(() => {
    if (!resolvedTrackingCode) return
    const interval = setInterval(() => {
      // Recarrega dados públicos
      deliveryService
        .getPublicTrackingRoute(resolvedTrackingCode)
        .then((routeInfo) => {
          if (!routeInfo) return
          setPublicRouteData(routeInfo)
          if (
            routeInfo.status === 'delivered' ||
            routeInfo.status === 'cancelled' ||
            !routeInfo.is_gps_active
          ) {
            setCourierLocation(null)
          } else if (routeInfo.courier_location) {
            setCourierLocation({
              id: 'hook_loc',
              collectionId: 'locations',
              collectionName: 'locations',
              created: routeInfo.courier_location.created,
              updated: routeInfo.courier_location.created,
              user_id: routeInfo.courier_id || '',
              lat: routeInfo.courier_location.lat,
              lng: routeInfo.courier_location.lng,
              speed: routeInfo.courier_location.speed,
              heading: 90,
              accuracy: 10,
              gps_status: 'active',
            } as LocationRecord)
          }
        })
        .catch(() => {})
    }, 30000)

    return () => clearInterval(interval)
  }, [resolvedTrackingCode])

  // Realtime updates for order status and courier locations
  useRealtime<OrderRecord>('orders', (e) => {
    if (
      (order && e.record.id === order.id) ||
      (resolvedTrackingCode &&
        e.record.tracking_code &&
        e.record.tracking_code.toUpperCase() === resolvedTrackingCode.toUpperCase())
    ) {
      setOrder((prev) => (prev ? { ...prev, ...e.record } : (e.record as any)))
      if (e.record.status === 'delivered' || e.record.status === 'cancelled') {
        setCourierLocation(null)
      } else if (
        e.record.courier_id &&
        (!courierLocation || courierLocation.user_id !== e.record.courier_id)
      ) {
        deliveryService
          .getLatestLocationForCourier(e.record.courier_id)
          .then((loc) => {
            if (loc) {
              const locAgeMs = Date.now() - new Date(loc.created).getTime()
              if (locAgeMs <= 15 * 60 * 1000) {
                setCourierLocation(loc)
              } else {
                setCourierLocation(null)
              }
            }
          })
          .catch(() => {})
      }
    }
  })

  useRealtime<LocationRecord>('locations', (e) => {
    if (order?.status !== 'in_transit' || order?.route_finished) {
      setCourierLocation(null)
      return
    }
    if (order?.courier_id && e.record.user_id === order.courier_id) {
      const locAgeMs = Date.now() - new Date(e.record.created).getTime()
      if (locAgeMs <= 15 * 60 * 1000) {
        setCourierLocation(e.record)
      } else {
        setCourierLocation(null)
      }
    }
  })

  const customer = order?.expand?.customer_id
  const courier = order?.expand?.courier_id
  const seller = order?.expand?.seller_id

  // Primeiro nome seguro do entregador (item 1: expor SOMENTE primeiro nome)
  const courierSafeFirstName = useMemo(() => {
    if (order?.status === 'delivered' || order?.status === 'cancelled') return null
    if (publicRouteData?.courier_first_name) return publicRouteData.courier_first_name
    if (courier?.name) return courier.name.trim().split(/\s+/)[0]
    return null
  }, [publicRouteData?.courier_first_name, courier?.name, order?.status])

  // Verificação de GPS fresco < 15min
  const isCourierGpsFresh = useMemo(() => {
    if (!courierLocation?.created) return false
    if (order?.status !== 'in_transit' || order?.route_finished) return false
    const locTime = new Date(courierLocation.created).getTime()
    return Date.now() - locTime <= 15 * 60 * 1000
  }, [courierLocation?.created, order?.status, order?.route_finished])

  // Recalcular ETA viária real sequencial (+ 3 min por parada anterior)
  useEffect(() => {
    let isCancelled = false

    const calculateRealSequentialEta = async () => {
      if (!order) return

      // Se a entrega já foi finalizada ou cancelada
      if (order.status === 'delivered') {
        setRealEtaMinutes(0)
        setRealDistanceKm(0)
        setCalculatedRouteLines([])
        return
      }

      const destLat = customer?.lat || publicRouteData?.destination?.lat
      const destLng = customer?.lng || publicRouteData?.destination?.lng

      if (!destLat || !destLng) return

      const destinationPoint: LatLngPoint = { lat: destLat, lng: destLng }

      // Se não houver entregador ou localização GPS ainda
      if (!courierLocation?.lat || !courierLocation?.lng) {
        if (order.estimated_arrival) {
          const diffMs = new Date(order.estimated_arrival).getTime() - Date.now()
          const diffMins = Math.max(5, Math.round(diffMs / 60000))
          setRealEtaMinutes(diffMins)
          setEstimatedArrivalDate(new Date(order.estimated_arrival))
        }
        return
      }

      const courierPos: LatLngPoint = {
        lat: courierLocation.lat,
        lng: courierLocation.lng,
      }

      // Paradas anteriores da ordem de otimização
      const stopsBefore = publicRouteData?.stops_before || []
      const stopsCount = stopsBefore.length
      const EXTRA_WAIT_PER_STOP_MINUTES = 3 // 3 minutos de espera em cada entrega da rota

      // Sequência de waypoints: Courier -> Stop 1 -> Stop 2 -> ... -> Destino Final
      const waypoints: LatLngPoint[] = [
        courierPos,
        ...stopsBefore.map((s) => ({ lat: s.lat, lng: s.lng })),
        destinationPoint,
      ]

      let totalDurationSeconds = 0
      let totalDistanceMeters = 0
      const routeLineSegments: RouteGeometryItem[] = []

      const activeCourierId = order?.courier_id || courier?.id
      const isRouteActive = order?.status === 'in_transit' && !!courierLocation?.lat
      const courierColorTheme =
        isRouteActive && activeCourierId ? getCourierRouteColor(activeCourierId) : null

      for (let i = 0; i < waypoints.length - 1; i++) {
        const fromPoint = waypoints[i]
        const toPoint = waypoints[i + 1]

        try {
          const leg = await fetchStreetRoute(fromPoint, toPoint)
          if (isCancelled) return

          totalDurationSeconds += leg.durationSeconds || 0
          totalDistanceMeters += leg.distanceMeters || distanceMeters(fromPoint, toPoint)

          routeLineSegments.push({
            origin: fromPoint,
            destination: toPoint,
            streetCoordinates: leg.coordinates,
            strokeColor: courierColorTheme?.stroke,
            innerColor: courierColorTheme?.inner,
            courierId: activeCourierId,
          })
        } catch (err) {
          // Fallback por distância em linha reta caso serviço viário falhe
          const dMeters = distanceMeters(fromPoint, toPoint)
          totalDistanceMeters += dMeters
          // Velocidade média urbana de ~25 km/h (~6.94 m/s)
          totalDurationSeconds += dMeters / 6.94

          routeLineSegments.push({
            origin: fromPoint,
            destination: toPoint,
            streetCoordinates: [fromPoint, toPoint],
            strokeColor: courierColorTheme?.stroke,
            innerColor: courierColorTheme?.inner,
            courierId: activeCourierId,
          })
        }
      }

      if (isCancelled) return

      // Tempo de trânsito em minutos
      const travelMinutes = Math.round(totalDurationSeconds / 60)
      // Acréscimo estrito de 3 minutos de espera/parada por cada entrega anterior da rota
      const stopsWaitingMinutes = stopsCount * EXTRA_WAIT_PER_STOP_MINUTES
      const finalEtaMinutes = Math.max(1, travelMinutes + stopsWaitingMinutes)

      const arrivalTime = new Date(Date.now() + finalEtaMinutes * 60000)

      setRealEtaMinutes(finalEtaMinutes)
      setRealDistanceKm(Number((totalDistanceMeters / 1000).toFixed(1)))
      setEstimatedArrivalDate(arrivalTime)
      setCalculatedRouteLines(routeLineSegments)
    }

    calculateRealSequentialEta()

    return () => {
      isCancelled = true
    }
  }, [
    order?.status,
    order?.sequence,
    customer?.lat,
    customer?.lng,
    courierLocation?.lat,
    courierLocation?.lng,
    publicRouteData,
  ])

  // Map markers: destination + marcador ao vivo do entregador SOMENTE se <15min e rota ativa
  const mapMarkers: MapMarkerItem[] = useMemo(() => {
    const list: MapMarkerItem[] = []

    const activeCourierId = order?.courier_id || courier?.id
    const isRouteActive =
      order?.status === 'in_transit' &&
      !order?.route_finished &&
      isCourierGpsFresh &&
      !!courierLocation?.lat
    const courierColorTheme =
      isRouteActive && activeCourierId ? getCourierRouteColor(activeCourierId) : null

    const destLat = customer?.lat || publicRouteData?.destination?.lat
    const destLng = customer?.lng || publicRouteData?.destination?.lng
    const destAddress = customer?.address || publicRouteData?.destination?.address || ''
    const destName = customer?.name || publicRouteData?.destination?.name || 'Endereço de Entrega'

    if (destLat && destLng) {
      list.push({
        id: 'destination',
        title: `📍 ${destName}`,
        subtitle: destAddress,
        lat: destLat,
        lng: destLng,
        type: 'order_transit',
        customer_name: destName,
        customer_address: destAddress,
        delivery_sequence: order?.sequence,
        estimated_arrival: estimatedArrivalDate
          ? estimatedArrivalDate.toISOString()
          : order?.estimated_arrival,
        tracking_code: order?.tracking_code,
        pinColorOverride: courierColorTheme ? courierColorTheme.stroke : undefined,
      })
    }

    // Regra ITEM 1: marcador ao vivo do entregador SOMENTE se última posição < 15 min e rota em trânsito não finalizada
    if (isRouteActive && courierLocation && courierLocation.lat && courierLocation.lng) {
      const courierSpeed =
        typeof courierLocation.speed === 'number' && !isNaN(courierLocation.speed)
          ? Math.max(0, Math.round(courierLocation.speed))
          : 0
      list.push({
        id: `courier-${order?.courier_id || 'live'}`,
        title: courierSafeFirstName || 'Entregador em Rota',
        subtitle: `Velocidade: ${courierSpeed} km/h`,
        lat: courierLocation.lat,
        lng: courierLocation.lng,
        type: 'courier',
        courier_name: courierSafeFirstName || undefined,
        speed: courierSpeed,
        vehicle_type: courier?.vehicle_type,
        location_timestamp: courierLocation.created,
        battery_level: (courierLocation as any).battery_level,
      })
    }

    return list
  }, [
    customer,
    publicRouteData?.destination,
    courierLocation,
    order,
    courier,
    estimatedArrivalDate,
    isCourierGpsFresh,
    courierSafeFirstName,
  ])

  // Centro inicial do mapa (prioriza entregador, depois cliente, depois fallback)
  const mapCenter = useMemo(() => {
    if (courierLocation?.lat && courierLocation?.lng) {
      return { lat: courierLocation.lat, lng: courierLocation.lng }
    }
    if (customer?.lat && customer?.lng) {
      return { lat: customer.lat, lng: customer.lng }
    }
    return { lat: -22.906847, lng: -43.172896 }
  }, [courierLocation?.lat, courierLocation?.lng, customer?.lat, customer?.lng, recenterCount])

  // Função para recentralizar o mapa no entregador ou cliente
  const handleRecenter = () => {
    const target =
      courierLocation?.lat && courierLocation?.lng
        ? { lat: courierLocation.lat, lng: courierLocation.lng }
        : customer?.lat && customer?.lng
          ? { lat: customer.lat, lng: customer.lng }
          : null

    if (target && googleMapInstanceRef.current) {
      googleMapInstanceRef.current.panTo(target)
      googleMapInstanceRef.current.setZoom(15)
    }
    setRecenterCount((c) => c + 1)
    toast.info('Mapa centralizado na localização atual')
  }

  // Compartilhamento nativo com fallback para cópia
  const handleShare = async () => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const trackUrl = `${origin}/track/${resolvedTrackingCode}`
    const shareText = `Acompanhe minha entrega em tempo real pelo Rotaly: ${trackUrl}`

    if (navigator.share) {
      try {
        await navigator.share({
          title: `Rastreio do Pedido ${resolvedTrackingCode}`,
          text: shareText,
          url: trackUrl,
        })
        return
      } catch (e) {
        // Ignora cancelamento pelo usuário
      }
    }

    if (navigator.clipboard) {
      await navigator.clipboard.writeText(trackUrl)
      toast.success('Link de rastreio copiado!')
    } else {
      toast.info(`Link: ${trackUrl}`)
    }
  }

  // Determinar status amigável, título e subtítulo com base no print
  const statusInfo = useMemo(() => {
    if (!order) {
      return {
        type: 'pending' as const,
        chipLabel: 'Aguardando',
        chipClass: 'text-slate-600 bg-slate-100',
        dotColor: 'bg-slate-400',
        title: 'Preparando seu pedido',
        subtitle: 'Aguardando despacho pela loja.',
        stepperProgress: 0,
        isDelayed: false,
      }
    }

    if (order.status === 'delivered') {
      const deliveredTime = order.actual_arrival
        ? new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(order.actual_arrival))
        : new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(order.updated))
      return {
        type: 'delivered' as const,
        chipLabel: 'Entregue',
        chipClass: 'text-emerald-700 bg-emerald-50 border border-emerald-200',
        dotColor: 'bg-emerald-500',
        title: `Entregue hoje às ${deliveredTime}`,
        subtitle: 'Obrigado pela preferência! Sua encomenda foi concluída.',
        stepperProgress: 2, // Fim da linha do tempo
        isDelayed: false,
      }
    }

    if (order.status === 'cancelled') {
      return {
        type: 'cancelled' as const,
        chipLabel: 'Cancelado',
        chipClass: 'text-rose-700 bg-rose-50 border border-rose-200',
        dotColor: 'bg-rose-500',
        title: 'Pedido cancelado',
        subtitle: order.notes || 'Entre em contato com a loja para mais informações.',
        stepperProgress: 0,
        isDelayed: false,
      }
    }

    // Se a previsão original já passou (Atrasado - espelhando o print de referência)
    const isPastOriginalEstimate =
      order.estimated_arrival && new Date(order.estimated_arrival).getTime() < Date.now()

    if (isPastOriginalEstimate) {
      return {
        type: 'delayed' as const,
        chipLabel: 'Atrasado',
        chipClass: 'text-[#E5531E] bg-orange-50 border border-orange-200/80',
        dotColor: 'bg-[#FF6B35]',
        title: 'Chegará hoje antes das 23 h.\nDesculpe pelo atraso',
        subtitle: 'Sua compra ainda está a caminho. Se quiser, você pode receber na segunda-feira.',
        stepperProgress: 1, // No meio da linha do tempo com o caminhão
        isDelayed: true,
      }
    }

    // Em trânsito normal dentro do prazo
    if (order.status === 'in_transit') {
      // Se a rota foi encerrada ou sem GPS >15min
      if (order.route_finished || !isCourierGpsFresh) {
        return {
          type: 'confirmed' as const,
          chipLabel: 'Em preparação',
          chipClass: 'text-slate-700 bg-slate-100 border border-slate-200',
          dotColor: 'bg-slate-400',
          title: 'Preparando sua entrega',
          subtitle:
            'Seu pacote está sob os cuidados da nossa equipe e em breve o sinal em tempo real estará disponível.',
          stepperProgress: 0,
          isDelayed: false,
        }
      }

      const timeStr = estimatedArrivalDate
        ? new Intl.DateTimeFormat('pt-BR', {
            timeZone: 'America/Sao_Paulo',
            hour: '2-digit',
            minute: '2-digit',
          }).format(estimatedArrivalDate)
        : null

      const title = timeStr
        ? `Seu pedido chega por volta das ${timeStr}`
        : 'Seu pedido está a caminho'

      const courierDesc = courierSafeFirstName ? `${courierSafeFirstName}` : 'Seu entregador'
      const subtitle =
        realDistanceKm !== null && realEtaMinutes !== null
          ? `${courierDesc} está a ${realDistanceKm} km de você — chega em ~${realEtaMinutes} min`
          : `${courierDesc} está a caminho com rastreamento ativo em tempo real.`

      return {
        type: 'in_transit' as const,
        chipLabel: 'A caminho',
        chipClass: 'text-sky-700 bg-sky-50 border border-sky-200/80',
        dotColor: 'bg-sky-500',
        title,
        subtitle,
        stepperProgress: 1,
        isDelayed: false,
      }
    }

    // Confirmado / Pendente
    return {
      type: 'confirmed' as const,
      chipLabel: 'Confirmado',
      chipClass: 'text-slate-700 bg-slate-100 border border-slate-200',
      dotColor: 'bg-slate-400',
      title: 'Seu pedido foi confirmado',
      subtitle: 'A loja está separando os produtos para envio.',
      stepperProgress: 0,
      isDelayed: false,
    }
  }, [order, estimatedArrivalDate, realDistanceKm, realEtaMinutes])

  // Formatar endereço parcial (Rua + Bairro)
  const formattedAddress = useMemo(() => {
    if (!customer?.address) return 'Endereço cadastrado'
    const parts = customer.address.split(',')
    if (parts.length >= 2) {
      return `${parts[0].trim()}, ${parts[1].trim()}`
    }
    return customer.address
  }, [customer?.address])

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-slate-800 flex flex-col justify-center items-center font-sans">
      {/* Container responsivo: Mobile tela cheia, Desktop cartão estilo smartphone max-w-[440px] */}
      <div className="w-full max-w-[440px] min-h-screen sm:min-h-[844px] sm:my-6 sm:rounded-[36px] bg-white sm:shadow-2xl overflow-hidden flex flex-col relative sm:border sm:border-slate-200/80">
        {isLoading ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-4">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-sky-500 border-t-transparent" />
            <p className="text-sm font-medium text-slate-500">Localizando entrega...</p>
          </div>
        ) : errorMsg || !order ? (
          /* Card de erro/não encontrado mantendo fallback limpo */
          <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-5">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 border border-amber-200 text-amber-600">
              <AlertCircle className="h-8 w-8" />
            </div>
            <div className="space-y-2">
              <h2 className="text-xl font-bold font-heading text-slate-900">
                Rastreamento Não Encontrado
              </h2>
              <p className="text-xs text-slate-600 leading-relaxed max-w-xs mx-auto">
                {errorMsg || 'Não foi possível encontrar as informações deste pedido.'}
              </p>
              {resolvedTrackingCode && (
                <div className="inline-block mt-2 px-3 py-1 rounded-md bg-slate-100 border border-slate-200 font-mono text-xs text-slate-700">
                  Código: {resolvedTrackingCode}
                </div>
              )}
            </div>
            <div className="flex flex-col w-full max-w-xs gap-2 pt-2">
              <Button
                onClick={loadOrder}
                className="w-full bg-[#0052CC] hover:bg-blue-600 text-white text-xs font-bold h-10 rounded-xl flex items-center justify-center gap-1.5 shadow-sm"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Tentar novamente
              </Button>
              <Link to="/">
                <Button
                  variant="outline"
                  className="w-full text-xs font-semibold h-10 rounded-xl border-slate-200 text-slate-700 hover:bg-slate-50"
                >
                  Ir para Início
                </Button>
              </Link>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col relative pb-20">
            {/* 1. MAPA NO TOPO (~55% da altura) com botões flutuantes */}
            <div className="relative w-full h-[360px] sm:h-[400px] shrink-0 bg-[#e5e3df]">
              <LiveMap
                markers={mapMarkers}
                routeLines={calculatedRouteLines}
                center={mapCenter}
                zoom={14}
                height="100%"
                showAccuracyCircle={true}
                accuracyRadiusMeters={85}
                onMapReady={(inst) => {
                  googleMapInstanceRef.current = inst
                }}
              />

              {/* Botão flutuante Voltar (‹) superior esquerdo */}
              <button
                type="button"
                onClick={() => {
                  if (window.history.length > 1) {
                    navigate(-1)
                  } else {
                    navigate('/')
                  }
                }}
                className="absolute top-4 left-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md backdrop-blur border border-slate-200/80 hover:bg-white active:scale-95 transition"
                aria-label="Voltar"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>

              {/* Botões flutuantes superiores direitos: Suporte 🎧 e Compartilhar 🔗 */}
              <div className="absolute top-4 right-4 z-20 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => setIsSupportModalOpen(true)}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md backdrop-blur border border-slate-200/80 hover:bg-white active:scale-95 transition"
                  aria-label="Suporte e ajuda"
                  title="Falar com o suporte"
                >
                  <Headphones className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md backdrop-blur border border-slate-200/80 hover:bg-white active:scale-95 transition"
                  aria-label="Compartilhar rastreio"
                  title="Compartilhar"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>

              {/* Botão flutuante inferior direito: Recentralizar (crosshair) */}
              <button
                type="button"
                onClick={handleRecenter}
                className="absolute bottom-6 right-4 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-slate-800 shadow-md backdrop-blur border border-slate-200/80 hover:bg-white active:scale-95 transition"
                aria-label="Recentralizar mapa"
                title="Recentralizar no entregador"
              >
                <Crosshair className="h-4 w-4 text-slate-600" />
              </button>
            </div>

            {/* 2. CARD DE STATUS SOBREPOSTO / INFERIOR (Branco, cantos arredondados, preenche o conteúdo) */}
            <div className="relative -mt-4 bg-white rounded-t-[28px] shadow-[0_-8px_30px_rgba(0,0,0,0.08)] px-5 pt-4 pb-6 space-y-4 z-10 border-t border-slate-100 flex-1">
              {/* Linha de pegada / indicador sutil */}
              <div className="w-10 h-1 bg-slate-200 rounded-full mx-auto -mt-1 mb-2" />

              {/* Chip de Status colorido com bolinha (ex: 🟠 Atrasado) */}
              <div className="flex items-center">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${statusInfo.chipClass}`}
                >
                  <span className={`h-2 w-2 rounded-full ${statusInfo.dotColor}`} />
                  {statusInfo.chipLabel}
                </span>
              </div>

              {/* Título grande em linguagem natural */}
              <div>
                <h1 className="text-[20px] font-bold text-slate-900 leading-tight whitespace-pre-line font-heading">
                  {statusInfo.title}
                </h1>
                <p className="text-xs text-slate-600 mt-1.5 leading-relaxed font-sans">
                  {statusInfo.subtitle}
                </p>
              </div>

              {/* ITEM 1: Card "Você é a Nª entrega (X já concluídas antes de você)" */}
              {order.status !== 'delivered' && order.status !== 'cancelled' && publicRouteData && (
                <div className="p-3.5 rounded-2xl bg-gradient-to-r from-sky-50 to-indigo-50/60 border border-sky-100 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-sky-600 text-white font-bold flex items-center justify-center shrink-0 shadow-sm">
                      #{publicRouteData.queue_position}
                    </div>
                    <div>
                      <p className="font-bold text-slate-900 text-xs">
                        Você é a {publicRouteData.queue_position}ª entrega da rota
                      </p>
                      <p className="text-[11px] text-slate-600 mt-0.5">
                        {publicRouteData.completed_stops_before > 0
                          ? `${publicRouteData.completed_stops_before} já concluída${publicRouteData.completed_stops_before > 1 ? 's' : ''} antes de você`
                          : 'Sua entrega é uma das primeiras do itinerário'}
                      </p>
                    </div>
                  </div>
                  {realDistanceKm !== null && isCourierGpsFresh && (
                    <div className="text-right shrink-0">
                      <span className="text-[10px] uppercase font-bold text-sky-700 block">
                        Distância
                      </span>
                      <span className="font-extrabold text-sm text-sky-900">
                        {realDistanceKm} km
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Linha do tempo horizontal (stepper): bolinha → linha → caminhão → linha → círculo */}
              <div className="pt-2 pb-1">
                <div className="relative flex items-center justify-between px-3">
                  {/* Linha base de fundo */}
                  <div className="absolute left-6 right-6 top-1/2 -translate-y-1/2 h-[3px] bg-slate-200" />

                  {/* Linha preenchida até o estágio ativo */}
                  <div
                    className="absolute left-6 top-1/2 -translate-y-1/2 h-[3px] bg-slate-900 transition-all duration-500"
                    style={{
                      width:
                        statusInfo.stepperProgress === 0
                          ? '0%'
                          : statusInfo.stepperProgress === 1
                            ? '50%'
                            : 'calc(100% - 24px)',
                    }}
                  />

                  {/* 1. Bolinha Confirmado */}
                  <div className="relative z-10 flex flex-col items-center">
                    <div
                      className={`h-3 w-3 rounded-full border-2 border-white shadow-sm ${
                        statusInfo.stepperProgress >= 0
                          ? 'bg-slate-900 ring-2 ring-slate-900/20'
                          : 'bg-slate-300'
                      }`}
                    />
                  </div>

                  {/* 2. Estágio intermediário: Caminhão no círculo escuro */}
                  <div className="relative z-10 flex flex-col items-center">
                    {statusInfo.stepperProgress >= 1 ? (
                      <div className="h-8 w-8 rounded-full bg-slate-950 text-white flex items-center justify-center shadow-md ring-4 ring-white">
                        <Truck className="h-4 w-4" />
                      </div>
                    ) : (
                      <div className="h-3 w-3 rounded-full bg-slate-300 border-2 border-white" />
                    )}
                  </div>

                  {/* 3. Círculo vazio de destino / Check se entregue */}
                  <div className="relative z-10 flex flex-col items-center">
                    {statusInfo.stepperProgress === 2 ? (
                      <div className="h-8 w-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-md ring-4 ring-white">
                        <Check className="h-4 w-4 stroke-[3]" />
                      </div>
                    ) : (
                      <div className="h-3 w-3 rounded-full border-2 border-slate-300 bg-white" />
                    )}
                  </div>
                </div>

                {/* Legendas curtas do stepper */}
                <div className="flex justify-between text-[11px] font-medium text-slate-500 pt-2 px-1">
                  <span>Confirmado</span>
                  <span
                    className={statusInfo.stepperProgress === 1 ? 'font-bold text-slate-900' : ''}
                  >
                    Saiu para entrega
                  </span>
                  <span
                    className={statusInfo.stepperProgress === 2 ? 'font-bold text-emerald-700' : ''}
                  >
                    Entregue
                  </span>
                </div>
              </div>

              {/* "Detalhe do envio ⌄" em azul, expansível */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsDetailsOpen((prev) => !prev)}
                  className="flex items-center gap-1 text-xs font-semibold text-[#0052CC] hover:text-blue-700 active:underline py-1"
                >
                  <span>Detalhe do envio</span>
                  {isDetailsOpen ? (
                    <ChevronUp className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                </button>

                {isDetailsOpen && (
                  <div className="mt-3 p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 text-xs animate-in fade-in-50 duration-200">
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Código de rastreio</span>
                      <span className="font-mono font-bold text-slate-900">
                        {order.tracking_code}
                      </span>
                    </div>

                    <div className="flex items-start justify-between pb-2 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Destinatário</span>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">
                          {customer?.name || 'Cliente'}
                        </p>
                        <p className="text-[11px] text-slate-600 max-w-[200px]">
                          {formattedAddress}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Entregador</span>
                      <span className="font-semibold text-slate-900">
                        {courierSafeFirstName || 'Equipe de Entregas'}
                      </span>
                    </div>

                    {/* Previsão dupla se houver */}
                    {estimatedArrivalDate && (
                      <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                        <span className="text-slate-500 font-medium">Previsão estimada</span>
                        <span className="font-bold text-[#0052CC]">
                          {new Intl.DateTimeFormat('pt-BR', {
                            timeZone: 'America/Sao_Paulo',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(estimatedArrivalDate)}
                          {realEtaMinutes !== null && ` (~${realEtaMinutes} min)`}
                        </span>
                      </div>
                    )}

                    {/* Resumo do pedido / valor */}
                    <div className="flex items-center justify-between pb-2 border-b border-slate-200/60">
                      <span className="text-slate-500 font-medium">Total do pedido</span>
                      <span className="font-bold text-slate-900">
                        R$ {Number(order.total_price || 0).toFixed(2)}
                      </span>
                    </div>

                    {/* Paradas anteriores na rota se aplicável */}
                    {publicRouteData &&
                      publicRouteData.total_stops_before > 0 &&
                      order.status !== 'delivered' && (
                        <div className="text-[11px] text-amber-700 bg-amber-50 p-2 rounded-lg border border-amber-200/70">
                          ℹ️ Há <strong>{publicRouteData.total_stops_before}</strong> entrega(s)
                          anterior(es) na rota. Tempo de parada já considerado no cálculo viário.
                        </div>
                      )}

                    {/* Botão Falar com a loja (WhatsApp) */}
                    {seller?.phone && (
                      <a
                        href={`https://wa.me/55${seller.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Gostaria de informações sobre meu pedido ${order.tracking_code}.`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-sm transition"
                      >
                        <Store className="h-3.5 w-3.5" />
                        Falar com a loja ({seller.name || 'Vendedor'})
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 3. BARRA INFERIOR DE AÇÕES (2 botões: Compartilhar e Opinar sobre) */}
            <div className="fixed sm:absolute bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-200/80 px-6 py-2.5 shadow-[0_-4px_20px_rgba(0,0,0,0.05)]">
              <div className="grid grid-cols-2 gap-4 max-w-[440px] mx-auto">
                {/* 1. Compartilhar */}
                <button
                  type="button"
                  onClick={handleShare}
                  className="flex flex-col items-center justify-center py-1 group"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E0EFFF] text-[#0052CC] group-hover:bg-[#D0E5FF] group-active:scale-95 transition">
                    <Share2 className="h-5 w-5" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-700 mt-1">Compartilhar</span>
                </button>

                {/* 2. Opinar sobre a entrega */}
                <button
                  type="button"
                  onClick={() => setIsReviewModalOpen(true)}
                  className="flex flex-col items-center justify-center py-1 group"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#E0EFFF] text-[#0052CC] group-hover:bg-[#D0E5FF] group-active:scale-95 transition">
                    <ThumbsUp className="h-5 w-5" />
                  </div>
                  <span className="text-[11px] font-medium text-slate-700 mt-1">Opinar sobre</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MODAL: OPINAR SOBRE A ENTREGA (AVALIAÇÃO EXISTENTE) */}
      <Dialog open={isReviewModalOpen} onOpenChange={setIsReviewModalOpen}>
        <DialogContent className="max-w-sm rounded-3xl p-5 bg-white text-slate-900 border-slate-200 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold font-heading flex items-center gap-2">
              <ThumbsUp className="h-4 w-4 text-[#0052CC]" />
              Opinar sobre a Entrega
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Sua opinião nos ajuda a aprimorar o atendimento e rapidez.
            </DialogDescription>
          </DialogHeader>

          {hasSubmittedReview || existingReview ? (
            <div className="py-4 space-y-3 text-center">
              <div className="h-12 w-12 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
                <Check className="h-6 w-6 stroke-[3]" />
              </div>
              <h4 className="font-bold text-sm text-slate-900">Avaliação Registrada!</h4>
              <p className="text-xs text-slate-600">
                Você avaliou o entregador com{' '}
                <strong>{existingReview?.courier_rating || courierRating} estrelas</strong> e a loja
                com <strong>{existingReview?.seller_rating || sellerRating} estrelas</strong>.
              </p>
              {existingReview?.comment && (
                <p className="text-xs italic text-slate-500 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                  &ldquo;{existingReview.comment}&rdquo;
                </p>
              )}
              <Button
                type="button"
                onClick={() => setIsReviewModalOpen(false)}
                className="w-full text-xs font-bold rounded-xl h-10 bg-slate-900 text-white"
              >
                Concluir
              </Button>
            </div>
          ) : (
            <form onSubmit={handleSubmitReview} className="space-y-4 py-1 text-xs">
              {/* Avaliar entregador */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Truck className="h-3.5 w-3.5 text-[#FF6B35]" />
                    {courier?.name ? `Entregador (${courier.name})` : 'Entregador'}
                  </span>
                  <span className="font-bold text-[#FF6B35]">{courierRating} / 5</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setCourierRating(star)}
                      className="focus:outline-none transition-transform hover:scale-125"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          star <= courierRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Avaliar loja */}
              <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5 text-[#0052CC]" />
                    {seller?.name ? `Loja (${seller.name})` : 'Vendedor & Loja'}
                  </span>
                  <span className="font-bold text-[#0052CC]">{sellerRating} / 5</span>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setSellerRating(star)}
                      className="focus:outline-none transition-transform hover:scale-125"
                    >
                      <Star
                        className={`h-6 w-6 ${
                          star <= sellerRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>

              {/* Comentário opcional */}
              <div className="space-y-1">
                <label className="text-xs font-semibold text-slate-700 flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5 text-slate-500" />
                  Elogio ou observação (opcional)
                </label>
                <Textarea
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  placeholder="Ex: Entrega super rápida, entregador muito educado!"
                  className="bg-slate-50 border-slate-200 text-xs text-slate-900 resize-none rounded-xl"
                  rows={2}
                />
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsReviewModalOpen(false)}
                  className="flex-1 text-xs rounded-xl h-10 border-slate-200"
                >
                  Cancelar
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmittingReview}
                  className="flex-1 text-xs font-bold rounded-xl h-10 bg-[#FF6B35] hover:bg-[#E5531E] text-white"
                >
                  {isSubmittingReview ? 'Enviando...' : 'Enviar Avaliação'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* MODAL 4: SUPORTE & AJUDA 🎧 */}
      <Dialog open={isSupportModalOpen} onOpenChange={setIsSupportModalOpen}>
        <DialogContent className="max-w-sm rounded-3xl p-5 bg-white text-slate-900 border-slate-200">
          <DialogHeader>
            <DialogTitle className="text-base font-bold font-heading flex items-center gap-2">
              <Headphones className="h-4 w-4 text-[#0052CC]" />
              Precisa de ajuda com sua entrega?
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500">
              Estamos disponíveis para tirar dúvidas e agilizar seu pedido.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2.5 py-2 text-xs">
            {seller?.phone ? (
              <a
                href={`https://wa.me/55${seller.phone.replace(/\D/g, '')}?text=${encodeURIComponent(`Olá! Preciso de ajuda com o rastreamento do pedido ${order.tracking_code}.`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full flex items-center justify-between p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 hover:bg-emerald-100 transition"
              >
                <div>
                  <p className="font-bold">Falar com a Loja no WhatsApp</p>
                  <p className="text-[11px] text-emerald-700 mt-0.5">
                    {seller.name || 'Atendimento'}
                  </p>
                </div>
                <ExternalLink className="h-4 w-4 text-emerald-600" />
              </a>
            ) : null}

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
              <p className="font-bold text-slate-900">Rastreamento Automatizado Rotaly</p>
              <p className="text-[11px] text-slate-600 leading-relaxed">
                A telemetria do veículo é atualizada automaticamente a cada sinal de GPS. Em caso de
                dúvidas, informe o código <strong>{order?.tracking_code}</strong>.
              </p>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <span className="font-mono text-[10px] text-slate-400">Rotaly {APP_VERSION_LABEL}</span>
            <Button
              type="button"
              onClick={() => setIsSupportModalOpen(false)}
              className="text-xs font-bold rounded-xl h-9 px-4 bg-slate-900 hover:bg-slate-800 text-white"
            >
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
