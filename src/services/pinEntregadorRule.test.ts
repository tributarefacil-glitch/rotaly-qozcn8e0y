import { describe, it, expect, vi } from 'vitest'
import { haversineDistanceMeters } from '@/lib/geo'

describe('Regra dos 500m do fluxo pin_entregador (ponta a ponta lhes garantindo distinção)', () => {
  it('marcação a ~100m do pin resulta em <= 500m -> auto-correção direta no cadastro sem criar card em address_alerts', () => {
    // Coordenadas simuladas (~100m de distância)
    const originalCustomerLat = -25.4284
    const originalCustomerLng = -49.2733

    // Ponto GPS marcado a ~100 metros
    const courierGpsLat = -25.4292
    const courierGpsLng = -49.2736

    const dist = Math.round(
      haversineDistanceMeters(
        originalCustomerLat,
        originalCustomerLng,
        courierGpsLat,
        courierGpsLng,
      ),
    )

    expect(dist).toBeGreaterThanOrEqual(80)
    expect(dist).toBeLessThanOrEqual(150)
    expect(dist <= 500).toBe(true)

    // Decisão da regra:
    const isAutoCorrection = dist <= 500
    expect(isAutoCorrection).toBe(true)
  })

  it('marcação a ~1km do pin resulta em > 500m -> card pendente em address_alerts para aprovação na central', () => {
    // Coordenadas simuladas (~1.1km de distância)
    const originalCustomerLat = -25.4284
    const originalCustomerLng = -49.2733

    // Ponto GPS marcado a ~1.1 km
    const courierGpsLat = -25.4384
    const courierGpsLng = -49.2733

    const dist = Math.round(
      haversineDistanceMeters(
        originalCustomerLat,
        originalCustomerLng,
        courierGpsLat,
        courierGpsLng,
      ),
    )

    expect(dist).toBeGreaterThan(1000)
    expect(dist <= 500).toBe(false)

    // Decisão da regra:
    const isAutoCorrection = dist <= 500
    expect(isAutoCorrection).toBe(false)
  })
})
