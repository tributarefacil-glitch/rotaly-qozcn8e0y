migrate(
  (app) => {
    // 0043_cancel_ghost_order_trk_2026_622.js
    //
    // Objetivo da Migração:
    // Cancelar o pedido fantasma TRK-2026-622 (Thais Sampaio, de 11/09/2026) e zerar sua contaminação na telemetria.
    //
    // Ações:
    // 1. Localizar o pedido com tracking_code = "TRK-2026-622".
    // 2. Alterar status para 'cancelled'.
    // 3. Zerar contribuições de telemetria do pedido:
    //    - distance_km = 0
    //    - return_trip_km = 0
    //    - total_route_with_return_km = 0
    //    - fuel_cost = 0
    //    - total_route_fuel_cost = 0
    //    - estimated_duration_minutes = 0
    //    - sequence = 0
    //    - route_released = false
    //    - route_started = false
    //    - route_finished = false
    //    (NÃO alterar total_price nem dados do cliente/endereço).
    // 4. Registrar em 'notes': "Cancelado por decisão do admin — pedido fantasma de 11/09 (nunca entregue)".
    // 5. Limpar notificações espúrias vinculadas ao pedido fantasma em 'notifications'.
    // 6. Limpar eventuais desvios/alertas em 'off_route_events' vinculados ao pedido.
    // 7. Limpar eventual espelho em 'entregas' (se existir).
    // 8. Garantir que a migração é estritamente idempotente.

    try {
      console.log('0043: Iniciando cancelamento do pedido fantasma TRK-2026-622...')

      // 1. Localizar o pedido TRK-2026-622
      var order
      try {
        order = app.findFirstRecordByData('orders', 'tracking_code', 'TRK-2026-622')
      } catch (errOrderFind) {
        console.log('0043: Pedido TRK-2026-622 não encontrado na coleção orders.')
      }

      if (order) {
        var orderId = order.id
        console.log('0043: Pedido TRK-2026-622 encontrado com ID:', orderId)

        // 2 & 3 & 4. Atualizar campos do pedido
        order.set('status', 'cancelled')
        order.set('sequence', 0)
        order.set('distance_km', 0)
        order.set('return_trip_km', 0)
        order.set('total_route_with_return_km', 0)
        order.set('fuel_cost', 0)
        order.set('total_route_fuel_cost', 0)
        order.set('estimated_duration_minutes', 0)
        order.set('route_released', false)
        order.set('route_started', false)
        order.set('route_finished', false)

        var existingNotes = order.getString('notes') || ''
        var cancelNote =
          'Cancelado por decisão do admin — pedido fantasma de 11/09 (nunca entregue)'
        if (existingNotes.indexOf(cancelNote) === -1) {
          order.set('notes', existingNotes ? existingNotes + ' | ' + cancelNote : cancelNote)
        }

        app.save(order)
        console.log('0043: Pedido TRK-2026-622 cancelado e telemetria zerada com sucesso.')

        // 5. Limpar notificações vinculadas ao pedido TRK-2026-622
        try {
          app
            .db()
            .newQuery('DELETE FROM notifications WHERE order_id = {:orderId}')
            .bind({ orderId: orderId })
            .execute()
          console.log('0043: Notificações vinculadas ao pedido TRK-2026-622 removidas.')
        } catch (errNotif) {
          console.log('0043: Aviso ao remover notificações vinculadas:', errNotif)
        }

        // 6. Limpar off_route_events vinculados ao pedido TRK-2026-622 (se houver)
        try {
          app
            .db()
            .newQuery('DELETE FROM off_route_events WHERE order_id = {:orderId}')
            .bind({ orderId: orderId })
            .execute()
          console.log('0043: Eventos off_route_events vinculados ao pedido TRK-2026-622 limpos.')
        } catch (errOffRoute) {
          console.log('0043: Aviso ao remover off_route_events vinculados:', errOffRoute)
        }

        // 7. Atualizar/limpar espelho em entregas (se existir)
        try {
          app
            .db()
            .newQuery(
              "UPDATE entregas SET status = 'cancelada' WHERE order_id = {:orderId} OR codigo_rastreio = 'TRK-2026-622'",
            )
            .bind({ orderId: orderId })
            .execute()
          console.log('0043: Espelho entregas (se existente) atualizado para cancelada.')
        } catch (errEntregas) {
          console.log('0043: Aviso ao sincronizar entregas:', errEntregas)
        }
      } else {
        // Fallback defensivo caso não venha pelo findFirstRecordByData
        try {
          app
            .db()
            .newQuery(
              `UPDATE orders 
               SET status = 'cancelled', 
                   sequence = 0,
                   distance_km = 0, 
                   return_trip_km = 0, 
                   total_route_with_return_km = 0, 
                   fuel_cost = 0, 
                   total_route_fuel_cost = 0,
                   estimated_duration_minutes = 0,
                   route_released = 0,
                   route_started = 0,
                   route_finished = 0,
                   notes = CASE 
                     WHEN notes IS NULL OR notes = '' THEN 'Cancelado por decisão do admin — pedido fantasma de 11/09 (nunca entregue)'
                     WHEN notes LIKE '%Cancelado por decisão do admin%' THEN notes
                     ELSE notes || ' | Cancelado por decisão do admin — pedido fantasma de 11/09 (nunca entregue)'
                   END
               WHERE tracking_code = 'TRK-2026-622'`,
            )
            .execute()
          console.log('0043: Fallback SQL executado com sucesso para TRK-2026-622.')
        } catch (errFallbackSql) {
          console.log('0043: Aviso ao executar fallback SQL:', errFallbackSql)
        }
      }

      console.log('0043: Migração 0043_cancel_ghost_order_trk_2026_622 concluída com sucesso.')
    } catch (eGlobal) {
      console.log('0043: Falha na migração 0043:', eGlobal)
      throw eGlobal
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
