/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0184:
  // Complemento de saneamento de alertas falsos positivos gerados por GPS transitório / rajada interna.
  //
  // Casos cobertos:
  // 1. Alertas pendentes de pedidos cujo pedido de entrega foi realizado no pin cadastrado (end_address_lat/lng ou delivery_lat/lng <= 150m do customer)
  //    ou cujo suggested_address esteja a <= 150m do customer.
  // 2. Alertas duplicados em rajada para o mesmo cliente/pedido (preservando 0 se for falso positivo, ou 1 melhor leitura se legítimo).
  //    Especificamente cliente RAFA (j1ciz6q5q1nv9pw, pedido TRK-2026-09443441, pin calibrado intocável):
  //    O pedido foi concluído com end_address_lat=-22.6764612, end_address_lng=-43.2953998 (desvio 0m do cadastro),
  //    mas um ping transitório de celular a 1.8km gerou 26 alertas pendentes repetidos. TODOS são 100% falsos positivos.
  // 3. Alertas da Elaine (0xuukymq2vtbxua e 6rnt68sap0qu5qr, cliente cteyngfui5yt4ab, pedido TRK-2026-50676594):
  //    O pedido foi entregue e redirecionado/calibrado; ambos os alertas devem ser cancelados/reprovados.
  // 4. Limpar entrega_geofence_flag='pendente_aprovacao_gt_500m' de todos os pedidos cujo end_address_lat/lng esteja a <= 150m do cliente.

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

  // 1. Buscar todos os alertas pendentes
  let pendingAlerts = []
  try {
    pendingAlerts = app.findRecordsByFilter(
      'address_alerts',
      "status = 'pendente'",
      '-created',
      1000,
      0,
    )
  } catch (e) {
    console.log('[0184_sweep] Erro ao buscar address_alerts pendentes:', e)
    pendingAlerts = []
  }

  let cancelledCount = 0
  const stats = {}

  for (let i = 0; i < pendingAlerts.length; i++) {
    const alert = pendingAlerts[i]
    const customerId = alert.getString('customer')
    const notes = alert.getString('notes') || ''
    const alertId = alert.id

    let shouldCancel = false
    let cancelReason = ''

    // Caso RAFA: cliente j1ciz6q5q1nv9pw, pedido TRK-2026-09443441
    if (customerId === 'j1ciz6q5q1nv9pw' || notes.includes('TRK-2026-09443441')) {
      shouldCancel = true
      cancelReason =
        'cancelado: falso positivo — pedido TRK-2026-09443441 entregue no pin calibrado do cliente RAFA; ping transitório de 1.8km descartado'
    }

    // Caso Elaine: cliente cteyngfui5yt4ab, pedido TRK-2026-50676594 (alertas 0xuukymq2vtbxua, 6rnt68sap0qu5qr)
    if (
      customerId === 'cteyngfui5yt4ab' ||
      notes.includes('TRK-2026-50676594') ||
      alertId === '0xuukymq2vtbxua' ||
      alertId === '6rnt68sap0qu5qr'
    ) {
      shouldCancel = true
      cancelReason =
        'cancelado: falso positivo — pedido TRK-2026-50676594 entregue/redirecionado; alerta da Elaine descartado'
    }

    // Regra geral de sanidade se ainda não marcado
    if (!shouldCancel && customerId) {
      let custRec = null
      try {
        custRec = app.findRecordById('customers', customerId)
      } catch (_) {}

      if (custRec) {
        const custLat = custRec.getFloat('lat') || 0
        const custLng = custRec.getFloat('lng') || 0

        // Verificar coordenadas do suggested_address
        let sLat = 0
        let sLng = 0
        try {
          const sObj = JSON.parse(alert.getString('suggested_address') || '{}')
          sLat = Number(sObj.lat || 0)
          sLng = Number(sObj.lng || 0)
        } catch (_) {}
        if (sLat === 0 && sLng === 0) {
          sLat = alert.getFloat('courier_lat') || 0
          sLng = alert.getFloat('courier_lng') || 0
        }

        if (custLat !== 0 && custLng !== 0 && sLat !== 0 && sLng !== 0) {
          const distToCust = haversineDistMeters(sLat, sLng, custLat, custLng)
          if (distToCust <= 150) {
            shouldCancel = true
            cancelReason = `cancelado: falso positivo — pin sugerido a ${distToCust}m (<=150m) do cadastro do cliente`
          }
        }

        // Também verificar pelo pedido referenciado nas notes
        if (!shouldCancel) {
          const mTrk = notes.match(/TRK-[0-9-]+/)
          if (mTrk) {
            try {
              const ord = app.findFirstRecordByFilter('orders', `tracking_code = '${mTrk[0]}'`)
              if (ord) {
                const endLat = ord.getFloat('end_address_lat') || 0
                const endLng = ord.getFloat('end_address_lng') || 0
                if (endLat !== 0 && endLng !== 0 && custLat !== 0 && custLng !== 0) {
                  const distOrder = haversineDistMeters(endLat, endLng, custLat, custLng)
                  if (distOrder <= 150) {
                    shouldCancel = true
                    cancelReason = `cancelado: falso positivo — pedido ${mTrk[0]} finalizado a ${distOrder}m (<=150m) do cadastro`
                  }
                }
              }
            } catch (_) {}
          }
        }
      }
    }

    if (shouldCancel) {
      alert.set('status', 'reprovado')
      alert.set('reviewed_at', now)
      alert.set('notes', notes ? `${notes} | ${cancelReason}` : cancelReason)

      try {
        app.save(alert)
        cancelledCount++
        const cKey = customerId || 'desconhecido'
        stats[cKey] = (stats[cKey] || 0) + 1

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
            reason: cancelReason,
          })
          app.save(auditRec)
        }
      } catch (errSave) {
        console.log(`[0184_sweep] Erro ao reprovar alerta #${alert.id}:`, errSave)
      }
    }
  }

  console.log(`[0184_sweep] Total de alertas cancelados: ${cancelledCount}`, JSON.stringify(stats))

  // 2. Limpar pedidos com entrega_geofence_flag='pendente_aprovacao_gt_500m'
  try {
    const ordersPending = app.findRecordsByFilter(
      'orders',
      "entrega_geofence_flag = 'pendente_aprovacao_gt_500m'",
      '-created',
      500,
      0,
    )

    for (let k = 0; k < ordersPending.length; k++) {
      const ord = ordersPending[k]
      const cId = ord.getString('customer_id')
      if (!cId) continue

      let cRec = null
      try {
        cRec = app.findRecordById('customers', cId)
      } catch (_) {}
      if (!cRec) continue

      const cLat = cRec.getFloat('lat') || 0
      const cLng = cRec.getFloat('lng') || 0
      const eLat = ord.getFloat('end_address_lat') || ord.getFloat('delivery_lat') || 0
      const eLng = ord.getFloat('end_address_lng') || ord.getFloat('delivery_lng') || 0

      if (cLat !== 0 && cLng !== 0 && eLat !== 0 && eLng !== 0) {
        const dM = haversineDistMeters(eLat, eLng, cLat, cLng)
        if (dM <= 150) {
          const oldFlag = ord.getString('entrega_geofence_flag')
          ord.set('entrega_geofence_flag', 'ok')
          ord.set('entrega_fora_pin_m', 0)
          try {
            app.save(ord)
            console.log(
              `[0184_sweep] Pedido ${ord.getString('tracking_code')} saneado (dist ${dM}m).`,
            )
          } catch (_) {}
        }
      }
    }
  } catch (errOrd) {
    console.log('[0184_sweep] Erro ao limpar pedidos:', errOrd)
  }
})
