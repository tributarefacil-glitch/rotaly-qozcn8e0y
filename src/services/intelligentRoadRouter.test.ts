import { describe, it, expect } from 'vitest'
import {
  normalizeStreetName,
  areAddressesOnSameStreet,
  sequenceStopsWithDeterministicTsp,
  consolidateSameStreetAdjacency,
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
})
