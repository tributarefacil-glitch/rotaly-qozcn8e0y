/**
 * redirectionKmEngine.ts
 *
 * Motor de cálculo de KM extra para o fluxo "Entrega Redirecionada":
 * 1. Ponto A: Coordenada GPS capturada na chegada ao endereço do sistema (ponto planejado).
 * 2. Ponto B: Coordenada GPS capturada na confirmação da entrega no novo endereço.
 * 3. Cálculo do KM extra entre A e B:
 *    - Primário: Trajetória real da telemetria GPS (pontos registrados na janela entre Ponto A e Ponto B).
 *    - Fallback: Distância Haversine em linha reta entre A e B convertida com fator viário urbano (1.3x).
 * 4. Regra de Auditoria de KM:
 *    - Desvio extra <= 3.0 km: Aprovação AUTOMÁTICA no cálculo oficial de KM e combustível.
 *    - Desvio extra > 3.0 km: Status PENDENTE na fila manual da Auditoria de KM para triagem do admin.
 */

import { haversineDistanceMeters } from '@/lib/geo'
import type { LocationRecord } from '@/types/delivery'

export interface RedirectionCalculationResult {
  extraKm: number
  method: 'telemetry_gps' | 'haversine_road_factor'
  isAutoApproved: boolean
  pointsCount: number
  directDistanceKm: number
}

/**
 * Calcula o KM extra percorrido entre o Ponto A e o Ponto B.
 * Se houver pontos de telemetria GPS do entregador entre timestampA e timestampB, calcula a soma
 * real dos passos percorridos. Caso contrário, aplica fallback de linha reta + fator viário.
 */
export function calculateRedirectionExtraKm(params: {
  pointALat: number
  pointALng: number
  pointBLat: number
  pointBLng: number
  timestampA?: string | number
  timestampB?: string | number
  courierLocations?: LocationRecord[]
}): RedirectionCalculationResult {
  const {
    pointALat,
    pointALng,
    pointBLat,
    pointBLng,
    timestampA,
    timestampB,
    courierLocations = [],
  } = params

  // 1. Distância direta em linha reta (Haversine)
  const directMeters = haversineDistanceMeters(pointALat, pointALng, pointBLat, pointBLng)
  const directDistanceKm = Number((directMeters / 1000).toFixed(2))

  // 2. Verificar se temos telemetria válida do intervalo
  let telemetryKm: number | null = null
  let validPointsCount = 0

  const timeA = timestampA ? new Date(timestampA).getTime() : 0
  const timeB = timestampB ? new Date(timestampB).getTime() : 0

  if (timeA > 0 && timeB > timeA && courierLocations.length > 1) {
    // Filtrar pontos do intervalo com tolerância de 60 segundos
    const intervalPoints = courierLocations
      .filter((loc) => {
        if (!loc.created) return false
        const t = new Date(loc.created).getTime()
        return t >= timeA - 60000 && t <= timeB + 60000
      })
      .sort((a, b) => new Date(a.created!).getTime() - new Date(b.created!).getTime())

    if (intervalPoints.length >= 2) {
      let sumMeters = 0
      for (let i = 0; i < intervalPoints.length - 1; i++) {
        const p1 = intervalPoints[i]
        const p2 = intervalPoints[i + 1]
        const stepDist = haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng)
        // Ignorar micro-ruído de GPS estático (< 10 metros) ou saltos gigantescos anômalos (> 5 km em único ping)
        if (stepDist >= 10 && stepDist <= 5000) {
          sumMeters += stepDist
        }
      }

      if (sumMeters > 0) {
        telemetryKm = Number((sumMeters / 1000).toFixed(1))
        validPointsCount = intervalPoints.length
      }
    }
  }

  // 3. Decidir se usa telemetria real ou fallback viário urbano (1.3x)
  let extraKm = 0
  let method: 'telemetry_gps' | 'haversine_road_factor' = 'haversine_road_factor'

  if (telemetryKm !== null && telemetryKm > 0) {
    extraKm = telemetryKm
    method = 'telemetry_gps'
  } else {
    // Fallback: Haversine linha reta convertida com fator viário (1.3x)
    extraKm = Number((directDistanceKm * 1.3).toFixed(1))
    method = 'haversine_road_factor'
  }

  // 4. Regra de corte dos 3 km para aprovação automática
  const isAutoApproved = extraKm <= 3.0

  return {
    extraKm,
    method,
    isAutoApproved,
    pointsCount: validPointsCount,
    directDistanceKm,
  }
}
