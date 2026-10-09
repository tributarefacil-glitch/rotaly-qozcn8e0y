/**
 * osrmRoutingService.ts
 *
 * Serviço de roteamento viário real via OSRM (Open Source Routing Machine).
 * Fornece a geometria de ruas real (coordenadas [lat, lng]) para visualização
 * de rotas sem depender de faturamento no Google Cloud.
 *
 * Características:
 * - Cache em memória com TTL por par de coordenadas de origem e destino
 * - Geometrias em GeoJSON LineString (precisão de vias/ruas reais)
 * - Fallback gracioso com interpolação geométrica caso o serviço externo falhe
 * - Utilitários para projeção de coordenadas e cálculo de desvio de rota
 */

export interface LatLngPoint {
  lat: number
  lng: number
}

export interface OsrmRouteResult {
  coordinates: LatLngPoint[]
  distanceMeters: number
  durationSeconds: number
  isRealStreetRoute: boolean
}

// Cache em memória persistente na sessão para evitar recálculos redundantes e respeitar rate limits públicos
// Mesma chave de origem-destino (com precisão de ~11m) não recalcula na mesma sessão
interface CacheEntry {
  result: OsrmRouteResult
  timestamp: number
}

// Map global em memória no módulo: dura por toda a sessão do app
const routeCache = new Map<string, CacheEntry>()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000 // 24 horas (toda a sessão do navegador)

export function getCacheKey(origin: LatLngPoint, destination: LatLngPoint): string {
  // Arredonda para 4 casas decimais (~11m de precisão) para consolidar cache
  return `${origin.lat.toFixed(4)},${origin.lng.toFixed(4)}->${destination.lat.toFixed(4)},${destination.lng.toFixed(4)}`
}

/**
 * Busca a rota com geometria real de ruas entre origem e destino via OSRM público.
 * Fallback para linha direta se falhar.
 */
/**
 * Tenta obter a rota via Google DirectionsService quando disponível no navegador.
 */
async function fetchGoogleDirectionsRoute(
  origin: LatLngPoint,
  destination: LatLngPoint,
): Promise<OsrmRouteResult | null> {
  if (typeof window === 'undefined') return null
  const win = window as any
  if (!win.google?.maps?.DirectionsService) return null

  try {
    const directionsService = new win.google.maps.DirectionsService()
    const result: any = await new Promise((resolve, reject) => {
      directionsService.route(
        {
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          travelMode: win.google.maps.TravelMode?.DRIVING || 'DRIVING',
        },
        (response: any, status: string) => {
          if (status === 'OK' && response?.routes?.[0]) {
            resolve(response)
          } else {
            reject(new Error(`Directions status: ${status}`))
          }
        },
      )
    })

    const route = result.routes[0]
    const leg = route.legs?.[0]
    const overviewPath = route.overview_path || []

    const coordinates: LatLngPoint[] = overviewPath.map((latLng: any) => ({
      lat: typeof latLng.lat === 'function' ? latLng.lat() : latLng.lat,
      lng: typeof latLng.lng === 'function' ? latLng.lng() : latLng.lng,
    }))

    if (coordinates.length >= 2) {
      return {
        coordinates,
        distanceMeters: leg?.distance?.value ?? 0,
        durationSeconds: leg?.duration?.value ?? 0,
        isRealStreetRoute: true,
      }
    }
  } catch (err) {
    // Silently proceed to OSRM fallback
  }

  return null
}

/**
 * Busca a rota com geometria real de ruas entre origem e destino.
 * Tenta primeiro Google Directions se ativo e funcional; se falhar ou não estiver disponível,
 * usa OSRM público com fallback final por interpolação.
 */
/**
 * Consulta a matriz viária de distâncias e durações usando o serviço OSRM Table API.
 * URL: /table/v1/driving/{lng1},{lat1};{lng2},{lat2};...
 * Retorna matriz N x N em metros e segundos, ou null se falhar/offline.
 */
export async function fetchOsrmDistanceMatrix(
  points: LatLngPoint[],
): Promise<{ distancesMeters: number[][]; durationsSeconds: number[][] } | null> {
  if (points.length < 2) return null
  const coordsStr = points.map((p) => `${p.lng},${p.lat}`).join(';')
  const url = `https://router.project-osrm.org/table/v1/driving/${coordsStr}?annotations=distance,duration`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 6000) // 6s timeout para a matriz viária
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
    })
    clearTimeout(timeoutId)

    if (!response.ok) return null
    const data = await response.json()
    if (data.code === 'Ok' && Array.isArray(data.distances)) {
      const distancesMeters: number[][] = data.distances.map((row: any[], i: number) =>
        row.map((val: any, j: number) => {
          if (i === j) return 0
          if (typeof val === 'number' && !isNaN(val) && val >= 0) return Math.round(val)
          return Math.round(distanceMeters(points[i], points[j]))
        }),
      )
      const durationsSeconds: number[][] = Array.isArray(data.durations)
        ? data.durations.map((row: any[], i: number) =>
            row.map((val: any, j: number) => {
              if (i === j) return 0
              if (typeof val === 'number' && !isNaN(val) && val >= 0) return Math.round(val)
              const d = distancesMeters[i]?.[j] || 0
              return Math.round((d / 1000) * 160 + 300)
            }),
          )
        : distancesMeters.map((row) => row.map((d) => Math.round((d / 1000) * 160 + 300)))

      return { distancesMeters, durationsSeconds }
    }
  } catch (err) {
    console.warn('[osrmRoutingService] Falha ao consultar OSRM distance table:', err)
  }
  return null
}

export async function fetchStreetRoute(
  origin: LatLngPoint,
  destination: LatLngPoint,
): Promise<OsrmRouteResult> {
  const cacheKey = getCacheKey(origin, destination)
  const cached = routeCache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.result
  }

  // Validação básica de coordenadas
  if (
    typeof origin.lat !== 'number' ||
    typeof origin.lng !== 'number' ||
    typeof destination.lat !== 'number' ||
    typeof destination.lng !== 'number' ||
    isNaN(origin.lat) ||
    isNaN(origin.lng) ||
    isNaN(destination.lat) ||
    isNaN(destination.lng)
  ) {
    return createDirectFallback(origin, destination)
  }

  // 1. Tentar Google Directions API se disponível na janela
  const googleRoute = await fetchGoogleDirectionsRoute(origin, destination)
  if (googleRoute) {
    routeCache.set(cacheKey, { result: googleRoute, timestamp: Date.now() })
    return googleRoute
  }

  // 2. OSRM URL format: /route/v1/driving/{lng1},{lat1};{lng2},{lat2}?overview=full&geometries=geojson
  const url = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2500) // 2.5s timeout para pernas viárias não bloquearem a rede

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
      },
    })
    clearTimeout(timeoutId)

    if (!response.ok) {
      throw new Error(`OSRM request failed with HTTP status ${response.status}`)
    }

    const data = await response.json()
    if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
      const primaryRoute = data.routes[0]
      const geoCoords: [number, number][] = primaryRoute.geometry?.coordinates || []

      // Convert [lng, lat] GeoJSON coordinates to LatLngPoint { lat, lng }
      const coordinates: LatLngPoint[] = geoCoords.map(([lng, lat]) => ({
        lat,
        lng,
      }))

      if (coordinates.length >= 2) {
        const result: OsrmRouteResult = {
          coordinates,
          distanceMeters: primaryRoute.distance ?? 0,
          durationSeconds: primaryRoute.duration ?? 0,
          isRealStreetRoute: true,
        }
        routeCache.set(cacheKey, { result, timestamp: Date.now() })
        return result
      }
    }

    throw new Error('OSRM returned empty or invalid route geometry')
  } catch (err) {
    console.warn('OSRM route fetch warning, using fallback geometry:', err)
    const fallback = createDirectFallback(origin, destination)
    // Armazena no cache por um curto período (1 min) para não inundar o OSRM se estiver instável
    routeCache.set(cacheKey, { result: fallback, timestamp: Date.now() - (CACHE_TTL_MS - 60000) })
    return fallback
  }
}

/**
 * Cria uma rota com interpolação suave caso o serviço viário externo falhe.
 */
function createDirectFallback(origin: LatLngPoint, destination: LatLngPoint): OsrmRouteResult {
  const steps = 10
  const coordinates: LatLngPoint[] = []

  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    coordinates.push({
      lat: origin.lat + t * (destination.lat - origin.lat),
      lng: origin.lng + t * (destination.lng - origin.lng),
    })
  }

  return {
    coordinates,
    distanceMeters: 0,
    durationSeconds: 0,
    isRealStreetRoute: false,
  }
}

/**
 * Distância Haversine em metros entre dois pontos geográficos.
 */
export function distanceMeters(p1: LatLngPoint, p2: LatLngPoint): number {
  if (p1.lat === p2.lat && p1.lng === p2.lng) return 0
  const R = 6371e3
  const phi1 = (p1.lat * Math.PI) / 180
  const phi2 = (p2.lat * Math.PI) / 180
  const deltaPhi = ((p2.lat - p1.lat) * Math.PI) / 180
  const deltaLambda = ((p2.lng - p1.lng) * Math.PI) / 180

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

/**
 * Encontra a projeção de um ponto P sobre o segmento A-B e a menor distância em metros.
 */
export function pointToSegmentProjection(
  p: LatLngPoint,
  a: LatLngPoint,
  b: LatLngPoint,
): { projected: LatLngPoint; distanceMeters: number } {
  const dAB = distanceMeters(a, b)
  if (dAB === 0) {
    return { projected: a, distanceMeters: distanceMeters(p, a) }
  }

  const cosMeanLat = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180)
  const x = (b.lng - a.lng) * cosMeanLat
  const y = b.lat - a.lat
  const px = (p.lng - a.lng) * cosMeanLat
  const py = p.lat - a.lat

  const dot = px * x + py * y
  const lenSq = x * x + y * y
  const param = lenSq !== 0 ? Math.max(0, Math.min(1, dot / lenSq)) : 0

  const projLat = a.lat + param * (b.lat - a.lat)
  const projLng = a.lng + param * (b.lng - a.lng)
  const projected = { lat: projLat, lng: projLng }

  return {
    projected,
    distanceMeters: distanceMeters(p, projected),
  }
}

/**
 * Encontra o ponto mais próximo de P ao longo de toda a rota viária polilinha (linha azul).
 */
export function findNearestPointOnRoute(
  point: LatLngPoint,
  routeCoordinates: LatLngPoint[],
): { nearestPoint: LatLngPoint; distanceMeters: number; segmentIndex: number } {
  if (routeCoordinates.length === 0) {
    return { nearestPoint: point, distanceMeters: 0, segmentIndex: 0 }
  }
  if (routeCoordinates.length === 1) {
    return {
      nearestPoint: routeCoordinates[0],
      distanceMeters: distanceMeters(point, routeCoordinates[0]),
      segmentIndex: 0,
    }
  }

  let minDistance = Infinity
  let bestPoint = routeCoordinates[0]
  let bestSegmentIndex = 0

  for (let i = 0; i < routeCoordinates.length - 1; i++) {
    const a = routeCoordinates[i]
    const b = routeCoordinates[i + 1]
    const { projected, distanceMeters: d } = pointToSegmentProjection(point, a, b)
    if (d < minDistance) {
      minDistance = d
      bestPoint = projected
      bestSegmentIndex = i
    }
  }

  return {
    nearestPoint: bestPoint,
    distanceMeters: minDistance,
    segmentIndex: bestSegmentIndex,
  }
}
