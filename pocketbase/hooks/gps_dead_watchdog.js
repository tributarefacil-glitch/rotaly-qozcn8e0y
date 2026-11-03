// pocketbase/hooks/gps_dead_watchdog.js
// ITEM 2: DETECTOR DE GPS MORTO (>10 MINUTOS SEM PINGS EM ROTA ATIVA)
// Executa a cada 5 minutos via cronAdd('gps_dead_watchdog', '*/5 * * * *')
// Verifica entregadores que possuem rota iniciada ativa (route_started=true && route_finished=false)
// Se não houver nenhum ping em locations nos últimos 10 minutos:
// Dispara alerta na audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true)
// e cria notificação para a central/vendedor/admin. Deduplica para não gerar spam contínuo (máx 1 alerta a cada 30 min por lote/entregador).

cronAdd('gps_dead_watchdog', '*/5 * * * *', () => {
  const TEN_MIN_MS = 10 * 60 * 1000
  const THIRTY_MIN_MS = 30 * 60 * 1000
  const now = Date.now()
  const tenMinutesAgoIso = new Date(now - TEN_MIN_MS).toISOString()
  const thirtyMinutesAgoIso = new Date(now - THIRTY_MIN_MS).toISOString()

  try {
    // 1. Buscar pedidos com rota ativa em andamento
    const activeOrders = $app.findRecordsByFilter(
      'orders',
      "route_started = true && route_finished = false && status != 'cancelled'",
      '-route_started_at',
      200,
      0,
    )

    if (!activeOrders || activeOrders.length === 0) {
      return
    }

    // Agrupar pedidos ativos por entregador (courier_id)
    const couriersMap = {}
    for (let i = 0; i < activeOrders.length; i++) {
      const ord = activeOrders[i]
      const cId = (ord.getString('courier_id') || '').trim()
      if (!cId) continue
      if (!couriersMap[cId]) {
        couriersMap[cId] = {
          courierId: cId,
          batchKey: ord.getString('route_batch_key') || '',
          startedAt: ord.getString('route_started_at') || ord.getString('created'),
          empresaId: ord.getString('empresa_id') || '',
          sellerId: ord.getString('seller_id') || '',
          firstOrderId: ord.id,
          trackingCode: ord.getString('tracking_code') || '',
          orderCount: 1,
        }
      } else {
        couriersMap[cId].orderCount++
      }
    }

    const courierIds = Object.keys(couriersMap)
    for (let c = 0; c < courierIds.length; c++) {
      const cId = courierIds[c]
      const cData = couriersMap[cId]

      // Se a rota foi iniciada há menos de 10 minutos, ainda está na janela de início
      const startMs = new Date(cData.startedAt).getTime()
      if (now - startMs < TEN_MIN_MS) {
        continue
      }

      // Buscar último ping em locations deste entregador
      let lastPingRecord = null
      try {
        const recentPings = $app.findRecordsByFilter(
          'locations',
          `user_id = '${cId}'`,
          '-created',
          1,
          0,
        )
        if (recentPings && recentPings.length > 0) {
          lastPingRecord = recentPings[0]
        }
      } catch (errPing) {
        console.warn(
          `[gps_dead_watchdog] Erro ao consultar locations para entregador ${cId}:`,
          errPing,
        )
      }

      let isGpsDead = false
      let minutesSinceLast = 999
      let lastPingIso = 'nenhum_registrado'

      if (!lastPingRecord) {
        isGpsDead = true
        minutesSinceLast = Math.round((now - startMs) / 60000)
      } else {
        const lastPingTime = new Date(
          lastPingRecord.getString('location_timestamp') || lastPingRecord.getString('created'),
        ).getTime()
        lastPingIso = lastPingRecord.getString('created')
        const diffMs = now - lastPingTime
        if (diffMs >= TEN_MIN_MS) {
          isGpsDead = true
          minutesSinceLast = Math.round(diffMs / 60000)
        }
      }

      if (!isGpsDead) {
        continue
      }

      // 2. Deduplicação de alerta: verificar se já geramos alerta para este entregador nos últimos 30 min
      let recentDeadAudit = []
      try {
        recentDeadAudit = $app.findRecordsByFilter(
          'audit_trail',
          `courier_id = '${cId}' && action = 'alerta_gps_morto' && timestamp >= '${thirtyMinutesAgoIso}'`,
          '-timestamp',
          1,
          0,
        )
      } catch (_) {}

      if (recentDeadAudit && recentDeadAudit.length > 0) {
        // Já alertado recentemente, não re-alertar em spam
        continue
      }

      // Obter nome do entregador para o alerta
      let courierName = cId
      try {
        const uRec = $app.findRecordById('users', cId)
        if (uRec) {
          courierName = uRec.getString('name') || uRec.getString('email') || cId
        }
      } catch (_) {}

      console.warn(
        `[gps_dead_watchdog] ALERTA: Entregador ${courierName} (${cId}) em rota ativa (${cData.batchKey}) sem nenhum ping de GPS há ${minutesSinceLast} minutos!`,
      )

      // 3. Registrar na audit_trail com o padrão do Rotaly:
      // user_id='', actor_name='Sistema', metadata.system_trigger=true
      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '') // Sistema
          auditRec.set('collection', 'locations')
          auditRec.set('record_id', cData.firstOrderId)
          auditRec.set('courier_id', cId)
          auditRec.set('action', 'alerta_gps_morto')
          auditRec.set('field', 'telemetria_gps')
          auditRec.set('old_value', `ultimo_ping: ${lastPingIso}`)
          auditRec.set('new_value', `gps_inativo_${minutesSinceLast}_minutos`)
          auditRec.set('timestamp', new Date().toISOString())
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            alerta: 'GPS MORTO / SEM TELEMETRIA',
            courier_id: cId,
            courier_name: courierName,
            route_batch_key: cData.batchKey,
            minutes_without_ping: minutesSinceLast,
            last_ping_at: lastPingIso,
            active_orders_count: cData.orderCount,
            note: `Entregador em rota há mais de 10 minutos sem envio de coordenadas GPS pelo aparelho. Possível encerramento do app em segundo plano pelo sistema operacional.`,
          })
          $app.save(auditRec)
        }
      } catch (errAudit) {
        console.warn('[gps_dead_watchdog] Erro ao gravar audit_trail:', errAudit)
      }

      // 4. Criar notificação para a central/vendedor se aplicável
      try {
        const notifCol = $app.findCollectionByNameOrId('notifications')
        if (notifCol) {
          const notif = new Record(notifCol)
          notif.set('user_id', cData.sellerId || '')
          notif.set('order_id', cData.firstOrderId)
          notif.set('type', 'warning')
          notif.set('title', '📡 GPS Sem Sinal (>10 min)')
          notif.set(
            'message',
            `Entregador ${courierName} está sem enviar coordenadas GPS há ${minutesSinceLast} minutos na rota ativa (${cData.batchKey || 'lote em andamento'}).`,
          )
          notif.set('is_read', false)
          $app.save(notif)
        }
      } catch (_) {}
    }
  } catch (errMain) {
    console.error('[gps_dead_watchdog] Erro geral na execução:', errMain)
  }
})
