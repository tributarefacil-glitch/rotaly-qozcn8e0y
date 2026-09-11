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
