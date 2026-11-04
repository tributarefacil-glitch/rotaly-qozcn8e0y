import { describe, it, expect } from 'vitest'
import {
  DEFAULT_DDD,
  normalizeCustomerPhone,
  normalizeWhatsAppPhone,
  buildTrackingWhatsAppText,
  buildTrackingWhatsAppUrl,
  formatEtaFromRealDuration,
} from './whatsappTracking'

// Referência fixa: 04/11/2026 14:00 no horário de Brasília (17:00 UTC)
const FIXED_FROM = new Date('2026-11-04T17:00:00.000Z')

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

  describe('formatEtaFromRealDuration', () => {
    it('deve retornar null quando não há duração real (ausente, 0, negativa ou inválida)', () => {
      expect(formatEtaFromRealDuration(undefined, FIXED_FROM)).toBeNull()
      expect(formatEtaFromRealDuration(null, FIXED_FROM)).toBeNull()
      expect(formatEtaFromRealDuration(0, FIXED_FROM)).toBeNull()
      expect(formatEtaFromRealDuration(-10, FIXED_FROM)).toBeNull()
      expect(formatEtaFromRealDuration(Number.NaN, FIXED_FROM)).toBeNull()
    })

    it('deve calcular "por volta das" somando a duração REAL ao momento do envio', () => {
      // 14:00 em Brasília + 30 min = 14:30
      expect(formatEtaFromRealDuration(30, FIXED_FROM)).toBe('14:30')
      // 14:00 + 90 min = 15:30
      expect(formatEtaFromRealDuration(90, FIXED_FROM)).toBe('15:30')
      // 14:00 + 8 min = 14:08
      expect(formatEtaFromRealDuration(8, FIXED_FROM)).toBe('14:08')
    })

    it('deve atravessar a virada do dia corretamente', () => {
      // 23:50 em Brasília (02:50 UTC do dia 05) + 20 min = 00:10 do dia seguinte
      const lateEvening = new Date('2026-11-05T02:50:00.000Z')
      expect(formatEtaFromRealDuration(20, lateEvening)).toBe('00:10')
    })
  })

  describe('buildTrackingWhatsAppText — regra de ETA (fonte da verdade é a página de rastreamento)', () => {
    it('NUNCA cita horário quando não há duração real de trânsito (pedido recém-criado, sem rota)', () => {
      const text = buildTrackingWhatsAppText({
        customerName: 'Gaby Silva',
        trackingCode: 'TRK-2026-04619274',
      })

      expect(text).toContain('Olá, Gaby!')
      expect(text).toContain('TRK-2026-04619274')
      expect(text).toContain('https://www.rotaly.com.br/track/TRK-2026-04619274')
      expect(text).toContain('previsão de chegada atualizada e o mapa ao vivo')
      expect(text).toContain('avaliar seu vendedor e seu entregador')

      // Nenhuma frase de horário fechado
      expect(text).not.toContain('Previsão estimada de entrega')
      expect(text).not.toContain('por volta das')
    })

    it('deve ignorar o estimated_arrival legado do placeholder (20+i*15) — nunca vira horário na mensagem', () => {
      // Simula exatamente o cenário do bug: estimated_arrival salvo pelo placeholder
      const text = buildTrackingWhatsAppText({
        customerName: 'Gaby Silva',
        trackingCode: 'TRK-2026-04619274',
        estimatedArrival: '2026-11-04T20:30:00.000Z', // 17:30 em Brasília
        includeEta: true,
      })

      expect(text).not.toContain('17:30')
      expect(text).not.toContain('Previsão estimada de entrega')
      expect(text).not.toContain('por volta das')
    })

    it('cita "por volta das X" SOMENTE quando há duração real de trânsito (rota liberada, Google)', () => {
      const text = buildTrackingWhatsAppText({
        customerName: 'Gaby Silva',
        trackingCode: 'TRK-2026-04619274',
        realTransitDurationMinutes: 45,
        estimatedArrival: '2026-11-04T20:30:00.000Z', // legado presente: ainda assim ignorado
      })

      // 14:00 + 45 min = 14:40? não: 14:45
      expect(text).toContain('Previsão de entrega: por volta das *14:45*.')
      expect(text).not.toContain('Previsão estimada de entrega')
      expect(text).not.toContain('17:30')
    })

    it('usa texto genérico (sem horário) quando a duração real é inválida mesmo com includeEta legado', () => {
      const text = buildTrackingWhatsAppText({
        customerName: 'Gaby',
        trackingCode: 'TRK-2026-04619274',
        realTransitDurationMinutes: 0,
        includeEta: true,
      })
      expect(text).not.toContain('por volta das')
      expect(text).toContain('previsão de chegada atualizada e o mapa ao vivo')
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

    it('não inclui horário na URL quando não há duração real', () => {
      const url = buildTrackingWhatsAppUrl('971344477', {
        customerName: 'Gaby',
        trackingCode: 'TRK-2026-04619274',
        estimatedArrival: '2026-11-04T20:30:00.000Z',
        includeEta: true,
      })
      expect(url).not.toBeNull()
      expect(url!).not.toContain(encodeURIComponent('por volta das'))
    })

    it('inclui "por volta das" na URL quando há duração real de trânsito', () => {
      const url = buildTrackingWhatsAppUrl('971344477', {
        customerName: 'Gaby',
        trackingCode: 'TRK-2026-04619274',
        realTransitDurationMinutes: 30,
      })
      expect(url).not.toBeNull()
      expect(url!).toContain(encodeURIComponent('por volta das *14:30*'))
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
