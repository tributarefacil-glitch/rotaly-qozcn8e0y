/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0170:
  // Executar a deduplicação de address_alerts via app.findRecordsByFilter com filtro vazio (ou status != '')
  // Mesclar dados/aprovação e registrar o descarte em audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true.

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
  let allAlerts = []
  try {
    allAlerts = app.findRecordsByFilter(
      'address_alerts',
      'created != ""',
      '-created',
      2000,
      0,
    )
  } catch (err) {
    console.log('[0170_migration] Erro ao buscar address_alerts:', err)
  }

  // Agrupar por customer
  const alertsByCustomer = {}
  for (let i = 0; i < allAlerts.length; i++) {
    const al = allAlerts[i]
    const custId = al.getString('customer')
    if (!custId) continue
    if (!alertsByCustomer[custId]) alertsByCustomer[custId] = []
    alertsByCustomer[custId].push(al)
  }

  let totalAlertDuplicatesDiscarded = 0
  const customerIds = Object.keys(alertsByCustomer)

  for (let c = 0; c < customerIds.length; c++) {
    const custId = customerIds[c]
    const list = alertsByCustomer[custId]
    if (list.length <= 1) continue

    const discardedIds = new Set()

    for (let i = 0; i < list.length; i++) {
      const primary = list[i]
      if (discardedIds.has(primary.id)) continue

      let pSugg = {}
      try {
        pSugg = primary.get('suggested_address') || {}
      } catch (_) {}
      const pLat = Number(pSugg.lat || (primary.get('current_address') || {}).lat || 0)
      const pLng = Number(pSugg.lng || (primary.get('current_address') || {}).lng || 0)

      for (let j = i + 1; j < list.length; j++) {
        const candidate = list[j]
        if (discardedIds.has(candidate.id)) continue

        let cSugg = {}
        try {
          cSugg = candidate.get('suggested_address') || {}
        } catch (_) {}
        const cLat = Number(cSugg.lat || (candidate.get('current_address') || {}).lat || 0)
        const cLng = Number(cSugg.lng || (candidate.get('current_address') || {}).lng || 0)

        let dist = Infinity
        if (pLat !== 0 && pLng !== 0 && cLat !== 0 && cLng !== 0) {
          dist = haversineDistMeters(pLat, pLng, cLat, cLng)
        }

        const pTime = new Date(primary.getString('created')).getTime()
        const cTime = new Date(candidate.getString('created')).getTime()
        const diffSeconds = Math.abs(pTime - cTime) / 1000

        // Se a distância for menor que 30m ou foram gerados com menos de 300s de diferença para o mesmo cliente
        const isDuplicate = dist <= 30 || (diffSeconds <= 300 && dist <= 100)

        if (isDuplicate) {
          let keeper = primary
          let toDiscard = candidate
          if (candidate.getString('status') === 'aprovado' && primary.getString('status') !== 'aprovado') {
            keeper = candidate
            toDiscard = primary
          }

          if (toDiscard.getString('status') === 'aprovado' && keeper.getString('status') !== 'aprovado') {
            keeper.set('status', 'aprovado')
            keeper.set('reviewed_at', toDiscard.getString('reviewed_at') || new Date().toISOString())
            keeper.set('reviewed_by', toDiscard.getString('reviewed_by') || '')
            app.save(keeper)
          }

          if (auditCol) {
            try {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '')
              auditRec.set('collection', 'address_alerts')
              auditRec.set('record_id', toDiscard.id)
              auditRec.set('action', 'descarte_alerta_duplicado')
              auditRec.set('field', 'status')
              auditRec.set('old_value', toDiscard.getString('status'))
              auditRec.set('new_value', 'descartado_por_duplicidade')
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                customer_id: custId,
                kept_alert_id: keeper.id,
                discarded_alert_id: toDiscard.id,
                distance_between_meters: Number(dist.toFixed(1)),
                time_difference_seconds: Math.round(diffSeconds),
                reason: 'Deduplicação de alertas do passado conforme item 4',
              })
              app.save(auditRec)
            } catch (aErr) {
              console.log('[0170_migration] Erro ao gravar audit_trail:', aErr)
            }
          }

          try {
            app.delete(toDiscard)
            discardedIds.add(toDiscard.id)
            totalAlertDuplicatesDiscarded++
            console.log(`[0170_migration] Alerta duplicado #${toDiscard.id} descartado (mantido #${keeper.id})`)
          } catch (delErr) {
            console.log(`[0170_migration] Falha ao excluir alerta #${toDiscard.id}:`, delErr)
          }

          if (toDiscard === primary) {
            break
          }
        }
      }
    }
  }

  console.log(`[0170_migration] Concluída deduplicação de alertas do passado. Total descartado: ${totalAlertDuplicatesDiscarded}`)
})
