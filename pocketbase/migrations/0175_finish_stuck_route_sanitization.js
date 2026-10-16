/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  const now = new Date().toISOString()

  // 1. Desvincular pedidos novos não iniciados (route_started=false) que herdaram
  // indevidamente a chave rb_mxvhhwb5i46zjq2_20261016_29869192
  try {
    const unstartedOrders = app.findRecordsByFilter(
      'orders',
      "route_batch_key = 'rb_mxvhhwb5i46zjq2_20261016_29869192' && route_started = false",
      'created',
      100,
      0,
    )

    for (const ord of unstartedOrders) {
      ord.set('route_batch_key', '')
      app.save(ord)
      console.log(
        `[0175_finish_stuck_route_sanitization] Pedido futuro ${ord.id} desvinculado do lote anterior.`,
      )
    }
  } catch (eUnstarted) {
    console.warn(
      '[0175_finish_stuck_route_sanitization] Erro ao desvincular pedidos não iniciados:',
      eUnstarted,
    )
  }

  // 2. Localizar todas as rotas/pedidos com route_started=true e route_finished=false
  // onde todas as paradas foram entregues ou finalizadas (status in delivered, address_error, client_absent, cancelled)
  try {
    const activeOrders = app.findRecordsByFilter(
      'orders',
      'route_started = true && route_finished = false',
      'created',
      500,
      0,
    )

    // Agrupar por lote ou entregador
    const byBatch = {}
    for (const ord of activeOrders) {
      const key = ord.getString('route_batch_key') || ord.getString('courier_id') || 'unknown'
      if (!byBatch[key]) byBatch[key] = []
      byBatch[key].push(ord)
    }

    const auditCol = app.findCollectionByNameOrId('audit_trail')

    for (const key of Object.keys(byBatch)) {
      const batchList = byBatch[key]
      const allCompleted = batchList.every((o) => {
        const st = o.getString('status')
        return (
          st === 'delivered' ||
          st === 'address_error' ||
          st === 'client_absent' ||
          st === 'cancelled'
        )
      })

      if (allCompleted) {
        console.log(
          `[0175_finish_stuck_route_sanitization] Fechando lote preso ${key} (${batchList.length} pedidos 100% concluídos)...`,
        )
        const courierId = batchList[0].getString('courier_id')
        const firstOrderId = batchList[0].id

        for (const ord of batchList) {
          ord.set('route_finished', true)
          ord.set('route_finished_at', now)
          app.save(ord)
        }

        // Liberar entregador se houver
        if (courierId) {
          try {
            const courierRecord = app.findRecordById('users', courierId)
            if (courierRecord) {
              courierRecord.set('status', 'active')
              app.save(courierRecord)
            }
          } catch (eCourier) {
            console.warn(
              '[0175_finish_stuck_route_sanitization] Erro ao liberar entregador:',
              eCourier,
            )
          }
        }

        // Registrar saneamento em audit_trail: user_id vazio, actor_name='Sistema', metadata.system_trigger=true
        try {
          if (auditCol) {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', firstOrderId)
            auditRec.set('courier_id', courierId || '')
            auditRec.set('action', 'saneamento_rota_presa')
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
              note: 'Rota sanada automaticamente pelo sistema: todas as paradas já haviam sido entregues mas o lote permanecia aberto devido a conflito de chave de lote',
            })
            app.save(auditRec)
          }
        } catch (eAudit) {
          console.warn(
            '[0175_finish_stuck_route_sanitization] Erro ao registrar audit_trail:',
            eAudit,
          )
        }
      }
    }
  } catch (eActive) {
    console.warn(
      '[0175_finish_stuck_route_sanitization] Erro geral ao sanear rotas ativas:',
      eActive,
    )
  }
})
