/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0160: Processa e extrai métricas do lote do Edson e grava em app_settings / audit_trail
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
      } catch (err) {}
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

    // Buscar ordens do Edson
    const courierId = 'tetrfu5oi19jbwz'
    const orders = app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && (route_released_at ~ '2026-10-11 16:54' || created ~ '2026-10-11 16:54' || route_started_at ~ '2026-10-11 16:54' || route_started_at ~ '2026-10-11 19:54' || route_released_at ~ '2026-10-11 19:54')`,
      'sequence,created',
      50,
      0,
    )

    if (orders && orders.length > 0) {
      orders.sort((a, b) => {
        const seqA = a.getInt('sequence') || 9999
        const seqB = b.getInt('sequence') || 9999
        return seqA - seqB
      })

      const firstO = orders[0]
      const lastO = orders[orders.length - 1]
      const empresaId = firstO.getString('empresa_id') || ''

      const startRaw =
        firstO.getString('route_started_at') ||
        firstO.getString('route_released_at') ||
        firstO.getString('created')
      const sTs = new Date(startRaw).getTime()
      const sMin = Math.floor(sTs / 60000)
      const batchKey = firstO.getString('route_batch_key') || `rb_${courierId}_20261011_${sMin}`

      let startMs = 0
      let finishMs = 0
      for (let i = 0; i < orders.length; i++) {
        const o = orders[i]
        const s =
          o.getString('route_started_at') ||
          o.getString('route_released_at') ||
          o.getString('created')
        if (s) {
          const t = new Date(s).getTime()
          if (t > 0 && (startMs === 0 || t < startMs)) startMs = t
        }
        const f = o.getString('route_finished_at') || o.getString('actual_arrival')
        if (f) {
          const t = new Date(f).getTime()
          if (t > finishMs) finishMs = t
        }
      }
      if (startMs === 0) startMs = new Date(firstO.getString('created')).getTime()
      if (finishMs === 0 || finishMs <= startMs) {
        finishMs = new Date(lastO.getString('updated')).getTime() || Date.now()
      }

      const startIso = new Date(startMs).toISOString()
      const finishIso = new Date(finishMs).toISOString()

      // Buscar pings
      let pings = []
      try {
        pings = app.findRecordsByFilter(
          'locations',
          `user_id = '${courierId}' && created >= '${startIso}' && created <= '${finishIso}'`,
          '+created',
          5000,
          0,
        )
      } catch (_) {}

      // Fallback expansivo caso o horário no banco esteja gravado em UTC ou local
      if (!pings || pings.length === 0) {
        // Tentar janela das 16:00 às 21:00 UTC e local do dia 11/10
        const dayStartIso = '2026-10-11T16:00:00.000Z'
        const dayEndIso = '2026-10-11T23:59:59.000Z'
        try {
          pings = app.findRecordsByFilter(
            'locations',
            `user_id = '${courierId}' && created >= '${dayStartIso}' && created <= '${dayEndIso}'`,
            '+created',
            5000,
            0,
          )
        } catch (_) {}
      }

      const pingsCount = pings.length
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

      // Corredor Viário OSRM
      const baseLat = firstO.getFloat('start_base_lat') || PILAR_BASE_LAT
      const baseLng = firstO.getFloat('start_base_lng') || PILAR_BASE_LNG

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
      const kmOficial =
        kmGpsTotal > 0 && kmViarioTotal > 0 ? Math.min(kmViarioTotal, kmGpsTotal) : kmViarioTotal

      // Salvar na coleção route_batch_telemetry
      const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
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
        if (empresaId) telemetryRecord.set('empresa_id', empresaId)
        telemetryRecord.set('km_gps_total', kmGpsTotal)
        telemetryRecord.set('km_viario_total', kmViarioTotal)
        telemetryRecord.set('km_oficial', kmOficial)
        telemetryRecord.set('legs_data', legsData)
        telemetryRecord.set('telemetry_gaps', telemetryGaps)
        telemetryRecord.set('gaps_count', gapsCount)
        telemetryRecord.set('gaps_total_seconds', gapsTotalSeconds)
        telemetryRecord.set('deviation_classification', [])
        telemetryRecord.set('return_to_base_data', {
          base_coords: { lat: baseLat, lng: baseLng },
          base_name: PILAR_BASE_NAME,
          km_viario_retorno: legsData.find((l) => l.is_return)
            ? legsData.find((l) => l.is_return).km_viario
            : 0,
          contado_uma_vez: true,
        })
        telemetryRecord.set('pings_count', pingsCount)
        if (pingsCount > 0) {
          telemetryRecord.set('first_ping_at', pings[0].getString('created'))
          telemetryRecord.set('last_ping_at', pings[pingsCount - 1].getString('created'))
        }
        telemetryRecord.set('route_started_at', startIso)
        telemetryRecord.set('route_finished_at', finishIso)
        telemetryRecord.set('status', 'processed')
        telemetryRecord.set('metadata', {
          batch_label: 'Lote 16h51 Edson (11/10/2026)',
          orders_count: orders.length,
          stops_count: stops.length,
          processed_at: new Date().toISOString(),
          km_gps_total: kmGpsTotal,
          km_viario_total: kmViarioTotal,
          km_oficial: kmOficial,
          gaps_count: gapsCount,
          gaps_total_seconds: gapsTotalSeconds,
          gaps: telemetryGaps,
        })
        app.save(telemetryRecord)
      }

      // Gravar em app_settings para relatório garantido
      try {
        let settingRec = null
        try {
          settingRec = app.findFirstRecordByData('app_settings', 'key', 'edson_16h51_report')
        } catch (_) {}
        const settingsCol = app.findCollectionByNameOrId('app_settings')
        if (!settingRec && settingsCol) {
          settingRec = new Record(settingsCol)
          settingRec.set('key', 'edson_16h51_report')
        }
        if (settingRec) {
          settingRec.set(
            'value',
            JSON.stringify({
              batchKey: batchKey,
              kmGpsTotal: kmGpsTotal,
              kmViarioTotal: kmViarioTotal,
              kmOficial: kmOficial,
              pingsCount: pingsCount,
              gapsCount: gapsCount,
              gapsTotalSeconds: gapsTotalSeconds,
              gaps: telemetryGaps,
              stopsCount: stops.length,
              ordersCount: orders.length,
            }),
          )
          app.save(settingRec)
        }
      } catch (_) {}
    }
  },
  (app) => {},
)
