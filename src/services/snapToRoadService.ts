import { pb } from '@/lib/pocketbase/client'
import { OrderRecord, CustomerRecord, LocationRecord } from '@/types/delivery'
import { haversineDistanceMeters } from '@/lib/geo'
import { fetchStreetRoute } from '@/services/osrmRoutingService'

export interface SnapRoadPoint {
  latitude: number
  longitude: number
}

export interface SnapToRoadResult {
  snappedPoints: { lat: number; lng: number }[]
  km_real_rodado: number | null
  gps_coverage_pct: number
  had_gps_gap: boolean
  provider: 'google_roads' | 'osrm' | 'raw_fallback' | 'failed'
}

/**
 * ITEM 3 (0.1): Downsample preservando curvas (~100 pontos por chamada)
 */
export function downsamplePoints(
  points: { lat: number; lng: number; created?: string }[],
  targetCount = 100,
): { lat: number; lng: number; created?: string }[] {
  if (points.length <= targetCount) return points

  const sampled: { lat: number; lng: number; created?: string }[] = []
  sampled.push(points[0])

  const step = (points.length - 1) / (targetCount - 1)
  for (let i = 1; i < targetCount - 1; i++) {
    const idx = Math.round(i * step)
    sampled.push(points[idx])
  }

  sampled.push(points[points.length - 1])
  return sampled
}

/**
 * ITEM 3 (0.1): Analisa buracos de GPS > 5min e calcula cobertura de GPS (gps_coverage_pct)
 */
export function analyzeGpsGaps(
  locations: LocationRecord[],
  routeStartTimeMs: number,
  routeEndTimeMs: number,
): { coveragePct: number; hadGapOver5Min: boolean } {
  if (locations.length < 2 || routeEndTimeMs <= routeStartTimeMs) {
    return { coveragePct: locations.length > 0 ? 100 : 0, hadGapOver5Min: false }
  }

  const sorted = [...locations].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  )

  const totalDurationMs = routeEndTimeMs - routeStartTimeMs
  let gapDurationMs = 0
  let hadGapOver5Min = false
  const FIVE_MIN_MS = 5 * 60 * 1000

  // Intervalo inicial
  const firstLocMs = new Date(sorted[0].created).getTime()
  if (firstLocMs - routeStartTimeMs > FIVE_MIN_MS) {
    gapDurationMs += firstLocMs - routeStartTimeMs
    hadGapOver5Min = true
  }

  // Intervalos entre pontos
  for (let i = 0; i < sorted.length - 1; i++) {
    const tA = new Date(sorted[i].created).getTime()
    const tB = new Date(sorted[i + 1].created).getTime()
    const delta = tB - tA
    if (delta > FIVE_MIN_MS) {
      gapDurationMs += delta
      hadGapOver5Min = true
    }
  }

  // Intervalo final
  const lastLocMs = new Date(sorted[sorted.length - 1].created).getTime()
  if (routeEndTimeMs - lastLocMs > FIVE_MIN_MS) {
    gapDurationMs += routeEndTimeMs - lastLocMs
    hadGapOver5Min = true
  }

  const coveredDurationMs = Math.max(0, totalDurationMs - gapDurationMs)
  const coveragePct =
    totalDurationMs > 0
      ? Math.min(100, Math.round((coveredDurationMs / totalDurationMs) * 100))
      : 100

  return { coveragePct, hadGapOver5Min }
}

/**
 * Snap-to-roads: envia trilha GPS do lote a Google Roads (se key disponível) ou OSRM público com fallback.
 * ITEM 3.0.1: ~100 pontos por chamada; API falhou = null com flag, NUNCA inventar km.
 */
export async function snapRouteGpsTrack(
  locations: LocationRecord[],
  routeStartTimeMs: number,
  routeEndTimeMs: number,
): Promise<SnapToRoadResult> {
  const { coveragePct, hadGapOver5Min } = analyzeGpsGaps(
    locations,
    routeStartTimeMs,
    routeEndTimeMs,
  )

  if (locations.length < 2) {
    return {
      snappedPoints: [],
      km_real_rodado: null,
      gps_coverage_pct: coveragePct,
      had_gps_gap: true,
      provider: 'failed',
    }
  }

  // Downsample para ~100 pontos
  const downsampled = downsamplePoints(
    locations.map((l) => ({ lat: l.lat, lng: l.lng, created: l.created })),
    100,
  )

  // 1. Tentar Google Roads API se houver chave pública configurada no window ou env
  const googleKey =
    typeof window !== 'undefined'
      ? (window as any).__GOOGLE_MAPS_KEY__ || (window as any).googleApiKey
      : null

  if (googleKey && typeof googleKey === 'string' && googleKey.length > 10) {
    try {
      const pathParam = downsampled.map((p) => `${p.lat},${p.lng}`).join('|')
      const url = `https://roads.googleapis.com/v1/snapToRoads?path=${encodeURIComponent(
        pathParam,
      )}&interpolate=true&key=${googleKey}`

      const res = await fetch(url)
      if (res.ok) {
        const data = await res.json()
        if (data.snappedPoints && data.snappedPoints.length > 1) {
          const snapped = data.snappedPoints.map((sp: any) => ({
            lat: sp.location.latitude,
            lng: sp.location.longitude,
          }))

          let totalMeters = 0
          for (let i = 0; i < snapped.length - 1; i++) {
            totalMeters += haversineDistanceMeters(
              snapped[i].lat,
              snapped[i].lng,
              snapped[i + 1].lat,
              snapped[i + 1].lng,
            )
          }

          return {
            snappedPoints: snapped,
            km_real_rodado: Number((totalMeters / 1000).toFixed(1)),
            gps_coverage_pct: coveragePct,
            had_gps_gap: hadGapOver5Min,
            provider: 'google_roads',
          }
        }
      }
    } catch (gErr) {
      console.warn('[snapRouteGpsTrack] Google Roads falhou, tentando fallback OSRM:', gErr)
    }
  }

  // 2. Fallback: OSRM público / match / route
  try {
    const origin = downsampled[0]
    const dest = downsampled[downsampled.length - 1]
    const osrmResult = await fetchStreetRoute(origin, dest)

    if (osrmResult && osrmResult.distanceMeters > 0) {
      // Se tiver pontos intermediários, soma pernas sequenciais do OSRM
      let totalMeters = 0
      const snappedCoords: { lat: number; lng: number }[] = []

      // Quebra em pequenos trechos para o OSRM
      const sampleStep = Math.max(1, Math.floor(downsampled.length / 5))
      const keyPoints: { lat: number; lng: number }[] = []
      for (let i = 0; i < downsampled.length; i += sampleStep) {
        keyPoints.push(downsampled[i])
      }
      if (keyPoints[keyPoints.length - 1] !== downsampled[downsampled.length - 1]) {
        keyPoints.push(downsampled[downsampled.length - 1])
      }

      for (let i = 0; i < keyPoints.length - 1; i++) {
        const leg = await fetchStreetRoute(keyPoints[i], keyPoints[i + 1])
        if (leg && leg.distanceMeters > 0) {
          totalMeters += leg.distanceMeters
          if (leg.geometryCoordinates) {
            snappedCoords.push(...leg.geometryCoordinates)
          }
        }
      }

      if (totalMeters > 0) {
        return {
          snappedPoints: snappedCoords,
          km_real_rodado: Number((totalMeters / 1000).toFixed(1)),
          gps_coverage_pct: coveragePct,
          had_gps_gap: hadGapOver5Min,
          provider: 'osrm',
        }
      }
    }
  } catch (osrmErr) {
    console.warn('[snapRouteGpsTrack] OSRM snap-to-road falhou:', osrmErr)
  }

  // Se APIs falharam ou cobertura é muito baixa:
  // ITEM 3: "API falhou = null com flag, nunca inventar km"
  return {
    snappedPoints: downsampled,
    km_real_rodado: null,
    gps_coverage_pct: coveragePct,
    had_gps_gap: hadGapOver5Min,
    provider: 'failed',
  }
}
