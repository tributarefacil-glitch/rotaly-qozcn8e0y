import { LocationRecord } from '@/types/delivery'
import { parseSafeTimestamp } from '@/lib/operationalWindow'
import { haversineDistanceMeters } from '@/lib/geo'

export type GpsSignalState =
  | 'active' // Sinais recentes chegando nos últimos 3 minutos
  | 'delayed' // Último sinal entre 3 e 10 minutos (atrasado / navegador em segundo plano)
  | 'no_signal' // Sem sinal há > 10 minutos
  | 'disabled' // GPS explicitamente desligado / permissão negada

export interface CourierRealtimeDiagnostic {
  // GPS
  gpsState: GpsSignalState
  gpsBadgeLabel: string
  gpsBadgeColor: {
    bg: string
    text: string
    border: string
    dot: string
  }
  minutesSinceLastPing: number
  lastSignalFormatted: string
  lastSignalTimestamp: number | null
  rawGpsStatus?: string
  rawGpsReason?: string
  isOfflineBuffered: boolean

  // Parado vs Movimento
  isStopped: boolean
  stoppedSinceFormatted: string | null
  stoppedMinutes: number
  speedKmh: number
  movementBadgeLabel: string
  movementBadgeVariant: 'moving' | 'stopped' | 'no_signal' | 'idle'

  // Localização
  lat: number | null
  lng: number | null
  accuracyMeters: number | null
}

/**
 * Deriva de forma honesta o diagnóstico em tempo real do entregador:
 * - GPS Ativo vs Atrasado vs Sem Sinal vs Desligado
 * - Parado há X min (consecutivos) vs Em Movimento (velocidade km/h)
 * - Tolerância de precisão GPS (~30 metros) para evitar falsos alarmes de movimento quando parado
 */
export function diagnoseCourierTelemetry(
  courierId: string,
  courierLocations: LocationRecord[],
  currentLat?: number,
  currentLng?: number,
  currentSpeed?: number,
  currentGpsStatus?: string,
  currentGpsReason?: string,
  currentTimestamp?: string | number | Date,
  accuracy?: number,
  offlineBuffered?: boolean,
): CourierRealtimeDiagnostic {
  // Filtrar e ordenar histórico do entregador do mais recente para o mais antigo
  const sortedLocs = (courierLocations || [])
    .filter(
      (l) => l.user_id === courierId && typeof l.lat === 'number' && typeof l.lng === 'number',
    )
    .sort((a, b) => {
      const timeB = parseSafeTimestamp(b.updated || b.created)
      const timeA = parseSafeTimestamp(a.updated || a.created)
      return timeB - timeA
    })

  const latestLoc = sortedLocs[0]
  const finalLat =
    typeof currentLat === 'number' && !isNaN(currentLat) ? currentLat : (latestLoc?.lat ?? null)
  const finalLng =
    typeof currentLng === 'number' && !isNaN(currentLng) ? currentLng : (latestLoc?.lng ?? null)

  const rawTimestamp = currentTimestamp || latestLoc?.updated || latestLoc?.created
  const lastSignalTimestamp = rawTimestamp ? parseSafeTimestamp(rawTimestamp) : null
  const now = Date.now()

  const minutesSinceLastPing =
    lastSignalTimestamp && lastSignalTimestamp > 0
      ? Math.max(0, Math.floor((now - lastSignalTimestamp) / 60000))
      : 999

  const finalGpsStatus = currentGpsStatus || latestLoc?.gps_status
  const finalGpsReason = currentGpsReason || (latestLoc as any)?.gps_reason
  const isOfflineBuffered = Boolean(offlineBuffered ?? latestLoc?.offline_buffered)
  const accuracyMeters = typeof accuracy === 'number' ? accuracy : (latestLoc?.accuracy ?? null)

  // 1. GPS STATUS
  let gpsState: GpsSignalState = 'active'
  let gpsBadgeLabel = 'GPS Ativo'
  let gpsBadgeColor = {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-400',
    border: 'border-emerald-500/40',
    dot: 'bg-emerald-400',
  }

  if (finalGpsStatus === 'disabled') {
    gpsState = 'disabled'
    gpsBadgeLabel =
      finalGpsReason === 'permission_denied'
        ? 'GPS sem permissão no celular'
        : 'GPS desligado no celular'
    gpsBadgeColor = {
      bg: 'bg-rose-500/15',
      text: 'text-rose-400',
      border: 'border-rose-500/40',
      dot: 'bg-rose-500',
    }
  } else if (finalGpsStatus === 'offline' || minutesSinceLastPing > 10) {
    gpsState = 'no_signal'
    const minText = minutesSinceLastPing < 999 ? `${minutesSinceLastPing} min` : '>10 min'
    gpsBadgeLabel = `GPS sem sinal há ${minText}`
    gpsBadgeColor = {
      bg: 'bg-rose-500/20',
      text: 'text-rose-300',
      border: 'border-rose-500/50',
      dot: 'bg-rose-500 animate-pulse',
    }
  } else if (minutesSinceLastPing > 3) {
    gpsState = 'delayed'
    gpsBadgeLabel = `Último sinal há ${minutesSinceLastPing} min`
    gpsBadgeColor = {
      bg: 'bg-amber-500/15',
      text: 'text-amber-300',
      border: 'border-amber-500/40',
      dot: 'bg-amber-400',
    }
  } else {
    gpsState = 'active'
    gpsBadgeLabel = 'GPS ativo e conectado'
    gpsBadgeColor = {
      bg: 'bg-emerald-500/15',
      text: 'text-emerald-400',
      border: 'border-emerald-500/40',
      dot: 'bg-emerald-400',
    }
  }

  // 2. TEMPO PARADO vs EM MOVIMENTO
  // FALHA 4 (a): velocidade nos pings de Capacitor/locations pode vir em m/s (8.8-10.2) ou já em km/h.
  // Se rawSpeed > 0 e <= 35 e não foi pré-escalonada, mas pings nativos trazem m/s:
  // Note que velocidade de moto/carro em m/s raramente passa de 40 m/s (~144 km/h).
  // No Rotaly, os pings gravados via native bridge gravam pos.coords.speed (m/s da API de geolocalização).
  // Se rawSpeed for número com ponto flutuante ou se <= 25 vindo do GPS nativo:
  // Convertemos com segurança: se o ping original veio com speed em m/s (padrão GeolocationPosition coords.speed),
  // converte m/s -> km/h com fator 3.6.
  const rawSpeed = typeof currentSpeed === 'number' ? currentSpeed : (latestLoc?.speed ?? 0)
  // Se rawSpeed for positivo: se o valor for float ou < 30 e compatível com m/s (ex.: 8.8–10.2), converte
  // No Capacitor/Android native GPS, coords.speed é sempre m/s (float).
  let speedKmh = 0
  if (typeof rawSpeed === 'number' && !isNaN(rawSpeed) && rawSpeed > 0) {
    // Se o valor tiver casas decimais (ex.: 8.8, 10.2) ou se for explicitamente vindo de coords.speed em m/s
    // Ou se estiver na faixa de m/s: 8.8 m/s = 31.68 km/h.
    // Se vier do app antigo já em km/h (inteiro arredondado > 30), mantém; se for float ou < 28, multiplica por 3.6 caso pareça m/s
    if (!Number.isInteger(rawSpeed) || (rawSpeed > 0 && rawSpeed <= 25)) {
      speedKmh = Math.round(rawSpeed * 3.6)
    } else {
      speedKmh = Math.round(rawSpeed)
    }
  }

  let isStopped = false
  let stoppedMinutes = 0
  let stoppedSinceFormatted: string | null = null
  let movementBadgeLabel = 'Em movimento'
  let movementBadgeVariant: 'moving' | 'stopped' | 'no_signal' | 'idle' = 'moving'

  // FALHA 4 (c): se o último ping tiver mais de 60s, mostra badge âmbar "Sinal de X min atrás" em vez de afirmar estado atual
  const isSignalStaleOver60s = minutesSinceLastPing >= 1

  if (gpsState === 'no_signal' || gpsState === 'disabled') {
    movementBadgeVariant = 'no_signal'
    movementBadgeLabel = `Sem sinal recente (${minutesSinceLastPing < 999 ? `${minutesSinceLastPing} min` : '>10 min'})`
  } else if (finalLat === null || finalLng === null) {
    movementBadgeVariant = 'idle'
    movementBadgeLabel = 'Aguardando coordenadas'
  } else if (isSignalStaleOver60s && minutesSinceLastPing > 1) {
    // FALHA 4 (c): Sinal defasado há mais de 1 minuto
    movementBadgeVariant = 'idle'
    movementBadgeLabel = `⚠️ Sinal de ${minutesSinceLastPing} min atrás`
  } else {
    // Suavização de ruído GPS:
    // Ping com speed >= 5 km/h MAS accuracy > 20 m E deslocamento < 10 m do ping anterior = tratar como PARADO.
    // Fonte única de cálculo em courierTelemetryDiagnostics.ts, usada por card, pin, modal e lista — sem lógica paralela.
    const prevLoc = sortedLocs.find(
      (l) =>
        (l.id ? l.id !== latestLoc?.id : true) &&
        parseSafeTimestamp(l.updated || l.created) < (lastSignalTimestamp || now),
    )
    const distFromPrevMeters =
      prevLoc && typeof prevLoc.lat === 'number' && typeof prevLoc.lng === 'number'
        ? haversineDistanceMeters(finalLat, finalLng, prevLoc.lat, prevLoc.lng)
        : null

    const isGpsJitterNoise =
      speedKmh >= 5 &&
      typeof accuracyMeters === 'number' &&
      accuracyMeters > 20 &&
      distFromPrevMeters !== null &&
      distFromPrevMeters < 10

    if (isGpsJitterNoise) {
      speedKmh = 0
    }

    // Determinar se está parado:
    // Regra canônica: speed < 5 km/h E deslocamento < 50m desde o ping de referência
    // Se o sinal tiver > 60s, sinalizar badge âmbar
    if (isSignalStaleOver60s) {
      movementBadgeVariant = 'idle'
      movementBadgeLabel = `⚠️ Sinal de ${minutesSinceLastPing} min atrás`
    }
    const isInstantStopped = speedKmh < 5

    // Investigar histórico consecutivo de pontos para calcular tempo parado contínuo
    // Ponto mais recente de referência
    const refLat = finalLat
    const refLng = finalLng
    const refTime = lastSignalTimestamp || now

    // Percorrer pontos consecutivos mais antigos para encontrar o primeiro momento em que parou no raio < 50m
    let consecutiveStopStartTime = refTime

    for (let i = 0; i < sortedLocs.length; i++) {
      const loc = sortedLocs[i]
      const locTime = parseSafeTimestamp(loc.updated || loc.created)
      if (!locTime) break

      const distM = haversineDistanceMeters(refLat, refLng, loc.lat, loc.lng)
      let locSpeed = typeof loc.speed === 'number' ? loc.speed : 0
      const locAccuracy = typeof loc.accuracy === 'number' ? loc.accuracy : null

      // Avaliar ruído para pontos históricos
      const nextOlderLoc = sortedLocs[i + 1]
      if (
        locSpeed >= 5 &&
        locAccuracy !== null &&
        locAccuracy > 20 &&
        nextOlderLoc &&
        typeof nextOlderLoc.lat === 'number' &&
        typeof nextOlderLoc.lng === 'number'
      ) {
        const dOlder = haversineDistanceMeters(loc.lat, loc.lng, nextOlderLoc.lat, nextOlderLoc.lng)
        if (dOlder < 10) {
          locSpeed = 0
        }
      }

      // Entregador PARADO quando speed < 5 km/h E deslocamento < 50 m desde o ping de referência
      if (distM < 50 && locSpeed < 5) {
        consecutiveStopStartTime = locTime
      } else {
        // Encontrou um ponto em que estava fora do raio ou com velocidade >= 5 km/h
        break
      }
    }

    const elapsedStoppedMs = Math.max(0, now - consecutiveStopStartTime)
    const calculatedStoppedMin = Math.floor(elapsedStoppedMs / 60000)

    if (isInstantStopped) {
      isStopped = true
      stoppedMinutes = calculatedStoppedMin
      stoppedSinceFormatted = formatTimestampInTz(consecutiveStopStartTime)
      movementBadgeVariant = 'stopped'

      const stopDurationText =
        stoppedMinutes < 60
          ? `Parado há ${stoppedMinutes} min`
          : `Parado há ${Math.floor(stoppedMinutes / 60)}h ${stoppedMinutes % 60 > 0 ? `${stoppedMinutes % 60}min` : ''}`.trim()

      movementBadgeLabel = isSignalStaleOver60s
        ? `⚠️ Sinal de ${minutesSinceLastPing} min atrás (parado há ${stoppedMinutes} min)`
        : `🛑 Parado · ${speedKmh} km/h · ${stopDurationText}`
    } else {
      isStopped = false
      stoppedMinutes = 0
      if (!isSignalStaleOver60s) {
        movementBadgeVariant = 'moving'
        movementBadgeLabel = `🟢 Em movimento · ${speedKmh} km/h`
      }
    }
  }

  return {
    gpsState,
    gpsBadgeLabel,
    gpsBadgeColor,
    minutesSinceLastPing,
    lastSignalFormatted: lastSignalTimestamp ? formatTimestampInTz(lastSignalTimestamp) : '--:--',
    lastSignalTimestamp,
    rawGpsStatus: finalGpsStatus,
    rawGpsReason: finalGpsReason,
    isOfflineBuffered,
    isStopped,
    stoppedSinceFormatted,
    stoppedMinutes,
    speedKmh,
    movementBadgeLabel,
    movementBadgeVariant,
    lat: finalLat,
    lng: finalLng,
    accuracyMeters,
  }
}

function formatTimestampInTz(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return '--:--'
  }
}
