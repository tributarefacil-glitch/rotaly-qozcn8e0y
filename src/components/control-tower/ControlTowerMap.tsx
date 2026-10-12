import React from 'react'
import { Activity, RefreshCw, AlertOctagon, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LiveMap, MapMarkerItem, getVehicleEmoji } from '@/components/LiveMap'
import { getCourierRouteColor } from '@/lib/courierRouteColors'
import { UserRecord, OrderRecord } from '@/types/delivery'
import { parseSafeTimestamp, formatTimeInTz } from '@/lib/operationalWindow'
import { LocationRecord } from '@/types/delivery'
import { diagnoseCourierTelemetry } from '@/lib/courierTelemetryDiagnostics'
import { ActiveRouteCourierData, ActiveRouteCalculatedItem, ControlTowerMetrics } from './utils'

export type MapDisplayMode = 'in_transit' | 'delivered'

interface ControlTowerMapProps {
  mapContainerRef: React.RefObject<HTMLDivElement | null>
  mapsLoaded: boolean
  mapsError: boolean
  handleRetryMaps: () => void
  mapDisplayMode: MapDisplayMode
  setMapDisplayMode: (mode: MapDisplayMode) => void
  activeRouteCouriers: ActiveRouteCourierData[]
  metrics: ControlTowerMetrics
  activeRoutesData: ActiveRouteCalculatedItem[]
  setSelectedCourier: (courier: UserRecord) => void
  isDeviationBannerDismissed: boolean
  setIsDeviationBannerDismissed: (val: boolean) => void
  isStopBannerDismissed: boolean
  setIsStopBannerDismissed: (val: boolean) => void
  dismissedGpsAlertIds: string[]
  setDismissedGpsAlertIds: React.Dispatch<React.SetStateAction<string[]>>
  isLegendExpanded: boolean
  setIsLegendExpanded: (val: boolean) => void
  controlTowerMapMarkers: MapMarkerItem[]
  couriers: UserRecord[]
  orders: OrderRecord[]
  handleOpenOrderDetails: (order: OrderRecord) => void
  locations?: LocationRecord[]
  isAutoFollow?: boolean
  setIsAutoFollow?: (val: boolean) => void
  onRecenterAutoFollow?: () => void
}

export const ControlTowerMap: React.FC<ControlTowerMapProps> = ({
  mapContainerRef,
  mapsLoaded,
  mapsError,
  handleRetryMaps,
  mapDisplayMode,
  setMapDisplayMode,
  activeRouteCouriers,
  metrics,
  activeRoutesData,
  setSelectedCourier,
  isDeviationBannerDismissed,
  setIsDeviationBannerDismissed,
  isStopBannerDismissed,
  setIsStopBannerDismissed,
  dismissedGpsAlertIds,
  setDismissedGpsAlertIds,
  isLegendExpanded,
  setIsLegendExpanded,
  controlTowerMapMarkers,
  couriers,
  orders,
  handleOpenOrderDetails,
  locations = [],
  isAutoFollow = true,
  setIsAutoFollow,
  onRecenterAutoFollow,
}) => {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-sm">
      <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#60A5FA]" />
          <h3 className="font-heading text-base font-bold text-white">
            Mapa de Rastreamento &amp; Frotas em Tempo Real
          </h3>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="flex items-center -space-x-1">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500 inline-block ring-1 ring-white/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block ring-1 ring-white/40" />
              <span className="h-2.5 w-2.5 rounded-full bg-orange-500 inline-block ring-1 ring-white/40" />
            </span>
            <span className="text-slate-300">Entregador &amp; Destino (mesma cor da rota)</span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" />
            <span className="text-slate-300">Disponível</span>
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 min-h-[460px]">
        {/* Mapa Interativo Principal: Google Maps nativo ou Canvas Vetorial de Contingência (LiveMap) */}
        <div className="relative w-full h-[400px] lg:h-[540px] bg-[#070D1E] overflow-hidden">
          {mapsLoaded && !mapsError ? (
            <>
              <div ref={mapContainerRef} className="w-full h-full" />

              {/* Abas e botão Auto-Follow sobre o mapa no canto superior direito */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoFollow?.(true)
                    onRecenterAutoFollow?.()
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg border backdrop-blur-md ${
                    isAutoFollow
                      ? 'bg-emerald-600 text-white border-emerald-400/50 hover:bg-emerald-500 ring-2 ring-emerald-400/40'
                      : 'bg-[#0A1128]/90 text-slate-300 border-[#1E2B58] hover:text-white hover:bg-slate-800/80'
                  }`}
                  title={
                    isAutoFollow
                      ? 'Auto-follow ativo (acompanhando entregador)'
                      : 'Clique para seguir entregador em rota'
                  }
                >
                  <span>🎯 Seguir</span>
                  {isAutoFollow && (
                    <span className="flex h-2 w-2 rounded-full bg-white animate-pulse" />
                  )}
                </button>

                <div className="flex items-center gap-1.5 bg-[#0A1128]/90 backdrop-blur-md p-1 rounded-xl border border-[#1E2B58] shadow-lg">
                  <button
                    type="button"
                    onClick={() => setMapDisplayMode('in_transit')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      mapDisplayMode === 'in_transit'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    <span>🛵 Em Rota ({activeRouteCouriers.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapDisplayMode('delivered')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      mapDisplayMode === 'delivered'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    <span>✓ Entregues ({metrics.delivered})</span>
                  </button>
                </div>
              </div>

              {/* Painel de status no canto superior esquerdo do Google Maps */}
              <div className="absolute top-3 left-3 z-10 flex flex-col gap-1.5 max-w-[340px]">
                {mapDisplayMode === 'delivered' ? (
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="font-semibold text-white truncate text-[11px]">
                      {metrics.delivered} entregas concluídas
                    </span>
                  </div>
                ) : activeRouteCouriers.length === 0 ? (
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-blue-400" />
                    <span className="font-semibold text-white truncate text-[11px]">
                      0 entregadores em rota
                    </span>
                  </div>
                ) : (
                  /* Pílula com o total + lista detalhada de cada entregador em rota (nome, tempo para terminar e voltar à base) */
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm rounded-lg border border-[#1E2B58] shadow-lg text-xs overflow-hidden flex flex-col">
                    <div className="px-2.5 py-1 border-b border-[#1E2B58]/70 flex items-center justify-between gap-2 bg-[#0E1738]/60">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                        <span className="font-bold text-white text-[11px]">
                          {activeRouteCouriers.length}{' '}
                          {activeRouteCouriers.length === 1
                            ? 'entregador em rota'
                            : 'entregadores em rota'}
                        </span>
                      </div>
                      <span className="text-[9.5px] text-slate-400 font-mono">
                        Toque para detalhes
                      </span>
                    </div>

                    <div className="flex flex-col divide-y divide-[#1E2B58]/50">
                      {activeRouteCouriers.map((item) => {
                        const rInfo = activeRoutesData.find((r) => r.courierId === item.courier.id)
                        const shift = rInfo?.shiftMetrics
                        const courierName = item.courier.name || item.courier.email || 'Entregador'
                        const vehicleEmoji = getVehicleEmoji(item.vehicle)
                        const courierColor = getCourierRouteColor(item.courier.id)

                        return (
                          <button
                            key={`top-shift-${item.courier.id}`}
                            type="button"
                            onClick={() => setSelectedCourier(item.courier)}
                            className="w-full text-left px-2.5 py-1.5 hover:bg-blue-950/40 transition flex flex-col gap-0.5 focus:outline-none"
                            title="Clique para ver detalhes do entregador"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-white text-[11px] truncate flex items-center gap-1.5">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-white/30"
                                  style={{ backgroundColor: courierColor.stroke }}
                                  title={`Cor da rota: ${courierColor.name}`}
                                />
                                <span>{vehicleEmoji}</span>
                                <span className="truncate">{courierName}</span>
                              </span>
                              <span className="text-[9.5px] text-slate-400 font-mono shrink-0">
                                ({item.inTransitCount} entrega
                                {item.inTransitCount === 1 ? '' : 's'})
                              </span>
                            </div>

                            <div className="text-[10.5px] text-blue-300 font-mono flex items-center justify-between gap-1">
                              {(() => {
                                const diag = diagnoseCourierTelemetry(
                                  item.courier.id,
                                  locations,
                                  item.lat,
                                  item.lng,
                                  item.speed,
                                  item.gps_status,
                                  item.gps_reason,
                                  item.location_timestamp,
                                  item.accuracy,
                                  item.offline_buffered,
                                )

                                // Badge GPS via minutesSinceLastPing / diag.gpsState:
                                // se hasRouteStarted=false, suprimir badge;
                                // >3 min e <=10 min = badge âmbar "GPS desatualizado (Xmin)";
                                // >10 min ou no_signal = vermelho "GPS sem sinal".
                                if (item.hasRouteStarted) {
                                  if (
                                    diag.minutesSinceLastPing > 10 ||
                                    diag.gpsState === 'no_signal'
                                  ) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50">
                                        🔴 GPS sem sinal
                                      </span>
                                    )
                                  }
                                  if (
                                    diag.minutesSinceLastPing > 3 &&
                                    diag.minutesSinceLastPing <= 10
                                  ) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50">
                                        ⚠️ GPS desatualizado ({diag.minutesSinceLastPing}min)
                                      </span>
                                    )
                                  }
                                  // Alerta / Indicador visual de parada em tempo real
                                  if (diag.isStopped) {
                                    return (
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold border ${
                                          diag.stoppedMinutes >= 5
                                            ? 'bg-rose-500/25 text-rose-300 border-rose-500/60 animate-pulse'
                                            : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                        }`}
                                      >
                                        🛑 {diag.movementBadgeLabel}
                                      </span>
                                    )
                                  }
                                }

                                const lTime = parseSafeTimestamp(item.location_timestamp)
                                const isFrozen =
                                  item.gps_status === 'offline' ||
                                  (lTime > 0 &&
                                    Date.now() - lTime > 5 * 60 * 1000 &&
                                    !(
                                      item.gps_status === 'active' &&
                                      item.offline_buffered === false
                                    ))
                                if (isFrozen) {
                                  const timeStr = formatTimeInTz(lTime)
                                  return (
                                    <span className="text-amber-400 font-semibold truncate text-[10px]">
                                      📴 Posição congelada às {timeStr} • Aguardando sinal...
                                    </span>
                                  )
                                }
                                if (shift) {
                                  return (
                                    <>
                                      <span className="font-semibold truncate">
                                        ⏱ {shift.remainingFormatted}
                                      </span>
                                      <span className="text-slate-300 shrink-0 font-medium">
                                        Volta: ~{shift.projectedEndTimeFormatted}
                                      </span>
                                    </>
                                  )
                                }
                                return (
                                  <span className="text-slate-400 italic text-[10px]">
                                    Calculando tempo de rota...
                                  </span>
                                )
                              })()}
                            </div>

                            {shift && (
                              <div className="pt-0.5">
                                {shift.isOvertime ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50">
                                    {shift.badgeText}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                                    {shift.badgeText}
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Alertas ativos na Torre: Desvios ou Paradas detectadas (dispensáveis) */}
                {mapDisplayMode === 'in_transit' &&
                  !isDeviationBannerDismissed &&
                  activeRoutesData.some((r) => r.isDeviated) && (
                    <div className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/60 shadow-md text-[10.5px] font-bold text-rose-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <AlertOctagon className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        <span className="truncate">
                          {activeRoutesData.filter((r) => r.isDeviated).length} desvio(s) de rota
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsDeviationBannerDismissed(true)}
                        className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                        title="Dispensar alerta"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                {mapDisplayMode === 'in_transit' &&
                  !isStopBannerDismissed &&
                  activeRoutesData.some((r) => r.isUnexpectedStop) && (
                    <div className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/60 shadow-md text-[10.5px] font-bold text-amber-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {activeRoutesData.filter((r) => r.isUnexpectedStop).length} parada(s) fora
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsStopBannerDismissed(true)}
                        className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                        title="Dispensar alerta"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                {/* Alertas de GPS desligado ou Permissão negada na Torre */}
                {mapDisplayMode === 'in_transit' &&
                  activeRouteCouriers
                    .filter(
                      (c) =>
                        c.gps_status === 'disabled' &&
                        !dismissedGpsAlertIds.includes(`gps-${c.courier.id}`),
                    )
                    .map((c) => {
                      const isPermDenied = c.gps_reason === 'permission_denied'
                      return (
                        <div
                          key={`gps-banner-${c.courier.id}`}
                          className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/70 shadow-md text-[10.5px] font-bold text-rose-200 flex items-center justify-between gap-2 animate-pulse"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-sm shrink-0">{isPermDenied ? '🚫' : '📡'}</span>
                            <span className="truncate">
                              {isPermDenied
                                ? `Permissão negada no aparelho: ${c.courier.name || c.courier.email}`
                                : `GPS desligado: ${c.courier.name || c.courier.email}`}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDismissedGpsAlertIds((prev) => [...prev, `gps-${c.courier.id}`])
                            }
                            className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}

                {/* Alertas de Perda de sinal (>5 min) na Torre */}
                {mapDisplayMode === 'in_transit' &&
                  activeRouteCouriers
                    .filter((c) => {
                      if (c.gps_status === 'disabled') return false
                      if (c.gps_status === 'active' && c.offline_buffered === false) return false
                      const locTime = parseSafeTimestamp(c.location_timestamp)
                      const isSignalLost =
                        c.gps_status === 'offline' ||
                        (locTime > 0 && Date.now() - locTime > 5 * 60 * 1000)
                      return isSignalLost && !dismissedGpsAlertIds.includes(`sig-${c.courier.id}`)
                    })
                    .map((c) => (
                      <div
                        key={`sig-banner-${c.courier.id}`}
                        className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/70 shadow-md text-[10.5px] font-bold text-amber-200 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-sm shrink-0">📴</span>
                          <span className="truncate">
                            Perda de sinal: {c.courier.name || c.courier.email}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDismissedGpsAlertIds((prev) => [...prev, `sig-${c.courier.id}`])
                          }
                          className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                          title="Dispensar alerta"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
              </div>

              {/* Legenda explicativa enxuta e recolhível no rodapé do Google Maps nativo */}
              <div className="absolute bottom-2.5 left-2.5 z-10 bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-xl text-[10px] text-slate-200 flex items-center gap-2 font-sans">
                {mapDisplayMode === 'delivered' ? (
                  <>
                    <span className="flex items-center gap-1 font-medium">
                      <span className="h-2 w-2 rounded-full bg-[#10B981] inline-block shadow-sm" />
                      <span className="text-emerald-400 font-bold">Entregue</span>
                    </span>
                    <span className="border-l border-slate-700/80 pl-2 text-slate-400 font-mono text-[9.5px]">
                      Total: {metrics.delivered}
                    </span>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="flex items-center gap-1.5 font-medium text-blue-300">
                        <span className="flex items-center -space-x-1">
                          <span className="h-2 w-2 rounded-full bg-[#2563EB] inline-block ring-1 ring-[#0A1128]" />
                          <span className="h-2 w-2 rounded-full bg-[#EA580C] inline-block ring-1 ring-[#0A1128]" />
                          <span className="h-2 w-2 rounded-full bg-[#7C3AED] inline-block ring-1 ring-[#0A1128]" />
                          <span className="h-2 w-2 rounded-full bg-[#059669] inline-block ring-1 ring-[#0A1128]" />
                        </span>
                        <span className="text-[9.5px] font-semibold text-slate-200">
                          Rota — cor por entregador
                        </span>
                      </span>
                      <span className="flex items-center gap-1 font-medium text-sky-400 border-l border-slate-700/80 pl-2">
                        <span className="h-1.5 w-3 rounded-full bg-[#60A5FA] border border-dashed border-[#2563EB] inline-block" />
                        Volta à base
                      </span>
                      <span className="flex items-center gap-1 font-medium text-rose-400 border-l border-slate-700/80 pl-2">
                        <span className="h-1.5 w-3 rounded-full bg-rose-500 inline-block" />
                        Desvio &gt;600m
                      </span>
                      <span className="border-l border-slate-700/80 pl-2 text-slate-300 flex items-center gap-1">
                        <span>🛵/🚗</span>
                        <span>Entregador</span>
                      </span>
                    </div>

                    {/* Botão de expansão para ver detalhes da legenda se desejado */}
                    <button
                      type="button"
                      onClick={() => setIsLegendExpanded(!isLegendExpanded)}
                      className="ml-1 text-slate-400 hover:text-white text-[9px] underline focus:outline-none"
                    >
                      {isLegendExpanded ? 'Menos' : 'Mais'}
                    </button>

                    {isLegendExpanded && (
                      <span className="border-l border-slate-700/80 pl-2 text-slate-400 flex items-center gap-1">
                        <span className="flex h-3 w-3 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-bold text-white">
                          1
                        </span>
                        <span>Destino/Parada (cor do entregador)</span>
                      </span>
                    )}
                  </>
                )}
              </div>
            </>
          ) : (
            <div className="relative w-full h-full flex flex-col">
              {/* Abas sobre o mapa e botões no canto superior direito do mapa vetorial */}
              <div className="absolute top-3 right-3 z-20 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setIsAutoFollow?.(true)
                    onRecenterAutoFollow?.()
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition flex items-center gap-1.5 shadow-lg border backdrop-blur-md ${
                    isAutoFollow
                      ? 'bg-emerald-600 text-white border-emerald-400/50 hover:bg-emerald-500 ring-2 ring-emerald-400/40'
                      : 'bg-[#0A1128]/90 text-slate-300 border-[#1E2B58] hover:text-white hover:bg-slate-800/80'
                  }`}
                  title={
                    isAutoFollow
                      ? 'Auto-follow ativo (acompanhando entregador)'
                      : 'Clique para seguir entregador em rota'
                  }
                >
                  <span>🎯 Seguir</span>
                  {isAutoFollow && (
                    <span className="flex h-2 w-2 rounded-full bg-white animate-pulse" />
                  )}
                </button>

                <div className="flex items-center gap-1.5 bg-[#0A1128]/90 backdrop-blur-md p-1 rounded-xl border border-[#1E2B58] shadow-lg">
                  <button
                    type="button"
                    onClick={() => setMapDisplayMode('in_transit')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      mapDisplayMode === 'in_transit'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    <span>🛵 Em Rota ({activeRouteCouriers.length})</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setMapDisplayMode('delivered')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                      mapDisplayMode === 'delivered'
                        ? 'bg-emerald-600 text-white shadow'
                        : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                    }`}
                  >
                    <span>✓ Entregues ({metrics.delivered})</span>
                  </button>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetryMaps}
                  className="h-8 px-2.5 text-xs bg-slate-900/90 text-slate-200 border-slate-700 hover:bg-slate-800 hover:text-white rounded-lg shadow-md gap-1.5 backdrop-blur"
                  title="Tentar carregar Google Maps novamente"
                >
                  <RefreshCw className="h-3 w-3" />
                  <span className="hidden sm:inline">Tentar Google Maps</span>
                </Button>
              </div>

              {/* Status e avisos no canto superior esquerdo também no Canvas vetorial */}
              <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5 max-w-[340px] pointer-events-auto">
                {mapDisplayMode === 'delivered' ? (
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
                    <span className="font-semibold text-white truncate text-[11px]">
                      {metrics.delivered} entregas concluídas
                    </span>
                  </div>
                ) : activeRouteCouriers.length === 0 ? (
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-[#1E2B58] shadow-md text-xs flex items-center gap-2">
                    <span className="flex h-2 w-2 rounded-full bg-blue-400" />
                    <span className="font-semibold text-white truncate text-[11px]">
                      0 entregadores em rota
                    </span>
                  </div>
                ) : (
                  /* Pílula com o total + lista detalhada de cada entregador em rota (nome, tempo para terminar e voltar à base) */
                  <div className="bg-[#0A1128]/95 backdrop-blur-sm rounded-lg border border-[#1E2B58] shadow-lg text-xs overflow-hidden flex flex-col">
                    <div className="px-2.5 py-1 border-b border-[#1E2B58]/70 flex items-center justify-between gap-2 bg-[#0E1738]/60">
                      <div className="flex items-center gap-2">
                        <span className="flex h-2 w-2 rounded-full bg-blue-400 animate-ping" />
                        <span className="font-bold text-white text-[11px]">
                          {activeRouteCouriers.length}{' '}
                          {activeRouteCouriers.length === 1
                            ? 'entregador em rota'
                            : 'entregadores em rota'}
                        </span>
                      </div>
                      <span className="text-[9.5px] text-slate-400 font-mono">
                        Toque para detalhes
                      </span>
                    </div>

                    <div className="flex flex-col divide-y divide-[#1E2B58]/50">
                      {activeRouteCouriers.map((item) => {
                        const rInfo = activeRoutesData.find((r) => r.courierId === item.courier.id)
                        const shift = rInfo?.shiftMetrics
                        const courierName = item.courier.name || item.courier.email || 'Entregador'
                        const vehicleEmoji = getVehicleEmoji(item.vehicle)
                        const courierColor = getCourierRouteColor(item.courier.id)

                        return (
                          <button
                            key={`canvas-top-shift-${item.courier.id}`}
                            type="button"
                            onClick={() => setSelectedCourier(item.courier)}
                            className="w-full text-left px-2.5 py-1.5 hover:bg-blue-950/40 transition flex flex-col gap-0.5 focus:outline-none"
                            title="Clique para ver detalhes do entregador"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span className="font-bold text-white text-[11px] truncate flex items-center gap-1.5">
                                <span
                                  className="h-2.5 w-2.5 rounded-full shrink-0 ring-1 ring-white/30"
                                  style={{ backgroundColor: courierColor.stroke }}
                                  title={`Cor da rota: ${courierColor.name}`}
                                />
                                <span>{vehicleEmoji}</span>
                                <span className="truncate">{courierName}</span>
                              </span>
                              <span className="text-[9.5px] text-slate-400 font-mono shrink-0">
                                ({item.inTransitCount} entrega
                                {item.inTransitCount === 1 ? '' : 's'})
                              </span>
                            </div>

                            <div className="text-[10.5px] text-blue-300 font-mono flex items-center justify-between gap-1">
                              {(() => {
                                const diag = diagnoseCourierTelemetry(
                                  item.courier.id,
                                  locations,
                                  item.lat,
                                  item.lng,
                                  item.speed,
                                  item.gps_status,
                                  item.gps_reason,
                                  item.location_timestamp,
                                  item.accuracy,
                                  item.offline_buffered,
                                )

                                if (item.hasRouteStarted) {
                                  if (
                                    diag.minutesSinceLastPing > 10 ||
                                    diag.gpsState === 'no_signal'
                                  ) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/50">
                                        🔴 GPS sem sinal
                                      </span>
                                    )
                                  }
                                  if (
                                    diag.minutesSinceLastPing > 3 &&
                                    diag.minutesSinceLastPing <= 10
                                  ) {
                                    return (
                                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50">
                                        ⚠️ GPS desatualizado ({diag.minutesSinceLastPing}min)
                                      </span>
                                    )
                                  }
                                  // Alerta / Indicador visual de parada em tempo real
                                  if (diag.isStopped) {
                                    return (
                                      <span
                                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9.5px] font-bold border ${
                                          diag.stoppedMinutes >= 5
                                            ? 'bg-rose-500/25 text-rose-300 border-rose-500/60 animate-pulse'
                                            : 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                                        }`}
                                      >
                                        🛑 {diag.movementBadgeLabel}
                                      </span>
                                    )
                                  }
                                }

                                const lTime = parseSafeTimestamp(item.location_timestamp)
                                const isFrozen =
                                  item.gps_status === 'offline' ||
                                  (lTime > 0 &&
                                    Date.now() - lTime > 5 * 60 * 1000 &&
                                    !(
                                      item.gps_status === 'active' &&
                                      item.offline_buffered === false
                                    ))
                                if (isFrozen) {
                                  const timeStr = formatTimeInTz(lTime)
                                  return (
                                    <span className="text-amber-400 font-semibold truncate text-[10px]">
                                      📴 Posição congelada às {timeStr} • Aguardando sinal...
                                    </span>
                                  )
                                }
                                if (shift) {
                                  return (
                                    <>
                                      <span className="font-semibold truncate">
                                        ⏱ {shift.remainingFormatted}
                                      </span>
                                      <span className="text-slate-300 shrink-0 font-medium">
                                        Volta: ~{shift.projectedEndTimeFormatted}
                                      </span>
                                    </>
                                  )
                                }
                                return (
                                  <span className="text-slate-400 italic text-[10px]">
                                    Calculando tempo de rota...
                                  </span>
                                )
                              })()}
                            </div>

                            {shift && (
                              <div className="pt-0.5">
                                {shift.isOvertime ? (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/50">
                                    {shift.badgeText}
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.2 rounded text-[9.5px] font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/50">
                                    {shift.badgeText}
                                  </span>
                                )}
                              </div>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {mapDisplayMode === 'in_transit' &&
                  !isDeviationBannerDismissed &&
                  activeRoutesData.some((r) => r.isDeviated) && (
                    <div className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/60 shadow-md text-[10.5px] font-bold text-rose-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <AlertOctagon className="h-3.5 w-3.5 text-rose-400 shrink-0" />
                        <span className="truncate">
                          {activeRoutesData.filter((r) => r.isDeviated).length} desvio(s) de rota
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsDeviationBannerDismissed(true)}
                        className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                        title="Dispensar alerta"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                {mapDisplayMode === 'in_transit' &&
                  !isStopBannerDismissed &&
                  activeRoutesData.some((r) => r.isUnexpectedStop) && (
                    <div className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/60 shadow-md text-[10.5px] font-bold text-amber-300 flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 truncate">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {activeRoutesData.filter((r) => r.isUnexpectedStop).length} parada(s) fora
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setIsStopBannerDismissed(true)}
                        className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                        title="Dispensar alerta"
                      >
                        ✕
                      </button>
                    </div>
                  )}

                {/* Alertas de GPS desligado no canvas */}
                {mapDisplayMode === 'in_transit' &&
                  activeRouteCouriers
                    .filter(
                      (c) =>
                        c.gps_status === 'disabled' &&
                        !dismissedGpsAlertIds.includes(`gps-${c.courier.id}`),
                    )
                    .map((c) => {
                      const isPermDenied = c.gps_reason === 'permission_denied'
                      return (
                        <div
                          key={`canvas-gps-banner-${c.courier.id}`}
                          className="bg-rose-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-rose-500/70 shadow-md text-[10.5px] font-bold text-rose-200 flex items-center justify-between gap-2 animate-pulse"
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <span className="text-sm shrink-0">{isPermDenied ? '🚫' : '📡'}</span>
                            <span className="truncate">
                              {isPermDenied
                                ? `Permissão negada no aparelho: ${c.courier.name || c.courier.email}`
                                : `GPS desligado: ${c.courier.name || c.courier.email}`}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setDismissedGpsAlertIds((prev) => [...prev, `gps-${c.courier.id}`])
                            }
                            className="text-rose-400 hover:text-white text-xs px-1 hover:bg-rose-900/60 rounded"
                            title="Dispensar alerta"
                          >
                            ✕
                          </button>
                        </div>
                      )
                    })}

                {/* Alertas de Perda de sinal (>5 min) no canvas */}
                {mapDisplayMode === 'in_transit' &&
                  activeRouteCouriers
                    .filter((c) => {
                      if (c.gps_status === 'disabled') return false
                      if (c.gps_status === 'active' && c.offline_buffered === false) return false
                      const locTime = parseSafeTimestamp(c.location_timestamp)
                      const isSignalLost =
                        c.gps_status === 'offline' ||
                        (locTime > 0 && Date.now() - locTime > 5 * 60 * 1000)
                      return isSignalLost && !dismissedGpsAlertIds.includes(`sig-${c.courier.id}`)
                    })
                    .map((c) => (
                      <div
                        key={`canvas-sig-banner-${c.courier.id}`}
                        className="bg-amber-950/95 backdrop-blur-sm px-2.5 py-1 rounded-lg border border-amber-500/70 shadow-md text-[10.5px] font-bold text-amber-200 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-1.5 truncate">
                          <span className="text-sm shrink-0">📴</span>
                          <span className="truncate">
                            Perda de sinal: {c.courier.name || c.courier.email}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setDismissedGpsAlertIds((prev) => [...prev, `sig-${c.courier.id}`])
                          }
                          className="text-amber-400 hover:text-white text-xs px-1 hover:bg-amber-900/60 rounded"
                          title="Dispensar alerta"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
              </div>

              {/* Canvas vetorial de contingência idêntico ao LiveMap.tsx com marcadores interativos e rotas viárias */}
              <LiveMap
                markers={controlTowerMapMarkers}
                center={
                  activeRouteCouriers[0]
                    ? { lat: activeRouteCouriers[0].lat, lng: activeRouteCouriers[0].lng }
                    : { lat: -22.906847, lng: -43.172896 }
                }
                zoom={13}
                height="100%"
                routeLines={
                  mapDisplayMode === 'delivered'
                    ? []
                    : activeRoutesData
                        .filter((routeData) => {
                          // B2: Usar routeData.allOrders / courierId em vez de apenas routeData.order
                          const hasActiveInAll = (routeData as any).allOrders?.some(
                            (o: any) => Boolean(o.route_started) && o.route_finished !== true,
                          )
                          const hasActiveInOrder =
                            Boolean(routeData.order?.route_started) &&
                            routeData.order?.route_finished !== true
                          const hasActiveCourier =
                            Boolean(routeData.courierId) &&
                            activeRouteCouriers.some(
                              (c) => c.courier.id === routeData.courierId && c.hasRouteStarted,
                            )
                          return hasActiveInAll || hasActiveInOrder || hasActiveCourier
                        })
                        .flatMap((routeData) => {
                          const lines: any[] = []
                          const fPoints = routeData.forwardPoints || routeData.points
                          if (fPoints && fPoints.length >= 2) {
                            lines.push({
                              origin: fPoints[0] || routeData.courierPos,
                              destination: routeData.custPos,
                              courierPosition: routeData.courierPos,
                              streetCoordinates: fPoints,
                              isDeviated: Boolean(
                                routeData.order?.route_started &&
                                routeData.order?.route_finished !== true &&
                                routeData.isDeviated,
                              ),
                              isReturnLeg: false,
                            })
                          }
                          const retPoints = routeData.returnPoints
                          if (retPoints && retPoints.length >= 2) {
                            lines.push({
                              origin: retPoints[0],
                              destination: retPoints[retPoints.length - 1],
                              courierPosition: routeData.courierPos,
                              streetCoordinates: retPoints,
                              isDeviated: Boolean(
                                (!fPoints || fPoints.length < 2) &&
                                routeData.order?.route_started &&
                                routeData.order?.route_finished !== true &&
                                routeData.isDeviated,
                              ),
                              isReturnLeg: true,
                            })
                          }
                          return lines
                        })
                }
                onSelectMarker={(m) => {
                  if (m.type === 'courier') {
                    const courierId = m.id.replace('courier-', '')
                    const targetCourier = couriers.find((c) => c.id === courierId)
                    if (targetCourier) setSelectedCourier(targetCourier)
                  } else {
                    const orderId = m.id.replace('order-', '')
                    const targetOrder = orders.find((o) => o.id === orderId)
                    if (targetOrder) handleOpenOrderDetails(targetOrder)
                  }
                }}
                customLegend={
                  mapDisplayMode === 'delivered' ? (
                    <div className="flex items-center gap-2 text-[10px] text-slate-200">
                      <div className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-[#10B981] inline-block shadow-sm"></span>
                        <span className="font-semibold text-emerald-400">Entregue</span>
                      </div>
                      <div className="border-l border-slate-700 pl-2 text-slate-400 font-mono text-[9.5px]">
                        Total: {metrics.delivered}
                      </div>
                    </div>
                  ) : undefined
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
