migrate(
  (app) => {
    // 0139_zero_cancelled_orders_km_fuel.js
    // Tarefa: Zerar total_route_with_return_km, fuel_cost e total_route_fuel_cost dos pedidos CANCELADOS:
    // TRK-2026-42445749, TRK-2026-52482889, TRK-2026-989 e TRK-2026-166.
    // REGRA DE PROTEÇÃO: TRK-2026-622 é protegido (não tocar). Nenhum pedido não-cancelado deve ser alterado.
    // Registrar audit_trail com:
    // user_id vazio, actor_name='Sistema', metadata.system_trigger=true (padrão usado nas migrações 0115/0116).

    const targetTrackingCodes = [
      'TRK-2026-42445749',
      'TRK-2026-52482889',
      'TRK-2026-989',
      'TRK-2026-166',
    ]

    const auditCol = app.findCollectionByNameOrId('audit_trail')

    for (let i = 0; i < targetTrackingCodes.length; i++) {
      const code = targetTrackingCodes[i]

      // Blindagem estrita contra TRK-2026-622
      if (code === 'TRK-2026-622') {
        console.warn(`[0139] AVISO: Código protegido ignorado: ${code}`)
        continue
      }

      let orderRecord = null
      try {
        orderRecord = app.findFirstRecordByData('orders', 'tracking_code', code)
      } catch (err) {
        console.warn(`[0139] Pedido não encontrado: ${code}`, err)
        continue
      }

      if (!orderRecord) continue

      // Verificar que o status é 'cancelled'
      if (orderRecord.get('status') !== 'cancelled') {
        console.warn(
          `[0139] Pedido ${code} NÃO está cancelado (status=${orderRecord.get('status')}). Não alterando.`,
        )
        continue
      }

      const oldRouteKm = orderRecord.get('total_route_with_return_km')
      const oldRouteFuel = orderRecord.get('total_route_fuel_cost')
      const oldFuelCost = orderRecord.get('fuel_cost')
      const oldNotes = orderRecord.get('notes') || ''
      const courierId = orderRecord.get('courier_id') || ''

      // Atualizar a ordem
      orderRecord.set('total_route_with_return_km', 0)
      orderRecord.set('total_route_fuel_cost', 0)
      orderRecord.set('fuel_cost', 0)
      if (!oldNotes.includes('Neutralizado — km e combustível zerados')) {
        orderRecord.set(
          'notes',
          oldNotes
            ? `${oldNotes} | Neutralizado — km e combustível zerados`
            : 'Neutralizado — km e combustível zerados',
        )
      }
      app.save(orderRecord)

      console.log(
        `[0139] Pedido cancelado neutralizado: ${code}. ` +
          `KM: ${oldRouteKm} -> 0, RouteFuel: ${oldRouteFuel} -> 0, Fuel: ${oldFuelCost} -> 0`,
      )

      // Inserir registro no audit_trail
      if (auditCol) {
        try {
          const trail = new Record(auditCol)
          trail.set('collection', 'orders')
          trail.set('record_id', orderRecord.id)
          trail.set('action', 'neutralize_cancelled_order_km')
          trail.set('field', 'total_route_with_return_km')
          trail.set(
            'old_value',
            `${oldRouteKm} km (fuel: ${oldFuelCost}, routeFuel: ${oldRouteFuel})`,
          )
          trail.set('new_value', '0 km (fuel: 0, routeFuel: 0)')
          trail.set('courier_id', courierId)
          trail.set('timestamp', new Date().toISOString())
          trail.set('user_id', '') // Vazio conforme regra padrão para ações de sistema

          trail.set('metadata', {
            tracking_code: code,
            order_id: orderRecord.id,
            action_type: 'neutralize_cancelled_order_km',
            actor_name: 'Sistema',
            system_trigger: true,
            justification: 'Neutralização de km e combustível de pedido cancelado nunca visitado',
            reason: 'Neutralização de km e combustível de pedido cancelado nunca visitado',
            previous_route_km: oldRouteKm,
            new_route_km: 0,
            previous_fuel_cost: oldFuelCost,
            new_fuel_cost: 0,
            previous_route_fuel_cost: oldRouteFuel,
            new_route_fuel_cost: 0,
          })

          app.save(trail)
        } catch (auditErr) {
          console.warn(`[0139] Falha ao registrar audit_trail para ordem ${code}:`, auditErr)
        }
      }
    }
  },
  (app) => {
    console.log('[0139] Revertendo neutralização de pedidos cancelados (no-op).')
  },
)
