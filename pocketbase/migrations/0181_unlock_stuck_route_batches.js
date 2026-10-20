/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  // PASSADO: Localizar todas as rotas/pedidos com route_started=true e route_finished=false
  // em que todas as entregas do lote já foram concluídas (delivered, unsuccessful, cancelled, address_error, client_absent)
  // Destravar o lote rb_u6zr2qtcos1ljxd_20261018_29872700 e qualquer outro lote similar preso.
  try {
    const openOrders = app.findRecordsByFilter(
      'orders',
      'route_started = true && route_finished = false',
      'created',
      500,
      0,
    )

    console.log(
      `[0181_unlock_stuck_route_batches] Localizados ${openOrders.length} pedido(s) em aberto com route_started=true e route_finished=false.`,
    )

    const byBatch = {}
    for (const ord of openOrders) {
      const key = ord.getString('route_batch_key') || ord.getString('courier_id') || 'unknown'
      if (!byBatch[key]) byBatch[key] = []
      byBatch[key].push(ord)
    }

    for (const key of Object.keys(byBatch)) {
      const batchList = byBatch[key]
      const allCompleted = batchList.every((o) => {
        const st = o.getString('status')
        return (
          st === 'delivered' ||
          st === 'unsuccessful' ||
          st === 'address_error' ||
          st === 'client_absent' ||
          st === 'cancelled'
        )
      })

      if (allCompleted && batchList.length > 0) {
        console.log(
          `[0181_unlock_stuck_route_batches] Destravando lote preso ${key} (${batchList.length} pedidos concluídos)...`,
        )
        const courierId = batchList[0].getString('courier_id')
        const firstOrderId = batchList[0].id

        for (const ord of batchList) {
          ord.set('route_finished', true)
          ord.set('route_finished_at', now)
          app.save(ord)
        }

        // Liberar entregador se estiver em status diferente de active
        if (courierId) {
          try {
            const courierRecord = app.findRecordById('users', courierId)
            if (courierRecord) {
              courierRecord.set('status', 'active')
              app.save(courierRecord)
              console.log(
                `[0181_unlock_stuck_route_batches] Entregador ${courierId} liberado com status 'active'.`,
              )
            }
          } catch (eCourier) {
            console.warn('[0181_unlock_stuck_route_batches] Erro ao liberar entregador:', eCourier)
          }
        }

        // Registrar saneamento em audit_trail:
        // user_id vazio, actor_name='Sistema', metadata.system_trigger=true
        try {
          if (auditCol) {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrderId)
            auditRec.set('courier_id', courierId || '')
            auditRec.set('action', 'saneamento_destrave_lote_geofence')
            auditRec.set('field', 'route_finished')
            auditRec.set('old_value', 'false')
            auditRec.set('new_value', 'true')
            auditRec.set('timestamp', now)
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              actor_role: 'system',
              route_batch_key: key,
              orders_count: batchList.length,
              note: 'Lote destravado pelo sistema: entregador estava no geofence da base com paradas 100% concluídas e fechamento preso em validação de destino',
            })
            app.save(auditRec)
          }
        } catch (eAudit) {
          console.warn('[0181_unlock_stuck_route_batches] Erro ao registrar audit_trail:', eAudit)
        }
      }
    }
  } catch (eGeneral) {
    console.warn('[0181_unlock_stuck_route_batches] Erro ao verificar lotes abertos:', eGeneral)
  }
})
