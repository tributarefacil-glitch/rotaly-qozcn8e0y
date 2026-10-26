// pocketbase/migrations/0190_reprocess_telemetry_deduplicate_gps.js
// Migração para reprocessar telemetria com deduplicação de pings (APK Nativo vs WebView/JS).
// Regra permanente do usuário: cobre passado (reprocessamento de dados), presente e futuro.
// Padrão do projeto: user_id vazio + actor_name 'Sistema' + metadata.system_trigger=true

migrate((app) => {
  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')
  const PILAR_BASE_LAT = -22.6977499
  const PILAR_BASE_LNG = -43.2936013
  const PILAR_BASE_NAME = 'Drogaria Mais Saudável - Pilar'

  function logAudit(recordId, courierId, action, field, oldVal, newVal, meta) {
    if (!auditCol) return
    try {
      const rec = new Record(auditCol)
      rec.set('user_id', '') // relation aceita vazio para Sistema
      rec.set('collection', 'route_batch_telemetry')
      rec.set('record_id', recordId)
      if (courierId) rec.set('courier_id', courierId)
      rec.set('action', action)
      rec.set('field', field)
      rec.set('old_value', String(oldVal || ''))
      rec.set('new_value', String(newVal || ''))
      rec.set('timestamp', now)
      rec.set(
        'metadata',
        Object.assign(
          {
            system_trigger: true,
            actor_name: 'Sistema',
          },
          meta || {},
        ),
      )
      app.save(rec)
    } catch (e) {
      console.log('[0190] Erro ao gravar audit_trail:', e)
    }
  }

  function haversineDistMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000
    const toRad = Math.PI / 180
    const dLat = (lat2 - lat1) * toRad
    const dLon = (lon2 - lon1) * toRad
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
  }

  function deduplicatePingList(rawList) {
    if (!rawList || rawList.length <= 1) return rawList || []
    const sorted = rawList.slice().sort((a, b) => {
      const tA = new Date(a.getString('location_timestamp') || a.getString('created')).getTime()
      const tB = new Date(b.getString('location_timestamp') || b.getString('created')).getTime()
      return tA - tB
    })

    const deduped = []
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i]
      const currLat = curr.getFloat('lat')
      const currLng = curr.getFloat('lng')
      const currTime = new Date(
        curr.getString('location_timestamp') || curr.getString('created'),
      ).getTime()
      const currIsNative = Boolean(curr.getString('location_timestamp'))

      if (deduped.length === 0) {
        deduped.push(curr)
        continue
      }

      const prev = deduped[deduped.length - 1]
      const prevLat = prev.getFloat('lat')
      const prevLng = prev.getFloat('lng')
      const prevTime = new Date(
        prev.getString('location_timestamp') || prev.getString('created'),
      ).getTime()
      const prevIsNative = Boolean(prev.getString('location_timestamp'))

      const dtSec = Math.abs(currTime - prevTime) / 1000
      const dM = haversineDistMeters(prevLat, prevLng, currLat, currLng)

      // Janela de duplicidade concorrente: intervalo < 5s e distância < 10m
      if (dtSec < 5 && dM < 10) {
        if (!prevIsNative && currIsNative) {
          deduped[deduped.length - 1] = curr
        }
        continue
      }
      deduped.push(curr)
    }
    return deduped
  }

  function sanitizePingsAndComputeTelemetry(pingsList) {
    let kmGpsTotalMeters = 0
    const telemetryGaps = []
    let gapsCount = 0
    let gapsTotalSeconds = 0
    let discardedCount = 0
    const telemetrySegments = []
    let currentSegment = []

    const validPingsPre = []
    if (pingsList) {
      for (let idx = 0; idx < pingsList.length; idx++) {
        const p = pingsList[idx]
        const acc = p.getFloat('accuracy')
        const spd = p.getFloat('speed')
        if (acc && acc > 100) {
          discardedCount++
          continue
        }
        if (spd && spd > 200) {
          discardedCount++
          continue
        }
        validPingsPre.push(p)
      }
    }

    const validPings = deduplicatePingList(validPingsPre)
    discardedCount += validPingsPre.length - validPings.length

    const pCount = validPings.length
    if (pCount >= 1) {
      currentSegment.push({
        lat: validPings[0].getFloat('lat'),
        lng: validPings[0].getFloat('lng'),
        created: validPings[0].getString('created'),
        timeMs: new Date(validPings[0].getString('created')).getTime(),
      })
    }

    for (let i = 1; i < pCount; i++) {
      const prev = validPings[i - 1]
      const curr = validPings[i]
      const prevLat = prev.getFloat('lat')
      const prevLng = prev.getFloat('lng')
      const currLat = curr.getFloat('lat')
      const currLng = curr.getFloat('lng')
      const prevTime = new Date(prev.getString('created')).getTime()
      const currTime = new Date(curr.getString('created')).getTime()
      const deltaSec = Math.max(0, Math.round((currTime - prevTime) / 1000))

      const dMeters = haversineDistMeters(prevLat, prevLng, currLat, currLng)
      const isFrozenPing =
        (Math.abs(prevLat - currLat) < 0.00002 && Math.abs(prevLng - currLng) < 0.00002) ||
        dMeters < 1.5

      if (deltaSec > 90) {
        telemetryGaps.push({
          gap_index: gapsCount + 1,
          start_iso: prev.getString('created'),
          end_iso: curr.getString('created'),
          duration_seconds: deltaSec,
          duration_minutes: Number((deltaSec / 60).toFixed(1)),
          prev_coords: { lat: prevLat, lng: prevLng },
          curr_coords: { lat: currLat, lng: currLng },
        })
        gapsCount++
        gapsTotalSeconds += deltaSec
        if (currentSegment.length >= 2) telemetrySegments.push(currentSegment)
        currentSegment = []
      } else if (!isFrozenPing) {
        const speedKmh = deltaSec > 0 ? (dMeters / deltaSec) * 3.6 : 0
        if (speedKmh > 200) {
          discardedCount++
          continue
        }
        if (speedKmh <= 90) {
          kmGpsTotalMeters += dMeters
        }
      }
      currentSegment.push({
        lat: currLat,
        lng: currLng,
        created: curr.getString('created'),
        timeMs: currTime,
      })
    }
    if (currentSegment.length >= 2) telemetrySegments.push(currentSegment)

    return {
      kmGpsTotalMeters,
      telemetryGaps,
      gapsCount,
      gapsTotalSeconds,
      telemetrySegments,
      discardedCount,
      dedupedPingsCount: validPings.length,
    }
  }

  // Identificar lotes candidatos a reprocessamento por condição:
  // Lotes recentes a partir de 24/10 que possuem pings_count elevado ou padrão de alternância de bateria/fluxo
  const candidates = app.findRecordsByFilter(
    'route_batch_telemetry',
    "created >= '2026-10-24 00:00:00'",
    '+created',
    100,
    0,
  )

  console.log(`[0190] Verificando ${candidates.length} lotes para reprocessamento com dedup...`)

  for (let cIdx = 0; cIdx < candidates.length; cIdx++) {
    const telemetryRec = candidates[cIdx]
    const batchKey = telemetryRec.getString('route_batch_key')
    const courierId = telemetryRec.getString('courier_id')
    const oldPingsCount = telemetryRec.getInt('pings_count') || 0
    const oldKmGps = telemetryRec.getFloat('km_gps_total') || 0
    const kmViario = telemetryRec.getFloat('km_viario_total') || 0

    if (!batchKey || !courierId) continue

    // Buscar pedidos do lote para obter janela de tempo precisa
    let orders = []
    try {
      orders = app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${batchKey}' && status != 'cancelled'`,
        'sequence,created',
        100,
        0,
      )
    } catch (_) {}

    if (!orders || orders.length === 0) continue

    let startMs = 0
    let finishMs = 0
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i]
      const sRaw = o.getString('route_started_at') || o.getString('created')
      if (sRaw) {
        const t = new Date(sRaw).getTime()
        if (t > 0 && (startMs === 0 || t < startMs)) startMs = t
      }
      const fRaw = o.getString('route_finished_at') || o.getString('actual_arrival')
      if (fRaw) {
        const t = new Date(fRaw).getTime()
        if (t > finishMs) finishMs = t
      }
    }
    if (startMs === 0) startMs = new Date(orders[0].getString('created')).getTime()
    if (finishMs === 0 || finishMs <= startMs) {
      finishMs = new Date(orders[orders.length - 1].getString('updated')).getTime() || Date.now()
    }

    const formatPbDateStr = (d) => {
      return d
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z?$/, '')
    }
    const queryStartStr = formatPbDateStr(new Date(startMs - 10 * 60000))
    const queryFinishStr = formatPbDateStr(new Date(finishMs + 10 * 60000))

    let pings = []
    try {
      pings = app.findRecordsByFilter(
        'locations',
        `user_id = '${courierId}' && created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
        '+created',
        5000,
        0,
      )
    } catch (_) {}

    if (pings.length === 0) continue

    // Checar se há sinais de duplicação: pings intercalados com location_timestamp vs vazios
    const rawDeduped = deduplicatePingList(pings)
    const hasDuplicationPattern =
      pings.length - rawDeduped.length >= 10 || batchKey.indexOf('20261026') >= 0

    if (!hasDuplicationPattern && pings.length < 150) {
      // Lote sem duplicidade expressiva
      continue
    }

    // Executa saneamento com deduplicação
    const sanitized = sanitizePingsAndComputeTelemetry(pings)
    let newKmGps = Number((sanitized.kmGpsTotalMeters / 1000).toFixed(2))

    // Se houve teto viário
    if (kmViario > 0 && newKmGps > kmViario * 2) {
      newKmGps = Number((kmViario * 1.15).toFixed(2))
    }

    let diffPct = 0
    let newStatus = 'processed'
    if (newKmGps > 0 && kmViario > 0) {
      diffPct = Math.round((Math.abs(newKmGps - kmViario) / kmViario) * 100)
      if (diffPct > 20) {
        newStatus = 'yellow_flag'
      }
    }

    // Atualiza o registro de telemetria
    telemetryRec.set('pings_count', sanitized.dedupedPingsCount)
    telemetryRec.set('km_gps_total', newKmGps)
    telemetryRec.set('gaps_count', sanitized.gapsCount)
    telemetryRec.set('gaps_total_seconds', sanitized.gapsTotalSeconds)
    telemetryRec.set('telemetry_gaps', sanitized.telemetryGaps)
    telemetryRec.set('status', newStatus)

    let meta = {}
    try {
      meta = JSON.parse(telemetryRec.getString('metadata') || '{}')
    } catch (_) {}
    meta.diff_pct = diffPct
    meta.dedup_reprocessed_at = now
    meta.pings_raw_count = pings.length
    meta.pings_deduped_count = sanitized.dedupedPingsCount
    telemetryRec.set('metadata', JSON.stringify(meta))

    app.save(telemetryRec)

    logAudit(
      telemetryRec.id,
      courierId,
      'reprocessamento_dedup_gps_duplicado',
      'km_gps_total',
      `gps=${oldKmGps}km, pings=${oldPingsCount}`,
      `gps=${newKmGps}km, pings=${sanitized.dedupedPingsCount}, status=${newStatus}`,
      {
        route_batch_key: batchKey,
        courier_id: courierId,
        km_viario_total: kmViario,
        old_km_gps_total: oldKmGps,
        new_km_gps_total: newKmGps,
        old_pings_count: oldPingsCount,
        new_pings_count: sanitized.dedupedPingsCount,
        gaps_count: sanitized.gapsCount,
        diff_pct: diffPct,
        old_status: telemetryRec.getString('status'),
        new_status: newStatus,
      },
    )

    console.log(
      `[0190] Lote ${batchKey} reprocessado com sucesso: pings ${oldPingsCount} -> ${sanitized.dedupedPingsCount}, km_gps ${oldKmGps} -> ${newKmGps} (viario: ${kmViario}), status: ${newStatus}`,
    )
  }
})
