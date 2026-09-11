migrate(
  (app) => {
    // 1. Corrigir cliente "Vanessa" (id: ay4fzzyv3yebkvx): Rua Antonio Carlos Pinheiro 28, Pilar, Duque de Caxias - RJ
    try {
      const vanessa = app.findRecordById('customers', 'ay4fzzyv3yebkvx')
      vanessa.set('lat', -22.6989279)
      vanessa.set('lng', -43.2947187)
      vanessa.set('city', 'Duque de Caxias')
      vanessa.set('neighborhood', 'Pilar')
      vanessa.set('state', 'RJ')
      vanessa.set('postal_code', '25230-480')
      app.save(vanessa)
    } catch (e) {
      console.log('Migration 0025: cliente Vanessa não encontrado para ajuste:', e)
    }

    // 2. Corrigir clientes de demonstração legados de São Paulo para a região operacional do Rio de Janeiro / Caxias
    // Padaria Bella Paulista (bd9fhrlq25rggdw)
    try {
      const cust1 = app.findRecordById('customers', 'bd9fhrlq25rggdw')
      cust1.set(
        'address',
        'Av. Brigadeiro Lima e Silva, 1400 - Jardim Vinte e Cinco de Agosto, Duque de Caxias - RJ, 25071-182',
      )
      cust1.set('street', 'Av. Brigadeiro Lima e Silva, 1400')
      cust1.set('neighborhood', 'Jardim Vinte e Cinco de Agosto')
      cust1.set('city', 'Duque de Caxias')
      cust1.set('state', 'RJ')
      cust1.set('postal_code', '25071-182')
      cust1.set('lat', -22.7915)
      cust1.set('lng', -43.3075)
      app.save(cust1)
    } catch (_) {}

    // Restaurante Fogo Vivo (tkgvxfgxwju14tr)
    try {
      const cust2 = app.findRecordById('customers', 'tkgvxfgxwju14tr')
      cust2.set(
        'address',
        'Rua General Dionísio, 500 - Jardim Vinte e Cinco de Agosto, Duque de Caxias - RJ, 25075-095',
      )
      cust2.set('street', 'Rua General Dionísio, 500')
      cust2.set('neighborhood', 'Jardim Vinte e Cinco de Agosto')
      cust2.set('city', 'Duque de Caxias')
      cust2.set('state', 'RJ')
      cust2.set('postal_code', '25075-095')
      cust2.set('lat', -22.7885)
      cust2.set('lng', -43.3052)
      app.save(cust2)
    } catch (_) {}

    // Drogaria Saúde Total (stu3j3mhhrc684o)
    try {
      const cust3 = app.findRecordById('customers', 'stu3j3mhhrc684o')
      cust3.set('address', 'Av. Presidente Kennedy, 1600 - Centro, Duque de Caxias - RJ, 25010-001')
      cust3.set('street', 'Av. Presidente Kennedy, 1600')
      cust3.set('neighborhood', 'Centro')
      cust3.set('city', 'Duque de Caxias')
      cust3.set('state', 'RJ')
      cust3.set('postal_code', '25010-001')
      cust3.set('lat', -22.7871)
      cust3.set('lng', -43.3108)
      app.save(cust3)
    } catch (_) {}

    // Mercado Central Jardins (3xstxd4uj6a6jk7)
    try {
      const cust4 = app.findRecordById('customers', '3xstxd4uj6a6jk7')
      cust4.set('address', 'Rua Marechal Deodoro, 320 - Centro, Duque de Caxias - RJ, 25010-040')
      cust4.set('street', 'Rua Marechal Deodoro, 320')
      cust4.set('neighborhood', 'Centro')
      cust4.set('city', 'Duque de Caxias')
      cust4.set('state', 'RJ')
      cust4.set('postal_code', '25010-040')
      cust4.set('lat', -22.7932)
      cust4.set('lng', -43.3121)
      app.save(cust4)
    } catch (_) {}

    // Tech Solutions SP (glah4b13lyrfghw)
    try {
      const cust5 = app.findRecordById('customers', 'glah4b13lyrfghw')
      cust5.set(
        'address',
        'Rua Doutor Plínio Casado, 120 - Centro, Duque de Caxias - RJ, 25010-030',
      )
      cust5.set('street', 'Rua Doutor Plínio Casado, 120')
      cust5.set('neighborhood', 'Centro')
      cust5.set('city', 'Duque de Caxias')
      cust5.set('state', 'RJ')
      cust5.set('postal_code', '25010-030')
      cust5.set('lat', -22.792)
      cust5.set('lng', -43.3115)
      app.save(cust5)
    } catch (_) {}

    // 3. Corrigir pedido 9uyvr4w789vnbnv que herdou start_base_lat e end_address_lat com coordenadas antigas de SP (-23.5593836)
    // Percurso real entre Mais Saudável (Pilar, Caxias: -22.7001402, -43.2982834) e Pimenta Verde Ecommerce (Centro, Caxias: -22.7825804, -43.3132682) = ~12.2 km ida / 12.2 km volta = 24.4 km total
    try {
      const order = app.findRecordById('orders', '9uyvr4w789vnbnv')
      order.set('start_base_lat', -22.7001402)
      order.set('start_base_lng', -43.2982834)
      order.set('end_address_lat', -22.7001402)
      order.set('end_address_lng', -43.2982834)
      order.set('distance_km', 12.2)
      order.set('return_trip_km', 12.2)
      order.set('total_route_with_return_km', 24.4)
      order.set('fuel_cost', 2.27)
      order.set('total_route_fuel_cost', 4.54)
      order.set('estimated_duration_minutes', 38)
      app.save(order)
    } catch (e) {
      console.log('Migration 0025: pedido 9uyvr4w789vnbnv não encontrado:', e)
    }

    // 4. Remover pontos de telemetria artificial/fictícia registrados com coordenadas no centro do Rio
    // onde o app do entregador rodava fallback randômico no oceano ou centro antigo (-22.906847, -43.172896)
    try {
      app
        .db()
        .newQuery(`
      DELETE FROM locations
      WHERE lat BETWEEN -22.915 AND -22.900
        AND lng BETWEEN -43.180 AND -43.165
        AND speed IN (30, 0)
    `)
        .execute()
    } catch (e) {
      console.log('Migration 0025: limpeza de telemetria legada:', e)
    }
  },
  (app) => {
    // no-op revert
  },
)
