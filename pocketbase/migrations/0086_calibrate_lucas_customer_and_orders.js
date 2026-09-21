/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0086_calibrate_lucas_customer_and_orders.js
    //
    // Objetivo cirúrgico:
    // Atualizar o cliente "Lucas" (id `geuykjt3q71qsyg`) para as coordenadas exatas
    // confirmadas pelo usuário via link do Google Maps:
    // lat = -22.690215, lng = -43.3033778
    // E atualizar os dados de endereço para "Rua Isidoro Lopes, 839, Figueira, Duque de Caxias - RJ, CEP: 25245-005"
    // (com street = "Rua Isidoro Lopes, 839", neighborhood = "Figueira", postal_code = "25245-005").
    // Além disso, alinhar pedidos pendentes associados ao cliente.

    const TARGET_CUSTOMER_ID = 'geuykjt3q71qsyg'
    const CORRECT_LAT = -22.690215
    const CORRECT_LNG = -43.3033778
    const CORRECT_ADDRESS = 'Rua Isidoro Lopes, 839, Figueira, Duque de Caxias - RJ, CEP: 25245-005'
    const CORRECT_STREET = 'Rua Isidoro Lopes, 839'
    const CORRECT_NEIGHBORHOOD = 'Figueira'
    const CORRECT_CITY = 'Duque de Caxias'
    const CORRECT_STATE = 'RJ'
    const CORRECT_CEP = '25245-005'

    try {
      const customer = app.findFirstRecordByData('customers', 'id', TARGET_CUSTOMER_ID)
      if (customer) {
        console.log(
          `[0086] Atualizando cliente Lucas (${TARGET_CUSTOMER_ID}): lat=${CORRECT_LAT}, lng=${CORRECT_LNG}`,
        )
        customer.set('lat', CORRECT_LAT)
        customer.set('lng', CORRECT_LNG)
        customer.set('address', CORRECT_ADDRESS)
        customer.set('street', CORRECT_STREET)
        customer.set('neighborhood', CORRECT_NEIGHBORHOOD)
        customer.set('city', CORRECT_CITY)
        customer.set('state', CORRECT_STATE)
        customer.set('postal_code', CORRECT_CEP)
        app.save(customer)
        console.log(`[0086] Cliente ${TARGET_CUSTOMER_ID} calibrado com sucesso.`)
      }
    } catch (err) {
      console.warn(`[0086] Erro ao buscar/atualizar cliente ${TARGET_CUSTOMER_ID}:`, err)
    }

    // Alinhar pedidos associados ao cliente Lucas se houver end_address ou dados apontando para antigas coordenadas
    try {
      const orders = app.findRecordsByFilter(
        'orders',
        `customer_id = '${TARGET_CUSTOMER_ID}'`,
        '-created',
        50,
        0,
      )
      console.log(`[0086] Encontrados ${orders.length} pedido(s) associado(s) ao cliente Lucas.`)
      for (let i = 0; i < orders.length; i++) {
        const order = orders[i]
        let orderChanged = false
        const currentEndLat = order.getFloat('end_address_lat')
        const currentEndLng = order.getFloat('end_address_lng')

        // Se o pedido tiver coordenadas de entrega definidas e divergentes do pino calibrado
        if (currentEndLat !== 0 && currentEndLng !== 0) {
          if (
            Math.abs(currentEndLat - CORRECT_LAT) > 0.0001 ||
            Math.abs(currentEndLng - CORRECT_LNG) > 0.0001
          ) {
            order.set('end_address_lat', CORRECT_LAT)
            order.set('end_address_lng', CORRECT_LNG)
            order.set('end_address_text', CORRECT_ADDRESS)
            orderChanged = true
          }
        }

        if (orderChanged) {
          app.save(order)
          console.log(
            `[0086] Pedido ${order.getString('id')} atualizado com coordenadas calibradas.`,
          )
        }
      }
    } catch (oErr) {
      console.warn(`[0086] Erro ao atualizar pedidos do cliente Lucas:`, oErr)
    }

    console.log('[0086] Migração de calibração do cliente Lucas finalizada.')
  },
  (app) => {
    // Reversão no-op
  },
)
