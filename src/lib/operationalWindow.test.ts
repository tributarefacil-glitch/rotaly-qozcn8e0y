import { describe, it, expect } from 'vitest'
import {
  getCivilDateKeyInTz,
  getCivilPartsInTz,
  getOperationalWindow,
  getCustomOperationalWindow,
  getYearMonthInTz,
  isAdvancePostCutoff,
  isBeforeCurrentMonthInTz,
  isCurrentMonthInTz,
  isOrderInPeriod,
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

  it('getCivilPartsInTz extrai dia e hora corretos no fuso de São Paulo', () => {
    // 2026-10-03 23:41 UTC = 2026-10-03 20:41 BRT (-3)
    const parts1 = getCivilPartsInTz('2026-10-03T23:41:00.000Z')
    expect(parts1.year).toBe(2026)
    expect(parts1.month).toBe(10)
    expect(parts1.day).toBe(3)
    expect(parts1.hour).toBe(20)
    expect(parts1.minute).toBe(41)

    // 2026-10-04 01:30 UTC = 2026-10-03 22:30 BRT (-3)
    const parts2 = getCivilPartsInTz('2026-10-04T01:30:00.000Z')
    expect(parts2.day).toBe(3)
    expect(parts2.hour).toBe(22)
  })

  it('entrega 03/10 20h41 BRT NÃO entra em "Hoje" quando referência é 04/10', () => {
    // Referência: 04/10 às 14:00 BRT (17:00 UTC)
    const refDate = new Date('2026-10-04T17:00:00.000Z')
    const opWindow = getOperationalWindow(refDate)

    expect(opWindow.dateStr).toBe('2026-10-04')
    // 04/10 05:00 BRT = 08:00 UTC
    expect(new Date(opWindow.start).toISOString()).toBe('2026-10-04T08:00:00.000Z')
    // 04/10 23:59:59.999 BRT = 05/10 02:59:59.999 UTC
    expect(new Date(opWindow.end).toISOString()).toBe('2026-10-05T02:59:59.999Z')

    // Entrega de 03/10 às 20h41 BRT = 23h41 UTC
    const deliveryTs = parseSafeTimestamp('2026-10-03 23:41:00.000Z')
    expect(deliveryTs >= opWindow.start && deliveryTs <= opWindow.end).toBe(false)
    expect(isOrderInPeriod('2026-10-03 23:41:00.000Z', 'today', refDate)).toBe(false)
  })

  it('entrega 03/10 23h59 BRT pertence a 03/10', () => {
    // 03/10 23:59 BRT = 04/10 02:59 UTC
    const deliveryStr = '2026-10-04T02:59:00.000Z'
    const deliveryTs = parseSafeTimestamp(deliveryStr)

    // Referência em 03/10 (ex: 21h BRT de 03/10 = 00h UTC de 04/10)
    const ref03 = new Date('2026-10-04T00:00:00.000Z')
    const opWindow03 = getOperationalWindow(ref03)
    expect(opWindow03.dateStr).toBe('2026-10-03')
    expect(deliveryTs >= opWindow03.start && deliveryTs <= opWindow03.end).toBe(true)
    expect(isOrderInPeriod(deliveryStr, 'today', ref03)).toBe(true)

    // Referência no ciclo de 04/10
    const ref04 = new Date('2026-10-04T15:00:00.000Z')
    expect(isOrderInPeriod(deliveryStr, 'today', ref04)).toBe(false)
  })

  it('entrega 04/10 00h01 BRT pertence ao ciclo de 03/10 (madrugada), a partir de 05h01 BRT pertence a 04/10', () => {
    // 04/10 00:01 BRT = 04/10 03:01 UTC
    const dawnOrderStr = '2026-10-04T03:01:00.000Z'
    // Se referência for a própria madrugada (04/10 00:01 BRT), a janela operacional ativa é do ciclo 03/10
    const refDawn = new Date('2026-10-04T03:01:00.000Z')
    const opWindowDawn = getOperationalWindow(refDawn)
    expect(opWindowDawn.dateStr).toBe('2026-10-03')

    // 04/10 05:01 BRT = 04/10 08:01 UTC
    const morningOrderStr = '2026-10-04T08:01:00.000Z'
    const morningTs = parseSafeTimestamp(morningOrderStr)

    // Referência em 04/10 às 09:00 BRT (12:00 UTC)
    const refMorning = new Date('2026-10-04T12:00:00.000Z')
    const opWindowMorning = getOperationalWindow(refMorning)
    expect(opWindowMorning.dateStr).toBe('2026-10-04')
    expect(morningTs >= opWindowMorning.start && morningTs <= opWindowMorning.end).toBe(true)
    expect(isOrderInPeriod(morningOrderStr, 'today', refMorning)).toBe(true)

    // Madrugada 04/10 00h01 BRT não cai no ciclo operacional iniciado às 05h de 04/10
    const dawnTs = parseSafeTimestamp(dawnOrderStr)
    expect(dawnTs >= opWindowMorning.start && dawnTs <= opWindowMorning.end).toBe(false)
    expect(isOrderInPeriod(dawnOrderStr, 'today', refMorning)).toBe(false)
  })

  it('"week" inclui os últimos 7 ciclos operacionais sem descartar por offset UTC', () => {
    // Referência: 04/10 14h BRT
    const refDate = new Date('2026-10-04T17:00:00.000Z')
    const opWindow = getOperationalWindow(refDate)
    const sevenCyclesStart = opWindow.start - 6 * 24 * 60 * 60 * 1000

    // Entrega de 03/10 às 20h41 BRT = 23h41 UTC -> DEVE entrar em week
    const delivery03Ts = parseSafeTimestamp('2026-10-03 23:41:00.000Z')
    expect(delivery03Ts >= sevenCyclesStart).toBe(true)
    expect(isOrderInPeriod('2026-10-03 23:41:00.000Z', 'week', refDate)).toBe(true)

    // Entrega de 7 dias operacionais atrás (28/09 às 10h BRT = 13h UTC) -> entra
    expect(isOrderInPeriod('2026-09-28 13:00:00.000Z', 'week', refDate)).toBe(true)

    // Entrega de 8 dias atrás (27/09 às 04h BRT = 07h UTC) -> fora
    expect(isOrderInPeriod('2026-09-27 07:00:00.000Z', 'week', refDate)).toBe(false)
  })

  it('getCivilDateKeyInTz e isAdvancePostCutoff comparam dia civil sem desvio de UTC', () => {
    // Caso 1: string pura date-only
    expect(getCivilDateKeyInTz('2026-10-04')).toBe('2026-10-04')
    // Caso 2: date com hora 00:00:00.000Z não recua para o dia 03 no Brasil
    expect(getCivilDateKeyInTz('2026-10-04 00:00:00.000Z')).toBe('2026-10-04')
    expect(getCivilDateKeyInTz('2026-10-04T00:00:00.000Z')).toBe('2026-10-04')

    // Caso 3: cutoff de 2026-10-04 01:00:00.000Z -> em SP é 2026-10-03 (22h de 03/10)
    // O adiantamento de 2026-10-04 00:00:00.000Z (Guilherme R$ 200) tem dia civil 2026-10-04.
    // Como 2026-10-04 >= 2026-10-03, é estritamente pós-corte!
    expect(isAdvancePostCutoff('2026-10-04 00:00:00.000Z', '2026-10-04 01:00:00.000Z')).toBe(true)
    // Mesmo se cutoff fosse interpretado como 2026-10-04:
    expect(isAdvancePostCutoff('2026-10-04 00:00:00.000Z', '2026-10-04 00:00:00.000Z')).toBe(true)

    // Adiantamento de 03/10 anterior a cutoff de 04/10
    expect(isAdvancePostCutoff('2026-10-03 00:00:00.000Z', '2026-10-04 05:00:00.000Z')).toBe(false)
  })

  it('getCustomOperationalWindow gera intervalo correto 05:00 a 23:59:59.999 no fuso de Brasília', () => {
    const customWin = getCustomOperationalWindow('2026-10-01', '2026-10-05')
    expect(customWin).not.toBeNull()
    if (!customWin) return

    // Início: 2026-10-01 05:00:00.000 BRT = 2026-10-01 08:00:00.000 UTC
    expect(new Date(customWin.start).toISOString()).toBe('2026-10-01T08:00:00.000Z')
    // Fim: 2026-10-05 23:59:59.999 BRT = 2026-10-06 02:59:59.999 UTC
    expect(new Date(customWin.end).toISOString()).toBe('2026-10-06T02:59:59.999Z')

    // Data inválida (início > fim)
    expect(getCustomOperationalWindow('2026-10-05', '2026-10-01')).toBeNull()
    // Formato incorreto
    expect(getCustomOperationalWindow('invalid', '2026-10-01')).toBeNull()
  })
})
