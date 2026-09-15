/**
 * Utilitários e gerenciador de linhas/polilinhas blindadas e cache de ícones da Torre de Controle.
 * Evita crashes clássicos:
 * - "Cannot read properties of null (reading 'setMap')"
 * - "Cannot read properties of null (reading 'setPath')"
 * - Perda de referências de polilinhas ao alternar entre retorno à base e nova entrega (hasForward volta a ser true).
 */

import { safeSetMap, safeSetPath } from '@/lib/safeMapOps'
import { makeCourierSvgIcon, makeCustomerSvgIcon } from '@/components/LiveMap'

export interface CourierActiveLines {
  main: any
  inner: any
  returnLeg?: any
  dev?: any
}

/**
 * Cache nativo em memória para ícones do Google Maps na Torre de Controle,
 * evitando reconstruir instâncias de win.google.maps.Size / win.google.maps.Point a cada ping.
 */
const towerCourierIconCache = new Map<string, any>()
const towerCustomerIconCache = new Map<string, any>()

/**
 * Cria ou recupera do cache o ícone nativo do Google Maps para o entregador.
 */
export function getCachedNativeCourierSvg(
  winGoogle: any,
  vehicle?: string,
  pinColor = '#0052CC',
  size = 46,
) {
  if (!winGoogle?.maps) return null
  const normVehicle = (vehicle || '').toLowerCase().trim()
  const cacheKey = `${normVehicle}_${pinColor}_${size}`

  const cached = towerCourierIconCache.get(cacheKey)
  if (cached) return cached

  const generated = makeCourierSvgIcon(vehicle, pinColor, size)
  const half = Math.round(size / 2)
  const result = {
    url: generated.url,
    scaledSize: new winGoogle.maps.Size(size, size),
    anchor: new winGoogle.maps.Point(half, half),
  }

  towerCourierIconCache.set(cacheKey, result)
  return result
}

/**
 * Cria ou recupera do cache o ícone nativo do Google Maps para o cliente/parada.
 */
export function getCachedNativeCustomerSvg(
  winGoogle: any,
  customerName?: string,
  seq?: number,
  isTransit = false,
  width = 72,
  height = 42,
  pinColorOverride?: string,
  showNameLabel = false,
) {
  if (!winGoogle?.maps) return null
  const cleanName = (customerName || '').trim()
  const displayName = cleanName.length > 12 ? cleanName.slice(0, 11) + '…' : cleanName
  const cacheKey = `${showNameLabel ? displayName : ''}_${seq ?? ''}_${isTransit}_${width}_${height}_${pinColorOverride || ''}_${showNameLabel}`

  const cached = towerCustomerIconCache.get(cacheKey)
  if (cached) return cached

  const generated = makeCustomerSvgIcon(
    customerName,
    seq,
    isTransit,
    width,
    height,
    pinColorOverride,
    showNameLabel,
  )

  const result = {
    url: generated.url,
    scaledSize: new winGoogle.maps.Size(generated.scaledSize.width, generated.scaledSize.height),
    anchor: new winGoogle.maps.Point(generated.anchor.x, generated.anchor.y),
  }

  towerCustomerIconCache.set(cacheKey, result)
  return result
}

/**
 * Remove com segurança todas as polilinhas de um entregador do mapa.
 */
export function safelyClearCourierLines(lines?: CourierActiveLines | null): void {
  if (!lines) return
  safeSetMap(lines.main, null)
  safeSetMap(lines.inner, null)
  safeSetMap(lines.returnLeg, null)
  safeSetMap(lines.dev, null)
}

/**
 * Cria polilinha forward principal
 */
function createMainPolyline(winGoogle: any, map: any, path: Array<{ lat: number; lng: number }>) {
  return new winGoogle.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: '#2563EB',
    strokeOpacity: 0.95,
    strokeWeight: 5,
    map,
  })
}

/**
 * Cria polilinha forward interna (brilho)
 */
function createInnerPolyline(winGoogle: any, map: any, path: Array<{ lat: number; lng: number }>) {
  return new winGoogle.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: '#93C5FD',
    strokeOpacity: 0.85,
    strokeWeight: 2,
    map,
  })
}

/**
 * Cria polilinha tracejada de retorno à base
 */
function createReturnPolyline(winGoogle: any, map: any, path: Array<{ lat: number; lng: number }>) {
  return new winGoogle.maps.Polyline({
    path,
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
    map,
  })
}

/**
 * Cria polilinha tracejada vermelha de desvio de rota
 */
function createDevPolyline(winGoogle: any, map: any, path: Array<{ lat: number; lng: number }>) {
  return new winGoogle.maps.Polyline({
    path,
    geodesic: true,
    strokeColor: '#EF4444',
    strokeOpacity: 1.0,
    strokeWeight: 4,
    icons: [
      {
        icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 },
        offset: '0',
        repeat: '10px',
      },
    ],
    map,
  })
}

export interface SyncCourierRouteLinesParams {
  winGoogle: any
  map: any
  courierId: string
  linesMap: Map<string, CourierActiveLines>
  rawFPath: Array<{ lat: number; lng: number }>
  hasForward: boolean
  rawRetPath: Array<{ lat: number; lng: number }>
  hasReturn: boolean
  rawDevPath: Array<{ lat: number; lng: number }>
  hasDev: boolean
  bounds?: any
}

/**
 * Sincroniza as polilinhas de um entregador no mapa de forma 100% blindada.
 * Trata o caso crítico:
 * "Quando hasForward volta a ser true para um entregador que só tinha tracejado de retorno (main/inner null),
 * RECRIAR as polilinhas com new google.maps.Polyline(...) antes de manipular path/map — nunca usar null."
 */
export function syncCourierRouteLines({
  winGoogle,
  map,
  courierId,
  linesMap,
  rawFPath,
  hasForward,
  rawRetPath,
  hasReturn,
  rawDevPath,
  hasDev,
  bounds,
}: SyncCourierRouteLinesParams): void {
  if (!winGoogle?.maps || !map) return

  let lines = linesMap.get(courierId)

  if (lines) {
    // 1. FORWARD LINES (MAIN / INNER)
    if (hasForward) {
      // Se lines existia mas main ou inner eram null (ex.: entregador estava apenas retornando à base e ganhou nova entrega)
      if (!lines.main) {
        lines.main = createMainPolyline(winGoogle, map, rawFPath)
      } else {
        safeSetMap(lines.main, map)
        safeSetPath(lines.main, rawFPath)
      }

      if (!lines.inner) {
        lines.inner = createInnerPolyline(winGoogle, map, rawFPath)
      } else {
        safeSetMap(lines.inner, map)
        safeSetPath(lines.inner, rawFPath)
      }

      if (bounds) {
        rawFPath.forEach((p) => bounds.extend(p))
      }
    } else {
      safeSetMap(lines.main, null)
      safeSetMap(lines.inner, null)
    }

    // 2. RETURN LEG
    if (hasReturn) {
      if (!lines.returnLeg) {
        lines.returnLeg = createReturnPolyline(winGoogle, map, rawRetPath)
      } else {
        safeSetMap(lines.returnLeg, map)
        safeSetPath(lines.returnLeg, rawRetPath)
      }
      if (bounds) {
        rawRetPath.forEach((p) => bounds.extend(p))
      }
    } else if (lines.returnLeg) {
      safeSetMap(lines.returnLeg, null)
    }

    // 3. DEVIATION LINE
    if (hasDev) {
      if (!lines.dev) {
        lines.dev = createDevPolyline(winGoogle, map, rawDevPath)
      } else {
        safeSetMap(lines.dev, map)
        safeSetPath(lines.dev, rawDevPath)
      }
    } else if (lines.dev) {
      safeSetMap(lines.dev, null)
    }
  } else if (hasForward || hasReturn) {
    // Primeira vez que o entregador ganha linhas
    let mainPolyline: any = null
    let innerPolyline: any = null

    if (hasForward) {
      mainPolyline = createMainPolyline(winGoogle, map, rawFPath)
      innerPolyline = createInnerPolyline(winGoogle, map, rawFPath)
      if (bounds) {
        rawFPath.forEach((p) => bounds.extend(p))
      }
    }

    let returnPolyline: any = null
    if (hasReturn) {
      returnPolyline = createReturnPolyline(winGoogle, map, rawRetPath)
      if (bounds) {
        rawRetPath.forEach((p) => bounds.extend(p))
      }
    }

    let devPolyline: any = null
    if (hasDev) {
      devPolyline = createDevPolyline(winGoogle, map, rawDevPath)
    }

    linesMap.set(courierId, {
      main: mainPolyline,
      inner: innerPolyline,
      returnLeg: returnPolyline,
      dev: devPolyline,
    })
  }
}
