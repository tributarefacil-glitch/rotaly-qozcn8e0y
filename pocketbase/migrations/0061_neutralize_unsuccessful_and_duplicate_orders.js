/// <reference path="../pb_data/types.d.ts" />
migrate(
  (app) => {
    // 0061_neutralize_unsuccessful_and_duplicate_orders.js
    //
    // Objetivo da Migração:
    // Realizar a higienização e neutralização estrita de registros com km / combustível residuais no banco:
    //
    // 1. Insucessos e Cancelamentos (client_absent, address_error, cancelled):
    //    Zerar distance_km, return_trip_km, total_route_with_return_km, fuel_cost, total_route_fuel_cost
    //    em pedidos que não representam entregas concluídas ('delivered').
    //    (ex: zmj0hbu0h93gccv, 6up0lh3ve4g8tcy, 4ofwyo1fzh2z684, zhk2n45cz7mvj4v, xtq4xx4kb5k7dw4,
    //     kp26i1eighndsr5, jweqjkujod1zv4j, y9cwnal5rpy5fow, x0zlppci4xeo0ls, w2cscrix4lv7ckh,
    //     ulzsk1va157o24m, 8typc4h7972etjo, ve7vh5kal8ux9ex, iuprnh9pdbb4v0e, j2fl9bql98o4s2l, 54wi5r3tw8saudf, etc.)
    //
    // 2. Pedidos pendentes/órfãos que não iniciaram rota (pending com route_started=0 ou sem courier):
    //    Zerar distance_km para evitar que pedidos não atribuídos afetem relatórios (ex: 88bgtgccd4vuaow, l1mzmcg9b8kqw5d).
    //
    // 3. Duplicata ELAINE SOUZA de 12/09/2026:
    //    No mesmo minuto (19:25) foram entregues dois pedidos para a mesma cliente:
    //    - vib35o66c4xs4xv (TRK-2026-170, 19:25:22): R$ 19,98 - Pedido Primário que mantém o percurso
    //    - hb8lfsaw8na0n6z (TRK-2026-821, 19:25:40): R$ 19,98 - Pedido Secundário / Duplicata no mesmo minuto
    //    Neutraliza o pedido secundário TRK-2026-821 zerando km/combustível reembolsável (viagem já paga no 170).
    //
    // 4. Blindagem geral: qualquer pedido de bicicleta com fuel_cost ou total_route_fuel_cost > 0 tem combustível zerado.

    console.log('0061: Iniciando neutralização de registros contaminados...')

    // TAREFA 1: Zerar km e combustível de todos os pedidos não-entregues (cancelled, client_absent, address_error)
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          distance_km = 0,
          return_trip_km = 0,
          total_route_with_return_km = 0,
          fuel_cost = 0,
          total_route_fuel_cost = 0,
          notes = CASE
            WHEN notes IS NULL OR notes = '' THEN 'Cancelado / Insucesso — erro de sistema / neutralizado'
            WHEN notes LIKE '%neutralizado%' OR notes LIKE '%erro de sistema%' THEN notes
            ELSE notes || ' | Neutralizado — km e combustível zerados'
          END
        WHERE status IN ('cancelled', 'client_absent', 'address_error')
          AND (
            distance_km > 0
            OR return_trip_km > 0
            OR total_route_with_return_km > 0
            OR fuel_cost > 0
            OR total_route_fuel_cost > 0
          )
      `)
        .execute()

      console.log('0061: Insucessos e cancelamentos neutralizados com sucesso.')
    } catch (errInsucessos) {
      console.log('0061: Erro ao neutralizar insucessos:', errInsucessos)
      throw errInsucessos
    }

    // TAREFA 2: Zerar km de pedidos pending com route_started = 0
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          distance_km = 0,
          return_trip_km = 0,
          total_route_with_return_km = 0,
          fuel_cost = 0,
          total_route_fuel_cost = 0
        WHERE status = 'pending'
          AND (route_started = 0 OR route_started IS NULL)
          AND (distance_km > 0 OR fuel_cost > 0)
      `)
        .execute()

      console.log('0061: Pedidos pendentes sem rota iniciada zerados com sucesso.')
    } catch (errPending) {
      console.log('0061: Erro ao zerar pedidos pendentes:', errPending)
      throw errPending
    }

    // TAREFA 3: Neutralizar duplicata ELAINE SOUZA (TRK-2026-821 / hb8lfsaw8na0n6z)
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          distance_km = 0,
          return_trip_km = 0,
          fuel_cost = 0,
          notes = CASE
            WHEN notes IS NULL OR notes = '' THEN 'Entrega conjunta no mesmo minuto — km e combustível neutralizados (viagem coberta pelo TRK-2026-170)'
            WHEN notes LIKE '%TRK-2026-170%' THEN notes
            ELSE notes || ' | Entrega conjunta no mesmo minuto — km e combustível neutralizados (viagem coberta pelo TRK-2026-170)'
          END
        WHERE id = 'hb8lfsaw8na0n6z' OR tracking_code = 'TRK-2026-821'
      `)
        .execute()

      console.log('0061: Duplicata TRK-2026-821 neutralizada com sucesso.')
    } catch (errElaine) {
      console.log('0061: Erro ao neutralizar duplicata Elaine:', errElaine)
      throw errElaine
    }

    // TAREFA 4: Garantir que nenhum entregador de bicicleta tenha fuel_cost > 0
    try {
      app
        .db()
        .newQuery(`
        UPDATE orders
        SET
          fuel_cost = 0,
          total_route_fuel_cost = 0
        WHERE (
          courier_id IN (
            SELECT id FROM users WHERE LOWER(vehicle_type) IN ('bicicleta', 'bicycle', 'bike')
          )
          OR courier_id = 'mxvhhwb5i46zjq2'
        )
        AND (fuel_cost > 0 OR total_route_fuel_cost > 0)
      `)
        .execute()

      console.log('0061: Blindagem de combustível para entregadores de bicicleta aplicada.')
    } catch (errBikes) {
      console.log('0061: Erro ao aplicar blindagem de bicicleta:', errBikes)
    }
  },
  (app) => {
    // Reversão no-op idempotente (preservação de histórico)
  },
)
