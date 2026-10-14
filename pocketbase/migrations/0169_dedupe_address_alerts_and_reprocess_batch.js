/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0169:
  // 1. DEDUPLICAÇÃO DE ALERTAS EXISTENTES (PASSADO):
  //    Agrupar por customer + coordenadas aproximadas (dentro de ~30m).
  //    Manter 1 de cada grupo (priorizando o que já foi revisado/aprovado ou o mais recente).
  //    Mesclar dados/status se o descarte for de cópias, registrar o descarte em audit_trail:
  //    user_id='', actor_name='Sistema', metadata.system_trigger=true.
  //
  // 2. REPROCESSAR O LOTE rb_u6zr2qtcos1ljxd_20261014_29866420:
  //    (courier u6zr2qtcos1ljxd, 12 entregas, janela 13h40 -> 14h38 em 14/10/2026)
  //    Calcular pings de locations, km_gps_total, km_viario_total e km_oficial
  //    Garantir que a guarda de sanidade valide e registrar em route_batch_telemetry e audit_trail.

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

  const formatPbDateStr = (d) => {
    return d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
  }

  const auditCol = app.findCollectionByNameOrId('audit_trail')
  const alertsCol = app.findCollectionByNameOrId('address_alerts')
  const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')

  // ==========================================
  // PARTE 1: DEDUPLICAÇÃO DE ALERTAS (PASSADO)
  // ==========================================
  let allAlerts = []
  try {
    allAlerts = app.findRecordsByFilter(
      'address_alerts',
      'id != ""',
      '-created',
      2000,
      0,
    )
  } catch (err) {
    console.log('[0169_migration] Erro ao buscar address_alerts:', err)
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

    // Comparar pares para encontrar duplicatas aproximadas (mesma coordenada < 30m ou mesmo pedido/nota idêntica em segundos)
    const discardedIds = new Set()

    for (let i = 0; i < list.length; i++) {
      const primary = list[i]
      if (discardedIds.has(primary.id)) continue

      const pSugg = primary.get('suggested_address') || {}
      const pLat = Number(pSugg.lat || (primary.get('current_address') || {}).lat || 0)
      const pLng = Number(pSugg.lng || (primary.get('current_address') || {}).lng || 0)

      for (let j = i + 1; j < list.length; j++) {
        const candidate = list[j]
        if (discardedIds.has(candidate.id)) continue

        const cSugg = candidate.get('suggested_address') || {}
        const cLat = Number(cSugg.lat || (candidate.get('current_address') || {}).lat || 0)
        const cLng = Number(cSugg.lng || (candidate.get('current_address') || {}).lng || 0)

        let dist = Infinity
        if (pLat !== 0 && pLng !== 0 && cLat !== 0 && cLng !== 0) {
          dist = haversineDistMeters(pLat, pLng, cLat, cLng)
        }

        const pTime = new Date(primary.getString('created')).getTime()
        const cTime = new Date(candidate.getString('created')).getTime()
        const diffSeconds = Math.abs(pTime - cTime) / 1000

        // Se a distância for menor que 30m ou foram gerados com menos de 120s de diferença para o mesmo cliente
        const isDuplicate = dist <= 30 || (diffSeconds <= 120 && dist <= 100)

        if (isDuplicate) {
          // Escolher qual manter: o que tiver status='aprovado' prevalece.
          let keeper = primary
          let toDiscard = candidate
          if (candidate.getString('status') === 'aprovado' && primary.getString('status') !== 'aprovado') {
            keeper = candidate
            toDiscard = primary
          }

          // Mesclar status de aprovação se aplicável
          if (toDiscard.getString('status') === 'aprovado' && keeper.getString('status') !== 'aprovado') {
            keeper.set('status', 'aprovado')
            keeper.set('reviewed_at', toDiscard.getString('reviewed_at') || new Date().toISOString())
            keeper.set('reviewed_by', toDiscard.getString('reviewed_by') || '')
            app.save(keeper)
          }

          // Registrar em audit_trail o descarte da cópia
          if (auditCol) {
            try {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '') // relation vazia para Sistema
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
              console.log('[0169_migration] Erro ao gravar audit_trail de deduplicação:', aErr)
            }
          }

          // Excluir a duplicata
          try {
            app.delete(toDiscard)
            discardedIds.add(toDiscard.id)
            totalAlertDuplicatesDiscarded++
            console.log(`[0169_migration] Alerta duplicado #${toDiscard.id} excluído com sucesso (mantido #${keeper.id}).`)
          } catch (delErr) {
            console.log(`[0169_migration] Falha ao deletar alerta duplicado #${toDiscard.id}:`, delErr)
          }

          if (toDiscard === primary) {
            // Se o primary foi o descartado, sair do loop interno para esse primary
            break
          }
        }
      }
    }
  }

  console.log(`[0169_migration] Concluída deduplicação de alertas. Total de cópias descartadas: ${totalAlertDuplicatesDiscarded}`)

  // ==============================================================
  // PARTE 2: REPROCESSAR LOTE rb_u6zr2qtcos1ljxd_20261014_29866420
  // ==============================================================
  const batchKey = 'rb_u6zr2qtcos1ljxd_20261014_29866420'
  const courierId = 'u6zr2qtcos1ljxd'

  let orders = []
  try {
    orders = app.findRecordsByFilter(
      'orders',
      `route_batch_key = '${batchKey}'`,
      '+sequence',
      100,
      0,
    )
  } catch (_) {}

  let minStartMs = Infinity
  let maxFinishMs = -Infinity

  for (let i = 0; i < orders.length; i++) {
    const o = orders[i]
    const sAt = o.getString('route_started_at')
    const fAt = o.getString('route_finished_at') || o.getString('actual_arrival')
    if (sAt) {
      const t = new Date(sAt).getTime()
      if (t < minStartMs) minStartMs = t
    }
    if (fAt) {
      const t = new Date(fAt).getTime()
      if (t > maxFinishMs) maxFinishMs = t
    }
  }

  if (minStartMs === Infinity) minStartMs = new Date('2026-10-14T13:40:10.000Z').getTime()
  if (maxFinishMs === -Infinity || maxFinishMs <= minStartMs) {
    maxFinishMs = new Date('2026-10-14T14:38:18.000Z').getTime()
  }

  // Janela com 10 min de margem formatada em "YYYY-MM-DD HH:mm:ss"
  const startMarginDate = new Date(minStartMs - 10 * 60000)
  const finishMarginDate = new Date(maxFinishMs + 10 * 60000)
  const queryStartStr = formatPbDateStr(startMarginDate)
  const queryFinishStr = formatPbDateStr(finishMarginDate)

  let pings = []
  try {
    pings = app.findRecordsByFilter(
      'locations',
      `user_id = '${courierId}' && created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
      '+created',
      5000,
      0,
    )
  } catch (e) {
    console.log('[0169_migration] Erro ao buscar pings para ' + batchKey + ':', e)
  }

  const pingsCount = pings.length
  let kmGpsTotalMeters = 0
  let gapsCount = 0
  let gapsTotalSeconds = 0
  const telemetryGaps = []

  for (let i = 1; i < pingsCount; i++) {
    const prev = pings[i - 1]
    const curr = pings[i]
    const prevTime = new Date(prev.getString('created')).getTime()
    const currTime = new Date(curr.getString('created')).getTime()
    const dtSec = Math.max(0, Math.round((currTime - prevTime) / 1000))

    if (dtSec > 90) {
      gapsCount++
      gapsTotalSeconds += dtSec
      telemetryGaps.push({
        gap_index: gapsCount,
        start_iso: prev.getString('created'),
        end_iso: curr.getString('created'),
        duration_seconds: dtSec,
        duration_minutes: Number((dtSec / 60).toFixed(1)),
      })
    } else {
      const dist = haversineDistMeters(
        prev.getFloat('lat'),
        prev.getFloat('lng'),
        curr.getFloat('lat'),
        curr.getFloat('lng'),
      )
      if (dist >= 3) {
        kmGpsTotalMeters += dist
      }
    }
  }

  const kmGpsTotal = Number((kmGpsTotalMeters / 1000).toFixed(2))

  // KM Viário calculado a partir dos pedidos otimizados do lote
  // No lote de 14/10: total_route_with_return_km gravado nos pedidos é 17.7 km
  let kmViarioTotal = 17.7
  for (let i = 0; i < orders.length; i++) {
    const ordTotal = orders[i].getFloat('total_route_with_return_km')
    if (ordTotal > 0) {
      kmViarioTotal = ordTotal
      break
    }
  }

  // Pre-aprovado no MENOR entre previsto e realizado (regra permanente Rotaly)
  const kmOficial = kmGpsTotal > 0 && kmViarioTotal > 0 ? Math.min(kmViarioTotal, kmGpsTotal) : kmViarioTotal || kmGpsTotal

  let telemetryRecord = null
  try {
    telemetryRecord = app.findFirstRecordByData(
      'route_batch_telemetry',
      'route_batch_key',
      batchKey,
    )
  } catch (_) {}

  if (!telemetryRecord && telemetryCol) {
    telemetryRecord = new Record(telemetryCol)
    telemetryRecord.set('route_batch_key', batchKey)
  }

  if (telemetryRecord) {
    telemetryRecord.set('courier_id', courierId)
    telemetryRecord.set('empresa_id', orders[0] ? orders[0].getString('empresa_id') : '7wo05iyvfcfh01h')
    telemetryRecord.set('km_gps_total', kmGpsTotal)
    telemetryRecord.set('km_viario_total', kmViarioTotal)
    telemetryRecord.set('km_oficial', kmOficial)
    telemetryRecord.set('pings_count', pingsCount)
    telemetryRecord.set('gaps_count', gapsCount)
    telemetryRecord.set('gaps_total_seconds', gapsTotalSeconds)
    telemetryRecord.set('telemetry_gaps', telemetryGaps)
    telemetryRecord.set('status', 'processed')
    if (pingsCount > 0) {
      telemetryRecord.set('first_ping_at', pings[0].getString('created'))
      telemetryRecord.set('last_ping_at', pings[pingsCount - 1].getString('created'))
    }
    telemetryRecord.set('route_started_at', new Date(minStartMs).toISOString())
    telemetryRecord.set('route_finished_at', new Date(maxFinishMs).toISOString())

    const currentMeta = telemetryRecord.get('metadata') || {}
    telemetryRecord.set('metadata', {
      ...currentMeta,
      reprocessed_via_0169: true,
      reprocessed_at: new Date().toISOString(),
      query_start: queryStartStr,
      query_finish: queryFinishStr,
      orders_count: orders.length,
      courier_id: courierId,
    })

    app.save(telemetryRecord)
    console.log(`[0169_migration] route_batch_telemetry atualizado para lote ${batchKey}: km_gps=${kmGpsTotal}, km_viario=${kmViarioTotal}, km_oficial=${kmOficial}, pings=${pingsCount}`)
  }

  // Atualizar batch_telemetry_id nos orders do lote
  const batchTelemetryId = telemetryRecord ? telemetryRecord.id : ''
  if (batchTelemetryId) {
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      if (o.getString('batch_telemetry_id') !== batchTelemetryId) {
        o.set('batch_telemetry_id', batchTelemetryId)
        try {
          app.save(o)
        } catch (_) {}
      }
    }
  }

  // GUARDA DE SANIDADE: se pings_count === 0 mas existem pings na janela temporal
  if (pingsCount === 0) {
    let anyPings = []
    try {
      anyPings = app.findRecordsByFilter(
        'locations',
        `created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
        '+created',
        5,
        0,
      )
    } catch (_) {}

    if (anyPings.length > 0 && auditCol) {
      console.error(`[0169_migration:SANITY_ERROR] pings_count=0 para lote ${batchKey}, mas há pings na janela!`)
      const auditRec = new Record(auditCol)
      auditRec.set('user_id', '')
      auditRec.set('collection', 'route_batch_telemetry')
      auditRec.set('record_id', batchKey)
      auditRec.set('courier_id', courierId)
      auditRec.set('action', 'guarda_telemetria_zero_pings')
      auditRec.set('field', 'pings_count')
      auditRec.set('old_value', '0')
      auditRec.set('new_value', 'divergencia_pings_janela')
      auditRec.set('timestamp', new Date().toISOString())
      auditRec.set('metadata', {
        system_trigger: true,
        actor_name: 'Sistema',
        route_batch_key: batchKey,
        courier_id: courierId,
        query_start: queryStartStr,
        query_finish: queryFinishStr,
      })
      app.save(auditRec)
    }
  } else if (auditCol) {
    // Registro de sucesso no audit_trail
    const auditRec = new Record(auditCol)
    auditRec.set('user_id', '')
    auditRec.set('collection', 'route_batch_telemetry')
    auditRec.set('record_id', batchTelemetryId || batchKey)
    auditRec.set('courier_id', courierId)
    auditRec.set('action', 'reprocessamento_lote_telemetria_0169')
    auditRec.set('field', 'km_oficial')
    auditRec.set('old_value', 'inexistente')
    auditRec.set('new_value', `gps=${kmGpsTotal}km, viario=${kmViarioTotal}km, oficial=${kmOficial}km, pings=${pingsCount}`)
    auditRec.set('timestamp', new Date().toISOString())
    auditRec.set('metadata', {
      system_trigger: true,
      actor_name: 'Sistema',
      route_batch_key: batchKey,
      courier_id: courierId,
      km_gps_total: kmGpsTotal,
      km_viario_total: kmViarioTotal,
      km_oficial: kmOficial,
      pings_count: pingsCount,
      gaps_count: gapsCount,
      alerts_duplicates_discarded: totalAlertDuplicatesDiscarded,
    })
    app.save(auditRec)
  }
})
