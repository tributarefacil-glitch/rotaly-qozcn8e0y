import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DDD,
  normalizeCustomerPhone,
  normalizeWhatsAppPhone,
  buildTrackingWhatsAppText,
  buildTrackingWhatsAppUrl,
} from './whatsappTracking'

describe('whatsappTracking', () => {
  describe('DEFAULT_DDD', () => {
    it('deve ser 21 (todos os clientes são do RJ)', () => {
      expect(DEFAULT_DDD).toBe('21')
    })
  })

  describe('normalizeWhatsAppPhone', () => {
    it('deve retornar null para telefone vazio, nulo ou indefinido', () => {
      expect(normalizeWhatsAppPhone(null)).toBeNull()
      expect(normalizeWhatsAppPhone(undefined)).toBeNull()
      expect(normalizeWhatsAppPhone('')).toBeNull()
      expect(normalizeWhatsAppPhone('   ')).toBeNull()
      expect(normalizeWhatsAppPhone('---')).toBeNull()
    })

    it('deve antepor DDD 21 para números de 9 dígitos sem DDD (celular RJ)', () => {
      // Exemplo real do cliente GABY (971344477)
      expect(normalizeWhatsAppPhone('971344477')).toBe('5521971344477')
      expect(normalizeWhatsAppPhone('97134-4477')).toBe('5521971344477')
      expect(normalizeWhatsAppPhone('98765-4321')).toBe('5521987654321')
    })

    it('deve antepor DDD 21 para números de 8 dígitos sem DDD (fixo RJ)', () => {
      expect(normalizeWhatsAppPhone('26761499')).toBe('552126761499')
      expect(normalizeWhatsAppPhone('2676-1499')).toBe('552126761499')
    })

    it('deve remover 0 inicial de DDD antigo (021)', () => {
      expect(normalizeWhatsAppPhone('021987654321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('(021) 98765-4321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('02126761499')).toBe('552126761499')
    })

    it('deve aceitar número com DDD completo (10 ou 11 dígitos) sem alteração indevida', () => {
      expect(normalizeWhatsAppPhone('21987654321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('(21) 98765-4321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('(11) 98765-4321')).toBe('5511987654321')
      expect(normalizeWhatsAppPhone('22999364910')).toBe('5522999364910')
    })

    it('deve aceitar número que já começa com código 55', () => {
      expect(normalizeWhatsAppPhone('5521987654321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('+55 (21) 98765-4321')).toBe('5521987654321')
      expect(normalizeWhatsAppPhone('55021987654321')).toBe('5521987654321')
    })

    it('deve retornar null para números curtos inválidos (< 8 dígitos)', () => {
      expect(normalizeWhatsAppPhone('12345')).toBeNull()
      expect(normalizeWhatsAppPhone('123')).toBeNull()
    })
  })

  describe('normalizeCustomerPhone', () => {
    it('deve retornar string vazia para valores vazios/nulos', () => {
      expect(normalizeCustomerPhone('')).toBe('')
      expect(normalizeCustomerPhone(null)).toBe('')
      expect(normalizeCustomerPhone(undefined)).toBe('')
      expect(normalizeCustomerPhone('   ')).toBe('')
    })

    it('deve antepor DDD 21 para números de 8 ou 9 dígitos sem DDD', () => {
      expect(normalizeCustomerPhone('971344477')).toBe('21971344477')
      expect(normalizeCustomerPhone('97134-4477')).toBe('21971344477')
      expect(normalizeCustomerPhone('26761499')).toBe('2126761499')
    })

    it('deve remover 0 inicial de 021', () => {
      expect(normalizeCustomerPhone('021971344477')).toBe('21971344477')
      expect(normalizeCustomerPhone('(021) 97134-4477')).toBe('21971344477')
    })

    it('deve remover 55 de números com 12 ou 13 dígitos para padrão nacional', () => {
      expect(normalizeCustomerPhone('5521971344477')).toBe('21971344477')
    })

    it('deve manter números com DDD 10 ou 11 dígitos limpos', () => {
      expect(normalizeCustomerPhone('(21) 97134-4477')).toBe('21971344477')
      expect(normalizeCustomerPhone('(11) 98765-4321')).toBe('11987654321')
    })
  })

  describe('buildTrackingWhatsAppText', () => {
    it('deve gerar texto com saudação, primeiro nome e link público', () => {
      const text = buildTrackingWhatsAppText({
        customerName: 'Gaby Silva',
        trackingCode: 'TRK-2026-04619274',
      })

      expect(text).toContain('Olá, Gaby!')
      expect(text).toContain('TRK-2026-04619274')
      expect(text).toContain('https://www.rotaly.com.br/track/TRK-2026-04619274')
      expect(text).toContain('tempo de chegada')
      expect(text).toContain('avaliar seu vendedor e seu entregador')
    })

    it('deve usar fallback "Cliente" quando não houver nome', () => {
      const text = buildTrackingWhatsAppText({
        trackingCode: 'TRK-2026-04619274',
      })
      expect(text).toContain('Olá, Cliente!')
    })
  })

  describe('buildTrackingWhatsAppUrl', () => {
    it('deve gerar url wa.me completa para número sem DDD aplicando 21', () => {
      const url = buildTrackingWhatsAppUrl('971344477', {
        customerName: 'Gaby',
        trackingCode: 'TRK-2026-04619274',
      })
      expect(url).not.toBeNull()
      expect(url).toContain('https://wa.me/5521971344477?text=')
      expect(url).toContain(encodeURIComponent('https://www.rotaly.com.br/track/TRK-2026-04619274'))
    })

    it('deve retornar null se telefone for vazio', () => {
      const url = buildTrackingWhatsAppUrl('', {
        customerName: 'Gaby',
        trackingCode: 'TRK-2026-04619274',
      })
      expect(url).toBeNull()
    })
  })
})
