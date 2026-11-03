// pocketbase/migrations/0196_purge_zombie_pings_recalculate_telemetry.js
// Migração idempotente para expurgo retroativo de pings zumbis e recálculo canônico de telemetria:
// 1. Remove pings zumbis gravados em 'locations':
//    - accuracy >= 100
//    - ou coordenadas idênticas consecutivas do mesmo entregador (accuracy 200, speed 0, heading 0 ou congeladas repetidas)
// 2. Recalcula o km GPS em 'route_batch_telemetry' dos lotes afetados, especialmente os de 03/11
//    (em particular rb_u6zr2qtcos1ljxd_20261103_29895347, Guilherme).
// 3. Registra em audit_trail com actor_name='Sistema', user_id='', metadata.system_trigger=true.

migrate((app) => {
  const now = new Date().toISOString()
  const auditCol = app.findCollectionByNameOrId('audit_trail')
  const locationsCol = app.findCollectionByNameOrId('locations')
  const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
  const ordersCol = app.findCollectionByNameOrId('orders')

  function logAudit(recordId, courierId, action, field, oldVal, newVal, meta) {
    if (!auditCol) return
    try {
      const rec = new Record(auditCol)
      rec.set('user_id', '') // relation aceita vazio para ações de Sistema
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
      console.log('[0196] Erro ao gravar audit_trail:', e)
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

  function sanitizeAndComputeTelemetry(pingsList) {
    let kmGpsTotalMeters = 0
    const telemetryGaps = []
    let gapsCount = 0
    let gapsTotalSeconds = 0
    let discardedCount = 0

    // 1. Descartar accuracy >= 100 ou velocidade impossível
    const validPre = []
    if (pingsList) {
      for (let i = 0; i < pingsList.length; i++) {
        const p = pingsList[i]
        const acc = p.getFloat('accuracy')
        const spd = p.getFloat('speed')
        if (acc && acc >= 100) {
          discardedCount++
          continue
        }
        if (spd && spd > 200) {
          discardedCount++
          continue
        }
        validPre.push(p)
      }
    }

    // 2. Deduplicação temporal e espacial (<5s / <10m)
    const sorted = validPre.slice().sort((a, b) => {
      const tA = new Date(a.getString('location_timestamp') || a.getString('created')).getTime()
      const tB = new Date(b.getString('location_timestamp') || b.getString('created')).getTime()
      return tA - tB
    })

    const deduped = []
    for (let i = 0; i < sorted.length; i++) {
      const curr = sorted[i]
      if (deduped.length === 0) {
        deduped.push(curr)
        continue
      }
      const prev = deduped[deduped.length - 1]
      const prevLat = prev.getFloat('lat')
      const prevLng = prev.getFloat('lng')
      const currLat = curr.getFloat('lat')
      const currLng = curr.getFloat('lng')
      const prevTime = new Date(
        prev.getString('location_timestamp') || prev.getString('created'),
      ).getTime()
      const currTime = new Date(
        curr.getString('location_timestamp') || curr.getString('created'),
      ).getTime()
      const dtSec = Math.abs(currTime - prevTime) / 1000
      const dM = haversineDistMeters(prevLat, prevLng, currLat, currLng)

      if (dtSec < 5 && dM < 10) {
        const prevIsNative = Boolean(prev.getString('location_timestamp'))
        const currIsNative = Boolean(curr.getString('location_timestamp'))
        if (!prevIsNative && currIsNative) {
          deduped[deduped.length - 1] = curr
        }
        discardedCount++
        continue
      }
      deduped.push(curr)
    }

    const pCount = deduped.length

    for (let i = 1; i < pCount; i++) {
      const prev = deduped[i - 1]
      const curr = deduped[i]
      const prevLat = prev.getFloat('lat')
      const prevLng = prev.getFloat('lng')
      const currLat = curr.getFloat('lat')
      const currLng = curr.getFloat('lng')
      const prevTime = new Date(
        prev.getString('location_timestamp') || prev.getString('created'),
      ).getTime()
      const currTime = new Date(
        curr.getString('location_timestamp') || curr.getString('created'),
      ).getTime()
      const deltaSec = Math.max(0, Math.round((currTime - prevTime) / 1000))
      const dMeters = haversineDistMeters(prevLat, prevLng, currLat, currLng)

      // Coordenada congelada (<1.5m ou quase idêntica)
      const isFrozen =
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
      } else if (!isFrozen) {
        const speedKmh = deltaSec > 0 ? (dMeters / deltaSec) * 3.6 : 0
        if (speedKmh > 200) {
          discardedCount++
          continue
        }
        if (speedKmh <= 90) {
          kmGpsTotalMeters += dMeters
        }
      }
    }

    return {
      kmGpsTotalMeters,
      telemetryGaps,
      gapsCount,
      gapsTotalSeconds,
      discardedCount,
      dedupedPingsCount: pCount,
    }
  }

  // PARTE 1: EXPURGO RETROATIVO DE PINGS ZUMBIS NA COLEÇÃO 'locations'
  // Critério A: accuracy >= 100
  // Critério B: coordenadas idênticas consecutivas congeladas do mesmo entregador com padrão zumbi (ex: accuracy 200, speed 0, heading 0)
  let purgedPingsCount = 0
  const affectedCouriers = new Set()

  if (locationsCol) {
    try {
      // 1.1 Expurgo de pings com accuracy >= 100
      let badAccuracyPings = []
      try {
        badAccuracyPings = app.findRecordsByFilter(
          'locations',
          'accuracy >= 100',
          '+created',
          5000,
          0,
        )
      } catch (err) {
        console.log('[0196] Erro ao buscar pings accuracy >= 100:', err)
      }

      for (let i = 0; i < badAccuracyPings.length; i++) {
        const p = badAccuracyPings[i]
        const cId = p.getString('user_id')
        if (cId) affectedCouriers.add(cId)
        try {
          app.delete(p)
          purgedPingsCount++
        } catch (delErr) {
          console.log('[0196] Erro ao deletar ping zumbi:', delErr)
        }
      }

      console.log(`[0196] Pings zumbis com accuracy >= 100 expurgados: ${purgedPingsCount}`)

      // 1.2 Expurgo de coordenadas idênticas consecutivas congeladas com padrão zumbi (accuracy 200 ou repetição estática)
      let recentPings = []
      try {
        recentPings = app.findRecordsByFilter(
          'locations',
          "created >= '2026-11-03 00:00:00'",
          '+created',
          10000,
          0,
        )
      } catch (_) {}

      // Agrupar por user_id
      const pingsByUser = {}
      for (let i = 0; i < recentPings.length; i++) {
        const ping = recentPings[i]
        const uId = ping.getString('user_id')
        if (!pingsByUser[uId]) pingsByUser[uId] = []
        pingsByUser[uId].push(ping)
      }

      for (const uId of Object.keys(pingsByUser)) {
        const uPings = pingsByUser[uId]
        for (let i = 1; i < uPings.length; i++) {
          const prev = uPings[i - 1]
          const curr = uPings[i]
          const latDiff = Math.abs(curr.getFloat('lat') - prev.getFloat('lat'))
          const lngDiff = Math.abs(curr.getFloat('lng') - prev.getFloat('lng'))
          const isIdentical = latDiff < 0.000001 && lngDiff < 0.000001
          const isZeroMotion = curr.getFloat('speed') === 0 && prev.getFloat('speed') === 0
          const isZombiePattern =
            curr.getFloat('accuracy') >= 100 ||
            (isIdentical && isZeroMotion && curr.getFloat('heading') === 0)

          if (isIdentical && isZombiePattern) {
            try {
              app.delete(curr)
              purgedPingsCount++
              affectedCouriers.add(uId)
            } catch (_) {}
          }
        }
      }
    } catch (errPings) {
      console.log('[0196] Erro geral no expurgo de pings zumbis:', errPings)
    }
  }

  // PARTE 2: RECALCULAR KM GPS EM route_batch_telemetry
  // Foco especial nos lotes de hoje 03/11, especialmente rb_u6zr2qtcos1ljxd_20261103_29895347
  if (telemetryCol && ordersCol && locationsCol) {
    let telemetryRecords = []
    try {
      telemetryRecords = app.findRecordsByFilter(
        'route_batch_telemetry',
        "created >= '2026-11-03 00:00:00'",
        '-created',
        200,
        0,
      )
    } catch (errTelem) {
      console.log('[0196] Erro ao buscar route_batch_telemetry:', errTelem)
    }

    // Se o lote específico de Guilherme não foi capturado no filtro acima, busca explicitamente
    const targetKey = 'rb_u6zr2qtcos1ljxd_20261103_29895347'
    const hasTarget = telemetryRecords.some((t) => t.getString('route_batch_key') === targetKey)
    if (!hasTarget) {
      try {
        const targetRec = app.findFirstRecordByData(
          'route_batch_telemetry',
          'route_batch_key',
          targetKey,
        )
        if (targetRec) telemetryRecords.push(targetRec)
      } catch (_) {}
    }

    console.log(`[0196] Recalculando telemetria de ${telemetryRecords.length} lotes de 03/11...`)

    for (let i = 0; i < telemetryRecords.length; i++) {
      const telemetryRec = telemetryRecords[i]
      const batchKey = telemetryRec.getString('route_batch_key')
      const courierId = telemetryRec.getString('courier_id')
      if (!batchKey) continue

      // Buscar pedidos do lote
      let batchOrders = []
      try {
        batchOrders = app.findRecordsByFilter(
          'orders',
          `route_batch_key = '${batchKey}' && status != 'cancelled'`,
          'sequence,created',
          200,
          0,
        )
      } catch (_) {}

      if (batchOrders.length === 0) continue

      let startMs = 0
      let finishMs = 0
      for (let j = 0; j < batchOrders.length; j++) {
        const o = batchOrders[j]
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
      if (startMs === 0) startMs = new Date(batchOrders[0].getString('created')).getTime()
      if (finishMs === 0 || finishMs <= startMs) {
        finishMs =
          new Date(batchOrders[batchOrders.length - 1].getString('updated')).getTime() || Date.now()
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

      const sanitized = sanitizeAndComputeTelemetry(pings)
      const oldKmGps = telemetryRec.getFloat('km_gps_total') || 0
      const oldPingsCount = telemetryRec.getInt('pings_count') || 0
      const newKmGps = Number((sanitized.kmGpsTotalMeters / 1000).toFixed(2))
      const kmViario = telemetryRec.getFloat('km_viario_total') || 0

      // Atualizar campos canônicos no registro
      telemetryRec.set('pings_count', sanitized.dedupedPingsCount)
      telemetryRec.set('km_gps_total', newKmGps)
      telemetryRec.set('telemetry_gaps', sanitized.telemetryGaps)
      telemetryRec.set('gaps_count', sanitized.gapsCount)
      telemetryRec.set('gaps_total_seconds', sanitized.gapsTotalSeconds)

      // Reavaliar status de divergência usando os valores permitidos no select:
      // 'processed' | 'yellow_flag' | 'blocked_admin_decision'
      let diffPct = 0
      let newStatus = 'processed'
      if (kmViario > 0) {
        diffPct = Math.round((Math.abs(newKmGps - kmViario) / kmViario) * 100)
        if (diffPct > 15) {
          newStatus = 'yellow_flag'
        } else {
          newStatus = 'processed'
        }
      }
      telemetryRec.set('status', newStatus)

      // Gravar métricas adicionais em metadata JSON
      let metaObj = {}
      try {
        metaObj = telemetryRec.get('metadata') || {}
        if (typeof metaObj === 'string') metaObj = JSON.parse(metaObj)
      } catch (_) {}
      metaObj.purged_zombie_pings = true
      metaObj.divergence_pct = diffPct
      metaObj.recalculated_at = now
      telemetryRec.set('metadata', metaObj)

      app.save(telemetryRec)

      // Atualizar pedidos do lote com batch_telemetry_id consistente
      for (let j = 0; j < batchOrders.length; j++) {
        const ord = batchOrders[j]
        try {
          ord.set('batch_telemetry_id', telemetryRec.id)
          app.save(ord)
        } catch (_) {}
      }

      logAudit(
        telemetryRec.id,
        courierId,
        'expurgo_zumbi_recalculo_telemetria',
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
          purged_pings_total: purgedPingsCount,
          diff_pct: diffPct,
          status: newStatus,
        },
      )

      console.log(
        `[0196] Lote ${batchKey} saneado: pings ${oldPingsCount} -> ${sanitized.dedupedPingsCount}, km_gps ${oldKmGps} -> ${newKmGps} (viário: ${kmViario}km)`,
      )
    }
  }

  console.log(
    `[0196] Migração 0196 concluída. Total de pings zumbi expurgados: ${purgedPingsCount}`,
  )
})
