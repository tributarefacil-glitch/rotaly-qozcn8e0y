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
