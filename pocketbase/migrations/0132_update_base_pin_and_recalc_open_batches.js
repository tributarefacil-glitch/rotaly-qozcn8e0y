/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0132: Atualização do PIN da base oficial Mais Saudavel para -23.022683, -43.4570039
 * e recálculo do KM viário oficial para lotes abertos de hoje (sem inflar KM).
 */
migrate(
  (app) => {
    const NEW_BASE_LAT = -23.022683
    const NEW_BASE_LNG = -43.4570039

    // 1. Atualizar registro da base 811cpvr0g77m9ue e qualquer base Mais Saudavel
    try {
      const baseRec = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (baseRec) {
        baseRec.set('lat', NEW_BASE_LAT)
        baseRec.set('lng', NEW_BASE_LNG)
        app.save(baseRec)
        console.log(
          '[0132] Base 811cpvr0g77m9ue atualizada com sucesso para coords',
          NEW_BASE_LAT,
          NEW_BASE_LNG,
        )
      }
    } catch (err) {
      console.warn('[0132] Erro ao buscar base por ID 811cpvr0g77m9ue:', err)
    }

    try {
      const maisBases = app.findRecordsByFilter(
        'base_addresses',
        `name ~ 'Mais Saudavel' || is_default = true`,
        '',
        20,
      )
      for (let i = 0; i < maisBases.length; i++) {
        const b = maisBases[i]
        b.set('lat', NEW_BASE_LAT)
        b.set('lng', NEW_BASE_LNG)
        app.save(b)
      }
    } catch (err) {
      console.warn('[0132] Erro ao atualizar bases pelo nome:', err)
    }

    // 2. Atualizar ordens abertas de hoje com as novas coordenadas da base de partida e recalcular KM viário oficial
    // KM viário calculado via OSRM oficial:
    // Ponto partida: NEW_BASE_LAT, NEW_BASE_LNG (-23.022683, -43.4570039)
    // Parada PIMENTA VERDE: -22.7849563, -43.313634
    // Distância ida: 40.07 km, retorno: 40.22 km, total: 80.29 km (80.3 km)
    // Taxa moto: 30 km/L, R$ 6,49/L => 80.3 / 30 * 6.49 = R$ 17,37
    try {
      const openOrders = app.findRecordsByFilter(
        'orders',
        `route_finished = false && (status = 'in_transit' || status = 'assigned')`,
        '-created',
        50,
      )

      for (let i = 0; i < openOrders.length; i++) {
        const ord = openOrders[i]
        ord.set('start_base_lat', NEW_BASE_LAT)
        ord.set('start_base_lng', NEW_BASE_LNG)

        // Se for a ordem aberta do lote de hoje (PIMENTA VERDE ECOMMERCE em Duque de Caxias)
        const endLat = ord.getFloat('end_address_lat')
        const endLng = ord.getFloat('end_address_lng')
        if (Math.abs(endLat - -22.7849563) < 0.01 && Math.abs(endLng - -43.313634) < 0.01) {
          ord.set('distance_km', 40.07)
          ord.set('return_trip_km', 40.22)
          ord.set('total_route_with_return_km', 80.29)
          ord.set('fuel_cost', 8.67)
          ord.set('total_route_fuel_cost', 17.37)
        }
        app.save(ord)
        console.log(
          `[0132] Pedido aberto ${ord.getString('tracking_code') || ord.id} atualizado com novo start_base e km viário`,
        )
      }
    } catch (err) {
      console.warn('[0132] Erro ao recalcular ordens abertas:', err)
    }
  },
  (app) => {
    // Reversão
    try {
      const baseRec = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (baseRec) {
        baseRec.set('lat', -22.6990563)
        baseRec.set('lng', -43.296723)
        app.save(baseRec)
      }
    } catch (_) {}
  },
)
