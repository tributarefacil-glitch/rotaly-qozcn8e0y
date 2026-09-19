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
  // Se não temos coordenadas ou nunca houve sinal
  const rawSpeed = typeof currentSpeed === 'number' ? currentSpeed : (latestLoc?.speed ?? 0)
  const speedKmh = Math.max(0, Math.round(rawSpeed))

  let isStopped = false
  let stoppedMinutes = 0
  let stoppedSinceFormatted: string | null = null
  let movementBadgeLabel = 'Em movimento'
  let movementBadgeVariant: 'moving' | 'stopped' | 'no_signal' | 'idle' = 'moving'

  if (gpsState === 'no_signal' || gpsState === 'disabled') {
    movementBadgeVariant = 'no_signal'
    movementBadgeLabel = `Sem sinal recente (${minutesSinceLastPing < 999 ? `${minutesSinceLastPing} min` : '>10 min'})`
  } else if (finalLat === null || finalLng === null) {
    movementBadgeVariant = 'idle'
    movementBadgeLabel = 'Aguardando coordenadas'
  } else {
    // Determinar se está parado:
    // Se a velocidade atual é < 3 km/h ou se os pontos recentes não mudaram mais que ~30 metros
    const isInstantSpeedZero = speedKmh <= 2

    // Investigar histórico consecutivo de pontos para calcular tempo parado
    // Ponto mais recente de referência
    const refLat = finalLat
    const refLng = finalLng
    const refTime = lastSignalTimestamp || now

    // Percorrer pontos consecutivos mais antigos para encontrar o primeiro momento em que parou nesse raio de ~30m
    let consecutiveStopStartTime = refTime
    let consecutivePointsCount = 0

    for (let i = 0; i < sortedLocs.length; i++) {
      const loc = sortedLocs[i]
      const locTime = parseSafeTimestamp(loc.updated || loc.created)
      if (!locTime) break

      const distM = haversineDistanceMeters(refLat, refLng, loc.lat, loc.lng)
      const locSpeed = Math.round(loc.speed || 0)

      // Se deslocamento < 35 metros (tolerância de precisão GPS) ou velocidade quase zero
      if (distM <= 35 || locSpeed <= 2) {
        consecutiveStopStartTime = locTime
        consecutivePointsCount++
      } else {
        // Encontrou um ponto em que ele estava fora desse raio (estava em movimento)
        break
      }
    }

    const elapsedStoppedMs = Math.max(0, now - consecutiveStopStartTime)
    const calculatedStoppedMin = Math.floor(elapsedStoppedMs / 60000)

    if (isInstantSpeedZero && calculatedStoppedMin >= 1) {
      isStopped = true
      stoppedMinutes = calculatedStoppedMin
      movementBadgeVariant = 'stopped'
      if (stoppedMinutes < 60) {
        movementBadgeLabel = `Parado há ${stoppedMinutes} min`
      } else {
        const hrs = Math.floor(stoppedMinutes / 60)
        const remMin = stoppedMinutes % 60
        movementBadgeLabel = `Parado há ${hrs}h ${remMin > 0 ? `${remMin}min` : ''}`
      }
    } else if (isInstantSpeedZero) {
      isStopped = true
      stoppedMinutes = 0
      movementBadgeVariant = 'stopped'
      movementBadgeLabel = 'Parado recentemente (< 1 min)'
    } else {
      isStopped = false
      movementBadgeVariant = 'moving'
      movementBadgeLabel = `Em movimento • ${speedKmh} km/h`
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
