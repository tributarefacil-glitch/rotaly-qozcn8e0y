/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. Limpeza de total_route_with_return_km, total_route_fuel_cost e return_trip_km
    // em pedidos CANCELADOS específicos que ainda carregam valores:
    // TRK-2026-254, TRK-2026-700, TRK-2026-257, TRK-2026-900, TRK-2026-379, TRK-2026-105
    // NÃO alterar distance_km, fuel_cost, status, notas nem qualquer outro campo desses pedidos.
    const cancelledTrackingCodes = [
      'TRK-2026-254',
      'TRK-2026-700',
      'TRK-2026-257',
      'TRK-2026-900',
      'TRK-2026-379',
      'TRK-2026-105',
    ]

    for (const code of cancelledTrackingCodes) {
      try {
        const order = app.findFirstRecordByData('orders', 'tracking_code', code)
        if (order) {
          order.set('total_route_with_return_km', 0)
          order.set('total_route_fuel_cost', 0)
          order.set('return_trip_km', 0)
          app.save(order)
        }
      } catch (err) {
        console.log(`Fallback SQL for ${code}:`, err)
        try {
          app
            .db()
            .newQuery(
              `UPDATE orders SET
                total_route_with_return_km = 0,
                total_route_fuel_cost = 0,
                return_trip_km = 0
              WHERE tracking_code = {:code}`,
            )
            .bind({ code })
            .execute()
        } catch (sqlErr) {
          console.log(`Failed SQL for ${code}:`, sqlErr)
        }
      }
    }

    // 2. No TRK-2026-665 (delivered, teste, distance_km=0, coordenadas do cliente = coordenadas da base):
    // zerar total_route_with_return_km (65.7 -> 0) e total_route_fuel_cost (42.63 -> 0)
    // NÃO alterar distance_km, fuel_cost, status, notas nem qualquer outro campo.
    try {
      const order665 = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-665')
      if (order665) {
        order665.set('total_route_with_return_km', 0)
        order665.set('total_route_fuel_cost', 0)
        app.save(order665)
      }
    } catch (err) {
      console.log('Fallback SQL for TRK-2026-665:', err)
      try {
        app
          .db()
          .newQuery(
            `UPDATE orders SET
              total_route_with_return_km = 0,
              total_route_fuel_cost = 0
            WHERE tracking_code = 'TRK-2026-665'`,
          )
          .execute()
      } catch (sqlErr) {
        console.log('Failed SQL for TRK-2026-665:', sqlErr)
      }
    }
  },
  (app) => {
    // Revert opcional
  },
)
