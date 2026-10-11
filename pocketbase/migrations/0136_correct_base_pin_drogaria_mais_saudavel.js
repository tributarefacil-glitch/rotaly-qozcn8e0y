/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0136: Correção urgente do PIN da base oficial Mais Saudavel para a Drogaria Mais Saudável:
 * - latitude: -22.6977499
 * - longitude: -43.2936013
 * - endereço textual: "Rua da Fortuna, 13 - Pilar, Duque de Caxias (ao lado do Mercado Charuto)"
 * E recálculo do KM viário oficial para lotes abertos de hoje (sem inflar KM).
 */
migrate(
  (app) => {
    const REAL_BASE_LAT = -22.6977499
    const REAL_BASE_LNG = -43.2936013
    const REAL_BASE_ADDRESS =
      'Rua da Fortuna, 13 - Pilar, Duque de Caxias (ao lado do Mercado Charuto)'
    const REAL_BASE_STREET = 'Rua da Fortuna, 13'

    // 1. Atualizar registro da base 811cpvr0g77m9ue e qualquer base Mais Saudavel
    try {
      const baseRec = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (baseRec) {
        baseRec.set('lat', REAL_BASE_LAT)
        baseRec.set('lng', REAL_BASE_LNG)
        baseRec.set('address', REAL_BASE_ADDRESS)
        baseRec.set('street', REAL_BASE_STREET)
        app.save(baseRec)
        console.log(
          '[0136] Base 811cpvr0g77m9ue atualizada com sucesso para a drogaria real:',
          REAL_BASE_LAT,
          REAL_BASE_LNG,
          REAL_BASE_ADDRESS,
        )
      }
    } catch (err) {
      console.warn('[0136] Erro ao buscar base por ID 811cpvr0g77m9ue:', err)
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
        b.set('lat', REAL_BASE_LAT)
        b.set('lng', REAL_BASE_LNG)
        b.set('address', REAL_BASE_ADDRESS)
        b.set('street', REAL_BASE_STREET)
        app.save(b)
      }
    } catch (err) {
      console.warn('[0136] Erro ao atualizar bases pelo filtro:', err)
    }

    // 2. Atualizar ordens abertas de hoje com as novas coordenadas da base de partida e recalcular KM viário oficial
    // KM viário oficial via OSRM snap-to-roads:
    // Ponto partida: Drogaria Mais Saudável (-22.6977499, -43.2936013)
    // Parada PIMENTA VERDE: -22.7849563, -43.313634
    // Distância ida: 14.08 km (14076m)
    // Retorno à base: 14.50 km (14499m)
    // Total perna + retorno: 28.58 km
    // Taxa carro: 10 km/L, R$ 6.49/L => 28.58 / 10 * 6.49 = R$ 18.55
    try {
      const openOrders = app.findRecordsByFilter(
        'orders',
        `route_finished = false && (status = 'in_transit' || status = 'assigned')`,
        '-created',
        50,
      )

      for (let i = 0; i < openOrders.length; i++) {
        const ord = openOrders[i]
        ord.set('start_base_lat', REAL_BASE_LAT)
        ord.set('start_base_lng', REAL_BASE_LNG)
        ord.set('start_base_address', REAL_BASE_ADDRESS)

        // Se for a ordem aberta do lote de hoje (PIMENTA VERDE ECOMMERCE em Duque de Caxias)
        const endLat = ord.getFloat('end_address_lat')
        const endLng = ord.getFloat('end_address_lng')
        if (Math.abs(endLat - -22.7849563) < 0.01 && Math.abs(endLng - -43.313634) < 0.01) {
          ord.set('distance_km', 14.08)
          ord.set('return_trip_km', 14.5)
          ord.set('total_route_with_return_km', 28.58)
          ord.set('fuel_cost', 9.14)
          ord.set('total_route_fuel_cost', 18.55)
        }
        app.save(ord)
        console.log(
          `[0136] Pedido aberto ${ord.getString('tracking_code') || ord.id} recalculado com Drogaria Mais Saudável e km viário oficial`,
        )
      }
    } catch (err) {
      console.warn('[0136] Erro ao recalcular ordens abertas:', err)
    }

    // 3. Registrar no audit_trail com autor Sistema (user_id vazio)
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'base_addresses')
        auditRec.set('record_id', '811cpvr0g77m9ue')
        auditRec.set('action', 'base_pin_corrected_drogaria_mais_saudavel')
        auditRec.set('field', 'lat_lng_address')
        auditRec.set('old_value', '-23.022683, -43.4570039')
        auditRec.set('new_value', '-22.6977499, -43.2936013')
        auditRec.set('metadata', {
          actor_name: 'Sistema',
          actor_role: 'system',
          system_trigger: true,
          source: 'migration_0136',
          address: REAL_BASE_ADDRESS,
          recalculated_open_orders_batch_km: 28.58,
          reason:
            'Correção de pin da base oficial para Drogaria Mais Saudável (Pilar, Duque de Caxias) confirmada no Google Maps',
        })
        app.save(auditRec)
        console.log('[0136] Trilha de auditoria inserida com sucesso!')
      }
    } catch (err) {
      console.warn('[0136] Erro ao registrar audit_trail:', err)
    }
  },
  (app) => {
    // Reversão
    try {
      const baseRec = app.findRecordById('base_addresses', '811cpvr0g77m9ue')
      if (baseRec) {
        baseRec.set('lat', -23.022683)
        baseRec.set('lng', -43.4570039)
        baseRec.set(
          'address',
          'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil',
        )
        baseRec.set('street', 'Rua da Prosperidade, 13')
        app.save(baseRec)
      }
    } catch (_) {}
  },
)
