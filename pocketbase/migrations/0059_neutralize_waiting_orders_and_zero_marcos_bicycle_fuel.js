/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0059_neutralize_waiting_orders_and_zero_marcos_bicycle_fuel.js
    //
    // Objetivo da Migração (duas tarefas operacionais):
    //
    // TAREFA 1: Entregador Marcos Antonio Alves (`mxvhhwb5i46zjq2`) usa bicicleta (veículo confirmado).
    // Bicicleta NUNCA deve gerar custo de combustível (fuel_cost = 0, total_route_fuel_cost = 0).
    // Zera fuel_cost e total_route_fuel_cost para TODOS os pedidos existentes vinculados ao entregador Marcos.
    //
    // TAREFA 2: Neutralizar pedidos travados/órfãos com status "aguardando início" (pending / assigned com route_started=false)
    // ou status pendente/em rota que sejam de dias anteriores ou erros de sistema (ex: os 2 pedidos parados visíveis na Torre de Controle).
    // Padrão das migrações 0057 / 0058:
    // - status = 'cancelled'
    // - notes: adiciona 'Cancelado — erro de sistema / neutralização de rota não executada'
    // - distance_km = 0, return_trip_km = 0, total_route_with_return_km = 0, fuel_cost = 0, total_route_fuel_cost = 0,
    //   estimated_duration_minutes = 0, sequence = 0, route_started = 0, route_released = 0, route_finished = 0
    // Histórico preservado (sem delete).
    // NÃO toca em pedidos entregues ('delivered') nem em pedidos legítimos de hoje.

    console.log('0059: Iniciando migração operacional Rotaly...')

    // --- TAREFA 1: Zerar fuel_cost e total_route_fuel_cost dos pedidos de Marcos (bicicleta) ---
    try {
      const marcosResult = app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          fuel_cost = 0,
          total_route_fuel_cost = 0
        WHERE courier_id = 'mxvhhwb5i46zjq2'
          AND (fuel_cost > 0 OR total_route_fuel_cost > 0)
      `)
        .execute()

      console.log(
        '0059: [TAREFA 1] Combustível dos pedidos existentes de Marcos zerado com sucesso.',
      )
    } catch (errMarcos) {
      console.log('0059: [TAREFA 1] Erro ao zerar combustível de Marcos:', errMarcos)
      throw errMarcos
    }

    // Também zerar combustível de qualquer outro pedido cujo entregador cadastrado seja bicicleta
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          fuel_cost = 0,
          total_route_fuel_cost = 0
        WHERE courier_id IN (
          SELECT id FROM users WHERE LOWER(vehicle_type) IN ('bicicleta', 'bicycle', 'bike')
        ) AND (fuel_cost > 0 OR total_route_fuel_cost > 0)
      `)
        .execute()

      console.log(
        '0059: [TAREFA 1] Blindagem geral para entregadores de bicicleta aplicada no banco.',
      )
    } catch (errBikes) {
      console.log('0059: [TAREFA 1] Aviso ao aplicar blindagem de bicicleta geral:', errBikes)
    }

    // --- TAREFA 2: Neutralizar pedidos travados "aguardando início" (órfãos / erros de sistema) ---
    // Pedidos travados são aqueles que:
    // 1) Estão com status IN ('pending', 'assigned', 'waiting') OU route_started = 0
    // 2) NÃO foram entregues (status != 'delivered')
    // 3) NÃO foram cancelados ainda (status != 'cancelled')
    // 4) Não foram criados hoje (date(created) < date('now')) OU criados antes de 2026-09-15
    //    Garantindo que pedidos legítimos de hoje nunca sejam afetados.
    try {
      const cancelNote = 'Cancelado — erro de sistema / neutralização de rota não executada'

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
            WHEN notes IS NULL OR notes = '' THEN '${cancelNote}'
            WHEN notes LIKE '%${cancelNote}%' THEN notes
            ELSE notes || ' | ${cancelNote}'
          END
        WHERE status NOT IN ('delivered', 'cancelled')
          AND (
            status IN ('pending', 'assigned')
            OR route_started = 0
            OR route_started IS NULL
          )
          AND date(created) < date('now')
      `)
        .execute()

      console.log(
        '0059: [TAREFA 2] Pedidos travados "aguardando início" de dias anteriores neutralizados com sucesso.',
      )
    } catch (errWaiting) {
      console.log('0059: [TAREFA 2] Erro ao neutralizar pedidos travados:', errWaiting)
      throw errWaiting
    }
  },
  (app) => {
    // Reversão no-op idempotente (preservação de histórico)
  },
)
