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
  vehicle_type?: string
  delivery_sequence?: number
}

export function getVehicleEmoji(type?: string): string {
  const norm = (type || '').toLowerCase().trim()
  if (norm === 'carro' || norm === 'car' || norm === 'van') return '🚗'
  if (norm === 'caminhao' || norm === 'caminhão' || norm === 'truck') return '🚛'
  if (norm === 'bicicleta' || norm === 'bicycle' || norm === 'bike') return '🚲'
  return '🛵' // moto default
}

export function getVehicleLabel(type?: string): string {
  const norm = (type || '').toLowerCase().trim()
  if (norm === 'carro' || norm === 'car') return 'Carro'
  if (norm === 'van') return 'Van'
  if (norm === 'caminhao' || norm === 'caminhão' || norm === 'truck') return 'Caminhão'
  if (norm === 'bicicleta' || norm === 'bicycle' || norm === 'bike') return 'Bicicleta'
  return 'Moto'
}

export interface RouteGeometryItem {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  streetCoordinates?: { lat: number; lng: number }[]
  courierPosition?: { lat: number; lng: number }
  isDeviated?: boolean
}

interface LiveMapProps {
  markers?: MapMarkerItem[]
  center?: { lat: number; lng: number }
  zoom?: number
  height?: string
  selectedMarkerId?: string | null
  onSelectMarker?: (marker: MapMarkerItem) => void
  showTraffic?: boolean
  routeLines?: RouteGeometryItem[]
}

export const LiveMap: React.FC<LiveMapProps> = ({
  markers = [],
  center = { lat: -22.906847, lng: -43.172896 },
  zoom = 13,
  height = '480px',
  selectedMarkerId,
  onSelectMarker,
  showTraffic = false,
  routeLines = [],
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMarkersRef = useRef<any[]>([])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googlePolylinesRef = useRef<any[]>([])
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

    // Clear old polylines on native map
    googlePolylinesRef.current.forEach((p) => p.setMap(null))
    googlePolylinesRef.current = []

    // Render route polylines on native Google Map
    routeLines.forEach((r) => {
      const coords = r.streetCoordinates || [r.origin, r.destination]
      if (coords.length >= 2) {
        // LINHA AZUL: Trajeto de ruas indicado pelo sistema
        const polyline = new google.maps.Polyline({
          path: coords.map((c) => ({ lat: c.lat, lng: c.lng })),
          geodesic: true,
          strokeColor: '#2563EB',
          strokeOpacity: 0.9,
          strokeWeight: 5,
          map: mapInstanceRef.current,
        })
        googlePolylinesRef.current.push(polyline)

        // Linha interna mais clara para destaque visual
        const innerPolyline = new google.maps.Polyline({
          path: coords.map((c) => ({ lat: c.lat, lng: c.lng })),
          geodesic: true,
          strokeColor: '#93C5FD',
          strokeOpacity: 0.9,
          strokeWeight: 2,
          map: mapInstanceRef.current,
        })
        googlePolylinesRef.current.push(innerPolyline)
      }

      // LINHA VERMELHA DE DESVIO: do entregador até o ponto de retorno da rota
      if (r.isDeviated && r.courierPosition) {
        const refPoint = coords[0] || r.origin
        const devPolyline = new google.maps.Polyline({
          path: [
            { lat: r.courierPosition.lat, lng: r.courierPosition.lng },
            { lat: refPoint.lat, lng: refPoint.lng },
          ],
          geodesic: true,
          strokeColor: '#EF4444',
          strokeOpacity: 1,
          strokeWeight: 4,
          icons: [
            {
              icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
              offset: '0',
              repeat: '10px',
            },
          ],
          map: mapInstanceRef.current,
        })
        googlePolylinesRef.current.push(devPolyline)
      }
    })

    // Single hover infoWindow instance to follow mouse hover smoothly
    const hoverInfoWindow = new google.maps.InfoWindow({
      disableAutoPan: true,
    })

    // Helper para gerar SVG Data-URI com ícone do veículo e cor adequada
    const makeCourierSvgIcon = (vehicle?: string) => {
      const emoji = getVehicleEmoji(vehicle)
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="44" height="44" viewBox="0 0 44 44">
          <defs>
            <filter id="c-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
            </filter>
          </defs>
          <circle cx="22" cy="22" r="18" fill="#0052CC" stroke="#FFFFFF" stroke-width="3" filter="url(#c-shadow)"/>
          <text x="22" y="27" font-size="18" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
        </svg>
      `.trim()
      return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new google.maps.Size(44, 44),
        anchor: new google.maps.Point(22, 22),
      }
    }

    // Helper para gerar SVG Data-URI de pin de cliente com badge de sequência e nome visível
    const makeCustomerSvgIcon = (customerName?: string, seq?: number, isTransit = false) => {
      const pinColor = isTransit ? '#FF6B35' : '#475569'
      const cleanName = (customerName || '').trim()
      const hasName = cleanName.length > 0
      const hasSeq = typeof seq === 'number' && seq > 0

      // SVG com pin + badge numerado + etiqueta com nome legível
      // Largura suficiente para etiqueta (até ~180px)
      const svg = `
        <svg xmlns="http://www.w3.org/2000/svg" width="220" height="64" viewBox="0 0 220 64">
          <defs>
            <filter id="pin-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.5"/>
            </filter>
          </defs>

          <!-- Label de Nome do Cliente no topo se presente -->
          ${
            hasName
              ? `
            <g filter="url(#pin-shadow)">
              <rect x="2" y="2" width="216" height="20" rx="5" fill="#0A1128" fill-opacity="0.94" stroke="#1E2B58" stroke-width="1.2"/>
              <text x="110" y="16" font-size="10" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="700" fill="#FFFFFF" text-anchor="middle">
                ${cleanName.length > 26 ? cleanName.slice(0, 25) + '…' : cleanName}
              </text>
            </g>
          `
              : ''
          }

          <!-- Pin corpo centralizado em X=110 -->
          <g transform="translate(96, ${hasName ? 26 : 8})" filter="url(#pin-shadow)">
            <!-- Formato clássico de pin 28x36 -->
            <path d="M14 0 C6.27 0 0 6.27 0 14 C0 24.5 14 36 14 36 C14 36 28 24.5 28 14 C28 6.27 21.73 0 14 0 Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="2"/>
            
            <!-- Círculo interno ou número da sequência -->
            ${
              hasSeq
                ? `
              <circle cx="14" cy="13" r="9" fill="#FFFFFF"/>
              <text x="14" y="17" font-size="11" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="${pinColor}" text-anchor="middle">${seq}</text>
            `
                : `
              <circle cx="14" cy="13" r="5" fill="#FFFFFF"/>
            `
            }
          </g>
        </svg>
      `.trim()

      return {
        url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
        scaledSize: new google.maps.Size(220, 64),
        anchor: new google.maps.Point(110, hasName ? 62 : 44),
      }
    }

    markers.forEach((item) => {
      if (!item.lat || !item.lng) return

      let markerIcon: any = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'
      if (item.type === 'courier') {
        markerIcon = makeCourierSvgIcon(item.vehicle_type)
      } else {
        const isTransit = item.type === 'order_transit'
        markerIcon = makeCustomerSvgIcon(item.customer_name, item.delivery_sequence, isTransit)
      }

      const marker = new google.maps.Marker({
        position: { lat: item.lat, lng: item.lng },
        map: mapInstanceRef.current,
        title: item.title,
        icon: markerIcon,
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
  }, [markers, selectedMarkerId, resolvedAddresses, routeLines])
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

          {/* Street overlay paths & Real routes (Linha Azul das ruas e Linha Vermelha de desvio) */}
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
          >
            <defs>
              <filter id="livemap-blue-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="0.8"
                  floodColor="#3B82F6"
                  floodOpacity="0.8"
                />
              </filter>
              <filter id="livemap-red-glow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow
                  dx="0"
                  dy="0"
                  stdDeviation="1"
                  floodColor="#EF4444"
                  floodOpacity="0.9"
                />
              </filter>
            </defs>

            {/* Rotas viárias reais passadas via props */}
            {routeLines.map((r, i) => {
              const coords = r.streetCoordinates || [r.origin, r.destination]
              if (coords.length < 2) return null

              const pathStr = coords
                .map((c, idx) => {
                  const relX = Math.max(8, Math.min(92, 50 + (c.lng - center.lng) * 1200))
                  const relY = Math.max(12, Math.min(88, 50 - (c.lat - center.lat) * 1200))
                  return `${idx === 0 ? 'M' : 'L'} ${relX.toFixed(1)} ${relY.toFixed(1)}`
                })
                .join(' ')

              let deviationLine = null
              if (r.isDeviated && r.courierPosition) {
                const cX = Math.max(
                  8,
                  Math.min(92, 50 + (r.courierPosition.lng - center.lng) * 1200),
                )
                const cY = Math.max(
                  12,
                  Math.min(88, 50 - (r.courierPosition.lat - center.lat) * 1200),
                )

                // Primeiro ponto da rota como referência de retorno
                const ref = coords[0]
                const refX = Math.max(8, Math.min(92, 50 + (ref.lng - center.lng) * 1200))
                const refY = Math.max(12, Math.min(88, 50 - (ref.lat - center.lat) * 1200))

                deviationLine = (
                  <line
                    key={`dev-${i}`}
                    x1={cX.toFixed(1)}
                    y1={cY.toFixed(1)}
                    x2={refX.toFixed(1)}
                    y2={refY.toFixed(1)}
                    stroke="#EF4444"
                    strokeWidth="2"
                    strokeDasharray="2,1.5"
                    filter="url(#livemap-red-glow)"
                  />
                )
              }

              return (
                <React.Fragment key={`route-${i}`}>
                  {/* LINHA AZUL: Trajeto de ruas indicado pelo sistema */}
                  <path
                    d={pathStr}
                    fill="none"
                    stroke="#2563EB"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    filter="url(#livemap-blue-glow)"
                  />
                  <path
                    d={pathStr}
                    fill="none"
                    stroke="#93C5FD"
                    strokeWidth="0.8"
                    strokeLinecap="round"
                  />
                  {/* LINHA VERMELHA: Caso o entregador faça um desvio */}
                  {deviationLine}
                </React.Fragment>
              )
            })}
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
                    <span className="absolute -inset-2 rounded-full animate-ping bg-[#FF6B35]/30 opacity-75 pointer-events-none" />
                  )}

                  {/* Nome do cliente visível acima do pin (Requisito 2) */}
                  {m.type !== 'courier' && m.customer_name && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-0.5 rounded-md bg-[#0A1128]/95 border border-[#1E2B58] text-[9px] font-bold text-white whitespace-nowrap shadow-md pointer-events-none max-w-[150px] truncate">
                      {m.customer_name}
                    </div>
                  )}

                  {/* Marker Pin Icon: com veículo para entregador e badge de ordem para cliente */}
                  <div className="relative">
                    {/* Badge numérico de ordem de entrega (Requisito 3) */}
                    {m.type !== 'courier' &&
                      typeof m.delivery_sequence === 'number' &&
                      m.delivery_sequence > 0 && (
                        <span className="absolute -top-2 -right-2 z-10 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-white text-[#FF6B35] text-[10px] font-black shadow border border-[#FF6B35]">
                          {m.delivery_sequence}
                        </span>
                      )}

                    <div
                      className={`flex items-center justify-center p-2 rounded-full shadow-brand border-2 transition-all ${
                        m.type === 'courier'
                          ? 'bg-[#0052CC] border-blue-200 text-white shadow-brand-hover ring-2 ring-[#0052CC]/50 text-sm'
                          : m.type === 'order_transit'
                            ? 'bg-[#FF6B35] border-orange-200 text-white shadow-brand-orange'
                            : m.type === 'order_delivered'
                              ? 'bg-[#00AA44] border-emerald-200 text-white'
                              : 'bg-[#FF6B35] border-orange-200 text-white shadow-brand-orange'
                      }`}
                    >
                      {m.type === 'courier' ? (
                        <span className="text-base leading-none select-none">
                          {getVehicleEmoji(m.vehicle_type)}
                        </span>
                      ) : (
                        <MapPin className="h-4 w-4" />
                      )}
                    </div>
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
          <div className="absolute bottom-3 left-3 z-30 flex flex-wrap gap-3 rounded-card bg-slate-900/95 p-2.5 backdrop-blur border border-slate-700 text-[11px] text-slate-200 shadow-xl font-sans">
            <div className="flex items-center gap-1.5">
              <span className="text-xs">🛵 🚗 🚛 🚲</span>
              <span className="font-medium">Entregador (Veículo)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FF6B35] text-[9px] font-bold text-white">
                1
              </span>
              <span className="font-medium">Ordem &amp; Nome</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-[#2563EB]"></span>
              <span className="font-medium text-blue-300">Linha Azul: Rota Real</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-1.5 w-4 rounded-full bg-[#EF4444]"></span>
              <span className="font-medium text-rose-400">Linha Vermelha: Desvio &gt;150m</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
