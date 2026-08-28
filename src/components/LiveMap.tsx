import React, { useEffect, useRef, useState } from 'react'
import { MapPin, Navigation, User, Package, AlertCircle, Compass, Layers } from 'lucide-react'
import {
  loadGoogleMapsScript,
  onGoogleMapsAuthError,
  isGoogleMapsAuthError,
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
  center = { lat: -23.555, lng: -46.65 },
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

  useEffect(() => {
    const unsub = onGoogleMapsAuthError(() => {
      setAuthError(true)
      setMapsLoaded(false)
    })

    loadGoogleMapsScript().then((success) => {
      if (success && !isGoogleMapsAuthError()) {
        setMapsLoaded(true)
        setTimeout(() => {
          initGoogleMap()
        }, 100)
      } else {
        setMapsLoaded(false)
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

  const renderGoogleMarkers = () => {
    const google = getGoogle()
    if (!mapInstanceRef.current || !google?.maps) return

    // Clear old markers
    googleMarkersRef.current.forEach((m) => m.setMap(null))
    googleMarkersRef.current = []

    markers.forEach((item) => {
      if (!item.lat || !item.lng) return

      let iconUrl = 'https://maps.google.com/mapfiles/ms/icons/blue-dot.png'
      if (item.type === 'courier') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/purple-dot.png'
      } else if (item.type === 'order_transit') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/yellow-dot.png'
      } else if (item.type === 'order_delivered') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/green-dot.png'
      } else if (item.type === 'order_pending') {
        iconUrl = 'https://maps.google.com/mapfiles/ms/icons/red-dot.png'
      }

      const marker = new google.maps.Marker({
        position: { lat: item.lat, lng: item.lng },
        map: mapInstanceRef.current,
        title: item.title,
        icon: iconUrl,
        animation: item.id === selectedMarkerId ? google.maps.Animation.BOUNCE : undefined,
      })

      const infoWindow = new google.maps.InfoWindow({
        content: `
          <div style="padding: 6px; font-family: sans-serif; color: #1e293b;">
            <strong style="font-size: 13px;">${item.title}</strong>
            ${item.subtitle ? `<p style="font-size: 11px; margin: 3px 0 0; color: #64748b;">${item.subtitle}</p>` : ''}
            ${item.speed ? `<p style="font-size: 11px; margin: 3px 0 0; color: #8b5cf6;">🚀 ${item.speed} km/h</p>` : ''}
          </div>
        `,
      })

      marker.addListener('click', () => {
        infoWindow.open(mapInstanceRef.current, marker)
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
  }, [markers, selectedMarkerId])
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
                  onClick={() => onSelectMarker && onSelectMarker(m)}
                  style={{ left: `${clampedX}%`, top: `${clampedY}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all duration-500 ease-out group z-20 ${
                    isSelected ? 'scale-125 z-30' : 'hover:scale-110'
                  }`}
                >
                  {/* Ping effect for couriers & urgent orders */}
                  {(m.type === 'courier' || m.type === 'order_transit') && (
                    <span className="absolute -inset-2 rounded-full animate-ping bg-purple-500/30 opacity-75" />
                  )}

                  {/* Marker Pin Icon */}
                  <div
                    className={`flex items-center justify-center p-2 rounded-full shadow-lg border-2 transition-all ${
                      m.type === 'courier'
                        ? 'bg-purple-600 border-purple-200 text-white shadow-purple-500/50 ring-2 ring-purple-400/50'
                        : m.type === 'order_transit'
                          ? 'bg-amber-500 border-amber-200 text-white shadow-amber-500/50'
                          : m.type === 'order_delivered'
                            ? 'bg-emerald-600 border-emerald-200 text-white'
                            : 'bg-blue-600 border-blue-200 text-white shadow-blue-500/50'
                    }`}
                  >
                    {m.type === 'courier' ? (
                      <Navigation className="h-4 w-4 transform rotate-45" />
                    ) : (
                      <MapPin className="h-4 w-4" />
                    )}
                  </div>

                  {/* Tooltip Popup on Hover */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:flex flex-col items-center pointer-events-none min-w-[140px] z-40">
                    <div className="bg-slate-900/95 text-white text-[11px] font-medium rounded-lg px-2.5 py-1.5 shadow-2xl border border-slate-700 whitespace-nowrap text-center">
                      <p className="font-bold text-white">{m.title}</p>
                      {m.subtitle && <p className="text-slate-400 text-[10px]">{m.subtitle}</p>}
                      {m.speed && (
                        <p className="text-purple-400 text-[10px] font-semibold mt-0.5">
                          🚀 {m.speed} km/h
                        </p>
                      )}
                    </div>
                    <div className="w-2 h-2 bg-slate-900 border-r border-b border-slate-700 rotate-45 -mt-1" />
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
          <div className="absolute bottom-3 left-3 z-30 flex flex-wrap gap-2 rounded-lg bg-slate-900/90 p-2 backdrop-blur border border-slate-700 text-[11px] text-slate-300 shadow-lg">
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-purple-500"></span>
              <span>Entregador Ativo</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500"></span>
              <span>Em Trânsito</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-blue-500"></span>
              <span>Pendente</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500"></span>
              <span>Entregue</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
