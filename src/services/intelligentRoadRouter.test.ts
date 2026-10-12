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

  it('descarta o bônus de mesma rua se piorar o km total em mais de 10% (D1 > D0 * 1.10)', () => {
    const origin = { lat: -22.6977499, lng: -43.2936013 }
    const destination = origin

    // Matriz viária artificial onde:
    // Ponto 0: origem
    // Ponto 1: Parada 1 ("Rua A, 10")
    // Ponto 2: Parada 2 ("Rua B, 20")
    // Ponto 3: Parada 3 ("Rua A, 999" - mesma rua de 1, mas forçar visitar 3 logo após 1 cria um desvio enorme)
    const stops: StopCandidate[] = [
      {
        id: 's1',
        tracking_code: 'TRK-1',
        customer_name: 'Cliente 1',
        address: 'Rua A, 10',
        lat: -22.698,
        lng: -43.293,
        priority: 'normal',
      },
      {
        id: 's2',
        tracking_code: 'TRK-2',
        customer_name: 'Cliente 2',
        address: 'Rua B, 20',
        lat: -22.699,
        lng: -43.294,
        priority: 'normal',
      },
      {
        id: 's3',
        tracking_code: 'TRK-3',
        customer_name: 'Cliente 3',
        address: 'Rua A, 999',
        lat: -22.7,
        lng: -43.295,
        priority: 'normal',
      },
    ]

    // Matriz: 0=origem, 1=s1, 2=s2, 3=s3
    const matrix: number[][] = [
      [0, 1000, 2000, 3000], // 0 -> [0, s1, s2, s3]
      [1000, 0, 1000, 15000], // s1 -> [origem, s1, s2, s3]
      [2000, 1000, 0, 1000], // s2 -> [origem, s1, s2, s3]
      [3000, 15000, 1000, 0], // s3 -> [origem, s1, s2, s3]
    ]

    const sequenced = sequenceStopsWithDeterministicTsp(origin, destination, stops, matrix)
    expect(sequenced.length).toBe(3)
    // Sem bônus ou com descarte por estourar > 10%, a ordem ótima viária é mantida (s1 -> s2 -> s3)
    expect(sequenced[0].id).toBe('s1')
    expect(sequenced[1].id).toBe('s2')
    expect(sequenced[2].id).toBe('s3')
  })

  it('função chunkArray divide corretamente lotes com mais de 25 paradas em blocos de até 23', async () => {
    const { chunkArray } = await import('./intelligentRoadRouter')
    const stopsList = Array.from({ length: 50 }, (_, i) => ({ id: `stop-${i + 1}` }))
    const chunks = chunkArray(stopsList, 23)
    expect(chunks.length).toBe(3) // 23 + 23 + 4 = 50
    expect(chunks[0].length).toBe(23)
    expect(chunks[1].length).toBe(23)
    expect(chunks[2].length).toBe(4)
  })

  it('calcula métricas de tempo de trânsito e permanência separados', async () => {
    const origin = { lat: -22.6977499, lng: -43.2936013 }
    const destination = origin
    const stops: StopCandidate[] = [
      {
        id: 's1',
        tracking_code: 'TRK-S1',
        customer_name: 'Cliente 1',
        address: 'Rua Central, 10',
        lat: -22.7,
        lng: -43.29,
        priority: 'normal',
      },
      {
        id: 's2',
        tracking_code: 'TRK-S2',
        customer_name: 'Cliente 2',
        address: 'Rua Central, 50',
        lat: -22.705,
        lng: -43.295,
        priority: 'normal',
      },
    ]
    const result = await optimizeRouteSequence({
      origin,
      destination,
      stops,
      vehicleType: 'moto',
      stopDurationMinutes: 6,
    })

    expect(result.stop_duration_minutes).toBe(6)
    expect(result.service_duration_minutes).toBe(12) // 2 paradas * 6 min
    expect(typeof result.transit_duration_minutes).toBe('number')
    expect(result.estimated_duration_minutes).toBe(
      (result.transit_duration_minutes || 0) + (result.service_duration_minutes || 0),
    )
  })
})
