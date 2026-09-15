/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0057_neutralize_orphan_in_transit_orders.js
    //
    // Objetivo da Migração:
    // Neutralizar 6 pedidos órfãos (em in_transit) cancelando-os e zerando sua contaminação na telemetria:
    // 97mmpdi1rx48p7d (TRK-2026-533)
    // uyirdl6z4qoxt8g (TRK-2026-632)
    // xnrmbh477d6px61 (TRK-2026-726)
    // v2vdibdsikwn8pm (TRK-2026-756)
    // c8i8zwvwfddm77z (TRK-2026-995)
    // ln55zvkulvywdu2 (TRK-2026-539)
    //
    // Ações:
    // - status = 'cancelled'
    // - notes = notes + ' | Cancelado — erro de sistema / neutralização de rota não executada'
    // - distance_km = 0, return_trip_km = 0, total_route_with_return_km = 0, fuel_cost = 0, total_route_fuel_cost = 0,
    //   estimated_duration_minutes = 0, sequence = 0, route_started = false, route_released = false, route_finished = false
    // SEM deletar registros (histórico preservado).

    console.log('0057: Iniciando neutralização dos 6 pedidos órfãos...')

    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          status = 'cancelled',
          distance_km = 0,
          return_trip_km = 0,
          total_route_with_return_km = 0,
          fuel_cost = 0,
          total_route_fuel_cost = 0,
          estimated_duration_minutes = 0,
          sequence = 0,
          route_started = 0,
          route_released = 0,
          route_finished = 0,
          notes = CASE
            WHEN notes IS NULL OR notes = '' THEN 'Cancelado — erro de sistema / neutralização de rota não executada'
            WHEN notes LIKE '%Cancelado — erro de sistema / neutralização de rota não executada%' THEN notes
            ELSE notes || ' | Cancelado — erro de sistema / neutralização de rota não executada'
          END
        WHERE id IN (
          '97mmpdi1rx48p7d',
          'uyirdl6z4qoxt8g',
          'xnrmbh477d6px61',
          'v2vdibdsikwn8pm',
          'c8i8zwvwfddm77z',
          'ln55zvkulvywdu2'
        ) OR tracking_code IN (
          'TRK-2026-533',
          'TRK-2026-632',
          'TRK-2026-726',
          'TRK-2026-756',
          'TRK-2026-995',
          'TRK-2026-539'
        )
      `)
        .execute()

      console.log('0057: Neutralização dos 6 pedidos executada com sucesso.')
    } catch (err) {
      console.log('0057: Erro ao neutralizar pedidos órfãos:', err)
      throw err
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
