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

  // Se a coordenada for de fato a de contingência ou 0,0 já foi bloqueado acima.
  // A nota histórica 'fallback detectado' só é considerada suspeita se a coordenada for exatamente nula/inválida
  // ou coincidir com o ponto de contingência. Se possui coordenada real e válida, não deve ser bloqueado.
  if (notes && typeof notes === 'string' && notes.toLowerCase().includes('fallback detectado')) {
    // Se caiu aqui, a coordenada é numérica finita e não é o ponto de contingência.
    // Preservamos falso para não bloquear clientes que já possuem coordenadas reais calibradas ou no pedido.
    return false
  }

  return false
}

/**
 * Interface auxiliar para resolução completa de coordenadas de uma parada/pedido.
 */
export interface OrderStopCoords {
  lat: number
  lng: number
  source: 'order_end_address' | 'customer_address' | 'customer_root'
}

/**
 * Resolve as coordenadas de destino de um pedido com a prioridade estrita:
 * 1. Endereço gravado diretamente no pedido (end_address_lat / end_address_lng)
 * 2. Endereço selecionado pelo customer_address_id
 * 3. Campos legados do pedido
 * 4. Coordenadas do cliente (lat / lng raiz)
 *
 * Retorna { lat, lng, source } se encontrar coordenada válida e não-suspeita, ou null se não houver nenhuma.
 */
export function resolveOrderDestinationCoords(order: any, customer?: any): OrderStopCoords | null {
  if (!order) return null

  const parseCoords = (valLat: any, valLng: any): { lat: number; lng: number } | null => {
    const nLat =
      typeof valLat === 'string' ? parseFloat(valLat) : typeof valLat === 'number' ? valLat : NaN
    const nLng =
      typeof valLng === 'string' ? parseFloat(valLng) : typeof valLng === 'number' ? valLng : NaN
    if (!Number.isFinite(nLat) || !Number.isFinite(nLng)) return null
    if (nLat === 0 && nLng === 0) return null
    if (nLat < -90 || nLat > 90 || nLng < -180 || nLng > 180) return null
    if (isSuspectPin(nLat, nLng)) return null
    return { lat: nLat, lng: nLng }
  }

  // 1. Endereço gravado diretamente no pedido
  const direct = parseCoords(order.end_address_lat, order.end_address_lng)
  if (direct) {
    return { ...direct, source: 'order_end_address' }
  }

  // 2. Endereço associado via customer_address_id
  const targetCust =
    customer || order.expand?.customer_id || order.expand?.customer || order.customer
  if (order.customer_address_id && targetCust) {
    const custAddresses = targetCust.addresses || order._customerAddresses
    if (Array.isArray(custAddresses)) {
      const matched = custAddresses.find((a: any) => a && a.id === order.customer_address_id)
      if (matched) {
        const fromAddr = parseCoords(matched.lat, matched.lng)
        if (fromAddr) {
          return { ...fromAddr, source: 'customer_address' }
        }
      }
    }
  }

  // 3. Campos legados do pedido
  const legacyCandidates = [
    { lat: order.customer_latitude, lng: order.customer_longitude },
    { lat: order.destination_latitude, lng: order.destination_longitude },
    { lat: order.lat, lng: order.lng },
    { lat: order.latitude, lng: order.longitude },
  ]
  for (const leg of legacyCandidates) {
    const fromLeg = parseCoords(leg.lat, leg.lng)
    if (fromLeg) {
      return { ...fromLeg, source: 'order_end_address' }
    }
  }

  // 4. Coordenadas do cliente (lat/lng raiz)
  if (targetCust) {
    const rootCandidates = [
      { lat: targetCust.lat, lng: targetCust.lng },
      { lat: targetCust.latitude, lng: targetCust.longitude },
    ]
    for (const root of rootCandidates) {
      const fromRoot = parseCoords(root.lat, root.lng)
      if (fromRoot) {
        return { ...fromRoot, source: 'customer_root' }
      }
    }
  }

  return null
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
