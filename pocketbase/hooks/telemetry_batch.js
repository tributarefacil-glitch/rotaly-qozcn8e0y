/**
 * pocketbase/hooks/telemetry_batch.js
 *
 * Endpoint de telemetria em lote estilo iFood:
 * POST /backend/v1/telemetry-batch
 *
 * Aceita array de posições em um único POST HTTP:
 * {
 *   "user_id": "...", // opcional se cada item tiver ou se autenticado
 *   "items": [
 *     { "lat": -22.x, "lng": -43.x, "speed": 15, "heading": 180, "accuracy": 12, "battery_level": 85, "location_timestamp": "...", "gps_status": "active", "offline_buffered": false },
 *     ...
 *   ]
 * }
 *
 * Cada posição válida do lote é gravada na coleção 'locations' via $app.save(record),
 * disparando normalmente os hooks e guardas de locations (zombie_ping_guard, on_location_alert, etc).
 *
 * Preserva compatibilidade 100% com o endpoint de ping individual legado /api/collections/locations/records.
 */

routerAdd('POST', '/backend/v1/telemetry-batch', (e) => {
  let body = {}
  try {
    const reqInfo = e.requestInfo()
    body = (reqInfo && reqInfo.body) || {}
  } catch (err) {
    try {
      body = e.get('body') || {}
    } catch (_) {}
  }

  // Compatibilidade com payload array direto ou { items: [...] } ou { positions: [...] }
  let items = []
  if (Array.isArray(body)) {
    items = body
  } else if (Array.isArray(body.items)) {
    items = body.items
  } else if (Array.isArray(body.positions)) {
    items = body.positions
  } else if (body && body.lat !== undefined && body.lng !== undefined) {
    // Se enviou um único objeto por engano
    items = [body]
  }

  if (!items || items.length === 0) {
    return e.json(400, {
      success: false,
      message: 'Nenhum item de telemetria fornecido no lote.',
      processed: 0,
      saved: 0,
    })
  }

  // Obter usuário do token de auth ou do payload
  let authUserId = ''
  try {
    if (e.auth) {
      authUserId = e.auth.id || e.auth.getString('id') || ''
    }
  } catch (_) {}

  const fallbackUserId = typeof body.user_id === 'string' ? body.user_id : authUserId

  let locationsCol = null
  try {
    locationsCol = $app.findCollectionByNameOrId('locations')
  } catch (errCol) {
    return e.json(500, {
      success: false,
      message: 'Coleção locations não encontrada no servidor: ' + errCol,
    })
  }

  let savedCount = 0
  let discardedCount = 0
  const results = []

  const round6 = (v) => Math.round((v + Number.EPSILON) * 1e6) / 1e6

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    if (!it) continue

    const itemUserId = it.user_id || fallbackUserId
    if (!itemUserId) {
      discardedCount++
      results.push({ index: i, saved: false, reason: 'missing_user_id' })
      continue
    }

    const rawLat = typeof it.lat === 'number' ? it.lat : parseFloat(it.lat)
    const rawLng = typeof it.lng === 'number' ? it.lng : parseFloat(it.lng)

    if (isNaN(rawLat) || isNaN(rawLng)) {
      discardedCount++
      results.push({ index: i, saved: false, reason: 'invalid_coordinates' })
      continue
    }

    const lat = round6(rawLat)
    const lng = round6(rawLng)

    // Rejeição de coordenadas mundiais impossíveis ou nulas
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) {
      discardedCount++
      results.push({ index: i, saved: false, reason: 'null_island_coordinates' })
      continue
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      discardedCount++
      results.push({ index: i, saved: false, reason: 'out_of_bounds_coordinates' })
      continue
    }

    // Guarda de precisão (accuracy >= 100 descartado pelo zombie_ping_guard)
    const acc = typeof it.accuracy === 'number' ? it.accuracy : parseFloat(it.accuracy) || 10.0
    if (acc >= 100) {
      discardedCount++
      results.push({ index: i, saved: false, reason: 'accuracy_too_high' })
      continue
    }

    // GUARDA DE PLAUSIBILIDADE DE VELOCIDADE: descartar ping com velocidade > 140 km/h
    let speed = typeof it.speed === 'number' ? it.speed : parseFloat(it.speed) || 0.0
    if (speed > 140) {
      discardedCount++
      console.log(
        '[telemetry_batch] Descartado ping com velocidade implausível (' +
          speed +
          ' km/h > 140 km/h) para user ' +
          itemUserId,
      )
      results.push({ index: i, saved: false, reason: 'speed_implausible' })
      continue
    }

    const heading = typeof it.heading === 'number' ? it.heading : parseFloat(it.heading) || 0.0
    const gpsStatus = typeof it.gps_status === 'string' ? it.gps_status : 'active'
    const gpsReason = typeof it.gps_reason === 'string' ? it.gps_reason : ''
    const offlineBuffered = Boolean(it.offline_buffered)

    let batteryLevel = null
    const bRaw = it.battery_level !== undefined ? it.battery_level : it.battery
    if (typeof bRaw === 'number' && bRaw > 0 && bRaw <= 100) {
      batteryLevel = Math.round(bRaw)
    }

    // location_timestamp formatado ISO
    let locTimestamp = ''
    if (it.location_timestamp) {
      locTimestamp = String(it.location_timestamp)
    } else if (it.timestamp) {
      try {
        locTimestamp = new Date(it.timestamp).toISOString()
      } catch (_) {
        locTimestamp = new Date().toISOString()
      }
    } else {
      locTimestamp = new Date().toISOString()
    }

    try {
      const rec = new Record(locationsCol)
      rec.set('user_id', itemUserId)
      rec.set('lat', lat)
      rec.set('lng', lng)
      rec.set('speed', Math.round(speed * 10) / 10)
      rec.set('heading', Math.round(heading * 10) / 10)
      rec.set('accuracy', Math.round(acc * 10) / 10)
      rec.set('gps_status', gpsStatus)
      if (gpsReason) rec.set('gps_reason', gpsReason)
      rec.set('offline_buffered', offlineBuffered)
      if (batteryLevel !== null) {
        rec.set('battery_level', batteryLevel)
      }
      rec.set('location_timestamp', locTimestamp)

      $app.save(rec)
      savedCount++
      results.push({ index: i, saved: true, id: rec.id })
    } catch (saveErr) {
      discardedCount++
      const errMsg = saveErr ? String(saveErr.message || saveErr) : 'unknown_error'
      results.push({ index: i, saved: false, reason: errMsg })
    }
  }

  return e.json(200, {
    success: true,
    total: items.length,
    saved: savedCount,
    discarded: discardedCount,
    results: results,
  })
})
