/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 1. customers: permitir leitura pública (listRule e viewRule vazias = "")
    // Isso é indispensável para que a tela pública de rastreamento (/track/:tracking_code)
    // consiga expandir customer_id sem exigir autenticação, trazendo nome e endereço do destinatário.
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (customersCol) {
        customersCol.listRule = ''
        customersCol.viewRule = ''
        app.save(customersCol)
        console.log('0063: Regras de customers liberadas para leitura pública')
      }
    } catch (err) {
      console.log('0063: Erro ao atualizar regras de customers:', err)
    }

    // 2. locations: permitir leitura pública (listRule e viewRule vazias = "")
    // Permite que o cliente final visualize o marcador e o deslocamento em tempo real do entregador
    try {
      const locationsCol = app.findCollectionByNameOrId('locations')
      if (locationsCol) {
        locationsCol.listRule = ''
        locationsCol.viewRule = ''
        app.save(locationsCol)
        console.log('0063: Regras de locations liberadas para leitura pública')
      }
    } catch (err) {
      console.log('0063: Erro ao atualizar regras de locations:', err)
    }

    // 3. Garantir orders com listRule e viewRule públicas ("")
    try {
      const ordersCol = app.findCollectionByNameOrId('orders')
      if (ordersCol) {
        ordersCol.listRule = ''
        ordersCol.viewRule = ''
        app.save(ordersCol)
        console.log('0063: Regras de orders confirmadas como públicas')
      }
    } catch (err) {
      console.log('0063: Erro ao atualizar regras de orders:', err)
    }
  },
  (app) => {
    try {
      const customersCol = app.findCollectionByNameOrId('customers')
      if (customersCol) {
        customersCol.listRule = '@request.auth.id != ""'
        customersCol.viewRule = '@request.auth.id != ""'
        app.save(customersCol)
      }
    } catch (_) {}

    try {
      const locationsCol = app.findCollectionByNameOrId('locations')
      if (locationsCol) {
        locationsCol.listRule = '@request.auth.id != ""'
        locationsCol.viewRule = '@request.auth.id != ""'
        app.save(locationsCol)
      }
    } catch (_) {}
  },
)
