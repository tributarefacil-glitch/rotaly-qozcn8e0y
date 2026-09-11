import React, { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  Truck,
  MapPin,
  Clock,
  CheckCircle2,
  Package,
  Phone,
  ArrowLeft,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  Navigation,
  Compass,
  Star,
  MessageSquare,
  Check,
  HeartHandshake,
} from 'lucide-react'
import { LiveMap, type MapMarkerItem, type RouteGeometryItem } from '@/components/LiveMap'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import { fetchStreetRoute, distanceMeters, type LatLngPoint } from '@/services/osrmRoutingService'
import type { OrderRecord, LocationRecord, ReviewRecord } from '@/types/delivery'
import { RotalyLogo } from '@/components/RotalyLogo'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { toast } from 'sonner'

export default function PublicTrackingPage() {
  const { tracking_code } = useParams<{ tracking_code: string }>()
  const [order, setOrder] = useState<OrderRecord | null>(null)
  const [courierLocation, setCourierLocation] = useState<LocationRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

  // Rota pública otimizada e cálculo de ETA viária sequencial (+3 min por parada)
  const [publicRouteData, setPublicRouteData] = useState<{
    stops_before: { sequence: number; lat: number; lng: number }[]
    total_stops_before: number
    destination: { name: string; lat: number; lng: number; address: string } | null
  } | null>(null)

  const [realEtaMinutes, setRealEtaMinutes] = useState<number | null>(null)
  const [realDistanceKm, setRealDistanceKm] = useState<number | null>(null)
  const [estimatedArrivalDate, setEstimatedArrivalDate] = useState<Date | null>(null)
  const [calculatedRouteLines, setCalculatedRouteLines] = useState<RouteGeometryItem[]>([])

  // Review states (REQUISITO 4: Avaliação do entregador e vendedor)
  const [existingReview, setExistingReview] = useState<ReviewRecord | null>(null)
  const [courierRating, setCourierRating] = useState<number>(5)
  const [sellerRating, setSellerRating] = useState<number>(5)
  const [reviewComment, setReviewComment] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)
  const [hasSubmittedReview, setHasSubmittedReview] = useState(false)

  const loadOrder = async () => {
    if (!tracking_code) return
    setIsLoading(true)
    setErrorMsg(null)
    try {
      const [orderData, routeInfo] = await Promise.all([
        deliveryService.getOrderByTrackingCode(tracking_code),
        deliveryService.getPublicTrackingRoute(tracking_code),
      ])

      if (!orderData) {
        setErrorMsg('Código de rastreio não encontrado. Verifique o código e tente novamente.')
      } else {
        setOrder(orderData)
        if (routeInfo) {
          setPublicRouteData(routeInfo)
        }

        if (orderData.courier_id) {
          const loc = await deliveryService.getLatestLocationForCourier(orderData.courier_id)
          setCourierLocation(loc)
        }
        // Load existing review if available
        const rev = await deliveryService.getReviewByOrderId(orderData.id)
        if (rev) {
          setExistingReview(rev)
          setCourierRating(rev.courier_rating)
          setSellerRating(rev.seller_rating)
          setReviewComment(rev.comment || '')
          setHasSubmittedReview(true)
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
    } catch (err) {
      console.error('Review submit error:', err)
      toast.error('Erro ao registrar avaliação. Tente novamente.')
    } finally {
      setIsSubmittingReview(false)
    }
  }

  useEffect(() => {
    loadOrder()
  }, [tracking_code])

  // Realtime updates for order status and courier locations
  useRealtime<OrderRecord>('orders', (e) => {
    if (order && e.record.id === order.id) {
      setOrder((prev) => (prev ? { ...prev, ...e.record } : null))
    }
  })

  useRealtime<LocationRecord>('locations', (e) => {
    if (order?.courier_id && e.record.user_id === order.courier_id) {
      setCourierLocation(e.record)
    }
  })

  const customer = order?.expand?.customer_id
  const courier = order?.expand?.courier_id

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

  // Map markers: destination + courier current location
  const mapMarkers: MapMarkerItem[] = []

  if (customer && customer.lat && customer.lng) {
    mapMarkers.push({
      id: 'destination',
      title: `📍 ${customer.name || 'Endereço de Entrega (Destino)'}`,
      subtitle: customer.address,
      lat: customer.lat,
      lng: customer.lng,
      type: 'order_transit',
      customer_name: customer.name,
      customer_address: customer.address,
      delivery_sequence: order?.sequence,
      estimated_arrival: estimatedArrivalDate
        ? estimatedArrivalDate.toISOString()
        : order?.estimated_arrival,
      tracking_code: order?.tracking_code,
    })
  }

  if (courierLocation && courierLocation.lat && courierLocation.lng) {
    mapMarkers.push({
      id: `courier-${order?.courier_id || 'live'}`,
      title: `${courier?.name || 'Entregador em Rota'}`,
      subtitle: `Velocidade: ${courierLocation.speed ? Math.round(courierLocation.speed) : 28} km/h`,
      lat: courierLocation.lat,
      lng: courierLocation.lng,
      type: 'courier',
      courier_name: courier?.name,
      speed: courierLocation.speed ? Math.round(courierLocation.speed) : 28,
      vehicle_type: courier?.vehicle_type,
      location_timestamp: courierLocation.created,
      battery_level: (courierLocation as any).battery_level,
    })
  }

  // Previsão textual formatada
  const getEtaString = () => {
    if (order?.status === 'delivered') return 'Entregue com sucesso'
    if (order?.status === 'cancelled') return 'Pedido Cancelado'

    if (realEtaMinutes !== null) {
      const stopsCount = publicRouteData?.total_stops_before || 0
      const stopsText =
        stopsCount > 0
          ? ` (${stopsCount} ${stopsCount === 1 ? 'parada antes' : 'paradas antes'})`
          : ''
      const timeStr = estimatedArrivalDate
        ? estimatedArrivalDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : null

      if (timeStr) {
        return `~${timeStr} (faltam ~${realEtaMinutes} min${stopsText})`
      }
      return `~${realEtaMinutes} minutos${stopsText}`
    }

    if (order?.status === 'pending') return 'Aguardando despacho'
    return 'Calculando previsão viária...'
  }

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col justify-between font-sans">
      {/* Public Header */}
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between bg-[#0A1128] border-b border-[#1E2B58] text-white px-4 shadow-brand-dark sm:px-6">
        <Link to="/" className="flex items-center hover:opacity-95">
          <RotalyLogo size="md" theme="dark" showTagline={false} />
        </Link>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadOrder}
            className="text-xs text-white/80 hover:text-white hover:bg-white/10 rounded-input"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1 text-white" />
            Atualizar
          </Button>
          <Link to="/">
            <Button
              size="sm"
              variant="outline"
              className="text-xs border-white/20 bg-white/10 text-white hover:bg-white/20 rounded-input"
            >
              <ArrowLeft className="h-3.5 w-3.5 mr-1" />
              Início / Login
            </Button>
          </Link>
        </div>
      </header>

      {/* Tracking Content */}
      <main className="flex-1 max-w-4xl mx-auto w-full p-4 sm:p-6 space-y-6">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20 space-y-3">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            <p className="text-sm text-slate-400">Localizando encomenda e telemetria...</p>
          </div>
        ) : errorMsg || !order ? (
          <div className="rounded-2xl border border-rose-900/50 bg-rose-950/20 p-8 text-center space-y-4 max-w-md mx-auto">
            <AlertCircle className="h-12 w-12 text-rose-500 mx-auto" />
            <h2 className="text-lg font-bold text-white">Entrega Não Encontrada</h2>
            <p className="text-xs text-slate-400">{errorMsg}</p>
            <Link to="/">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white text-xs">
                Digitar outro código
              </Button>
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Status Summary Banner */}
            <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-6 shadow-brand-dark relative overflow-hidden text-white">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-[#60A5FA]">
                      {order.tracking_code}
                    </span>
                    <Badge
                      className={`text-xs font-bold ${
                        order.status === 'delivered'
                          ? 'bg-[#22C55E] text-slate-950'
                          : order.status === 'in_transit'
                            ? 'bg-[#FF6B35] text-white animate-pulse'
                            : 'bg-[#0052CC] text-white'
                      }`}
                    >
                      {order.status === 'delivered'
                        ? 'ENTREGUE'
                        : order.status === 'in_transit'
                          ? 'EM TRÂNSITO'
                          : 'PEDIDO CONFIRMADO'}
                    </Badge>
                  </div>
                  <h1 className="font-heading text-2xl font-black text-white mt-1">
                    {order.status === 'delivered'
                      ? 'Sua encomenda foi entregue!'
                      : order.status === 'in_transit'
                        ? 'O entregador está a caminho do seu endereço.'
                        : 'Seu pedido está sendo preparado para envio.'}
                  </h1>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-sans text-xs text-slate-300 mt-2">
                    <div className="flex items-center gap-1.5 bg-blue-950/60 border border-blue-500/30 px-2.5 py-1 rounded-lg">
                      <Clock className="h-3.5 w-3.5 text-blue-400" />
                      <span>Previsão de Chegada:</span>
                      <span className="font-bold text-[#60A5FA]">{getEtaString()}</span>
                    </div>

                    {realDistanceKm !== null &&
                      realDistanceKm > 0 &&
                      order.status !== 'delivered' && (
                        <div className="flex items-center gap-1.5 bg-slate-900/80 border border-slate-700/60 px-2.5 py-1 rounded-lg text-slate-300">
                          <Navigation className="h-3.5 w-3.5 text-[#FF6B35]" />
                          <span>Distância viária:</span>
                          <strong className="text-white">{realDistanceKm} km</strong>
                        </div>
                      )}
                  </div>
                </div>

                <div className="flex items-center gap-3 self-start sm:self-center p-3 rounded-xl bg-[#0A1128] border border-[#1E2B58] shadow-sm">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0052CC]/30 text-[#60A5FA] border border-[#60A5FA]/30">
                    <Truck className="h-5 w-5 text-[#FF6B35]" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400 font-sans">Entregador Responsável</p>
                    <p className="text-xs font-bold text-white font-heading">
                      {courier?.name || 'Equipe de Logística Rotaly'}
                    </p>
                    {courierLocation?.speed && (
                      <p className="text-[10px] text-purple-400 font-semibold flex items-center gap-1 mt-0.5">
                        <span>🚀</span> {Math.round(courierLocation.speed)} km/h em trânsito
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* VERTICAL / HORIZONTAL STEPPER TIMELINE */}
              <div className="mt-8 pt-6 border-t border-[#1E2B58] grid grid-cols-3 gap-2 relative">
                {/* Step 1 */}
                <div className="flex flex-col items-center text-center space-y-1.5 font-sans">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'pending' ||
                      order.status === 'in_transit' ||
                      order.status === 'delivered'
                        ? 'bg-[#0052CC] text-white shadow-sm border border-blue-400/40'
                        : 'bg-[#0A1128] text-slate-500 border border-[#1E2B58]'
                    }`}
                  >
                    <Package className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white font-heading">1. Confirmado</p>
                  <p className="text-[10px] text-slate-400">Pedido registrado</p>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col items-center text-center space-y-1.5 font-sans">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'in_transit' || order.status === 'delivered'
                        ? 'bg-[#FF6B35] text-white shadow-sm border border-orange-400/40'
                        : 'bg-[#0A1128] text-slate-500 border border-[#1E2B58]'
                    }`}
                  >
                    <Truck className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white font-heading">2. Em Rota</p>
                  <p className="text-[10px] text-slate-400">Despachado com GPS</p>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col items-center text-center space-y-1.5 font-sans">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'delivered'
                        ? 'bg-[#22C55E] text-slate-950 shadow-sm border border-emerald-400/40'
                        : 'bg-[#0A1128] text-slate-500 border border-[#1E2B58]'
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white font-heading">3. Entregue</p>
                  <p className="text-[10px] text-slate-400">Comprovante OK</p>
                </div>
              </div>
            </div>

            {/* Interactive Live Map (Courier position vs Destination) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <Compass className="h-4 w-4 text-blue-400" />
                  Mapa de Rastreamento em Tempo Real
                </h3>
                <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping"></span>
                  Sinal GPS ativo
                </span>
              </div>

              <LiveMap
                markers={mapMarkers}
                routeLines={calculatedRouteLines}
                center={
                  courierLocation?.lat && courierLocation?.lng
                    ? { lat: courierLocation.lat, lng: courierLocation.lng }
                    : customer?.lat && customer?.lng
                      ? { lat: customer.lat, lng: customer.lng }
                      : { lat: -22.906847, lng: -43.172896 }
                }
                zoom={14}
                height="420px"
              />
            </div>

            {/* Delivery Destination & Package Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-2 text-xs shadow-brand-dark">
                <div className="flex items-center justify-between">
                  <span className="font-heading font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                    Local de Entrega
                  </span>
                  {typeof order.sequence === 'number' && order.sequence > 0 && (
                    <Badge className="bg-orange-500/20 text-[#FF6B35] border border-orange-500/30 text-[10px] font-bold">
                      Parada #{order.sequence} da Rota
                    </Badge>
                  )}
                </div>
                <p className="text-sm font-semibold text-white">{customer?.name || 'Cliente'}</p>
                <p className="text-slate-300">{customer?.address}</p>
                {order.notes && (
                  <p className="text-[#FF6B35] text-[11px] pt-1">Nota: {order.notes}</p>
                )}
                {publicRouteData &&
                  publicRouteData.total_stops_before > 0 &&
                  order.status !== 'delivered' && (
                    <div className="mt-2 pt-2 border-t border-[#1E2B58] text-[11px] text-amber-300/90 flex items-center gap-1.5">
                      <span>ℹ️</span>
                      <span>
                        Há{' '}
                        <strong>
                          {publicRouteData.total_stops_before}{' '}
                          {publicRouteData.total_stops_before === 1
                            ? 'entrega anterior'
                            : 'entregas anteriores'}
                        </strong>{' '}
                        nesta rota (+3 min por parada já inclusos na previsão).
                      </span>
                    </div>
                  )}
              </div>

              <div className="rounded-2xl border border-[#1E2B58] bg-[#0E1738] p-4 space-y-2 text-xs shadow-brand-dark">
                <span className="font-heading font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                  Resumo do Pedido
                </span>
                <p className="text-slate-300">
                  Data: {new Date(order.created).toLocaleDateString('pt-BR')} às{' '}
                  {new Date(order.created).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-sm font-bold text-[#22C55E] font-heading">
                  Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
                </p>
                {realEtaMinutes !== null && order.status !== 'delivered' && (
                  <p className="text-xs text-sky-400 pt-1 font-sans">
                    ⏱️ Estimativa viária real: <strong>~{realEtaMinutes} min</strong> para chegada
                  </p>
                )}
              </div>
            </div>
            {/* REQUISITO 4: SEÇÃO DE AVALIAÇÃO DO CLIENTE (Entregador & Vendedor) */}
            {order.status === 'delivered' && (
              <div className="rounded-card border border-orange-200 bg-orange-50/40 p-6 shadow-brand space-y-5">
                <div className="flex items-center gap-3 border-b border-orange-100 pb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-card bg-[#FF6B35] text-white shadow-brand">
                    <HeartHandshake className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="font-heading text-base font-bold text-[#1a1a1a] flex items-center gap-2">
                      Avalie sua Experiência de Entrega Rotaly
                      <Badge className="bg-orange-100 text-[#FF6B35] border-orange-200 text-[10px] font-bold">
                        Feedback do Cliente
                      </Badge>
                    </h3>
                    <p className="font-sans text-xs text-slate-600">
                      Sua opinião nos ajuda a melhorar a agilidade e atendimento da nossa equipe.
                    </p>
                  </div>
                </div>

                {hasSubmittedReview || existingReview ? (
                  <div className="p-4 rounded-card bg-emerald-50 border border-emerald-200 text-[#00AA44] text-xs space-y-2 text-center">
                    <div className="flex justify-center">
                      <div className="h-10 w-10 rounded-full bg-[#00AA44] text-white flex items-center justify-center font-bold">
                        <Check className="h-6 w-6" />
                      </div>
                    </div>
                    <h4 className="font-heading font-bold text-sm text-[#1a1a1a]">
                      Avaliação Registrada!
                    </h4>
                    <p className="text-slate-700 font-sans">
                      Você avaliou o entregador com{' '}
                      <strong>{existingReview?.courier_rating || courierRating} estrelas</strong> e
                      o vendedor/atendimento com{' '}
                      <strong>{existingReview?.seller_rating || sellerRating} estrelas</strong>.
                    </p>
                    {existingReview?.comment && (
                      <p className="italic text-slate-500 text-[11px] pt-1 font-sans">
                        &ldquo;{existingReview.comment}&rdquo;
                      </p>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReview} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Avaliação do Entregador */}
                      <div className="p-4 rounded-card bg-white border border-slate-200 space-y-2 shadow-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-heading text-xs font-bold text-[#1a1a1a] flex items-center gap-1.5">
                            <Truck className="h-4 w-4 text-[#FF6B35]" />
                            Avaliar Entregador
                          </span>
                          <span className="text-xs font-bold text-[#FF6B35]">
                            {courierRating} / 5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-sans">
                          {courier?.name
                            ? `Como foi o atendimento de ${courier.name}?`
                            : 'Pontualidade e cuidado com a entrega'}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setCourierRating(star)}
                              className="focus:outline-none transition-transform hover:scale-125"
                            >
                              <Star
                                className={`h-7 w-7 ${
                                  star <= courierRating
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Avaliação do Vendedor / Loja */}
                      <div className="p-4 rounded-card bg-white border border-slate-200 space-y-2 shadow-xs">
                        <div className="flex items-center justify-between">
                          <span className="font-heading text-xs font-bold text-[#1a1a1a] flex items-center gap-1.5">
                            <Package className="h-4 w-4 text-[#0052CC]" />
                            Avaliar Vendedor & Loja
                          </span>
                          <span className="text-xs font-bold text-[#0052CC]">
                            {sellerRating} / 5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 font-sans">
                          {order.expand?.seller_id?.name
                            ? `Como foi a experiência com ${order.expand.seller_id.name}?`
                            : 'Agilidade de despacho e qualidade do produto'}
                        </p>
                        <div className="flex items-center gap-2 pt-1">
                          {[1, 2, 3, 4, 5].map((star) => (
                            <button
                              key={star}
                              type="button"
                              onClick={() => setSellerRating(star)}
                              className="focus:outline-none transition-transform hover:scale-125"
                            >
                              <Star
                                className={`h-7 w-7 ${
                                  star <= sellerRating
                                    ? 'fill-amber-400 text-amber-400'
                                    : 'text-slate-300'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Comentário Opcional */}
                    <div className="space-y-1.5 font-sans">
                      <label className="text-xs font-semibold text-slate-700 flex items-center gap-1 font-heading">
                        <MessageSquare className="h-3.5 w-3.5 text-[#0052CC]" />
                        Deixe um elogio ou observação (opcional)
                      </label>
                      <Textarea
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Ex: Entrega super rápida, entregador muito educado e atencioso!"
                        className="bg-[#F5F5F5] border-slate-200 text-xs text-[#1a1a1a] focus:bg-white resize-none rounded-input"
                        rows={2}
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={isSubmittingReview}
                        className="bg-[#FF6B35] hover:bg-[#E5531E] text-white font-black text-xs h-10 px-6 rounded-input shadow-brand"
                      >
                        {isSubmittingReview ? 'Enviando...' : 'Enviar Avaliação da Entrega'}
                      </Button>
                    </div>
                  </form>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-[#1E2B58] bg-[#0A1128] py-4 px-6 text-center text-xs text-slate-400 font-sans">
        <p>Rotaly — Entrega rápida, confiança garantida • Rastreio em Tempo Real</p>
      </footer>
    </div>
  )
}
