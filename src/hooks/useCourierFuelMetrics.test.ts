import { describe, it, expect } from 'vitest'
import { calculateCourierFuelMetrics } from './useCourierFuelMetrics'
import { fuelAccountService } from '@/services/fuelAccountService'
import { calculateCanonicalCourierTotals } from '@/services/canonicalCourierTotalsService'
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
    opening_balance: 67.62,
    cutoff_date: cutoffStr,
    created: '2026-09-11 00:56:38.292Z',
    updated: '2026-10-05 02:37:00.000Z',
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
    start_base_lat: -22.6977499,
    start_base_lng: -43.2936013,
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
    start_base_lat: -22.6977499,
    start_base_lng: -43.2936013,
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
    start_base_lat: -22.6977499,
    start_base_lng: -43.2936013,
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
    start_base_lat: -22.6977499,
    start_base_lng: -43.2936013,
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
        advances: [
          mockAdvanceGuilherme,
          // Lançamento com balance_adjustment que deve ser EXCLUÍDO de totalAdvances (Regra 1a)
          {
            id: 'mock_adj_guilherme',
            courier_id: mockGuilherme.id,
            amount: 188.45,
            entry_type: 'balance_adjustment',
            status: 'active',
            date: '2026-10-05 00:00:00.000Z',
            created: '2026-10-05 10:00:00.000Z',
          } as unknown as FuelAdvanceRecord,
        ],
        orders: guilhermeOrders,
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: p,
      })

      // Abertura R$ 22,10 + Adiantamento R$ 200,00 = R$ 222,10
      // Gasto pós-corte: 5.1 km @ 40 km/L @ R$ 6.09 = R$ 1,11 (2.3km=0.50 + 1.6km=0.35 + 1.2km=0.26 = 1.11)
      // Saldo = 222.10 - 1.11 = 220.99 (balance_adjustment excluído)
      expect(res.balance).toBe(220.99)
      expect(res.advanceCount).toBe(1)
      expect(res.totalAdvances).toBe(200)

      // Testando também via fuelAccountService
      const acc = fuelAccountService.calculateAccountForCourier({
        courier: mockGuilherme,
        advances: [
          mockAdvanceGuilherme,
          {
            id: 'mock_adj_guilherme',
            courier_id: mockGuilherme.id,
            amount: 188.45,
            entry_type: 'balance_adjustment',
            status: 'active',
            date: '2026-10-05 00:00:00.000Z',
            created: '2026-10-05 10:00:00.000Z',
          } as unknown as FuelAdvanceRecord,
        ],
        orders: guilhermeOrders,
        settings: mockSettings,
        periodFilter: p,
      })
      expect(acc.balance).toBe(220.99)
      expect(acc.advanceCount).toBe(1)
      expect(acc.totalAdvances).toBe(200)
    }
  })

  it('deve calcular o saldo de Vinicios em R$ 67,62 sem adiantamentos pós-corte', () => {
    const res = calculateCourierFuelMetrics({
      courier: mockVinicios,
      advances: [],
      orders: [],
      locations: [],
      offRouteEvents: [],
      settings: mockSettings,
      periodFilter: 'all',
    })
    expect(res.balance).toBe(67.62)
    expect(res.advanceCount).toBe(0)
    expect(res.totalAdvances).toBe(0)

    const acc = fuelAccountService.calculateAccountForCourier({
      courier: mockVinicios,
      advances: [],
      orders: [],
      settings: mockSettings,
      periodFilter: 'week',
    })
    expect(acc.balance).toBe(67.62)
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

  describe('Deduplicação por lote viário (route_batch_key / entrega conjunta / aprovação de trecho)', () => {
    it('deve deduplicar km por lote agrupado: Guilherme 08/10 ~130–150 km e R$ ~28–32 (não 736,8 km nem R$ 159,39)', () => {
      // Simulação fiel do dia 08/10 do Guilherme:
      // Uma rota de lote com múltiplos pedidos que compartilham route_started_at / route_finished_at
      // No modelo sem dedup (soma ingênua), o total da rota (ex: 28 km) se multiplicava pelo número de pedidos (ex: 5 pedidos -> 140 km para um só lote, totalizando 736,8 km).
      // Com dedup por lote, o total da rota viária do dia fica exatamente no trajeto viário percorrido (~138 km) e combustível ~R$ 21.05.
      const batch1Started = '2026-10-08 10:00:00.000Z'
      const batch1Finished = '2026-10-08 11:30:00.000Z'
      const batch2Started = '2026-10-08 13:00:00.000Z'
      const batch2Finished = '2026-10-08 14:45:00.000Z'
      const batch3Started = '2026-10-08 16:00:00.000Z'
      const batch3Finished = '2026-10-08 18:00:00.000Z'

      // Lote 1: Rota real com 40.5 km dividida entre 4 entregas
      const batch1Orders: OrderRecord[] = [1, 2, 3, 4].map(
        (idx) =>
          ({
            id: `batch1_order_${idx}`,
            collectionId: 'pbc_3527180448',
            collectionName: 'orders',
            customer_id: `cust_b1_${idx}`,
            tracking_code: `TRK-2026-0810-1${idx}`,
            courier_id: mockGuilherme.id,
            status: 'delivered',
            distance_km: 8.0,
            return_trip_km: 8.5,
            total_route_with_return_km: 40.5, // gravado no lote para cada pedido
            route_started_at: batch1Started,
            route_finished_at: batch1Finished,
            created: '2026-10-08 09:30:00.000Z',
          }) as unknown as OrderRecord,
      )

      // Lote 2: Rota real com 48.0 km dividida entre 5 entregas
      const batch2Orders: OrderRecord[] = [1, 2, 3, 4, 5].map(
        (idx) =>
          ({
            id: `batch2_order_${idx}`,
            collectionId: 'pbc_3527180448',
            collectionName: 'orders',
            customer_id: `cust_b2_${idx}`,
            tracking_code: `TRK-2026-0810-2${idx}`,
            courier_id: mockGuilherme.id,
            status: 'delivered',
            distance_km: 7.2,
            return_trip_km: 12.0,
            total_route_with_return_km: 48.0,
            route_started_at: batch2Started,
            route_finished_at: batch2Finished,
            created: '2026-10-08 12:30:00.000Z',
          }) as unknown as OrderRecord,
      )

      // Lote 3: Rota real com 49.5 km dividida entre 5 entregas
      const batch3Orders: OrderRecord[] = [1, 2, 3, 4, 5].map(
        (idx) =>
          ({
            id: `batch3_order_${idx}`,
            collectionId: 'pbc_3527180448',
            collectionName: 'orders',
            customer_id: `cust_b3_${idx}`,
            tracking_code: `TRK-2026-0810-3${idx}`,
            courier_id: mockGuilherme.id,
            status: 'delivered',
            distance_km: 6.5,
            return_trip_km: 17.0,
            total_route_with_return_km: 49.5,
            route_started_at: batch3Started,
            route_finished_at: batch3Finished,
            created: '2026-10-08 15:30:00.000Z',
          }) as unknown as OrderRecord,
      )

      const allOct8Orders = [...batch1Orders, ...batch2Orders, ...batch3Orders]

      // Soma ingênua sem dedup seria:
      // (4 * 40.5) + (5 * 48.0) + (5 * 49.5) = 162 + 240 + 247.5 = 649.5 km
      // Com dedup por lote, a soma deve ser exatamente:
      // 40.5 + 48.0 + 49.5 = 138.0 km (~130–150 km)
      // Gasto de combustível esperado: 138 km / 40 km/L * 6.09 = R$ 21,01 (~R$ 21–32)
      const metrics = calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances: [mockAdvanceGuilherme],
        orders: allOct8Orders,
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
      })

      expect(metrics.totalOfficialKm).toBeGreaterThanOrEqual(130)
      expect(metrics.totalOfficialKm).toBeLessThanOrEqual(150)
      expect(metrics.totalOfficialKm).toBe(138.0)
      expect(metrics.totalOfficialKm).not.toBe(649.5)

      expect(metrics.totalSpent).toBeGreaterThanOrEqual(20)
      expect(metrics.totalSpent).toBeLessThanOrEqual(32)
      expect(metrics.totalSpent).not.toBe(159.39)

      // Também pelo fuelAccountService
      const acc = fuelAccountService.calculateAccountForCourier({
        courier: mockGuilherme,
        advances: [mockAdvanceGuilherme],
        orders: allOct8Orders,
        settings: mockSettings,
        periodFilter: 'all',
      })
      expect(acc.totalRouteKm).toBe(138.0)
      expect(acc.totalSpent).toBeGreaterThanOrEqual(20)
      expect(acc.totalSpent).toBeLessThanOrEqual(32)
    })

    it('deve auto-aprovar e deduplicar entrega conjunta com janela <= 45 min', () => {
      // 2 pedidos entregues no mesmo endereço / cliente dentro da janela de 45 min
      const orderA: OrderRecord = {
        id: 'joint_order_A',
        collectionId: 'pbc_3527180448',
        collectionName: 'orders',
        customer_id: 'cust_joint_same',
        tracking_code: 'TRK-JOINT-A',
        courier_id: mockGuilherme.id,
        status: 'delivered',
        distance_km: 5.0,
        return_trip_km: 5.0,
        total_route_with_return_km: 10.0,
        route_started_at: '2026-10-09 10:00:00.000Z',
        route_finished_at: '2026-10-09 10:20:00.000Z',
        created: '2026-10-09 09:30:00.000Z',
      } as unknown as OrderRecord

      const orderB: OrderRecord = {
        id: 'joint_order_B',
        collectionId: 'pbc_3527180448',
        collectionName: 'orders',
        customer_id: 'cust_joint_same',
        tracking_code: 'TRK-JOINT-B',
        courier_id: mockGuilherme.id,
        status: 'delivered',
        distance_km: 5.0,
        return_trip_km: 5.0,
        total_route_with_return_km: 10.0,
        route_started_at: '2026-10-09 10:00:00.000Z',
        route_finished_at: '2026-10-09 10:20:00.000Z',
        created: '2026-10-09 09:35:00.000Z',
      } as unknown as OrderRecord

      const res = calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances: [],
        orders: [orderA, orderB],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
      })

      // Dedup de lote mantém km único de 10.0 km
      expect(res.totalOfficialKm).toBe(10.0)
      expect(res.totalSpent).toBe(1.52) // 10 km @ 40 km/l @ 6.09 = 1.52
    })

    it('deve respeitar aprovação de trecho via route_km_approvals / approvalsMap', () => {
      const orderApproved: OrderRecord = {
        id: 'order_custom_approval',
        collectionId: 'pbc_3527180448',
        collectionName: 'orders',
        customer_id: 'cust_approval',
        tracking_code: 'TRK-APPR-1',
        courier_id: mockGuilherme.id,
        status: 'delivered',
        distance_km: 10.0,
        return_trip_km: 10.0,
        total_route_with_return_km: 20.0,
        route_started_at: '2026-10-09 14:00:00.000Z',
        route_finished_at: '2026-10-09 14:30:00.000Z',
        created: '2026-10-09 13:30:00.000Z',
      } as unknown as OrderRecord

      const approvalsMap = new Map<
        string,
        { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
      >()
      approvalsMap.set('order_custom_approval', {
        approvedKm: 25.0, // admin aprovou trecho extra de 5 km
        justification: 'Desvio para abastecimento aprovado',
        status: 'approved',
      })

      const res = calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances: [],
        orders: [orderApproved],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
        approvalsMap,
      })

      expect(res.totalOfficialKm).toBe(25.0)
      expect(res.totalSpent).toBe(3.81) // 25 / 40 * 6.09 = 3.80625 -> 3.81
    })

    it('trava canônica: saldo período-independente no card de Conta Corrente (Guilherme R$ 220,99 · Vinicios R$ 67,62) e balance_adjustment excluído do Total Adiantado', () => {
      // Guilherme de Paiva:
      // Saldo canônico R$ 220,99 independente do filtro de período (all, month, week, today)
      // Total Adiantado canônico R$ 200,00 (excluindo qualquer balance_adjustment)
      const periods: Array<'all' | 'month' | 'week' | 'today'> = ['all', 'month', 'week', 'today']
      for (const p of periods) {
        const guilhermeMetrics = calculateCourierFuelMetrics({
          courier: mockGuilherme,
          advances: [
            mockAdvanceGuilherme,
            {
              id: 'bzbatiglleqj3vi',
              courier_id: mockGuilherme.id,
              amount: 188.45,
              entry_type: 'balance_adjustment',
              status: 'active',
              date: '2026-10-05 00:00:00.000Z',
              created: '2026-10-05 10:00:00.000Z',
            } as unknown as FuelAdvanceRecord,
          ],
          orders: guilhermeOrders,
          locations: [],
          offRouteEvents: [],
          settings: mockSettings,
          periodFilter: p,
        })
        expect(guilhermeMetrics.balance).toBe(220.99)
        expect(guilhermeMetrics.totalAdvances).toBe(200.0)
        expect(guilhermeMetrics.advanceCount).toBe(1)

        const guilhermeAcc = fuelAccountService.calculateAccountForCourier({
          courier: mockGuilherme,
          advances: [
            mockAdvanceGuilherme,
            {
              id: 'bzbatiglleqj3vi',
              courier_id: mockGuilherme.id,
              amount: 188.45,
              entry_type: 'balance_adjustment',
              status: 'active',
              date: '2026-10-05 00:00:00.000Z',
              created: '2026-10-05 10:00:00.000Z',
            } as unknown as FuelAdvanceRecord,
          ],
          orders: guilhermeOrders,
          settings: mockSettings,
          periodFilter: p,
        })
        expect(guilhermeAcc.balance).toBe(220.99)
        expect(guilhermeAcc.totalAdvances).toBe(200.0)
        expect(guilhermeAcc.advanceCount).toBe(1)

        // Vinicios Lunz:
        // Saldo canônico R$ 67,62 independente do filtro de período
        // Total Adiantado canônico R$ 0,00 (sem adiantamentos pós-corte)
        const viniciosMetrics = calculateCourierFuelMetrics({
          courier: mockVinicios,
          advances: [],
          orders: [],
          locations: [],
          offRouteEvents: [],
          settings: mockSettings,
          periodFilter: p,
        })
        expect(viniciosMetrics.balance).toBe(67.62)
        expect(viniciosMetrics.totalAdvances).toBe(0.0)
        expect(viniciosMetrics.advanceCount).toBe(0)

        const viniciosAcc = fuelAccountService.calculateAccountForCourier({
          courier: mockVinicios,
          advances: [],
          orders: [],
          settings: mockSettings,
          periodFilter: p,
        })
        expect(viniciosAcc.balance).toBe(67.62)
        expect(viniciosAcc.totalAdvances).toBe(0.0)
        expect(viniciosAcc.advanceCount).toBe(0)
      }
    })

    it('deve calcular o consumo do mês de Vinicios canônico em torno de ~R$ 73,34', () => {
      // Simulação do consumo acumulado de outubro de Vinicios Lunz
      // Rotas do mês de Vinicios totalizam ~481.7 km @ 40 km/L @ R$ 6.09 = R$ 73.34
      const octKmTotal = 481.7
      const spentExpected = Number(((octKmTotal / 40) * 6.09).toFixed(2)) // 73.34
      expect(spentExpected).toBe(73.34)

      // Teste com lote viário sintético somando exatamente 481.7 km
      const viniciosOctOrder: OrderRecord = {
        id: 'vinicios_oct_route',
        collectionId: 'pbc_3527180448',
        collectionName: 'orders',
        customer_id: 'cust_vinicios_month',
        tracking_code: 'TRK-VINICIOS-OCT',
        courier_id: mockVinicios.id,
        status: 'delivered',
        distance_km: 240.0,
        return_trip_km: 241.7,
        total_route_with_return_km: 481.7,
        route_started_at: '2026-10-06 10:00:00.000Z',
        route_finished_at: '2026-10-06 18:00:00.000Z',
        created: '2026-10-06 09:00:00.000Z',
      } as unknown as OrderRecord

      const res = calculateCourierFuelMetrics({
        courier: mockVinicios,
        advances: [],
        orders: [viniciosOctOrder],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'all',
      })

      expect(res.totalOfficialKm).toBe(481.7)
      expect(res.totalSpent).toBe(73.34)
    })

    it('deve derivar Total Adiantado e advanceCount estritamente do período selecionado mantendo o saldo invariante (caso Guilherme)', () => {
      // Simulação do Guilherme:
      // Opening balance: R$ 42.35
      // Adiantamentos:
      // 1. Mês anterior / histórico: R$ 371.49
      // 2. Mês anterior / histórico: R$ 300.00
      // 3. Mês corrente: R$ 100.00
      // Total pós-corte geral = 771.49 (3 adiantamentos)
      // Total mês corrente = 100.00 (1 adiantamento)
      const mockGuilherme: UserRecord = {
        id: 'guilherme_test_id',
        collectionId: 'users_coll',
        collectionName: 'users',
        name: 'Guilherme de Paiva',
        email: 'guilherme@test.com',
        role: 'courier',
        status: 'active',
        vehicle_type: 'moto',
        opening_balance: 42.35,
        cutoff_date: '2026-09-01T00:00:00Z',
        created: '2026-09-01T00:00:00Z',
        updated: '2026-11-01T00:00:00Z',
      } as unknown as UserRecord

      const advances: FuelAdvanceRecord[] = [
        {
          id: 'adv_1',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockGuilherme.id,
          amount: 371.49,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-09-15 12:00:00.000Z',
          created: '2026-09-15 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
        {
          id: 'adv_2',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockGuilherme.id,
          amount: 300.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-10-10 12:00:00.000Z',
          created: '2026-10-10 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
        {
          id: 'adv_3',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockGuilherme.id,
          amount: 100.0,
          entry_type: 'advance',
          status: 'paid',
          date: new Date().toISOString(), // Mês corrente
          created: new Date().toISOString(),
        } as unknown as FuelAdvanceRecord,
      ]

      // 1. Consulta com periodFilter = 'all': deve trazer 771.49 e contagem 3
      const totalsAll = calculateCanonicalCourierTotals({
        courier: mockGuilherme,
        advances,
        orders: [],
        periodFilter: 'all',
      })

      expect(totalsAll.totalAdvances).toBe(771.49)
      expect(totalsAll.periodAdvances).toBe(771.49)
      expect(totalsAll.advanceCount).toBe(3)
      // Saldo da conta corrente é opening_balance (42.35) + postCutoffAdvances (771.49) - gasto (0) = 813.84
      expect(totalsAll.balance).toBe(813.84)
      expect(totalsAll.openingBalance).toBe(42.35)

      // 2. Consulta com periodFilter = 'month': deve trazer 100.00 e contagem 1
      const totalsMonth = calculateCanonicalCourierTotals({
        courier: mockGuilherme,
        advances,
        orders: [],
        periodFilter: 'month',
      })

      expect(totalsMonth.totalAdvances).toBe(100.0)
      expect(totalsMonth.periodAdvances).toBe(100.0)
      expect(totalsMonth.advanceCount).toBe(1)
      // Saldo da conta corrente deve permanecer o saldo INVARIANTE cumulativo: 813.84
      expect(totalsMonth.balance).toBe(813.84)
      expect(totalsMonth.openingBalance).toBe(42.35)

      // 3. Integração com useCourierFuelMetrics:
      const metricsMonth = calculateCourierFuelMetrics({
        courier: mockGuilherme,
        advances,
        orders: [],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(metricsMonth.totalAdvances).toBe(100.0)
      expect(metricsMonth.periodAdvances).toBe(100.0)
      expect(metricsMonth.advanceCount).toBe(1)
      expect(metricsMonth.balance).toBe(813.84)
      expect(metricsMonth.openingBalance).toBe(42.35)

      // 4. Integração com fuelAccountService:
      const accountMonth = fuelAccountService.calculateAccountForCourier({
        courier: mockGuilherme,
        advances,
        orders: [],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(accountMonth.totalAdvances).toBe(100.0)
      expect(accountMonth.periodAdvances).toBe(100.0)
      expect(accountMonth.advanceCount).toBe(1)
      expect(accountMonth.balance).toBe(813.84)
    })

    it('trava canônica: fechamento de mês e carry-over de novembro do Guilherme (12,78 + 100,00 = 112,78 antes das rotas)', () => {
      // Regra de fechamento do Guilherme na v0.0.544 (migração 0178/0197):
      // Opening balance: R$ 12.78 (carry-over de outubro para novembro)
      // Cutoff date: 01/11/2026
      // Adiantamento de novembro: R$ 100.00
      // Saldo antes das rotas: 12.78 + 100.00 = 112.78
      const mockGuilhermeNov: UserRecord = {
        id: '15q1s10wim498t3',
        collectionId: 'users_coll',
        collectionName: 'users',
        name: 'Guilherme de Paiva',
        email: 'guilherme@test.com',
        role: 'courier',
        status: 'active',
        vehicle_type: 'moto',
        opening_balance: 12.78,
        cutoff_date: '2026-11-01 03:00:00.000Z',
        created: '2026-09-01T00:00:00Z',
        updated: '2026-11-04T00:00:00Z',
      } as unknown as UserRecord

      const advancesNov: FuelAdvanceRecord[] = [
        // Adiantamento antigo em outubro (pré-corte 01/11) -> NUNCA entra
        {
          id: 'adv_oct',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockGuilhermeNov.id,
          amount: 200.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-10-20 12:00:00.000Z',
          created: '2026-10-20 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
        // Adiantamento pós-corte em novembro: R$ 100.00
        {
          id: 'adv_nov',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockGuilhermeNov.id,
          amount: 100.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-11-03 12:00:00.000Z',
          created: '2026-11-03 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
      ]

      const metrics = calculateCourierFuelMetrics({
        courier: mockGuilhermeNov,
        advances: advancesNov,
        orders: [],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(metrics.openingBalance).toBe(12.78)
      expect(metrics.totalAdvances).toBe(100.0)
      expect(metrics.advanceCount).toBe(1)
      expect(metrics.totalSpent).toBe(0)
      expect(metrics.balance).toBe(112.78)
    })

    it('trava canônica: fechamento de mês e carry-over de novembro do Edson Pereira (5,32 + 100,00 = 105,32 antes das rotas, gasto 17,48 -> saldo 87,84, ajuste de outubro isolado)', () => {
      // Regra de fechamento do Edson declarada pelo dono na v0.0.545 (migração 0198):
      // - Edson trouxe R$ 5,32 do mês anterior (carry-over real).
      // - Já gastou R$ 17,48 em novembro (este mês corrente).
      // - Hoje (03/11) recebeu R$ 100,00 de adiantamento.
      // - Portanto o saldo da conta corrente dele deveria ser R$ 105,32 de manhã, antes das rotas de hoje,
      //   e R$ 105,32 − 17,48 = R$ 87,84 considerando o gasto do período.
      // - O ajuste manual de outubro (731 km / R$ 155,70) está isolado no histórico de outubro e NÃO entra no mês corrente.
      const mockEdsonNov: UserRecord = {
        id: 'tetrfu5oi19jbwz',
        collectionId: 'users_coll',
        collectionName: 'users',
        name: 'Edson Pereira da Silva Junior',
        plate: 'RIT9I49',
        email: 'edson@test.com',
        role: 'courier',
        status: 'active',
        vehicle_type: 'moto',
        opening_balance: 5.32,
        cutoff_date: '2026-11-01 03:00:00.000Z',
        created: '2026-09-01T00:00:00Z',
        updated: '2026-11-04T00:00:00Z',
      } as unknown as UserRecord

      const advancesEdson: FuelAdvanceRecord[] = [
        // Adiantamentos antigos de outubro (pré-corte 01/11) -> NUNCA somam no pós-corte nem no mês corrente
        {
          id: 'adv_edson_oct_1',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockEdsonNov.id,
          amount: 200.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-10-10 12:00:00.000Z',
          created: '2026-10-10 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
        {
          id: 'adv_edson_oct_2',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockEdsonNov.id,
          amount: 150.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-10-25 12:00:00.000Z',
          created: '2026-10-25 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
        // Adiantamento recebido em 03/11 pós-corte: R$ 100,00
        {
          id: 'adv_edson_nov_1',
          collectionId: 'adv_coll',
          collectionName: 'fuel_advances',
          courier_id: mockEdsonNov.id,
          amount: 100.0,
          entry_type: 'advance',
          status: 'paid',
          date: '2026-11-03 12:00:00.000Z',
          created: '2026-11-03 12:00:00.000Z',
        } as unknown as FuelAdvanceRecord,
      ]

      // 1. Cenário de manhã (antes das rotas): carry-over 5.32 + adiantamento 100.00 = 105.32
      const metricsMorning = calculateCourierFuelMetrics({
        courier: mockEdsonNov,
        advances: advancesEdson,
        orders: [],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(metricsMorning.openingBalance).toBe(5.32)
      expect(metricsMorning.totalAdvances).toBe(100.0)
      expect(metricsMorning.advanceCount).toBe(1)
      expect(metricsMorning.totalSpent).toBe(0)
      expect(metricsMorning.balance).toBe(105.32)
      expect(metricsMorning.hasManualAdjustment).toBe(false)
      expect(metricsMorning.manualAdjustmentKm).toBeUndefined()

      // 2. Cenário com gasto de novembro de R$ 17,48
      // Moto: consumo 30 km/L, preço R$ 6,49/L -> fator = 6,49 / 30 = 0,216333... R$/km
      // Para dar exatamente R$ 17,48: km = 17,48 / (6,49 / 30) = 80,7996... ~ 80.8 km
      // Mock de uma ordem pós-corte em novembro com km suficiente para R$ 17,48
      const novOrder: OrderRecord = {
        id: 'ord_edson_nov_1',
        collectionId: 'orders_coll',
        collectionName: 'orders',
        courier_id: mockEdsonNov.id,
        status: 'delivered',
        created: '2026-11-03 14:00:00.000Z',
        actual_arrival: '2026-11-03 14:30:00.000Z',
        total_route_with_return_km: 80.8,
        start_base_lat: -22.6977499,
        start_base_lng: -43.2936013,
      } as unknown as OrderRecord

      const metricsWithSpent = calculateCourierFuelMetrics({
        courier: mockEdsonNov,
        advances: advancesEdson,
        orders: [novOrder],
        locations: [],
        offRouteEvents: [],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(metricsWithSpent.openingBalance).toBe(5.32)
      expect(metricsWithSpent.totalAdvances).toBe(100.0)
      expect(metricsWithSpent.advanceCount).toBe(1)
      expect(metricsWithSpent.totalSpent).toBe(17.48)
      expect(metricsWithSpent.balance).toBe(87.84)
      // Ajuste manual de outubro não aparece no card de novembro
      expect(metricsWithSpent.hasManualAdjustment).toBe(false)

      // 3. Mesma coerência via canonicalCourierTotalsService
      const canonicalTotals = calculateCanonicalCourierTotals({
        courier: mockEdsonNov,
        advances: advancesEdson,
        orders: [novOrder],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(canonicalTotals.openingBalance).toBe(5.32)
      expect(canonicalTotals.totalAdvances).toBe(100.0)
      expect(canonicalTotals.totalSpent).toBe(17.48)
      expect(canonicalTotals.balance).toBe(87.84)
      expect(canonicalTotals.hasManualAdjustment).toBe(false)

      // 4. Mesma coerência via fuelAccountService
      const fuelAccount = fuelAccountService.calculateAccountForCourier({
        courier: mockEdsonNov,
        advances: advancesEdson,
        orders: [novOrder],
        settings: mockSettings,
        periodFilter: 'month',
      })

      expect(fuelAccount.openingBalance).toBe(5.32)
      expect(fuelAccount.totalAdvances).toBe(100.0)
      expect(fuelAccount.totalSpent).toBe(17.48)
      expect(fuelAccount.balance).toBe(87.84)
      expect(fuelAccount.hasManualAdjustment).toBe(false)
    })
  })
})
