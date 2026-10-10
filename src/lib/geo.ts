/**
 * geo.ts
 *
 * Constantes e funções geográficas compartilhadas para detecção de exceções
 * na Torre de Controle, LiveMap, App do Entregador e Painel do Vendedor.
 */

/**
 * Limiar unificado de 600 metros para detecção de desvio de rota e parada fora do local.
 * Desvio de rota só conta acima de 600 metros da rota planejada.
 * Parada fora do local só conta acima de 600 metros do cliente de destino e da base.
 */
export const DEVIATION_THRESHOLD_METERS = 600
export const UNEXPECTED_STOP_THRESHOLD_METERS = 600

/**
 * Coordenadas de contingência do fallback da central / caso MARCIA CAMPOS (ucz7n508mxhqjvf)
 */
export const CONTINGENCY_FALLBACK_LAT = -22.906847
export const CONTINGENCY_FALLBACK_LNG = -43.172896
export const SUSPECT_PIN_TOLERANCE_DEG = 0.0001

/**
 * Sanidade de Pin: identifica se um par lat/lng ou anotações configuram pin suspeito/não calibrado.
 * - lat/lng 0 ou ausente / NaN / null / undefined
 * - dentro de 0,0001 de (-22.906847, -43.172896) (fallback de contingência)
 * - notes contendo "fallback detectado"
 */
export function isSuspectPin(
  lat: number | null | undefined,
  lng: number | null | undefined,
  notes?: string | null,
): boolean {
  if (notes && typeof notes === 'string' && notes.toLowerCase().includes('fallback detectado')) {
    return true
  }

  if (lat === null || lat === undefined || isNaN(lat)) return true
  if (lng === null || lng === undefined || isNaN(lng)) return true

  if (lat === 0 && lng === 0) return true
  if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return true

  // Fallback de contingência (-22.906847, -43.172896)
  const dLat = Math.abs(lat - CONTINGENCY_FALLBACK_LAT)
  const dLng = Math.abs(lng - CONTINGENCY_FALLBACK_LNG)
  if (dLat <= SUSPECT_PIN_TOLERANCE_DEG && dLng <= SUSPECT_PIN_TOLERANCE_DEG) {
    return true
  }

  return false
}

/**
 * Distância Haversine entre duas coordenadas geográficas em metros.
 */
export function haversineDistanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  if (lat1 === lat2 && lon1 === lon2) return 0
  const R = 6371e3 // Raio da Terra em metros
  const φ1 = (lat1 * Math.PI) / 180
  const φ2 = (lat2 * Math.PI) / 180
  const Δφ = ((lat2 - lat1) * Math.PI) / 180
  const Δλ = ((lon2 - lon1) * Math.PI) / 180

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}
