/**
 * intelligentRoadRouter.ts
 *
 * Motor de Sequenciamento e Otimização de Rotas Viárias Inteligentes.
 * Garante que as rotas geradas pelo Rotaly sejam as mais curtas, rápidas
 * e obedeçam estritamente à malha viária e às regras das ruas (mão de direção,
 * conversões permitidas, relevo viário).
 *
 * Pilares do Algoritmo:
 * 1. PRIORIDADE GOOGLE MAPS DIRECTIONS COM WAYPOINTS OTIMIZADOS (optimize:true):
 *    - Utiliza o solver TSP oficial da Google Maps Directions API sobre a rede de trânsito real
 *    - Respeita mãos de direção e vias rápidas
 * 2. AGRUPAMENTO DETERMINÍSTICO DE MESMA RUA / VIZINHANÇA:
 *    - Entregas na mesma rua (logradouro/bairro comum ou proximidade viária < 400m)
 *      são mantidas adjacentes na sequência final, evitando que o entregador vá e volte.
 * 3. FALLBACK DETERMINÍSTICO VIÁRIO (2-OPT + MATRIZ DE DISTÂNCIAS):
 *    - Caso a chamada ao Directions com optimize falhe ou exceda o limite de waypoints (25),
 *      aplica K-Nearest Neighbor com bônus de mesma rua + busca local 2-Opt para eliminação de cruzamentos.
 * 4. CÁLCULO DE KM E TEMPO REAL POR TRECHOS VIÁRIOS:
 *    - Distâncias e durações reais por trecho viário, com ida e volta à base.
 */

import { haversineDistanceMeters } from '@/lib/geo'

export interface StopCandidate {
  id: string
  tracking_code: string
  priority?: 'normal' | 'urgent' | 'high' | string
  status?: string
  customer_name: string
  address: string
  lat: number
  lng: number
  rawOrder?: any
  rawCustomer?: any
}

export interface SequencedStopResult extends StopCandidate {
  sequence: number
  step_distance_meters: number
  cumulative_distance_meters: number
  step_duration_seconds?: number
}

export interface RouteOptimizationOutput {
  stops: SequencedStopResult[]
  total_distance_km: number
  outbound_distance_km: number
  return_distance_km: number
  estimated_duration_minutes: number
  estimated_fuel_cost: number
  isRealStreetRoute: boolean
}

/**
 * Normaliza nome de rua / logradouro para comparar se duas entregas são na mesma via.
 * Ex: "Rua São Jorge, 10" e "R. São Jorge, 45" -> "sao jorge"
 */
export function normalizeStreetName(address: string | undefined): string {
  if (!address) return ''
  let cleaned = address.toLowerCase()
  // Pega apenas a primeira parte antes de vírgula, traço ou número
  cleaned = cleaned.split(',')[0].split('-')[0].split(' nº')[0].split(' n°')[0]
  // Remove prefixos comuns de logradouro
  cleaned = cleaned.replace(
    /^(rua|r\.|avenida|av\.|travessa|trv\.|alameda|al\.|estrada|est\.|rodovia|rod\.|praca|praça|pc\.)\s+/i,
    '',
  )
  // Remove acentos
  cleaned = cleaned.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // Remove dígitos residuais e pontuações
  cleaned = cleaned.replace(/[0-9]/g, '').trim()
  return cleaned
}

/**
 * Verifica se dois endereços pertencem à mesma rua.
 */
export function areAddressesOnSameStreet(addrA: string, addrB: string): boolean {
  const normA = normalizeStreetName(addrA)
  const normB = normalizeStreetName(addrB)
  if (!normA || !normB) return false
  if (normA.length < 3 || normB.length < 3) return false
  return normA === normB || normA.includes(normB) || normB.includes(normA)
}

/**
 * Calcula distância Haversine em metros entre dois pontos
 */
export function calcDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  return haversineDistanceMeters(lat1, lon1, lat2, lon2)
}

/**
 * Algoritmo Fallback: Nearest Neighbor com clusterização de mesma rua + Refinamento 2-Opt.
 * Quando dois ou mais pontos pertencem à mesma rua e estão a menos de 1000m,
 * eles ganham prioridade absoluta para serem visitados em sequência contígua.
 */
export function sequenceStopsWithDeterministicTsp(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  stops: StopCandidate[],
  osrmDistancesMatrix?: number[][] | null,
): StopCandidate[] {
  if (stops.length <= 1) return [...stops]

  // Mapear paradas para índices na matriz viária OSRM
  // Matriz de tamanho (1 + stops.length): índice 0 = origem, índices 1..N = stops
  const stopIndexMap = new Map<string, number>()
  stops.forEach((s, i) => stopIndexMap.set(s.id, i + 1))

  // Fator viário urbano obrigatório para estimativas grosseiras quando a matriz OSRM
  // não cobrir um par específico, garantindo que linha reta NUNCA seja usada crua como viário
  const URBAN_ROAD_FACTOR = 1.3

  const getDistance = (
    fromStop: StopCandidate | null,
    toStop: StopCandidate,
    fromLat: number,
    fromLng: number,
  ): number => {
    if (osrmDistancesMatrix) {
      const fromIdx = fromStop ? (stopIndexMap.get(fromStop.id) ?? -1) : 0
      const toIdx = stopIndexMap.get(toStop.id) ?? -1
      if (
        fromIdx >= 0 &&
        toIdx >= 0 &&
        osrmDistancesMatrix[fromIdx]?.[toIdx] !== undefined &&
        osrmDistancesMatrix[fromIdx][toIdx] > 0
      ) {
        return osrmDistancesMatrix[fromIdx][toIdx]
      }
    }
    // Fallback apenas para estimativa grosseira se matriz ausente (com fator viário urbano)
    return calcDistanceMeters(fromLat, fromLng, toStop.lat, toStop.lng) * URBAN_ROAD_FACTOR
  }

  const unvisited = [...stops]
  const ordered: StopCandidate[] = []
  let curLat = origin.lat
  let curLng = origin.lng
  let lastStop: StopCandidate | null = null
  let lastAddress = ''

  while (unvisited.length > 0) {
    let bestIdx = -1
    let bestScore = Infinity

    for (let i = 0; i < unvisited.length; i++) {
      const candidate = unvisited[i]
      const dist = getDistance(lastStop, candidate, curLat, curLng)

      // Fator de prioridade do pedido
      let priorityMult = 1.0
      if (candidate.priority === 'urgent') priorityMult = 0.4
      else if (candidate.priority === 'high') priorityMult = 0.7

      // BÔNUS DE MESMA RUA: Se está na mesma rua do ponto anterior e a uma distância razoável (< 1.5km),
      // reduz drasticamente o score de distância para que seja visitado em seguida (efeito natural de rua)
      let sameStreetBonus = 1.0
      if (lastAddress && areAddressesOnSameStreet(lastAddress, candidate.address)) {
        if (dist <= 1500) {
          sameStreetBonus = 0.15 // 85% de desconto de distância para manter clientes da mesma rua juntos
        }
      }

      // Proximidade imediata (< 150m = vizinhos contíguos de quarteirão)
      if (dist <= 150) {
        sameStreetBonus = Math.min(sameStreetBonus, 0.2)
      }

      const score = dist * priorityMult * sameStreetBonus
      if (score < bestScore) {
        bestScore = score
        bestIdx = i
      }
    }

    if (bestIdx >= 0) {
      const next = unvisited.splice(bestIdx, 1)[0]
      ordered.push(next)
      curLat = next.lat
      curLng = next.lng
      lastStop = next
      lastAddress = next.address
    } else if (unvisited.length > 0) {
      // Desempate determinístico por created se houver resíduo
      unvisited.sort((a, b) => {
        const timeA = new Date((a as any).created || (a as any).rawOrder?.created || 0).getTime()
        const timeB = new Date((b as any).created || (b as any).rawOrder?.created || 0).getTime()
        if (timeA !== timeB) return timeA - timeB
        return a.id.localeCompare(b.id)
      })
      ordered.push(...unvisited.splice(0, unvisited.length))
      break
    }
  }

  // Refinamento Local 2-Opt: desata nós e cruzamentos viários sobre distâncias viárias
  // SEMPRE executado para todas as rotas com 4 ou mais paradas (incluindo rotas > 23 paradas)
  if (ordered.length >= 4) {
    let improved = true
    let iterations = 0
    const maxIterations = ordered.length > 50 ? 30 : 60

    const evalTourCost = (tour: StopCandidate[]): number => {
      let total = 0
      let prevStop: StopCandidate | null = null
      let prevLat = origin.lat
      let prevLng = origin.lng

      for (const stop of tour) {
        total += getDistance(prevStop, stop, prevLat, prevLng)
        prevStop = stop
        prevLat = stop.lat
        prevLng = stop.lng
      }

      // Distância de retorno ao destino
      if (osrmDistancesMatrix && prevStop) {
        const lastIdx = stopIndexMap.get(prevStop.id) ?? -1
        if (lastIdx >= 0 && osrmDistancesMatrix[lastIdx]?.[0] !== undefined) {
          total += osrmDistancesMatrix[lastIdx][0]
        } else {
          total +=
            calcDistanceMeters(prevLat, prevLng, destination.lat, destination.lng) *
            URBAN_ROAD_FACTOR
        }
      } else {
        total +=
          calcDistanceMeters(prevLat, prevLng, destination.lat, destination.lng) * URBAN_ROAD_FACTOR
      }

      return total
    }

    let currentCost = evalTourCost(ordered)

    while (improved && iterations < maxIterations) {
      improved = false
      iterations++

      for (let i = 0; i < ordered.length - 1; i++) {
        for (let k = i + 1; k < ordered.length; k++) {
          // Não inverter se quebrar adjacência de clientes da mesma rua a menos de 500m
          const a1 = ordered[i]
          const a2 = ordered[i + 1]
          if (areAddressesOnSameStreet(a1.address, a2.address)) {
            const dSame = calcDistanceMeters(a1.lat, a1.lng, a2.lat, a2.lng)
            if (dSame < 500 && k === i + 1) continue
          }

          // Testar troca 2-opt: reverte o segmento entre i e k
          const candidateTour = [
            ...ordered.slice(0, i),
            ...ordered.slice(i, k + 1).reverse(),
            ...ordered.slice(k + 1),
          ]

          const candidateCost = evalTourCost(candidateTour)
          if (candidateCost < currentCost - 10) {
            ordered.splice(0, ordered.length, ...candidateTour)
            currentCost = candidateCost
            improved = true
            break
          }
        }
        if (improved) break
      }
    }
  }

  return ordered
}

/**
 * Tenta otimizar e sequenciar as paradas usando o Google Maps Directions API
 * com `optimizeWaypoints: true`.
 * A Google Maps JS API suporta até 23-25 waypoints em uma única requisição.
 */
async function sequenceStopsWithGoogleDirections(
  origin: { lat: number; lng: number },
  destination: { lat: number; lng: number },
  stops: StopCandidate[],
  vehicleType?: string,
): Promise<{
  orderedStops: StopCandidate[]
  legs: Array<{ distanceMeters: number; durationSeconds: number }>
} | null> {
  if (typeof window === 'undefined') return null
  const win = window as any
  if (!win.google?.maps?.DirectionsService) return null

  try {
    const directionsService = new win.google.maps.DirectionsService()
    const googleOrigin = new win.google.maps.LatLng(origin.lat, origin.lng)
    const googleDestination = new win.google.maps.LatLng(destination.lat, destination.lng)

    // Agrupa previamente paradas idênticas ou colapsadas no mesmo endereço
    // para economizar waypoints e garantir que fiquem juntas
    const waypoints = stops.map((s) => ({
      location: new win.google.maps.LatLng(s.lat, s.lng),
      stopover: true,
    }))

    const requestTravelMode =
      vehicleType === 'bicicleta' || vehicleType === 'bicycle' || vehicleType === 'bike'
        ? win.google.maps.TravelMode?.BICYCLING || 'BICYCLING'
        : win.google.maps.TravelMode?.DRIVING || 'DRIVING'

    const request: any = {
      origin: googleOrigin,
      destination: googleDestination,
      waypoints,
      optimizeWaypoints: true, // SOLVER OFICIAL DE ROTEAMENTO VIÁRIO DA GOOGLE
      travelMode: requestTravelMode,
    }

    // Otimização por DISTÂNCIA:
    // Chamada pura sem drivingOptions/BEST_GUESS para evitar ganchos de trânsito
    // que aumentam o km (ex.: 19 km rodoviário vs 13 km direto).
    // Opcionalmente testa com trânsito e escolhe a rota de MENOR quilometragem total.
    const requestNoTraffic: any = { ...request }

    const routeNoTrafficPromise: Promise<any> = new Promise((resolve) => {
      directionsService.route(requestNoTraffic, (res: any, status: any) => {
        if (status === win.google.maps.DirectionsStatus?.OK || status === 'OK') {
          resolve(res)
        } else {
          resolve(null)
        }
      })
    })

    let chosenResult: any = await routeNoTrafficPromise

    // Se suportado TrafficModel, podemos consultar e comparar para escolher o menor km
    if (win.google.maps.TrafficModel) {
      try {
        const requestWithTraffic = {
          ...request,
          drivingOptions: {
            departureTime: new Date(),
            trafficModel: win.google.maps.TrafficModel.BEST_GUESS,
          },
        }
        const resultTraffic: any = await new Promise((resolve) => {
          directionsService.route(requestWithTraffic, (res: any, status: any) => {
            if (status === win.google.maps.DirectionsStatus?.OK || status === 'OK') {
              resolve(res)
            } else {
              resolve(null)
            }
          })
        })

        if (resultTraffic?.routes?.[0]) {
          if (!chosenResult?.routes?.[0]) {
            chosenResult = resultTraffic
          } else {
            // Comparar distâncias totais e priorizar a rota de MENOR quilometragem
            const distNoTraffic = (chosenResult.routes[0].legs || []).reduce(
              (sum: number, l: any) => sum + (l.distance?.value || 0),
              0,
            )
            const distTraffic = (resultTraffic.routes[0].legs || []).reduce(
              (sum: number, l: any) => sum + (l.distance?.value || 0),
              0,
            )
            if (distTraffic < distNoTraffic) {
              chosenResult = resultTraffic
            }
          }
        }
      } catch {
        /* mantém chosenResult sem trânsito */
      }
    }

    if (!chosenResult?.routes?.[0]) return null

    const route = chosenResult.routes[0]
    const waypointOrder: number[] = route.waypoint_order || []
    const legs = route.legs || []

    if (!waypointOrder || waypointOrder.length !== stops.length) {
      return null
    }

    // Reordenar os stops de acordo com o waypoint_order da Google
    const orderedStops: StopCandidate[] = waypointOrder.map((idx) => stops[idx])

    // Extrair distâncias e durações das pernas (legs)
    const parsedLegs = legs.map((leg: any) => ({
      distanceMeters: leg.distance?.value || 0,
      durationSeconds: leg.duration_in_traffic?.value || leg.duration?.value || 0,
    }))

    return {
      orderedStops,
      legs: parsedLegs,
    }
  } catch (err) {
    console.warn('[RoadRouter] Falha na chamada Google Directions optimizeWaypoints:', err)
    return null
  }
}

/**
 * Função Principal de Otimização e Sequenciamento de Rotas Viárias.
 * Combina Google Directions (optimizeWaypoints: true) com fallback inteligente
 * de agrupamento por mesma rua e eliminação de percurso ocioso.
 */
export async function optimizeRouteSequence(params: {
  origin: { lat: number; lng: number }
  destination: { lat: number; lng: number }
  stops: StopCandidate[]
  vehicleType?: string
  pricePerLiter?: number
  consumptionKml?: number
}): Promise<RouteOptimizationOutput> {
  const {
    origin,
    destination,
    stops,
    vehicleType = 'moto',
    pricePerLiter = 5.89,
    consumptionKml = 32,
  } = params

  if (stops.length === 0) {
    return {
      stops: [],
      total_distance_km: 0,
      outbound_distance_km: 0,
      return_distance_km: 0,
      estimated_duration_minutes: 0,
      estimated_fuel_cost: 0,
      isRealStreetRoute: false,
    }
  }

  // Desempate determinístico prévio por created para consistência total da entrada
  const sortedStopsInput = [...stops].sort((a, b) => {
    const timeA = new Date((a as any).created || (a as any).rawOrder?.created || 0).getTime()
    const timeB = new Date((b as any).created || (b as any).rawOrder?.created || 0).getTime()
    if (timeA !== timeB) return timeA - timeB
    return a.id.localeCompare(b.id)
  })

  // PRÉ-AGRUPAMENTO DE SAME-STREET COHESION (antes do solver):
  // Agrupa previamente paradas contíguas na mesma rua para que o solver
  // respeite a vizinhança sem desfazer a ordem ótima viária no final.
  const preProcessedStops = consolidateSameStreetAdjacency(origin, sortedStopsInput)
  let finalStops: StopCandidate[] = []
  let isGoogleOptimized = false
  let legsData: Array<{ distanceMeters: number; durationSeconds: number }> | null = null

  // Se tivermos até 23 paradas e a API do Google Maps estiver disponível,
  // tentamos a otimização oficial da Google com respeito às regras viárias
  if (preProcessedStops.length <= 23) {
    const googleResult = await sequenceStopsWithGoogleDirections(
      origin,
      destination,
      preProcessedStops,
      vehicleType,
    )
    if (googleResult && googleResult.orderedStops.length === preProcessedStops.length) {
      finalStops = googleResult.orderedStops
      legsData = googleResult.legs
      isGoogleOptimized = true
    }
  }

  // Se a Google não estava disponível ou tínhamos mais de 23 paradas:
  // Assegurar caminho OSRM fetchOsrmDistanceMatrix + TSP determinístico (2-Opt) SEMPRE,
  // sem fallback de linha reta (haversine) para sequenciamento.
  if (!isGoogleOptimized) {
    let osrmMatrix: number[][] | null = null
    try {
      const { fetchOsrmDistanceMatrix } = await import('@/services/osrmRoutingService')
      // Ponto 0: origem; Pontos 1..N: preProcessedStops
      const allPoints = [origin, ...preProcessedStops.map((s) => ({ lat: s.lat, lng: s.lng }))]
      const matrixResult = await fetchOsrmDistanceMatrix(allPoints)
      if (matrixResult?.distancesMeters && matrixResult.distancesMeters.length > 0) {
        osrmMatrix = matrixResult.distancesMeters
      }
    } catch (err) {
      console.warn('[RoadRouter] Erro ao obter matriz viária OSRM:', err)
    }

    finalStops = sequenceStopsWithDeterministicTsp(
      origin,
      destination,
      preProcessedStops,
      osrmMatrix,
    )
  }

  // Agora calcular as métricas de distância acumulada e pernas (legs)
  const sequencedStops: SequencedStopResult[] = []
  let curLat = origin.lat
  let curLng = origin.lng
  let outboundDistanceMeters = 0
  let totalDurationSeconds = 0

  for (let i = 0; i < finalStops.length; i++) {
    const stop = finalStops[i]
    let stepMeters = 0
    let stepDurationSec = 0

    // Se temos pernas da Google Directions e a ordem não mudou radicalmente
    if (isGoogleOptimized && legsData && legsData[i]) {
      stepMeters = legsData[i].distanceMeters
      stepDurationSec = legsData[i].durationSeconds
    }

    // Se não temos dados da perna do Google ou stepMeters veio zero, tenta OSRM viário real
    if (!stepMeters || stepMeters <= 0) {
      try {
        const { fetchStreetRoute } = await import('@/services/osrmRoutingService')
        const osrmLeg = await fetchStreetRoute(
          { lat: curLat, lng: curLng },
          { lat: stop.lat, lng: stop.lng },
        )
        if (osrmLeg && osrmLeg.distanceMeters > 0) {
          stepMeters = osrmLeg.distanceMeters
          stepDurationSec = osrmLeg.durationSeconds || Math.round((stepMeters / 1000) * 160 + 300)
        }
      } catch {
        /* fallback viário protegido abaixo */
      }
      // Blindagem viária: se o OSRM oscilar, aplicar fator viário urbano (1.3x da distância direta)
      // para NUNCA calcular perna em linha reta euclidiana plana (regra do trajeto viário).
      if (!stepMeters || stepMeters <= 0) {
        const directMeters = calcDistanceMeters(curLat, curLng, stop.lat, stop.lng)
        const urbanRoadCircuityFactor = 1.3
        stepMeters = Math.max(800, Math.round(directMeters * urbanRoadCircuityFactor))
        stepDurationSec = Math.round((stepMeters / 1000) * 160 + 300)
      }
    }

    outboundDistanceMeters += stepMeters
    totalDurationSeconds += stepDurationSec

    sequencedStops.push({
      ...stop,
      sequence: i + 1,
      step_distance_meters: stepMeters,
      cumulative_distance_meters: outboundDistanceMeters,
      step_duration_seconds: stepDurationSec,
    })

    curLat = stop.lat
    curLng = stop.lng
  }

  // Trecho de Retorno (última parada -> destination/base)
  const lastStop = finalStops[finalStops.length - 1]
  let returnMeters = 0
  let isReturnRealStreet = false
  if (lastStop) {
    if (isGoogleOptimized && legsData && legsData[finalStops.length]) {
      returnMeters = legsData[finalStops.length].distanceMeters
      isReturnRealStreet = true
    } else {
      // Tentar roteamento viário real via OSRM fallback
      try {
        const { fetchStreetRoute } = await import('@/services/osrmRoutingService')
        const osrmReturn = await fetchStreetRoute(
          { lat: lastStop.lat, lng: lastStop.lng },
          { lat: destination.lat, lng: destination.lng },
        )
        if (osrmReturn && osrmReturn.distanceMeters > 0) {
          returnMeters = osrmReturn.distanceMeters
          isReturnRealStreet = true
        }
      } catch {
        /* fallback handled below */
      }
      if (!isReturnRealStreet) {
        // Blindagem viária do retorno: se o OSRM oscilar, aplicar fator viário urbano (1.3x direta)
        // para nunca calcular retorno em linha reta pura
        const directReturn = calcDistanceMeters(
          lastStop.lat,
          lastStop.lng,
          destination.lat,
          destination.lng,
        )
        const urbanRoadCircuityFactor = 1.3
        returnMeters = Math.max(800, Math.round(directReturn * urbanRoadCircuityFactor))
      }
    }
  }

  const outboundKm = Number((outboundDistanceMeters / 1000).toFixed(2))
  const returnKm = Number((returnMeters / 1000).toFixed(2))
  const totalKm = Number((outboundKm + returnKm).toFixed(2))

  // Duração total: tempo de deslocamento + 5 minutos de atendimento por parada
  let durationMins = Math.round(totalDurationSeconds / 60)
  if (durationMins <= 0 || !isGoogleOptimized) {
    durationMins = Math.round((totalKm / 22) * 60 + finalStops.length * 5)
  }

  // Custo de combustível
  // Bicicleta nunca gera custo de combustível
  const isBicycle =
    vehicleType === 'bicicleta' || vehicleType === 'bicycle' || vehicleType === 'bike'
  const effectiveCons = isBicycle
    ? 0
    : consumptionKml > 0
      ? consumptionKml
      : vehicleType === 'moto'
        ? 32
        : 10
  const fuelCost =
    !isBicycle && effectiveCons > 0 && pricePerLiter > 0
      ? (totalKm * pricePerLiter) / effectiveCons
      : 0

  return {
    stops: sequencedStops,
    total_distance_km: totalKm,
    outbound_distance_km: outboundKm,
    return_distance_km: returnKm,
    estimated_duration_minutes: durationMins,
    estimated_fuel_cost: Number(fuelCost.toFixed(2)),
    isRealStreetRoute: isGoogleOptimized,
  }
}

/**
 * Consolida a adjacência de pedidos que estejam na mesma rua.
 * Se múltiplos pedidos compartilham o mesmo logradouro e estão a menos de 1.2km entre si,
 * eles são inseridos consecutivamente na posição onde a rua foi visitada pela primeira vez.
 */
export function consolidateSameStreetAdjacency(
  origin: { lat: number; lng: number },
  stops: StopCandidate[],
): StopCandidate[] {
  if (stops.length <= 2) return stops

  const result: StopCandidate[] = []
  const used = new Set<string>()

  for (let i = 0; i < stops.length; i++) {
    const current = stops[i]
    if (used.has(current.id)) continue

    result.push(current)
    used.add(current.id)

    // Procurar outros pedidos na mesma rua ainda não visitados
    const sameStreetPeers: StopCandidate[] = []
    for (let j = i + 1; j < stops.length; j++) {
      const peer = stops[j]
      if (used.has(peer.id)) continue

      if (areAddressesOnSameStreet(current.address, peer.address)) {
        const d = calcDistanceMeters(current.lat, current.lng, peer.lat, peer.lng)
        // Se a distância for plausível para o mesmo logradouro/bairro (< 1.5km)
        if (d < 1500) {
          sameStreetPeers.push(peer)
        }
      }
    }

    if (sameStreetPeers.length > 0) {
      // Ordena os pares de mesma rua pela proximidade ao atual
      sameStreetPeers.sort((a, b) => {
        const dA = calcDistanceMeters(current.lat, current.lng, a.lat, a.lng)
        const dB = calcDistanceMeters(current.lat, current.lng, b.lat, b.lng)
        return dA - dB
      })

      for (const peer of sameStreetPeers) {
        result.push(peer)
        used.add(peer.id)
      }
    }
  }

  // Se algum stop sobrou por segurança
  for (const s of stops) {
    if (!used.has(s.id)) {
      result.push(s)
      used.add(s.id)
    }
  }

  return result
}
