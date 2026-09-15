/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0062_neutralize_stuck_order_trk_2026_403.js
    //
    // Objetivo da Migração:
    // Neutralizar o pedido travado f5aqrlnrf31zzv7 (TRK-2026-403, Luis Antonio, status "assigned",
    // route_released=true, liberado 15/09 14:53 e nunca iniciado, com distance_km 32.84 e fuel_cost 42.63 indevidos):
    // - status = 'cancelled'
    // - route_released = false, route_started = false
    // - distance_km = 0, fuel_cost = 0, total_route_fuel_cost = 0, return_trip_km = 0, total_route_with_return_km = 0
    // - anexar às notes: "[neutralizado: erro de sistema - rota liberada e nunca iniciada]"
    // - histórico preservado, nada deletado

    console.log('0062: Iniciando neutralização do pedido travado TRK-2026-403 (f5aqrlnrf31zzv7)...')

    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          status = 'cancelled',
          route_released = 0,
          route_started = 0,
          distance_km = 0,
          fuel_cost = 0,
          total_route_fuel_cost = 0,
          return_trip_km = 0,
          total_route_with_return_km = 0,
          notes = CASE
            WHEN notes IS NULL OR notes = '' THEN '[neutralizado: erro de sistema - rota liberada e nunca iniciada]'
            WHEN notes LIKE '%[neutralizado: erro de sistema - rota liberada e nunca iniciada]%' THEN notes
            ELSE notes || ' | [neutralizado: erro de sistema - rota liberada e nunca iniciada]'
          END
        WHERE id = 'f5aqrlnrf31zzv7' OR tracking_code = 'TRK-2026-403'
      `)
        .execute()

      console.log('0062: Pedido TRK-2026-403 neutralizado com sucesso.')
    } catch (err) {
      console.log('0062: Erro ao neutralizar pedido TRK-2026-403:', err)
      throw err
    }
  },
  (app) => {
    // Reversão no-op idempotente (preservação de histórico)
  },
)
