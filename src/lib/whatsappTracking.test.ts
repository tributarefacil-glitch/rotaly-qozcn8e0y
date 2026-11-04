import { describe, it, expect } from 'vitest'
import {
  normalizeWhatsAppPhone,
  buildTrackingWhatsAppText,
  buildTrackingWhatsAppUrl,
} from './whatsappTracking'

describe('whatsappTracking', () => {
  it('normaliza telefones com DDD brasileiro corretamente', () => {
    expect(normalizeWhatsAppPhone('(21) 98765-4321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('21987654321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('2133334444')).toBe('552133334444')
    expect(normalizeWhatsAppPhone('5521987654321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('+55 (21) 98765-4321')).toBe('5521987654321')
    expect(normalizeWhatsAppPhone('12345')).toBeNull()
    expect(normalizeWhatsAppPhone('')).toBeNull()
    expect(normalizeWhatsAppPhone(null)).toBeNull()
  })

  it('monta mensagem com saudação, link de rastreamento e convite de avaliação', () => {
    const text = buildTrackingWhatsAppText({
      customerName: 'Maria Silva',
      trackingCode: 'TRK-2026-12345678',
    })

    expect(text).toContain('Olá, Maria!')
    expect(text).toContain('https://www.rotaly.com.br/track/TRK-2026-12345678')
    expect(text).toContain('tempo de chegada')
    expect(text).toContain('avaliar seu vendedor e seu entregador')
  })

  it('monta URL completa wa.me com texto url-encoded', () => {
    const url = buildTrackingWhatsAppUrl('(21) 98765-4321', {
      customerName: 'Carlos Santos',
      trackingCode: 'TRK-2026-99998888',
    })

    expect(url).not.toBeNull()
    expect(url).toMatch(/^https:\/\/wa\.me\/5521987654321\?text=/)
    expect(url).toContain(encodeURIComponent('https://www.rotaly.com.br/track/TRK-2026-99998888'))
    expect(url).toContain(encodeURIComponent('Olá, Carlos!'))
  })
})
