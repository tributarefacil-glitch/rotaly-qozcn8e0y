import { describe, it, expect } from 'vitest'
import {
  classifyRouteLeg,
  sanitizeGpsLocations,
  MIN_PINGS_PER_LEG,
} from './routeIntelligenceService'

describe('routeIntelligenceService', () => {
  describe('classifyRouteLeg', () => {
    it('deve marcar como dados insuficientes quando pings < MIN_PINGS_PER_LEG', () => {
      const res = classifyRouteLeg(5.0, 3.2, 2)
      expect(res.isInsufficient).toBe(true)
      expect(res.status).toBe('insufficient_data')
      expect(res.isBetter).toBe(false)
      expect(res.isExcess).toBe(false)
      expect(res.kmDiff).toBeNull()
    })

    it('deve marcar como dados insuficientes quando kmRealized for nulo', () => {
      const res = classifyRouteLeg(5.0, null, 15)
      expect(res.isInsufficient).toBe(true)
      expect(res.status).toBe('insufficient_data')
    })

    it('deve destacar como rota melhor quando o realizado for MENOR que o planejado', () => {
      // Planejado 4.0 km, Realizado 3.1 km (-0.9 km, ~-22.5%)
      const res = classifyRouteLeg(4.0, 3.1, 10)
      expect(res.isBetter).toBe(true)
      expect(res.isExcess).toBe(false)
      expect(res.isInsufficient).toBe(false)
      expect(res.status).toBe('candidate_better')
      expect(res.kmDiff).toBe(-0.9)
      expect(res.diffPct).toBe(-22.5)
    })

    it('deve classificar como desvio excessivo quando o realizado for muito maior', () => {
      // Planejado 2.0 km, Realizado 4.5 km (+2.5 km, +125%)
      const res = classifyRouteLeg(2.0, 4.5, 12)
      expect(res.isBetter).toBe(false)
      expect(res.isExcess).toBe(true)
      expect(res.status).toBe('excess_deviation')
      expect(res.kmDiff).toBe(2.5)
      expect(res.diffPct).toBe(125)
    })

    it('deve classificar como equivalente quando a variação for pequena e normal', () => {
      // Planejado 3.0 km, Realizado 3.05 km
      const res = classifyRouteLeg(3.0, 3.05, 8)
      expect(res.isBetter).toBe(false)
      expect(res.isExcess).toBe(false)
      expect(res.status).toBe('equivalent')
    })
  })

  describe('sanitizeGpsLocations', () => {
    it('deve descartar pings com accuracy >= 100m (guarda anti-zumbi)', () => {
      const raw = [
        { lat: -22.69, lng: -43.29, accuracy: 25, created: '2026-11-04 10:00:00.000Z' },
        { lat: -22.7, lng: -43.29, accuracy: 150, created: '2026-11-04 10:00:10.000Z' }, // zombie
        { lat: -22.71, lng: -43.29, accuracy: 80, created: '2026-11-04 10:00:20.000Z' },
      ]
      const sanitized = sanitizeGpsLocations(raw)
      expect(sanitized.length).toBe(2)
      expect(sanitized[0].lat).toBe(-22.69)
      expect(sanitized[1].lat).toBe(-22.71)
    })

    it('deve deduplicar pings gravados em rajada a menos de 5 segundos', () => {
      const raw = [
        { lat: -22.69, lng: -43.29, accuracy: 10, created: '2026-11-04 10:00:00.000Z' },
        { lat: -22.69, lng: -43.29, accuracy: 10, created: '2026-11-04 10:00:01.000Z' }, // 1s depois e parado
        { lat: -22.7, lng: -43.29, accuracy: 10, created: '2026-11-04 10:00:10.000Z' }, // 10s depois
      ]
      const sanitized = sanitizeGpsLocations(raw)
      expect(sanitized.length).toBe(2)
    })
  })
})
