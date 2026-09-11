import React, { useEffect, useRef, useState } from 'react'
import {
  MapPin,
  Navigation,
  User,
  Package,
  AlertCircle,
  Compass,
  Layers,
  Copy,
  Check,
  ExternalLink,
  Clock,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
  reverseGeocodeCoordinates,
} from '@/lib/googleMaps'

export interface MapMarkerItem {
  id: string
  title: string
  subtitle?: string
  lat: number
  lng: number
  type: 'courier' | 'order_pending' | 'order_transit' | 'order_delivered' | 'current'
  speed?: number
  tracking_code?: string
  customer_name?: string
  customer_address?: string
  total_price?: number
  estimated_arrival?: string
  courier_name?: string
}

interface LiveMapProps {
  markers?: MapMarkerItem[]
  center?: { lat: number; lng: number }
  zoom?: number
  height?: string
  selectedMarkerId?: string | null
  onSelectMarker?: (marker: MapMarkerItem) => void
  showTraffic?: boolean
}

export const LiveMap: React.FC<LiveMapProps> = ({
  markers = [],
  center = { lat: -22.906847, lng: -43.172896 },
  zoom = 13,
  height = '480px',
  selectedMarkerId,
  onSelectMarker,
  showTraffic = false,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMarkersRef = useRef<any[]>([])
  const getGoogle = () =>
    typeof window !== 'undefined' ? (window as unknown as { google?: any }).google : undefined
  const isGoogleLoaded = !!getGoogle()?.maps

  const [mapsLoaded, setMapsLoaded] = useState(false)
  const [authError, setAuthError] = useState(isGoogleMapsAuthError())
  const [copiedCode, setCopiedCode] = useState<string | null>(null)
  const [activePopupMarker, setActivePopupMarker] = useState<MapMarkerItem | null>(null)
  // State for resolved addresses: key is marker.id or lat,lng key
  const [resolvedAddresses, setResolvedAddresses] = useState<Record<string, string>>({})
  const [loadingAddressIds, setLoadingAddressIds] = useState<Record<string, boolean>>({})

  // Hover address resolver with caching and fallback
  const handleMarkerHover = (item: MapMarkerItem) => {
    if (!item.lat || !item.lng) return

    // If marker already has customer_address (order markers)
    if (item.customer_address) {
      if (!resolvedAddresses[item.id]) {
        setResolvedAddresses((prev) => ({ ...prev, [item.id]: item.customer_address! }))
      }
      return
    }

    const posKey = `${item.id}-${item.lat.toFixed(4)},${item.lng.toFixed(4)}`
    if (resolvedAddresses[posKey] || loadingAddressIds[posKey]) return

    setLoadingAddressIds((prev) => ({ ...prev, [posKey]: true }))
    reverseGeocodeCoordinates(item.lat, item.lng)
      .then((res) => {
        const addressText = res?.streetAndNumber
          ? `${res.streetAndNumber}${res.neighborhood ? ` - ${res.neighborhood}` : ''}${res.city ? `, ${res.city}` : ''}`
          : res?.formattedAddress || `Lat: ${item.lat.toFixed(5)}, Lng: ${item.lng.toFixed(5)}`

        setResolvedAddresses((prev) => ({
          ...prev,
          [posKey]: addressText,
          [item.id]: addressText,
        }))
      })
      .catch(() => {
        const fallbackText = `Lat: ${item.lat.toFixed(5)}, Lng: ${item.lng.toFixed(5)}`
        setResolvedAddresses((prev) => ({
          ...prev,
          [posKey]: fallbackText,
          [item.id]: fallbackText,
        }))
      })
      .finally(() => {
        setLoadingAddressIds((prev) => ({ ...prev, [posKey]: false }))
      })
  }

  // Helper to get displayed address for a marker
  const getMarkerAddress = (item: MapMarkerItem) => {
    if (item.customer_address) return item.customer_address
    const posKey = `${item.id}-${item.lat.toFixed(4)},${item.lng.toFixed(4)}`
    if (resolvedAddresses[posKey]) return resolvedAddresses[posKey]
    if (resolvedAddresses[item.id]) return resolvedAddresses[item.id]
    if (loadingAddressIds[posKey] || loadingAddressIds[item.id]) return 'Localizando endereço...'
    return null
  }

  const copyTrackingLink = (trackingCode: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation()
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/track/${trackingCode}`
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
    }
    setCopiedCode(trackingCode)
    toast.success(`Link de rastreio copiado!`, {
      description: url,
    })
    setTimeout(() => {
      setCopiedCode(null)
    }, 2500)
  }

  useEffect(() => {
    const unsub = onGoogleMapsAuthError(() => {
      setAuthError(true)
      setMapsLoaded(false)
    })

    loadGoogleMapsScript().then((success) => {
      if (success && !isGoogleMapsAuthError()) {
        setMapsLoaded(true)
        setAuthError(false)
        setTimeout(() => {
          initGoogleMap()
        }, 100)
      } else {
        setMapsLoaded(false)
        setAuthError(true)
      }
    })

    return unsub
  }, [])

  // Handle window resize for map
  useEffect(() => {
    const handleResize = () => {
      const google = getGoogle()
      if (mapInstanceRef.current && google?.maps) {
        google.maps.event.trigger(mapInstanceRef.current, 'resize')
        mapInstanceRef.current.setCenter({ lat: center.lat, lng: center.lng })
      }
    }

    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [center])

  const initGoogleMap = () => {
    const google = getGoogle()
    if (!mapContainerRef.current || !google?.maps) return

    try {
      if (!mapInstanceRef.current) {
        mapInstanceRef.current = new google.maps.Map(mapContainerRef.current, {
          center: { lat: center.lat, lng: center.lng },
          zoom: zoom,
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
          styles: [
            {
              featureType: 'administrative',
              elementType: 'geometry',
              stylers: [{ visibility: 'simplified' }],
            },
            {
              featureType: 'poi',
              stylers: [{ visibility: 'off' }],
            },
          ],
        })
      } else {
        google.maps.event?.trigger(mapInstanceRef.current, 'resize')
        mapInstanceRef.current.setCenter({ lat: center.lat, lng: center.lng })
      }
      renderGoogleMarkers()
    } catch (err) {
      console.error('Google map init error:', err)
    }
  }

  const buildInfoWindowHtml = (item: MapMarkerItem, address?: string | null) => {
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const trackUrl = item.tracking_code ? `${origin}/track/${item.tracking_code}` : ''
    const addressDisplay = address || getMarkerAddress(item)

    return `
      <div style="padding: 10px 12px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 290px; line-height: 1.4;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 4px;">
          <strong style="font-size: 13px; color: #0f172a; font-weight: 700;">${item.title}</strong>
        </div>
        ${item.subtitle ? `<p style="font-size: 11px; margin: 2px 0 6px; color: #475569;">${item.subtitle}</p>` : ''}
        
        <div style="background-color: #f1f5f9; border-radius: 6px; padding: 6px 8px; margin: 6px 0; border: 1px solid #e2e8f0;">
          <span style="font-size: 10px; font-weight: 700; text-transform: uppercase; color: #0052cc; display: block; margin-bottom: 2px;">
            📍 Endereço Atual em Tempo Real:
          </span>
          <span style="font-size: 11px; color: #1e293b; font-weight: 500; display: block;">
            ${addressDisplay || 'Resolvendo endereço...'}
          </span>
        </div>

        ${item.speed ? `<p style="font-size: 11px; margin: 4px 0 0; color: #7c3aed; font-weight: 600;">🚀 Velocidade: ${item.speed} km/h</p>` : ''}
        ${item.estimated_arrival ? `<p style="font-size: 11px; margin: 4px 0 0; color: #0284c7; font-weight: 500;">⏱️ Previsão: ${new Date(item.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>` : ''}
        ${
          item.tracking_code
            ? `
          <div style="margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex; flex-direction: column; gap: 4px;">
            <span style="font-size: 10px; font-family: monospace; color: #64748b; font-weight: bold;">Código: ${item.tracking_code}</span>
            <a href="${trackUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 11px; color: #2563eb; font-weight: bold; text-decoration: none;">
              Abrir Rastreio Público ↗
            </a>
          </div>
        `
            : ''
        }
      </div>
    `
  }

  const renderGoogleMarkers = () => {
    const google = getGoogle()
    if (!mapInstanceRef.current || !google?.maps) return

    // Clear old markers
    googleMarkersRef.current.forEach((m) => m.setMap(null))
    googleMarkersRef.current = []

    // Single hover infoWindow instance to follow mouse hover smoothly
    const hoverInfoWindow = new google.maps.InfoWindow({
      disableAutoPan: true,
    })

    markers.forEach((item) => {
      if (!item.lat || !item.lng) return

      // Rotaly Color Scheme: Blue for couriers, Orange for customers/orders, Green for delivered
      let iconUrl = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'
      if (item.type === 'courier') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png' // Blue for Couriers
      } else if (item.type === 'order_transit') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png' // Orange for Customers / Orders
      } else if (item.type === 'order_delivered') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/green-dot.png' // Green for Delivered
      } else if (item.type === 'order_pending') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'
      }

      const marker = new google.maps.Marker({
        position: { lat: item.lat, lng: item.lng },
        map: mapInstanceRef.current,
        title: item.title,
        icon: iconUrl,
        animation: item.id === selectedMarkerId ? google.maps.Animation.BOUNCE : undefined,
      })

      // Click InfoWindow for persistent popup
      const clickInfoWindow = new google.maps.InfoWindow({
        content: buildInfoWindowHtml(item),
      })

      // Hover handler: resolve real-time reverse geocoded address and update tooltip
      marker.addListener('mouseover', () => {
        handleMarkerHover(item)
        const currentAddr = getMarkerAddress(item)
        hoverInfoWindow.setContent(buildInfoWindowHtml(item, currentAddr))
        hoverInfoWindow.open(mapInstanceRef.current, marker)

        // If address is still resolving, poll/update when ready
        if (!currentAddr || currentAddr === 'Localizando endereço...') {
          const checkTimer = setTimeout(() => {
            const updatedAddr = getMarkerAddress(item)
            hoverInfoWindow.setContent(buildInfoWindowHtml(item, updatedAddr))
          }, 600)
          ;(marker as any).__hoverTimer = checkTimer
        }
      })

      marker.addListener('mouseout', () => {
        if ((marker as any).__hoverTimer) clearTimeout((marker as any).__hoverTimer)
        hoverInfoWindow.close()
      })

      marker.addListener('click', () => {
        hoverInfoWindow.close()
        handleMarkerHover(item)
        clickInfoWindow.setContent(buildInfoWindowHtml(item))
        clickInfoWindow.open(mapInstanceRef.current, marker)
        setActivePopupMarker(item)
        if (onSelectMarker) onSelectMarker(item)
      })

      googleMarkersRef.current.push(marker)
    })
  }

  useEffect(() => {
    const google = getGoogle()
    if (google?.maps && mapInstanceRef.current) {
      renderGoogleMarkers()
    }
  }, [markers, selectedMarkerId, resolvedAddresses])
  // Fallback interactive visual mock map if Google Maps key is not provided or offline
  return (
    <div
      className="relative w-full rounded-2xl overflow-hidden border border-slate-200 shadow-md bg-slate-950 dark:border-slate-800"
      style={{ height }}
    >
      {/* Google map container */}
      <div
        ref={mapContainerRef}
        className={`absolute inset-0 w-full h-full ${mapsLoaded && !authError ? 'z-10 opacity-100' : 'z-0 opacity-0 pointer-events-none'}`}
      />

      {/* Fallback interactive stylish vector map canvas if Google maps is unavailable or auth failed */}
      {(!mapsLoaded || authError) && (
        <div className="absolute inset-0 flex flex-col justify-between p-4 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white z-10 select-none overflow-hidden">
          {/* Subtle grid lines background */}
          <div className="absolute inset-0 opacity-15 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:24px_24px]" />

          {/* Simulated Street overlay paths */}
          <svg
            className="absolute inset-0 w-full h-full opacity-20 pointer-events-none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M 0,150 Q 300,180 600,100 T 1200,220"
              fill="none"
              stroke="#60a5fa"
              strokeWidth="4"
            />
            <path
              d="M 200,0 Q 250,300 400,600"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="3"
              strokeDasharray="6,6"
            />
            <path d="M 800,0 Q 750,250 900,600" fill="none" stroke="#cbd5e1" strokeWidth="2" />
            <path
              d="M 0,350 Q 400,320 800,420 T 1200,380"
              fill="none"
              stroke="#a855f7"
              strokeWidth="3"
            />
          </svg>

          {/* Fallback Interactive Marker Pins on Canvas */}
          <div className="relative w-full h-full">
            {markers.map((m, idx) => {
              // Convert lat/lng to approximate relative coordinates on SP center grid
              const relX = 50 + (m.lng - center.lng) * 1200
              const relY = 50 - (m.lat - center.lat) * 1200
              const clampedX = Math.max(
                8,
                Math.min(92, isNaN(relX) ? 20 + ((idx * 15) % 70) : relX),
              )
              const clampedY = Math.max(
                12,
                Math.min(88, isNaN(relY) ? 25 + ((idx * 18) % 65) : relY),
              )

              const isSelected = m.id === selectedMarkerId

              return (
                <div
                  key={m.id}
                  onMouseEnter={() => handleMarkerHover(m)}
                  onClick={() => {
                    handleMarkerHover(m)
                    setActivePopupMarker(activePopupMarker?.id === m.id ? null : m)
                    if (onSelectMarker) onSelectMarker(m)
                  }}
                  style={{ left: `${clampedX}%`, top: `${clampedY}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-300 ease-out group ${
                    isSelected || activePopupMarker?.id === m.id
                      ? 'z-40 scale-110'
                      : 'z-20 hover:scale-110 hover:z-30'
                  }`}
                >
                  {/* Ping effect for couriers & urgent orders */}
                  {(m.type === 'courier' || m.type === 'order_transit') && (
                    <span className="absolute -inset-2 rounded-full animate-ping bg-[#FF6B35]/30 opacity-75" />
                  )}

                  {/* Marker Pin Icon: Blue #0052CC for couriers, Orange #FF6B35 for customers */}
                  <div
                    className={`flex items-center justify-center p-2 rounded-full shadow-brand border-2 transition-all ${
                      m.type === 'courier'
                        ? 'bg-[#0052CC] border-blue-200 text-white shadow-brand-hover ring-2 ring-[#0052CC]/50'
                        : m.type === 'order_transit'
                          ? 'bg-[#FF6B35] border-orange-200 text-white shadow-brand-orange'
                          : m.type === 'order_delivered'
                            ? 'bg-[#00AA44] border-emerald-200 text-white'
                            : 'bg-[#FF6B35] border-orange-200 text-white shadow-brand-orange'
                    }`}
                  >
                    {m.type === 'courier' ? (
                      <Navigation className="h-4 w-4 transform rotate-45" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                  </div>

                  {/* Tooltip & Interactive Popover for Customer / Order Marker (Hover & Click) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex-col items-center min-w-[220px] max-w-[280px] z-50 transition-all ${
                      activePopupMarker?.id === m.id
                        ? 'flex pointer-events-auto opacity-100 scale-100'
                        : 'hidden group-hover:flex pointer-events-auto opacity-100'
                    }`}
                  >
                    <div className="bg-slate-900/98 text-white text-xs rounded-xl p-3 shadow-2xl border border-slate-700 w-full space-y-2 backdrop-blur-md">
                      <div className="flex items-start justify-between gap-1.5 border-b border-slate-800 pb-1.5">
                        <div>
                          <p className="font-bold text-white text-xs leading-snug">{m.title}</p>
                          {m.subtitle && (
                            <p className="text-slate-400 text-[10px] leading-tight mt-0.5 line-clamp-2 font-medium">
                              {m.subtitle}
                            </p>
                          )}
                        </div>
                        {m.type !== 'courier' && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                              m.type === 'order_transit'
                                ? 'bg-amber-500/20 text-amber-300'
                                : m.type === 'order_delivered'
                                  ? 'bg-emerald-500/20 text-emerald-300'
                                  : 'bg-blue-500/20 text-blue-300'
                            }`}
                          >
                            {m.type === 'order_transit'
                              ? 'Em Rota'
                              : m.type === 'order_delivered'
                                ? 'Entregue'
                                : 'Pendente'}
                          </span>
                        )}
                      </div>

                      {/* Endereço em tempo real (Hover/Tooltip) */}
                      <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 text-[11px] space-y-1">
                        <div className="flex items-center gap-1 text-[10px] font-bold text-[#60A5FA] uppercase tracking-wider">
                          <MapPin className="h-3 w-3 shrink-0 text-[#60A5FA]" />
                          <span>Endereço Atual em Tempo Real</span>
                        </div>
                        <p className="text-slate-200 text-[11px] leading-relaxed break-words font-sans">
                          {getMarkerAddress(m) || 'Localizando endereço...'}
                        </p>
                      </div>

                      {m.speed && (
                        <p className="text-purple-400 text-[11px] font-semibold flex items-center gap-1">
                          🚀 {m.speed} km/h
                        </p>
                      )}

                      {/* ETA Time if available */}
                      {m.estimated_arrival && (
                        <div className="flex items-center gap-1 text-[11px] text-sky-300 bg-sky-950/50 p-1.5 rounded-lg border border-sky-800/60">
                          <Clock className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                          <span>
                            Previsão:{' '}
                            {new Date(m.estimated_arrival).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                      )}

                      {/* Public Tracking Link & Copy Action */}
                      {m.tracking_code && (
                        <div className="pt-1 space-y-1.5">
                          <div className="flex items-center justify-between text-[10px] text-slate-400">
                            <span className="font-mono font-bold text-slate-300">
                              {m.tracking_code}
                            </span>
                          </div>

                          <div className="grid grid-cols-2 gap-1.5">
                            <button
                              type="button"
                              onClick={(e) => copyTrackingLink(m.tracking_code!, e)}
                              className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[10px] shadow transition active:scale-95"
                              title="Copiar link de rastreamento para enviar ao cliente"
                            >
                              {copiedCode === m.tracking_code ? (
                                <>
                                  <Check className="h-3 w-3 text-emerald-300" />
                                  <span>Copiado!</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="h-3 w-3" />
                                  <span>Copiar Link</span>
                                </>
                              )}
                            </button>

                            <a
                              href={`/track/${m.tracking_code}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[10px] border border-slate-700 transition"
                            >
                              <span>Ver</span>
                              <ExternalLink className="h-3 w-3" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-2.5 h-2.5 bg-slate-900 border-r border-b border-slate-700 rotate-45 -mt-1 shadow-lg" />
                  </div>
                </div>
              )
            })}
          </div>

          {/* Map Overlay Badge */}
          <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-lg bg-slate-900/90 px-3 py-1.5 backdrop-blur border border-slate-700 text-xs text-slate-200 shadow-lg">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
            </span>
            <span>Rastreamento em Tempo Real (SP Hub)</span>
          </div>

          {/* Legend */}
          <div className="absolute bottom-3 left-3 z-30 flex flex-wrap gap-3 rounded-card bg-white/95 p-2.5 backdrop-blur border border-slate-200 text-[11px] text-[#1a1a1a] shadow-brand font-sans">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#0052CC]"></span>
              <span className="font-medium">Entregador (Azul)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#FF6B35]"></span>
              <span className="font-medium">Cliente / Pedido (Laranja)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-[#00AA44]"></span>
              <span className="font-medium">Entregue (Verde)</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
