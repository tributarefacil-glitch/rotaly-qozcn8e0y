import { describe, it, expect } from 'vitest'
import { calculateCourierFuelMetrics } from './useCourierFuelMetrics'
import { fuelAccountService } from '@/services/fuelAccountService'
import type { UserRecord, OrderRecord, FuelAdvanceRecord } from '@/types/delivery'

describe('calculateCourierFuelMetrics - anti-recursão pós-corte e cálculo de saldos', () => {
  const cutoffStr = '2026-10-04 01:00:00.000Z'

  const mockGuilherme = {
    id: 'u6zr2qtcos1ljxd',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'GUILHERME DE PAIVA',
    email: 'guilherme@loghype.com',
    role: 'courier',
    vehicle_type: 'moto',
    opening_balance: 22.1,
    cutoff_date: cutoffStr,
    created: '2026-09-11 00:53:28.356Z',
    updated: '2026-10-04 13:04:07.128Z',
  } as unknown as UserRecord

  const mockVinicios = {
    id: 'o9nccdbkmc9onh0',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'VINICIOS LUNZ',
    email: 'vinicios@loghype.com',
    role: 'courier',
    vehicle_type: 'moto',
    opening_balance: 82.03,
    cutoff_date: cutoffStr,
    created: '2026-09-11 00:56:38.292Z',
    updated: '2026-10-04 01:18:43.421Z',
  } as unknown as UserRecord

  const mockLuis = {
    id: 'szy04j9cn3pra5j',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'Luis Antonio',
    email: 'luisalcantaraa5@gmail.com',
    role: 'courier',
    vehicle_type: 'carro',
    opening_balance: 102.54,
    cutoff_date: cutoffStr,
    created: '2026-09-10 16:53:07.775Z',
    updated: '2026-10-04 00:55:43.267Z',
  } as unknown as UserRecord

  const mockDiogo = {
    id: 'gr2hb4yyno4lqns',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'DIOGO MENDES',
    email: 'pimentaverdecentro@gmail.com',
    role: 'courier',
    vehicle_type: 'carro',
    opening_balance: 66.71,
    cutoff_date: cutoffStr,
    created: '2026-09-10 16:27:11.192Z',
    updated: '2026-10-04 00:55:43.266Z',
  } as unknown as UserRecord

  const mockEdson = {
    id: 'tetrfu5oi19jbwz',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'EDSON PEREIRA DA SILVA JUNIOR',
    email: 'edson@rotaly.com',
    role: 'courier',
    vehicle_type: 'moto',
    opening_balance: 0,
    cutoff_date: cutoffStr,
    created: '2026-10-03 12:15:59.462Z',
    updated: '2026-10-04 00:55:43.344Z',
  } as unknown as UserRecord

  const mockMarcos = {
    id: 'mxvhhwb5i46zjq2',
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    name: 'Marcos Fernando Barbosa',
    email: 'marcos@rotary.com',
    role: 'courier',
    vehicle_type: 'bicicleta',
    opening_balance: 0,
    cutoff_date: cutoffStr,
    created: '2026-09-11 15:08:46.804Z',
    updated: '2026-10-04 00:55:43.343Z',
  } as unknown as UserRecord

  // Adiantamento de R$ 200,00 para Guilherme em 04/10 às 12:09 UTC (pós-corte)
  const mockAdvanceGuilherme = {
    id: 'n8c3i0yl4fhu6fr',
    collectionId: 'pbc_3916687976',
    collectionName: 'fuel_advances',
    courier_id: mockGuilherme.id,
    amount: 200,
    entry_type: 'advance',
    status: 'active',
    payment_method: 'pix',
    date: '2026-10-04 00:00:00.000Z',
    created: '2026-10-04 12:09:58.453Z',
    updated: '2026-10-04 12:09:58.453Z',
  } as unknown as FuelAdvanceRecord

  // Pedidos pós-corte do Guilherme (4 entregas realizadas em 04/10)
  // Lote 1 (2 pedidos, rota de 2.3 km total):
  const order1 = {
    id: 'guj1yi2iawau9al',
    collectionId: 'pbc_3527180448',
    collectionName: 'orders',
    customer_id: 'cust_1',
    tracking_code: 'TRK-2026-79441078',
    courier_id: mockGuilherme.id,
    status: 'delivered',
    start_base_lat: -22.6990563,
    start_base_lng: -43.296723,
    start_base_name: 'Mais Saudavel',
    distance_km: 1.02,
    return_trip_km: 1.02,
    total_route_with_return_km: 2.3,
    route_started_at: '2026-10-04 11:31:25.412Z',
    route_finished_at: '2026-10-04 11:47:58.227Z',
    created: '2026-10-04 10:57:33.562Z',
  } as unknown as OrderRecord

  const order2 = {
    id: 'vtxkrq0i0gphea4',
    collectionId: 'pbc_3527180448',
    collectionName: 'orders',
    customer_id: 'cust_2',
    tracking_code: 'TRK-2026-71816515',
    courier_id: mockGuilherme.id,
    status: 'delivered',
    start_base_lat: -22.6990563,
    start_base_lng: -43.296723,
    start_base_name: 'Mais Saudavel',
    distance_km: 0.14,
    return_trip_km: 0.14,
    total_route_with_return_km: 2.3,
    route_started_at: '2026-10-04 11:31:25.412Z',
    route_finished_at: '2026-10-04 11:47:58.227Z',
    created: '2026-10-04 11:25:02.806Z',
  } as unknown as OrderRecord

  // Lote 2 (1 pedido, rota 1.6 km):
  const order3 = {
    id: 'xgdloqk9goh5u8c',
    collectionId: 'pbc_3527180448',
    collectionName: 'orders',
    customer_id: 'cust_3',
    tracking_code: 'TRK-2026-99518678',
    courier_id: mockGuilherme.id,
    status: 'delivered',
    start_base_lat: -22.6990563,
    start_base_lng: -43.296723,
    start_base_name: 'Mais Saudavel',
    distance_km: 0.82,
    return_trip_km: 0.82,
    total_route_with_return_km: 1.6,
    route_started_at: '2026-10-04 12:25:21.543Z',
    route_finished_at: '2026-10-04 12:28:39.266Z',
    created: '2026-10-04 12:14:45.584Z',
  } as unknown as OrderRecord

  // Lote 3 (1 pedido, rota 1.2 km):
  const order4 = {
    id: 'j5hhx7i2kf8vvgh',
    collectionId: 'pbc_3527180448',
    collectionName: 'orders',
    customer_id: 'cust_4',
    tracking_code: 'TRK-2026-15041870',
    courier_id: mockGuilherme.id,
    status: 'delivered',
    start_base_lat: -22.6990563,
    start_base_lng: -43.296723,
    start_base_name: 'Mais Saudavel',
    distance_km: 0.59,
    return_trip_km: 0.59,
    total_route_with_return_km: 1.2,
    route_started_at: '2026-10-04 12:57:53.812Z',
    route_finished_at: '2026-10-04 13:04:06.465Z',
    created: '2026-10-04 12:46:07.143Z',
  } as unknown as OrderRecord

  const guilhermeOrders = [order1, order2, order3, order4]
  const mockSettings = {
    motorcycle_fuel_consumption: 40,
    car_fuel_consumption: 10,
    fuel_price: 6.09,
  }

  it('não deve estourar a pilha (Maximum call stack size exceeded) ao calcular métricas com cutoff e pedidos pós-corte', () => {
    // Esse teste falhava com "Maximum call stack size exceeded" antes do fix
    expect(() => {
      calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances: [mockAdvanceGuilherme],
        orders: guilhermeOrders,
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
      })
    }).not.toThrow()
  })

  it('deve calcular o saldo de Guilherme exatamente em R$ 220,99 em QUALQUER filtro de período', () => {
    const periods: Array<'all' | 'month' | 'week' | 'today'> = ['all', 'month', 'week', 'today']

    for (const p of periods) {
      const res = calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances: [mockAdvanceGuilherme],
        orders: guilhermeOrders,
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: p,
      })

      // Abertura R$ 22,10 + Adiantamento R$ 200,00 = R$ 222,10
      // Gasto pós-corte: 5.1 km @ 40 km/L @ R$ 6.09 = R$ 1,11 (2.3km=0.50 + 1.6km=0.35 + 1.2km=0.26 = 1.11)
      // Saldo = 222.10 - 1.11 = 220.99
      expect(res.balance).toBe(220.99)
      expect(res.advanceCount).toBe(1)
      expect(res.totalAdvances).toBe(200)

      // Testando também via fuelAccountService
      const acc = fuelAccountService.calculateAccountForCourier({
        courier: mockGuilherme,
        advances: [mockAdvanceGuilherme],
        orders: guilhermeOrders,
        settings: mockSettings,
        periodFilter: p,
      })
      expect(acc.balance).toBe(220.99)
      expect(acc.advanceCount).toBe(1)
      expect(acc.totalAdvances).toBe(200)
    }
  })

  it('deve calcular o saldo de Vinicios em R$ 82,03 sem adiantamentos pós-corte', () => {
    const res = calculateCourierFuelMetrics({
      courier: mockVinicios,
      advances: [],
      orders: [],
      locations: [],
      offRouteEvents: [],
      settings: mockSettings,
      periodFilter: 'all',
    })
    expect(res.balance).toBe(82.03)
    expect(res.advanceCount).toBe(0)
    expect(res.totalAdvances).toBe(0)

    const acc = fuelAccountService.calculateAccountForCourier({
      courier: mockVinicios,
      advances: [],
      orders: [],
      settings: mockSettings,
      periodFilter: 'week',
    })
    expect(acc.balance).toBe(82.03)
  })

  it('deve calcular os saldos dos demais entregadores (Luis R$ 102,54, Diogo R$ 66,71, Edson R$ 0,00, Marcos R$ 0,00)', () => {
    const couriersWithExpected = [
      { courier: mockLuis, expectedBalance: 102.54 },
      { courier: mockDiogo, expectedBalance: 66.71 },
      { courier: mockEdson, expectedBalance: 0 },
      { courier: mockMarcos, expectedBalance: 0 },
    ]

    for (const { courier, expectedBalance } of couriersWithExpected) {
      const res = calculateCourierFuelMetrics({
        courier,
        advances: [],
        orders: [],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
      })
      expect(res.balance).toBe(expectedBalance)

      const acc = fuelAccountService.calculateAccountForCourier({
        courier,
        advances: [],
        orders: [],
        settings: mockSettings,
        periodFilter: 'today',
      })
      expect(acc.balance).toBe(expectedBalance)
    }
  })
})
