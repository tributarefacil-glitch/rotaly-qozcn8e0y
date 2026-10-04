/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0112: Saneamento do pedido TRK-2026-15041870 (MARCIA FERNANDA, cliente b7paufzpkce9kws)
    // Nasceu indevidamente com end_address apontando para a base Mais Saudavel (-22.6990563, -43.296723)
    // enquanto o cliente real tem coordenadas e endereço corretos:
    // Rua Olímpia, 40, PILAR, Duque de Caxias - RJ (lat -22.702327, lng -43.2979205).
    // Corrige end_address_lat, end_address_lng, end_address_text, end_address_name
    // e registra o saneamento na coleção audit_trail.

    let adminUserId = ''
    try {
      const masterUser = app.findFirstRecordByFilter('users', "role = 'master' || role = 'admin'")
      if (masterUser) {
        adminUserId = masterUser.id
      }
    } catch (_) {}

    try {
      const order = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-15041870' || id = 'j5hhx7i2kf8vvgh'",
      )

      if (!order) {
        console.warn('[0112] Pedido TRK-2026-15041870 não encontrado.')
        return
      }

      const oldName = order.getString('end_address_name')
      const oldText = order.getString('end_address_text')
      const oldLat = order.get('end_address_lat')
      const oldLng = order.get('end_address_lng')
      const courierId = order.getString('courier_id')

      // Buscar cliente b7paufzpkce9kws
      let custName = 'MARCIA FERNANDA'
      let custAddress = 'Rua Olímpia, NUMERO 40, PILAR, Duque de Caxias - RJ, CEP: 25215-100'
      let custLat = -22.702327
      let custLng = -43.2979205

      try {
        const customer = app.findRecordById('customers', 'b7paufzpkce9kws')
        if (customer) {
          custName = customer.getString('name') || custName
          custAddress = customer.getString('address') || custAddress
          const cLat = Number(customer.get('lat'))
          const cLng = Number(customer.get('lng'))
          if (!isNaN(cLat) && !isNaN(cLng) && (cLat !== 0 || cLng !== 0)) {
            custLat = cLat
            custLng = cLng
          }
        }
      } catch (custErr) {
        console.warn('[0112] Aviso ao buscar customer b7paufzpkce9kws:', custErr)
      }

      order.set('end_address_name', custName)
      order.set('end_address_text', custAddress)
      order.set('end_address_lat', custLat)
      order.set('end_address_lng', custLng)
      app.save(order)

      console.log(
        `[0112] Pedido TRK-2026-15041870 saneado: destino corrigido de ${oldName} (${oldLat}, ${oldLng}) para ${custName} (${custLat}, ${custLng}).`,
      )

      // Registrar em audit_trail
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          if (adminUserId) {
            auditRec.set('user_id', adminUserId)
          }
          if (courierId) {
            auditRec.set('courier_id', courierId)
          }
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', order.id)
          auditRec.set('action', 'sanitize_base_destination')
          auditRec.set('field', 'end_address')
          auditRec.set('old_value', `${oldText} (${oldLat}, ${oldLng})`)
          auditRec.set('new_value', `${custAddress} (${custLat}, ${custLng})`)
          auditRec.set('timestamp', new Date().toISOString())
          auditRec.set('metadata', {
            tracking_code: 'TRK-2026-15041870',
            reason: 'Correção automática: destino do pedido coincidia com a base',
            customer_id: 'b7paufzpkce9kws',
            customer_name: custName,
          })
          app.save(auditRec)
          console.log('[0112] Trilha de auditoria gravada em audit_trail.')
        }
      } catch (auditErr) {
        console.warn('[0112] Aviso ao gravar audit_trail:', auditErr)
      }
    } catch (err) {
      console.error('[0112] Erro no saneamento do pedido TRK-2026-15041870:', err)
      throw err
    }
  },
  (app) => {
    // Reverter para os dados anteriores se necessário
    try {
      const order = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-15041870' || id = 'j5hhx7i2kf8vvgh'",
      )
      if (order) {
        order.set('end_address_name', 'Mais Saudavel')
        order.set(
          'end_address_text',
          'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil',
        )
        order.set('end_address_lat', -22.6990563)
        order.set('end_address_lng', -43.296723)
        app.save(order)
      }
    } catch (_) {}
  },
)
