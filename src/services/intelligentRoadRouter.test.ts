import { describe, it, expect } from 'vitest'
import {
  normalizeStreetName,
  areAddressesOnSameStreet,
  sequenceStopsWithDeterministicTsp,
  consolidateSameStreetAdjacency,
  optimizeRouteSequence,
  type StopCandidate,
} from './intelligentRoadRouter'

describe('intelligentRoadRouter', () => {
  it('normaliza logradouros corretamente', () => {
    expect(normalizeStreetName('Rua São Jorge, 10 - Centro')).toBe('sao jorge')
    expect(normalizeStreetName('R. São Jorge, 45')).toBe('sao jorge')
    expect(normalizeStreetName('Avenida Brasil, 1200')).toBe('brasil')
    expect(normalizeStreetName('Av. Brasil - Bonsucesso')).toBe('brasil')
  })

  it('detecta se dois endereços são da mesma rua', () => {
    expect(areAddressesOnSameStreet('Rua São Jorge, 10', 'R. São Jorge, 45')).toBe(true)
    expect(
      areAddressesOnSameStreet('Av. Presidente Vargas, 500', 'Avenida Presidente Vargas, 100'),
    ).toBe(true)
    expect(areAddressesOnSameStreet('Rua A, 10', 'Rua B, 20')).toBe(false)
  })

  it('agrupa entregas na mesma rua mantendo contiguidade sequencial', () => {
    const origin = { lat: -22.906847, lng: -43.172896 }
    const stops: StopCandidate[] = [
      {
        id: '1',
        tracking_code: 'TRK-001',
        customer_name: 'Cliente Rua A - 10',
        address: 'Rua das Flores, 10',
        lat: -22.905,
        lng: -43.175,
      },
      {
        id: '2',
        tracking_code: 'TRK-002',
        customer_name: 'Cliente Rua B - 50',
        address: 'Rua do Sol, 50',
        lat: -22.902,
        lng: -43.171,
      },
      {
        id: '3',
        tracking_code: 'TRK-003',
        customer_name: 'Cliente Rua A - 90',
        address: 'Rua das Flores, 90',
        lat: -22.9052,
        lng: -43.1752,
      },
    ]

    const sequenced = sequenceStopsWithDeterministicTsp(origin, origin, stops)
    const consolidated = consolidateSameStreetAdjacency(origin, sequenced)

    // Os dois pedidos de Rua das Flores devem ficar juntos (adjacentes)
    const idx1 = consolidated.findIndex((s) => s.id === '1')
    const idx3 = consolidated.findIndex((s) => s.id === '3')
    expect(Math.abs(idx1 - idx3)).toBe(1)
  })

  it('guarantees unique deterministic sequences 1..N with destination as base', async () => {
    const origin = { lat: -22.6977499, lng: -43.2936013 }
    const destination = { lat: -22.6977499, lng: -43.2936013 } // base canônica
    const stops: StopCandidate[] = [
      {
        id: 'a',
        tracking_code: 'TRK-A',
        customer_name: 'Jorge',
        address: 'Rua A, 10',
        lat: -22.705,
        lng: -43.301,
      },
      {
        id: 'b',
        tracking_code: 'TRK-B',
        customer_name: 'ANGELICA',
        address: 'Rua B, 20',
        lat: -22.708,
        lng: -43.305,
      },
    ]

    const res = await optimizeRouteSequence({
      origin,
      destination,
      stops,
      vehicleType: 'moto',
    })

    expect(res.stops).toHaveLength(2)
    expect(res.stops[0].sequence).toBe(1)
    expect(res.stops[1].sequence).toBe(2)
    // Sequências estritamente únicas
    const seqSet = new Set(res.stops.map((s) => s.sequence))
    expect(seqSet.size).toBe(2)
    expect(res.return_distance_km).toBeGreaterThanOrEqual(0)
  })
})
