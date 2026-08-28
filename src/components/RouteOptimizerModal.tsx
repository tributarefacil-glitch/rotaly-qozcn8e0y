import React, { useState, useEffect, useRef, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Sparkles,
  Truck,
  MapPin,
  Clock,
  Navigation,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Users,
  ChevronRight,
  ArrowRight,
  Zap,
  RotateCcw,
  Check,
} from 'lucide-react'
import { deliveryService } from '@/services/deliveryService'
import type {
  OrderRecord,
  UserRecord,
  CustomerRecord,
  LocationRecord,
  CourierOptimizationPlan,
  MultiCourierOptimizationResult,
  OptimizedStop,
  AppSettingsRecord,
} from '@/types/delivery'
import {
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
} from '@/lib/googleMaps'
import {
  ArrowUp,
  ArrowDown,
  Trash2,
  UserPlus,
  Fuel,
  TrendingDown,
  Gauge,
  PlusCircle,
} from 'lucide-react'
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
  orders,
  couriers,
  customers,
  locations,
  onRoutesApplied,
}) => {
  // Pending orders eligible for routing optimization
  const pendingOrders = useMemo(() => {
    return orders.filter(
      (o) => o.status === 'pending' || (o.status === 'in_transit' && !o.courier_id),
    )
  }, [orders])

  // Selected available couriers (ids)
  const [selectedCourierIds, setSelectedCourierIds] = useState<string[]>([])
  const [isOptimizing, setIsOptimizing] = useState(false)
  const [isApplying, setIsApplying] = useState(false)
  const [activeCourierTab, setActiveCourierTab] = useState<string>('all')
  const [searchCourierFilter, setSearchCourierFilter] = useState<string>('')
  const [vehicleFilter, setVehicleFilter] = useState<string>('all')

  // App Settings for Fuel Calculation
  const [appSettings, setAppSettings] = useState<AppSettingsRecord | null>(null)

  // Optimization Result
  const [optimizationResult, setOptimizationResult] =
    useState<MultiCourierOptimizationResult | null>(null)

  // Map state
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const markersAndPolylinesRef = useRef<any[]>([])
  const [isMapsLoaded, setIsMapsLoaded] = useState(false)
  const [mapsAuthError, setMapsAuthError] = useState(isGoogleMapsAuthError())

  const getGoogle = () =>
    typeof window !== 'undefined' ? (window as unknown as { google?: any }).google : undefined

  // Initialize selected couriers and load app settings when opened
  useEffect(() => {
    if (open) {
      const activeIds = couriers.filter((c) => c.status !== 'inactive').map((c) => c.id)
      setSelectedCourierIds(
        activeIds.length > 0 ? activeIds : couriers.slice(0, 3).map((c) => c.id),
      )
      setOptimizationResult(null)
      deliveryService.getSettings().then((s) => setAppSettings(s))
      loadGoogleMapsScript().then((success) => {
        setIsMapsLoaded(success && !isGoogleMapsAuthError())
      })
    }
  }, [open, couriers])

  useEffect(() => {
    const unsub = onGoogleMapsAuthError(() => {
      setMapsAuthError(true)
      setIsMapsLoaded(false)
    })
    return unsub
  }, [])

  const toggleCourierSelection = (id: string) => {
    setSelectedCourierIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    )
  }

  const selectAllCouriers = () => {
    setSelectedCourierIds(filteredCouriers.map((c) => c.id))
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
      const matchesVehicle = vehicleFilter === 'all' || c.vehicle_type === vehicleFilter
      return matchesSearch && matchesVehicle
    })
  }, [couriers, searchCourierFilter, vehicleFilter])

  // Multi-Courier Geographic K-Means Clustering + Nearest Neighbor Sequencing Algorithm
  const runRouteOptimization = async () => {
    if (selectedCourierIds.length === 0) {
      toast.warning('Selecione pelo menos um entregador disponível.')
      return
    }

    if (pendingOrders.length === 0) {
      toast.info('Não há entregas pendentes para roteirizar hoje.')
      return
    }

    setIsOptimizing(true)

    try {
      // 1. Prepare courier objects with starting locations
      const selectedCouriers = couriers.filter((c) => selectedCourierIds.includes(c.id))
      const k = selectedCouriers.length

      // Map courier origins (live GPS if available, else SP center fallback)
      const courierOrigins = selectedCouriers.map((c) => {
        const loc = locations.find((l) => l.user_id === c.id)
        return {
          courier: c,
          lat: loc?.lat || -23.55052 + (Math.random() - 0.5) * 0.04,
          lng: loc?.lng || -46.633308 + (Math.random() - 0.5) * 0.04,
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

      for (const ord of pendingOrders) {
        const cust = customers.find((c) => c.id === ord.customer_id)
        if (cust && cust.lat && cust.lng) {
          validOrdersWithCoords.push({
            order: ord,
            lat: cust.lat,
            lng: cust.lng,
            customer: cust,
          })
        } else {
          // Fallback coords around hub center if missing
          const hubLat = -23.55052 + (Math.random() - 0.5) * 0.02
          const hubLng = -46.633308 + (Math.random() - 0.5) * 0.02
          validOrdersWithCoords.push({
            order: ord,
            lat: hubLat,
            lng: hubLng,
            customer: cust,
          })
        }
      }

      // 3. Cluster Orders among K couriers (Balanced geographic nearest centroid assignment)
      // Initialize centroids at courier positions
      let centroids = courierOrigins.map((co) => ({ lat: co.lat, lng: co.lng }))
      const maxIter = 8
      let clusters: Array<typeof validOrdersWithCoords> = Array.from({ length: k }, () => [])

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
              1 + (clusters[ci].length / Math.max(1, validOrdersWithCoords.length / k)) * 0.25
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

      // 4. For each courier cluster, sequence stops via Nearest Neighbor TSP with priority weights
      const plans: CourierOptimizationPlan[] = []
      let grandTotalDistanceMeters = 0

      for (let ci = 0; ci < k; ci++) {
        const courierData = courierOrigins[ci]
        const clusterOrders = clusters[ci]
        const colorItem = COURIER_PALETTE[ci % COURIER_PALETTE.length]

        const unvisited = [...clusterOrders]
        const stops: OptimizedStop[] = []
        let curLat = courierData.lat
        let curLng = courierData.lng
        let clusterDistMeters = 0

        while (unvisited.length > 0) {
          let bestIdx = -1
          let bestScore = Infinity

          for (let i = 0; i < unvisited.length; i++) {
            const candidate = unvisited[i]
            const d = haversineDistance(curLat, curLng, candidate.lat, candidate.lng)

            // Urgent weight bonus
            let weight = 1.0
            if (candidate.order.priority === 'urgent') weight = 0.35
            else if (candidate.order.priority === 'high') weight = 0.7

            const score = d * weight
            if (score < bestScore) {
              bestScore = score
              bestIdx = i
            }
          }

          if (bestIdx >= 0) {
            const chosen = unvisited.splice(bestIdx, 1)[0]
            const actualD = haversineDistance(curLat, curLng, chosen.lat, chosen.lng)
            clusterDistMeters += actualD
            curLat = chosen.lat
            curLng = chosen.lng

            stops.push({
              id: chosen.order.id,
              tracking_code: chosen.order.tracking_code,
              priority: chosen.order.priority || 'normal',
              status: chosen.order.status,
              customer_name: chosen.customer?.name || 'Cliente',
              address: chosen.customer?.address || 'Endereço a confirmar',
              lat: chosen.lat,
              lng: chosen.lng,
              step_distance_meters: Math.round(actualD),
              cumulative_distance_meters: Math.round(clusterDistMeters),
            })
          } else {
            break
          }
        }

        grandTotalDistanceMeters += clusterDistMeters
        const estMinutes = Math.round((clusterDistMeters / 1000) * 3.2 + stops.length * 6)
        const distKmNum = clusterDistMeters / 1000
        const fuelPrice = appSettings?.fuel_price_per_liter || 5.59
        const fuelCons = appSettings?.fuel_consumption_kml || 35.0
        const planFuelCost = (distKmNum * fuelPrice) / fuelCons

        plans.push({
          courier: courierData.courier,
          color: colorItem.color,
          orders: clusterOrders.map((co) => co.order),
          stops,
          total_distance_km: distKmNum.toFixed(1),
          estimated_duration_minutes: estMinutes,
          estimated_fuel_cost: Number(planFuelCost.toFixed(2)),
        })
      }

      const grandDistKm = grandTotalDistanceMeters / 1000
      const totalFuelPrice = appSettings?.fuel_price_per_liter || 5.59
      const totalFuelCons = appSettings?.fuel_consumption_kml || 35.0
      const totalFuelCost = (grandDistKm * totalFuelPrice) / totalFuelCons
      const totalEstDuration = plans.reduce((acc, p) => acc + p.estimated_duration_minutes, 0)

      const finalResult: MultiCourierOptimizationResult = {
        courierPlans: plans,
        unassignedOrders: unassignedWithoutCoords,
        totalOrders: validOrdersWithCoords.length,
        totalDistanceKm: grandDistKm.toFixed(1),
        totalEstimatedFuelCost: Number(totalFuelCost.toFixed(2)),
        totalDurationMinutes: totalEstDuration,
      }

      setOptimizationResult(finalResult)
      setActiveCourierTab('all')
      toast.success(
        `✨ ${finalResult.totalOrders} entregas otimizadas e divididas entre ${plans.length} entregadores!`,
      )
    } catch (err) {
      console.error('Optimization calculation error:', err)
      toast.error('Erro ao calcular otimização de rotas.')
    } finally {
      setIsOptimizing(false)
    }
  }

  // Render Visual Routes and Colored Markers on Google Map
  useEffect(() => {
    if (!open) return

    const google = getGoogle()
    if (!mapContainerRef.current || !google?.maps) return

    try {
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
          center: { lat: -23.55052, lng: -46.633308 },
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
      }

      // Clear previous overlays
      markersAndPolylinesRef.current.forEach((obj) => obj.setMap(null))
      markersAndPolylinesRef.current = []

      const bounds = new google.maps.LatLngBounds()
      let hasPoints = false

      if (optimizationResult) {
        // Draw each courier plan with its own color
        optimizationResult.courierPlans.forEach((plan, planIdx) => {
          const isTabActive = activeCourierTab === 'all' || activeCourierTab === plan.courier.id
          if (!isTabActive) return

          const pathCoords: Array<{ lat: number; lng: number }> = []

          // Courier origin
          const courierLoc = locations.find((l) => l.user_id === plan.courier.id)
          const startLat = courierLoc?.lat || -23.55052
          const startLng = courierLoc?.lng || -46.633308
          pathCoords.push({ lat: startLat, lng: startLng })
          bounds.extend(new google.maps.LatLng(startLat, startLng))
          hasPoints = true

          // Courier marker
          const courierMarker = new google.maps.Marker({
            position: { lat: startLat, lng: startLng },
            map: mapInstanceRef.current,
            title: `🛵 ${plan.courier.name} (Ponto Inicial)`,
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 6,
              fillColor: plan.color,
              fillOpacity: 1,
              strokeWeight: 2,
              strokeColor: '#ffffff',
              rotation: 45,
            },
          })
          markersAndPolylinesRef.current.push(courierMarker)

          // Delivery Stops markers & numbered badges
          plan.stops.forEach((stop, stopIdx) => {
            pathCoords.push({ lat: stop.lat, lng: stop.lng })
            bounds.extend(new google.maps.LatLng(stop.lat, stop.lng))

            // Custom colored SVG pin with number
            const stopMarker = new google.maps.Marker({
              position: { lat: stop.lat, lng: stop.lng },
              map: mapInstanceRef.current,
              title: `${stopIdx + 1}. ${stop.customer_name} (${stop.tracking_code})`,
              label: {
                text: `${stopIdx + 1}`,
                color: '#ffffff',
                fontWeight: 'bold',
                fontSize: '11px',
              },
              icon: {
                path: google.maps.SymbolPath.CIRCLE,
                scale: 12,
                fillColor: plan.color,
                fillOpacity: 0.95,
                strokeWeight: 2,
                strokeColor: '#ffffff',
              },
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
                  <p style="font-size: 10px; margin: 2px 0 0; color: #8b5cf6;">Distância: +${stop.step_distance_meters}m</p>
                </div>
              `,
            })

            stopMarker.addListener('click', () => {
              infoWindow.open(mapInstanceRef.current, stopMarker)
            })

            markersAndPolylinesRef.current.push(stopMarker)
          })

          // Route Polyline connection
          if (pathCoords.length > 1) {
            const polyline = new google.maps.Polyline({
              path: pathCoords,
              geodesic: true,
              strokeColor: plan.color,
              strokeOpacity: 0.85,
              strokeWeight: 4,
              map: mapInstanceRef.current,
            })
            markersAndPolylinesRef.current.push(polyline)
          }
        })
      } else {
        // Just show pending stops before optimization
        pendingOrders.forEach((o) => {
          const cust = customers.find((c) => c.id === o.customer_id)
          if (cust && cust.lat && cust.lng) {
            bounds.extend(new google.maps.LatLng(cust.lat, cust.lng))
            hasPoints = true

            const m = new google.maps.Marker({
              position: { lat: cust.lat, lng: cust.lng },
              map: mapInstanceRef.current,
              title: `${cust.name} - ${o.tracking_code}`,
              icon: 'https://maps.google.com/mapfiles/ms/icons/red-dot.png',
            })
            markersAndPolylinesRef.current.push(m)
          }
        })

        // Also show couriers
        couriers.forEach((c) => {
          const loc = locations.find((l) => l.user_id === c.id)
          if (loc && loc.lat && loc.lng) {
            bounds.extend(new google.maps.LatLng(loc.lat, loc.lng))
            hasPoints = true
            const cm = new google.maps.Marker({
              position: { lat: loc.lat, lng: loc.lng },
              map: mapInstanceRef.current,
              title: `🛵 ${c.name}`,
              icon: 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png',
            })
            markersAndPolylinesRef.current.push(cm)
          }
        })
      }

      if (hasPoints && mapInstanceRef.current) {
        mapInstanceRef.current.fitBounds(bounds, { top: 30, right: 30, bottom: 30, left: 30 })
      }
    } catch (e) {
      console.warn('Error rendering routes on map:', e)
    }
  }, [open, optimizationResult, activeCourierTab, pendingOrders, couriers, customers, locations])

  // Apply & Save Distribution: Updates orders in database with assigned courier and in_transit status
  const handleApplyDistribution = async () => {
    if (!optimizationResult || optimizationResult.courierPlans.length === 0) {
      toast.error('Gere a otimização antes de confirmar a distribuição.')
      return
    }

    setIsApplying(true)
    let assignedCount = 0

    try {
      const now = Date.now()

      for (const plan of optimizationResult.courierPlans) {
        for (let i = 0; i < plan.stops.length; i++) {
          const stop = plan.stops[i]
          // Progressive ETA estimation (e.g. +20 min, +35 min...)
          const etaTimestamp = new Date(now + (20 + i * 15) * 60 * 1000).toISOString()
          const stopDistanceKm = Number((stop.step_distance_meters / 1000).toFixed(2))
          const fuelPrice = appSettings?.fuel_price_per_liter || 5.59
          const fuelCons = appSettings?.fuel_consumption_kml || 35.0
          const stopFuelCost = Number(((stopDistanceKm * fuelPrice) / fuelCons).toFixed(2))

          await deliveryService.updateOrder(stop.id, {
            courier_id: plan.courier.id,
            status: 'in_transit',
            sequence: i + 1,
            distance_km: stopDistanceKm,
            estimated_duration_minutes: Math.round((stop.step_distance_meters / 1000) * 3.5 + 5),
            fuel_cost: stopFuelCost,
            estimated_arrival: etaTimestamp,
          })
          assignedCount++
        }

        // Send push notification to courier
        if (plan.stops.length > 0) {
          await deliveryService.createNotification({
            user_id: plan.courier.id,
            title: '✨ Nova Rota Otimizada Atribuída',
            message: `Você recebeu ${plan.stops.length} entregas organizadas na melhor sequência (${plan.total_distance_km} km total).`,
            type: 'order',
            read: false,
          })
        }
      }

      toast.success(
        `🎉 Sucesso! ${assignedCount} entregas distribuídas e despachadas para os entregadores!`,
      )
      onRoutesApplied()
      onOpenChange(false)
    } catch (err) {
      console.error('Error applying route distribution:', err)
      toast.error('Falha ao salvar atribuição das rotas.')
    } finally {
      setIsApplying(false)
    }
  }

  // REQUISITO 3: Edição da Otimização (Mover paradas para cima/baixo, remover da rota, reatribuir)
  const moveStopInPlan = (courierId: string, stopIndex: number, direction: 'up' | 'down') => {
    if (!optimizationResult) return

    setOptimizationResult((prev) => {
      if (!prev) return prev
      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id !== courierId) return p

        const newStops = [...p.stops]
        const targetIndex = direction === 'up' ? stopIndex - 1 : stopIndex + 1
        if (targetIndex < 0 || targetIndex >= newStops.length) return p

        const temp = newStops[stopIndex]
        newStops[stopIndex] = newStops[targetIndex]
        newStops[targetIndex] = temp

        return {
          ...p,
          stops: newStops,
        }
      })

      return {
        ...prev,
        courierPlans: newPlans,
      }
    })
  }

  const removeStopFromPlan = (courierId: string, stopIndex: number) => {
    if (!optimizationResult) return

    setOptimizationResult((prev) => {
      if (!prev) return prev
      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id !== courierId) return p
        const newStops = p.stops.filter((_, idx) => idx !== stopIndex)
        return {
          ...p,
          stops: newStops,
        }
      })

      return {
        ...prev,
        courierPlans: newPlans,
      }
    })
    toast.info('Parada removida da rota calculada.')
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

      const newPlans = prev.courierPlans.map((p) => {
        if (p.courier.id === fromCourierId) {
          return {
            ...p,
            stops: p.stops.filter((_, idx) => idx !== stopIndex),
          }
        }
        if (p.courier.id === toCourierId) {
          return {
            ...p,
            stops: [...p.stops, stopToMove],
          }
        }
        return p
      })

      return {
        ...prev,
        courierPlans: newPlans,
      }
    })
    toast.success('Entrega reatribuída para outro entregador.')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[94vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-bold text-slate-900 dark:text-white">
            <Sparkles className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
            Otimizador de Rotas & Distribuição da Frota
          </DialogTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Agrupe as entregas por proximidade geográfica e ordene automaticamente o melhor trajeto
            para cada entregador.
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* Step 1: Courier Selection & Pending Stats */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-900/50 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Users className="h-4 w-4 text-indigo-600" />
                <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                  1. Seleção Individual de Entregadores ({selectedCourierIds.length} selecionados)
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

            {/* Smart Filters (Search & Vehicle Type) */}
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
                  onClick={() => setVehicleFilter('moto')}
                  className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                    vehicleFilter === 'moto'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  🛵 Moto
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
                  🚗 Carro
                </button>
                <button
                  type="button"
                  onClick={() => setVehicleFilter('van')}
                  className={`text-[11px] px-2 py-0.5 rounded-md border transition ${
                    vehicleFilter === 'van'
                      ? 'bg-indigo-600 text-white border-indigo-600'
                      : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  🚐 Van
                </button>
              </div>
            </div>

            {/* Courier Toggles Grid - Permite marcar e desmarcar individualmente CADA entregador */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5 max-h-56 overflow-y-auto pr-1">
              {filteredCouriers.map((courier, idx) => {
                const isSelected = selectedCourierIds.includes(courier.id)
                const palette = COURIER_PALETTE[idx % COURIER_PALETTE.length]
                const isBusy = courier.status === 'busy'

                return (
                  <label
                    key={courier.id}
                    className={`flex items-center gap-2.5 p-2.5 rounded-xl border transition cursor-pointer select-none group relative ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-50/80 shadow-sm dark:bg-indigo-950/50 dark:border-indigo-500 ring-2 ring-indigo-500/30'
                        : 'border-slate-200 bg-white hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 opacity-80 hover:opacity-100'
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
                          {courier.vehicle_type === 'carro'
                            ? '🚗'
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
                          {isBusy ? '⚠️ Ocupado' : '🟢 Disponível'} •{' '}
                          {courier.vehicle_model || courier.vehicle_type || 'Moto'}
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

            {/* Action Bar: Run Optimizer */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-800">
              <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  📦 {pendingOrders.length} entregas pendentes
                </span>
                <span>•</span>
                <span>
                  {selectedCourierIds.length > 0
                    ? `~${Math.ceil(pendingOrders.length / selectedCourierIds.length)} por entregador`
                    : 'Nenhum entregador selecionado'}
                </span>
              </div>

              <Button
                type="button"
                onClick={runRouteOptimization}
                disabled={
                  isOptimizing || selectedCourierIds.length === 0 || pendingOrders.length === 0
                }
                className="h-9 px-4 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white font-semibold text-xs shadow-md shadow-indigo-500/20 flex items-center gap-2"
              >
                <Sparkles className="h-4 w-4" />
                {isOptimizing ? 'Otimizando Rotas...' : 'Calcular & Otimizar Distribuição'}
              </Button>
            </div>
          </div>
          {/* Step 2: Visual Map & Distribution Inspection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <Navigation className="h-3.5 w-3.5 text-indigo-600" />
                2. Visualização das Rotas Agrupadas no Mapa
              </Label>
              {optimizationResult && (
                <div className="flex items-center gap-2 text-xs">
                  <Badge
                    variant="outline"
                    className="text-emerald-700 bg-emerald-50 border-emerald-200 font-mono text-[11px]"
                  >
                    ✓ Total: {optimizationResult.totalDistanceKm} km
                  </Badge>
                </div>
              )}
            </div>

            {/* Google Map Display Container */}
            <div className="relative w-full h-64 sm:h-72 rounded-2xl overflow-hidden border border-slate-300 dark:border-slate-700 shadow-inner bg-slate-900">
              <div
                ref={mapContainerRef}
                className={`w-full h-full ${isMapsLoaded && !mapsAuthError ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
              />

              {/* Fallback canvas overlay if Google Maps is not available or auth error */}
              {(!isMapsLoaded || mapsAuthError) && (
                <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white z-10 select-none overflow-hidden">
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

                  {/* Nodes breakdown on visual map */}
                  <div className="relative z-20 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {optimizationResult?.courierPlans.slice(0, 6).map((plan) => (
                      <div
                        key={plan.courier.id}
                        className="bg-slate-900/90 backdrop-blur p-2 rounded-lg border border-slate-700 text-[11px] space-y-1"
                      >
                        <div className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 rounded-full"
                            style={{ backgroundColor: plan.color }}
                          />
                          <strong className="text-white truncate">{plan.courier.name}</strong>
                        </div>
                        <p className="text-slate-400 text-[10px]">
                          {plan.stops.length} paradas • {plan.total_distance_km} km
                        </p>
                      </div>
                    ))}
                    {!optimizationResult && (
                      <div className="col-span-full text-center text-xs text-slate-400 py-6">
                        Clique em &quot;Calcular &amp; Otimizar Distribuição&quot; para traçar as
                        rotas dos entregadores.
                      </div>
                    )}
                  </div>

                  <div className="relative z-20 text-[10px] text-slate-400">
                    💡 Sistema calcula sequenciamento TSP e agrupamento balanceado por proximidade.
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
                      Distância Total
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
                    3. Edição da Otimização (Reordenar, Remover e Reatribuir)
                  </Label>
                  <p className="text-[11px] text-slate-500">
                    Você pode subir/descer a prioridade das paradas ou mover pedidos entre
                    entregadores.
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
                            className="h-3 w-3 rounded-full shrink-0"
                            style={{ backgroundColor: plan.color }}
                          />
                          <p className="text-xs font-bold text-slate-900 dark:text-white">
                            {plan.courier.name}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <Badge className="bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-[10px] border">
                            {plan.stops.length} paradas • {plan.total_distance_km} km
                          </Badge>
                          <Badge className="bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 text-[10px] border-emerald-200">
                            ⛽ R$ {plan.estimated_fuel_cost.toFixed(2)}
                          </Badge>
                        </div>
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
                    </div>
                  ))}
              </div>
            </div>
          )}{' '}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Fechar
          </Button>
          <Button
            type="button"
            onClick={handleApplyDistribution}
            disabled={
              isApplying || !optimizationResult || optimizationResult.courierPlans.length === 0
            }
            className="bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/25 flex items-center gap-1.5"
          >
            <Check className="h-4 w-4" />
            {isApplying ? 'Atribuindo aos Entregadores...' : 'Confirmar & Atribuir Rotas'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
