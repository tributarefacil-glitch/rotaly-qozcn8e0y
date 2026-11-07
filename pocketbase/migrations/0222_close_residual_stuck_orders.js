/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0222 - Fechamento idempotente dos pedidos e lotes resíduos:
 * - z8auaad3pjvwk4m (Thayane, TRK-2026-97176003, lote rb_mxvhhwb5i46zjq2_20261106_29900089 do Breno)
 * - p7omzmiftj72g6e (Clarice, TRK-2026-05416403, lote rb_u6zr2qtcos1ljxd_20261022_29878023)
 * - qpuo7cozrk162sh (Juliana, TRK-2026-54198241, lote rb_u6zr2qtcos1ljxd_20261024_29881244)
 *
 * Ações executadas:
 * 1. Marca pedidos como status='delivered', completion_reason='system_auto_close',
 *    route_finished=true, route_finished_at=nowIso.
 * 2. Propaga route_finished=true para todos os pedidos irmãos desses lotes.
 * 3. Registra em audit_trail ação do Sistema (user_id vazio, actor_name='Sistema',
 *    metadata.system_trigger=true).
 * 4. Fecha episódios de desvio abertos vinculados a esses pedidos/lotes em off_route_events.
 * 5. Dispara requisição de telemetria canônica do lote via endpoint local.
 */
migrate(
  (app) => {
    const targetIds = ['z8auaad3pjvwk4m', 'p7omzmiftj72g6e', 'qpuo7cozrk162sh']
    const nowIso = new Date().toISOString()
    const affectedBatches = new Set()

    for (let i = 0; i < targetIds.length; i++) {
      const orderId = targetIds[i]
      let order = null
      try {
        order = app.findRecordById('orders', orderId)
      } catch (_) {
        // Idempotente em bancos onde o registro não existe
        continue
      }

      if (!order) continue

      const oldStatus = order.getString('status')
      const batchKey = order.getString('route_batch_key')
      if (batchKey) affectedBatches.add(batchKey)

      const isAlreadyFinished =
        order.getBool('route_finished') &&
        (oldStatus === 'delivered' || oldStatus === 'delivered_with_exception')

      if (!isAlreadyFinished) {
        order.set('status', 'delivered')
        order.set('completion_reason', 'system_auto_close')
        order.set('route_finished', true)
        if (!order.getString('route_finished_at')) {
          order.set('route_finished_at', nowIso)
        }
        app.save(order)
        console.log(`0222: Pedido ${orderId} atualizado para delivered/route_finished=true`)

        // Auditoria
        try {
          const auditCol = app.findCollectionByNameOrId('audit_trail')
          if (auditCol) {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', order.id)
            const courierId = order.getString('courier_id')
            if (courierId) auditRec.set('courier_id', courierId)
            const empresaId = order.getString('empresa_id')
            if (empresaId) auditRec.set('empresa_id', empresaId)
            auditRec.set('action', 'auto_close_lote_misto')
            auditRec.set('field', 'status')
            auditRec.set('old_value', oldStatus || 'in_transit')
            auditRec.set('new_value', 'delivered')
            auditRec.set('timestamp', nowIso)
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              actor_role: 'system',
              tracking_code: order.getString('tracking_code'),
              route_batch_key: batchKey,
              reason: 'Fechamento de residuo de lote misto em producao.',
              note: 'Fechamento executado pela migracao 0222 com completion_reason=system_auto_close.',
            })
            app.save(auditRec)
          }
        } catch (eAudit) {
          console.warn('0222: Erro ao registrar audit_trail para ' + orderId + ':', eAudit)
        }
      }

      // Fechar eventos de desvio ligados diretamente ao pedido
      try {
        const devEvents = app.findRecordsByFilter(
          'off_route_events',
          `order_id = '${orderId}'`,
          '-created',
          50,
          0,
        )
        for (let d = 0; d < devEvents.length; d++) {
          const ev = devEvents[d]
          const notes = ev.getString('notes') || ''
          if (!notes.includes('[fechado')) {
            const epStart = new Date(ev.getString('created')).getTime()
            const totalDur = Math.max(1, Math.round((Date.now() - epStart) / 1000))
            ev.set('stop_duration_seconds', totalDur)
            ev.set('notes', `${notes} [fechado - lote concluído em ${nowIso.slice(11, 19)} UTC]`)
            app.save(ev)
          }
        }
      } catch (eDev) {
        console.warn('0222: Erro ao fechar off_route_events por order_id:', eDev)
      }
    }

    // Propagar route_finished=true em todos os irmãos dos lotes afetados
    affectedBatches.forEach((batchKey) => {
      try {
        const siblings = app.findRecordsByFilter(
          'orders',
          `route_batch_key = '${batchKey}'`,
          'sequence',
          200,
          0,
        )
        for (let s = 0; s < siblings.length; s++) {
          const sib = siblings[s]
          if (!sib.getBool('route_finished')) {
            sib.set('route_finished', true)
            if (!sib.getString('route_finished_at')) {
              sib.set('route_finished_at', nowIso)
            }
            app.save(sib)
            console.log(
              `0222: Propagado route_finished=true no irmao ${sib.id} do lote ${batchKey}`,
            )
          }
        }

        // Fechar episódios de desvio abertos do lote (por notes ~ batchKey)
        try {
          const batchDevs = app.findRecordsByFilter(
            'off_route_events',
            `notes ~ '${batchKey}'`,
            '-created',
            50,
            0,
          )
          for (let b = 0; b < batchDevs.length; b++) {
            const bev = batchDevs[b]
            const bnotes = bev.getString('notes') || ''
            if (!bnotes.includes('[fechado')) {
              const epStart = new Date(bev.getString('created')).getTime()
              const totalDur = Math.max(1, Math.round((Date.now() - epStart) / 1000))
              bev.set('stop_duration_seconds', totalDur)
              bev.set(
                'notes',
                `${bnotes} [fechado - lote concluído em ${nowIso.slice(11, 19)} UTC]`,
              )
              app.save(bev)
            }
          }
        } catch (eBatchDev) {
          console.warn('0222: Erro ao fechar off_route_events por batchKey:', eBatchDev)
        }

        // Disparo de telemetria canônica
        try {
          $http.send({
            url: 'http://127.0.0.1:8090/backend/v1/telemetria-lote/processar',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_batch_key: batchKey }),
            timeout: 15,
          })
        } catch (_) {}
      } catch (eBatch) {
        console.warn('0222: Erro ao propagar lote ' + batchKey + ':', eBatch)
      }
    })
  },
  () => {
    // Migração de dados de fechamento irreversível/idempotente
  },
)
