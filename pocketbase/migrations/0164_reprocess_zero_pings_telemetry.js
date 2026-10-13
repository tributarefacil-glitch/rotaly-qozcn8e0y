/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0164: Reprocessa lotes de telemetria com pings_count=0 que possuem pings reais na janela.
 * - Reprocessa o lote da Figueira (rb_tetrfu5oi19jbwz_20261011_29862504), que possui pings em locations com user_id='tetrfu5oi19jbwz'.
 * - Identifica e padroniza chaves de lotes de hoje e do passado, incluindo o lote 18:06 de 13/10/2026 e o lote das 21:06 (rb_tetrfu5oi19jbwz_20261013_29865426).
 * - Busca de pings usa user_id da coleção locations com margem de tolerância temporal.
 * - Converte qualquer chave legada em formato batch_ para o padrão rb_{courierId}_{YYYYMMDD}_{startMin}.
 * - Registra entradas canônicas em audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true).
 */
migrate(
  (app) => {
    const PILAR_BASE_LAT = -22.6977499
    const PILAR_BASE_LNG = -43.2936013
    const PILAR_BASE_NAME = 'Drogaria Mais Saudável - Pilar'

    function haversineDistMeters(lat1, lon1, lat2, lon2) {
      if (lat1 === lat2 && lon1 === lon2) return 0
      const R = 6371000
      const toRad = Math.PI / 180
      const dLat = (lat2 - lat1) * toRad
      const dLon = (lon2 - lon1) * toRad
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2)
      return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
    }

    function distPtToSegMeters(px, py, ax, ay, bx, by) {
      const dAB = haversineDistMeters(ax, ay, bx, by)
      if (dAB === 0) return haversineDistMeters(px, py, ax, ay)
      const cosMeanLat = Math.cos((((ax + bx) / 2) * Math.PI) / 180)
      const x = (by - ay) * cosMeanLat
      const y = bx - ax
      const pxx = (py - ay) * cosMeanLat
      const pyy = px - ax
      const dot = pxx * x + pyy * y
      const lenSq = x * x + y * y
      const t = lenSq > 0 ? Math.max(0, Math.min(1, dot / lenSq)) : 0
      const projLat = ax + t * (bx - ax)
      const projLng = ay + t * (by - ay)
      return haversineDistMeters(px, py, projLat, projLng)
    }

    function queryOsrmRoute(originLat, originLng, destLat, destLng) {
      const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destLng},${destLat}?overview=full&geometries=geojson`
      try {
        const res = $http.send({
          url: url,
          method: 'GET',
          headers: { Accept: 'application/json' },
          timeout: 10,
        })
        if (
          res.statusCode === 200 &&
          res.json &&
          res.json.code === 'Ok' &&
          res.json.routes &&
          res.json.routes.length > 0
        ) {
          const r = res.json.routes[0]
          const distM = Number(r.distance) || 0
          const durS = Number(r.duration) || 0
          const coords = []
          if (r.geometry && Array.isArray(r.geometry.coordinates)) {
            for (let i = 0; i < r.geometry.coordinates.length; i++) {
              const pt = r.geometry.coordinates[i]
              coords.push({ lat: pt[1], lng: pt[0] })
            }
          }
          return {
            success: true,
            distanceMeters: distM,
            durationSeconds: durS,
            coordinates: coords,
          }
        }
      } catch (err) {
        console.log('[migration 0164] Falha OSRM:', err)
      }
      const directM = haversineDistMeters(originLat, originLng, destLat, destLng)
      return {
        success: false,
        distanceMeters: Math.round(directM * 1.3),
        durationSeconds: Math.round((directM / 1000) * 160 + 180),
        coordinates: [
          { lat: originLat, lng: originLng },
          { lat: destLat, lng: destLng },
        ],
      }
    }

    function processBatchInternal(batchKey) {
      console.log(`[migration 0164] Processando lote: ${batchKey}`)
      let orders = []
      try {
        orders = app.findRecordsByFilter(
          'orders',
          `route_batch_key = '${batchKey}' && status != 'cancelled'`,
          'sequence,created',
          200,
          0,
        )
      } catch (eOrders) {
        console.log(`[migration 0164] Erro ao buscar pedidos do lote ${batchKey}:`, eOrders)
      }

      if (!orders || orders.length === 0) {
        if (batchKey.startsWith('rb_')) {
          const parts = batchKey.split('_')
          if (parts.length >= 4) {
            const cId = parts[1]
            const sMin = Number(parts[3])
            const targetMs = sMin * 60000
            const minIso = new Date(targetMs - 5 * 60000).toISOString()
            const maxIso = new Date(targetMs + 5 * 60000).toISOString()
            try {
              orders = app.findRecordsByFilter(
                'orders',
                `courier_id = '${cId}' && route_started_at >= '${minIso}' && route_started_at <= '${maxIso}' && status != 'cancelled'`,
                'sequence,created',
                200,
                0,
              )
            } catch (_) {}
          }
        }
      }

      if (!orders || orders.length === 0) {
        console.log(`[migration 0164] Nenhum pedido encontrado para o lote ${batchKey}`)
        return null
      }

      orders.sort((a, b) => {
        const seqA = a.getInt('sequence') || 9999
        const seqB = b.getInt('sequence') || 9999
        if (seqA !== seqB) return seqA - seqB
        return (
          new Date(a.getString('created')).getTime() - new Date(b.getString('created')).getTime()
        )
      })

      const firstOrder = orders[0]
      const lastOrder = orders[orders.length - 1]
      const courierId = firstOrder.getString('courier_id')
      const empresaId = firstOrder.getString('empresa_id') || ''

      let isBicycle = false
      if (courierId) {
        try {
          const courierUser = app.findRecordById('users', courierId)
          if (courierUser) {
            const vt = (courierUser.getString('vehicle_type') || '').toLowerCase()
            if (vt === 'bicicleta' || vt === 'bike' || vt === 'bicycle') {
              isBicycle = true
            }
          }
        } catch (_) {}
      }

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
      if (startMs === 0) startMs = new Date(firstOrder.getString('created')).getTime()
      if (finishMs === 0 || finishMs <= startMs) {
        finishMs = new Date(lastOrder.getString('updated')).getTime() || Date.now()
      }

      // Margem de tolerância ampla de 10 minutos para busca de pings do entregador
      const startIso = new Date(startMs - 10 * 60000).toISOString()
      const finishIso = new Date(finishMs + 10 * 60000).toISOString()

      let pings = []
      try {
        pings = app.findRecordsByFilter(
          'locations',
          `user_id = '${courierId}' && created >= '${startIso}' && created <= '${finishIso}'`,
          '+created',
          5000,
          0,
        )
      } catch (eLoc) {
        console.log(`[migration 0164] Erro ao buscar locations para courier ${courierId}:`, eLoc)
      }

      const pingsCount = pings.length
      let firstPingAt = null
      let lastPingAt = null
      if (pingsCount > 0) {
        firstPingAt = pings[0].getString('created')
        lastPingAt = pings[pingsCount - 1].getString('created')
      }

      let kmGpsTotalMeters = 0
      const telemetryGaps = []
      let gapsCount = 0
      let gapsTotalSeconds = 0
      const telemetrySegments = []
      let currentSegment = []

      if (pingsCount >= 1) {
        currentSegment.push({
          lat: pings[0].getFloat('lat'),
          lng: pings[0].getFloat('lng'),
          created: pings[0].getString('created'),
          timeMs: new Date(pings[0].getString('created')).getTime(),
        })
      }

      for (let i = 1; i < pingsCount; i++) {
        const prev = pings[i - 1]
        const curr = pings[i]
        const prevLat = prev.getFloat('lat')
        const prevLng = prev.getFloat('lng')
        const currLat = curr.getFloat('lat')
        const currLng = curr.getFloat('lng')
        const prevTime = new Date(prev.getString('created')).getTime()
        const currTime = new Date(curr.getString('created')).getTime()
        const deltaSec = Math.max(0, Math.round((currTime - prevTime) / 1000))

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
        } else {
          const dMeters = haversineDistMeters(prevLat, prevLng, currLat, currLng)
          if (dMeters >= 3 || prevLat !== currLat || prevLng !== currLng) {
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

      const kmGpsTotal = Number((kmGpsTotalMeters / 1000).toFixed(2))

      const baseLat = firstOrder.getFloat('start_base_lat') || PILAR_BASE_LAT
      const baseLng = firstOrder.getFloat('start_base_lng') || PILAR_BASE_LNG

      const stops = []
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        const lat = o.getFloat('end_address_lat')
        const lng = o.getFloat('end_address_lng')
        if (lat && lng && lat !== 0 && lng !== 0) {
          stops.push({
            order_id: o.id,
            tracking_code: o.getString('tracking_code'),
            recipient: o.getString('end_address_name') || o.getString('receiver_name') || 'Cliente',
            address: o.getString('end_address_text') || '',
            lat: lat,
            lng: lng,
            sequence: o.getInt('sequence') || i + 1,
            actual_arrival: o.getString('actual_arrival'),
          })
        }
      }

      const legsData = []
      let kmViarioTotalMeters = 0
      const plannedRoadWaypoints = []

      if (stops.length > 0) {
        const p1 = stops[0]
        const leg1Route = queryOsrmRoute(baseLat, baseLng, p1.lat, p1.lng)
        kmViarioTotalMeters += leg1Route.distanceMeters
        plannedRoadWaypoints.push(...leg1Route.coordinates)
        legsData.push({
          leg_index: 1,
          from_name: 'Base Oficial Pilar',
          to_name: p1.recipient,
          order_id: p1.order_id,
          tracking_code: p1.tracking_code,
          km_viario: Number((leg1Route.distanceMeters / 1000).toFixed(2)),
          is_return: false,
        })

        for (let i = 0; i < stops.length - 1; i++) {
          const curr = stops[i]
          const next = stops[i + 1]
          const legRoute = queryOsrmRoute(curr.lat, curr.lng, next.lat, next.lng)
          kmViarioTotalMeters += legRoute.distanceMeters
          plannedRoadWaypoints.push(...legRoute.coordinates)
          legsData.push({
            leg_index: i + 2,
            from_name: curr.recipient,
            to_name: next.recipient,
            order_id: next.order_id,
            tracking_code: next.tracking_code,
            km_viario: Number((legRoute.distanceMeters / 1000).toFixed(2)),
            is_return: false,
          })
        }

        const lastStop = stops[stops.length - 1]
        const returnRoute = queryOsrmRoute(lastStop.lat, lastStop.lng, baseLat, baseLng)
        kmViarioTotalMeters += returnRoute.distanceMeters
        plannedRoadWaypoints.push(...returnRoute.coordinates)
        legsData.push({
          leg_index: stops.length + 1,
          from_name: lastStop.recipient,
          to_name: 'Volta à Base Oficial Pilar',
          order_id: null,
          tracking_code: null,
          km_viario: Number((returnRoute.distanceMeters / 1000).toFixed(2)),
          is_return: true,
        })
      }

      const kmViarioTotal = Number((kmViarioTotalMeters / 1000).toFixed(2))

      let accumulatedLegGpsMeters = 0
      const TOLERANCE_MS = 5 * 60 * 1000
      for (let l = 0; l < legsData.length; l++) {
        const leg = legsData[l]
        if (!leg.is_return && stops[l]) {
          const stop = stops[l]
          let legPingsMeters = 0
          const prevStopArrival =
            l > 0 && stops[l - 1].actual_arrival
              ? new Date(stops[l - 1].actual_arrival).getTime() - TOLERANCE_MS
              : startMs - TOLERANCE_MS
          const thisStopArrival = stop.actual_arrival
            ? new Date(stop.actual_arrival).getTime() + TOLERANCE_MS
            : finishMs + TOLERANCE_MS

          for (let p = 1; p < pingsCount; p++) {
            const ptTime = new Date(pings[p].getString('created')).getTime()
            const prevPtTime = new Date(pings[p - 1].getString('created')).getTime()
            const deltaSec = Math.max(0, Math.round((ptTime - prevPtTime) / 1000))
            if (deltaSec <= 90 && ptTime >= prevStopArrival && ptTime <= thisStopArrival) {
              legPingsMeters += haversineDistMeters(
                pings[p - 1].getFloat('lat'),
                pings[p - 1].getFloat('lng'),
                pings[p].getFloat('lat'),
                pings[p].getFloat('lng'),
              )
            }
          }

          leg.km_gps = Number((legPingsMeters / 1000).toFixed(2))
          accumulatedLegGpsMeters += legPingsMeters
        } else if (leg.is_return) {
          const returnGpsMeters = Math.max(0, kmGpsTotalMeters - accumulatedLegGpsMeters)
          leg.km_gps = Number((returnGpsMeters / 1000).toFixed(2))
        }
      }

      const DEVIATION_THRESHOLD_METERS = 150
      const deviationSections = []
      let currentDeviation = null
      if (plannedRoadWaypoints.length >= 2) {
        for (let s = 0; s < telemetrySegments.length; s++) {
          const segment = telemetrySegments[s]
          for (let p = 0; p < segment.length; p++) {
            const ping = segment[p]
            let minDistanceToRoad = Infinity
            for (let w = 0; w < plannedRoadWaypoints.length - 1; w++) {
              const w1 = plannedRoadWaypoints[w]
              const w2 = plannedRoadWaypoints[w + 1]
              const dist = distPtToSegMeters(ping.lat, ping.lng, w1.lat, w1.lng, w2.lat, w2.lng)
              if (dist < minDistanceToRoad) minDistanceToRoad = dist
            }
            const isOffRoute = minDistanceToRoad > DEVIATION_THRESHOLD_METERS
            if (isOffRoute) {
              if (!currentDeviation) {
                currentDeviation = {
                  start_iso: ping.created,
                  end_iso: ping.created,
                  max_deviation_meters: Math.round(minDistanceToRoad),
                  pings_count: 1,
                  start_coords: { lat: ping.lat, lng: ping.lng },
                  end_coords: { lat: ping.lat, lng: ping.lng },
                }
              } else {
                currentDeviation.end_iso = ping.created
                currentDeviation.pings_count++
                currentDeviation.end_coords = { lat: ping.lat, lng: ping.lng }
                if (minDistanceToRoad > currentDeviation.max_deviation_meters) {
                  currentDeviation.max_deviation_meters = Math.round(minDistanceToRoad)
                }
              }
            } else {
              if (currentDeviation && currentDeviation.pings_count >= 2) {
                deviationSections.push(currentDeviation)
              }
              currentDeviation = null
            }
          }
          if (currentDeviation && currentDeviation.pings_count >= 2) {
            deviationSections.push(currentDeviation)
          }
          currentDeviation = null
        }
      }

      const lastLeg = legsData.find((l) => l.is_return) || null
      const returnToBaseData = {
        base_coords: { lat: baseLat, lng: baseLng },
        base_name: PILAR_BASE_NAME,
        km_viario_retorno: lastLeg ? lastLeg.km_viario : 0,
        km_gps_retorno: lastLeg ? lastLeg.km_gps : 0,
        contado_uma_vez: true,
      }

      let kmOficial = kmViarioTotal
      let status = 'processed'
      let diffPct = 0
      if (kmGpsTotal > 0 && kmViarioTotal > 0) {
        kmOficial = Math.min(kmViarioTotal, kmGpsTotal)
        diffPct = Math.round((Math.abs(kmGpsTotal - kmViarioTotal) / kmViarioTotal) * 100)
        if (diffPct > 20) status = 'yellow_flag'
      } else if (kmViarioTotal > 0) {
        kmOficial = kmViarioTotal
      }

      const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
      let telemetryRecord = null
      try {
        telemetryRecord = app.findFirstRecordByData(
          'route_batch_telemetry',
          'route_batch_key',
          batchKey,
        )
      } catch (_) {
        telemetryRecord = null
      }
      if (!telemetryRecord && telemetryCol) {
        telemetryRecord = new Record(telemetryCol)
        telemetryRecord.set('route_batch_key', batchKey)
      }
      if (telemetryRecord) {
        telemetryRecord.set('courier_id', courierId)
        if (empresaId) telemetryRecord.set('empresa_id', empresaId)
        telemetryRecord.set('km_gps_total', kmGpsTotal)
        telemetryRecord.set('km_viario_total', kmViarioTotal)
        telemetryRecord.set('km_oficial', kmOficial)
        telemetryRecord.set('legs_data', legsData)
        telemetryRecord.set('telemetry_gaps', telemetryGaps)
        telemetryRecord.set('gaps_count', gapsCount)
        telemetryRecord.set('gaps_total_seconds', gapsTotalSeconds)
        telemetryRecord.set('deviation_classification', deviationSections)
        telemetryRecord.set('return_to_base_data', returnToBaseData)
        telemetryRecord.set('pings_count', pingsCount)
        if (firstPingAt) telemetryRecord.set('first_ping_at', firstPingAt)
        if (lastPingAt) telemetryRecord.set('last_ping_at', lastPingAt)
        telemetryRecord.set('route_started_at', new Date(startMs).toISOString())
        telemetryRecord.set('route_finished_at', new Date(finishMs).toISOString())
        telemetryRecord.set('status', status)
        telemetryRecord.set('metadata', {
          is_bicycle: isBicycle,
          diff_pct: diffPct,
          trigger_origin: 'migration_0164_reprocess_zero_pings',
          processed_at: new Date().toISOString(),
          stops_count: stops.length,
          orders_count: orders.length,
        })
        app.save(telemetryRecord)
      }

      const batchTelemetryId = telemetryRecord ? telemetryRecord.id : ''
      for (let i = 0; i < orders.length; i++) {
        const ord = orders[i]
        let needSave = false
        if (ord.getString('route_batch_key') !== batchKey) {
          ord.set('route_batch_key', batchKey)
          needSave = true
        }
        if (batchTelemetryId && ord.getString('batch_telemetry_id') !== batchTelemetryId) {
          ord.set('batch_telemetry_id', batchTelemetryId)
          needSave = true
        }
        const matchedLeg = legsData.find((l) => l.order_id === ord.id)
        if (matchedLeg && matchedLeg.km_gps !== undefined) {
          ord.set('km_real_perna', matchedLeg.km_gps)
          needSave = true
        }
        if (ord.getFloat('total_route_with_return_km') !== kmOficial) {
          ord.set('total_route_with_return_km', kmOficial)
          needSave = true
        }
        if (needSave) {
          try {
            app.save(ord)
          } catch (_) {}
        }
      }

      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('collection', 'route_batch_telemetry')
          auditRec.set('record_id', telemetryRecord ? telemetryRecord.id : batchKey)
          if (courierId) auditRec.set('courier_id', courierId)
          auditRec.set('action', 'reprocessar_lote_telemetria_canonica_migracao_0164')
          auditRec.set('field', 'km_oficial')
          auditRec.set('old_value', `viario=${kmViarioTotal}km`)
          auditRec.set(
            'new_value',
            `gps=${kmGpsTotal}km, pings=${pingsCount}, oficial=${kmOficial}km`,
          )
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
            trigger_origin: 'migration_0164',
          })
          app.save(auditRec)
        }
      } catch (_) {}

      console.log(
        `[migration 0164] Lote ${batchKey} reprocessado com sucesso: GPS=${kmGpsTotal} km, viário=${kmViarioTotal} km, pings=${pingsCount}`,
      )
      return {
        batchKey,
        pingsCount,
        kmGpsTotal,
        kmViarioTotal,
        kmOficial,
      }
    }

    // 1. Padronizar pedidos de hoje (13/10) que tenham finalizado sem route_batch_key (ex: lote das 18:44 / 18:00)
    try {
      const todayOrders = app.findRecordsByFilter(
        'orders',
        "created >= '2026-10-13 00:00:00' && route_started = true && (route_batch_key = '' || route_batch_key ~ 'batch_')",
        'created',
        500,
        0,
      )
      console.log(
        `[migration 0164] Pedidos de hoje para padronização de chave: ${todayOrders.length}`,
      )
      for (let i = 0; i < todayOrders.length; i++) {
        const ord = todayOrders[i]
        const cId = ord.getString('courier_id')
        const startRaw = ord.getString('route_started_at') || ord.getString('created')
        const sDate = new Date(startRaw)
        const sTs = sDate.getTime()
        const sMin = Math.floor(sTs / 60000)
        const yyyy = sDate.getFullYear()
        const mm = String(sDate.getMonth() + 1).padStart(2, '0')
        const dd = String(sDate.getDate()).padStart(2, '0')
        const canonicalKey = `rb_${cId}_${yyyy}${mm}${dd}_${sMin}`
        ord.set('route_batch_key', canonicalKey)
        app.save(ord)
        console.log(`[migration 0164] Pedido ${ord.id} atualizado para chave ${canonicalKey}`)
      }
    } catch (eToday) {
      console.log('[migration 0164] Erro ao padronizar pedidos de hoje:', eToday)
    }

    // 2. Coletar lotes a reprocessar:
    // a) Lote da Figueira: rb_tetrfu5oi19jbwz_20261011_29862504
    // b) Lote 21:06 de hoje: rb_tetrfu5oi19jbwz_20261013_29865426
    // c) Qualquer outro lote existente em route_batch_telemetry com pings_count = 0
    const batchesToProcess = new Set([
      'rb_tetrfu5oi19jbwz_20261011_29862504',
      'rb_tetrfu5oi19jbwz_20261013_29865426',
    ])

    // Também adicionar lote das 18:44 de hoje caso gerado
    try {
      const oct13Orders = app.findRecordsByFilter(
        'orders',
        "route_started_at >= '2026-10-13 18:40:00' && route_started_at <= '2026-10-13 18:50:00' && courier_id = 'tetrfu5oi19jbwz'",
        'created',
        10,
        0,
      )
      if (oct13Orders && oct13Orders.length > 0) {
        const bKey = oct13Orders[0].getString('route_batch_key')
        if (bKey) batchesToProcess.add(bKey)
      }
    } catch (_) {}

    try {
      const zeroPingsBatches = app.findRecordsByFilter(
        'route_batch_telemetry',
        'pings_count = 0',
        '-created',
        100,
        0,
      )
      console.log(
        `[migration 0164] Lotes com pings_count=0 encontrados: ${zeroPingsBatches.length}`,
      )
      for (let i = 0; i < zeroPingsBatches.length; i++) {
        const bKey = zeroPingsBatches[i].getString('route_batch_key')
        if (bKey) batchesToProcess.add(bKey)
      }
    } catch (eZero) {
      console.log('[migration 0164] Erro ao buscar lotes zero pings:', eZero)
    }

    batchesToProcess.forEach((bKey) => {
      try {
        processBatchInternal(bKey)
      } catch (eProc) {
        console.log(`[migration 0164] Erro ao reprocessar lote ${bKey}:`, eProc)
      }
    })
  },
  (app) => {
    // Reversão vazia (idempotente)
  },
)
