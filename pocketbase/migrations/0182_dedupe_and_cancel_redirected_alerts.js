/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0182:
  // 1. Cancelar/reprovar alertas pendentes de pedidos redirecionados (o ponto B já é aprovado pelo fluxo próprio de redirecionamento).
  // 2. Agrupar alertas duplicados (mesmo pedido / mesmo cliente na mesma entrega) e manter apenas o de MELHOR precisão (menor accuracy),
  //    reprovando os demais com motivo "duplicado (mesma entrega, melhor leitura preservada)".
  // 3. Registrar audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true.

  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  let pendingAlerts = []
  try {
    pendingAlerts = app.findRecordsByFilter(
      'address_alerts',
      "status = 'pendente'",
      '-created',
      1000,
      0,
    )
  } catch (err) {
    console.log(
      '[0182_dedupe_and_cancel_redirected_alerts] Erro ao buscar address_alerts pendentes:',
      err,
    )
    return
  }

  console.log(`[0182_dedupe] Total de alertas pendentes encontrados: ${pendingAlerts.length}`)

  // 1. Identificar e cancelar alertas de pedidos redirecionados
  let cancelledRedirectedCount = 0
  const remainingAlerts = []

  for (let i = 0; i < pendingAlerts.length; i++) {
    const alert = pendingAlerts[i]
    const notes = alert.getString('notes') || ''
    const matchTrk = notes.match(/TRK-[0-9-]+/)
    let isRedirected = false
    let matchedOrder = null

    if (matchTrk) {
      const trk = matchTrk[0]
      try {
        const orderList = app.findRecordsByFilter(
          'orders',
          `tracking_code = '${trk}'`,
          '-created',
          1,
          0,
        )
        if (orderList.length > 0) {
          matchedOrder = orderList[0]
          isRedirected = Boolean(
            matchedOrder.getBool('is_redirected') ||
            matchedOrder.getString('redirection_status') === 'completed' ||
            matchedOrder.getString('redirection_status') === 'initiated' ||
            matchedOrder.getString('redirection_status') === 'in_progress' ||
            matchedOrder.getString('redirection_new_address') ||
            matchedOrder.getFloat('redirection_point_a_lat') > 0,
          )
        }
      } catch (eOrd) {
        console.log(`[0182_dedupe] Erro ao verificar pedido ${trk}:`, eOrd)
      }
    }

    if (isRedirected && matchedOrder) {
      // Reprovar alerta de entrega redirecionada
      const oldNotes = alert.getString('notes') || ''
      const cancelReason = 'cancelado: entrega redirecionada (ponto B aprovado pelo fluxo próprio)'
      alert.set('status', 'reprovado')
      alert.set('reviewed_at', now)
      alert.set('notes', oldNotes ? `${oldNotes} | ${cancelReason}` : cancelReason)

      try {
        app.save(alert)
        cancelledRedirectedCount++
        console.log(
          `[0182_dedupe] Alerta #${alert.id} de pedido redirecionado ${matchedOrder.getString('tracking_code')} cancelado/reprovado.`,
        )

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'alerta_pin_suprimido_redirecionamento')
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
            customer_id: alert.getString('customer'),
            order_id: matchedOrder.id,
            tracking_code: matchedOrder.getString('tracking_code'),
            reason: cancelReason,
          })
          app.save(auditRec)
        }
      } catch (saveErr) {
        console.log(`[0182_dedupe] Falha ao reprovar alerta #${alert.id}:`, saveErr)
      }
    } else {
      remainingAlerts.push(alert)
    }
  }

  console.log(
    `[0182_dedupe] Alertas de pedidos redirecionados cancelados: ${cancelledRedirectedCount}`,
  )

  // 2. Agrupar alertas pendentes restantes por grupo de entrega (tracking_code se houver, ou customer)
  const groups = {}
  for (let i = 0; i < remainingAlerts.length; i++) {
    const alert = remainingAlerts[i]
    const notes = alert.getString('notes') || ''
    const matchTrk = notes.match(/TRK-[0-9-]+/)
    const custId = alert.getString('customer') || 'unknown'
    const groupKey = matchTrk ? `order_${matchTrk[0]}` : `customer_${custId}`

    if (!groups[groupKey]) {
      groups[groupKey] = []
    }
    groups[groupKey].push(alert)
  }

  let totalDuplicateAlertsReproved = 0
  const groupStats = {}

  const groupKeys = Object.keys(groups)
  for (let k = 0; k < groupKeys.length; k++) {
    const gKey = groupKeys[k]
    const alertList = groups[gKey]

    if (alertList.length <= 1) {
      continue
    }

    // Ordenar do menor accuracy (melhor precisão) para o maior
    alertList.sort((a, b) => {
      let accA = 9999
      let accB = 9999
      try {
        const sA = JSON.parse(a.getString('suggested_address') || '{}')
        accA = Number(sA.accuracy || sA.accuracy_meters || sA.gps_accuracy || 9999)
      } catch (_) {}
      try {
        const sB = JSON.parse(b.getString('suggested_address') || '{}')
        accB = Number(sB.accuracy || sB.accuracy_meters || sB.gps_accuracy || 9999)
      } catch (_) {}

      if (accA !== accB) return accA - accB
      // Fallback: mais recente primeiro
      const tA = new Date(a.getString('created')).getTime()
      const tB = new Date(b.getString('created')).getTime()
      return tB - tA
    })

    const bestAlert = alertList[0]
    let bestAcc = 9999
    try {
      const sBest = JSON.parse(bestAlert.getString('suggested_address') || '{}')
      bestAcc = Number(sBest.accuracy || sBest.accuracy_meters || 9999)
    } catch (_) {}

    const reprovedIds = []

    for (let j = 1; j < alertList.length; j++) {
      const dup = alertList[j]
      let dupAcc = 9999
      try {
        const sDup = JSON.parse(dup.getString('suggested_address') || '{}')
        dupAcc = Number(sDup.accuracy || sDup.accuracy_meters || 9999)
      } catch (_) {}

      const oldNotes = dup.getString('notes') || ''
      const reasonText = `duplicado (mesma entrega, melhor leitura preservada #${bestAlert.id} com precisão ${bestAcc}m vs ${dupAcc}m)`

      dup.set('status', 'reprovado')
      dup.set('reviewed_at', now)
      dup.set('notes', oldNotes ? `${oldNotes} | ${reasonText}` : reasonText)

      try {
        app.save(dup)
        reprovedIds.push(dup.id)
        totalDuplicateAlertsReproved++

        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('actor_name', 'Sistema')
          auditRec.set('action', 'descarte_alerta_duplicado')
          auditRec.set('collection', 'address_alerts')
          auditRec.set('record_id', dup.id)
          auditRec.set('field', 'status')
          auditRec.set('old_value', 'pendente')
          auditRec.set('new_value', 'reprovado')
          auditRec.set('timestamp', now)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            actor_role: 'system',
            group_key: gKey,
            kept_alert_id: bestAlert.id,
            kept_accuracy_meters: bestAcc,
            discarded_alert_id: dup.id,
            discarded_accuracy_meters: dupAcc,
            customer_id: dup.getString('customer'),
            reason: reasonText,
          })
          app.save(auditRec)
        }
      } catch (errDupSave) {
        console.log(`[0182_dedupe] Erro ao reprovar alerta duplicado #${dup.id}:`, errDupSave)
      }
    }

    groupStats[gKey] = {
      kept: bestAlert.id,
      reproved_count: reprovedIds.length,
      reproved_ids: reprovedIds,
    }
    console.log(
      `[0182_dedupe] Grupo ${gKey}: mantido #${bestAlert.id} (acc=${bestAcc}m), reprovados ${reprovedIds.length} alertas: [${reprovedIds.join(', ')}]`,
    )
  }

  // Registrar resumo final em audit_trail
  try {
    if (auditCol) {
      const summaryAudit = new Record(auditCol)
      summaryAudit.set('user_id', '')
      summaryAudit.set('actor_name', 'Sistema')
      summaryAudit.set('action', 'migracao_deduplicacao_address_alerts_resumo')
      summaryAudit.set('collection', 'address_alerts')
      summaryAudit.set('record_id', 'migration_0182')
      summaryAudit.set('field', 'status')
      summaryAudit.set('old_value', 'pendente')
      summaryAudit.set('new_value', 'reprovado')
      summaryAudit.set('timestamp', now)
      summaryAudit.set('metadata', {
        system_trigger: true,
        actor_name: 'Sistema',
        actor_role: 'system',
        total_cancelled_redirected: cancelledRedirectedCount,
        total_duplicate_alerts_reproved: totalDuplicateAlertsReproved,
        groups: groupStats,
      })
      app.save(summaryAudit)
    }
  } catch (eSummary) {
    console.log('[0182_dedupe] Erro ao salvar resumo no audit_trail:', eSummary)
  }

  console.log(
    `[0182_dedupe] Concluído: ${totalDuplicateAlertsReproved} alertas duplicados reprovados e ${cancelledRedirectedCount} alertas de pedidos redirecionados cancelados.`,
  )
})
