/**
 * routeWorkShift.ts
 *
 * Motor de cálculo de tempo total restante de rota e carga horária do entregador no Rotaly.
 * Requisito:
 * - remainingRouteMinutes: tempo de trânsito restante para concluir a rota (incluindo retorno à base)
 *   + tempo de atendimento das paradas pendentes (5 min por parada).
 * - projectedEndTime: timestamp projetado de conclusão (now + remainingRouteMinutes).
 * - projectedEndTimeFormatted: string no formato "HH:mm" (horário local do Brasil).
 * - Regra de Carga Horária:
 *   - Jornada máxima: 8 horas (480 minutos) a partir de route_started_at (ou rota atual).
 *   - Limite do expediente: 18:30 (18 horas e 30 minutos).
 *   - Se a rota projetada passar de 8h de jornada OU o término projetado for depois de 18:30,
 *     marcar isOvertime = true e overtimeMinutes = minutos excedentes (o maior excesso entre as duas regras).
 *   - Caso contrário, dentro da carga horária (isOvertime = false, overtimeMinutes = 0).
 */

export interface RouteWorkShiftMetrics {
  remainingRouteMinutes: number
  remainingFormatted: string // e.g. "~1h 25m restantes" ou "~45 min restantes"
  projectedEndTime: Date
  projectedEndTimeFormatted: string // e.g. "17:40"
  totalShiftMinutes: number
  isOvertime: boolean
  overtimeMinutes: number
  overtimeReason?: 'shift_limit' | 'time_limit' | 'both'
  badgeText: string // "⚠️ Passa da carga horária (+X min)" ou "✓ Dentro da carga horária"
  badgeVariant: 'warning' | 'success'
}

/**
 * Formata minutos em formato amigável, e.g. "~1h 25m" ou "~45 min"
 */
export function formatRemainingDuration(minutes: number): string {
  const safeMins = Math.max(0, Math.round(minutes))
  if (safeMins < 60) {
    return `~${safeMins} min`
  }
  const hours = Math.floor(safeMins / 60)
  const remainingMins = safeMins % 60
  if (remainingMins === 0) {
    return `~${hours}h`
  }
  return `~${hours}h ${remainingMins}m`
}

/**
 * Calcula métricas de tempo restante da rota inteira e cruzamento com carga horária.
 *
 * @param remainingMinutes Tempo total estimado em minutos para concluir o trajeto viário + atendimento das paradas + retorno à base
 * @param routeStartedAt Timestamp de início da rota (string ISO, Date ou timestamp em ms). Se não informado, assume que começou agora.
 * @param referenceTime Timestamp de referência atual (default Date.now())
 */
export function calculateRouteWorkShift(
  remainingMinutes: number,
  routeStartedAt?: string | number | Date | null,
  referenceTime: number = Date.now(),
): RouteWorkShiftMetrics {
  const safeRemaining = Math.max(0, Math.round(remainingMinutes))
  const projectedEndTimestamp = referenceTime + safeRemaining * 60 * 1000
  const projectedEndDate = new Date(projectedEndTimestamp)

  const projectedEndTimeFormatted = projectedEndDate.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  })

  // 1. Duração da jornada (início da rota até o término projetado)
  let routeStartTime = referenceTime
  if (routeStartedAt) {
    const parsed = new Date(routeStartedAt).getTime()
    if (!isNaN(parsed) && parsed > 0 && parsed <= referenceTime) {
      routeStartTime = parsed
    }
  }

  const elapsedMinutes = Math.max(0, Math.round((referenceTime - routeStartTime) / (60 * 1000)))
  const totalShiftMinutes = elapsedMinutes + safeRemaining

  // 2. Regra 1: Jornada de trabalho máxima de 8 horas (480 minutos)
  const MAX_SHIFT_MINUTES = 8 * 60 // 480 min
  const shiftExcessMinutes =
    totalShiftMinutes > MAX_SHIFT_MINUTES ? totalShiftMinutes - MAX_SHIFT_MINUTES : 0

  // 3. Regra 2: Término projetado depois de 18:30 (horário comercial/noturno)
  const cutoffDate = new Date(projectedEndDate)
  cutoffDate.setHours(18, 30, 0, 0)
  const cutoffTimestamp = cutoffDate.getTime()

  let timeExcessMinutes = 0
  if (projectedEndTimestamp > cutoffTimestamp) {
    timeExcessMinutes = Math.max(
      0,
      Math.round((projectedEndTimestamp - cutoffTimestamp) / (60 * 1000)),
    )
  }

  const isOvertime = shiftExcessMinutes > 0 || timeExcessMinutes > 0
  const overtimeMinutes = Math.max(shiftExcessMinutes, timeExcessMinutes)

  let overtimeReason: 'shift_limit' | 'time_limit' | 'both' | undefined
  if (shiftExcessMinutes > 0 && timeExcessMinutes > 0) {
    overtimeReason = 'both'
  } else if (shiftExcessMinutes > 0) {
    overtimeReason = 'shift_limit'
  } else if (timeExcessMinutes > 0) {
    overtimeReason = 'time_limit'
  }

  const remainingFormatted = `${formatRemainingDuration(safeRemaining)} restantes`

  const badgeText = isOvertime
    ? `⚠️ Passa da carga horária (+${overtimeMinutes} min)`
    : '✓ Dentro da carga horária'

  const badgeVariant: 'warning' | 'success' = isOvertime ? 'warning' : 'success'

  return {
    remainingRouteMinutes: safeRemaining,
    remainingFormatted,
    projectedEndTime: projectedEndDate,
    projectedEndTimeFormatted,
    totalShiftMinutes,
    isOvertime,
    overtimeMinutes,
    overtimeReason,
    badgeText,
    badgeVariant,
  }
}
