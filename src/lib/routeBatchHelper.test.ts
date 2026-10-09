import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getMergedRouteBatchKey,
  getRouteBatchDisplay,
  groupOrdersByRouteBatch,
} from '@/lib/routeBatchHelper'
import type { OrderRecord } from '@/types/delivery'

describe('Route Batch Helper & Version reload safeguards', () => {
  it('mescla pedidos cujos route_started_at e route_finished_at estejam dentro de 2 minutos de tolerância', () => {
    // Pedido 1: rota iniciada 10:00:15 e finalizada 10:45:10
    const order1: OrderRecord = {
      id: 'ord_1',
      route_started_at: '2026-10-08T10:00:15.000Z',
      route_finished_at: '2026-10-45:10.000Z',
    } as unknown as OrderRecord

    // Pedido 2: mesma rota, mas registrado com 40 segundos de diferença (10:00:55 e 10:45:30)
    const order2: OrderRecord = {
      id: 'ord_2',
      route_started_at: '2026-10-08T10:00:55.000Z',
      route_finished_at: '2026-10-45:30.000Z',
    } as unknown as OrderRecord

    // Pedido 3: mesma rota, atravessando a virada do minuto (10:01:20 e 10:46:15)
    const order3: OrderRecord = {
      id: 'ord_3',
      route_started_at: '2026-10-08T10:01:20.000Z',
      route_finished_at: '2026-10-46:15.000Z',
    } as unknown as OrderRecord

    const grouped = groupOrdersByRouteBatch([order1, order2, order3])

    // Deve agrupar em exatamente 1 único lote
    expect(grouped.size).toBe(1)
    const firstBatchOrders = Array.from(grouped.values())[0]
    expect(firstBatchOrders.length).toBe(3)
    expect(firstBatchOrders.map((o) => o.id)).toEqual(['ord_1', 'ord_2', 'ord_3'])
  })

  it('separa lotes quando a diferença for superior a 2 minutos', () => {
    const orderA: OrderRecord = {
      id: 'ord_a',
      route_started_at: '2026-10-08T10:00:00.000Z',
      route_finished_at: '2026-10-08T10:30:00.000Z',
    } as unknown as OrderRecord

    const orderB: OrderRecord = {
      id: 'ord_b',
      route_started_at: '2026-10-08T10:05:00.000Z',
      route_finished_at: '2026-10-08T10:35:00.000Z',
    } as unknown as OrderRecord

    const grouped = groupOrdersByRouteBatch([orderA, orderB])
    expect(grouped.size).toBe(2)
  })

  it('formata o rótulo de exibição corretamente', () => {
    const order: OrderRecord = {
      id: 'ord_disp',
      route_started_at: '2026-10-08T14:30:00.000Z',
      route_finished_at: '2026-10-08T15:00:00.000Z',
    } as unknown as OrderRecord

    const display = getRouteBatchDisplay(order)
    expect(display).toMatch(/Rota \d{2}:\d{2}/)

    const orderAvulso: OrderRecord = {
      id: 'ord_avulso',
    } as unknown as OrderRecord
    expect(getRouteBatchDisplay(orderAvulso)).toBe('Avulso')
  })
})
