/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0183:
  // PASSADO:
  // 1. Para TODO alerta pendente (status='pendente', origin='pin_entregador'):
  //    Comparar as coordenadas do suggested_address (ou courier_lat/lng) contra o lat/lng ATUAL do cadastro do customer.
  //    Se distToCustM <= 150m, trata-se de falso positivo (o pin de entrega coincide com o pin já calibrado/cadastrado).
  //    Cancelar/reprovar com motivo claro:
  //    "cancelado: falso positivo — pin sugerido idêntico/<=150m do pin calibrado do cadastro"
  //    Registrar audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true.
  //    Isso limpa os 26 alertas pendentes do RAFA e os 2 da Elaine (0xuukymq2vtbxua e 6rnt68sap0qu5qr).
  //
  // 2. Limpar entrega_geofence_flag='pendente_aprovacao_gt_500m' e entrega_fora_pin_m em pedidos cujo
  //    end_address_lat/lng (ou delivery_lat/lng) esteja a <= 150m do pin cadastrado do customer.
  //    Especialmente TRK-2026-09443441 (RAFA) e TRK-2026-50676594 (Elaine).
  //    Registrar audit_trail para cada pedido limpo.

  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  const haversineDistMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000
    const toRad = (d) => (d * Math.PI) / 180
    const dLat = toRad(lat2 - lat1)
    const dLon = toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return Math.round(R * c)
  }

  // PARTE 1: Varredura de address_alerts pendentes
  let pendingAlerts = []
  try {
    pendingAlerts = app.findRecordsByFilter(
      'address_alerts',
      "status = 'pendente' && origin = 'pin_entregador'",
      '-created',
      1000,
      0,
    )
  } catch (err) {
    console.log('[0183_anti_falso_positivo] Erro ao buscar address_alerts:', err)
    pendingAlerts = []
  }

  console.log(
    `[0183_anti_falso_positivo] Total de alertas pendentes pin_entregador: ${pendingAlerts.length}`,
  )

  let cancelledAlertsCount = 0
  const statsByCustomer = {}
  const cancelledAlertIds = []

  for (let i = 0; i < pendingAlerts.length; i++) {
    const alert = pendingAlerts[i]
    const customerId = alert.getString('customer')
    if (!customerId) continue

    let custRec = null
    try {
      custRec = app.findRecordById('customers', customerId)
    } catch (_) {}

    if (!custRec) continue

    const custLat = custRec.getFloat('lat') || 0
    const custLng = custRec.getFloat('lng') || 0
    const custName = custRec.getString('name') || customerId

    if (custLat === 0 && custLng === 0) continue

    // Extrair lat/lng sugerido do alerta
    let suggLat = 0
    let suggLng = 0
    try {
      const suggObj = JSON.parse(alert.getString('suggested_address') || '{}')
      suggLat = Number(suggObj.lat || 0)
      suggLng = Number(suggObj.lng || 0)
    } catch (_) {}

    // Fallback se não estiver no JSON
    if (suggLat === 0 && suggLng === 0) {
      suggLat = alert.getFloat('courier_lat') || 0
      suggLng = alert.getFloat('courier_lng') || 0
    }

    if (suggLat === 0 && suggLng === 0) continue

    const distToCustM = haversineDistMeters(suggLat, suggLng, custLat, custLng)

    // Se estiver a <= 150m do pin cadastrado do cliente, é falso positivo garantido!
    if (distToCustM <= 150) {
      const oldNotes = alert.getString('notes') || ''
      const cancelReason = `cancelado: falso positivo — pin sugerido (${suggLat.toFixed(6)}, ${suggLng.toFixed(6)}) idêntico/≤150m do pin calibrado do cadastro (${custLat.toFixed(6)}, ${custLng.toFixed(6)}, dist ${distToCustM}m)`

      alert.set('status', 'reprovado')
      alert.set('reviewed_at', now)
      alert.set('notes', oldNotes ? `${oldNotes} | ${cancelReason}` : cancelReason)

      try {
        app.save(alert)
        cancelledAlertsCount++
        cancelledAlertIds.push(alert.id)

        if (!statsByCustomer[custName]) {
          statsByCustomer[custName] = { customerId, count: 0, alertIds: [] }
        }
        statsByCustomer[custName].count++
        statsByCustomer[custName].alertIds.push(alert.id)

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'alerta_falso_positivo_cancelado')
          auditRec.set('collection', 'address_alerts')
          auditRec.set('record_id', alert.id)
          auditRec.set('field', 'status')
          auditRec.set('old_value', 'pendente')
          auditRec.set('new_value', 'reprovado')
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            alert_id: alert.id,
            customer_id: customerId,
            customer_name: custName,
            dist_to_cust_pin_m: distToCustM,
            old_distance_meters: alert.getFloat('distance_meters'),
            reason: cancelReason,
          })
          app.save(auditRec)
        }
      } catch (saveErr) {
        console.log(`[0183_anti_falso_positivo] Erro ao reprovar alerta #${alert.id}:`, saveErr)
      }
    }
  }

  console.log(
    `[0183_anti_falso_positivo] Alertas falsos positivos cancelados: ${cancelledAlertsCount}`,
    JSON.stringify(statsByCustomer),
  )

  // PARTE 2: Limpar entrega_geofence_flag='pendente_aprovacao_gt_500m' de pedidos entregues no pin cadastrado (<=150m)
  let ordersToClean = []
  try {
    ordersToClean = app.findRecordsByFilter(
      'orders',
      "entrega_geofence_flag = 'pendente_aprovacao_gt_500m'",
      '-created',
      500,
      0,
    )
  } catch (errO) {
    console.log('[0183_anti_falso_positivo] Erro ao buscar pedidos com geofence pendente:', errO)
    ordersToClean = []
  }

  let cleanedOrdersCount = 0
  for (let j = 0; j < ordersToClean.length; j++) {
    const ord = ordersToClean[j]
    const customerId = ord.getString('customer_id')
    if (!customerId) continue

    let custRec = null
    try {
      custRec = app.findRecordById('customers', customerId)
    } catch (_) {}

    if (!custRec) continue

    const custLat = custRec.getFloat('lat') || 0
    const custLng = custRec.getFloat('lng') || 0
    if (custLat === 0 && custLng === 0) continue

    const endLat = ord.getFloat('end_address_lat') || 0
    const endLng = ord.getFloat('end_address_lng') || 0
    const delLat = ord.getFloat('delivery_lat') || endLat
    const delLng = ord.getFloat('delivery_lng') || endLng

    if (delLat === 0 && delLng === 0) continue

    const distM = haversineDistMeters(delLat, delLng, custLat, custLng)

    if (distM <= 150) {
      const oldFlag = ord.getString('entrega_geofence_flag')
      const oldDist = ord.getFloat('entrega_fora_pin_m')
      const trackingCode = ord.getString('tracking_code')

      ord.set('entrega_geofence_flag', 'ok')
      ord.set('entrega_fora_pin_m', 0)

      try {
        app.save(ord)
        cleanedOrdersCount++
        console.log(
          `[0183_anti_falso_positivo] Pedido ${trackingCode} (#${ord.id}) saneado: flag limpa para 'ok', desvio zerado (dist real ${distM}m).`,
        )

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'geofence_falso_positivo_limpo')
          auditRec.set('collection', 'orders')
          auditRec.set('record_id', ord.id)
          auditRec.set('field', 'entrega_geofence_flag')
          auditRec.set('old_value', oldFlag)
          auditRec.set('new_value', 'ok')
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            order_id: ord.id,
            tracking_code: trackingCode,
            customer_id: customerId,
            dist_to_cust_pin_m: distM,
            old_entrega_fora_pin_m: oldDist,
            reason:
              'Entrega confirmada no pin calibrado do cliente (<=150m); falso positivo gt_500m saneado.',
          })
          app.save(auditRec)
        }
      } catch (errSaveOrd) {
        console.log(`[0183_anti_falso_positivo] Falha ao salvar pedido #${ord.id}:`, errSaveOrd)
      }
    }
  }

  console.log(`[0183_anti_falso_positivo] Total de pedidos saneados: ${cleanedOrdersCount}`)
})
