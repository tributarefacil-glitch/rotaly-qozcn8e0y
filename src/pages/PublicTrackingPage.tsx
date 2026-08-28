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
import { LiveMap, type MapMarkerItem } from '@/components/LiveMap'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import type { OrderRecord, LocationRecord, ReviewRecord } from '@/types/delivery'
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
      const orderData = await deliveryService.getOrderByTrackingCode(tracking_code)
      if (!orderData) {
        setErrorMsg('Código de rastreio não encontrado. Verifique o código e tente novamente.')
      } else {
        setOrder(orderData)
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

  // Map markers: destination + courier current location
  const mapMarkers: MapMarkerItem[] = []
  const customer = order?.expand?.customer_id
  const courier = order?.expand?.courier_id

  if (customer && customer.lat && customer.lng) {
    mapMarkers.push({
      id: 'destination',
      title: '📍 Endereço de Entrega (Destino)',
      subtitle: customer.address,
      lat: customer.lat,
      lng: customer.lng,
      type: 'order_pending',
    })
  }

  if (courierLocation && courierLocation.lat && courierLocation.lng) {
    mapMarkers.push({
      id: 'courier-live',
      title: `🛵 ${courier?.name || 'Entregador em Rota'}`,
      subtitle: `Velocidade: ${courierLocation.speed || 30} km/h`,
      lat: courierLocation.lat,
      lng: courierLocation.lng,
      type: 'courier',
      speed: courierLocation.speed || 30,
    })
  }

  // Calculate simulated remaining ETA
  const getEtaString = () => {
    if (order?.status === 'delivered') return 'Entregue com sucesso'
    if (order?.status === 'cancelled') return 'Pedido Cancelado'
    if (order?.status === 'pending') return 'Aguardando despacho (~45 min)'
    return '15 - 25 minutos'
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between">
      {/* Public Header */}
      <header className="sticky top-0 z-30 flex h-16 w-full items-center justify-between border-b border-slate-800 bg-slate-950/90 px-4 backdrop-blur sm:px-6">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 text-white shadow-md">
            <Truck className="h-5 w-5" />
          </div>
          <span className="font-bold text-sm tracking-tight text-white">
            Gestão de Entregas • Rastreio Público
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={loadOrder}
            className="text-xs text-slate-400 hover:text-white"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1" />
            Atualizar
          </Button>
          <Link to="/">
            <Button size="sm" variant="outline" className="text-xs border-slate-700 text-slate-300">
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
            <div className="rounded-3xl border border-blue-500/30 bg-gradient-to-br from-slate-900 to-blue-950/40 p-6 shadow-2xl backdrop-blur relative overflow-hidden">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-blue-400">
                      {order.tracking_code}
                    </span>
                    <Badge
                      className={`text-xs ${
                        order.status === 'delivered'
                          ? 'bg-emerald-600'
                          : order.status === 'in_transit'
                            ? 'bg-amber-500 text-slate-950 font-bold animate-pulse'
                            : 'bg-blue-600'
                      }`}
                    >
                      {order.status === 'delivered'
                        ? 'ENTREGUE'
                        : order.status === 'in_transit'
                          ? 'EM TRÂNSITO'
                          : 'PEDIDO CONFIRMADO'}
                    </Badge>
                  </div>
                  <h1 className="text-2xl font-black text-white mt-1">
                    {order.status === 'delivered'
                      ? 'Sua encomenda foi entregue!'
                      : order.status === 'in_transit'
                        ? 'O entregador está a caminho do seu endereço.'
                        : 'Seu pedido está sendo preparado para envio.'}
                  </h1>
                  <p className="text-xs text-slate-400 mt-1">
                    Previsão de Chegada (ETA):{' '}
                    <span className="font-bold text-white">{getEtaString()}</span>
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start sm:self-center p-3 rounded-2xl bg-slate-950/80 border border-slate-800">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-600 text-white">
                    <Truck className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[11px] text-slate-400">Entregador Responsável</p>
                    <p className="text-xs font-bold text-white">
                      {courier?.name || 'Equipe de Logística'}
                    </p>
                  </div>
                </div>
              </div>

              {/* VERTICAL / HORIZONTAL STEPPER TIMELINE */}
              <div className="mt-8 pt-6 border-t border-slate-800/80 grid grid-cols-3 gap-2 relative">
                {/* Step 1 */}
                <div className="flex flex-col items-center text-center space-y-1.5">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'pending' ||
                      order.status === 'in_transit' ||
                      order.status === 'delivered'
                        ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/30'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    <Package className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white">1. Confirmado</p>
                  <p className="text-[10px] text-slate-400">Pedido registrado</p>
                </div>

                {/* Step 2 */}
                <div className="flex flex-col items-center text-center space-y-1.5">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'in_transit' || order.status === 'delivered'
                        ? 'bg-amber-500 text-slate-950 font-bold shadow-lg shadow-amber-500/30'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    <Truck className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white">2. Em Rota</p>
                  <p className="text-[10px] text-slate-400">Despachado com GPS</p>
                </div>

                {/* Step 3 */}
                <div className="flex flex-col items-center text-center space-y-1.5">
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold ${
                      order.status === 'delivered'
                        ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-500/30'
                        : 'bg-slate-800 text-slate-500'
                    }`}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                  </div>
                  <p className="text-xs font-bold text-white">3. Entregue</p>
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
                center={
                  courierLocation?.lat && courierLocation?.lng
                    ? { lat: courierLocation.lat, lng: courierLocation.lng }
                    : customer?.lat && customer?.lng
                      ? { lat: customer.lat, lng: customer.lng }
                      : { lat: -23.555, lng: -46.65 }
                }
                zoom={14}
                height="400px"
              />
            </div>

            {/* Delivery Destination & Package Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
                <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                  Local de Entrega
                </span>
                <p className="text-sm font-semibold text-white">{customer?.name || 'Cliente'}</p>
                <p className="text-slate-300">{customer?.address}</p>
                {order.notes && (
                  <p className="text-amber-300 text-[11px] pt-1">Nota: {order.notes}</p>
                )}
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4 space-y-2 text-xs">
                <span className="font-bold text-slate-400 uppercase tracking-wider text-[10px]">
                  Resumo do Pedido
                </span>
                <p className="text-slate-300">
                  Data: {new Date(order.created).toLocaleDateString('pt-BR')} às{' '}
                  {new Date(order.created).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </p>
                <p className="text-sm font-bold text-emerald-400">
                  Valor Total: R$ {Number(order.total_price || 0).toFixed(2)}
                </p>
              </div>
            </div>

            {/* REQUISITO 4: SEÇÃO DE AVALIAÇÃO DO CLIENTE (Entregador & Vendedor) */}
            {order.status === 'delivered' && (
              <div className="rounded-3xl border border-amber-500/30 bg-gradient-to-br from-slate-900 via-slate-950 to-amber-950/30 p-6 shadow-2xl backdrop-blur space-y-5">
                <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
                  <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-tr from-amber-500 to-yellow-400 text-slate-950 shadow-lg shadow-amber-500/20">
                    <HeartHandshake className="h-6 w-6" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white flex items-center gap-2">
                      Avalie sua Experiência de Entrega
                      <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px]">
                        Feedback do Cliente
                      </Badge>
                    </h3>
                    <p className="text-xs text-slate-400">
                      Sua opinião nos ajuda a melhorar a agilidade e atendimento da nossa equipe.
                    </p>
                  </div>
                </div>

                {hasSubmittedReview || existingReview ? (
                  <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 text-xs space-y-2 text-center">
                    <div className="flex justify-center">
                      <div className="h-10 w-10 rounded-full bg-emerald-500 text-slate-950 flex items-center justify-center font-bold">
                        <Check className="h-6 w-6" />
                      </div>
                    </div>
                    <h4 className="font-bold text-sm text-white">Avaliação Registrada!</h4>
                    <p className="text-slate-300">
                      Você avaliou o entregador com{' '}
                      <strong>{existingReview?.courier_rating || courierRating} estrelas</strong> e
                      o vendedor/atendimento com{' '}
                      <strong>{existingReview?.seller_rating || sellerRating} estrelas</strong>.
                    </p>
                    {existingReview?.comment && (
                      <p className="italic text-slate-400 text-[11px] pt-1">
                        &ldquo;{existingReview.comment}&rdquo;
                      </p>
                    )}
                  </div>
                ) : (
                  <form onSubmit={handleSubmitReview} className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {/* Avaliação do Entregador */}
                      <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Truck className="h-4 w-4 text-purple-400" />
                            Avaliar Entregador
                          </span>
                          <span className="text-xs font-bold text-amber-400">
                            {courierRating} / 5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
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
                                    : 'text-slate-700'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Avaliação do Vendedor / Loja */}
                      <div className="p-4 rounded-2xl bg-slate-950/70 border border-slate-800 space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white flex items-center gap-1.5">
                            <Package className="h-4 w-4 text-blue-400" />
                            Avaliar Vendedor & Loja
                          </span>
                          <span className="text-xs font-bold text-amber-400">
                            {sellerRating} / 5
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-400">
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
                                    : 'text-slate-700'
                                }`}
                              />
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Comentário Opcional */}
                    <div className="space-y-1.5">
                      <label className="text-xs font-semibold text-slate-300 flex items-center gap-1">
                        <MessageSquare className="h-3.5 w-3.5 text-blue-400" />
                        Deixe um elogio ou observação (opcional)
                      </label>
                      <Textarea
                        value={reviewComment}
                        onChange={(e) => setReviewComment(e.target.value)}
                        placeholder="Ex: Entrega super rápida, entregador muito educado e atencioso!"
                        className="bg-slate-950 border-slate-800 text-xs text-white resize-none"
                        rows={2}
                      />
                    </div>

                    <div className="flex justify-end">
                      <Button
                        type="submit"
                        disabled={isSubmittingReview}
                        className="bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-slate-950 font-black text-xs h-10 px-6 rounded-xl shadow-lg shadow-amber-500/25"
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
      <footer className="border-t border-slate-800/80 bg-slate-950/90 py-4 px-6 text-center text-xs text-slate-500">
        <p>Rastreamento Seguro via Gestão de Entregas • Skip Cloud Realtime</p>
      </footer>
    </div>
  )
}
