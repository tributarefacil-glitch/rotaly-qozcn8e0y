/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0058_neutralize_luis_antonio_vinicios_orders.js
    //
    // Objetivo da Migração:
    // Neutralizar 5 pedidos órfãos (em in_transit) de Luis Antonio e Vinicios
    // cancelando-os e zerando sua contaminação na telemetria e relatórios de combustível/km:
    //
    // Luis Antonio (4 pedidos):
    // - x8jaemijqofuwsm (TRK-2026-695)
    // - h1gn3rwpmf412tx (TRK-2026-271)
    // - 29eitrtusj7pa2x (TRK-2026-957)
    // - ydhn8l6rpp1lrex (TRK-2026-455)
    //
    // Vinicios (1 pedido):
    // - uig5o8e6go20e25 (TRK-2026-338)
    //
    // Ações:
    // - status = 'cancelled'
    // - notes = notes + ' | Cancelado — erro de sistema / neutralização de rota não executada'
    // - distance_km = 0, return_trip_km = 0, total_route_with_return_km = 0, fuel_cost = 0, total_route_fuel_cost = 0,
    //   estimated_duration_minutes = 0, sequence = 0, route_started = false, route_released = false, route_finished = false
    // SEM deletar registros (histórico preservado).

    console.log('0058: Iniciando neutralização dos 5 pedidos de Luis Antonio e Vinicios...')

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
          'x8jaemijqofuwsm',
          'h1gn3rwpmf412tx',
          '29eitrtusj7pa2x',
          'ydhn8l6rpp1lrex',
          'uig5o8e6go20e25'
        ) OR tracking_code IN (
          'TRK-2026-695',
          'TRK-2026-271',
          'TRK-2026-957',
          'TRK-2026-455',
          'TRK-2026-338'
        )
      `)
        .execute()

      console.log('0058: Neutralização dos 5 pedidos executada com sucesso.')
    } catch (err) {
      console.log('0058: Erro ao neutralizar pedidos órfãos:', err)
      throw err
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
