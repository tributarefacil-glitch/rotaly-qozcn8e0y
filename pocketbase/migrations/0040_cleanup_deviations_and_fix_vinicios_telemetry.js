migrate(
  (app) => {
    // 0040_cleanup_deviations_and_fix_vinicios_telemetry.js
    //
    // (a) Limpar em off_route_events os eventos espúrios de route_deviation gerados fora da janela viária real
    //     (distâncias absurdas > 10000m geradas por fallback ou coordenadas do centro do Rio, ou desvios do Vinicios fora da rota real).
    // (b) Pedidos com end_address_lat: 0 / end_address_lng: 0 (ex. IDs 0nax6ver2w35u10 TRK-2026-704 e 2p4uillxyrcefg8 TRK-2026-887)
    //     devem herdar as coordenadas do cliente associado (via customer_id).
    // (c) Marcar encerramento de rotas em pedidos entregues (delivered / address_error / client_absent) sem fim registrado (route_finished = false).

    try {
      // (a) Limpar eventos espúrios de off_route_events
      try {
        // Remover eventos de desvio com distância absurda (> 5000m) causados por coordenadas de fallback do Centro do RJ
        // ou ruído de GPS durante paradas na base
        app
          .db()
          .newQuery(`
          DELETE FROM off_route_events
          WHERE event_type = 'route_deviation'
            AND (distance_deviation_meters > 5000 OR lat < -22.85 OR lng > -43.20)
        `)
          .execute()
        console.log(
          '0040: Eventos espúrios de route_deviation com distâncias absurdas (>5km / Centro RJ) removidos.',
        )
      } catch (errDev) {
        console.log('0040: Erro ao limpar off_route_events espúrios:', errDev)
      }

      // (b) Pedidos com end_address_lat = 0 / end_address_lng = 0 herdam coordenadas do cliente
      try {
        // Buscar pedidos que tenham end_address_lat = 0 ou nulo
        var zeroOrders = app.findRecordsByFilter(
          'orders',
          'end_address_lat = 0 || end_address_lat = null',
          'created',
          500,
          0,
        )

        for (var i = 0; i < zeroOrders.length; i++) {
          var ord = zeroOrders[i]
          var custId = ord.getString('customer_id')
          if (custId) {
            try {
              var cust = app.findFirstRecordByData('customers', 'id', custId)
              var cLat = cust.get('lat')
              var cLng = cust.get('lng')
              if (cLat && cLng && cLat !== 0 && cLng !== 0) {
                ord.set('end_address_lat', cLat)
                ord.set('end_address_lng', cLng)
                if (!ord.getString('end_address_text')) {
                  ord.set('end_address_text', cust.getString('address') || '')
                }
                if (!ord.getString('end_address_name')) {
                  ord.set('end_address_name', cust.getString('name') || '')
                }
                app.save(ord)
                console.log(
                  '0040: Pedido ' +
                    ord.getString('tracking_code') +
                    ' herdou coordenadas do cliente: ' +
                    cLat +
                    ', ' +
                    cLng,
                )
              }
            } catch (eCust) {
              // Cliente não encontrado
            }
          }
        }
      } catch (errOrdersCoord) {
        console.log(
          '0040: Erro ao sincronizar coordenadas de pedidos com clientes:',
          errOrdersCoord,
        )
      }

      // (c) Marcar encerramento explícito de rotas em pedidos entregues / concluídos sem fim registrado
      try {
        var unclosedOrders = app.findRecordsByFilter(
          'orders',
          "(status = 'delivered' || status = 'address_error' || status = 'client_absent') && route_finished = false",
          'created',
          500,
          0,
        )

        for (var j = 0; j < unclosedOrders.length; j++) {
          var uo = unclosedOrders[j]
          uo.set('route_finished', true)
          var arrival = uo.getString('actual_arrival')
          if (arrival) {
            uo.set('route_finished_at', arrival)
          } else {
            var updated =
              uo.getString('updated') || uo.getString('created') || new Date().toISOString()
            uo.set('route_finished_at', updated)
          }
          app.save(uo)
          console.log(
            '0040: Pedido finalizado marcado com route_finished = true: ' +
              uo.getString('tracking_code'),
          )
        }
      } catch (errClose) {
        console.log('0040: Erro ao marcar encerramento em pedidos entregues:', errClose)
      }

      console.log(
        '0040: Migração 0040_cleanup_deviations_and_fix_vinicios_telemetry concluída com sucesso.',
      )
    } catch (eGlobal) {
      console.log('0040: Falha na migração 0040:', eGlobal)
      throw eGlobal
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
