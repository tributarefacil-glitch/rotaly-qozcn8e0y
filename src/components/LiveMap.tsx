import React, { useEffect, useMemo, useRef, useState } from 'react'
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
import { parseSafeTimestamp } from '@/lib/operationalWindow'
import { safeSetMap } from '@/lib/safeMapOps'

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
  courier_id?: string
  courier_name?: string
  vehicle_type?: string
  delivery_sequence?: number
  // Campos enriquecidos para exibição em hover / telemetria de entregador
  isDeviated?: boolean
  deviationMeters?: number
  isUnexpectedStop?: boolean
  etaMinutes?: number
  etaNextDeliveryTime?: string
  etaReturnBaseMinutes?: number
  etaReturnBaseTime?: string
  battery_level?: number
  location_timestamp?: string | number | Date
  gps_status?: 'active' | 'disabled' | 'offline'
  gps_reason?: string
  offline_buffered?: boolean
  hasActiveRoute?: boolean
  remainingRouteMinutes?: number
  projectedEndTimeFormatted?: string
  isOvertime?: boolean
  overtimeMinutes?: number
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
// Caches em memória para evitar reconstruir SVG e Data URIs a cada ping / re-render
const courierSvgIconCache = new Map<
  string,
  { url: string; scaledSize: { width: number; height: number }; anchor: { x: number; y: number } }
>()
const customerSvgIconCache = new Map<
  string,
  { url: string; scaledSize: { width: number; height: number }; anchor: { x: number; y: number } }
>()

// Geradores exportados de SVG Data-URI para Google Maps nativo (com cache em memória)
export function makeCourierSvgIcon(vehicle?: string, pinColor = '#0052CC', size = 44) {
  const normVehicle = (vehicle || '').toLowerCase().trim()
  const cacheKey = `${normVehicle}_${pinColor}_${size}`
  const cached = courierSvgIconCache.get(cacheKey)
  if (cached) return cached

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

  const result = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: size, height: size },
    anchor: { x: half, y: half },
  }
  courierSvgIconCache.set(cacheKey, result)
  return result
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
  const cleanName = (customerName || '').trim()
  const displayName = cleanName.length > 12 ? cleanName.slice(0, 11) + '…' : cleanName
  const cacheKey = `${showNameLabel ? displayName : ''}_${seq ?? ''}_${isTransit}_${width}_${height}_${pinColorOverride || ''}_${showNameLabel}`
  const cached = customerSvgIconCache.get(cacheKey)
  if (cached) return cached

  const pinColor = pinColorOverride || (isTransit ? '#FF6B35' : '#475569')
  const hasName = showNameLabel && cleanName.length > 0
  const hasSeq = typeof seq === 'number' && seq > 0
  const effectiveWidth = hasName ? Math.max(width, 96) : 34
  const effectiveHeight = hasName ? height : 34
  const centerX = Math.round(effectiveWidth / 2)
  const pinLeft = centerX - 11 // pin is 22px wide

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

  const result = {
    url: `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,
    scaledSize: { width: effectiveWidth, height: effectiveHeight },
    anchor: { x: centerX, y: hasName ? effectiveHeight - 2 : effectiveHeight - 4 },
  }
  customerSvgIconCache.set(cacheKey, result)
  return result
}

export interface RouteGeometryItem {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  streetCoordinates?: { lat: number; lng: number }[]
  courierPosition?: { lat: number; lng: number }
  isDeviated?: boolean
  isReturnLeg?: boolean
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
  showAccuracyCircle?: boolean
  accuracyRadiusMeters?: number
  onMapReady?: (mapInstance: any) => void
  onRecenter?: () => void
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
  showAccuracyCircle = false,
  accuracyRadiusMeters = 70,
  onMapReady,
  onRecenter,
}) => {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapInstanceRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const liveCourierMarkersRef = useRef<Map<string, any>>(new Map())
  const hasInitialFitRef = useRef<boolean>(false)
  const liveCourierAnimFramesRef = useRef<Map<string, number>>(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleAccuracyCircleRef = useRef<any>(null)
  // Keyed diffing maps: ID -> Google Maps instance / state cache
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googleMarkerMapRef = useRef<
    Map<
      string,
      {
        marker: any
        clickInfoWindow: any
        prevLat: number
        prevLng: number
        prevType: string
        prevSeq?: number
        prevTitle?: string
        prevName?: string
        prevDev?: boolean
      }
    >
  >(new Map())
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hoverInfoWindowRef = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const googlePolylineMapRef = useRef<Map<string, any>>(new Map())
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

  // Limpeza segura contra vazamentos ou operações pós-desmontagem
  useEffect(() => {
    return () => {
      liveCourierAnimFramesRef.current.forEach((frameId) => {
        cancelAnimationFrame(frameId)
      })
      liveCourierAnimFramesRef.current.clear()
    }
  }, [])

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
        if (onMapReady) {
          onMapReady(mapInstanceRef.current)
        }
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

      const locTime = parseSafeTimestamp(item.location_timestamp)
      const minutesSinceLastPoint = locTime ? Math.floor((Date.now() - locTime) / 60000) : 0
      const isGpsDisabled = item.gps_status === 'disabled'
      // REQUISITO: Suprimir alertas de "Sem sinal" fora de rota ativa
      const isInActiveRoute = item.hasActiveRoute !== false

      let gpsBadgeText = '📡 GPS ativo'
      let gpsBadgeBg = '#ecfdf5'
      let gpsBadgeColor = '#047857'
      let gpsBadgeBorder = '#a7f3d0'

      if (!isInActiveRoute) {
        gpsBadgeText = '⏸ Fora de rota'
        gpsBadgeBg = '#f8fafc'
        gpsBadgeColor = '#475569'
        gpsBadgeBorder = '#cbd5e1'
      } else if (isGpsDisabled) {
        if (item.gps_reason === 'permission_denied') {
          gpsBadgeText = '🚫 Permissão negada no aparelho'
        } else {
          gpsBadgeText = '📡 GPS desligado'
        }
        gpsBadgeBg = '#fef2f2'
        gpsBadgeColor = '#b91c1c'
        gpsBadgeBorder = '#fecaca'
      } else if (item.gps_status === 'offline' || minutesSinceLastPoint > 10) {
        // Faixa > 10 min: Sem sinal (vermelho/âmbar escuro)
        gpsBadgeText = `📴 Sem sinal (${minutesSinceLastPoint > 0 ? `${minutesSinceLastPoint} min` : '>10 min'})`
        gpsBadgeBg = '#fef2f2'
        gpsBadgeColor = '#b91c1c'
        gpsBadgeBorder = '#fecaca'
      } else if (minutesSinceLastPoint > 5) {
        // Faixa 5 a 10 min: Última posição há X min (cinza/âmbar suave, sem parecer falha crítica)
        gpsBadgeText = `⏸ Última posição há ${minutesSinceLastPoint} min`
        gpsBadgeBg = '#fffbeb'
        gpsBadgeColor = '#b45309'
        gpsBadgeBorder = '#fde68a'
      } else {
        // Faixa até 5 min: GPS ativo
        gpsBadgeText = '📡 GPS ativo'
        gpsBadgeBg = '#ecfdf5'
        gpsBadgeColor = '#047857'
        gpsBadgeBorder = '#a7f3d0'
      }

      // No iOS/iPhone e em aparelhos sem Battery API, battery_level reporta 0 ou undefined.
      // Tratar 0 ou <= 0 como "desconhecida" (hasBattery = false) para não alarmar o operador com bateria 0% falsa.
      const hasBattery =
        typeof item.battery_level === 'number' &&
        !isNaN(item.battery_level) &&
        item.battery_level > 0
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
          <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 5px; font-size: 10px; font-weight: 700; flex-wrap: wrap;">
            <span style="display: inline-flex; align-items: center; gap: 3px; background: ${gpsBadgeBg}; color: ${gpsBadgeColor}; border: 1px solid ${gpsBadgeBorder}; padding: 2px 5px; border-radius: 4px;">
              ${gpsBadgeText}
            </span>
            ${
              hasBattery
                ? `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #f8fafc; color: ${batteryColor}; border: 1px solid #e2e8f0; padding: 2px 5px; border-radius: 4px;">
                <span>🔋</span> ${batteryVal}%
              </span>
            `
                : `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #f8fafc; color: #64748b; border: 1px solid #e2e8f0; padding: 2px 5px; border-radius: 4px;" title="Bateria não disponível">
                <span>🔋</span> —
              </span>
            `
            }
            ${
              item.offline_buffered
                ? `
              <span style="display: inline-flex; align-items: center; gap: 3px; background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; padding: 2px 5px; border-radius: 4px; font-size: 9px;">
                🔄 Buffer sincronizado
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

          ${
            item.etaNextDeliveryTime || item.etaReturnBaseTime
              ? `
            <div style="background-color: #f0fdf4; border-radius: 6px; padding: 5px 7px; margin-top: 4px; border: 1px solid #bbf7d0;">
              <div style="font-size: 10px; color: #15803d; font-weight: 700;">
                ${
                  item.etaNextDeliveryTime && item.etaReturnBaseTime
                    ? `⏱️ Entrega ~${item.etaNextDeliveryTime} • Volta à base ~${item.etaReturnBaseTime}`
                    : item.etaNextDeliveryTime
                      ? `⏱️ Entrega ~${item.etaNextDeliveryTime}`
                      : `🏢 Retornando à base • Chegada ~${item.etaReturnBaseTime}`
                }
              </div>
            </div>
          `
              : ''
          }

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

  const getMarkerIcon = (item: MapMarkerItem) => {
    if (item.type === 'courier') {
      const pinColor = item.isDeviated ? '#EF4444' : item.isUnexpectedStop ? '#F59E0B' : '#0052CC'
      return makeCourierSvgIcon(item.vehicle_type, pinColor)
    } else if (item.type === 'order_delivered') {
      return makeCustomerSvgIcon(
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
      return makeCustomerSvgIcon(
        item.customer_name,
        item.delivery_sequence,
        isTransit,
        72,
        42,
        '#0f172a',
        false,
      )
    }
  }

  // REQUISITO ESTRITO: Entregadores só aparecem no mapa quando em rota ativa
  // (hasActiveRoute !== false && item.type === 'courier').
  // Para compatibilidade, se hasActiveRoute não estiver preenchido mas vier de tela já filtrada,
  // permitimos, mas se hasActiveRoute for explicitamente false descartamos pin e telemetria.
  const visibleMarkers = useMemo(() => {
    return markers.filter((m) => {
      if (m.type === 'courier') {
        if (m.hasActiveRoute === false) return false
      }
      return true
    })
  }, [markers])

  // Suprimir telemetria/polilinhas de entregadores que não estejam com rota ativa
  const visibleRouteLines = useMemo(() => {
    // Suprimir rotas de entregadores que não tenham marcadores visíveis em rota ativa
    const activeCourierIds = new Set(
      visibleMarkers
        .filter((m) => m.type === 'courier')
        .map((m) => m.courier_id || m.id.replace('courier-', '')),
    )

    return routeLines.filter((r) => {
      // Se a linha de rota não tiver vínculo com entregador específico, preserva
      const courierKey = (r as any).courierId || (r as any).courier_id
      if (courierKey) {
        return activeCourierIds.has(courierKey)
      }
      return true
    })
  }, [routeLines, visibleMarkers])

  const renderGoogleMarkers = () => {
    const google = getGoogle()
    if (!mapInstanceRef.current || !google?.maps) return

    // Ensure single shared hover infoWindow
    if (!hoverInfoWindowRef.current) {
      hoverInfoWindowRef.current = new google.maps.InfoWindow({
        disableAutoPan: true,
      })
    }

    // --- 1. KEYED DIFFING DE POLILINHAS ---
    const activePolylineKeys = new Set<string>()

    visibleRouteLines.forEach((r, idx) => {
      const rawCoords = r.streetCoordinates || [r.origin, r.destination]
      // Polyline limitada aos últimos 100 pontos por entregador
      const coords = rawCoords && rawCoords.length > 100 ? rawCoords.slice(-100) : rawCoords
      if (coords.length < 2) return

      const pathArray = coords.map((c) => ({ lat: c.lat, lng: c.lng }))
      const baseKey = `route-${idx}-${r.isReturnLeg ? 'return' : 'main'}`
      activePolylineKeys.add(baseKey)

      let existing = googlePolylineMapRef.current.get(baseKey)
      if (!existing) {
        if (r.isReturnLeg) {
          existing = new google.maps.Polyline({
            path: pathArray,
            geodesic: true,
            strokeColor: '#60A5FA',
            strokeOpacity: 0,
            strokeWeight: 4,
            icons: [
              {
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 2.5 },
                repeat: '8px',
              },
            ],
            map: mapInstanceRef.current,
          })
        } else {
          existing = new google.maps.Polyline({
            path: pathArray,
            geodesic: true,
            strokeColor: '#2563EB',
            strokeOpacity: 0.9,
            strokeWeight: 5,
            map: mapInstanceRef.current,
          })
        }
        googlePolylineMapRef.current.set(baseKey, existing)
      } else {
        // Apenas atualizar o caminho se já existe (sem recriar)
        existing.setPath(pathArray)
      }

      // Linha de desvio (vermelha)
      if (r.isDeviated && r.courierPosition) {
        const devKey = `dev-${idx}`
        activePolylineKeys.add(devKey)
        const refPoint = coords[0] || r.origin
        const devPath = [
          { lat: r.courierPosition.lat, lng: r.courierPosition.lng },
          { lat: refPoint.lat, lng: refPoint.lng },
        ]

        let existingDev = googlePolylineMapRef.current.get(devKey)
        if (!existingDev) {
          existingDev = new google.maps.Polyline({
            path: devPath,
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
          googlePolylineMapRef.current.set(devKey, existingDev)
        } else {
          existingDev.setPath(devPath)
        }
      }
    })

    // Remover apenas as polilinhas que não existem mais
    for (const [key, polyline] of googlePolylineMapRef.current.entries()) {
      if (!activePolylineKeys.has(key)) {
        safeSetMap(polyline, null)
        googlePolylineMapRef.current.delete(key)
      }
    }
    // --- 2. CÍRCULO DE PRECISÃO ---
    const courierItem = visibleMarkers.find((m) => m.type === 'courier' && m.lat && m.lng)
    if (showAccuracyCircle && courierItem) {
      if (!googleAccuracyCircleRef.current) {
        googleAccuracyCircleRef.current = new google.maps.Circle({
          strokeColor: '#0052CC',
          strokeOpacity: 0.65,
          strokeWeight: 1.5,
          fillColor: '#38BDF8',
          fillOpacity: 0.18,
          map: mapInstanceRef.current,
          center: { lat: courierItem.lat, lng: courierItem.lng },
          radius: accuracyRadiusMeters,
          clickable: false,
        })
      } else {
        if (typeof googleAccuracyCircleRef.current.setMap === 'function') {
          googleAccuracyCircleRef.current.setMap(mapInstanceRef.current)
        }
        googleAccuracyCircleRef.current.setCenter({ lat: courierItem.lat, lng: courierItem.lng })
        googleAccuracyCircleRef.current.setRadius(accuracyRadiusMeters)
      }
    } else if (googleAccuracyCircleRef.current) {
      safeSetMap(googleAccuracyCircleRef.current, null)
    }
    // --- 3. KEYED DIFFING DE MARCADORES (markerMapRef por ID) ---
    const currentMarkerIds = new Set<string>()

    visibleMarkers.forEach((item) => {
      if (
        typeof item.lat !== 'number' ||
        typeof item.lng !== 'number' ||
        isNaN(item.lat) ||
        isNaN(item.lng)
      ) {
        return
      }

      currentMarkerIds.add(item.id)
      const targetPos = { lat: item.lat, lng: item.lng }
      const markerIcon = getMarkerIcon(item)
      const isSelected = item.id === selectedMarkerId

      const entry = googleMarkerMapRef.current.get(item.id)

      if (entry) {
        // Marcador já existe: atualizar apenas propriedades modificadas (sem recriar nem piscar)
        const marker = entry.marker
        if (marker && typeof marker.setMap === 'function') {
          try {
            marker.setMap(mapInstanceRef.current)
          } catch {
            /* safe ignore */
          }
        }

        // Se for entregador: interpolação suave se moveu
        if (item.type === 'courier') {
          const courierId = item.id
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
          // Marcador de cliente/pedido: atualizar posição apenas se mudou
          if (
            Math.abs(entry.prevLat - item.lat) > 0.00001 ||
            Math.abs(entry.prevLng - item.lng) > 0.00001
          ) {
            marker.setPosition(targetPos)
          }
        }

        // Atualizar ícone caso status, desvio, tipo ou sequência tenham mudado
        if (
          entry.prevType !== item.type ||
          entry.prevDev !== item.isDeviated ||
          entry.prevSeq !== item.delivery_sequence ||
          entry.prevName !== item.customer_name
        ) {
          marker.setIcon(markerIcon)
        }

        if (entry.prevTitle !== item.title) {
          marker.setTitle(item.title)
        }

        // Animação de seleção (bounce)
        if (item.type !== 'courier') {
          marker.setAnimation(isSelected ? google.maps.Animation.BOUNCE : null)
        }

        // Atualizar conteúdo da clickInfoWindow
        if (entry.clickInfoWindow) {
          entry.clickInfoWindow.setContent(buildInfoWindowHtml(item))
        }

        // Atualizar cache de estado do marcador
        entry.prevLat = item.lat
        entry.prevLng = item.lng
        entry.prevType = item.type
        entry.prevSeq = item.delivery_sequence
        entry.prevTitle = item.title
        entry.prevName = item.customer_name
        entry.prevDev = item.isDeviated
      } else {
        // Criar NOVO marcador apenas se não existir ainda no mapa
        const marker = new google.maps.Marker({
          position: targetPos,
          map: mapInstanceRef.current,
          title: item.title,
          icon: markerIcon,
          animation:
            isSelected && item.type !== 'courier' ? google.maps.Animation.BOUNCE : undefined,
        })

        if (item.type === 'courier') {
          liveCourierMarkersRef.current.set(item.id, marker)
        }

        const clickInfoWindow = new google.maps.InfoWindow({
          content: buildInfoWindowHtml(item),
        })

        // Hover handlers
        marker.addListener('mouseover', () => {
          handleMarkerHover(item)
          const currentAddr = getMarkerAddress(item)
          if (hoverInfoWindowRef.current) {
            hoverInfoWindowRef.current.setContent(buildInfoWindowHtml(item, currentAddr))
            hoverInfoWindowRef.current.open(mapInstanceRef.current, marker)
          }

          if (!currentAddr || currentAddr === 'Localizando endereço...') {
            const checkTimer = setTimeout(() => {
              const updatedAddr = getMarkerAddress(item)
              if (hoverInfoWindowRef.current) {
                hoverInfoWindowRef.current.setContent(buildInfoWindowHtml(item, updatedAddr))
              }
            }, 600)
            ;(marker as any).__hoverTimer = checkTimer
          }
        })

        marker.addListener('mouseout', () => {
          if ((marker as any).__hoverTimer) clearTimeout((marker as any).__hoverTimer)
          if (hoverInfoWindowRef.current) {
            hoverInfoWindowRef.current.close()
          }
        })

        marker.addListener('click', () => {
          if (hoverInfoWindowRef.current) {
            hoverInfoWindowRef.current.close()
          }
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

          handleMarkerHover(currentExactItem, (freshAddr) => {
            clickInfoWindow.setContent(buildInfoWindowHtml(currentExactItem, freshAddr))
          })
        })

        googleMarkerMapRef.current.set(item.id, {
          marker,
          clickInfoWindow,
          prevLat: item.lat,
          prevLng: item.lng,
          prevType: item.type,
          prevSeq: item.delivery_sequence,
          prevTitle: item.title,
          prevName: item.customer_name,
          prevDev: item.isDeviated,
        })
      }
    })

    // Remover marcadores que deixaram de existir
    for (const [id, entry] of googleMarkerMapRef.current.entries()) {
      if (!currentMarkerIds.has(id)) {
        safeSetMap(entry?.marker, null)
        try {
          if (entry?.clickInfoWindow) {
            entry.clickInfoWindow.close()
          }
        } catch {
          /* intentionally ignored */
        }
        liveCourierMarkersRef.current.delete(id)
        const frame = liveCourierAnimFramesRef.current.get(id)
        if (frame) {
          cancelAnimationFrame(frame)
          liveCourierAnimFramesRef.current.delete(id)
        }
        googleMarkerMapRef.current.delete(id)
      }
    }
    // (a) fitBounds apenas no primeiro carregamento, nunca a cada ping
    if (!hasInitialFitRef.current && visibleMarkers.length > 0) {
      const bounds = new google.maps.LatLngBounds()
      let hasCoords = false
      visibleMarkers.forEach((m) => {
        if (
          typeof m.lat === 'number' &&
          typeof m.lng === 'number' &&
          !isNaN(m.lat) &&
          !isNaN(m.lng)
        ) {
          bounds.extend({ lat: m.lat, lng: m.lng })
          hasCoords = true
        }
      })
      if (hasCoords) {
        hasInitialFitRef.current = true
        mapInstanceRef.current.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 })
        const listener = google.maps.event.addListener(mapInstanceRef.current, 'idle', () => {
          if (mapInstanceRef.current.getZoom() > 15) {
            mapInstanceRef.current.setZoom(15)
          }
          google.maps.event.removeListener(listener)
        })
      }
    }
  }

  useEffect(() => {
    const google = getGoogle()
    if (google?.maps && mapInstanceRef.current) {
      renderGoogleMarkers()
    }
  }, [visibleMarkers, selectedMarkerId, resolvedAddresses, visibleRouteLines])
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
            {visibleRouteLines.map((r, i) => {
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
                  {r.isReturnLeg ? (
                    /* LINHA AZUL CLARO TRACEJADA: Volta à Base */
                    <path
                      d={pathStr}
                      fill="none"
                      stroke="#60A5FA"
                      strokeWidth="2.5"
                      strokeDasharray="4 4"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  ) : (
                    /* LINHA AZUL: Trajeto de ruas indicado pelo sistema */
                    <>
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
                    </>
                  )}
                  {/* LINHA VERMELHA: Caso o entregador faça um desvio */}
                  {deviationLine}
                </React.Fragment>
              )
            })}
          </svg>

          {/* Fallback Interactive Marker Pins on Canvas */}
          <div className="relative w-full h-full">
            {visibleMarkers.map((m, idx) => {
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
                  {/* Círculo de precisão/aura para entregador (conforme print de referência) */}
                  {m.type === 'courier' && showAccuracyCircle && (
                    <span className="absolute -inset-10 rounded-full bg-sky-400/20 border border-sky-400/40 pointer-events-none animate-pulse" />
                  )}

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
                            ? 'bg-[#0f172a] border-slate-700 text-white shadow-md'
                            : m.type === 'order_delivered'
                              ? 'bg-[#00AA44] border-emerald-200 text-white'
                              : 'bg-[#0f172a] border-slate-700 text-white shadow-md'
                      }`}
                    >
                      {m.type === 'courier' ? (
                        <span className="text-base leading-none select-none">
                          {getVehicleEmoji(m.vehicle_type)}
                        </span>
                      ) : (
                        <MapPin className="h-4 w-4 fill-white text-[#0f172a]" />
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
                          <div className="flex items-center gap-2 pt-1 font-bold text-[10px] flex-wrap">
                            {(() => {
                              const locTime = parseSafeTimestamp(m.location_timestamp)
                              const minutesSinceLastPoint = locTime
                                ? Math.floor((Date.now() - locTime) / 60000)
                                : 0
                              const isGpsDisabled = m.gps_status === 'disabled'
                              const isInActiveRoute = m.hasActiveRoute !== false

                              if (!isInActiveRoute) {
                                return (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-slate-900 text-slate-400 border-slate-700">
                                    <span>⏸</span> Fora de rota
                                  </span>
                                )
                              }
                              if (isGpsDisabled) {
                                return (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-rose-950/80 text-rose-400 border-rose-500/40">
                                    <span>📡</span> GPS off
                                  </span>
                                )
                              }
                              if (m.gps_status === 'offline' || minutesSinceLastPoint > 10) {
                                return (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-rose-950/80 text-rose-400 border-rose-500/40">
                                    <span>📴</span> Sem sinal (
                                    {minutesSinceLastPoint > 0
                                      ? `${minutesSinceLastPoint} min`
                                      : '>10 min'}
                                    )
                                  </span>
                                )
                              }
                              if (minutesSinceLastPoint > 5) {
                                return (
                                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-amber-950/80 text-amber-300 border-amber-500/40">
                                    <span>⏸</span> Última posição há {minutesSinceLastPoint} min
                                  </span>
                                )
                              }
                              return (
                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-emerald-950/80 text-emerald-400 border-emerald-500/40">
                                  <span>📡</span> GPS ativo
                                </span>
                              )
                            })()}
                            {typeof m.battery_level === 'number' &&
                            !isNaN(m.battery_level) &&
                            m.battery_level > 0 ? (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-slate-950 text-slate-200 border-slate-700">
                                <span>🔋</span> {Math.round(m.battery_level)}%
                              </span>
                            ) : (
                              <span
                                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-slate-950 text-slate-400 border-slate-800"
                                title="Bateria não informada pelo dispositivo"
                              >
                                <span>🔋</span> —
                              </span>
                            )}
                            {m.offline_buffered && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border bg-blue-950/80 text-blue-300 border-blue-500/40 text-[9px]">
                                🔄 Buffer sincronizado
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

                          {(m.etaNextDeliveryTime || m.etaReturnBaseTime) && (
                            <div className="bg-[#07132b] p-2 rounded-lg border border-blue-500/30 text-[10.5px] mt-1.5">
                              <p className="text-emerald-400 font-bold flex items-center gap-1">
                                <span>{m.etaNextDeliveryTime ? '⏱️' : '🏢'}</span>
                                {m.etaNextDeliveryTime && m.etaReturnBaseTime
                                  ? `Entrega ~${m.etaNextDeliveryTime} • Volta à base ~${m.etaReturnBaseTime}`
                                  : m.etaNextDeliveryTime
                                    ? `Entrega ~${m.etaNextDeliveryTime}`
                                    : `Retornando à base • Chegada ~${m.etaReturnBaseTime}`}
                              </p>
                            </div>
                          )}

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

          {/* Map Overlay Badge (oculto quando em modo app/simplificado com customLegend ou showAccuracyCircle) */}
          {!showAccuracyCircle && (
            <div className="absolute top-3 left-3 z-30 flex items-center gap-2 rounded-lg bg-white/95 px-3 py-1.5 backdrop-blur border border-[#dcdad6] text-xs text-slate-800 shadow-md">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-600"></span>
              </span>
              <span className="font-semibold">Rastreamento em Tempo Real (SP Hub)</span>
            </div>
          )}

          {/* Legend (compacta de 1 linha, oculta no layout mobile-first app para não poluir os botões e card) */}
          {!showAccuracyCircle && (
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
                <span className="h-1.5 w-3 rounded-full bg-[#60A5FA] border border-dashed border-[#2563EB]"></span>
                <span className="font-semibold text-sky-600">Volta à base</span>
              </div>
              <div className="flex items-center gap-1 border-l border-slate-300 pl-2">
                <span className="h-1.5 w-3 rounded-full bg-[#EF4444]"></span>
                <span className="font-semibold text-rose-600">Desvio &gt;600m</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
