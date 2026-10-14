import React, { useEffect, useRef, useState, useMemo } from 'react'
import { loadGoogleMapsScript } from '@/lib/googleMaps'
import { safeSetMap, safeExtendBounds } from '@/lib/safeMapOps'
import { MapDataService, CleanCoords } from '@/lib/mapDataService'
import { LatLngPoint, fetchStreetRoute } from '@/services/osrmRoutingService'
import { LocationRecord, OrderRecord, UserRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RefreshCw, Navigation, AlertTriangle, Layers } from 'lucide-react'

export interface RouteClientStop {
  id: string
  sequence: number
  customerName: string
  address?: string
  lat: number
  lng: number
  status?: string
}

export interface SharedRouteMapProps {
  // Lote e entregador
  batchKey?: string
  batchDisplay?: string
  courier?: UserRecord | null
  // Pedidos ou paradas da rota
  orders?: OrderRecord[]
  stops?: RouteClientStop[]
  // Pings reais da telemetria gravados em locations
  pings?: LocationRecord[]
  // Posição atual do veículo para animação em tempo real
  currentVehiclePos?: { lat: number; lng: number; heading?: number; speed?: number } | null
  // Traçado viário planejado pré-calculado (opcional; se omitido, calcula via OSRM)
  plannedWaypoints?: LatLngPoint[]
  // Se a rota está ativa ou finalizada historicamente
  isFinishedHistorical?: boolean
  // Altura do mapa
  height?: string | number
  // Modo de escopo: lote ativo por padrão, toggle para dia completo
  showFullDayToggle?: boolean
  fullDayActive?: boolean
  onToggleFullDay?: (active: boolean) => void
  // Callback ao selecionar cliente
  onSelectStop?: (stop: RouteClientStop) => void
  // Limiar de desvio em metros (padrão 150m)
  deviationThresholdMeters?: number
}

// Distância ponto a segmento (metros)
function distPointToSegmentMeters(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) {
    const latDiff = (px - ax) * 111139
    const lngDiff = (py - ay) * 111139 * Math.cos((ax * Math.PI) / 180)
    return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  const projX = ax + t * dx
  const projY = ay + t * dy
  const latDiff = (px - projX) * 111139
  const lngDiff = (py - projY) * 111139 * Math.cos((ax * Math.PI) / 180)
  return Math.sqrt(latDiff * latDiff + lngDiff * lngDiff)
}

export const SharedRouteMap: React.FC<SharedRouteMapProps> = ({
  batchKey,
  batchDisplay,
  courier,
  orders = [],
  stops: propStops,
  pings = [],
  currentVehiclePos,
  plannedWaypoints,
  isFinishedHistorical = false,
  height = '500px',
  showFullDayToggle = false,
  fullDayActive = false,
  onToggleFullDay,
  onSelectStop,
  deviationThresholdMeters = 150,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null)
  const mapInstanceRef = useRef<any>(null)
  const polylinesRef = useRef<any[]>([])
  const markersRef = useRef<any[]>([])
  const vehicleMarkerRef = useRef<any>(null)
  const animFrameRef = useRef<number | null>(null)

  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [mapsError, setMapsError] = useState(false)
  const [isRoutingRoad, setIsRoutingRoad] = useState(false)
  const [roadGeometry, setRoadGeometry] = useState<LatLngPoint[]>([])

  const baseCoords: CleanCoords = useMemo(() => {
    return MapDataService.getOfficialBaseCoords()
  }, [])

  // 1. Normalizar paradas de clientes a partir de propStops ou orders
  const normalizedStops: RouteClientStop[] = useMemo(() => {
    if (propStops && propStops.length > 0) {
      return [...propStops].sort((a, b) => a.sequence - b.sequence)
    }
    const derived: RouteClientStop[] = []
    const sortedOrders = [...orders].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
    sortedOrders.forEach((o, idx) => {
      const dest = MapDataService.getOrderDestination(o)
      if (dest) {
        const name =
          o.expand?.customer_id?.name || o.customer_name || `Parada ${o.sequence || idx + 1}`
        derived.push({
          id: o.id,
          sequence: o.sequence || idx + 1,
          customerName: name,
          address: o.end_address_text || o.notes,
          lat: dest.lat,
          lng: dest.lng,
          status: o.status,
        })
      }
    })
    return derived
  }, [propStops, orders])

  // 2. Traçado viário planejado da rota otimizada (Base Pilar -> Clientes na sequência -> Volta à Base Pilar)
  useEffect(() => {
    let isCancelled = false

    if (plannedWaypoints && plannedWaypoints.length >= 2) {
      setRoadGeometry(plannedWaypoints)
      return
    }

    if (normalizedStops.length === 0) {
      setRoadGeometry([])
      return
    }

    const computeRoad = async () => {
      setIsRoutingRoad(true)
      try {
        const pilarBasePoint: LatLngPoint = { lat: baseCoords.lat, lng: baseCoords.lng }
        const waypoints: LatLngPoint[] = [
          pilarBasePoint,
          ...normalizedStops.map((s) => ({ lat: s.lat, lng: s.lng })),
          pilarBasePoint,
        ]

        const fullSegments: LatLngPoint[] = []
        for (let i = 0; i < waypoints.length - 1; i++) {
          const from = waypoints[i]
          const to = waypoints[i + 1]
          try {
            const leg = await fetchStreetRoute(from, to)
            if (leg && leg.coordinates && leg.coordinates.length >= 2) {
              if (fullSegments.length > 0) {
                fullSegments.push(...leg.coordinates.slice(1))
              } else {
                fullSegments.push(...leg.coordinates)
              }
            } else {
              if (fullSegments.length === 0) fullSegments.push(from)
              fullSegments.push(to)
            }
          } catch {
            if (fullSegments.length === 0) fullSegments.push(from)
            fullSegments.push(to)
          }
        }

        if (!isCancelled) {
          setRoadGeometry(fullSegments)
        }
      } catch (err) {
        console.warn('[SharedRouteMap] Falha ao calcular traçado viário:', err)
      } finally {
        if (!isCancelled) setIsRoutingRoad(false)
      }
    }

    computeRoad()
    return () => {
      isCancelled = true
    }
  }, [normalizedStops, baseCoords, plannedWaypoints])

  // 3. Inicializar script do Google Maps
  useEffect(() => {
    let active = true
    loadGoogleMapsScript().then((ok) => {
      if (active) {
        if (ok) {
          setMapsLoaded(true)
          setMapsError(false)
        } else {
          setMapsError(true)
        }
      }
    })
    return () => {
      active = false
    }
  }, [])

  // 4. Renderização do mapa limpo, sem sobrecargas, com agrupamento/clusters e desvio real
  useEffect(() => {
    if (!mapsLoaded || mapsError || !mapContainerRef.current) return
    const winGoogle = (window as any).google
    if (!winGoogle?.maps) return

    let isDisposed = false

    // Inicializar instância de mapa se não existir
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
        styles: [{ featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] }],
      })
      mapInstanceRef.current = map
    }

    // Limpar polilinhas e marcadores anteriores
    polylinesRef.current.forEach((p) => safeSetMap(p, null))
    polylinesRef.current = []
    markersRef.current.forEach((m) => safeSetMap(m, null))
    markersRef.current = []

    const bounds = new winGoogle.maps.LatLngBounds()
    let hasCoords = false

    // (A) PIN DA BASE OFICIAL PILAR (-22.6977499, -43.2936013)
    const baseClean = MapDataService.cleanCoords(baseCoords.lat, baseCoords.lng)
    if (baseClean) {
      const baseMarker = new winGoogle.maps.Marker({
        position: { lat: baseClean.lat, lng: baseClean.lng },
        map,
        title: 'Base Oficial Pilar (Drogaria Mais Saudável)',
        zIndex: 900,
        icon: {
          url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="16" fill="#0052CC" stroke="#FFFFFF" stroke-width="3" />
              <text x="18" y="23" font-size="14" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#FFFFFF">BASE</text>
            </svg>
          `)}`,
          scaledSize: new winGoogle.maps.Size(36, 36),
          anchor: new winGoogle.maps.Point(18, 18),
        },
      })
      markersRef.current.push(baseMarker)
      safeExtendBounds(bounds, baseClean)
      hasCoords = true
    }

    // (B) PINS DE CLIENTES COM AGRUPAMENTO/CLUSTERING DINÂMICO
    // Clientes muito próximos (< 35 metros) são agrupados em badges [2], [3]
    const currentZoom = map.getZoom() || 14
    const clusterRadiusDeg = currentZoom >= 16 ? 0.00015 : 0.00035

    interface StopCluster {
      centerLat: number
      centerLng: number
      stops: RouteClientStop[]
    }
    const clusters: StopCluster[] = []

    normalizedStops.forEach((stop) => {
      const clean = MapDataService.cleanCoords(stop.lat, stop.lng)
      if (!clean) return
      let added = false
      for (const cl of clusters) {
        const dLat = Math.abs(cl.centerLat - clean.lat)
        const dLng = Math.abs(cl.centerLng - clean.lng)
        if (dLat < clusterRadiusDeg && dLng < clusterRadiusDeg) {
          cl.stops.push(stop)
          added = true
          break
        }
      }
      if (!added) {
        clusters.push({ centerLat: clean.lat, centerLng: clean.lng, stops: [stop] })
      }
    })

    clusters.forEach((cl) => {
      const isMulti = cl.stops.length > 1
      const firstStop = cl.stops[0]
      const labelText = isMulti ? `[${cl.stops.length}]` : `${firstStop.sequence}`
      const titleText = isMulti
        ? cl.stops.map((s) => `${s.sequence}. ${s.customerName}`).join(' | ')
        : `${firstStop.sequence}. ${firstStop.customerName}`

      const marker = new winGoogle.maps.Marker({
        position: { lat: cl.centerLat, lng: cl.centerLng },
        map,
        title: titleText,
        zIndex: isMulti ? 700 : 500 + firstStop.sequence,
        icon: {
          url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
            <svg xmlns="http://www.w3.org/2000/svg" width="${isMulti ? 38 : 32}" height="${isMulti ? 38 : 32}" viewBox="0 0 38 38">
              <circle cx="19" cy="19" r="${isMulti ? 17 : 14}" fill="${isMulti ? '#7C3AED' : '#0F172A'}" stroke="#FFFFFF" stroke-width="2.5" />
              <text x="19" y="24" font-size="${isMulti ? 13 : 13}" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#FFFFFF">${labelText}</text>
            </svg>
          `)}`,
          scaledSize: new winGoogle.maps.Size(isMulti ? 38 : 32, isMulti ? 38 : 32),
          anchor: new winGoogle.maps.Point(19, 19),
        },
      })

      marker.addListener('click', () => {
        if (isMulti) {
          map.setZoom((map.getZoom() || 14) + 2)
          map.panTo({ lat: cl.centerLat, lng: cl.centerLng })
        } else {
          onSelectStop?.(firstStop)
        }
      })

      markersRef.current.push(marker)
      safeExtendBounds(bounds, { lat: cl.centerLat, lng: cl.centerLng })
      hasCoords = true
    })

    // (C) LINHA AZUL: ROTA OTIMIZADA POR VIAS REAIS (PROIBIDO LINHA RETA)
    if (roadGeometry.length >= 2) {
      const plannedPath = roadGeometry.map((p) => ({ lat: p.lat, lng: p.lng }))
      const mainBlueLine = new winGoogle.maps.Polyline({
        path: plannedPath,
        geodesic: false,
        strokeColor: '#2563EB',
        strokeOpacity: 0.85,
        strokeWeight: 5,
        zIndex: 100,
        map,
      })
      const innerLine = new winGoogle.maps.Polyline({
        path: plannedPath,
        geodesic: false,
        strokeColor: '#93C5FD',
        strokeOpacity: 0.9,
        strokeWeight: 2,
        zIndex: 101,
        map,
      })
      polylinesRef.current.push(mainBlueLine, innerLine)
      plannedPath.forEach((pt) => safeExtendBounds(bounds, pt))
      hasCoords = true
    }

    // (D) LINHA DE DESVIO: SOMENTE PINGS REAIS A PARTIR DO PONTO DO DESVIO
    // Lacuna de telemetria (>90s) = buraco (gap / nunca linha reta)
    // Se afastamento da rota otimizada for > deviationThresholdMeters, colore em vermelho
    const sanitizedPings = pings
      .filter((p) => typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat))
      .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())

    if (sanitizedPings.length >= 2) {
      for (let i = 0; i < sanitizedPings.length - 1; i++) {
        const p1 = sanitizedPings[i]
        const p2 = sanitizedPings[i + 1]
        const t1 = new Date(p1.created).getTime()
        const t2 = new Date(p2.created).getTime()
        const dtSec = Math.max(0, (t2 - t1) / 1000)

        // Lacuna de telemetria = buraco (desenha tracejado discreto cinza ou pula; NUNCA linha reta contínua)
        if (dtSec > 90) {
          const gapLine = new winGoogle.maps.Polyline({
            path: [
              { lat: p1.lat, lng: p1.lng },
              { lat: p2.lat, lng: p2.lng },
            ],
            strokeOpacity: 0,
            icons: [
              {
                icon: {
                  path: 'M 0,-1 0,1',
                  strokeOpacity: 0.7,
                  strokeColor: '#94A3B8',
                  scale: 2.5,
                },
                offset: '0',
                repeat: '12px',
              },
            ],
            zIndex: 140,
            map,
          })
          polylinesRef.current.push(gapLine)
          continue
        }

        // Medir distância de p2 à rota otimizada
        let isDeviated = false
        if (roadGeometry.length >= 2) {
          let minD = Infinity
          for (let w = 0; w < roadGeometry.length - 1; w++) {
            const w1 = roadGeometry[w]
            const w2 = roadGeometry[w + 1]
            const d = distPointToSegmentMeters(p2.lat, p2.lng, w1.lat, w1.lng, w2.lat, w2.lng)
            if (d < minD) minD = d
          }
          if (minD > deviationThresholdMeters) {
            isDeviated = true
          }
        }

        // Onde ocorreu o desvio, fica uma nova linha colorida vermelha mostrando o desvio
        if (isDeviated) {
          const devPolyline = new winGoogle.maps.Polyline({
            path: [
              { lat: p1.lat, lng: p1.lng },
              { lat: p2.lat, lng: p2.lng },
            ],
            geodesic: false,
            strokeColor: '#DC2626', // Vermelho desvio
            strokeOpacity: 0.95,
            strokeWeight: 4,
            zIndex: 220,
            map,
          })
          polylinesRef.current.push(devPolyline)
        }

        safeExtendBounds(bounds, { lat: p1.lat, lng: p1.lng })
        safeExtendBounds(bounds, { lat: p2.lat, lng: p2.lng })
        hasCoords = true
      }
    }

    // (E) VEÍCULO ANIMADO EM TEMPO REAL
    // Usa currentVehiclePos ou último ping
    const effectiveVehiclePos =
      currentVehiclePos && typeof currentVehiclePos.lat === 'number'
        ? currentVehiclePos
        : sanitizedPings.length > 0
          ? {
              lat: sanitizedPings[sanitizedPings.length - 1].lat,
              lng: sanitizedPings[sanitizedPings.length - 1].lng,
            }
          : null

    if (effectiveVehiclePos) {
      const courierName = courier?.name || courier?.email || 'Entregador'
      if (!vehicleMarkerRef.current) {
        const vMarker = new winGoogle.maps.Marker({
          position: { lat: effectiveVehiclePos.lat, lng: effectiveVehiclePos.lng },
          map,
          title: `Veículo em Rota — ${courierName}`,
          zIndex: 999,
          icon: {
            url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
              <svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" viewBox="0 0 38 38">
                <circle cx="19" cy="19" r="16" fill="#10B981" stroke="#FFFFFF" stroke-width="3" />
                <text x="19" y="24" font-size="14" font-weight="bold" font-family="sans-serif" text-anchor="middle" fill="#FFFFFF">🛵</text>
              </svg>
            `)}`,
            scaledSize: new winGoogle.maps.Size(38, 38),
            anchor: new winGoogle.maps.Point(19, 19),
          },
        })
        vehicleMarkerRef.current = vMarker
        markersRef.current.push(vMarker)
      } else {
        // Animação suave para nova posição
        const targetPos = new winGoogle.maps.LatLng(
          effectiveVehiclePos.lat,
          effectiveVehiclePos.lng,
        )
        vehicleMarkerRef.current.setPosition(targetPos)
      }
      safeExtendBounds(bounds, effectiveVehiclePos)
      hasCoords = true
    }

    if (hasCoords && !bounds.isEmpty()) {
      try {
        map.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
      } catch {
        /* safe ignore */
      }
    }

    return () => {
      isDisposed = true
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current)
      polylinesRef.current.forEach((p) => safeSetMap(p, null))
      polylinesRef.current = []
      markersRef.current.forEach((m) => safeSetMap(m, null))
      markersRef.current = []
      vehicleMarkerRef.current = null
    }
  }, [
    mapsLoaded,
    mapsError,
    baseCoords,
    normalizedStops,
    roadGeometry,
    pings,
    currentVehiclePos,
    courier,
    deviationThresholdMeters,
  ])

  return (
    <div className="relative w-full rounded-2xl overflow-hidden border border-slate-200 bg-slate-900 shadow-sm">
      {/* BARRA SUPERIOR SIMPLES E LEVE: STATUS DA ROTA, HISTÓRICO E TOGGLE DIA COMPLETO */}
      <div className="p-3 bg-slate-900/95 border-b border-slate-800 text-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-blue-400" />
          <span className="font-bold text-white">
            {courier?.name || courier?.email || 'Entregador'}
          </span>
          {batchDisplay && (
            <span className="font-mono text-slate-400 text-[11px]">· {batchDisplay}</span>
          )}
          {isFinishedHistorical ? (
            <Badge className="bg-slate-800 text-slate-300 border-slate-700 font-bold text-[10px]">
              Rota finalizada — exibição histórica
            </Badge>
          ) : (
            <Badge className="bg-emerald-600/30 text-emerald-300 border-emerald-500/50 font-bold text-[10px] animate-pulse">
              Lote ativo em rota
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Toggle opcional Dia Completo (escopo padrão = lote ativo) */}
          {showFullDayToggle && onToggleFullDay && (
            <Button
              type="button"
              size="sm"
              variant={fullDayActive ? 'default' : 'outline'}
              onClick={() => onToggleFullDay(!fullDayActive)}
              className={`h-7 text-xs font-semibold px-2.5 gap-1.5 ${
                fullDayActive
                  ? 'bg-blue-600 text-white hover:bg-blue-700'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
              }`}
            >
              <Layers className="h-3 w-3" />
              {fullDayActive ? 'Dia Completo' : 'Lote Ativo'}
            </Button>
          )}

          {isRoutingRoad && (
            <span className="text-[11px] text-blue-300 flex items-center gap-1 font-mono">
              <RefreshCw className="h-3 w-3 animate-spin" />
              Calculando vias...
            </span>
          )}
        </div>
      </div>

      {/* ÁREA DO MAPA */}
      <div
        ref={mapContainerRef}
        className="w-full relative bg-slate-950"
        style={{ height: typeof height === 'number' ? `${height}px` : height }}
      >
        {mapsError && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center p-6 text-center bg-slate-900 text-white">
            <AlertTriangle className="h-8 w-8 text-amber-500 mb-2" />
            <p className="font-bold text-sm">Falha ao carregar Google Maps</p>
            <p className="text-xs text-slate-400 mt-1">Verifique a conexão de internet.</p>
          </div>
        )}
      </div>

      {/* LEGENDA MÍNIMA CONFORME ESPECIFICAÇÃO DO PRODUTO */}
      <div className="p-2.5 bg-slate-900 border-t border-slate-800 text-slate-300 flex flex-wrap items-center justify-between gap-3 text-[11px]">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-5 rounded-full bg-[#2563EB]" />
            <span>Rota otimizada (vias reais)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-5 rounded-full bg-[#DC2626]" />
            <span>Linha de desvio (pings reais)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-4 border-b border-dashed border-slate-400" />
            <span>Lacuna telemetria (sem sinal)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-full bg-emerald-500 inline-block" />
            <span>Veículo em tempo real</span>
          </div>
        </div>

        <div className="text-[10px] text-slate-400 font-mono">
          {normalizedStops.length} cliente(s) · {pings.length} pings GPS
        </div>
      </div>
    </div>
  )
}

export default SharedRouteMap
