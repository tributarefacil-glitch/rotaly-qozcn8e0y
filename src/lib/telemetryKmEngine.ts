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

import {
  DEVIATION_THRESHOLD_METERS,
  UNEXPECTED_STOP_THRESHOLD_METERS,
  haversineDistanceMeters,
} from '@/lib/geo'

export { DEVIATION_THRESHOLD_METERS, UNEXPECTED_STOP_THRESHOLD_METERS, haversineDistanceMeters }

/**
 * Retorna a distância rodoviária estimada entre a base de saída e o destino do cliente da entrega.
 * Usa distância Haversine base->cliente x 1.3 (fator mínimo viário) ou a coordenada expandida, com piso de 0.8 km.
 */
export function getOrderRoadDistanceFromBase(
  order: OrderRecord,
  activeBaseCoords?: { lat: number; lng: number } | null,
): number {
  const fallbackLat = activeBaseCoords?.lat ?? -22.7001402
  const fallbackLng = activeBaseCoords?.lng ?? -43.2982834
  const baseLat = order.start_base_lat || fallbackLat
  const baseLng = order.start_base_lng || fallbackLng
  const custLat = order.expand?.customer_id?.lat || order.end_address_lat || 0
  const custLng = order.expand?.customer_id?.lng || order.end_address_lng || 0

  if (custLat !== 0 && custLng !== 0) {
    const directMeters = haversineDistanceMeters(baseLat, baseLng, custLat, custLng)
    const roadKm = directMeters / 1000
    return Math.max(roadKm, 0.8)
  }

  // Fallback para distance_km existente caso não haja coordenadas válidas
  const fallbackKm =
    typeof order.distance_km === 'number' && order.distance_km > 0 ? order.distance_km : 0.8
  return Math.max(fallbackKm, 0.8)
}

/**
 * Retorna o peso de atribuição de uma entrega em uma rota compartilhada:
 * per-delivery weight = max(roadDistFromBase, 0.8) + returnToBase
 */
export function calculateDeliveryRouteWeight(
  order: OrderRecord,
  activeBaseCoords?: { lat: number; lng: number } | null,
): number {
  // Se a ordem já tem distance_km registrado de forma consistente (ex.: corrigido na base)
  // ou se distance_km representa a distância direta/viária
  const fallbackLat = activeBaseCoords?.lat ?? -22.7001402
  const fallbackLng = activeBaseCoords?.lng ?? -43.2982834
  const baseLat = order.start_base_lat || fallbackLat
  const baseLng = order.start_base_lng || fallbackLng
  const custLat = order.expand?.customer_id?.lat || order.end_address_lat || 0
  const custLng = order.expand?.customer_id?.lng || order.end_address_lng || 0

  const hasCustomerCoords =
    typeof order.expand?.customer_id?.lat === 'number' &&
    typeof order.expand?.customer_id?.lng === 'number' &&
    order.expand.customer_id.lat !== 0 &&
    order.expand.customer_id.lng !== 0

  let roadDist = 0.8
  if (custLat !== 0 && custLng !== 0) {
    const directMeters = haversineDistanceMeters(baseLat, baseLng, custLat, custLng)
    const directKm = directMeters / 1000
    roadDist = Math.max(directKm, 0.8)
  }

  // Se o cliente tem coordenadas vigentes no expand, o viário calculado sobre o pin vigente tem soberania.
  // Math.max com order.distance_km fica apenas como fallback quando não há coordenadas vigentes no cliente.
  if (!hasCustomerCoords && typeof order.distance_km === 'number' && order.distance_km > 0) {
    roadDist = Math.max(roadDist, order.distance_km)
  }

  // O peso de rateio da entrega na rota é a sua perna viária (+ fração de retorno já rateada se houver)
  // NUNCA duplicar o retorno em cada parada (fim do x2)
  const returnKm =
    typeof order.return_trip_km === 'number' && order.return_trip_km > 0 ? order.return_trip_km : 0

  return Math.max(roadDist + returnKm, 0.8)
}

export interface RealKmCalculationResult {
  /** KM Real rodado dentro da rota oficial (utilizado para reembolso e custo operacional oficial) */
  officialRealKm: number
  /** KM rodado em desvios de rota (>300m) e paradas fora da rota (não entra no reembolso) */
  deviationKm: number
  /** Total bruto percorrido no trajeto (oficial + desvios) */
  totalGpsKm: number
  /** KM descartado pelo filtro de ruído (saltos impossíveis ou ruídos anômalos) */
  discardedNoiseKm: number
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
  /** Fator de correção de sinuosidade/amostragem aplicado (ex.: 1.25 para amostragem esparsa de 30s) */
  samplingCurvatureFactor?: number
  /** Detalhes textuais da auditoria matemática */
  auditNotes?: string
  /** Fonte de verdade utilizada no KM Oficial ('odometro' | 'historico_viario' | 'gps') */
  calculationSource?: 'odometro' | 'historico_viario' | 'gps'
  /** Odômetro calculado se houver */
  odometerKm?: number
  /** Metadados de entrega conjunta no mesmo endereço */
  isJointDelivery?: boolean
  isJointPrimary?: boolean
  isJointSecondary?: boolean
  jointGroupSize?: number
  jointPrimaryTrackingCode?: string
  jointPartnerTrackingCodes?: string[]
  /** Sinalização de parada com pin suspeito (excluída do viário e auditada) */
  isSuspectPin?: boolean
  suspectPinReason?: string
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
): { startTime: number; endTime: number; isRouteWindow?: boolean } {
  // Identificar pedidos que pertencem à mesma rota (mesmo route_started_at ou mesmo ciclo de rota)
  const isEligibleRouteOrder = (o: OrderRecord) =>
    o.courier_id === order.courier_id &&
    (o.route_started ||
      o.status === 'delivered' ||
      o.status === 'in_transit' ||
      o.status === 'address_error' ||
      o.status === 'client_absent')

  const sameBatchOrders = allCourierOrders.filter((o) => {
    if (!isEligibleRouteOrder(o)) return false
    if (order.route_started_at && o.route_started_at) {
      const t1 = new Date(order.route_started_at).getTime()
      const t2 = new Date(o.route_started_at).getTime()
      // Começaram dentro da mesma janela de 10 minutos = mesma rota despachada
      return Math.abs(t1 - t2) < 10 * 60 * 1000
    }
    return true
  })

  // Se faz parte de uma rota (mesmo que com 1 ou mais entregas):
  // Regra do Usuário: "O KM RODADO INICIA NA SAIDA DA BASE, CONTINUA CONTANDO EM TODAS ENTREGAS E FINALIZA NA BASE DE VOLTA"
  // O início é a saída da base (route_started_at da rota).
  let startTimestamp: number | null = null
  if (order.route_started_at) {
    startTimestamp = new Date(order.route_started_at).getTime()
  } else {
    // Buscar menor route_started_at dos pedidos do lote
    const startedTimes = sameBatchOrders
      .map((o) => (o.route_started_at ? new Date(o.route_started_at).getTime() : 0))
      .filter((t) => t > 0)
    if (startedTimes.length > 0) {
      startTimestamp = Math.min(...startedTimes)
    } else if (order.route_released_at) {
      startTimestamp = new Date(order.route_released_at).getTime()
    } else if (order.created) {
      // Janela de fallback baseada em order.created com tolerância de 15 minutos
      startTimestamp = new Date(order.created).getTime() - 15 * 60 * 1000
    }
  }

  // O término da rota: se foi finalizada na base (route_finished_at) ou pelo término da última entrega
  let endTimestamp: number | null = null
  const finishedAtTimes = sameBatchOrders
    .map((o) => (o.route_finished_at ? new Date(o.route_finished_at).getTime() : 0))
    .filter((t) => t > 0)

  if (order.route_finished_at) {
    endTimestamp = new Date(order.route_finished_at).getTime()
  } else if (finishedAtTimes.length > 0) {
    endTimestamp = Math.max(...finishedAtTimes)
  } else if (order.actual_arrival) {
    // Janela de fallback baseada em order.actual_arrival com tolerância de 15 minutos
    endTimestamp = new Date(order.actual_arrival).getTime() + 15 * 60 * 1000
  } else {
    // Se a rota ainda não tem route_finished_at explícito mas tem entregas concluídas
    const allCompleted =
      sameBatchOrders.length > 0 &&
      sameBatchOrders.every(
        (o) =>
          o.status === 'delivered' || o.status === 'address_error' || o.status === 'client_absent',
      )
    if (allCompleted) {
      const arrivals = sameBatchOrders
        .map((o) => {
          if (o.actual_arrival) return new Date(o.actual_arrival).getTime()
          return 0
        })
        .filter((t) => t > 0)
      const lastArrival = arrivals.length > 0 ? Math.max(...arrivals) : 0
      if (lastArrival > 0) {
        // Estimar retorno à base: ~30 a 45 minutos após a última entrega concluída
        endTimestamp = lastArrival + 45 * 60 * 1000
      } else {
        // Se não houver actual_arrival gravado, usar created do lote + 2 horas no máximo
        const createdT = new Date(order.created || Date.now()).getTime()
        endTimestamp = createdT + 2 * 60 * 60 * 1000
      }
    } else {
      // Se a rota está ativa/em trânsito no dia de hoje
      endTimestamp = Date.now()
    }
  }

  if (!startTimestamp) {
    const createdTime = new Date(order.created || Date.now()).getTime()
    startTimestamp = Math.min(
      createdTime - 15 * 60 * 1000,
      (endTimestamp || Date.now()) - 45 * 60 * 1000,
    )
  }

  if (!endTimestamp) {
    endTimestamp = Date.now()
  }

  // Trava de segurança viária: se o pedido já foi concluído (delivered / address_error / client_absent),
  // a janela NUNCA pode ultrapassar 3 horas a partir do início da rota ou da criação do pedido
  const isFinishedOrder =
    order.status === 'delivered' ||
    order.status === 'address_error' ||
    order.status === 'client_absent' ||
    order.route_finished === true

  if (isFinishedOrder && endTimestamp - startTimestamp > 3.5 * 60 * 60 * 1000) {
    // Se ultrapassou 3.5 horas, restringe a janela temporal ao trajeto viário real:
    // Se tem actual_arrival ou route_finished_at, usa até o fim do trajeto de retorno (+30 min)
    if (order.route_finished_at) {
      endTimestamp = new Date(order.route_finished_at).getTime()
    } else if (order.actual_arrival) {
      endTimestamp = new Date(order.actual_arrival).getTime() + 30 * 60 * 1000
    } else {
      endTimestamp = startTimestamp + 2 * 60 * 60 * 1000
    }
  }

  // Se há múltiplas entregas no mesmo lote e esta função está sendo chamada para rateio por entrega,
  // ou se é uma entrega individual, mantemos a janela consistente com margem de segurança de 30 segundos
  return {
    startTime: startTimestamp - 30 * 1000,
    endTime: endTimestamp + 30 * 1000,
    isRouteWindow: true,
  }
}

/**
 * Filtra e limpa pontos de GPS eliminando ruído, saltos impossíveis e duplicatas.
 */
export function sanitizeGpsPoints(points: LocationRecord[]): {
  validPoints: LocationRecord[]
  noiseCount: number
  discardedNoiseKm: number
} {
  if (!points || points.length === 0) {
    return { validPoints: [], noiseCount: 0, discardedNoiseKm: 0 }
  }

  let noiseCount = 0
  let discardedNoiseMeters = 0

  // 1. Filtrar coordenadas inválidas (0,0, NaN, accuracy > 100m, ou sem precisão aceitável)
  const initialValid = points.filter((p) => {
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number' || isNaN(p.lat) || isNaN(p.lng)) {
      noiseCount++
      return false
    }
    // Descartar coordenadas (0,0) ou quase nulas
    if (Math.abs(p.lat) < 0.001 && Math.abs(p.lng) < 0.001) {
      noiseCount++
      return false
    }
    // Descartar se precisão GPS informada for ruim (> 100m)
    if (typeof p.accuracy === 'number' && p.accuracy > 100) {
      noiseCount++
      return false
    }
    // Pontos com status offline ou falha de sinal reportando accuracy 0 ou indefinida
    // são coordenadas estimadas/imprecisas do fallback de erro do aparelho
    const isWeakOrOfflineSignal =
      p.gps_status === 'offline' ||
      p.gps_reason === 'weak_signal' ||
      p.gps_reason === 'gps_unavailable'
    if (
      isWeakOrOfflineSignal &&
      (p.accuracy === undefined || p.accuracy === null || p.accuracy <= 0)
    ) {
      noiseCount++
      return false
    }
    return true
  })

  // Ordenar cronologicamente
  const sorted = [...initialValid].sort(
    (a, b) => new Date(a.created).getTime() - new Date(b.created).getTime(),
  )

  if (sorted.length <= 1) {
    return { validPoints: sorted, noiseCount, discardedNoiseKm: 0 }
  }

  // Segmentação estrita entre pontos ao vivo (offline_buffered !== true) e pontos do buffer offline (offline_buffered === true).
  type Segment = { isOffline: boolean; points: LocationRecord[] }
  const segments: Segment[] = []
  let currentSegment: Segment | null = null

  for (const pt of sorted) {
    const isOffline = Boolean(pt.offline_buffered)
    if (!currentSegment || currentSegment.isOffline !== isOffline) {
      currentSegment = { isOffline, points: [pt] }
      segments.push(currentSegment)
    } else {
      currentSegment.points.push(pt)
    }
  }

  // Filtrar ruído DENTRO de cada segmento contíguo individualmente
  // REGRAS RIGOROSAS ANTI-JITTER & REJEIÇÃO DE SPIKES:
  // - Descartar sensor com velocidade < 1.2 km/h (veículo parado)
  // - Descartar deslocamento < 12m em intervalos < 45s (deriva de antena/jitter)
  // - Zerar deslocamento quando consecutivo dentro da precisão (accuracy)
  // - Rejeitar saltos acima de 90 km/h (moto/veículo) ou 30 km/h (bicicleta) registrando km descartado
  const cleanedPoints: LocationRecord[] = []

  for (const segment of segments) {
    const segPts = segment.points
    if (segPts.length === 0) continue

    const segValid: LocationRecord[] = [segPts[0]]

    for (let i = 1; i < segPts.length; i++) {
      const prev = segValid[segValid.length - 1]
      const curr = segPts[i]

      const tPrev = new Date(prev.created).getTime()
      const tCurr = new Date(curr.created).getTime()
      const dtSeconds = Math.max(0.1, (tCurr - tPrev) / 1000)

      const distMeters = haversineDistanceMeters(prev.lat, prev.lng, curr.lat, curr.lng)

      // Regra A: Sensor reporta velocidade explícita < 1.2 km/h (0.333 m/s) e deslocamento residual insignificante
      if (
        typeof curr.speed === 'number' &&
        curr.speed >= 0 &&
        curr.speed < 0.333 &&
        distMeters < 25
      ) {
        noiseCount++
        continue
      }

      // Regra B: Jitter estacionário — deslocamento < 12 m em menos de 45 segundos (veículo parado/semáforo/antena flutuando)
      if (distMeters < 12 && dtSeconds < 45) {
        noiseCount++
        continue
      }

      // Regra C: O ponto está dentro do raio de precisão (accuracy) de ambas as leituras
      const combinedAccuracy = Math.max(curr.accuracy || 10, prev.accuracy || 10)
      if (distMeters <= combinedAccuracy && dtSeconds < 60) {
        noiseCount++
        continue
      }

      // Se for segmento offline sincronizado em lote, os timestamps criados são quase idênticos (dt < 1s).
      if (segment.isOffline) {
        if (distMeters > 15000) {
          noiseCount++
          discardedNoiseMeters += distMeters
          continue
        }
      } else {
        const speedKmh = (distMeters / dtSeconds) * 3.6
        // Regra D: Limiar rigoroso de velocidade (90 km/h para motos/carros). Acima disso é spike/salto GPS.
        if (speedKmh > 90) {
          noiseCount++
          discardedNoiseMeters += distMeters
          continue
        }
      }

      segValid.push(curr)
    }

    // Verificação de teleporte inicial dentro do segmento
    if (segValid.length >= 3 && !segment.isOffline) {
      const p0 = segValid[0]
      const p1 = segValid[1]
      const p2 = segValid[2]
      const d01 = haversineDistanceMeters(p0.lat, p0.lng, p1.lat, p1.lng)
      const d12 = haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng)
      const t01 = Math.max(
        0.1,
        (new Date(p1.created).getTime() - new Date(p0.created).getTime()) / 1000,
      )
      const speed01 = (d01 / t01) * 3.6

      if (speed01 > 90 || (d01 > 15000 && d12 < 3000)) {
        segValid.shift()
        noiseCount++
        discardedNoiseMeters += d01
      }
    }

    cleanedPoints.push(...segValid)
  }

  return {
    validPoints: cleanedPoints,
    noiseCount,
    discardedNoiseKm: Number((discardedNoiseMeters / 1000).toFixed(2)),
  }
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

  // Verificação de Sanidade de Pin (isSuspectPin):
  // Se a parada estiver com coordenadas suspeitas/não calibradas, ela é excluída do viário e sinalizada
  const orderCustLatCheck = order.expand?.customer_id?.lat ?? order.end_address_lat ?? null
  const orderCustLngCheck = order.expand?.customer_id?.lng ?? order.end_address_lng ?? null
  const orderCustNotesCheck = order.notes || order.expand?.customer_id?.notes || ''
  const isOrderPinSuspect = isSuspectPin(orderCustLatCheck, orderCustLngCheck, orderCustNotesCheck)

  // 1. Obter KM planejado e viário do histórico de rotas (fallback e comparação)
  let plannedBaseKm =
    typeof order.distance_km === 'number' && order.distance_km > 0 ? order.distance_km : 0
  let plannedReturnKm =
    typeof order.return_trip_km === 'number' && order.return_trip_km > 0 ? order.return_trip_km : 0

  // Histórico viário gravado na rota do entregador (campo total_route_with_return_km do lote)
  let routeTotalRoadKm =
    typeof order.total_route_with_return_km === 'number' && order.total_route_with_return_km > 0
      ? order.total_route_with_return_km
      : 0

  // Verificar odômetro informado na ordem ou lote
  let odometerDifference: number | null = null
  if (typeof order.km_odometro === 'number' && order.km_odometro > 0) {
    odometerDifference = order.km_odometro
  } else if (
    typeof order.odometro_final === 'number' &&
    typeof order.odometro_inicial === 'number' &&
    order.odometro_final > order.odometro_inicial
  ) {
    odometerDifference = Number((order.odometro_final - order.odometro_inicial).toFixed(1))
  }

  // Se a entrega tem origem igual ao destino (ex.: malote TRK-2026-670 ou distância base->destino < 100m)
  const orderStartLat = order.start_base_lat || 0
  const orderStartLng = order.start_base_lng || 0
  const orderCustLat = order.expand?.customer_id?.lat || order.end_address_lat || 0
  const orderCustLng = order.expand?.customer_id?.lng || order.end_address_lng || 0
  const isDestAtBase =
    orderStartLat !== 0 &&
    orderCustLat !== 0 &&
    haversineDistanceMeters(orderStartLat, orderStartLng, orderCustLat, orderCustLng) < 100

  if (isDestAtBase) {
    plannedReturnKm = 0
  }

  // Se plannedBaseKm for 0 e não houver distância, NÃO inventar 4.5 km arbitrário
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
  const sanitized = sanitizeGpsPoints(orderGpsRaw)
  const { validPoints, noiseCount } = sanitized

  // Eventos de desvio e paradas associados a esta entrega
  const associatedEvents = courierEvents.filter(
    (ev) =>
      ev.order_id === order.id ||
      (new Date(ev.created).getTime() >= startTime && new Date(ev.created).getTime() <= endTime),
  )
  const offRouteEventsList = associatedEvents.filter((ev) => ev.event_type === 'route_deviation')
  const unexpectedStopsList = associatedEvents.filter((ev) => ev.event_type === 'unexpected_stop')

  const discardedNoiseKm = sanitized.discardedNoiseKm || 0

  const isCompletedOrAttempted =
    order.status === 'delivered' ||
    order.status === 'client_absent' ||
    order.status === 'address_error'

  // Se não houver telemetria GPS suficiente (< 2 pontos válidos)
  if (validPoints.length < 2) {
    // Regra oficial do Rotaly: trajeto viário planejado é a única fonte oficial.
    // Odômetro foi aposentado como fonte de cálculo.
    let officialKmFallback = 0
    let source: 'odometro' | 'historico_viario' | 'gps' = 'historico_viario'
    let hasData = false

    if (routeTotalRoadKm > 0) {
      officialKmFallback = routeTotalRoadKm
      source = 'historico_viario'
      hasData = true
    } else if (isCompletedOrAttempted && plannedTotalKm > 0) {
      officialKmFallback = Number(plannedTotalKm.toFixed(1))
      source = 'historico_viario'
      hasData = true
    }

    return {
      officialRealKm: officialKmFallback,
      deviationKm: 0,
      totalGpsKm: officialKmFallback,
      discardedNoiseKm,
      isRealTelemetry: false,
      gpsPointsCount: validPoints.length,
      filteredNoisePointsCount: noiseCount,
      offRouteCount: offRouteEventsList.length,
      unexpectedStopsCount: unexpectedStopsList.length,
      plannedKm: Number(plannedTotalKm.toFixed(1)),
      hasReturnKm,
      calculationSource: source,
      odometerKm: undefined,
      auditNotes: hasData
        ? 'Cálculo via Trajeto Viário Oficial das Paradas.'
        : 'Sem trajeto viário gravado.',
    }
  }

  // 5. Coordenadas da rota oficial (origem da base e destino do cliente)
  const startLat = order.start_base_lat || -22.906847
  const startLng = order.start_base_lng || -43.172896
  const endLat = order.expand?.customer_id?.lat || order.end_address_lat || startLat
  const endLng = order.expand?.customer_id?.lng || order.end_address_lng || startLng

  let rawOfficialMeters = 0
  let rawDeviationMeters = 0

  // 6. Percorrer os pontos de GPS consecutivos somando os deslocamentos reais (Haversine)
  // REGRA CRÍTICA: Tratar o flush do buffer offline como QUEBRA DE SEGMENTO.
  // Nunca somar distância entre um ponto offline_buffered=true e um ponto offline_buffered=false (nos dois sentidos).
  // Somar distância apenas DENTRO de cada segmento contíguo (live com live; offline com offline).
  for (let i = 1; i < validPoints.length; i++) {
    const p1 = validPoints[i - 1]
    const p2 = validPoints[i]

    // Quebra de segmento se houver transição live <-> buffer offline
    const isP1Offline = Boolean(p1.offline_buffered)
    const isP2Offline = Boolean(p2.offline_buffered)
    if (isP1Offline !== isP2Offline) {
      continue
    }

    const stepDist = haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng)
    if (stepDist <= 0) continue

    // REGRA 5 DO USUÁRIO: Desvios/paradas a mais de 600 m da rota oficial não contam km/combustível:
    // Usar limiar DEVIATION_THRESHOLD_METERS = 600, segregando esses trechos em km de desvio.
    // Critério 1: Ponto está próximo de um evento de desvio oficial (>600m) registrado nessa janela
    const isNearDeviationEvent = offRouteEventsList.some((devEv) => {
      const d1 = haversineDistanceMeters(p1.lat, p1.lng, devEv.lat, devEv.lng)
      const d2 = haversineDistanceMeters(p2.lat, p2.lng, devEv.lat, devEv.lng)
      return d1 <= DEVIATION_THRESHOLD_METERS || d2 <= DEVIATION_THRESHOLD_METERS
    })

    // Critério 2: Afastamento do corredor entre a base e o cliente > DEVIATION_THRESHOLD_METERS (600m)
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
    const isFarFromCorridor =
      distToCorridor1 > DEVIATION_THRESHOLD_METERS && distToCorridor2 > DEVIATION_THRESHOLD_METERS

    // Critério 3: O ponto de GPS ocorreu dentro de uma parada inesperada (>600m da rota ou evento de parada)
    const isInsideUnexpectedStop = unexpectedStopsList.some((stopEv) => {
      const dStop = haversineDistanceMeters(p2.lat, p2.lng, stopEv.lat, stopEv.lng)
      return dStop <= 100
    })

    if (isNearDeviationEvent || (isFarFromCorridor && isInsideUnexpectedStop)) {
      rawDeviationMeters += stepDist
    } else {
      rawOfficialMeters += stepDist
    }
  }

  const rawOfficialKm = rawOfficialMeters / 1000
  const rawDeviationKm = rawDeviationMeters / 1000
  const rawTotalGpsKm = (rawOfficialMeters + rawDeviationMeters) / 1000

  // 7. REGRA DURA DO USUÁRIO: PROIBIDO MULTIPLICADORES ARTIFICIAIS (*1.31, *1.25).
  // O deslocamento por telemetria GPS é 100% puro e medido a partir dos pontos reais saneados.
  // Nenhum fator artificial de inflação deve ser multiplicado.
  const curvatureFactor = 1.0
  const adjustedOfficialKm = rawOfficialKm
  const adjustedDeviationKm = rawDeviationKm

  // 8. REGRA DO KM OFICIAL (DECISÃO FECHADA DO PRODUTO):
  // KM OFICIAL = Trajeto viário planejado pelo otimizador, calculado SOMENTE sobre as paradas
  // efetivamente visitadas, no ciclo completo: base → paradas visitadas → retorno à base.
  // GPS e odômetro do entregador NÃO são fonte do km oficial — são apenas telemetria de auditoria.
  // NUNCA usar max(km_viario, km_gps): o GPS NUNCA aumenta o km oficial.

  let finalOfficialKm = 0
  let calculationSource: 'odometro' | 'historico_viario' | 'gps' = 'historico_viario'

  if (isOrderPinSuspect) {
    // Parada com pin suspeito é excluída do viário oficial
    finalOfficialKm = 0
    calculationSource = 'historico_viario'
  } else if (routeTotalRoadKm > 0) {
    finalOfficialKm = routeTotalRoadKm
    calculationSource = 'historico_viario'
  } else if (isCompletedOrAttempted && plannedTotalKm > 0) {
    finalOfficialKm = plannedTotalKm
    calculationSource = 'historico_viario'
  } else if (routeTotalRoadKm === 0 && !isCompletedOrAttempted) {
    finalOfficialKm = 0
    calculationSource = 'historico_viario'
  }

  const finalTotalGpsKm = adjustedOfficialKm + adjustedDeviationKm

  return {
    officialRealKm: Number(finalOfficialKm.toFixed(1)),
    deviationKm: Number(adjustedDeviationKm.toFixed(1)),
    totalGpsKm: Number(finalTotalGpsKm.toFixed(1)),
    discardedNoiseKm,
    isRealTelemetry: true,
    gpsPointsCount: validPoints.length,
    filteredNoisePointsCount: noiseCount,
    offRouteCount: offRouteEventsList.length,
    unexpectedStopsCount: unexpectedStopsList.length,
    plannedKm: Number(plannedTotalKm.toFixed(1)),
    hasReturnKm,
    samplingCurvatureFactor: curvatureFactor,
    calculationSource,
    odometerKm: odometerDifference || undefined,
    isSuspectPin: isOrderPinSuspect,
    suspectPinReason: isOrderPinSuspect ? 'Parada com Pin Suspeito' : undefined,
    auditNotes: isOrderPinSuspect
      ? `Parada com Pin Suspeito: excluída do viário oficial. Desvios auditados por GPS: ${adjustedDeviationKm.toFixed(1)} km.`
      : `Fonte: Trajeto Viário Oficial das Paradas. Desvios auditados por GPS: ${adjustedDeviationKm.toFixed(1)} km. Ruído filtrado: ${discardedNoiseKm.toFixed(2)} km.`,
  }
}
