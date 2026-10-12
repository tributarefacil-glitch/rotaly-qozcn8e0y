/**
 * Utilitários à prova de falhas para operações de mapas no ecossistema Rotaly.
 * Evita crashes clássicos como "Cannot read properties of null (reading 'setMap')",
 * "Cannot read properties of undefined (reading 'setMap')" e operações em objetos destruídos/descartados.
 */

export function safeSetMap(obj: any, targetMap: any): void {
  if (!obj) return
  try {
    if (typeof obj.setMap === 'function') {
      obj.setMap(targetMap)
    }
  } catch (err) {
    console.warn('safeSetMap ignorou exceção em objeto de mapa:', err)
  }
}

export function safeSetPath(obj: any, path: any): void {
  if (!obj) return
  try {
    if (typeof obj.setPath === 'function') {
      obj.setPath(path)
    }
  } catch (err) {
    console.warn('safeSetPath ignorou exceção em polyline:', err)
  }
}

export function safeSetPosition(obj: any, pos: any): void {
  if (!obj) return
  try {
    if (typeof obj.setPosition === 'function') {
      obj.setPosition(pos)
    }
  } catch (err) {
    console.warn('safeSetPosition ignorou exceção em marcador:', err)
  }
}

export function safeClearMapObject(obj: any): void {
  if (!obj) return
  safeSetMap(obj, null)
}

/**
 * Sanitiza latitude e longitude para consumo seguro nas APIs do Google Maps.
 * Converte string com parseFloat, aceita apenas number finito, não-zero,
 * lat no intervalo [-90, 90] e lng no intervalo [-180, 180].
 * Retorna { lat: number, lng: number } ou null (com console.warn explicativo quando rejeita).
 */
export function toLatLngSegura(lat: any, lng: any): { lat: number; lng: number } | null {
  const numLat = typeof lat === 'string' ? parseFloat(lat) : typeof lat === 'number' ? lat : NaN
  const numLng = typeof lng === 'string' ? parseFloat(lng) : typeof lng === 'number' ? lng : NaN

  if (!Number.isFinite(numLat) || !Number.isFinite(numLng)) {
    console.warn('[toLatLngSegura] Coordenada rejeitada: não é número finito', { lat, lng })
    return null
  }

  if (numLat === 0 && numLng === 0) {
    console.warn('[toLatLngSegura] Coordenada rejeitada: (0, 0) não é válida', { lat, lng })
    return null
  }

  if (numLat < -90 || numLat > 90 || numLng < -180 || numLng > 180) {
    console.warn(
      '[toLatLngSegura] Coordenada rejeitada: fora dos limites geográficos [-90..90, -180..180]',
      {
        lat: numLat,
        lng: numLng,
      },
    )
    return null
  }

  return { lat: numLat, lng: numLng }
}
