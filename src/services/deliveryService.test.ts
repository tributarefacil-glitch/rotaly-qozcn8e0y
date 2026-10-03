import { describe, it, expect, vi } from 'vitest'
import { deliveryService } from './deliveryService'

describe('deliveryService - km viário e validação de liberação de rota', () => {
  it('garante que a validação de liberação bloqueia quando há parada com 0,0 km e recálculo não preenche', async () => {
    // Mock do pb.collection('orders').getFullList para simular uma parada com 0 km
    const mockOrderZero = {
      id: 'ord_zero_123',
      tracking_code: 'TRK-2026-TEST',
      courier_id: 'courier_test_1',
      distance_km: 0,
      return_trip_km: 0,
      status: 'assigned',
      end_address_name: 'Cliente Teste Zero',
      expand: {
        customer_id: {
          id: 'cust_test_1',
          name: 'Daiana Lins Teste',
          address: 'Rua Exemplo, 123',
        },
      },
    }

    // Spy no resequenceActiveRouteForCourier para simular falha no recálculo
    const reseqSpy = vi
      .spyOn(deliveryService, 'resequenceActiveRouteForCourier')
      .mockResolvedValueOnce({ success: false, sequencedCount: 0, totalDistanceKm: 0 })

    // Spy no client PB
    const pbModule = await import('@/lib/pocketbase/client')
    const pb = pbModule.default
    const getFullListSpy = vi
      .spyOn(pb.collection('orders'), 'getFullList')
      .mockResolvedValue([mockOrderZero as any])

    await expect(
      deliveryService.releaseRouteForOrders(['ord_zero_123'], 'courier_test_1'),
    ).rejects.toThrow(/Não foi possível liberar a rota: a parada TRK-2026-TEST/i)

    reseqSpy.mockRestore()
    getFullListSpy.mockRestore()
  })
})
