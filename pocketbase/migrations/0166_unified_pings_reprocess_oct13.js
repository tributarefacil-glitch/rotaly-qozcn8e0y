/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // FRENTE 2: Reprocessamento de telemetria dos lotes de 13/10 usando a busca unificada por user_id + janela UTC
  // Lotes especificados:
  // 1) rb_tetrfu5oi19jbwz_20261013_29865284 (entregador tetrfu5oi19jbwz)
  // 2) rb_tetrfu5oi19jbwz_20261013_29865426 (entregador tetrfu5oi19jbwz)
  // 3) rb_mxvhhwb5i46zjq2_20261013_29865514 (entregador mxvhhwb5i46zjq2)
  // Lotes anteriores: marcar como legacy/sem telemetria e nunca mais reprocessar.

  const batchesToProcess = [
    {
      key: 'rb_tetrfu5oi19jbwz_20261013_29865284',
      courierId: 'tetrfu5oi19jbwz',
    },
    {
      key: 'rb_tetrfu5oi19jbwz_20261013_29865426',
      courierId: 'tetrfu5oi19jbwz',
    },
    {
      key: 'rb_mxvhhwb5i46zjq2_20261013_29865514',
      courierId: 'mxvhhwb5i46zjq2',
    },
  ]

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

  const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
  const auditCol = app.findCollectionByNameOrId('audit_trail')

  for (let b = 0; b < batchesToProcess.length; b++) {
    const item = batchesToProcess[b]
    const batchKey = item.key
    const courierId = item.courierId

    // 1. Obter pedidos do lote para extrair route_started_at e route_finished_at
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

    if (orders.length === 0) {
      // Tentar buscar por courier_id e data de 13/10
      try {
        orders = app.findRecordsByFilter(
          'orders',
          `courier_id = '${courierId}' && route_started_at >= '2026-10-13 00:00:00' && route_started_at <= '2026-10-13 23:59:59'`,
          '+sequence',
          100,
          0,
        )
      } catch (_) {}
    }

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

    // Janela padrão caso pedidos não tenham timestamp preciso (janela de 13/10)
    if (minStartMs === Infinity) minStartMs = new Date('2026-10-13T08:00:00.000Z').getTime()
    if (maxFinishMs === -Infinity || maxFinishMs <= minStartMs) {
      maxFinishMs = minStartMs + 5 * 60 * 60 * 1000 // 5 horas de lote
    }

    // Janela de busca com tolerância de 10 min
    const queryStartIso = new Date(minStartMs - 10 * 60000).toISOString()
    const queryFinishIso = new Date(maxFinishMs + 10 * 60000).toISOString()

    // 2. FUNÇÃO ÚNICA DE BUSCA: user_id + janela UTC
    let pings = []
    try {
      pings = app.findRecordsByFilter(
        'locations',
        `user_id = '${courierId}' && created >= '${queryStartIso}' && created <= '${queryFinishIso}'`,
        '+created',
        5000,
        0,
      )
    } catch (e) {
      console.log('[0166_migration] Erro ao buscar pings para ' + batchKey + ':', e)
    }

    const pingsCount = pings.length
    let kmGpsTotalMeters = 0
    let gapsCount = 0
    const telemetryGaps = []

    for (let i = 1; i < pingsCount; i++) {
      const prev = pings[i - 1]
      const curr = pings[i]
      const prevTime = new Date(prev.getString('created')).getTime()
      const currTime = new Date(curr.getString('created')).getTime()
      const dtSec = Math.max(0, Math.round((currTime - prevTime) / 1000))

      if (dtSec > 90) {
        gapsCount++
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

    // 3. Atualizar ou criar registro em route_batch_telemetry
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
      telemetryRecord.set('km_gps_total', kmGpsTotal)
      telemetryRecord.set('pings_count', pingsCount)
      telemetryRecord.set('gaps_count', gapsCount)
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
        reprocessed_via_0166: true,
        reprocessed_at: new Date().toISOString(),
        query_start_iso: queryStartIso,
        query_finish_iso: queryFinishIso,
      })

      app.save(telemetryRecord)
    }

    // 4. GUARDA: se pings_count === 0 mas existem pings na janela global
    if (pingsCount === 0) {
      let anyPingsInWindow = []
      try {
        anyPingsInWindow = app.findRecordsByFilter(
          'locations',
          `created >= '${queryStartIso}' && created <= '${queryFinishIso}'`,
          '+created',
          5,
          0,
        )
      } catch (_) {}

      if (anyPingsInWindow.length > 0 && auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '') // Sistema
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
          query_start_iso: queryStartIso,
          query_finish_iso: queryFinishIso,
        })
        app.save(auditRec)
      }
    }
  }

  // 5. LOTES ANTERIORES: marcar como legacy/sem telemetria e nunca mais reprocessar
  try {
    const legacyRecords = app.findRecordsByFilter(
      'route_batch_telemetry',
      `route_batch_key !~ '20261013'`,
      '+created',
      500,
      0,
    )

    for (let r = 0; r < legacyRecords.length; r++) {
      const rec = legacyRecords[r]
      const meta = rec.get('metadata') || {}
      if (!meta.legacy_telemetry) {
        rec.set('metadata', {
          ...meta,
          legacy_telemetry: true,
          locked_no_reprocess: true,
          marked_legacy_at: new Date().toISOString(),
        })
        app.save(rec)
      }
    }
  } catch (legacyErr) {
    console.log('[0166_migration] Erro ao marcar lotes legados:', legacyErr)
  }
})
