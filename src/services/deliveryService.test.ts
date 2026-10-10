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
      .mockResolvedValueOnce({
        success: false,
        reason: 'unauthorized_auto_trigger',
        sequencedCount: 0,
        totalDistanceKm: 0,
      })

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

  describe('resequenceActiveRouteForCourier - destino oficial e unicidade 1..N', () => {
    it('garante que a rota otimizada utiliza sempre a base oficial como destino de retorno', async () => {
      const pbModule = await import('@/lib/pocketbase/client')
      const pb = pbModule.default

      const mockCourier = {
        id: 'courier_1',
        name: 'Guilherme',
        vehicle_type: 'moto',
      }
      const mockOrders = [
        {
          id: 'ord_1',
          tracking_code: 'TRK-1',
          courier_id: 'courier_1',
          sequence: 1,
          created: '2026-10-10 10:00:00',
          expand: {
            customer_id: {
              id: 'cust_1',
              name: 'Cliente 1',
              lat: -22.7,
              lng: -43.29,
              address: 'Rua A',
            },
          },
        },
      ]

      const getOneUserSpy = vi
        .spyOn(pb.collection('users'), 'getOne')
        .mockResolvedValue(mockCourier as any)
      const getFullListOrdersSpy = vi
        .spyOn(pb.collection('orders'), 'getFullList')
        .mockResolvedValue(mockOrders as any)
      const updateOrderSpy = vi
        .spyOn(pb.collection('orders'), 'update')
        .mockResolvedValue({} as any)
      const getBaseAddressesSpy = vi.spyOn(deliveryService, 'getBaseAddresses').mockResolvedValue([
        {
          id: 'base_1',
          name: 'Base Matriz',
          lat: -22.699,
          lng: -43.296,
          is_default: true,
          address: 'Av Base 1',
        } as any,
      ])

      const res = await deliveryService.resequenceActiveRouteForCourier(
        'courier_1',
        null,
        false,
        'manual_command',
      )
      expect(res.success).toBe(true)

      // Verificar que update foi chamado com sequence = 1 e base oficial
      expect(updateOrderSpy).toHaveBeenCalled()
      const updatePayload = updateOrderSpy.mock.calls[0][1] as any
      expect(updatePayload.sequence).toBe(1)
      expect(updatePayload.start_base_lat).toBe(-22.699)
      expect(updatePayload.start_base_lng).toBe(-43.296)

      getOneUserSpy.mockRestore()
      getFullListOrdersSpy.mockRestore()
      updateOrderSpy.mockRestore()
      getBaseAddressesSpy.mockRestore()
    })
  })

  describe('NOVA REGRA: pin_entregador (applyAddressCorrectionAutomatic)', () => {
    it('aplica correção automática no cadastro do cliente, preservando número se o reverso não trouxer, e grava audit_trail com autor = entregador', async () => {
      const pbModule = await import('@/lib/pocketbase/client')
      const pb = pbModule.default

      const mockUpdatedCustomer = {
        id: 'cust_auto_456',
        name: 'Cliente Auto Teste',
        address: 'Rua das Flores, 120 - Centro, Curitiba - PR, 80000-000',
        street: 'Rua das Flores',
        neighborhood: 'Centro',
        city: 'Curitiba',
        state: 'PR',
        postal_code: '80000-000',
        lat: -25.4284,
        lng: -49.2733,
        notes:
          'Nota anterior | [CORREÇÃO AUTOMÁTICA PIN ENTREGADOR 10/10/2026]: Pin e endereço calibrados...',
      }

      const updateCustomerSpy = vi
        .spyOn(deliveryService, 'updateCustomer')
        .mockResolvedValueOnce(mockUpdatedCustomer as any)

      let auditCreatedPayload: any = null
      const createAuditSpy = vi
        .spyOn(pb.collection('audit_trail'), 'create')
        .mockImplementationOnce(async (payload: any) => {
          auditCreatedPayload = payload
          return { id: 'audit_123', ...payload } as any
        })

      const res = await deliveryService.applyAddressCorrectionAutomatic({
        customerId: 'cust_auto_456',
        currentCustomer: {
          id: 'cust_auto_456',
          address: 'Rua Antiga, 120',
          street: 'Rua Antiga',
          neighborhood: 'Bairro Velho',
          city: 'Curitiba',
          state: 'PR',
          postal_code: '80000-111',
          lat: -25.429,
          lng: -49.274,
          notes: 'Nota anterior',
        },
        courierUser: {
          id: 'courier_user_789',
          name: 'Guilherme Entregador',
          email: 'guilherme@exemplo.com',
        },
        suggestedAddress: {
          address: 'Rua das Flores, 120 - Centro, Curitiba - PR, 80000-000',
          street: 'Rua das Flores',
          number: '120',
          neighborhood: 'Centro',
          city: 'Curitiba',
          state: 'PR',
          postal_code: '80000-000',
          lat: -25.4284,
          lng: -49.2733,
          accuracy_meters: 12,
          source: 'gps_reverse',
        },
        distanceMeters: 120, // <= 500m
      })

      expect(res.success).toBe(true)
      expect(res.customer.id).toBe('cust_auto_456')

      // Verificar chamada updateCustomer
      expect(updateCustomerSpy).toHaveBeenCalledTimes(1)
      const passedUpdate = updateCustomerSpy.mock.calls[0][1]
      expect(passedUpdate.address).toBe('Rua das Flores, 120 - Centro, Curitiba - PR, 80000-000')
      expect(passedUpdate.lat).toBe(-25.4284)
      expect(passedUpdate.lng).toBe(-49.2733)
      expect(passedUpdate.notes).toContain('[CORREÇÃO AUTOMÁTICA PIN ENTREGADOR')

      // Verificar audit_trail conforme regras rígidas do projeto:
      // user_id = real courier id, actor_name = courier name, motivo = 'correção automática de pin pelo entregador'
      expect(createAuditSpy).toHaveBeenCalledTimes(1)
      expect(auditCreatedPayload.collection).toBe('customers')
      expect(auditCreatedPayload.record_id).toBe('cust_auto_456')
      expect(auditCreatedPayload.user_id).toBe('courier_user_789')
      expect(auditCreatedPayload.courier_id).toBe('courier_user_789')
      expect(auditCreatedPayload.action).toBe('pin_entregador_auto')
      expect(auditCreatedPayload.metadata.reason).toBe('correção automática de pin pelo entregador')
      expect(auditCreatedPayload.metadata.actor_name).toBe('Guilherme Entregador')
      expect(auditCreatedPayload.metadata.distance_meters).toBe(120)
      expect(auditCreatedPayload.metadata.auto_applied).toBe(true)

      const oldValueObj = JSON.parse(auditCreatedPayload.old_value)
      const newValueObj = JSON.parse(auditCreatedPayload.new_value)
      expect(oldValueObj.lat).toBe(-25.429)
      expect(newValueObj.lat).toBe(-25.4284)
      expect(oldValueObj.address).toBe('Rua Antiga, 120')
      expect(newValueObj.address).toBe('Rua das Flores, 120 - Centro, Curitiba - PR, 80000-000')

      updateCustomerSpy.mockRestore()
      createAuditSpy.mockRestore()
    })
  })
})
