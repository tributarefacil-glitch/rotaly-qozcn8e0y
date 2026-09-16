/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // Corrigir o registro do incidente — pedido ID 6rbtpvjs5z2mkso (TRK-2026-380):
    // setar status: 'cancelled' com motivo de duplicidade (a vendedora já reemitiu a venda limpa como TRK-2026-589, pending)
    // e limpar a baixa fantasma
    try {
      const order = app.findFirstRecordByData('orders', 'id', '6rbtpvjs5z2mkso')
      order.set('status', 'cancelled')
      order.set(
        'notes',
        'Cancelado por duplicidade operacional (reemitido como TRK-2026-589 pendente)',
      )
      order.set('actual_arrival', null)
      order.set('completion_reason', null)
      order.set('signature', '')
      order.set('proof_photo', '')
      order.set('receiver_name', '')
      order.set('distance_km', 0)
      order.set('return_trip_km', 0)
      order.set('total_route_with_return_km', 0)
      order.set('fuel_cost', 0)
      order.set('total_route_fuel_cost', 0)
      order.set('route_finished', false)
      order.set('route_finished_at', null)
      order.set('route_released', false)
      order.set('route_released_at', null)
      order.set('route_started', false)
      order.set('route_started_at', null)
      app.save(order)
    } catch (err) {
      console.log('Error updating order 6rbtpvjs5z2mkso:', err)
      // Fallback via raw SQL
      try {
        app
          .db()
          .newQuery(`
            UPDATE orders SET
              status = 'cancelled',
              notes = 'Cancelado por duplicidade operacional (reemitido como TRK-2026-589 pendente)',
              actual_arrival = NULL,
              completion_reason = NULL,
              signature = '',
              proof_photo = '',
              receiver_name = '',
              distance_km = 0,
              return_trip_km = 0,
              total_route_with_return_km = 0,
              fuel_cost = 0,
              total_route_fuel_cost = 0,
              route_finished = 0,
              route_finished_at = NULL,
              route_released = 0,
              route_released_at = NULL,
              route_started = 0,
              route_started_at = NULL
            WHERE id = '6rbtpvjs5z2mkso'
          `)
          .execute()
      } catch (sqlErr) {
        console.log('Error executing raw query fallback for 6rbtpvjs5z2mkso:', sqlErr)
      }
    }
  },
  (app) => {
    // Revert opcional
  },
)
