/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0193 (v0.0.531):
  // Limpeza de flag/nota espúria de fallback para pedidos e clientes em aberto que possuem coordenadas válidas
  // (no pedido end_address_lat/lng ou no cliente lat/lng).
  //
  // Regras estritas:
  // - A resolução de coordenadas segue: 1º endereço gravado no pedido, depois coordenadas do cliente.
  // - Clientes com coordenadas reais e válidas não podem carregar nota residual 'fallback detectado'.
  // - NUNCA inventar coordenadas: clientes sem nenhuma coordenada real permanecem intocados/bloqueados.
  // - Toda limpeza é auditada em audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true).

  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  const CONTINGENCY_LAT = -22.906847
  const CONTINGENCY_LNG = -43.172896
  const TOLERANCE = 0.0001

  const isContingencyOrZero = (lat, lng) => {
    if (lat === null || lat === undefined || isNaN(lat)) return true
    if (lng === null || lng === undefined || isNaN(lng)) return true
    if (lat === 0 && lng === 0) return true
    if (Math.abs(lat) < 0.000001 && Math.abs(lng) < 0.000001) return true
    const dLat = Math.abs(lat - CONTINGENCY_LAT)
    const dLng = Math.abs(lng - CONTINGENCY_LNG)
    return dLat <= TOLERANCE && dLng <= TOLERANCE
  }

  // 1. Limpeza de notas espúrias em clientes que possuem coordenadas reais válidas
  try {
    let suspectCustomers = []
    try {
      suspectCustomers = app.findRecordsByFilter(
        'customers',
        "notes ~ 'fallback detectado'",
        'created',
        200,
        0,
      )
    } catch (e) {
      console.log('[0193_pin_fallback_cleanup] Erro ao buscar clientes com fallback detectado:', e)
    }

    for (let ci = 0; ci < suspectCustomers.length; ci++) {
      const cust = suspectCustomers[ci]
      const cLat = cust.getFloat('lat')
      const cLng = cust.getFloat('lng')

      // Verificar se possui coordenada válida e que NÃO seja a de contingência
      if (!isContingencyOrZero(cLat, cLng)) {
        const oldNotes = cust.getString('notes') || ''
        // Remover a frase "[REVISÃO DE COORDENADA: fallback detectado - confirmar no mapa]" ou "fallback detectado"
        let newNotes = oldNotes
          .replace(/\[REVISÃO DE COORDENADA:\s*fallback detectado\s*-\s*confirmar no mapa\]/gi, '')
          .replace(/fallback detectado/gi, '')
          .replace(/\s+\|\s+$/, '')
          .replace(/^\s+\|\s+/, '')
          .trim()

        cust.set('notes', newNotes)
        app.save(cust)
        console.log(
          `[0193_pin_fallback_cleanup] Cliente #${cust.id} (${cust.getString('name')}) teve nota de fallback limpa: coordenadas reais (${cLat}, ${cLng}) confirmadas.`,
        )

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'customer_pin_fallback_note_cleaned')
          auditRec.set('collection', 'customers')
          auditRec.set('record_id', cust.id)
          auditRec.set('field', 'notes')
          auditRec.set('old_value', oldNotes)
          auditRec.set('new_value', newNotes)
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            customer_id: cust.id,
            customer_name: cust.getString('name'),
            lat: cLat,
            lng: cLng,
            reason:
              'Limpeza de nota residual de fallback: cliente possui coordenadas reais e válidas no cadastro/endereços.',
          })
          app.save(auditRec)
        }
      }
    }
  } catch (errCust) {
    console.log('[0193_pin_fallback_cleanup] Erro no processamento de clientes:', errCust)
  }

  // 2. Limpeza em pedidos que porventura tenham notas residuais de fallback mas possuem coordenadas válidas
  try {
    let suspectOrders = []
    try {
      suspectOrders = app.findRecordsByFilter(
        'orders',
        "notes ~ 'fallback detectado'",
        'created',
        200,
        0,
      )
    } catch (_) {}

    for (let oi = 0; oi < suspectOrders.length; oi++) {
      const ord = suspectOrders[oi]
      const endLat = ord.getFloat('end_address_lat')
      const endLng = ord.getFloat('end_address_lng')

      if (!isContingencyOrZero(endLat, endLng)) {
        const oldNotes = ord.getString('notes') || ''
        let newNotes = oldNotes
          .replace(/\[REVISÃO DE COORDENADA:\s*fallback detectado\s*-\s*confirmar no mapa\]/gi, '')
          .replace(/fallback detectado/gi, '')
          .trim()

        ord.set('notes', newNotes)
        app.save(ord)

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'order_pin_fallback_note_cleaned')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', ord.id)
          auditRec.set('field', 'notes')
          auditRec.set('old_value', oldNotes)
          auditRec.set('new_value', newNotes)
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            order_id: ord.id,
            tracking_code: ord.getString('tracking_code'),
            lat: endLat,
            lng: endLng,
            reason: 'Limpeza de nota residual de fallback em pedido com coordenadas válidas.',
          })
          app.save(auditRec)
        }
      }
    }
  } catch (errOrd) {
    console.log('[0193_pin_fallback_cleanup] Erro no processamento de pedidos:', errOrd)
  }

  console.log('[0193_pin_fallback_cleanup] Migração 0193 concluída com sucesso.')
})
