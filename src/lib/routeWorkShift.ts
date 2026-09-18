/**
 * routeWorkShift.ts
 *
 * Motor de cálculo de tempo total restante de rota e carga horária do entregador no Rotaly.
 *
 * Suporta configuração de JORNADA DE TRABALHO da empresa:
 * - workStartTime: Horário de entrada (ex: "08:00")
 * - lunchStartTime: Saída para almoço (ex: "12:00")
 * - lunchEndTime: Volta do almoço (ex: "13:00")
 * - workEndTime: Fim do expediente (ex: "18:30")
 *
 * Regras:
 * 1. Janela de Almoço: Se a rota projetada (entre a referência/início e o término previsto)
 *    atravessa ou se sobrepõe ao intervalo de almoço cadastrado, o tempo de almoço
 *    (diferença entre lunchStartTime e lunchEndTime) é considerado/adicionado à previsão de término
 *    e ao tempo de rota, de modo que o horário de volta à base reflita a parada obrigatória de almoço.
 * 2. Carga Horária Efetiva: Duração líquida de trabalho (total da jornada descontando almoço)
 *    comparada à jornada máxima diária (ex: 8h = 480 min).
 * 3. Limite do Expediente: Comparação do término projetado com o workEndTime configurado.
 * 4. Fallback seguro: se horários não forem fornecidos ou forem inválidos, mantém padrão
 *    8h de jornada e fim às 18:30.
 */

export interface WorkShiftConfig {
  workStartTime?: string // ex: "08:00"
  lunchStartTime?: string // ex: "12:00"
  lunchEndTime?: string // ex: "13:00"
  workEndTime?: string // ex: "18:30"
}

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
  lunchMinutesIncluded?: number // Minutos de almoço considerados na projeção
  shiftConfigUsed?: {
    workStartTime: string
    lunchStartTime: string
    lunchEndTime: string
    workEndTime: string
  }
}

/**
 * Utilitário para converter string "HH:mm" em minutos desde meia-noite (0..1439).
 */
export function parseTimeToMinutes(timeStr?: string | null): number | null {
  if (!timeStr || typeof timeStr !== 'string') return null
  const parts = timeStr.trim().split(':')
  if (parts.length < 2) return null
  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  if (isNaN(hours) || isNaN(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null
  }
  return hours * 60 + minutes
}

/**
 * Converte timestamp (Date ou ms) para minutos desde a meia-noite no fuso local.
 */
export function getMinutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes()
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
 * Calcula métricas de tempo restante da rota inteira e cruzamento com carga horária da empresa.
 *
 * @param remainingMinutes Tempo total estimado em minutos para concluir o trajeto viário + atendimento das paradas + retorno à base
 * @param routeStartedAt Timestamp de início da rota (string ISO, Date ou timestamp em ms). Se não informado, assume que começou agora.
 * @param referenceTime Timestamp de referência atual (default Date.now())
 * @param shiftConfig Configurações de jornada da empresa (workStartTime, lunchStartTime, lunchEndTime, workEndTime)
 */
export function calculateRouteWorkShift(
  remainingMinutes: number,
  routeStartedAt?: string | number | Date | null,
  referenceTime: number = Date.now(),
  shiftConfig?: WorkShiftConfig | null,
): RouteWorkShiftMetrics {
  const safeBaseRemaining = Math.max(0, Math.round(remainingMinutes))

  // 1. Normalizar horários da jornada configurados ou usar fallbacks
  const workStartStr = shiftConfig?.workStartTime?.trim() || '08:00'
  const lunchStartStr = shiftConfig?.lunchStartTime?.trim() || '12:00'
  const lunchEndStr = shiftConfig?.lunchEndTime?.trim() || '13:00'
  const workEndStr = shiftConfig?.workEndTime?.trim() || '18:30'

  const workStartMins = parseTimeToMinutes(workStartStr) ?? 8 * 60 // 08:00
  const lunchStartMins = parseTimeToMinutes(lunchStartStr) ?? 12 * 60 // 12:00
  const lunchEndMins = parseTimeToMinutes(lunchEndStr) ?? 13 * 60 // 13:00
  const workEndMins = parseTimeToMinutes(workEndStr) ?? 18 * 60 + 30 // 18:30

  // Duração da pausa de almoço configurada
  const lunchDurationMins = lunchEndMins > lunchStartMins ? lunchEndMins - lunchStartMins : 60 // default 60 min

  // Horas de trabalho contratadas na jornada padrão (ex: de 08:00 a 18:30 menos 1h de almoço = 9h30 ou 8h de expediente)
  // Calculamos a jornada útil líquida padrão (se configurado, total entre workStart e workEnd deduzindo almoço, ou fallback 8h = 480 min)
  let standardWorkShiftCapacityMins = 8 * 60 // 480 min
  if (workEndMins > workStartMins) {
    const rawSpan = workEndMins - workStartMins
    const netSpan = rawSpan > lunchDurationMins ? rawSpan - lunchDurationMins : rawSpan
    // Limite máximo diário de trabalho efetivo
    standardWorkShiftCapacityMins = Math.max(240, netSpan)
  }

  // 2. Determinar início e janela de tempo da rota
  let routeStartTime = referenceTime
  if (routeStartedAt) {
    const parsed = new Date(routeStartedAt).getTime()
    if (!isNaN(parsed) && parsed > 0 && parsed <= referenceTime) {
      routeStartTime = parsed
    }
  }

  // 3. Verificar janela de almoço:
  // Se a projeção da rota restante (ou rota inteira desde a referência) sobrepõe o período de almoço,
  // adicionar o intervalo de almoço ao tempo projetado de conclusão.
  // Exemplo: se o entregador está na rota às 11:30 e a rota dura 2h (até 13:30), o almoço (12:00-13:00)
  // cai no meio, logo ele precisará de +60min de parada de almoço, terminando às 14:30.
  const refDate = new Date(referenceTime)
  const currentMinuteOfDay = getMinutesOfDay(refDate)

  // Criar data projetada de início e fim no dia da referência
  const lunchStartDate = new Date(refDate)
  lunchStartDate.setHours(Math.floor(lunchStartMins / 60), lunchStartMins % 60, 0, 0)
  const lunchEndDate = new Date(refDate)
  lunchEndDate.setHours(Math.floor(lunchEndMins / 60), lunchEndMins % 60, 0, 0)

  // Projeção preliminar sem almoço
  const rawProjectedEndTimestamp = referenceTime + safeBaseRemaining * 60 * 1000

  let lunchMinutesToAdd = 0
  if (lunchDurationMins > 0) {
    // Caso 1: O momento atual é ANTES do fim do almoço e a rota vai além do início do almoço
    // (ou seja, a janela da rota atravessa o horário de almoço)
    const routeCrossesLunch =
      referenceTime < lunchEndDate.getTime() && rawProjectedEndTimestamp > lunchStartDate.getTime()

    // Se o entregador está atualmente DENTRO da janela de almoço, ele ainda tem o restante do almoço a cumprir
    if (routeCrossesLunch) {
      if (referenceTime >= lunchStartDate.getTime() && referenceTime < lunchEndDate.getTime()) {
        // Já está no meio do almoço: adicionar os minutos restantes até lunchEndDate
        const remainingLunchMs = lunchEndDate.getTime() - referenceTime
        lunchMinutesToAdd = Math.max(0, Math.round(remainingLunchMs / (60 * 1000)))
      } else {
        // Inicia antes do almoço e termina depois: adiciona o almoço integral
        lunchMinutesToAdd = lunchDurationMins
      }
    }
  }

  // Tempo restante total considerando almoço se aplicável
  const finalRemainingMinutes = safeBaseRemaining + lunchMinutesToAdd
  const projectedEndTimestamp = referenceTime + finalRemainingMinutes * 60 * 1000
  const projectedEndDate = new Date(projectedEndTimestamp)

  const projectedEndTimeFormatted = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
  }).format(projectedEndDate)

  // 4. Tempo decorrido desde o início da rota
  const elapsedMinutes = Math.max(0, Math.round((referenceTime - routeStartTime) / (60 * 1000)))
  // Tempo total bruto da rota (decorrido + restante)
  const totalShiftMinutes = elapsedMinutes + finalRemainingMinutes

  // Tempo de trabalho efetivo (descontando pausa de almoço para cálculo de carga horária)
  const effectiveWorkMinutes = Math.max(0, totalShiftMinutes - lunchMinutesToAdd)

  // 5. Regra 1: Comparar trabalho efetivo com a capacidade máxima da jornada (standardWorkShiftCapacityMins)
  const shiftExcessMinutes =
    effectiveWorkMinutes > standardWorkShiftCapacityMins
      ? effectiveWorkMinutes - standardWorkShiftCapacityMins
      : 0

  // 6. Regra 2: Término projetado comparado com o workEndTime configurado (ex: 18:30)
  const cutoffDate = new Date(projectedEndDate)
  cutoffDate.setHours(Math.floor(workEndMins / 60), workEndMins % 60, 0, 0)
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

  const remainingFormatted = `${formatRemainingDuration(finalRemainingMinutes)} restantes`

  const badgeText = isOvertime
    ? `⚠️ Passa da carga horária (+${overtimeMinutes} min)`
    : '✓ Dentro da carga horária'

  const badgeVariant: 'warning' | 'success' = isOvertime ? 'warning' : 'success'

  return {
    remainingRouteMinutes: finalRemainingMinutes,
    remainingFormatted,
    projectedEndTime: projectedEndDate,
    projectedEndTimeFormatted,
    totalShiftMinutes,
    isOvertime,
    overtimeMinutes,
    overtimeReason,
    badgeText,
    badgeVariant,
    lunchMinutesIncluded: lunchMinutesToAdd,
    shiftConfigUsed: {
      workStartTime: workStartStr,
      lunchStartTime: lunchStartStr,
      lunchEndTime: lunchEndStr,
      workEndTime: workEndStr,
    },
  }
}
