/**
 * MapDataService — Portão único de validação e sanitização de dados geográficos
 * para todo o ecossistema Rotaly.
 *
 * Garante que NENHUMA chamada ao Google Maps receba valores NaN, null, strings malformadas,
 * (0,0) ou coordenadas fora dos limites geográficos válidos [-90, 90] x [-180, 180].
 *
 * Rejeições são logadas com console.warn para observabilidade sem derrubar a aplicação.
 */

import { toLatLngSegura } from './safeMapOps'

export interface CleanCoords {
  lat: number
  lng: number
}

// Fallback canônico oficial Drogaria Mais Saudável Pilar (base matriz Rotaly)
export const OFFICIAL_FALLBACK_BASE_COORDS: CleanCoords = {
  lat: -22.6977499,
  lng: -43.2936013,
}

export const MapDataService = {
  /**
   * Retorna as coordenadas oficiais da base matriz Rotaly (Drogaria Mais Saudável Pilar)
   */
  getOfficialBaseCoords(): CleanCoords {
    return { ...OFFICIAL_FALLBACK_BASE_COORDS }
  },
  /**
   * Valida e converte latitude e longitude para coordenadas seguras { lat, lng }.
   * Aceita strings numéricas (converte com parseFloat), números finitos.
   * Rejeita NaN, null, undefined, (0,0) e coordenadas fora dos limites geográficos.
   * Retorna null se inválido (com log warn).
   */
  cleanCoords(lat: any, lng: any): CleanCoords | null {
    return toLatLngSegura(lat, lng)
  },

  /**
   * Geocodificação reversa estilo Uber via MapDataService (porta única).
   * Consolida endereço Uber: Rua, número interpolado, bairro, cidade - UF, CEP.
   * Lote/quadra é mantido no complemento padrão "Qd N, Lt N".
   */
  async reverseGeocodePin(params: {
    lat: number
    lng: number
    existingAddress?: string
    existingComplement?: string
  }) {
    const clean = toLatLngSegura(params.lat, params.lng)
    if (!clean) return null
    const { reverseGeocodeUberAddress } = await import('./uberAddress')
    return reverseGeocodeUberAddress({
      lat: clean.lat,
      lng: clean.lng,
      existingAddress: params.existingAddress,
      existingComplement: params.existingComplement,
    })
  },

  /**
   * Sanitiza um objeto de localização ou registro de telemetria.
   * Retorna { lat, lng } seguro ou null se inválido.
   */
  sanitizeLocation(loc: any): CleanCoords | null {
    if (!loc) return null
    const lat = loc.latitude ?? loc.lat
    const lng = loc.longitude ?? loc.lng
    return toLatLngSegura(lat, lng)
  },

  /**
   * Obtém as coordenadas válidas de destino de um pedido (order).
   * Prioridades:
   * 1. Endereço suspeito / pin soberano do entregador (se aplicável)
   * 2. customer_latitude / customer_longitude
   * 3. destination_latitude / destination_longitude
   * 4. lat / lng em expand.customer ou meta
   * Retorna null se nenhuma coordenada válida for encontrada.
   */
  getOrderDestination(order: any): CleanCoords | null {
    if (!order) return null

    // 1. Campos padrão de destino do pedido
    const candidates = [
      { lat: order.customer_latitude, lng: order.customer_longitude },
      { lat: order.destination_latitude, lng: order.destination_longitude },
      { lat: order.lat, lng: order.lng },
      { lat: order.latitude, lng: order.longitude },
      { lat: order.expand?.customer?.latitude, lng: order.expand?.customer?.longitude },
      { lat: order.expand?.customer_id?.latitude, lng: order.expand?.customer_id?.longitude },
    ]

    for (const c of candidates) {
      const clean = toLatLngSegura(c.lat, c.lng)
      if (clean) return clean
    }

    return null
  },

  /**
   * Obtém as coordenadas da base de origem de um pedido ou da empresa.
   * Se nenhuma coordenada válida for encontrada na empresa/pedido,
   * utiliza como fallback a base oficial da Drogaria Mais Saudável Pilar (-22.6977499, -43.2936013).
   */
  getOrderBaseOrigin(orderOrCompany?: any): CleanCoords {
    if (orderOrCompany) {
      const candidates = [
        { lat: orderOrCompany.base_latitude, lng: orderOrCompany.base_longitude },
        { lat: orderOrCompany.origin_latitude, lng: orderOrCompany.origin_longitude },
        { lat: orderOrCompany.latitude, lng: orderOrCompany.longitude },
        {
          lat: orderOrCompany.expand?.empresa?.latitude,
          lng: orderOrCompany.expand?.empresa?.longitude,
        },
        {
          lat: orderOrCompany.expand?.company?.latitude,
          lng: orderOrCompany.expand?.company?.longitude,
        },
      ]

      for (const c of candidates) {
        const clean = toLatLngSegura(c.lat, c.lng)
        if (clean) return clean
      }
    }

    return { ...OFFICIAL_FALLBACK_BASE_COORDS }
  },

  /**
   * Helper para estender LatLngBounds de forma totalmente segura.
   */
  extendBoundsSafely(bounds: any, lat: any, lng: any): boolean {
    if (!bounds || typeof bounds.extend !== 'function') return false
    const clean = toLatLngSegura(lat, lng)
    if (!clean) return false
    try {
      bounds.extend(clean)
      return true
    } catch (err) {
      console.warn('[MapDataService.extendBoundsSafely] Falha ao estender bounds:', err)
      return false
    }
  },

  /**
   * Helper para criar google.maps.LatLng ou LatLngLiteral de forma segura.
   * Retorna null se inválido.
   */
  toGoogleLatLng(googleMaps: any, lat: any, lng: any): any | null {
    const clean = toLatLngSegura(lat, lng)
    if (!clean) return null
    if (googleMaps && googleMaps.LatLng) {
      try {
        return new googleMaps.LatLng(clean.lat, clean.lng)
      } catch (err) {
        console.warn('[MapDataService.toGoogleLatLng] Falha ao instanciar LatLng:', err)
        return clean
      }
    }
    return clean
  },
}
