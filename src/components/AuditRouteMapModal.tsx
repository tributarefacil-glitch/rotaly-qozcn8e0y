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
import { Route, AlertTriangle, RefreshCw, CheckCircle2 } from 'lucide-react'
import {
  OrderRecord,
  UserRecord,
  LocationRecord,
  RouteBatchTelemetryRecord,
  TelemetryGap,
  TelemetryDeviationSection,
} from '@/types/delivery'
import { MapDataService, CleanCoords } from '@/lib/mapDataService'
import { SharedRouteMap } from '@/components/SharedRouteMap'
import { loadGoogleMapsScript } from '@/lib/googleMaps'
import { fetchStreetRoute, LatLngPoint } from '@/services/osrmRoutingService'
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
  const [isReprocessing, setIsReprocessing] = useState<boolean>(false)
  const [telemetryRecord, setTelemetryRecord] = useState<RouteBatchTelemetryRecord | null>(null)
  const [telemetryPings, setTelemetryPings] = useState<LocationRecord[]>([])
  const [plannedRoutePoints, setPlannedRoutePoints] = useState<LatLngPoint[]>([])

  // Ordenar pedidos do lote por sequence
  const sortedBatchOrders = useMemo(() => {
    return [...batchOrders].sort((a, b) => (a.sequence || 0) - (b.sequence || 0))
  }, [batchOrders])

  // Identificar coordenadas da base: sempre a Base Pilar (-22.6977499, -43.2936013) como origem oficial
  const baseCoords: CleanCoords = useMemo(() => {
    return MapDataService.getOfficialBaseCoords()
  }, [])

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

  // Carregar dados canônicos gravados em route_batch_telemetry
  const loadCanonicalTelemetry = async () => {
    if (!batchKey) return
    setIsLoading(true)
    setLoadingError(null)

    try {
      // 1. Tentar ler registro canônico já processado no servidor pelo motor
      let canonicalRec = await deliveryService.getRouteBatchTelemetry(batchKey)

      // Fallback: se os pedidos têm batch_telemetry_id gravado, tentar por id direto
      if (!canonicalRec && sortedBatchOrders.length > 0) {
        const orderWithTelemetry = sortedBatchOrders.find((o) => (o as any).batch_telemetry_id)
        if (orderWithTelemetry && (orderWithTelemetry as any).batch_telemetry_id) {
          try {
            const byId = await deliveryService.getRouteBatchTelemetry(
              (orderWithTelemetry as any).batch_telemetry_id,
            )
            if (byId) canonicalRec = byId
          } catch {
            /* intentionally ignored */
          }
        }
      }

      setTelemetryRecord(canonicalRec)

      // 2. Buscar pings reais com a função canônica unificada (user_id + janela UTC)
      const courierId = courier?.id || sortedBatchOrders[0]?.courier_id
      if (courierId) {
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

        let rawPings: LocationRecord[] = []
        try {
          const startDate = new Date(startTs).toISOString()
          const endDate = new Date(endTs).toISOString()
          rawPings = await deliveryService.fetchCourierRoutePings({
            courierUserId: courierId,
            routeStartedAt: startDate,
            routeFinishedAt: endDate,
          })
        } catch {
          rawPings = locationsPool.filter((loc) => {
            if (loc.user_id !== courierId) return false
            const t = new Date(loc.created).getTime()
            return t >= startTs && t <= endTs
          })
        }

        const chronologicalPings = [...rawPings].sort(
          (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
        )

        const sanitizedPings: LocationRecord[] = []
        for (const loc of chronologicalPings) {
          const clean = MapDataService.cleanCoords(loc.lat, loc.lng)
          if (!clean) continue
          if (typeof loc.accuracy === 'number' && loc.accuracy > 100) continue
          sanitizedPings.push({
            ...loc,
            lat: clean.lat,
            lng: clean.lng,
          })
        }
        setTelemetryPings(sanitizedPings)
      }

      // 3. Traçado viário planejado da rota otimizada (Base Pilar -> Clientes -> Volta à Base Pilar)
      const pilarBasePoint: LatLngPoint = { lat: baseCoords.lat, lng: baseCoords.lng }
      const plannedWaypoints: LatLngPoint[] = [
        pilarBasePoint,
        ...clientStops.map((s) => ({ lat: s.coords.lat, lng: s.coords.lng })),
        pilarBasePoint, // Volta à base
      ]

      const fullRoadSegments: LatLngPoint[] = []
      if (plannedWaypoints.length >= 2) {
        for (let i = 0; i < plannedWaypoints.length - 1; i++) {
          const pFrom = plannedWaypoints[i]
          const pTo = plannedWaypoints[i + 1]
          try {
            const leg = await fetchStreetRoute(pFrom, pTo)
            if (leg.isRealStreetRoute && leg.coordinates && leg.coordinates.length >= 2) {
              if (fullRoadSegments.length > 0) {
                fullRoadSegments.push(...leg.coordinates.slice(1))
              } else {
                fullRoadSegments.push(...leg.coordinates)
              }
            }
          } catch {
            /* intentionally ignored */
          }
        }
      }
      setPlannedRoutePoints(fullRoadSegments)
    } catch (err: any) {
      console.warn('[AuditRouteMapModal] Erro ao carregar dados:', err)
      setLoadingError(err?.message || 'Falha ao carregar dados do lote.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (!isOpen || !batchKey) return
    loadCanonicalTelemetry()
  }, [isOpen, batchKey])

  // Disparar reprocessamento pelo endpoint canônico
  const handleReprocessBatch = async () => {
    if (!batchKey || isReprocessing) return
    setIsReprocessing(true)
    try {
      const res = await deliveryService.reprocessRouteBatchTelemetry(batchKey)
      if (res.success) {
        await loadCanonicalTelemetry()
      } else {
        setLoadingError(res.error || 'Falha ao processar lote no servidor')
      }
    } catch (err: any) {
      setLoadingError(err?.message || 'Erro inesperado ao reprocessar lote')
    } finally {
      setIsReprocessing(false)
    }
  }

  // Renderizar o mapa Google Maps usando os dados canônicos
  useEffect(() => {
    if (!isOpen || isLoading || loadingError) return
    // Se ainda está aguardando processamento no motor e não tem registro, não desenha mapa vazio de classificação
    if (!telemetryRecord && !plannedRoutePoints.length) return
    if (!mapContainerRef.current) return

    let isDisposed = false

    const renderMap = async () => {
      const mapsLoaded = await loadGoogleMapsScript()
      if (!mapsLoaded || isDisposed) return

      const winGoogle = (window as any).google
      if (!winGoogle?.maps) return

      // Limpar objetos anteriores
      polylinesRef.current.forEach((poly) => safeSetMap(poly, null))
      polylinesRef.current = []
      markersRef.current.forEach((m) => safeSetMap(m, null))
      markersRef.current = []

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

      // 1. PIN 🏠 BASE em (-22.6977499, -43.2936013)
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

        const plannedPolyline = new winGoogle.maps.Polyline({
          path: plannedPath,
          geodesic: false,
          strokeColor: '#2563EB', // Azul #2563EB
          strokeOpacity: 0.85,
          strokeWeight: 5,
          zIndex: 100,
          map,
        })
        polylinesRef.current.push(plannedPolyline)

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

      // 3. TRILHA REAL DO ENTREGADOR (LINHA VERMELHA) + LACUNAS COMO BURACO / TRACEJADO CINZA
      // Se houver registro canônico route_batch_telemetry:
      // Identificar intervalos de lacuna registrados em telemetry_gaps.
      // Entre pings separados por lacuna (>90s): NUNCA linha contínua, desenhar tracejado cinza "lacuna de telemetria"
      const recordedGaps: TelemetryGap[] = telemetryRecord?.telemetry_gaps || []
      const recordedDeviations: TelemetryDeviationSection[] =
        telemetryRecord?.deviation_classification || []

      function isGapBetween(t1Iso: string, t2Iso: string): TelemetryGap | undefined {
        const ms1 = new Date(t1Iso).getTime()
        const ms2 = new Date(t2Iso).getTime()
        return recordedGaps.find((g) => {
          const gStart = new Date(g.start_iso).getTime()
          const gEnd = new Date(g.end_iso).getTime()
          return (
            (ms1 >= gStart - 2000 && ms2 <= gEnd + 2000) ||
            Math.abs(ms2 - ms1) >= (g.duration_seconds - 5) * 1000
          )
        })
      }

      function isDeviatedTime(tIso: string): boolean {
        const tMs = new Date(tIso).getTime()
        return recordedDeviations.some((dev) => {
          const sMs = new Date(dev.start_iso).getTime()
          const eMs = new Date(dev.end_iso).getTime()
          return tMs >= sMs && tMs <= eMs
        })
      }

      if (telemetryPings.length >= 2) {
        for (let i = 0; i < telemetryPings.length - 1; i++) {
          const p1 = telemetryPings[i]
          const p2 = telemetryPings[i + 1]
          const t1 = new Date(p1.created).getTime()
          const t2 = new Date(p2.created).getTime()
          const dtSec = Math.max(0, (t2 - t1) / 1000)

          const gapInfo =
            isGapBetween(p1.created, p2.created) ||
            (dtSec > 90 ? { duration_minutes: Math.round(dtSec / 60) } : null)

          if (gapInfo) {
            // LACUNA DE TELEMETRIA: DESENHADA COMO BURACO (tracejado cinza com rótulo, nunca linha reta sólida vermelha)
            const lineSymbol = {
              path: 'M 0,-1 0,1',
              strokeOpacity: 0.8,
              strokeColor: '#94A3B8',
              scale: 3,
            }
            const gapPolyline = new winGoogle.maps.Polyline({
              path: [
                { lat: p1.lat, lng: p1.lng },
                { lat: p2.lat, lng: p2.lng },
              ],
              strokeOpacity: 0,
              icons: [
                {
                  icon: lineSymbol,
                  offset: '0',
                  repeat: '15px',
                },
              ],
              zIndex: 150,
              map,
            })
            polylinesRef.current.push(gapPolyline)

            // Marcador visual de lacuna no ponto médio
            const midLat = (p1.lat + p2.lat) / 2
            const midLng = (p1.lng + p2.lng) / 2
            const gapMarker = new winGoogle.maps.Marker({
              position: { lat: midLat, lng: midLng },
              map,
              title: `Lacuna de Telemetria (~${gapInfo.duration_minutes || Math.round(dtSec / 60)} min sem sinal GPS)`,
              zIndex: 300,
              icon: {
                url: `data:image/svg+xml;utf-8,${encodeURIComponent(`
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" fill="#F59E0B" stroke="#FFFFFF" stroke-width="2"/>
                    <text x="12" y="16" font-size="12" font-family="sans-serif" font-weight="bold" text-anchor="middle" fill="#FFFFFF">⚠️</text>
                  </svg>
                `)}`,
                scaledSize: new winGoogle.maps.Size(24, 24),
                anchor: new winGoogle.maps.Point(12, 12),
              },
            })
            markersRef.current.push(gapMarker)
          } else {
            // SEGMENTO REAL CONTÍNUO:
            // Vermelho = pings reais cronológicos com desvio classificado pelo motor,
            // ou verde se dentro do corredor canônico
            const isOff = isDeviatedTime(p2.created)
            const strokeColor = isOff ? '#DC2626' : '#10B981'

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
          }

          safeExtendBounds(bounds, p1)
          safeExtendBounds(bounds, p2)
          hasCoordsInBounds = true
        }

        // Marcadores de início e fim da trilha
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
      }

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
  }, [
    isOpen,
    isLoading,
    loadingError,
    baseCoords,
    clientStops,
    plannedRoutePoints,
    telemetryPings,
    telemetryRecord,
  ])

  const gapsCount = telemetryRecord?.gaps_count || telemetryRecord?.telemetry_gaps?.length || 0
  const deviationsCount = telemetryRecord?.deviation_classification?.length || 0
  const maxDevRecorded =
    telemetryRecord?.deviation_classification?.reduce(
      (m, d) => Math.max(m, d.max_deviation_meters || 0),
      0,
    ) || 0

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
                  Mapa de Auditoria Canônica de Desvio e Telemetria
                </DialogTitle>
                {telemetryRecord && telemetryRecord.status === 'processed' ? (
                  <>
                    <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-mono font-bold text-xs">
                      Motor Canônico v0.0.451
                    </Badge>
                    {divergencePct !== undefined && divergencePct > 0 && (
                      <Badge className="bg-rose-100 text-rose-800 border-rose-300 font-mono font-bold text-xs">
                        +{divergencePct}% desvio
                      </Badge>
                    )}
                  </>
                ) : (
                  <Badge className="bg-amber-100 text-amber-800 border-amber-300 font-mono font-bold text-xs">
                    Aguardando Processamento
                  </Badge>
                )}
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
                {telemetryRecord && (
                  <span className="ml-2 font-mono text-slate-700">
                    · <strong>{telemetryRecord.km_gps_total?.toFixed(2)} km</strong> GPS /{' '}
                    <strong>{telemetryRecord.km_viario_total?.toFixed(2)} km</strong> viário
                    (Oficial:{' '}
                    <strong className="text-emerald-700">
                      {telemetryRecord.km_oficial?.toFixed(2)} km
                    </strong>
                    )
                  </span>
                )}
              </DialogDescription>
            </div>

            {/* BOTÃO PARA DISPARAR ENDPOINT DE REPROCESSAMENTO SE NÃO PROCESSADO OU DESEJADO */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleReprocessBatch}
                disabled={isReprocessing}
                className="h-8 text-xs font-semibold gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-100"
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${isReprocessing ? 'animate-spin text-[#0052CC]' : ''}`}
                />
                {isReprocessing ? 'Reprocessando...' : 'Reprocessar Lote'}
              </Button>
            </div>
          </div>

          {/* LEGENDA OBRIGATÓRIA CANÔNICA */}
          <div className="mt-3 pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              {/* Linha Azul = Rota Viária Planejada */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#2563EB] shadow-xs" />
                <span className="font-semibold text-slate-700">Rota Viária Planejada (OSRM)</span>
              </div>

              {/* Segmento Verde = No Corredor */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#10B981] shadow-xs" />
                <span className="font-semibold text-emerald-700">Trilha no Corredor</span>
              </div>

              {/* Linha Vermelha = Pings Reais Cronológicos / Desvio */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1.5 rounded-full bg-[#DC2626] shadow-xs" />
                <span className="font-semibold text-rose-700">
                  Pings Reais Cronológicos / Desvio
                </span>
              </div>

              {/* Lacuna de Telemetria = Tracejado Cinza / Buraco */}
              <div className="flex items-center gap-1.5">
                <span className="w-5 h-1 border-b-2 border-dashed border-slate-400" />
                <span className="font-semibold text-slate-600">
                  Lacuna de Telemetria (sem sinal)
                </span>
              </div>

              {/* Pin Base */}
              <div className="flex items-center gap-1">
                <span className="text-sm">🏠</span>
                <span className="font-semibold text-slate-700">Base Pilar</span>
              </div>
            </div>

            {/* Resumo canônico gravado */}
            <div className="flex items-center gap-2 text-[11px] font-mono text-slate-500">
              <span>{telemetryRecord?.pings_count || telemetryPings.length} pings gravados</span>
              {gapsCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-amber-300 text-amber-800 bg-amber-50 text-[10px] font-bold"
                >
                  ⚠️ {gapsCount} lacuna(s)
                </Badge>
              )}
              {deviationsCount > 0 && (
                <Badge
                  variant="outline"
                  className="border-rose-300 text-rose-700 bg-rose-50 text-[10px] font-bold"
                >
                  🚨 {deviationsCount} desvio(s) canônico(s)
                </Badge>
              )}
            </div>
          </div>
        </DialogHeader>

        {/* ÁREA DO MAPA COMPARTILHADO ÚNICO DE ROTA (1 MAPA POR ROTA) */}
        <div className="relative w-full p-4 bg-slate-950">
          {isLoading && (
            <div className="p-8 text-center text-slate-300">
              <RefreshCw className="h-6 w-6 text-blue-400 animate-spin mx-auto mb-2" />
              <p className="text-xs">Carregando telemetria canônica...</p>
            </div>
          )}

          {!isLoading && !loadingError && (
            <SharedRouteMap
              batchKey={batchKey}
              batchDisplay={batchDisplay}
              courier={courier}
              orders={sortedBatchOrders}
              pings={telemetryPings}
              plannedWaypoints={plannedRoutePoints}
              isFinishedHistorical={true}
              height={520}
            />
          )}

          {/* ESTADO DE ERRO */}
          {loadingError && !isLoading && (
            <div className="p-8 text-center bg-slate-900 text-white rounded-xl">
              <AlertTriangle className="h-8 w-8 text-amber-500 mx-auto mb-2" />
              <p className="font-bold text-sm">Não foi possível carregar o mapa</p>
              <p className="text-xs text-slate-400 mt-1 max-w-md mx-auto">{loadingError}</p>
              <Button variant="outline" size="sm" onClick={onClose} className="mt-4 text-xs">
                Fechar
              </Button>
            </div>
          )}
        </div>

        {/* RODAPÉ INFORMATIVO */}
        <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-3 text-slate-600">
            <span>
              Entregas no lote: <strong>{batchOrders.length}</strong>
            </span>
            <span>•</span>
            {telemetryRecord ? (
              <>
                <span>
                  KM GPS Canônico:{' '}
                  <strong className="text-purple-700">
                    {telemetryRecord.km_gps_total?.toFixed(2)} km
                  </strong>
                </span>
                <span>•</span>
                <span>
                  KM Viário:{' '}
                  <strong className="text-blue-700">
                    {telemetryRecord.km_viario_total?.toFixed(2)} km
                  </strong>
                </span>
                <span>•</span>
                <span>
                  KM Oficial:{' '}
                  <strong className="text-emerald-700">
                    {telemetryRecord.km_oficial?.toFixed(2)} km
                  </strong>
                </span>
                {maxDevRecorded > 0 && (
                  <>
                    <span>•</span>
                    <span>
                      Desvio Máx Canônico:{' '}
                      <strong className="text-rose-700">{maxDevRecorded} m</strong>
                    </span>
                  </>
                )}
              </>
            ) : (
              <span className="text-amber-700 italic">
                Aguardando registro de telemetria processado no servidor...
              </span>
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
