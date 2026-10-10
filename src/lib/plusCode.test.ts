import { describe, it, expect } from 'vitest'
import {
  encodePlusCode,
  isValidPlusCode,
  formatPlusCodeDisplay,
  getPlusCodeMapsUrl,
} from './plusCode'

describe('Plus Code (Open Location Code Google)', () => {
  it('gera Plus Code válido para coordenadas do Rio de Janeiro', () => {
    // Exemplo: Praça Mauá / Centro RJ (-22.897, -43.180)
    const code = encodePlusCode(-22.897, -43.18)
    expect(code).toBeDefined()
    expect(code.includes('+')).toBe(true)
    expect(isValidPlusCode(code)).toBe(true)
    expect(code.length).toBe(11) // 8 chars + '+' + 2 chars
  })

  it('gera Plus Code para coordenadas de Duque de Caxias (Pilar)', () => {
    // Duque de Caxias / Pilar (-22.7016928, -43.2937064)
    const code = encodePlusCode(-22.7016928, -43.2937064)
    expect(code).toBeDefined()
    expect(isValidPlusCode(code)).toBe(true)
    expect(code.startsWith('588P')).toBe(true)
  })

  it('retorna vazio se lat/lng forem inválidos ou zerados', () => {
    expect(encodePlusCode(0, 0)).toBe('')
    expect(encodePlusCode(NaN, -43.1)).toBe('')
  })

  it('valida formato e formatação de exibição com localidade', () => {
    const code = encodePlusCode(-22.7016928, -43.2937064)
    const display = formatPlusCodeDisplay(code, {
      neighborhood: 'Pilar',
      city: 'Duque de Caxias',
      state: 'RJ',
    })
    expect(display).toContain(code)
    expect(display).toContain('Pilar - Duque de Caxias - RJ')

    const mapsUrl = getPlusCodeMapsUrl(code)
    expect(mapsUrl).toContain('https://www.google.com/maps/search/?api=1&query=')
    expect(mapsUrl).toContain(encodeURIComponent(code))
  })
})
