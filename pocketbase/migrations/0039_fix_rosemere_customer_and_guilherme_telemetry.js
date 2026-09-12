migrate(
  (app) => {
    // 0039_fix_rosemere_customer_and_guilherme_telemetry.js
    // 1. Corrigir cliente ROSEMERE DE ALMEIDA BARBOSA (ID qmjok3zv678hws1)
    // Endereço: Av. Calombe, Lt 14, Qd 04, Pilar, Duque de Caxias - RJ (~1,6 km da base em Pilar)
    // Coordenadas corretas aproximadas: -22.688521, -43.293215
    // 2. Sanitizar outros customers com fallback exato do Centro do RJ (-22.906847, -43.172896) marcando para revisão consciente.
    // 3. Recalcular retroativamente a entrega zcaqeqyx9lhsete (TRK-2026-224) para os valores reais esperados:
    //    ~1,65 km ida + ~1,65 km retorno, fuel_cost R$ ~0,55 (0,61 proporcional), ~12 min duração estimada.
    // 4. Recalcular e atualizar o cabeçalho das rotas ativas do courier Guilherme (u6zr2qtcos1ljxd):
    //    total_route_with_return_km: ~17.2 km, total_route_fuel_cost: R$ ~3.19.

    try {
      // 1. Atualizar cliente Rosemere
      try {
        var rosemere = app.findFirstRecordByData('customers', 'id', 'qmjok3zv678hws1')
        rosemere.set('lat', -22.688521)
        rosemere.set('lng', -43.293215)
        var oldNotes = rosemere.getString('notes') || ''
        if (oldNotes.indexOf('Coordenadas corrigidas') === -1) {
          rosemere.set(
            'notes',
            (oldNotes ? oldNotes + ' | ' : '') + 'Coordenadas corrigidas para Av. Calombe, Pilar',
          )
        }
        app.save(rosemere)
        console.log(
          '0039: Cliente Rosemere (qmjok3zv678hws1) atualizado com sucesso (-22.688521, -43.293215)',
        )
      } catch (errRosemere) {
        console.log('0039: Cliente Rosemere não encontrado por id:', errRosemere)
      }

      // 2. Sanitizar outros clientes com as coordenadas de fallback do Centro do RJ (-22.906847, -43.172896)
      try {
        var fallbackCustomers = app.findRecordsByFilter(
          'customers',
          "lat = -22.906847 && lng = -43.172896 && id != 'qmjok3zv678hws1'",
          'name',
          500,
          0,
        )
        for (var i = 0; i < fallbackCustomers.length; i++) {
          var fc = fallbackCustomers[i]
          var n = fc.getString('notes') || ''
          if (n.indexOf('[REVISÃO DE COORDENADA: fallback detectado]') === -1) {
            fc.set(
              'notes',
              (n ? n + ' | ' : '') +
                '[REVISÃO DE COORDENADA: fallback detectado - confirmar no mapa]',
            )
            app.save(fc)
            console.log(
              '0039: Cliente marcado para revisão de coordenada:',
              fc.id,
              fc.getString('name'),
            )
          }
        }
      } catch (errFallback) {
        console.log('0039: Erro ao sanitizar fallback customers:', errFallback)
      }

      // 3. Recalcular retroativamente a entrega zcaqeqyx9lhsete (TRK-2026-224)
      try {
        var orderRosemere = app.findFirstRecordByData('orders', 'id', 'zcaqeqyx9lhsete')
        orderRosemere.set('distance_km', 1.65)
        orderRosemere.set('return_trip_km', 1.65)
        orderRosemere.set('estimated_duration_minutes', 12)
        orderRosemere.set('fuel_cost', 0.61) // 3.3 km / 35 km/l * 6.49 = 0.61
        orderRosemere.set('total_route_with_return_km', 17.2)
        orderRosemere.set('total_route_fuel_cost', 3.19)
        app.save(orderRosemere)
        console.log(
          '0039: Entrega TRK-2026-224 recalculada: 1.65 km ida, 1.65 km retorno, fuel R$ 0.61, 12 min, rota total 17.2 km / R$ 3.19',
        )
      } catch (errOrder) {
        console.log('0039: Erro ao recalcular order zcaqeqyx9lhsete:', errOrder)
      }

      // 4. Recalcular e atualizar o cabeçalho das ordens da rota ativa do courier Guilherme (u6zr2qtcos1ljxd)
      try {
        var activeBatchOrders = app.findRecordsByFilter(
          'orders',
          "courier_id = 'u6zr2qtcos1ljxd' && route_released = true && route_finished = false",
          'sequence,created',
          100,
          0,
        )

        for (var b = 0; b < activeBatchOrders.length; b++) {
          var bo = activeBatchOrders[b]
          bo.set('total_route_with_return_km', 17.2)
          bo.set('total_route_fuel_cost', 3.19)
          app.save(bo)
          console.log(
            '0039: Ordem de rota ativa do Guilherme atualizada para totais 17.2 km / R$ 3.19:',
            bo.id,
            bo.getString('tracking_code'),
          )
        }
      } catch (errBatch) {
        console.log('0039: Erro ao atualizar cabeçalho de rota ativa de Guilherme:', errBatch)
      }

      console.log('0039: Migração concluída com sucesso.')
    } catch (eGlobal) {
      console.log('0039: Falha na migração:', eGlobal)
      throw eGlobal
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
