import { describe, it, expect } from 'vitest'
import {
  getYearMonthInTz,
  isCurrentMonthInTz,
  isBeforeCurrentMonthInTz,
  parseSafeTimestamp,
} from './operationalWindow'

describe('operationalWindow (fuso America/Sao_Paulo)', () => {
  it('parseSafeTimestamp interpreta timestamp sem fuso como UTC', () => {
    // "2026-10-01 12:00:00.000Z" — com Z explícito
    expect(parseSafeTimestamp('2026-10-01 12:00:00.000Z')).toBe(
      new Date('2026-10-01T12:00:00.000Z').getTime(),
    )
    // Sem indicador de fuso: assume UTC
    expect(parseSafeTimestamp('2026-10-01 12:00:00.000')).toBe(
      new Date('2026-10-01T12:00:00.000Z').getTime(),
    )
  })

  it('getYearMonthInTz converte UTC para America/Sao_Paulo corretamente', () => {
    // 2026-10-01 03:00 UTC = 2026-10-01 00:00 em São Paulo -> outubro
    const { year, month } = getYearMonthInTz('2026-10-01 03:00:00.000Z')
    expect(year).toBe(2026)
    expect(month).toBe(10)
    // 2026-10-01 02:00 UTC = 2026-09-30 23:00 em São Paulo -> setembro
    const sep = getYearMonthInTz('2026-10-01 02:00:00.000Z')
    expect(sep.month).toBe(9)
  })

  it('isCurrentMonthInTz aceita referência explícita (fuso SP)', () => {
    const ref = new Date('2026-10-15T12:00:00.000Z')
    expect(isCurrentMonthInTz('2026-10-01 03:00:00.000Z', ref)).toBe(true)
    expect(isCurrentMonthInTz('2026-09-30 12:00:00.000Z', ref)).toBe(false)
  })

  it('isBeforeCurrentMonthInTz separa adiantamentos/pedidos de meses anteriores', () => {
    const ref = new Date('2026-10-15T12:00:00.000Z')
    expect(isBeforeCurrentMonthInTz('2026-09-11 00:00:00.000Z', ref)).toBe(true)
    expect(isBeforeCurrentMonthInTz('2026-10-01 03:00:00.000Z', ref)).toBe(false)
  })
})
