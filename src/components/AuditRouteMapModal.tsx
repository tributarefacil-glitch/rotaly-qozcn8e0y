import React, { useEffect, useRef, useState, useMemo } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Route, MapPin, AlertTriangle, CheckCircle2, RefreshCw, X } from 'lucide-react'
import { OrderRecord, UserRecord, LocationRecord } from '@/types/delivery'
import { MapDataService, CleanCoords, OFFICIAL_FALLBACK_BASE_COORDS } from '@/lib/mapDataService'
import { loadGoogleMapsScript } from '@/lib/googleMaps'
import { fetchStreetRoute, LatLngPoint } from '@/services/osrmRoutingService'
import { pointToSegmentDistanceMeters } from '@/lib/telemetryKmEngine'
import { safeSetMap, safeExtendBounds } from '@/lib/safeMapOps'
import { deliveryService } from '@/services/deliveryService'

export interface AuditRouteMapModalProps {
  isOpen: boolean
  onClose: () => void
  batchKey: string
  batchDisplay?: string
  batchOrders: OrderRecord[]
  courier?: UserRecord
  divergenceKm?: number
  divergencePct?: number
  locationsPool?: LocationRecord[]
}

export const AuditRouteMapModal: React.FC<AuditRouteMapModalProps> = ({
  isOpen,
  onClose,
  batchKey,
  batchDisplay,
  batchOrders,
  courier,
  divergenceKm,
  divergencePct,
  locationsPool = [],
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const polylinesRef = useRef<any[]>([])
  const markersRef = useRef<any[]>([])

  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [loadingError, setLoadingError] = useState<string | null>(null)
  const [telemetryPings, setTelemetryPings] = useState<LocationRecord[]>([])
  const [plannedRoutePoints, setPlannedRoutePoints] = useState<LatLngPoint[]>([])
  const [deviationStats, setDeviationStats] = useState<{
    totalPings: number
    onTrackCount: number
    deviatedCount: number
    maxDeviationMeters: number
  }>({
    totalPings: 0,
    onTrackCount: 0,
    deviatedCount: 0,
    maxDeviationMeters: 0,
  })

  // Ordenar pedidos do lote por sequence
  const sortedBatchOrders = useMemo(() => {
    return [...batchOrders].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
  }, [batchOrders])

  // Item (E2): pernas com origem 'estimada_1.3x' usam tolerância 120m em vez de 50m
  const hasEstimatedLegs = useMemo(() => {
    return sortedBatchOrders.some(
      (o) =>
        o.calculation_source === 'estimada_1.3x' ||
        o.calculation_source === 'estimated_straight_line',
    )
  }, [sortedBatchOrders])

  // Identificar coordenadas da base e paradas de clientes sanitizadas
  const baseCoords: CleanCoords = useMemo(() => {
    const firstWithBase = sortedBatchOrders.find((o) => o.start_base_lat && o.start_base_lng)
    if (firstWithBase) {
      const clean = MapDataService.cleanCoords(
        firstWithBase.start_base_lat,
        firstWithBase.start_base_lng,
      )
      if (clean) return clean
    }
    return MapDataService.getOfficialBaseCoords()
  }, [sortedBatchOrders])

  const clientStops: Array<{ order: OrderRecord; coords: CleanCoords; title: string }> =
    useMemo(() => {
      const stops: Array<{ order: OrderRecord; coords: CleanCoords; title: string }> = []
      sortedBatchOrders.forEach((order) => {
        const dest = MapDataService.getOrderDestination(order)
        if (dest) {
          const custName =
            order.expand?.customer_id?.name ||
            order.customer_name ||
            `Pedido ${order.tracking_code || order.id.slice(0, 6)}`
          stops.push({
            order,
            coords: dest,
            title: custName,
          })
        }
      })
      return stops
    }, [sortedBatchOrders])

  // Buscar pings reais de telemetria do lote
  useEffect(() => {
    if (!isOpen || !batchKey) return

    let isMounted = true
    setIsLoading(true)
    setLoadingError(null)

    const loadData = async () => {
      try {
        const courierId = courier?.id || sortedBatchOrders[0]?.courier_id
        if (!courierId) {
          throw new Error('Entregador não identificado para este lote.')
        }

        // Determinar janela temporal do lote a partir dos pedidos
        const startedTimes = sortedBatchOrders
          .map((o) => (o.route_started_at ? new Date(o.route_started_at).getTime() : 0))
          .filter((t) => t > 0)
        const finishedTimes = sortedBatchOrders
          .map((o) =>
            o.route_finished_at
              ? new Date(o.route_finished_at).getTime()
              : o.actual_arrival
                ? new Date(o.actual_arrival).getTime()
                : 0,
          )
          .filter((t) => t > 0)

        const startTs =
          startedTimes.length > 0
            ? Math.min(...startedTimes) - 5 * 60 * 1000
            : sortedBatchOrders[0]?.created
              ? new Date(sortedBatchOrders[0].created).getTime() - 15 * 60 * 1000
              : Date.now() - 4 * 60 * 60 * 1000

        const endTs =
          finishedTimes.length > 0
            ? Math.max(...finishedTimes) + 30 * 60 * 1000
            : sortedBatchOrders[0]?.created
              ? new Date(sortedBatchOrders[0].created).getTime() + 4 * 60 * 60 * 1000
              : Date.now()

        // 1. Verificar se já temos pings no pool de locations da página
        const poolMatches = locationsPool.filter((loc) => {
          if (loc.user_id !== courierId) return false
          const t = new Date(loc.created).getTime()
          return t >= startTs && t <= endTs
        })

        let fetchedLocations: LocationRecord[] = poolMatches

        // Se o pool local tiver poucos ou nenhum ping, buscar sob demanda no backend
        if (fetchedLocations.length < 5) {
          try {
            const startDate = new Date(startTs).toISOString().replace('T', ' ').substring(0, 19)
            const endDate = new Date(endTs).toISOString().replace('T', ' ').substring(0, 19)
            const directLocs = await deliveryService.getCourierLocations(
              courierId,
              startDate,
              endDate,
            )
            if (directLocs && directLocs.length > 0) {
              fetchedLocations = directLocs
            }
          } catch (fetchErr) {
            console.warn('[AuditRouteMapModal] Erro ao buscar telemetria sob demanda:', fetchErr)
          }
        }

        // Sanitização estrita via MapDataService.cleanCoords (porta única)
        // Ordenados por created cronológico
        const sanitizedPings: LocationRecord[] = []
        fetchedLocations.forEach((loc) => {
          const clean = MapDataService.cleanCoords(loc.lat, loc.lng)
          if (clean) {
            sanitizedPings.push({
              ...loc,
              lat: clean.lat,
              lng: clean.lng,
            })
          }
        })

        sanitizedPings.sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())

        // 2. Traçado viário planejado completo da rota otimizada:
        // Base oficial -> Clientes na sequência otimizada -> Retorno à base
        const plannedWaypoints: LatLngPoint[] = [
          { lat: baseCoords.lat, lng: baseCoords.lng },
          ...clientStops.map((s) => ({ lat: s.coords.lat, lng: s.coords.lng })),
        ]

        // Adicionar volta única à base
        plannedWaypoints.push({ lat: baseCoords.lat, lng: baseCoords.lng })

        // Calcular traçado viário via fetchStreetRoute entre waypoints consecutivos
        // Proibido traçar linha reta entre pins!
        const fullRoadSegments: LatLngPoint[] = []

        if (plannedWaypoints.length >= 2) {
          for (let i = 0; i < plannedWaypoints.length - 1; i++) {
            const pFrom = plannedWaypoints[i]
            const pTo = plannedWaypoints[i + 1]
            try {
              const leg = await fetchStreetRoute(pFrom, pTo)
              if (leg.coordinates && leg.coordinates.length >= 2) {
                if (fullRoadSegments.length > 0) {
                  fullRoadSegments.push(...leg.coordinates.slice(1))
                } else {
                  fullRoadSegments.push(...leg.coordinates)
                }
              } else {
                if (fullRoadSegments.length === 0) fullRoadSegments.push(pFrom)
                fullRoadSegments.push(pTo)
              }
            } catch {
              if (fullRoadSegments.length === 0) fullRoadSegments.push(pFrom)
              fullRoadSegments.push(pTo)
            }
          }
        }

        if (isMounted) {
          setTelemetryPings(sanitizedPings)
          setPlannedRoutePoints(fullRoadSegments)
          setIsLoading(false)
        }
      } catch (err: any) {
        console.warn('[AuditRouteMapModal] Erro ao carregar mapa de auditoria:', err)
        if (isMounted) {
          setLoadingError(err?.message || 'Falha ao carregar dados do lote para auditoria.')
          setIsLoading(false)
        }
      }
    }

    loadData()

    return () => {
      isMounted = false
    }
  }, [isOpen, batchKey, sortedBatchOrders, courier, baseCoords, clientStops, locationsPool])

  // Inicializar e desenhar no Google Maps
  useEffect(() => {
    if (!isOpen || isLoading || loadingError) return
    if (!mapContainerRef.current) return

    let isDisposed = false

    const renderMap = async () => {
      const mapsLoaded = await loadGoogleMapsScript()
      if (!mapsLoaded || isDisposed) return

      const winGoogle = (window as any).google
      if (!winGoogle?.maps) return

      // Limpar polilinhas e marcadores anteriores
      polylinesRef.current.forEach((poly) => safeSetMap(poly, null))
      polylinesRef.current = []
      markersRef.current.forEach((m) => safeSetMap(m, null))
      markersRef.current = []

      // Criar instância do mapa se ainda não existir
      let map = mapInstanceRef.current
      if (!map) {
        map = new winGoogle.maps.Map(mapContainerRef.current, {
          center: { lat: baseCoords.lat, lng: baseCoords.lng },
          zoom: 14,
          mapTypeId: winGoogle.maps.MapTypeId.ROADMAP,
          zoomControl: true,
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
        mapInstanceRef.current = map
      }

      const bounds = new winGoogle.maps.LatLngBounds()
      let hasCoordsInBounds = false

      // 1. PIN 🏠 BASE em (-22.6977499, -43.2936013) ou base do lote
      const baseClean = MapDataService.cleanCoords(baseCoords.lat, baseCoords.lng)
      if (baseClean) {
        const baseMarker = new winGoogle.maps.Marker({
          position: { lat: baseClean.lat, lng: baseClean.lng },
          map,
          title: '🏠 BASE (Drogaria Mais Saudável Pilar)',
          zIndex: 900,
          icon: {
            url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
                <circle cx="20" cy="20" r="18" fill="#0052CC" stroke="#FFFFFF" stroke-width="3" />
                <text x="20" y="26" font-size="20" text-anchor="middle" fill="#FFFFFF">🏠</text>
              </svg>
            `)}`,
            scaledSize: new winGoogle.maps.Size(40, 40),
            anchor: new winGoogle.maps.Point(20, 20),
          },
        })
        markersRef.current.push(baseMarker)
        safeExtendBounds(bounds, baseClean)
        hasCoordsInBounds = true
      }

      // Pins dos clientes visitados na sequência do lote
      clientStops.forEach((stop, idx) => {
        const stopClean = MapDataService.cleanCoords(stop.coords.lat, stop.coords.lng)
        if (stopClean) {
          const seq = stop.order.sequence || idx + 1
          const clientMarker = new winGoogle.maps.Marker({
            position: { lat: stopClean.lat, lng: stopClean.lng },
            map,
            title: `${seq}. ${stop.title}`,
            zIndex: 500 + seq,
            icon: {
              url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
                  <circle cx="16" cy="16" r="14" fill="#0F172A" stroke="#FFFFFF" stroke-width="2.5" />
                  <text x="16" y="21" font-size="13" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#FFFFFF">${seq}</text>
                </svg>
              `)}`,
              scaledSize: new winGoogle.maps.Size(32, 32),
              anchor: new winGoogle.maps.Point(16, 16),
            },
          })
          markersRef.current.push(clientMarker)
          safeExtendBounds(bounds, stopClean)
          hasCoordsInBounds = true
        }
      })

      // 2. LINHA AZUL = Rota Otimizada Planejada do Lote (traçado viário completo por vias reais)
      if (plannedRoutePoints.length >= 2) {
        const plannedPath = plannedRoutePoints.map((pt) => ({ lat: pt.lat, lng: pt.lng }))

        // Linha externa azul
        const plannedPolyline = new winGoogle.maps.Polyline({
          path: plannedPath,
          geodesic: false,
          strokeColor: '#2563EB', // Azul #2563EB / #0052CC
          strokeOpacity: 0.85,
          strokeWeight: 5,
          zIndex: 100,
          map,
        })
        polylinesRef.current.push(plannedPolyline)

        // Linha interna de destaque azul claro
        const innerPlannedPolyline = new winGoogle.maps.Polyline({
          path: plannedPath,
          geodesic: false,
          strokeColor: '#93C5FD',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          zIndex: 101,
          map,
        })
        polylinesRef.current.push(innerPlannedPolyline)

        plannedPath.forEach((pt) => safeExtendBounds(bounds, pt))
        hasCoordsInBounds = true
      }

      // 3. PINGS REAIS DE TELEMETRIA DO LOTE:
      // Desenhados como segmentos entre pings consecutivos (ordenados por created).
      // Cada segmento colorido pela distância PERPENDICULAR do ping ao SEGMENTO mais próximo da rota planejada:
      // Item (E2): pernas com origem 'estimada_1.3x' usam tolerância 120m em vez de 50m na coloração verde/vermelho dos segmentos.
      // Pernas viárias normais mantêm 50m.
      const deviationToleranceMeters = hasEstimatedLegs ? 120 : 50

      let onTrack = 0
      let deviated = 0
      let maxDevM = 0

      if (telemetryPings.length >= 2) {
        for (let i = 0; i < telemetryPings.length - 1; i++) {
          const p1 = telemetryPings[i]
          const p2 = telemetryPings[i + 1]

          // Calcular distância perpendicular do ponto p2 à rota planejada (ao segmento mais próximo)
          let minPerpDistance = Infinity

          if (plannedRoutePoints.length >= 2) {
            for (let rIdx = 0; rIdx < plannedRoutePoints.length - 1; rIdx++) {
              const a = plannedRoutePoints[rIdx]
              const b = plannedRoutePoints[rIdx + 1]
              const dist = pointToSegmentDistanceMeters(p2.lat, p2.lng, a.lat, a.lng, b.lat, b.lng)
              if (dist < minPerpDistance) {
                minPerpDistance = dist
              }
            }
          } else {
            // Se não houver rota planejada viária por fallback, calcula distância à base
            minPerpDistance = pointToSegmentDistanceMeters(
              p2.lat,
              p2.lng,
              baseCoords.lat,
              baseCoords.lng,
              baseCoords.lat,
              baseCoords.lng,
            )
          }

          if (minPerpDistance > maxDevM && Number.isFinite(minPerpDistance)) {
            maxDevM = Math.round(minPerpDistance)
          }

          // Regra adaptativa Item (E2):
          // Pernas com origem 'estimada_1.3x': tolerância 120m (≤120m = verde, >120m = vermelho)
          // Pernas viárias normais: tolerância 50m (≤50m = verde, >50m = vermelho)
          const isDeviatedSegment = minPerpDistance > deviationToleranceMeters
          if (isDeviatedSegment) {
            deviated++
          } else {
            onTrack++
          }

          const strokeColor = isDeviatedSegment ? '#dc2626' : '#10B981'
          const segPolyline = new winGoogle.maps.Polyline({
            path: [
              { lat: p1.lat, lng: p1.lng },
              { lat: p2.lat, lng: p2.lng },
            ],
            geodesic: false,
            strokeColor,
            strokeOpacity: 0.95,
            strokeWeight: 4,
            zIndex: 200,
            map,
          })
          polylinesRef.current.push(segPolyline)

          safeExtendBounds(bounds, p1)
          safeExtendBounds(bounds, p2)
          hasCoordsInBounds = true
        }

        // Marcador do início do trajeto de telemetria
        const firstPing = telemetryPings[0]
        const lastPing = telemetryPings[telemetryPings.length - 1]

        const startPingMarker = new winGoogle.maps.Marker({
          position: { lat: firstPing.lat, lng: firstPing.lng },
          map,
          title: `Saída do Entregador: ${new Date(firstPing.created).toLocaleTimeString('pt-BR')}`,
          zIndex: 850,
          icon: {
            url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="9" fill="#10B981" stroke="#FFFFFF" stroke-width="2" />
                <circle cx="11" cy="11" r="4" fill="#FFFFFF" />
              </svg>
            `)}`,
            scaledSize: new winGoogle.maps.Size(22, 22),
            anchor: new winGoogle.maps.Point(11, 11),
          },
        })
        markersRef.current.push(startPingMarker)

        const endPingMarker = new winGoogle.maps.Marker({
          position: { lat: lastPing.lat, lng: lastPing.lng },
          map,
          title: `Último Ping: ${new Date(lastPing.created).toLocaleTimeString('pt-BR')}`,
          zIndex: 851,
          icon: {
            url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 22 22">
                <circle cx="11" cy="11" r="9" fill="#0F172A" stroke="#FFFFFF" stroke-width="2" />
                <circle cx="11" cy="11" r="4" fill="#10B981" />
              </svg>
            `)}`,
            scaledSize: new winGoogle.maps.Size(22, 22),
            anchor: new winGoogle.maps.Point(11, 11),
          },
        })
        markersRef.current.push(endPingMarker)
      } else if (telemetryPings.length === 1) {
        // Apenas um ping isolado registrado
        const single = telemetryPings[0]
        const singleMarker = new winGoogle.maps.Marker({
          position: { lat: single.lat, lng: single.lng },
          map,
          title: `Ping Telemetria: ${new Date(single.created).toLocaleTimeString('pt-BR')}`,
          zIndex: 850,
        })
        markersRef.current.push(singleMarker)
        safeExtendBounds(bounds, single)
        hasCoordsInBounds = true
      }

      setDeviationStats({
        totalPings: telemetryPings.length,
        onTrackCount: onTrack,
        deviatedCount: deviated,
        maxDeviationMeters: maxDevM,
      })

      // Ajustar visualização do mapa para englobar toda a rota e pings
      if (hasCoordsInBounds && !bounds.isEmpty()) {
        try {
          map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 })
        } catch (fitErr) {
          console.warn('[AuditRouteMapModal] Erro ao ajustar fitBounds:', fitErr)
        }
      }
    }

    renderMap()

    return () => {
      isDisposed = true
      polylinesRef.current.forEach((poly) => safeSetMap(poly, null))
      polylinesRef.current = []
      markersRef.current.forEach((m) => safeSetMap(m, null))
      markersRef.current = []
    }
  }, [isOpen, isLoading, loadingError, baseCoords, clientStops, plannedRoutePoints, telemetryPings])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl p-0 overflow-hidden rounded-2xl border-slate-200">
        {/* CABEÇALHO DO MODAL */}
        <DialogHeader className="p-4 pb-3 border-b border-slate-200 bg-white">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <DialogTitle className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Route className="h-5 w-5 text-[#0052CC]" />
                  Mapa de Auditoria de Desvio de Rota (Estilo Vuupt)
                </DialogTitle>
                <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-mono font-bold text-xs">
                  {divergencePct !== undefined ? `+${divergencePct}% desvio` : 'Desvio >20%'}
                </Badge>
              </div>
              <DialogDescription className="text-xs text-slate-500 mt-1">
                Lote:{' '}
                <strong className="font-mono text-slate-800">
                  {batchDisplay || batchKey.slice(0, 16)}
                </strong>{' '}
                · Entregador:{' '}
                <strong className="text-slate-800">
                  {courier?.name || courier?.email || 'Entregador'}
                </strong>{' '}
                · {batchOrders.length} entregas
              </DialogDescription>
            </div>
          </div>

          {/* LEGENDA OBRIGATÓRIA ESTILO VUUPT */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              {/* Linha Azul */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#2563EB] shadow-xs" />
                <span className="font-semibold text-slate-700">Rota Otimizada Planejada</span>
              </div>

              {/* Segmento Verde */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#10B981] shadow-xs" />
                <span className="font-semibold text-emerald-700">
                  Seguiu o planejado ({hasEstimatedLegs ? '≤120m' : '≤50m'})
                </span>
              </div>

              {/* Segmento Vermelho */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#dc2626] shadow-xs" />
                <span className="font-semibold text-rose-700">
                  Desvio do Entregador ({hasEstimatedLegs ? '&gt;120m' : '&gt;50m'})
                </span>
              </div>

              {/* Entrada na Legenda Item (E2): Tolerância estendida (perna estimada) */}
              {hasEstimatedLegs && (
                <div className="flex items-center gap-1.5">
                  <Badge
                    variant="outline"
                    className="border-amber-400 bg-amber-50 text-amber-800 text-[10px] font-bold py-0.5 px-2"
                  >
                    ⚡ Tolerância estendida (perna estimada: 120m)
                  </Badge>
                </div>
              )}

              {/* Pin Base */}
              <div className="flex items-center gap-1">
                <span className="text-sm">🏠</span>
                <span className="font-semibold text-slate-700">Base Pilar</span>
              </div>
            </div>

            {/* Resumo de pings */}
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <span>{deviationStats.totalPings} pings GPS</span>
              {deviationStats.deviatedCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-rose-300 text-rose-700 bg-rose-50 text-[10px] font-bold"
                >
                  {deviationStats.deviatedCount} segmentos fora
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* ÁREA DO MAPA GOOGLE MAPS */}
        <div className="relative w-full h-[520px] bg-slate-100">
          <div ref={mapContainerRef} className="absolute inset-0 w-full h-full z-0" />

          {/* ESTADO DE CARREGANDO */}
          {isLoading && (
            <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-xs flex flex-col items-center justify-center p-6 text-center">
              <RefreshCw className="h-8 w-8 text-[#0052CC] animate-spin mb-3" />
              <p className="font-bold text-slate-800 text-sm">
                Carregando traçado viário e pings de telemetria do lote...
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm">
                Calculando rota otimizada e distâncias perpendiculares ponto-segmento no estilo
                Vuupt.
              </p>
            </div>
          )}

          {/* ESTADO DE ERRO */}
          {loadingError && !isLoading && (
            <div className="absolute inset-0 z-20 bg-white/95 flex flex-col items-center justify-center p-6 text-center">
              <AlertTriangle className="h-10 w-10 text-amber-600 mb-2" />
              <p className="font-bold text-slate-900 text-sm">Não foi possível carregar o mapa</p>
              <p className="text-xs text-slate-500 mt-1 max-w-md">{loadingError}</p>
              <Button variant="outline" size="sm" onClick={onClose} className="mt-4 text-xs">
                Fechar
              </Button>
            </div>
          )}

          {/* AVISO QUANDO NÃO HÁ PINGS GRAVADOS */}
          {!isLoading && !loadingError && telemetryPings.length === 0 && (
            <div className="absolute top-4 left-4 right-4 z-10 p-3 bg-amber-50/95 border border-amber-300 rounded-xl shadow-md text-xs text-amber-900 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                <span>
                  <strong>Atenção:</strong> Nenhum ping de GPS gravado neste lote na janela temporal
                  informada. Apenas a rota otimizada planejada está sendo exibida.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* RODAPÉ INFORMATIVO */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-3 text-slate-600">
            <span>
              Entregas no lote: <strong>{batchOrders.length}</strong>
            </span>
            <span>•</span>
            <span>
              Pings no corredor:{' '}
              <strong className="text-emerald-700">{deviationStats.onTrackCount}</strong>
            </span>
            <span>•</span>
            <span>
              Pings fora ({hasEstimatedLegs ? '&gt;120m' : '&gt;50m'}):{' '}
              <strong className="text-rose-700">{deviationStats.deviatedCount}</strong>
            </span>
            {deviationStats.maxDeviationMeters > 0 && (
              <>
                <span>•</span>
                <span>
                  Desvio máx:{' '}
                  <strong className="text-rose-700">{deviationStats.maxDeviationMeters} m</strong>
                </span>
              </>
            )}
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onClose}
            className="text-xs h-8 px-4"
          >
            Fechar Mapa
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default AuditRouteMapModal
