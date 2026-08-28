import React, { useState, useEffect, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
  Calendar,
  UserCheck,
  ChevronRight,
  Navigation,
} from 'lucide-react'
import { OrderRecord, UserRecord, LocationRecord } from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import { loadGoogleMapsScript, isGoogleMapsAuthError } from '@/lib/googleMaps'
import { useToast } from '@/hooks/use-toast'

interface ControlTowerProps {
  orders?: OrderRecord[]
  couriers?: UserRecord[]
  onRefresh?: () => void
  userRole?: 'seller' | 'admin'
}

export const ControlTower: React.FC<ControlTowerProps> = ({
  orders: initialOrders,
  couriers: initialCouriers,
  onRefresh,
  userRole = 'seller',
}) => {
  const { toast } = useToast()
  const [orders, setOrders] = useState<OrderRecord[]>(initialOrders || [])
  const [couriers, setCouriers] = useState<UserRecord[]>(initialCouriers || [])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [courierFilter, setCourierFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Selected for Modal details
  const [selectedCourier, setSelectedCourier] = useState<UserRecord | null>(null)
  const [selectedOrder, setSelectedOrder] = useState<OrderRecord | null>(null)

  // Google Maps state
  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [mapsError, setMapsError] = useState(false)
  const [mapInstance, setMapInstance] = useState<any>(null)
  const [markersRef, setMarkersRef] = useState<any[]>([])

  // Load data
  const fetchData = async () => {
    try {
      const [fetchedOrders, fetchedCouriers, fetchedLocations] = await Promise.all([
        deliveryService.getOrders('', '-created', 'customer_id,courier_id,seller_id'),
        deliveryService.getCouriers(),
        deliveryService.getLatestLocations(),
      ])
      setOrders(fetchedOrders)
      setCouriers(fetchedCouriers)
      setLocations(fetchedLocations)
      setLastUpdated(new Date())
    } catch (err) {
      console.warn('Erro ao atualizar dados da Torre de Controle:', err)
    }
  }

  // 10s Auto Refresh
  useEffect(() => {
    fetchData()
    const interval = setInterval(() => {
      fetchData()
      if (onRefresh) onRefresh()
    }, 10000)

    return () => clearInterval(interval)
  }, [])

  // Sync with props if provided
  useEffect(() => {
    if (initialOrders) setOrders(initialOrders)
  }, [initialOrders])

  useEffect(() => {
    if (initialCouriers) setCouriers(initialCouriers)
  }, [initialCouriers])

  // Load Google Maps Script
  useEffect(() => {
    loadGoogleMapsScript().then((loaded) => {
      if (loaded && !isGoogleMapsAuthError()) {
        setMapsLoaded(true)
      } else {
        setMapsError(true)
      }
    })
  }, [])

  // Today's orders
  const todayStr = new Date().toISOString().split('T')[0]
  const todayOrders = useMemo(() => {
    return orders.filter((o) => {
      const createdDate = o.created ? o.created.split('T')[0] : ''
      return createdDate === todayStr || o.status === 'in_transit' || o.status === 'pending'
    })
  }, [orders, todayStr])

  // Metrics summary
  const metrics = useMemo(() => {
    const total = todayOrders.length
    const delivered = todayOrders.filter((o) => o.status === 'delivered').length
    const inTransit = todayOrders.filter((o) => o.status === 'in_transit').length
    const pending = todayOrders.filter((o) => o.status === 'pending').length
    const issues = todayOrders.filter(
      (o) =>
        o.status === 'address_error' ||
        o.status === 'client_absent' ||
        o.status === 'cancelled' ||
        (o.notes && o.notes.toLowerCase().includes('problema')),
    ).length

    return { total, delivered, inTransit, pending, issues }
  }, [todayOrders])

  // Map couriers with their status & location & next delivery
  const courierMapData = useMemo(() => {
    return couriers.map((courier) => {
      // Find latest location record
      const courierLocs = locations.filter((l) => l.user_id === courier.id)
      const latestLoc = courierLocs[0]

      // Determine location coords: fallback to SP / Rio center or default
      const lat =
        latestLoc?.lat || -23.55052 + ((parseInt(courier.id.slice(-2), 16) % 20) - 10) * 0.005
      const lng =
        latestLoc?.lng || -46.633308 + ((parseInt(courier.id.slice(-3), 16) % 20) - 10) * 0.005

      // Active orders for this courier
      const courierOrders = todayOrders.filter((o) => o.courier_id === courier.id)
      const inTransitOrders = courierOrders.filter((o) => o.status === 'in_transit')
      const pendingOrders = courierOrders.filter((o) => o.status === 'pending')
      const problemOrders = courierOrders.filter(
        (o) => o.status === 'address_error' || o.status === 'client_absent',
      )
      const finishedOrders = courierOrders.filter((o) => o.status === 'delivered')

      // Status color rule:
      // Red (vermelho) = problema
      // Yellow (amarelo) = em rota
      // Green (verde) = ativo / disponível
      let statusColor: 'green' | 'yellow' | 'red' = 'green'
      let statusLabel = 'Ativo (Disponível)'

      if (problemOrders.length > 0) {
        statusColor = 'red'
        statusLabel = 'Problema na Entrega'
      } else if (inTransitOrders.length > 0) {
        statusColor = 'yellow'
        statusLabel = 'Em Rota'
      } else if (courier.status === 'inactive') {
        statusColor = 'red'
        statusLabel = 'Inativo'
      }

      // Next delivery
      const nextOrder = inTransitOrders[0] || pendingOrders[0] || null
      // Previous delivery
      const lastDelivered = finishedOrders[finishedOrders.length - 1] || null

      return {
        courier,
        lat,
        lng,
        statusColor,
        statusLabel,
        activeOrdersCount: inTransitOrders.length + pendingOrders.length,
        nextOrder,
        lastDelivered,
        vehicle: courier.vehicle_type || 'motorcycle',
      }
    })
  }, [couriers, locations, todayOrders])

  // Initialize and Render Map
  useEffect(() => {
    if (!mapsLoaded || typeof window === 'undefined') return
    const win = window as any
    if (!win.google || !win.google.maps) return

    const mapElement = document.getElementById('control-tower-map')
    if (!mapElement) return

    let map = mapInstance
    if (!map) {
      map = new win.google.maps.Map(mapElement, {
        center: { lat: -23.55052, lng: -46.633308 },
        zoom: 12,
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        styles: [
          {
            featureType: 'poi',
            elementType: 'labels',
            stylers: [{ visibility: 'off' }],
          },
        ],
      })
      setMapInstance(map)
    }

    // Clear old markers
    markersRef.forEach((m) => m.setMap(null))
    const newMarkers: any[] = []
    const bounds = new win.google.maps.LatLngBounds()
    let hasCoords = false

    courierMapData.forEach((item) => {
      const position = { lat: item.lat, lng: item.lng }
      bounds.extend(position)
      hasCoords = true

      // Pin Color SVG
      const pinColorHex =
        item.statusColor === 'green'
          ? '#10B981'
          : item.statusColor === 'yellow'
            ? '#F59E0B'
            : '#EF4444'

      const svgMarker = {
        path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
        fillColor: pinColorHex,
        fillOpacity: 1.0,
        strokeWeight: 2,
        strokeColor: '#FFFFFF',
        scale: 1.8,
        anchor: new win.google.maps.Point(12, 22),
      }

      const marker = new win.google.maps.Marker({
        position,
        map,
        title: item.courier.name || item.courier.email,
        icon: svgMarker,
      })

      // Info Window
      const nextCust =
        item.nextOrder?.expand?.customer_id?.name || item.nextOrder?.tracking_code || 'Nenhuma'
      const infoContent = `
        <div style="font-family: sans-serif; padding: 6px; font-size: 13px; min-width: 180px;">
          <b style="color: #111827; font-size: 14px;">${item.courier.name || item.courier.email}</b>
          <div style="margin: 4px 0; color: #4B5563;">
            <span>Veículo: <b>${formatVehicle(item.vehicle)}</b></span>
          </div>
          <div style="margin: 4px 0; display: inline-block; padding: 2px 8px; border-radius: 9999px; font-weight: 600; font-size: 11px; background: ${pinColorHex}20; color: ${pinColorHex};">
            ${item.statusLabel}
          </div>
          <div style="margin-top: 6px; font-size: 12px; color: #374151;">
            <b>Próxima Entrega:</b> ${nextCust}
          </div>
        </div>
      `
      const infoWindow = new win.google.maps.InfoWindow({ content: infoContent })

      marker.addListener('click', () => {
        infoWindow.open(map, marker)
        setSelectedCourier(item.courier)
      })

      newMarkers.push(marker)
    })

    // Also place pins for pending / in transit delivery destination points
    todayOrders
      .filter((o) => o.status === 'in_transit' || o.status === 'pending')
      .forEach((order) => {
        const cust = order.expand?.customer_id
        if (cust?.lat && cust?.lng) {
          const destPos = { lat: cust.lat, lng: cust.lng }
          bounds.extend(destPos)
          hasCoords = true

          const isTransit = order.status === 'in_transit'
          const destMarker = new win.google.maps.Marker({
            position: destPos,
            map,
            title: `Destino: ${cust.name || 'Cliente'}`,
            icon: {
              path: win.google.maps.SymbolPath.CIRCLE,
              scale: 6,
              fillColor: isTransit ? '#3B82F6' : '#94A3B8',
              fillOpacity: 0.9,
              strokeWeight: 1.5,
              strokeColor: '#FFFFFF',
            },
          })

          destMarker.addListener('click', () => {
            setSelectedOrder(order)
          })

          newMarkers.push(destMarker)
        }
      })

    setMarkersRef(newMarkers)

    if (hasCoords && newMarkers.length > 0) {
      map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
      // Don't zoom in excessively if only 1 item
      const listener = win.google.maps.event.addListener(map, 'idle', () => {
        if (map.getZoom() > 15) map.setZoom(15)
        win.google.maps.event.removeListener(listener)
      })
    }
  }, [mapsLoaded, courierMapData, todayOrders])

  // Filtered orders list
  const filteredOrders = useMemo(() => {
    return todayOrders.filter((order) => {
      const matchesStatus =
        statusFilter === 'all'
          ? true
          : statusFilter === 'issues'
            ? order.status === 'address_error' ||
              order.status === 'client_absent' ||
              order.status === 'cancelled'
            : order.status === statusFilter

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

  // WhatsApp helper
  const openWhatsApp = (phone?: string, text?: string) => {
    if (!phone) {
      toast({
        title: 'Telefone não cadastrado',
        description: 'Este entregador/cliente não possui número de telefone salvo.',
        variant: 'destructive',
      })
      return
    }
    const cleanNumber = phone.replace(/\D/g, '')
    const finalNumber = cleanNumber.startsWith('55') ? cleanNumber : `55${cleanNumber}`
    const defaultMsg = encodeURIComponent(text || 'Olá! Mensagem da central de Gestão de Entregas.')
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

  function formatVehicle(type?: string) {
    switch (type) {
      case 'motorcycle':
        return 'Moto'
      case 'car':
        return 'Carro'
      case 'van':
        return 'Van'
      case 'truck':
        return 'Caminhão'
      case 'bicycle':
        return 'Bicicleta'
      default:
        return 'Moto'
    }
  }

  function renderVehicleIcon(type?: string) {
    switch (type) {
      case 'car':
      case 'van':
        return <Car className="h-4 w-4 text-blue-500" />
      case 'truck':
        return <Truck className="h-4 w-4 text-purple-500" />
      case 'motorcycle':
      case 'bicycle':
      default:
        return <Bike className="h-4 w-4 text-emerald-500" />
    }
  }

  function getStatusBadge(status: string) {
    switch (status) {
      case 'delivered':
        return (
          <Badge className="bg-[#00AA44] text-white hover:bg-[#008836] font-bold">Entregue</Badge>
        )
      case 'in_transit':
        return (
          <Badge className="bg-[#FF6B35] text-white hover:bg-[#E5531E] font-bold">Em Rota</Badge>
        )
      case 'pending':
        return (
          <Badge variant="outline" className="border-[#0052CC] text-[#0052CC] bg-blue-50 font-bold">
            Pendente
          </Badge>
        )
      case 'address_error':
        return <Badge className="bg-[#FF6B35] text-white font-bold">Erro de Endereço</Badge>
      case 'client_absent':
        return <Badge className="bg-[#E74C3C] text-white font-bold">Cliente Ausente</Badge>
      case 'cancelled':
        return <Badge variant="secondary">Cancelada</Badge>
      default:
        return <Badge variant="outline">{status}</Badge>
    }
  }

  return (
    <div className="space-y-6">
      {/* Header with Title & Summary Metrics */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight text-gray-900">
              Torre de Controle em Tempo Real
            </h1>
            <span className="flex h-3 w-3 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
            </span>
          </div>
          <p className="text-sm text-gray-500">
            Monitoramento ao vivo de frotas, entregadores e status das entregas do dia.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center text-xs text-gray-500 bg-gray-100 px-3 py-1.5 rounded-md">
            <Clock className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
            Auto-atualização 10s • Última: {lastUpdated.toLocaleTimeString('pt-BR')}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setIsLoading(true)
              fetchData().finally(() => setIsLoading(false))
            }}
            disabled={isLoading}
            className="flex items-center gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-slate-200 border-l-4 border-l-[#0052CC] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Total do Dia
                </p>
                <p className="font-heading text-2xl font-black text-[#1a1a1a] mt-1">
                  {metrics.total}
                </p>
              </div>
              <div className="p-2.5 bg-blue-50 rounded-card text-[#0052CC] border border-blue-100">
                <Package className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-xs text-slate-500 flex items-center justify-between font-sans">
              <span>{metrics.pending} pendentes</span>
              <span>{couriers.length} entregadores</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#00AA44] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Entregues
                </p>
                <p className="font-heading text-2xl font-black text-[#00AA44] mt-1">
                  {metrics.delivered}
                </p>
              </div>
              <div className="p-2.5 bg-emerald-50 rounded-card text-[#00AA44] border border-emerald-100">
                <CheckCircle2 className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-xs text-[#00AA44] font-semibold font-sans">
              {metrics.total > 0
                ? `${Math.round((metrics.delivered / metrics.total) * 100)}% de taxa de conclusão`
                : '0% concluído'}
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#FF6B35] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Em Rota
                </p>
                <p className="font-heading text-2xl font-black text-[#FF6B35] mt-1">
                  {metrics.inTransit}
                </p>
              </div>
              <div className="p-2.5 bg-orange-50 rounded-card text-[#FF6B35] border border-orange-100">
                <Navigation className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-xs text-[#FF6B35] font-semibold font-sans">
              {courierMapData.filter((c) => c.statusColor === 'yellow').length} entregadores em
              trânsito
            </div>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#E74C3C] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  Problemas
                </p>
                <p className="font-heading text-2xl font-black text-[#E74C3C] mt-1">
                  {metrics.issues}
                </p>
              </div>
              <div className="p-2.5 bg-red-50 rounded-card text-[#E74C3C] border border-red-100">
                <AlertTriangle className="h-5 w-5" />
              </div>
            </div>
            <div className="mt-2 text-xs text-[#E74C3C] font-semibold font-sans">
              {metrics.issues > 0 ? 'Atenção necessária' : 'Sem ocorrências no momento'}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* TOP SECTION: MAPA INTERATIVO (60% da experiência de monitoramento) */}
      <Card className="shadow-md overflow-hidden border">
        <CardHeader className="bg-[#F5F5F5] border-b border-slate-200 py-3 px-4 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-[#0052CC]" />
            <CardTitle className="font-heading text-base font-bold text-[#1a1a1a]">
              Mapa de Localização dos Entregadores
            </CardTitle>
          </div>
          {/* Legenda de cores */}
          <div className="flex items-center gap-3 text-xs font-sans">
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#00AA44] inline-block"></span>
              <span className="text-slate-600">Verde: Ativo / Disponível</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#FF6B35] inline-block"></span>
              <span className="text-slate-600">Laranja: Em Rota</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-3 w-3 rounded-full bg-[#E74C3C] inline-block"></span>
              <span className="text-slate-600">Vermelho: Problema</span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="relative w-full h-[460px] bg-gray-100">
            {/* Map Canvas */}
            <div id="control-tower-map" className="w-full h-full" />

            {/* Fallback display if Google Maps API key has quota/billing block */}
            {mapsError && (
              <div className="absolute inset-0 bg-slate-900/90 text-white p-6 overflow-y-auto">
                <div className="max-w-3xl mx-auto space-y-4">
                  <div className="flex items-center gap-2 text-amber-400">
                    <AlertCircle className="h-5 w-5" />
                    <span className="font-semibold text-sm">
                      Visualização Interativa de Frota (Fallback Geográfico)
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                    {courierMapData.map((item) => (
                      <div
                        key={item.courier.id}
                        onClick={() => setSelectedCourier(item.courier)}
                        className="bg-slate-800 hover:bg-slate-700/80 cursor-pointer p-3.5 rounded-lg border border-slate-700 transition"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={`h-3 w-3 rounded-full ${
                                item.statusColor === 'green'
                                  ? 'bg-emerald-500'
                                  : item.statusColor === 'yellow'
                                    ? 'bg-amber-500'
                                    : 'bg-red-500'
                              }`}
                            />
                            <span className="font-medium text-sm text-white">
                              {item.courier.name || item.courier.email}
                            </span>
                          </div>
                          {renderVehicleIcon(item.vehicle)}
                        </div>
                        <div className="text-xs text-slate-400 mt-2 space-y-1">
                          <p>
                            Status: <b className="text-slate-200">{item.statusLabel}</b>
                          </p>
                          <p>
                            GPS: {item.lat.toFixed(4)}, {item.lng.toFixed(4)}
                          </p>
                          <p>
                            Próxima:{' '}
                            <span className="text-blue-300">
                              {item.nextOrder?.expand?.customer_id?.name || 'Nenhuma'}
                            </span>
                          </p>
                        </div>
                        <div className="mt-3 pt-2 border-t border-slate-700 flex gap-2">
                          <Button
                            size="sm"
                            variant="secondary"
                            className="h-7 text-xs flex-1"
                            onClick={(e) => {
                              e.stopPropagation()
                              openWhatsApp(item.courier.phone)
                            }}
                          >
                            <MessageCircle className="h-3 w-3 mr-1 text-emerald-400" />
                            WhatsApp
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs bg-slate-900 border-slate-700 hover:bg-slate-800"
                            onClick={(e) => {
                              e.stopPropagation()
                              makePhoneCall(item.courier.phone)
                            }}
                          >
                            <Phone className="h-3 w-3 mr-1 text-blue-400" />
                            Ligar
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Quick Courier Cards Overlay Drawer on Top Right */}
            <div className="hidden lg:block absolute top-3 right-3 max-h-[430px] w-80 bg-white/95 backdrop-blur-sm shadow-xl rounded-card border border-slate-200 p-3 overflow-y-auto space-y-2 z-10 font-sans">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                <span className="font-heading text-xs font-bold text-[#1a1a1a] uppercase">
                  Entregadores Conectados ({courierMapData.length})
                </span>
                <Badge
                  variant="secondary"
                  className="text-[10px] bg-emerald-50 text-[#00AA44] font-bold border-emerald-200"
                >
                  {courierMapData.filter((c) => c.statusColor === 'green').length} livres
                </Badge>
              </div>
              <div className="space-y-2">
                {courierMapData.map((item) => (
                  <div
                    key={item.courier.id}
                    onClick={() => setSelectedCourier(item.courier)}
                    className="p-2.5 rounded-card border border-slate-200 hover:border-[#0052CC]/50 hover:bg-blue-50/50 cursor-pointer transition text-xs bg-white"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 font-medium text-[#1a1a1a]">
                        <span
                          className={`h-2.5 w-2.5 rounded-full ${
                            item.statusColor === 'green'
                              ? 'bg-[#00AA44]'
                              : item.statusColor === 'yellow'
                                ? 'bg-[#FF6B35]'
                                : 'bg-[#E74C3C]'
                          }`}
                        />
                        <span className="truncate max-w-[140px] font-semibold">
                          {item.courier.name || item.courier.email}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-500 flex items-center gap-1">
                        {renderVehicleIcon(item.vehicle)}
                        {formatVehicle(item.vehicle)}
                      </span>
                    </div>

                    <div className="mt-1 text-[11px] text-slate-600 flex items-center justify-between font-sans">
                      <span>{item.statusLabel}</span>
                      <span className="text-[#0052CC] font-bold">
                        {item.activeOrdersCount} pendentes
                      </span>
                    </div>

                    <div className="mt-2 pt-1.5 border-t border-slate-100 flex gap-1.5">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] px-2 py-0 text-[#00AA44] hover:bg-emerald-50 w-1/2 rounded-input font-semibold"
                        onClick={(e) => {
                          e.stopPropagation()
                          openWhatsApp(item.courier.phone)
                        }}
                      >
                        <MessageCircle className="h-3 w-3 mr-1 text-[#00AA44]" />
                        WhatsApp
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-[11px] px-2 py-0 text-[#0052CC] hover:bg-blue-50 w-1/2 rounded-input font-semibold"
                        onClick={(e) => {
                          e.stopPropagation()
                          makePhoneCall(item.courier.phone)
                        }}
                      >
                        <Phone className="h-3 w-3 mr-1 text-[#0052CC]" />
                        Ligar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* BOTTOM SECTION: LISTA DE ENTREGAS COM FILTROS */}
      <Card className="border border-slate-200 bg-white shadow-brand rounded-card">
        <CardHeader className="p-4 border-b border-slate-200">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <CardTitle className="font-heading text-lg font-bold text-[#1a1a1a]">
                Entregas em Andamento & Histórico do Dia
              </CardTitle>
              <p className="font-sans text-xs text-slate-500 mt-0.5">
                Exibindo {filteredOrders.length} de {todayOrders.length} entregas cadastradas
              </p>
            </div>

            {/* Filtros por Status e Entregador + Busca */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[180px]">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-gray-400" />
                <Input
                  placeholder="Buscar cliente, código..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-8 h-9 text-xs"
                />
              </div>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-9 text-xs w-[140px]">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os Status</SelectItem>
                  <SelectItem value="pending">Pendente</SelectItem>
                  <SelectItem value="in_transit">Em Rota</SelectItem>
                  <SelectItem value="delivered">Entregue</SelectItem>
                  <SelectItem value="issues">Com Problema</SelectItem>
                </SelectContent>
              </Select>

              <Select value={courierFilter} onValueChange={setCourierFilter}>
                <SelectTrigger className="h-9 text-xs w-[160px]">
                  <SelectValue placeholder="Entregador" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos Entregadores</SelectItem>
                  {couriers.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name || c.email}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50/75 text-xs text-gray-500 uppercase border-b">
                <tr>
                  <th className="py-3 px-4">Código / Cliente</th>
                  <th className="py-3 px-4">Endereço de Entrega</th>
                  <th className="py-3 px-4">Entregador</th>
                  <th className="py-3 px-4">Previsão / Hora</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-gray-400 text-sm">
                      Nenhuma entrega encontrada para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredOrders.map((order) => {
                    const cust = order.expand?.customer_id
                    const courier = order.expand?.courier_id
                    const isIssue =
                      order.status === 'address_error' ||
                      order.status === 'client_absent' ||
                      order.status === 'cancelled'

                    return (
                      <tr
                        key={order.id}
                        className={`hover:bg-blue-50/40 cursor-pointer transition ${
                          isIssue ? 'bg-red-50/30' : ''
                        }`}
                        onClick={() => setSelectedOrder(order)}
                      >
                        <td className="py-3 px-4">
                          <div className="font-mono text-xs font-bold text-gray-900">
                            {order.tracking_code}
                          </div>
                          <div className="font-medium text-gray-800 text-xs mt-0.5">
                            {cust?.name || 'Cliente'}
                          </div>
                        </td>

                        <td className="py-3 px-4 text-xs text-gray-600 max-w-xs">
                          <div className="flex items-start gap-1">
                            <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                            <span className="truncate">
                              {cust?.address || 'Endereço não informado'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-xs">
                          {courier ? (
                            <div className="flex items-center gap-2">
                              {renderVehicleIcon(courier.vehicle_type)}
                              <div>
                                <p className="font-medium text-gray-900">
                                  {courier.name || courier.email}
                                </p>
                                <p className="text-[10px] text-gray-500">
                                  {formatVehicle(courier.vehicle_type)}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400 italic">Não atribuído</span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-xs text-gray-600">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5 text-gray-400" />
                            <span>
                              {order.estimated_arrival
                                ? new Date(order.estimated_arrival).toLocaleTimeString('pt-BR', {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })
                                : order.estimated_duration_minutes
                                  ? `~${order.estimated_duration_minutes} min`
                                  : '--:--'}
                            </span>
                          </div>
                        </td>

                        <td className="py-3 px-4">{getStatusBadge(order.status)}</td>

                        <td className="py-3 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            {courier?.phone && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 border-emerald-200"
                                title="WhatsApp com Entregador"
                                onClick={() =>
                                  openWhatsApp(
                                    courier.phone,
                                    `Olá ${courier.name || ''}, sobre a entrega ${order.tracking_code} do cliente ${cust?.name || ''}:`,
                                  )
                                }
                              >
                                <MessageCircle className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {cust?.phone && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50 border-blue-200"
                                title="WhatsApp com Cliente"
                                onClick={() =>
                                  openWhatsApp(
                                    cust.phone,
                                    `Olá ${cust.name || ''}! Estamos acompanhando sua entrega cód ${order.tracking_code}.`,
                                  )
                                }
                              >
                                <Phone className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs text-gray-600 hover:text-gray-900"
                              onClick={() => setSelectedOrder(order)}
                            >
                              Ver Detalhes
                              <ChevronRight className="h-3 w-3 ml-1" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* DIALOG 1: DETALHES DO ENTREGADOR (Clicar no pin ou card) */}
      <Dialog open={!!selectedCourier} onOpenChange={(open) => !open && setSelectedCourier(null)}>
        <DialogContent className="sm:max-w-md">
          {selectedCourier &&
            (() => {
              const data = courierMapData.find((c) => c.courier.id === selectedCourier.id)
              const nextCust = data?.nextOrder?.expand?.customer_id
              const lastCust = data?.lastDelivered?.expand?.customer_id

              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-blue-50 rounded-full text-blue-600">
                        {renderVehicleIcon(selectedCourier.vehicle_type)}
                      </div>
                      <div>
                        <DialogTitle className="text-lg">
                          {selectedCourier.name || selectedCourier.email}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                          {formatVehicle(selectedCourier.vehicle_type)} • Placa:{' '}
                          {selectedCourier.vehicle_plate || 'Não informada'}
                        </DialogDescription>
                      </div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-4 py-2 text-xs">
                    {/* Status e Localização */}
                    <div className="grid grid-cols-2 gap-2 bg-gray-50 p-3 rounded-lg border">
                      <div>
                        <span className="text-gray-500 block">Status Atual:</span>
                        <span className="font-semibold text-gray-900 mt-0.5 inline-flex items-center gap-1.5">
                          <span
                            className={`h-2.5 w-2.5 rounded-full ${
                              data?.statusColor === 'green'
                                ? 'bg-emerald-500'
                                : data?.statusColor === 'yellow'
                                  ? 'bg-amber-500'
                                  : 'bg-red-500'
                            }`}
                          />
                          {data?.statusLabel}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">GPS (Lat / Lng):</span>
                        <span className="font-mono text-gray-800">
                          {data?.lat.toFixed(5)}, {data?.lng.toFixed(5)}
                        </span>
                      </div>
                    </div>

                    {/* Próxima Entrega */}
                    <div className="border rounded-lg p-3 space-y-1.5 bg-blue-50/40">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-blue-900 flex items-center gap-1">
                          <Navigation className="h-3.5 w-3.5 text-blue-600" />
                          Próxima Entrega:
                        </span>
                        {data?.nextOrder && getStatusBadge(data.nextOrder.status)}
                      </div>
                      {data?.nextOrder ? (
                        <div className="text-gray-700">
                          <p className="font-medium text-gray-900">
                            {nextCust?.name || 'Cliente'} ({data.nextOrder.tracking_code})
                          </p>
                          <p className="text-gray-500 text-[11px] truncate">
                            {nextCust?.address || 'Endereço'}
                          </p>
                          <p className="text-blue-700 font-medium text-[11px] mt-1">
                            Tempo estimado:{' '}
                            {data.nextOrder.estimated_duration_minutes
                              ? `~${data.nextOrder.estimated_duration_minutes} min`
                              : '20-30 min'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Nenhuma entrega na fila atual</p>
                      )}
                    </div>

                    {/* Última Entrega Concluída */}
                    <div className="border rounded-lg p-3 space-y-1 bg-gray-50/60">
                      <span className="font-semibold text-gray-700 flex items-center gap-1">
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                        Status da Entrega Anterior:
                      </span>
                      {data?.lastDelivered ? (
                        <div className="text-gray-600 text-[11px]">
                          <p>
                            Entregue para: <b>{lastCust?.name || 'Cliente'}</b> (
                            {data.lastDelivered.tracking_code})
                          </p>
                          <p className="text-gray-400">
                            Horário:{' '}
                            {data.lastDelivered.actual_arrival
                              ? new Date(data.lastDelivered.actual_arrival).toLocaleTimeString(
                                  'pt-BR',
                                )
                              : 'Hoje'}
                          </p>
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Nenhuma entrega concluída hoje ainda</p>
                      )}
                    </div>

                    {/* Contato Direto */}
                    <div className="pt-2 flex gap-2">
                      <Button
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                        size="sm"
                        onClick={() => openWhatsApp(selectedCourier.phone)}
                      >
                        <MessageCircle className="h-4 w-4 mr-1.5" />
                        Conversar no WhatsApp
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1"
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

      {/* DIALOG 2: DETALHES DA ENTREGA (Clicar na entrega) */}
      <Dialog open={!!selectedOrder} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent className="sm:max-w-lg">
          {selectedOrder &&
            (() => {
              const cust = selectedOrder.expand?.customer_id
              const courier = selectedOrder.expand?.courier_id

              return (
                <>
                  <DialogHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <DialogTitle className="text-lg">
                          Entrega {selectedOrder.tracking_code}
                        </DialogTitle>
                        <DialogDescription className="text-xs">
                          Registrada em{' '}
                          {selectedOrder.created
                            ? new Date(selectedOrder.created).toLocaleString('pt-BR')
                            : 'Hoje'}
                        </DialogDescription>
                      </div>
                      <div>{getStatusBadge(selectedOrder.status)}</div>
                    </div>
                  </DialogHeader>

                  <div className="space-y-4 py-2 text-xs">
                    {/* Cliente e Endereço */}
                    <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900">Dados do Cliente:</span>
                        {cust?.phone && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 text-xs text-emerald-600 px-1.5"
                            onClick={() => openWhatsApp(cust.phone)}
                          >
                            <MessageCircle className="h-3.5 w-3.5 mr-1" />
                            WhatsApp
                          </Button>
                        )}
                      </div>
                      <p className="text-sm font-medium text-gray-800">{cust?.name || 'Cliente'}</p>
                      <p className="text-gray-600 flex items-start gap-1">
                        <MapPin className="h-3.5 w-3.5 text-gray-400 shrink-0 mt-0.5" />
                        <span>{cust?.address || 'Endereço não informado'}</span>
                      </p>
                      {cust?.phone && <p className="text-gray-500">Telefone: {cust.phone}</p>}
                    </div>

                    {/* Entregador Responsável */}
                    <div className="border rounded-lg p-3 bg-gray-50 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-gray-900">Entregador Responsável:</span>
                        {courier?.phone && (
                          <div className="flex gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs text-emerald-600 px-1.5"
                              onClick={() => openWhatsApp(courier.phone)}
                            >
                              <MessageCircle className="h-3.5 w-3.5 mr-1" />
                              WhatsApp
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 text-xs text-blue-600 px-1.5"
                              onClick={() => makePhoneCall(courier.phone)}
                            >
                              <Phone className="h-3.5 w-3.5 mr-1" />
                              Ligar
                            </Button>
                          </div>
                        )}
                      </div>
                      {courier ? (
                        <div className="flex items-center gap-2">
                          {renderVehicleIcon(courier.vehicle_type)}
                          <div>
                            <p className="font-medium text-gray-800">
                              {courier.name || courier.email}
                            </p>
                            <p className="text-[11px] text-gray-500">
                              {formatVehicle(courier.vehicle_type)} •{' '}
                              {courier.phone || 'Sem telefone'}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Nenhum entregador atribuído ainda</p>
                      )}
                    </div>

                    {/* Horário Estimado & Informações Adicionais */}
                    <div className="grid grid-cols-2 gap-3 bg-blue-50/50 p-3 rounded-lg border">
                      <div>
                        <span className="text-gray-500 block">Horário Estimado:</span>
                        <span className="font-semibold text-blue-900">
                          {selectedOrder.estimated_arrival
                            ? new Date(selectedOrder.estimated_arrival).toLocaleTimeString('pt-BR')
                            : selectedOrder.estimated_duration_minutes
                              ? `~${selectedOrder.estimated_duration_minutes} min de trajeto`
                              : 'Em cálculo'}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500 block">Distância Calculada:</span>
                        <span className="font-semibold text-gray-800">
                          {selectedOrder.distance_km ? `${selectedOrder.distance_km} km` : '--'}
                        </span>
                      </div>
                    </div>

                    {/* Observações / Ocorrências se houver */}
                    {selectedOrder.notes && (
                      <div className="bg-amber-50 border border-amber-200 p-2.5 rounded-lg text-amber-900">
                        <span className="font-semibold block mb-0.5">Observações:</span>
                        <p>{selectedOrder.notes}</p>
                      </div>
                    )}

                    {/* Comprovante de Entrega se já finalizada */}
                    {selectedOrder.status === 'delivered' &&
                      (selectedOrder.proof_photo || selectedOrder.signature) && (
                        <div className="border rounded-lg p-3 bg-emerald-50/50 space-y-2">
                          <span className="font-semibold text-emerald-900 block">
                            Comprovante Digital Registrado:
                          </span>
                          <div className="grid grid-cols-2 gap-2">
                            {selectedOrder.proof_photo && (
                              <div>
                                <p className="text-[10px] text-gray-500 mb-1">Foto da Entrega:</p>
                                <img
                                  src={selectedOrder.proof_photo}
                                  alt="Foto da entrega"
                                  className="w-full h-24 object-cover rounded border"
                                />
                              </div>
                            )}
                            {selectedOrder.signature && (
                              <div>
                                <p className="text-[10px] text-gray-500 mb-1">
                                  Assinatura Digital:
                                </p>
                                <img
                                  src={selectedOrder.signature}
                                  alt="Assinatura"
                                  className="w-full h-24 object-contain bg-white rounded border"
                                />
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                  </div>
                </>
              )
            })()}
        </DialogContent>
      </Dialog>
    </div>
  )
}
