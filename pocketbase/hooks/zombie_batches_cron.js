/**
 * pocketbase/hooks/zombie_batches_cron.js
 *
 * FALHA 3: Job agendado a cada 60 min (cronAdd) para gerenciar lotes zumbis:
 * 1. Lote aberto há >12h: dispara alerta/notificação aos administradores.
 * 2. Lote aberto há >24h: encerra automaticamente com audit_trail
 *    (user_id="", actor_name='Sistema', metadata.system_trigger=true)
 *    e processa telemetria canônica com o que existir.
 */

cronAdd('hourly_zombie_batches_check', '0 * * * *', () => {
  try {
    const nowMs = Date.now()
    const twelveHoursAgoMs = nowMs - 12 * 60 * 60 * 1000
    const twentyFourHoursAgoMs = nowMs - 24 * 60 * 60 * 1000
    const fortyEightHoursAgoMs = nowMs - 48 * 60 * 60 * 1000

    const formatPbDateStr = (d) => {
      return d
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z?$/, '')
    }

    const minDateStr = formatPbDateStr(new Date(fortyEightHoursAgoMs))
    const twelveHoursStr = formatPbDateStr(new Date(twelveHoursAgoMs))

    // Buscar pedidos abertos criados ou atualizados entre 12h e 48h atrás
    let candidateOrders = []
    try {
      candidateOrders = $app.findRecordsByFilter(
        'orders',
        `(route_finished = false || route_finished = null) && status != 'cancelled' && (route_started_at != '' || created >= '${minDateStr}')`,
        '-created',
        500,
        0,
      )
    } catch (eFind) {
      console.warn('[zombie_batches_cron] Erro ao buscar pedidos candidatos:', eFind)
      return
    }

    if (!candidateOrders || candidateOrders.length === 0) {
      return
    }

    // Agrupar por route_batch_key (ou sintetizada por courier + dia)
    const batchesMap = {}
    for (let i = 0; i < candidateOrders.length; i++) {
      const ord = candidateOrders[i]
      let bKey = ord.getString('route_batch_key')
      const courierId = ord.getString('courier_id')
      if (!bKey && courierId) {
        const sRaw = ord.getString('route_started_at') || ord.getString('created')
        const sDate = new Date(sRaw)
        const yyyy = sDate.getFullYear()
        const mm = String(sDate.getMonth() + 1).padStart(2, '0')
        const dd = String(sDate.getDate()).padStart(2, '0')
        const sMin = Math.floor(sDate.getTime() / 60000)
        bKey = `rb_${courierId}_${yyyy}${mm}${dd}_${sMin}`
      }
      if (!bKey) continue

      if (!batchesMap[bKey]) {
        batchesMap[bKey] = {
          route_batch_key: bKey,
          courier_id: courierId,
          empresa_id: ord.getString('empresa_id'),
          orders: [],
          oldestStartMs: Infinity,
          latestUpdateMs: 0,
        }
      }

      batchesMap[bKey].orders.push(ord)
      const startMs = new Date(
        ord.getString('route_started_at') || ord.getString('created'),
      ).getTime()
      if (startMs > 0 && startMs < batchesMap[bKey].oldestStartMs) {
        batchesMap[bKey].oldestStartMs = startMs
      }
      const upMs = new Date(ord.getString('updated') || ord.getString('created')).getTime()
      if (upMs > batchesMap[bKey].latestUpdateMs) {
        batchesMap[bKey].latestUpdateMs = upMs
      }
    }

    const auditCol = $app.findCollectionByNameOrId('audit_trail')
    const notifCol = $app.findCollectionByNameOrId('notifications')

    const batchKeys = Object.keys(batchesMap)
    for (let k = 0; k < batchKeys.length; k++) {
      const bKey = batchKeys[k]
      const batchInfo = batchesMap[bKey]
      const batchStartMs =
        batchInfo.oldestStartMs === Infinity ? batchInfo.latestUpdateMs : batchInfo.oldestStartMs
      const ageHours = (nowMs - batchStartMs) / (1000 * 60 * 60)

      let courierName = 'Entregador'
      if (batchInfo.courier_id) {
        try {
          const cUser = $app.findRecordById('users', batchInfo.courier_id)
          if (cUser)
            courierName = cUser.getString('name') || cUser.getString('email') || courierName
        } catch (_) {}
      }

      // CASO 1: Aberto há > 24 horas -> AUTO-ENCERRAMENTO
      if (ageHours >= 24) {
        console.log(
          `[zombie_batches_cron] Lote zumbi >24h detectado: ${bKey} (${ageHours.toFixed(1)}h). Encerrando automaticamente...`,
        )
        const nowIso = new Date().toISOString()

        for (let oIdx = 0; oIdx < batchInfo.orders.length; oIdx++) {
          const ord = batchInfo.orders[oIdx]
          try {
            ord.set('route_finished', true)
            ord.set('route_finished_at', nowIso)
            ord.set('route_batch_key', bKey)
            $app.save(ord)
          } catch (errSaveOrd) {
            console.warn(`[zombie_batches_cron] Erro ao encerrar pedido ${ord.id}:`, errSaveOrd)
          }
        }

        // Liberar status do entregador se necessário
        if (batchInfo.courier_id) {
          try {
            const cUser = $app.findRecordById('users', batchInfo.courier_id)
            if (cUser && cUser.getString('status') !== 'active') {
              cUser.set('status', 'active')
              $app.save(cUser)
            }
          } catch (_) {}
        }

        // Registrar audit_trail (user_id="", actor_name='Sistema', metadata.system_trigger=true)
        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '') // relation aceita vazio
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', batchInfo.orders[0].id)
            if (batchInfo.courier_id) auditRec.set('courier_id', batchInfo.courier_id)
            if (batchInfo.empresa_id) auditRec.set('empresa_id', batchInfo.empresa_id)
            auditRec.set('action', 'auto_fechamento_lote_zumbi_24h')
            auditRec.set('field', 'route_finished')
            auditRec.set('old_value', 'false')
            auditRec.set('new_value', 'true')
            auditRec.set('timestamp', nowIso)
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              actor_role: 'system',
              route_batch_key: bKey,
              orders_count: batchInfo.orders.length,
              age_hours: Number(ageHours.toFixed(1)),
              courier_name: courierName,
              note: 'Auto-encerramento executado por rotina agendada de lote zumbi (>24h em aberto)',
            })
            $app.save(auditRec)
          } catch (errAudit) {
            console.warn('[zombie_batches_cron] Erro ao gravar audit_trail:', errAudit)
          }
        }

        // Chamar endpoint interno de processamento de telemetria canônica
        try {
          $http.send({
            url: `http://127.0.0.1:8090/backend/v1/telemetria-lote/processar`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ route_batch_key: bKey }),
            timeout: 15,
          })
        } catch (_) {}

        // CASO 2: Aberto há > 12 horas e < 24 horas -> ALERTA ADMIN (com deduplicação de 6 horas)
      } else if (ageHours >= 12) {
        let recentNotifs = []
        try {
          const sixHoursAgoIso = new Date(nowMs - 6 * 60 * 60 * 1000).toISOString()
          recentNotifs = $app.findRecordsByFilter(
            'notifications',
            `type = 'warning' && title ~ 'Lote Aberto há mais de 12h' && order_id = '${batchInfo.orders[0].id}' && created >= '${sixHoursAgoIso}'`,
            '-created',
            1,
            0,
          )
        } catch (_) {}

        if (recentNotifs.length === 0 && notifCol) {
          try {
            const adminUsers = $app.findRecordsByFilter(
              'users',
              `(role = 'admin' || role = 'master') && status = 'active'`,
              '-created',
              10,
              0,
            )
            const warningTitle = '⚠️ Lote Aberto há mais de 12h'
            const warningMsg = `O lote ${bKey} do entregador ${courierName} com ${batchInfo.orders.length} pedido(s) está aberto há ${ageHours.toFixed(0)}h. Verifique a finalização da rota.`

            for (let a = 0; a < adminUsers.length; a++) {
              const adm = adminUsers[a]
              try {
                const nRec = new Record(notifCol)
                nRec.set('user_id', adm.id)
                nRec.set('order_id', batchInfo.orders[0].id)
                nRec.set('type', 'warning')
                nRec.set('title', warningTitle)
                nRec.set('message', warningMsg)
                nRec.set('is_read', false)
                $app.save(nRec)
              } catch (_) {}
            }
          } catch (errAdmNotif) {
            console.warn(
              '[zombie_batches_cron] Erro ao notificar admins sobre lote >12h:',
              errAdmNotif,
            )
          }
        }
      }
    }
  } catch (globalCronErr) {
    console.warn(
      '[zombie_batches_cron] Erro global na execução do cron de lotes zumbis:',
      globalCronErr,
    )
  }
})
