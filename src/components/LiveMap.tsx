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
  // Campos enriquecidos para exibição em hover / telemetria de entregador
  isDeviated?: boolean
  deviationMeters?: number
  isUnexpectedStop?: boolean
  etaMinutes?: number
  battery_level?: number
  location_timestamp?: string | number | Date
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

// Geradores exportados de SVG Data-URI para Google Maps nativo
export function makeCourierSvgIcon(vehicle?: string, pinColor = '#0052CC', size = 44) {
  const emoji = getVehicleEmoji(vehicle)
  const half = Math.round(size / 2)
  const radius = half - 4
  const fontSize = Math.round(size * 0.41)
  const yPos = Math.round(half + fontSize * 0.3)

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <filter id="c-shadow-${size}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#000" flood-opacity="0.45"/>
        </filter>
      </defs>
      <circle cx="${half}" cy="${half}" r="${radius}" fill="${pinColor}" stroke="#FFFFFF" stroke-width="3" filter="url(#c-shadow-${size})"/>
      <text x="${half}" y="${yPos}" font-size="${fontSize}" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
    </svg>
  `.trim()

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: size, height: size },
    anchor: { x: half, y: half },
  }
}

export function makeCustomerSvgIcon(
  customerName?: string,
  seq?: number,
  isTransit = false,
  width = 72,
  height = 42,
  pinColorOverride?: string,
  showNameLabel = false,
) {
  const pinColor = pinColorOverride || (isTransit ? '#FF6B35' : '#475569')
  const cleanName = (customerName || '').trim()
  const hasName = showNameLabel && cleanName.length > 0
  const hasSeq = typeof seq === 'number' && seq > 0
  const effectiveWidth = hasName ? Math.max(width, 96) : 34
  const effectiveHeight = hasName ? height : 34
  const centerX = Math.round(effectiveWidth / 2)
  const pinLeft = centerX - 11 // pin is 22px wide

  // Truncar nome com no máximo 12 caracteres para não poluir nem sobrepor outros pins
  const displayName = cleanName.length > 12 ? cleanName.slice(0, 11) + '…' : cleanName

  // SVG compacto com tipografia reduzida e pin focado no badge numérico da sequência
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${effectiveWidth}" height="${effectiveHeight}" viewBox="0 0 ${effectiveWidth} ${effectiveHeight}">
      <defs>
        <filter id="pin-shadow-${effectiveWidth}" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-color="#000" flood-opacity="0.6"/>
        </filter>
      </defs>

      <!-- Label de Nome do Cliente no topo compacta (apenas quando solicitado/hover) -->
      ${
        hasName
          ? `
        <g filter="url(#pin-shadow-${effectiveWidth})">
          <rect x="2" y="1" width="${effectiveWidth - 4}" height="12" rx="3" fill="#0A1128" fill-opacity="0.95" stroke="#1E2B58" stroke-width="0.8"/>
          <text x="${centerX}" y="9.5" font-size="7.5" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="700" fill="#FFFFFF" text-anchor="middle">
            ${displayName}
          </text>
        </g>
      `
          : ''
      }

      <!-- Pin corpo centralizado em X=${centerX} (escala 22x28) -->
      <g transform="translate(${pinLeft}, ${hasName ? 14 : 2})" filter="url(#pin-shadow-${effectiveWidth})">
        <path d="M11 0 C4.92 0 0 4.92 0 11 C0 19.25 11 28 11 28 C11 28 22 19.25 22 11 C22 4.92 17.08 0 11 0 Z" fill="${pinColor}" stroke="#FFFFFF" stroke-width="1.5"/>
        
        <!-- Círculo interno com número da sequência sempre em destaque -->
        ${
          hasSeq
            ? `
          <circle cx="11" cy="10" r="7" fill="#FFFFFF"/>
          <text x="11" y="13.5" font-size="9" font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif" font-weight="900" fill="${pinColor}" text-anchor="middle">${seq}</text>
        `
            : `
          <circle cx="11" cy="10" r="4" fill="#FFFFFF"/>
        `
        }
      </g>
    </svg>
  `.trim()

  return {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: effectiveWidth, height: effectiveHeight },
    anchor: { x: centerX, y: hasName ? effectiveHeight - 2 : effectiveHeight - 4 },
  }
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
  customLegend?: React.ReactNode
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
  customLegend,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveCourierMarkersRef = useRef<Map<string, any>>(new Map())
  const liveCourierAnimFramesRef = useRef<Map<string, number>>(new Map())
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
  // Usa estritamente a coordenada exata passada por item.lat e item.lng
  const handleMarkerHover = (item: MapMarkerItem, onResolved?: (addr: string) => void) => {
    if (
      typeof item.lat !== 'number' ||
      typeof item.lng !== 'number' ||
      isNaN(item.lat) ||
      isNaN(item.lng)
    )
      return

    // If marker already has customer_address (order markers)
    if (item.type !== 'courier' && item.customer_address) {
      if (!resolvedAddresses[item.id]) {
        setResolvedAddresses((prev) => ({ ...prev, [item.id]: item.customer_address! }))
      }
      if (onResolved) onResolved(item.customer_address)
      return
    }

    const posKey = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`
    if (resolvedAddresses[posKey]) {
      if (onResolved) onResolved(resolvedAddresses[posKey])
      return
    }
    if (loadingAddressIds[posKey]) return

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
        if (onResolved) onResolved(addressText)
      })
      .catch(() => {
        const fallbackText = `Lat: ${item.lat.toFixed(5)}, Lng: ${item.lng.toFixed(5)}`
        setResolvedAddresses((prev) => ({
          ...prev,
          [posKey]: fallbackText,
          [item.id]: fallbackText,
        }))
        if (onResolved) onResolved(fallbackText)
      })
      .finally(() => {
        setLoadingAddressIds((prev) => ({ ...prev, [posKey]: false }))
      })
  }

  // Helper to get displayed address for a marker
  const getMarkerAddress = (item: MapMarkerItem) => {
    if (item.type !== 'courier' && item.customer_address) return item.customer_address
    const posKey = `${item.lat.toFixed(4)},${item.lng.toFixed(4)}`
    if (resolvedAddresses[posKey]) return resolvedAddresses[posKey]
    if (item.type !== 'courier' && resolvedAddresses[item.id]) return resolvedAddresses[item.id]
    if (item.customer_address) return item.customer_address
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
          styles: [],
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
    const isCourier = item.type === 'courier'
    const vehicleEmoji = getVehicleEmoji(item.vehicle_type)
    const vehicleLabel = getVehicleLabel(item.vehicle_type)

    // Se for entregador, formatar tooltip com nome, veículo, bateria, status GPS, endereço atual e alerta de desvio
    if (isCourier) {
      const courierDisplayName = item.courier_name || item.title
      const hasDeviation = item.isDeviated && typeof item.deviationMeters === 'number'

      let isGpsActive = false
      if (item.location_timestamp) {
        const locTime = new Date(item.location_timestamp).getTime()
        if (!isNaN(locTime)) {
          isGpsActive = Date.now() - locTime <= 2 * 60 * 1000
        }
      } else {
        isGpsActive = true
      }

      const hasBattery = typeof item.battery_level === 'number' && !isNaN(item.battery_level)
      const batteryVal = Math.round(item.battery_level || 0)
      const batteryColor = batteryVal <= 20 ? '#dc2626' : batteryVal <= 50 ? '#d97706' : '#16a34a'

      return `
        <div style="padding: 8px 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 260px; line-height: 1.35;">
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 4px;">
            <div style="display: flex; align-items: center; gap: 5px;">
              <span style="font-size: 15px;">${vehicleEmoji}</span>
              <strong style="font-size: 12px; color: #0f172a; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${courierDisplayName}</strong>
            </div>
            <span style="font-size: 9px; font-weight: 700; background: #e0f2fe; color: #0369a1; padding: 1px 5px; border-radius: 4px;">${vehicleLabel}</span>
          </div>

          <!-- Badges de Bateria e GPS -->
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 10px; font-weight: 700;">
            <span style="display: inline-flex; align-items: center; gap: 3px; background: ${isGpsActive ? '#ecfdf5' : '#fef2f2'}; color: ${isGpsActive ? '#047857' : '#b91c1c'}; border: 1px solid ${isGpsActive ? '#a7f3d0' : '#fecaca'}; padding: 2px 5px; border-radius: 4px;">
              <span>📡</span> ${isGpsActive ? 'GPS ativo' : 'GPS off'}
            </span>
            ${
              hasBattery
                ? `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #f8fafc; color: ${batteryColor}; border: 1px solid #e2e8f0; padding: 2px 5px; border-radius: 4px;">
                <span>🔋</span> ${batteryVal}%
              </span>
            `
                : ''
            }
          </div>

          ${
            hasDeviation
              ? `
            <div style="background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; padding: 4px 6px; margin-bottom: 5px; display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 10px;">⚠️</span>
              <span style="font-size: 11px; font-weight: 800; color: #dc2626;">Desvio: ${Math.round(item.deviationMeters || 0)} m</span>
            </div>
          `
              : item.isUnexpectedStop
                ? `
            <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 4px 6px; margin-bottom: 5px; display: flex; align-items: center; gap: 4px;">
              <span style="font-size: 10px;">⛔</span>
              <span style="font-size: 11px; font-weight: 800; color: #d97706;">Parada fora do local (>600m)</span>
            </div>
          `
                : ''
          }

          <div style="background-color: #f8fafc; border-radius: 6px; padding: 5px 7px; margin-top: 3px; border: 1px solid #e2e8f0;">
            <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: #2563eb; display: block; margin-bottom: 2px;">
              📍 Endereço Atual em Tempo Real:
            </span>
            <span style="font-size: 10.5px; color: #1e293b; font-weight: 500; display: block; line-height: 1.3;">
              ${addressDisplay || 'Localizando endereço...'}
            </span>
          </div>

          ${item.speed ? `<p style="font-size: 10px; margin: 4px 0 0; color: #6d28d9; font-weight: 600;">🚀 ${item.speed} km/h</p>` : ''}
        </div>
      `
    }

    return `
      <div style="padding: 8px 10px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #0f172a; max-width: 250px; line-height: 1.35;">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 3px;">
          <strong style="font-size: 12px; color: #0f172a; font-weight: 700; line-height: 1.2;">${item.customer_name || item.title}</strong>
          ${
            item.delivery_sequence
              ? `<span style="font-size: 9px; font-weight: 800; background: #ffedd5; color: #c2410c; padding: 1px 5px; border-radius: 4px;">#${item.delivery_sequence}</span>`
              : ''
          }
        </div>
        ${item.subtitle ? `<p style="font-size: 10px; margin: 1px 0 4px; color: #64748b; line-height: 1.25;">${item.subtitle}</p>` : ''}
        
        <div style="background-color: #f8fafc; border-radius: 6px; padding: 5px 7px; margin: 4px 0; border: 1px solid #e2e8f0;">
          <span style="font-size: 9px; font-weight: 700; text-transform: uppercase; color: #2563eb; display: block; margin-bottom: 2px;">
            📍 Endereço de Entrega:
          </span>
          <span style="font-size: 10.5px; color: #1e293b; font-weight: 500; display: block; line-height: 1.3;">
            ${addressDisplay || 'Resolvendo endereço...'}
          </span>
        </div>

        ${item.estimated_arrival ? `<p style="font-size: 10px; margin: 3px 0 0; color: #0284c7; font-weight: 500;">⏱️ Previsão: ${new Date(item.estimated_arrival).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>` : ''}
        ${
          item.tracking_code
            ? `
          <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; display: flex; align-items: center; justify-content: space-between;">
            <span style="font-size: 9.5px; font-family: monospace; color: #64748b; font-weight: bold;">${item.tracking_code}</span>
            <a href="${trackUrl}" target="_blank" rel="noopener noreferrer" style="font-size: 10px; color: #2563eb; font-weight: bold; text-decoration: none;">
              Rastreio ↗
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

    // Clear old non-courier markers
    googleMarkersRef.current.forEach((m) => {
      const isManagedCourier = Array.from(liveCourierMarkersRef.current.values()).includes(m)
      if (!isManagedCourier) {
        m.setMap(null)
      }
    })
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

    // Usar os geradores unificados makeCourierSvgIcon e makeCustomerSvgIcon

    markers.forEach((item) => {
      if (!item.lat || !item.lng) return

      let markerIcon: any = 'https://maps.google.com/mapfiles/ms/icons/orange-dot.png'
      if (item.type === 'courier') {
        const pinColor = item.isDeviated ? '#EF4444' : item.isUnexpectedStop ? '#F59E0B' : '#0052CC'
        markerIcon = makeCourierSvgIcon(item.vehicle_type, pinColor)
      } else if (item.type === 'order_delivered') {
        markerIcon = makeCustomerSvgIcon(
          item.customer_name,
          item.delivery_sequence,
          false,
          72,
          42,
          '#10B981',
          false,
        )
      } else {
        const isTransit = item.type === 'order_transit'
        markerIcon = makeCustomerSvgIcon(
          item.customer_name,
          item.delivery_sequence,
          isTransit,
          72,
          42,
          undefined,
          false,
        )
      }

      let marker: any

      if (item.type === 'courier') {
        const courierId = item.id
        const targetPos = { lat: item.lat, lng: item.lng }
        const existing = liveCourierMarkersRef.current.get(courierId)

        if (existing) {
          marker = existing
          marker.setMap(mapInstanceRef.current)
          marker.setTitle(item.title)
          marker.setIcon(markerIcon)

          // Interpolação e transição suave (~2.5s)
          const prevPos = marker.getPosition()
          if (prevPos) {
            const startLat = prevPos.lat()
            const startLng = prevPos.lng()
            const deltaLat = targetPos.lat - startLat
            const deltaLng = targetPos.lng - startLng

            if (Math.abs(deltaLat) > 0.00001 || Math.abs(deltaLng) > 0.00001) {
              const prevAnim = liveCourierAnimFramesRef.current.get(courierId)
              if (prevAnim) cancelAnimationFrame(prevAnim)

              const animStartTime = performance.now()
              const duration = 2500

              const step = (now: number) => {
                const elapsed = now - animStartTime
                const progress = Math.min(1, elapsed / duration)
                const ease =
                  progress < 0.5 ? 2 * progress * progress : -1 + (4 - 2 * progress) * progress

                const curLat = startLat + deltaLat * ease
                const curLng = startLng + deltaLng * ease
                marker.setPosition({ lat: curLat, lng: curLng })

                if (progress < 1) {
                  const reqId = requestAnimationFrame(step)
                  liveCourierAnimFramesRef.current.set(courierId, reqId)
                } else {
                  marker.setPosition(targetPos)
                  liveCourierAnimFramesRef.current.delete(courierId)
                }
              }

              const reqId = requestAnimationFrame(step)
              liveCourierAnimFramesRef.current.set(courierId, reqId)
            } else {
              marker.setPosition(targetPos)
            }
          } else {
            marker.setPosition(targetPos)
          }
        } else {
          marker = new google.maps.Marker({
            position: targetPos,
            map: mapInstanceRef.current,
            title: item.title,
            icon: markerIcon,
          })
          liveCourierMarkersRef.current.set(courierId, marker)
        }
      } else {
        marker = new google.maps.Marker({
          position: { lat: item.lat, lng: item.lng },
          map: mapInstanceRef.current,
          title: item.title,
          icon: markerIcon,
          animation: item.id === selectedMarkerId ? google.maps.Animation.BOUNCE : undefined,
        })
      }

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
        // Obter posição exata atual do marcador na hora do clique para evitar estado defasado
        const markerPos = marker.getPosition ? marker.getPosition() : null
        const currentLat = markerPos ? markerPos.lat() : item.lat
        const currentLng = markerPos ? markerPos.lng() : item.lng

        const currentExactItem: MapMarkerItem = {
          ...item,
          lat: currentLat,
          lng: currentLng,
        }

        const currentAddr = getMarkerAddress(currentExactItem)
        clickInfoWindow.setContent(buildInfoWindowHtml(currentExactItem, currentAddr))
        clickInfoWindow.open(mapInstanceRef.current, marker)
        setActivePopupMarker(currentExactItem)
        if (onSelectMarker) onSelectMarker(currentExactItem)

        // Forçar resolução com callback imediato para atualizar o HTML da infoWindow
        handleMarkerHover(currentExactItem, (freshAddr) => {
          clickInfoWindow.setContent(buildInfoWindowHtml(currentExactItem, freshAddr))
        })
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
      className="relative w-full rounded-2xl overflow-hidden border border-slate-200 shadow-md bg-[#e5e3df] text-slate-800"
      style={{ height }}
    >
      {/* Google map container */}
      <div
        ref={mapContainerRef}
        className={`absolute inset-0 w-full h-full ${mapsLoaded && !authError ? 'z-10 opacity-100' : 'z-0 opacity-0 pointer-events-none'}`}
      />

      {/* Fallback interactive stylish vector map canvas if Google maps is unavailable or auth failed */}
      {(!mapsLoaded || authError) && (
        <div className="absolute inset-0 flex flex-col justify-between p-4 bg-[#e5e3df] text-slate-800 z-10 select-none overflow-hidden">
          {/* Subtle grid lines background em tons claros */}
          <div className="absolute inset-0 opacity-25 bg-[radial-gradient(#dcdad6_1.5px,transparent_1.5px)] [background-size:24px_24px]" />
          {/* Vias e rodovias simuladas no fundo do canvas vetorial */}
          <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-40">
            <line x1="0%" y1="35%" x2="100%" y2="40%" stroke="#fcd6a4" strokeWidth="8" />
            <line x1="45%" y1="0%" x2="52%" y2="100%" stroke="#fcd6a4" strokeWidth="7" />
            <line x1="0%" y1="70%" x2="100%" y2="65%" stroke="#ffffff" strokeWidth="5" />
            <line x1="20%" y1="0%" x2="25%" y2="100%" stroke="#ffffff" strokeWidth="4" />
            <line x1="75%" y1="0%" x2="80%" y2="100%" stroke="#ffffff" strokeWidth="4" />
          </svg>

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
                  style={{
                    left: `${clampedX}%`,
                    top: `${clampedY}%`,
                    transitionProperty: 'left, top, transform',
                    transitionDuration: m.type === 'courier' ? '2500ms' : '300ms',
                    transitionTimingFunction: 'cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer group ${
                    isSelected || activePopupMarker?.id === m.id
                      ? 'z-40 scale-110'
                      : 'z-20 hover:scale-110 hover:z-30'
                  }`}
                >
                  {/* Ping effect for couriers & urgent orders */}
                  {(m.type === 'courier' || m.type === 'order_transit') && (
                    <span className="absolute -inset-2 rounded-full animate-ping bg-[#FF6B35]/30 opacity-75 pointer-events-none" />
                  )}

                  {/* Nome do cliente visível apenas no hover/seleção para não poluir o mapa */}
                  {m.type !== 'courier' && m.customer_name && (
                    <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-1.5 py-0.5 rounded bg-[#0A1128]/95 border border-[#1E2B58] text-[8px] font-bold text-white whitespace-nowrap shadow-md pointer-events-none max-w-[120px] truncate z-30">
                      {m.customer_name}
                    </div>
                  )}

                  {/* Marker Pin Icon: com veículo para entregador e badge de ordem para cliente */}
                  <div className="relative">
                    {/* Badge numérico de ordem de entrega sempre visível e limpo */}
                    {m.type !== 'courier' &&
                      typeof m.delivery_sequence === 'number' &&
                      m.delivery_sequence > 0 && (
                        <span className="absolute -top-1.5 -right-1.5 z-10 flex h-4 min-w-4 px-1 items-center justify-center rounded-full bg-white text-[#FF6B35] text-[9.5px] font-black shadow border border-[#FF6B35]">
                          {m.delivery_sequence}
                        </span>
                      )}

                    <div
                      className={`flex items-center justify-center p-1.5 rounded-full shadow-brand border-2 transition-all ${
                        m.type === 'courier'
                          ? m.isDeviated
                            ? 'bg-[#EF4444] border-red-200 text-white ring-2 ring-red-500/50 text-sm'
                            : m.isUnexpectedStop
                              ? 'bg-[#F59E0B] border-amber-200 text-white ring-2 ring-amber-500/50 text-sm'
                              : 'bg-[#0052CC] border-blue-200 text-white ring-2 ring-[#0052CC]/50 text-sm'
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
                        <MapPin className="h-3.5 w-3.5" />
                      )}
                    </div>
                  </div>

                  {/* Tooltip & Interactive Popover for Customer / Courier Marker (Hover & Click) */}
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex-col items-center min-w-[210px] max-w-[260px] z-50 transition-all ${
                      activePopupMarker?.id === m.id
                        ? 'flex pointer-events-auto opacity-100 scale-100'
                        : 'hidden group-hover:flex pointer-events-auto opacity-100'
                    }`}
                  >
                    <div className="bg-slate-900/98 text-white text-xs rounded-xl p-2.5 shadow-2xl border border-slate-700 w-full space-y-1.5 backdrop-blur-md">
                      {m.type === 'courier' ? (
                        /* Tooltip de Entregador: Nome, Veículo, Alerta de Desvio e Endereço Atual */
                        <div>
                          <div className="flex items-center justify-between gap-1.5 border-b border-slate-800 pb-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-sm">{getVehicleEmoji(m.vehicle_type)}</span>
                              <span className="font-bold text-white text-xs truncate max-w-[130px]">
                                {m.courier_name || m.title}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded">
                              {getVehicleLabel(m.vehicle_type)}
                            </span>
                          </div>

                          {/* Badges de Bateria e GPS no popup do canvas */}
                          <div className="flex items-center gap-2 pt-1 font-bold text-[10px]">
                            {(() => {
                              const isGpsActive = m.location_timestamp
                                ? Date.now() - new Date(m.location_timestamp).getTime() <=
                                  2 * 60 * 1000
                                : true
                              return (
                                <span
                                  className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border ${
                                    isGpsActive
                                      ? 'bg-emerald-950/80 text-emerald-400 border-emerald-500/40'
                                      : 'bg-rose-950/80 text-rose-400 border-rose-500/40'
                                  }`}
                                >
                                  <span>📡</span> {isGpsActive ? 'GPS ativo' : 'GPS off'}
                                </span>
                              )
                            })()}
                            {typeof m.battery_level === 'number' && !isNaN(m.battery_level) && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-slate-950 text-slate-200 border-slate-700">
                                <span>🔋</span> {Math.round(m.battery_level)}%
                              </span>
                            )}
                          </div>

                          {m.isDeviated && typeof m.deviationMeters === 'number' && (
                            <div className="mt-1.5 bg-rose-950/80 border border-rose-500/60 rounded-lg px-2 py-1 flex items-center gap-1.5 text-rose-300 font-bold text-[10.5px]">
                              <span>⚠️</span>
                              <span>Desvio: {Math.round(m.deviationMeters)} m</span>
                            </div>
                          )}

                          {!m.isDeviated && m.isUnexpectedStop && (
                            <div className="mt-1.5 bg-amber-950/80 border border-amber-500/60 rounded-lg px-2 py-1 flex items-center gap-1.5 text-amber-300 font-bold text-[10.5px]">
                              <span>⛔</span>
                              <span>Parada fora do local (&gt;600m)</span>
                            </div>
                          )}

                          <div className="bg-slate-950/80 p-2 rounded-lg border border-slate-800 text-[10.5px] space-y-0.5 mt-1.5">
                            <div className="flex items-center gap-1 text-[9px] font-bold text-[#60A5FA] uppercase tracking-wider">
                              <MapPin className="h-3 w-3 shrink-0 text-[#60A5FA]" />
                              <span>Endereço Atual em Tempo Real</span>
                            </div>
                            <p className="text-slate-200 text-[10.5px] leading-snug break-words font-sans">
                              {getMarkerAddress(m) || 'Localizando endereço...'}
                            </p>
                          </div>

                          {m.speed && (
                            <p className="text-purple-400 text-[10px] font-semibold flex items-center gap-1 mt-1">
                              🚀 {m.speed} km/h
                            </p>
                          )}
                        </div>
                      ) : (
                        /* Tooltip de Pedido / Cliente */
                        <div>
                          <div className="flex items-start justify-between gap-1.5 border-b border-slate-800 pb-1">
                            <div>
                              <p className="font-bold text-white text-xs leading-snug">{m.title}</p>
                              {m.subtitle && (
                                <p className="text-slate-400 text-[9.5px] leading-tight mt-0.5 line-clamp-2 font-medium">
                                  {m.subtitle}
                                </p>
                              )}
                            </div>
                            <span
                              className={`text-[8.5px] px-1.5 py-0.5 rounded-full font-bold uppercase shrink-0 ${
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
                          </div>

                          <div className="bg-slate-950/80 p-1.5 rounded-lg border border-slate-800 text-[10.5px] space-y-0.5 mt-1.5">
                            <div className="flex items-center gap-1 text-[9px] font-bold text-[#60A5FA] uppercase tracking-wider">
                              <MapPin className="h-3 w-3 shrink-0 text-[#60A5FA]" />
                              <span>Endereço de Entrega</span>
                            </div>
                            <p className="text-slate-200 text-[10.5px] leading-snug break-words font-sans">
                              {getMarkerAddress(m) || 'Resolvendo endereço...'}
                            </p>
                          </div>

                          {m.estimated_arrival && (
                            <div className="flex items-center gap-1 text-[10px] text-sky-300 bg-sky-950/50 p-1 rounded-lg border border-sky-800/60 mt-1">
                              <Clock className="h-3 w-3 shrink-0 text-sky-400" />
                              <span>
                                Previsão:{' '}
                                {new Date(m.estimated_arrival).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          )}

                          {m.tracking_code && (
                            <div className="pt-1 mt-1 border-t border-slate-800 flex items-center justify-between gap-1.5">
                              <span className="font-mono font-bold text-[9px] text-slate-300">
                                {m.tracking_code}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={(e) => copyTrackingLink(m.tracking_code!, e)}
                                  className="py-1 px-1.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[9px] shadow transition"
                                  title="Copiar link"
                                >
                                  {copiedCode === m.tracking_code ? 'Copiado' : 'Copiar'}
                                </button>
                                <a
                                  href={`/track/${m.tracking_code}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="py-1 px-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-[9px] border border-slate-700"
                                >
                                  Ver ↗
                                </a>
                              </div>
                            </div>
                          )}
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
          <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5 backdrop-blur border border-[#dcdad6] text-xs text-slate-800 shadow-md">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600"></span>
            </span>
            <span className="font-semibold">Rastreamento em Tempo Real (SP Hub)</span>
          </div>

          {/* Legend (compacta de 1 linha) */}
          <div className="absolute bottom-2.5 left-2.5 z-30 flex items-center gap-2.5 rounded-lg bg-white/95 px-2.5 py-1.5 backdrop-blur border border-[#dcdad6] text-[10px] text-slate-800 shadow-lg font-sans">
            <div className="flex items-center gap-1">
              <span className="text-xs">🛵/🚗/🚛</span>
              <span className="font-semibold text-slate-700">Entregador</span>
            </div>
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
              <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-[#FF6B35] text-[9px] font-black text-white">
                1
              </span>
              <span className="font-semibold text-slate-700">Parada</span>
            </div>
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
              <span className="h-1.5 w-3 rounded-full bg-[#2563EB]"></span>
              <span className="font-semibold text-blue-700">Rota</span>
            </div>
            <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
              <span className="h-1.5 w-3 rounded-full bg-[#EF4444]"></span>
              <span className="font-semibold text-rose-600">Desvio &gt;600m</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
