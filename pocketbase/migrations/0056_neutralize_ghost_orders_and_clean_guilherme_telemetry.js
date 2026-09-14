/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0056_neutralize_ghost_orders_and_clean_guilherme_telemetry.js
    // 1. Neutralizar os 3 pedidos legados (TRK-2026-526, TRK-2026-794, TRK-2026-811):
    //    - Restaurar route_released_at para a data original de criação (created).
    //    - Zerar campos de km/custo do TRK-2026-526 (status client_absent): distance_km=0, fuel_cost=0, return_trip_km=0, total_route_with_return_km=0, total_route_fuel_cost=0.
    //    - Corrigir start_base_lat/start_base_lng de 0,0 para a base oficial "Mais Saudavel" (-22.7001402, -43.2982834) e endereço/nome da base.
    // 2. Limpar pings duplicados GPS do Guilherme (user_id = 'u6zr2qtcos1ljxd'):
    //    - Excluir de locations os registros com offline_buffered = true e created >= '2026-09-14 00:00:00'.
    //    - Excluir de off_route_events os falsos desvios do Guilherme gerados no dia 2026-09-14 associados a leituras de velocidade espúria / buffer duplicado.

    console.log(
      '0056: Iniciando neutralização de pedidos fantasmas e limpeza de telemetria do Guilherme...',
    )

    try {
      // 1.1 Restaurar route_released_at dos 3 pedidos para created e corrigir a base Mais Saudavel
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          route_released_at = created,
          start_base_lat = -22.7001402,
          start_base_lng = -43.2982834,
          start_base_name = 'Mais Saudavel',
          start_base_address = 'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil'
        WHERE id IN ('43lweycvvuh8aje', 'mj4cfo1ssu6x69u', 'wapwnay9mtmwots')
           OR tracking_code IN ('TRK-2026-526', 'TRK-2026-794', 'TRK-2026-811')
      `)
        .execute()

      // 1.2 Zerar campos de km e combustível do TRK-2026-526 (entrega não efetuada / client_absent)
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          distance_km = 0,
          fuel_cost = 0,
          return_trip_km = 0,
          total_route_with_return_km = 0,
          total_route_fuel_cost = 0
        WHERE id = '43lweycvvuh8aje' OR tracking_code = 'TRK-2026-526'
      `)
        .execute()

      console.log(
        '0056: Pedidos TRK-2026-526, TRK-2026-794 e TRK-2026-811 atualizados com sucesso.',
      )
    } catch (err) {
      console.log('0056: Erro ao atualizar pedidos legados:', err)
    }

    try {
      // 2.1 Excluir de locations os registros offline_buffered = true de Guilherme a partir de 2026-09-14
      app
        .db()
        .newQuery(`
        DELETE FROM locations
        WHERE user_id = 'u6zr2qtcos1ljxd'
          AND offline_buffered = 1
          AND created >= '2026-09-14 00:00:00'
      `)
        .execute()

      console.log('0056: Locations offline_buffered do Guilherme excluídos com sucesso.')
    } catch (err) {
      console.log('0056: Erro ao limpar locations offline_buffered de Guilherme:', err)
    }

    try {
      // 2.2 Excluir de off_route_events os falsos desvios de Guilherme no dia 2026-09-14
      app
        .db()
        .newQuery(`
        DELETE FROM off_route_events
        WHERE courier_id = 'u6zr2qtcos1ljxd'
          AND created >= '2026-09-14 00:00:00'
      `)
        .execute()

      console.log('0056: Falsos eventos off_route_events do Guilherme excluídos com sucesso.')
    } catch (err) {
      console.log('0056: Erro ao limpar off_route_events de Guilherme:', err)
    }
  },
  (app) => {
    // Rollback não aplicável a limpezas de telemetria pontual
  },
)
