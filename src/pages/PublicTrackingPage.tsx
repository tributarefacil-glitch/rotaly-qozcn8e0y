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
} from 'lucide-react'
import { LiveMap, type MapMarkerItem } from '@/components/LiveMap'
import { deliveryService } from '@/services/deliveryService'
import { useRealtime } from '@/hooks/use-realtime'
import type { OrderRecord, LocationRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function PublicTrackingPage() {
  const { tracking_code } = useParams<{ tracking_code: string }>()
  const [order, setOrder] = useState<OrderRecord | null>(null)
  const [courierLocation, setCourierLocation] = useState<LocationRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)

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
      }
    } catch (err) {
      console.error('Tracking fetch error:', err)
      setErrorMsg('Não foi possível carregar as informações deste rastreamento.')
    } finally {
      setIsLoading(false)
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
