/**
 * src/services/fuelKmPaymentService.test.ts
 *
 * TESTES DE REGRESSÃO do MOTOR CANÔNICO de KM e PAGAMENTO DE COMBUSTÍVEL.
 *
 * Contexto: em 10/11/2026 o Rotaly pagou errado porque o cálculo lia campos que NÃO
 * existem na coleção `app_settings` (`consumption_kml` / `fuel_price`) em vez dos reais
 * (`moto_consumption_kml` / `moto_fuel_price`). O parâmetro gravado pelo Admin era
 * ignorado e o sistema caía no default do código (R$ 6,49 em vez de R$ 6,39).
 *
 * Estes testes travam as regras que não podem voltar a quebrar silenciosamente:
 *  1. Bicicleta é isenta (R$ 0,00) mesmo com km na rota.
 *  2. Desconto de 15% só vale a partir do corte de 26/10/2026, pela data do LOTE.
 *  3. Desvio de GPS nunca aumenta o pagamento (paga a rota planejada).
 *  4. Deduplicação por lote: uma volta à base por lote, não uma por pedido.
 *  5. Filtro de período: pedido de outro mês não entra no total.
 *  6. O valor final em R$ confere centavo a centavo.
 */

import { describe, it, expect } from 'vitest'
import { calculateFuelKmPayment } from '@/services/fuelKmPaymentService'
import type { OrderRecord } from '@/types/delivery'

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Pedido mínimo, com apenas os campos que o motor de pagamento realmente toca.
 * O tipo real tem dezenas de campos opcionais; o cast isola o teste do resto do schema.
 */
function makeOrder(over: Partial<OrderRecord> & Record<string, unknown> = {}): OrderRecord {
  return {
    id: 'ord_test',
    collectionId: 'orders_col',
    collectionName: 'orders',
    customer_id: 'cust_1',
    courier_id: 'courier_edson',
    status: 'delivered',
    tracking_code: 'TRK-TEST-001',
    created: '2026-11-05 10:00:00.000Z',
    route_started_at: '2026-11-05 09:00:00.000Z',
    route_finished_at: '2026-11-05 11:00:00.000Z',
    distance_km: 10,
    return_trip_km: 5,
    total_route_with_return_km: 15,
    route_batch_key: 'rb_courier_edson_20261105_540',
    ...over,
  } as unknown as OrderRecord
}

const MOTO = { vehicle_type: 'moto' as const }
const BICICLETA = { vehicle_type: 'bicicleta' as const }

// Datas de referência (fuso Brasília, -03:00)
const ANTES_DO_CORTE = new Date('2026-10-20T12:00:00-03:00') // 20/10 — sem desconto
const DEPOIS_DO_CORTE = new Date('2026-11-05T12:00:00-03:00') // 05/11 — com 15%

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bicicleta isenta
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — bicicleta é isenta', () => {
  it('paga R$ 0,00 mesmo com km na rota', () => {
    const r = calculateFuelKmPayment({
      orders: [makeOrder({ total_route_with_return_km: 42 })],
      courier: BICICLETA,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.isBicycle).toBe(true)
    expect(r.kmPagamento).toBe(0)
    expect(r.combustivelPagamento).toBe(0)
    expect(r.combustivelViarioOficial).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Corte de 26/10/2026 — quando o desconto de 15% passa a valer
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — corte do desconto de 15% (26/10/2026)', () => {
  it('ANTES do corte: paga 100% do km viário', () => {
    const r = calculateFuelKmPayment({
      orders: [
        makeOrder({
          id: 'ord_pre',
          created: '2026-10-20 10:00:00.000Z',
          route_started_at: '2026-10-20 09:00:00.000Z',
          route_finished_at: '2026-10-20 11:00:00.000Z',
          route_batch_key: 'rb_courier_edson_20261020_540',
          total_route_with_return_km: 20,
        }),
      ],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: ANTES_DO_CORTE,
      settings: null,
    })

    expect(r.kmViarioOficial).toBe(20)
    expect(r.kmPagamento).toBe(20) // sem corte
    expect(r.descontoKm).toBe(0)
  })

  it('DEPOIS do corte: paga 85% do km viário', () => {
    const r = calculateFuelKmPayment({
      orders: [makeOrder({ total_route_with_return_km: 20 })],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.kmViarioOficial).toBe(20)
    expect(r.kmPagamento).toBe(17) // 20 × 0,85
    expect(r.descontoKm).toBe(3)
  })

  it('o desconto vale pelo início do LOTE, não pela data que o filtro usou', () => {
    // Lote que começou antes do corte e terminou depois: pela regra, vale a data mais
    // antiga do lote (earliestCreatedTs), então NÃO sofre o desconto.
    const r = calculateFuelKmPayment({
      orders: [
        makeOrder({
          id: 'ord_virada',
          created: '2026-10-25 23:00:00.000Z',
          route_started_at: '2026-10-25 23:00:00.000Z',
          route_finished_at: '2026-10-26 02:00:00.000Z',
          route_batch_key: 'rb_courier_edson_20261025_1380',
          total_route_with_return_km: 10,
        }),
      ],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.kmPagamento).toBe(10) // 25/10 < 26/10 → sem desconto
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Desvio de GPS nunca aumenta o pagamento
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — paga a ROTA PLANEJADA, não o desvio', () => {
  it('gpsKm maior que o km planejado NÃO aumenta o pagamento', () => {
    // Regra confirmada pelo dono: desvio é responsabilidade do entregador.
    // Se alguém reintroduzir Math.max(km_viario, km_gps), este teste quebra.
    const r = calculateFuelKmPayment({
      batchInputs: [
        {
          order: makeOrder({ total_route_with_return_km: 20 }),
          batchKey: 'rb_courier_edson_20261105_540',
          roadKm: 20,
          gpsKm: 45, // desvio enorme
          dateRaw: '2026-11-05 10:00:00.000Z',
          canonicalBatchTelem: { km_viario_total: 20, km_gps_total: 45 },
        },
      ],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.kmViarioOficial).toBe(20)
    expect(r.kmPagamento).toBe(17) // 20 × 0,85 — o 45 do GPS é ignorado
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Deduplicação por lote
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — deduplicação por lote de rota', () => {
  it('3 pedidos do MESMO lote contam a volta à base UMA vez, não três', () => {
    // Sem deduplicação o km triplicaria e o entregador receberia por uma viagem
    // que ele fez uma vez. Era o caso "736,8 km em vez de ~130-150 km" já visto.
    const mesmoLote = 'rb_courier_edson_20261105_540'
    const orders = [
      makeOrder({ id: 'o1', route_batch_key: mesmoLote, total_route_with_return_km: 30 }),
      makeOrder({ id: 'o2', route_batch_key: mesmoLote, total_route_with_return_km: 30 }),
      makeOrder({ id: 'o3', route_batch_key: mesmoLote, total_route_with_return_km: 30 }),
    ]

    const r = calculateFuelKmPayment({
      orders,
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.batchesCount).toBe(1) // um lote
    expect(r.deliveriesCount).toBe(3) // três entregas
    expect(r.kmViarioOficial).toBe(30) // não 90
  })

  it('lotes diferentes somam normalmente', () => {
    const orders = [
      makeOrder({
        id: 'a1',
        route_batch_key: 'rb_courier_edson_20261105_540',
        total_route_with_return_km: 20,
      }),
      makeOrder({
        id: 'a2',
        route_batch_key: 'rb_courier_edson_20261105_900',
        total_route_with_return_km: 15,
      }),
    ]

    const r = calculateFuelKmPayment({
      orders,
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.batchesCount).toBe(2)
    expect(r.kmViarioOficial).toBe(35) // 20 + 15
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Filtro de período
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — filtro de período', () => {
  it('pedido de outubro não entra no total de novembro', () => {
    const orders = [
      makeOrder({
        id: 'nov',
        route_batch_key: 'rb_c_20261105_540',
        created: '2026-11-05 10:00:00.000Z',
        route_started_at: '2026-11-05 09:00:00.000Z',
        route_finished_at: '2026-11-05 11:00:00.000Z',
        total_route_with_return_km: 10,
      }),
      makeOrder({
        id: 'out',
        route_batch_key: 'rb_c_20261015_540',
        created: '2026-10-15 10:00:00.000Z',
        route_started_at: '2026-10-15 09:00:00.000Z',
        // dateRaw do motor = route_finished_at ?? created: precisa ser de outubro também,
        // senão o pedido herda a data do fixture e entra no mês errado.
        route_finished_at: '2026-10-15 11:00:00.000Z',
        total_route_with_return_km: 99,
      }),
    ]

    const r = calculateFuelKmPayment({
      orders,
      courier: MOTO,
      periodFilter: 'month',
      referenceDate: DEPOIS_DO_CORTE, // novembro
      settings: null,
    })

    expect(r.deliveriesCount).toBe(1) // só o de novembro
    expect(r.kmViarioOficial).toBe(10) // o de 99 km ficou fora
  })

  it('periodFilter "all" traz tudo', () => {
    const orders = [
      makeOrder({
        id: 'nov',
        route_batch_key: 'rb_c_20261105_540',
        route_started_at: '2026-11-05 09:00:00.000Z',
        route_finished_at: '2026-11-05 11:00:00.000Z',
        created: '2026-11-05 10:00:00.000Z',
        total_route_with_return_km: 10,
      }),
      makeOrder({
        id: 'out',
        route_batch_key: 'rb_c_20261015_540',
        route_started_at: '2026-10-15 09:00:00.000Z',
        route_finished_at: '2026-10-15 11:00:00.000Z',
        created: '2026-10-15 10:00:00.000Z',
        total_route_with_return_km: 10,
      }),
    ]

    const r = calculateFuelKmPayment({
      orders,
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.deliveriesCount).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. Cálculo final em reais — o número que o entregador recebe
// ─────────────────────────────────────────────────────────────────────────────

describe('calculateFuelKmPayment — o valor em R$ que sai para o entregador', () => {
  it('cenário completo: 17,20 km, 30 km/L e R$ 6,39 — confere centavo', () => {
    // Lote real do Edson (Duque de Caxias), base da auditoria de 10/11.
    const r = calculateFuelKmPayment({
      orders: [
        makeOrder({
          id: 'lote_edson',
          route_batch_key: 'rb_courier_edson_20261105_540',
          total_route_with_return_km: 17.2,
          route_started_at: '2026-11-05 09:00:00.000Z',
          created: '2026-11-05 09:00:00.000Z',
        }),
      ],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: { moto_consumption_kml: 30, moto_fuel_price: 6.39 },
    })

    expect(r.kmViarioOficial).toBe(17.2)
    expect(r.kmPagamento).toBe(14.6) // 17,2 × 0,85 = 14,62 → 14,6 (1 casa)
    // combustível = (14,6 / 30) × 6,39 = 3,1098 → R$ 3,11
    expect(r.combustivelPagamento).toBe(3.11)
    // viário cheio = (17,2 / 30) × 6,39 = 3,6636 → R$ 3,66
    expect(r.combustivelViarioOficial).toBe(3.66)
    expect(r.descontoCombustivel).toBe(0.55) // 3,66 - 3,11
  })

  it('mudar o preço do litro em app_settings muda o pagamento (parametrização viva)', () => {
    const base = {
      orders: [makeOrder({ total_route_with_return_km: 17.2 })],
      courier: MOTO,
      periodFilter: 'all' as const,
      referenceDate: DEPOIS_DO_CORTE,
    }

    const barato = calculateFuelKmPayment({
      ...base,
      settings: { moto_consumption_kml: 30, moto_fuel_price: 5.0 },
    })
    const caro = calculateFuelKmPayment({
      ...base,
      settings: { moto_consumption_kml: 30, moto_fuel_price: 7.0 },
    })

    // Se o parâmetro fosse ignorado (o bug de 10/11), os dois dariam o mesmo valor.
    expect(caro.combustivelPagamento).toBeGreaterThan(barato.combustivelPagamento)
    expect(barato.combustivelPagamento).toBe(2.43) // (14,6/30)×5,00 = 2,4333
    expect(caro.combustivelPagamento).toBe(3.41) // (14,6/30)×7,00 = 3,4066
  })

  it('lista vazia devolve zero, não NaN nem Infinity', () => {
    const r = calculateFuelKmPayment({
      orders: [],
      courier: MOTO,
      periodFilter: 'all',
      referenceDate: DEPOIS_DO_CORTE,
      settings: null,
    })

    expect(r.kmViarioOficial).toBe(0)
    expect(r.kmPagamento).toBe(0)
    expect(r.combustivelPagamento).toBe(0)
    expect(Number.isNaN(r.combustivelPagamento)).toBe(false)
  })
})
