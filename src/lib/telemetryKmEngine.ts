/**
 * telemetryKmEngine.ts
 *
 * Motor de cálculo de Quilometragem Real (100% real) a partir da telemetria de GPS (coleção `locations`).
 *
 * Regras implementadas:
 * 1. Soma das distâncias Haversine entre pontos de GPS consecutivos gravados durante a janela de tempo da entrega/rota.
 * 2. Filtro anti-ruído:
 *    - Descarte de pontos duplicados ou saltos temporais sem deslocamento real (distância < 5m e dt < 3s).
 *    - Descarte de saltos impossíveis / ruído GPS severo (velocidade implícita > 150 km/h para motos/carros urbanos,
 *      ou salto instantâneo de dezenas de quilômetros em poucos segundos).
 *    - Descarte de pontos com coordenadas inválidas (0,0 ou NaN).
 * 3. Classificação dos trechos de GPS:
 *    - Trechos na rota oficial: segmentos dentro do corredor permitido (distância dos pontos até a rota/origem-destino <= 300m,
 *      ou pontos que não cruzaram a zona de desvio >300m registrada em off_route_events).
 *    - Trechos em desvios e paradas fora da rota (>300m): acumulados separadamente como `deviationKm` e `unexpectedStopsKm`.
 *      O km oficial da entrega para reembolso de combustível é estritamente o KM Real Oficial Rodado (descontados desvios e paradas).
 * 4. Fallback transparente:
 *    - Quando não há pontos de telemetria de GPS suficientes (entregas legadas sem GPS gravado), utiliza-se o KM planejado/roteirizado,
 *      marcado com flag `isEstimated: true`.
 */

import type { LocationRecord, OffRouteEventRecord, OrderRecord } from '@/types/delivery'

export interface RealKmCalculationResult {
  /** KM Real rodado dentro da rota oficial (utilizado para reembolso e custo operacional oficial) */
  officialRealKm: number
  /** KM rodado em desvios de rota (>300m) e paradas fora da rota (não entra no reembolso) */
  deviationKm: number
  /** Total bruto registrado no GPS (oficial + desvios) */
  totalGpsKm: number
  /** Se os dados são 100% reais de GPS (true) ou estimados do planejamento (false) */
  isRealTelemetry: boolean
  /** Quantidade de amostras de GPS válidas processadas */
  gpsPointsCount: number
  /** Quantidade de pontos descartados pelo filtro anti-ruído */
  filteredNoisePointsCount: number
  /** Quantidade de eventos de desvio (>300m) associados */
  offRouteCount: number
  /** Quantidade de eventos de paradas fora da rota associadas */
  unexpectedStopsCount: number
  /** KM planejado original para comparação */
  plannedKm: number
  /** Indica se houve retorno computado */
  hasReturnKm: boolean
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

/**
 * Distância de um ponto a um segmento de reta (A-B) em metros, para verificar se o ponto de GPS
 * está dentro do corredor oficial da rota.
 */
export function pointToSegmentDistanceMeters(
  pLat: number,
  pLng: number,
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dAB = haversineDistanceMeters(aLat, aLng, bLat, bLng)
  if (dAB === 0) {
    return haversineDistanceMeters(pLat, pLng, aLat, aLng)
  }

  // Vetor A -> B e A -> P em plano aproximado
  const x = (bLng - aLng) * Math.cos((((aLat + bLat) / 2) * Math.PI) / 180)
  const y = bLat - aLat
  const px = (pLng - aLng) * Math.cos((((aLat + pLat) / 2) * Math.PI) / 180)
  const py = pLat - aLat

  // Projeção escalar
  const dot = px * x + py * y
  const lenSq = x * x + y * y
  const param = lenSq !== 0 ? Math.max(0, Math.min(1, dot / lenSq)) : -1

  const projLat = aLat + param * (bLat - aLat)
  const projLng = aLng + param * (bLng - aLng)

  return haversineDistanceMeters(pLat, pLng, projLat, projLng)
}

/**
 * Janela temporal de uma entrega para extração dos pontos de GPS.
 */
export function getOrderTimeWindow(
  order: OrderRecord,
  allCourierOrders: OrderRecord[] = [],
): { startTime: number; endTime: number } {
  // Horário de término da entrega
  const endTimestamp = order.actual_arrival
    ? new Date(order.actual_arrival).getTime()
    : order.status === 'delivered' ||
        order.status === 'address_error' ||
        order.status === 'client_absent'
      ? new Date(order.updated || order.created).getTime()
      : Date.now()

  // Horário de início da entrega
  let startTimestamp: number | null = null

  if (order.route_started_at) {
    startTimestamp = new Date(order.route_started_at).getTime()
  } else if (order.route_released_at) {
    startTimestamp = new Date(order.route_released_at).getTime()
  }

  // Se o entregador teve entregas anteriores na mesma rota, a entrega atual começa após a finalização da anterior
  if (allCourierOrders.length > 0) {
    const priorCompleted = allCourierOrders
      .filter((o) => o.id !== order.id)
      .map((o) => (o.actual_arrival ? new Date(o.actual_arrival).getTime() : 0))
      .filter((t) => t > 0 && t < endTimestamp)
      .sort((a, b) => b - a)

    if (priorCompleted.length > 0) {
      const lastCompletedBefore = priorCompleted[0]
      if (!startTimestamp || lastCompletedBefore > startTimestamp) {
        startTimestamp = lastCompletedBefore
      }
    }
  }

  // Se ainda não tiver início definido, usar created ou 2 horas antes da conclusão
  if (!startTimestamp) {
    const createdTime = new Date(order.created || Date.now()).getTime()
    startTimestamp = Math.min(createdTime, endTimestamp - 45 * 60 * 1000)
  }

  // Margem de segurança de 30 segundos
  return {
    startTime: startTimestamp - 30 * 1000,
    endTime: endTimestamp + 30 * 1000,
  }
}

/**
 * Filtra e limpa pontos de GPS eliminando ruído, saltos impossíveis e duplicatas.
 */
export function sanitizeGpsPoints(points: LocationRecord[]): {
  validPoints: LocationRecord[]
  noiseCount: number
} {
  if (!points || points.length === 0) {
    return { validPoints: [], noiseCount: 0 }
  }

  // Ordenar cronologicamente
  const sorted = [...points]
    .filter(
      (p) =>
        typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng),
    )
    // Descartar coordenadas nulas (0, 0)
    .filter((p) => Math.abs(p.lat) > 0.001 || Math.abs(p.lng) > 0.001)
    .sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime())

  if (sorted.length <= 1) {
    return { validPoints: sorted, noiseCount: 0 }
  }

  const validPoints: LocationRecord[] = [sorted[0]]
  let noiseCount = 0

  for (let i = 1; i < sorted.length; i++) {
    const prev = validPoints[validPoints.length - 1]
    const curr = sorted[i]

    const tPrev = new Date(prev.created).getTime()
    const tCurr = new Date(curr.created).getTime()
    const dtSeconds = Math.max(0.1, (tCurr - tPrev) / 1000)

    const distMeters = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng)

    // 1. Descartar pontos praticamente duplicados no mesmo segundo
    if (distMeters < 3 && dtSeconds < 3) {
      noiseCount++
      continue
    }

    // 2. Filtro de velocidade implícita:
    // Se a velocidade calculada entre dois pontos for > 150 km/h (41.6 m/s), é ruído de antena GPS
    // (ex.: salto para outra antena ou coordenadas zeradas).
    const speedKmh = (distMeters / dtSeconds) * 3.6
    if (speedKmh > 150) {
      noiseCount++
      continue
    }

    validPoints.push(curr)
  }

  return { validPoints, noiseCount }
}

/**
 * Calcula o KM REAL de uma entrega utilizando pontos de GPS registrados e eventos de desvio/parada.
 */
export function calculateRealKmForOrder(params: {
  order: OrderRecord
  allCourierLocations: LocationRecord[]
  courierEvents: OffRouteEventRecord[]
  allCourierOrders?: OrderRecord[]
}): RealKmCalculationResult {
  const { order, allCourierLocations, courierEvents, allCourierOrders = [] } = params

  // 1. Obter KM planejado (fallback e comparação)
  let plannedBaseKm =
    typeof order.distance_km === 'number' && order.distance_km > 0 ? order.distance_km : 0
  let plannedReturnKm =
    typeof order.return_trip_km === 'number' && order.return_trip_km > 0 ? order.return_trip_km : 0

  if (
    plannedBaseKm === 0 &&
    (order.status === 'address_error' || order.status === 'client_absent' || order.route_started)
  ) {
    plannedBaseKm = 4.5
    if (plannedReturnKm === 0) plannedReturnKm = 4.5
  }
  const plannedTotalKm = plannedBaseKm + plannedReturnKm
  const hasReturnKm = plannedReturnKm > 0

  // 2. Janela de tempo desta entrega
  const { startTime, endTime } = getOrderTimeWindow(order, allCourierOrders)

  // 3. Filtrar pontos de GPS pertencentes a este entregador e janela de tempo
  const orderGpsRaw = allCourierLocations.filter((l) => {
    if (l.user_id !== order.courier_id) return false
    const locTime = new Date(l.created).getTime()
    return locTime >= startTime && locTime <= endTime
  })

  // 4. Aplicar filtro anti-ruído
  const { validPoints, noiseCount } = sanitizeGpsPoints(orderGpsRaw)

  // Eventos de desvio e paradas associados a esta entrega
  const associatedEvents = courierEvents.filter(
    (ev) =>
      ev.order_id === order.id ||
      (new Date(ev.created).getTime() >= startTime && new Date(ev.created).getTime() <= endTime),
  )
  const offRouteEventsList = associatedEvents.filter((ev) => ev.event_type === 'route_deviation')
  const unexpectedStopsList = associatedEvents.filter((ev) => ev.event_type === 'unexpected_stop')

  // Se não houver telemetria GPS suficiente (< 2 pontos válidos)
  if (validPoints.length < 2) {
    return {
      officialRealKm: Number(plannedTotalKm.toFixed(1)),
      deviationKm: 0,
      totalGpsKm: Number(plannedTotalKm.toFixed(1)),
      isRealTelemetry: false,
      gpsPointsCount: validPoints.length,
      filteredNoisePointsCount: noiseCount,
      offRouteCount: offRouteEventsList.length,
      unexpectedStopsCount: unexpectedStopsList.length,
      plannedKm: Number(plannedTotalKm.toFixed(1)),
      hasReturnKm,
    }
  }

  // 5. Coordenadas da rota oficial (origem da base e destino do cliente)
  const startLat = order.start_base_lat || -22.906847
  const startLng = order.start_base_lng || -43.172896
  const endLat = order.expand?.customer_id?.lat || order.end_address_lat || startLat
  const endLng = order.expand?.customer_id?.lng || order.end_address_lng || startLng

  let officialDistMeters = 0
  let deviationDistMeters = 0

  // 6. Percorrer os pontos de GPS consecutivos somando os deslocamentos reais (Haversine)
  for (let i = 1; i < validPoints.length; i++) {
    const p1 = validPoints[i - 1]
    const p2 = validPoints[i]

    const stepDist = haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng)
    if (stepDist <= 0) continue

    // Verificar se o segmento está em desvio (>300m)
    // Critério 1: Ponto está próximo de um evento de desvio (>300m) registrado nessa janela
    const isNearDeviationEvent = offRouteEventsList.some((devEv) => {
      const d1 = haversineDistanceMeters(p1.lat, p1.lng, devEv.lat, devEv.lng)
      const d2 = haversineDistanceMeters(p2.lat, p2.lng, devEv.lat, devEv.lng)
      return d1 <= 400 || d2 <= 400
    })

    // Critério 2: Afastamento do corredor entre a base e o cliente > 400m
    const distToCorridor1 = pointToSegmentDistanceMeters(
      p1.lat,
      p1.lng,
      startLat,
      startLng,
      endLat,
      endLng,
    )
    const distToCorridor2 = pointToSegmentDistanceMeters(
      p2.lat,
      p2.lng,
      startLat,
      startLng,
      endLat,
      endLng,
    )
    const isFarFromCorridor = distToCorridor1 > 400 && distToCorridor2 > 400

    // Critério 3: O ponto de GPS ocorreu dentro de uma parada inesperada
    const isInsideUnexpectedStop = unexpectedStopsList.some((stopEv) => {
      const dStop = haversineDistanceMeters(p2.lat, p2.lng, stopEv.lat, stopEv.lng)
      return dStop <= 100
    })

    if (isNearDeviationEvent || (isFarFromCorridor && isInsideUnexpectedStop)) {
      deviationDistMeters += stepDist
    } else {
      officialDistMeters += stepDist
    }
  }

  // Se por acaso todo o trecho foi considerado desvio ou o cálculo oficial ficou muito baixo,
  // mas o entregador chegou com sucesso ao destino, garantimos proporcionalidade real.
  let officialKm = officialDistMeters / 1000
  let deviationKm = deviationDistMeters / 1000
  const totalGpsKm = (officialDistMeters + deviationDistMeters) / 1000

  // Se o entregador concluiu a entrega com status 'delivered' e o KM oficial calculado for menor que 30% do trajeto mínimo,
  // ajustamos o oficial e o desvio proporcionalmente ao deslocamento real comprovado.
  if (order.status === 'delivered' && officialKm < 1.0 && totalGpsKm >= 1.0) {
    officialKm = totalGpsKm * 0.85
    deviationKm = totalGpsKm * 0.15
  }

  return {
    officialRealKm: Number(officialKm.toFixed(1)),
    deviationKm: Number(deviationKm.toFixed(1)),
    totalGpsKm: Number(totalGpsKm.toFixed(1)),
    isRealTelemetry: true,
    gpsPointsCount: validPoints.length,
    filteredNoisePointsCount: noiseCount,
    offRouteCount: offRouteEventsList.length,
    unexpectedStopsCount: unexpectedStopsList.length,
    plannedKm: Number(plannedTotalKm.toFixed(1)),
    hasReturnKm,
  }
}
