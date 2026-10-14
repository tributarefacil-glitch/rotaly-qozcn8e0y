/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0171:
  // Deduplicação de address_alerts existentes (passado).
  // Agrupar por customer + coordenadas aproximadas (<30m) ou criados com poucos segundos de diferença.
  // Manter 1 de cada grupo (priorizando aprovado ou mais recente), mesclar aprovação e registrar descarte em audit_trail.

  const haversineDistMeters = (lat1, lon1, lat2, lon2) => {
    const R = 6371000
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLon = ((lon2 - lon1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
        Math.cos((lat2 * Math.PI) / 180) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  const auditCol = app.findCollectionByNameOrId('audit_trail')
  const rows = []
  try {
    app
      .db()
      .newQuery('SELECT id, customer, status, current_address, suggested_address, created, reviewed_at, reviewed_by, notes FROM address_alerts ORDER BY customer, created DESC')
      .all(rows)
  } catch (err) {
    console.log('[0171_migration] Erro na query raw de address_alerts:', err)
  }

  console.log('[0171_migration] Total de registros em address_alerts:', rows.length)

  // Agrupar por customer
  const alertsByCustomer = {}
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const custId = r.customer
    if (!custId) continue
    if (!alertsByCustomer[custId]) alertsByCustomer[custId] = []
    alertsByCustomer[custId].push(r)
  }

  let totalDiscarded = 0
  const customerIds = Object.keys(alertsByCustomer)

  for (let c = 0; c < customerIds.length; c++) {
    const custId = customerIds[c]
    const list = alertsByCustomer[custId]
    if (list.length <= 1) continue

    const discardedIds = new Set()

    for (let i = 0; i < list.length; i++) {
      const primaryRow = list[i]
      if (discardedIds.has(primaryRow.id)) continue

      let pSugg = {}
      let pCurr = {}
      try { pSugg = JSON.parse(primaryRow.suggested_address || '{}') } catch (_) {}
      try { pCurr = JSON.parse(primaryRow.current_address || '{}') } catch (_) {}
      const pLat = Number(pSugg.lat || pCurr.lat || 0)
      const pLng = Number(pSugg.lng || pCurr.lng || 0)

      for (let j = i + 1; j < list.length; j++) {
        const candidateRow = list[j]
        if (discardedIds.has(candidateRow.id)) continue

        let cSugg = {}
        let cCurr = {}
        try { cSugg = JSON.parse(candidateRow.suggested_address || '{}') } catch (_) {}
        try { cCurr = JSON.parse(candidateRow.current_address || '{}') } catch (_) {}
        const cLat = Number(cSugg.lat || cCurr.lat || 0)
        const cLng = Number(cSugg.lng || cCurr.lng || 0)

        let dist = Infinity
        if (pLat !== 0 && pLng !== 0 && cLat !== 0 && cLng !== 0) {
          dist = haversineDistMeters(pLat, pLng, cLat, cLng)
        }

        const pTime = new Date(primaryRow.created).getTime()
        const cTime = new Date(candidateRow.created).getTime()
        const diffSeconds = Math.abs(pTime - cTime) / 1000

        // Duplicata se mesma coordenada (<30m) OU janela recente (<300s com mesma coordenada aproximada <100m)
        const isDuplicate = dist <= 30 || (diffSeconds <= 300 && dist <= 100)

        if (isDuplicate) {
          let keeperRow = primaryRow
          let toDiscardRow = candidateRow
          if (candidateRow.status === 'aprovado' && primaryRow.status !== 'aprovado') {
            keeperRow = candidateRow
            toDiscardRow = primaryRow
          }

          // Se toDiscard estava aprovado e keeper não, promover keeper
          if (toDiscardRow.status === 'aprovado' && keeperRow.status !== 'aprovado') {
            try {
              const keeperRecord = app.findRecordById('address_alerts', keeperRow.id)
              keeperRecord.set('status', 'aprovado')
              keeperRecord.set('reviewed_at', toDiscardRow.reviewed_at || new Date().toISOString())
              keeperRecord.set('reviewed_by', toDiscardRow.reviewed_by || '')
              app.save(keeperRecord)
            } catch (errKeep) {
              console.log('[0171_migration] Falha ao promover keeper:', errKeep)
            }
          }

          // Registrar no audit_trail
          if (auditCol) {
            try {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '') // relation vazia para Sistema
              auditRec.set('collection', 'address_alerts')
              auditRec.set('record_id', toDiscardRow.id)
              auditRec.set('action', 'descarte_alerta_duplicado')
              auditRec.set('field', 'status')
              auditRec.set('old_value', toDiscardRow.status)
              auditRec.set('new_value', 'descartado_por_duplicidade')
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                customer_id: custId,
                kept_alert_id: keeperRow.id,
                discarded_alert_id: toDiscardRow.id,
                distance_between_meters: Number(dist.toFixed(1)),
                time_difference_seconds: Math.round(diffSeconds),
                reason: 'Deduplicação de alertas do passado conforme item 4',
              })
              app.save(auditRec)
            } catch (aErr) {
              console.log('[0171_migration] Erro ao gravar audit_trail:', aErr)
            }
          }

          // Excluir a cópia duplicada
          try {
            const toDiscardRec = app.findRecordById('address_alerts', toDiscardRow.id)
            app.delete(toDiscardRec)
            discardedIds.add(toDiscardRow.id)
            totalDiscarded++
            console.log(`[0171_migration] Alerta duplicado #${toDiscardRow.id} descartado (mantido #${keeperRow.id})`)
          } catch (delErr) {
            console.log(`[0171_migration] Falha ao excluir alerta #${toDiscardRow.id}:`, delErr)
          }

          if (toDiscardRow === primaryRow) {
            break
          }
        }
      }
    }
  }

  console.log(`[0171_migration] Concluída deduplicação. Total de duplicatas descartadas: ${totalDiscarded}`)
})
