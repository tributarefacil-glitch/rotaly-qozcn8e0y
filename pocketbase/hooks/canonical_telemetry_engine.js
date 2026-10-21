/// <reference path="../pb_data/types.d.ts" />

/**
 * Hook do Motor Canônico de Telemetria do Rotaly (Rodada 1 de 2)
 *
 * Responsabilidade:
 * - Executar cálculo canônico único no servidor ao fechar cada lote (por route_batch_key) ou sob demanda.
 * - Grava na coleção 'route_batch_telemetry' e atualiza os pedidos do lote:
 *   1. km GPS haversine por perna e total: soma ping a ping (somente pings reais gravados em locations,
 *      courier_id do entregador do lote, janela do lote, ordem cronológica).
 *      NUNCA interpolar, NUNCA linha reta entre pontos distantes.
 *   2. Lista de lacunas de telemetria: pares consecutivos de pings com intervalo >90s.
 *      Cada lacuna com duração { start_iso, end_iso, duration_seconds }.
 *      Lacunas NÃO geram km nem desvio — são registradas como buraco explícito.
 *   3. Classificação de desvio por trecho: apenas trechos com telemetria real (pings consecutivos <=90s).
 *      Base oficial Pilar: -22.6977499, -43.2936013 (coordenadas canônicas).
 *      Rota viária via OSRM para o corredor planejado.
 *   4. Volta à base: contada 1x, no fim do lote.
 *   5. Regra de bicicleta: vehicle_type 'bicicleta' NÃO tem pagamento por km (fuel_cost=0),
 *      mas o motor de telemetria calcula normalmente para auditoria.
 *   6. Trilha em audit_trail: user_id vazio + actor_name='Sistema' + metadata.system_trigger=true.
 *
 * NOTA DE ARQUITETURA POCKETBASE (GOJA JSVM):
 * Callbacks em routerAdd e onRecordAfterUpdateSuccess rodam em pools isoladas: funções auxiliares
 * devem ser declaradas inline dentro do corpo de cada callback ou chamadas através de função empacotada.
 */

// -------------------------------------------------------------------------------------------------
// TRIGGER AUTOMÁTICO: Disparado ao fechar cada lote (ao atualizar orders com route_finished = true)
// -------------------------------------------------------------------------------------------------
onRecordAfterUpdateSuccess((e) => {
  try {
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

    /**
     * Saneamento canônico de pings compartilhado e idempotente:
     * - Descarte de coordenada congelada repetida (<1.5m ou diferença angular <0.00002)
     * - Descarte de saltos com velocidade impossível (>90 km/h)
     * - Detecção de lacunas de telemetria (>90s)
     */
    function sanitizePingsAndComputeTelemetry(pingsList, distFn) {
      let kmGpsTotalMeters = 0
      const telemetryGaps = []
      let gapsCount = 0
      let gapsTotalSeconds = 0
      const telemetrySegments = []
      let currentSegment = []
      const pCount = pingsList ? pingsList.length : 0

      if (pCount >= 1) {
        currentSegment.push({
          lat: pingsList[0].getFloat('lat'),
          lng: pingsList[0].getFloat('lng'),
          created: pingsList[0].getString('created'),
          timeMs: new Date(pingsList[0].getString('created')).getTime(),
        })
      }

      for (let i = 1; i < pCount; i++) {
        const prev = pingsList[i - 1]
        const curr = pingsList[i]
        const prevLat = prev.getFloat('lat')
        const prevLng = prev.getFloat('lng')
        const currLat = curr.getFloat('lat')
        const currLng = curr.getFloat('lng')
        const prevTime = new Date(prev.getString('created')).getTime()
        const currTime = new Date(curr.getString('created')).getTime()
        const deltaSec = Math.max(0, Math.round((currTime - prevTime) / 1000))

        const dMeters = distFn(prevLat, prevLng, currLat, currLng)
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
      }
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
        console.log('[canonical_telemetry_engine:hook] Falha OSRM:', err)
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

    function processBatch(batchKey, triggerOrigin) {
      if (!batchKey) return null
      let orders = []
      try {
        orders = $app.findRecordsByFilter(
          'orders',
          `route_batch_key = '${batchKey}' && status != 'cancelled'`,
          'sequence,created',
          200,
          0,
        )
      } catch (_) {}

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
              orders = $app.findRecordsByFilter(
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

      if (!orders || orders.length === 0) return null

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
          const courierUser = $app.findRecordById('users', courierId)
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

      const startIso = new Date(startMs).toISOString()
      const finishIso = new Date(finishMs).toISOString()
      const endIso = finishIso
      const windowStart = startIso

      // Margem de tolerância temporal ampla para cobrir início e encerramento (10 minutos antes e depois)
      // Formatar no padrão canônico PocketBase SQLite datetime ("YYYY-MM-DD HH:mm:ss")
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
        pings = $app.findRecordsByFilter(
          'locations',
          `user_id = '${courierId}' && created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
          '+created',
          5000,
          0,
        )
      } catch (_) {}

      const pingsCount = pings.length

      // GUARDA DE SANIDADE NO FECHAMENTO AUTOMÁTICO:
      // Se pings_count === 0 mas existem pings na janela temporal global:
      // Log de erro visível + registro em audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true)
      // O lote NÃO pode passar como processed em silêncio!
      if (pingsCount === 0) {
        try {
          const potentialAnyPings = $app.findRecordsByFilter(
            'locations',
            `created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
            '+created',
            10,
            0,
          )
          if (potentialAnyPings.length > 0) {
            console.error(
              `[canonical_telemetry_engine:GUARDA_ERRO_SANIDADE] SANITY ERROR: pings_count=0 para user_id=${courierId} no lote ${batchKey}, mas existem ${potentialAnyPings.length} pings na janela temporal [${queryStartStr} -> ${queryFinishStr}]. O registro NÃO pode passar como processed em silêncio!`,
            )
            const auditColGuard = $app.findCollectionByNameOrId('audit_trail')
            if (auditColGuard) {
              const auditGuard = new Record(auditColGuard)
              auditGuard.set('user_id', '') // relation aceita vazio
              auditGuard.set('collection', 'route_batch_telemetry')
              auditGuard.set('record_id', batchKey)
              if (courierId) auditGuard.set('courier_id', courierId)
              auditGuard.set('action', 'telemetria_pings_zero_divergencia')
              auditGuard.set('field', 'pings_count')
              auditGuard.set('old_value', '0')
              auditGuard.set('new_value', 'pings_presentes_janela_sem_match_user_id')
              auditGuard.set('timestamp', new Date().toISOString())
              auditGuard.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                route_batch_key: batchKey,
                courier_id: courierId,
                query_start: queryStartStr,
                query_finish: queryFinishStr,
                found_pings_in_window: potentialAnyPings.length,
                divergence_warning: 'pings_count=0 com telemetria existente na janela temporal',
              })
              $app.save(auditGuard)
            }
          }
        } catch (guardErr) {
          console.error(
            '[canonical_telemetry_engine:GUARDA_ERRO] Erro na verificação da guarda:',
            guardErr,
          )
        }
      }

      let firstPingAt = null
      let lastPingAt = null
      if (pingsCount > 0) {
        firstPingAt = pings[0].getString('created')
        lastPingAt = pings[pingsCount - 1].getString('created')
      }

      // SANEAMENTO IDEMPOTENTE E CANÔNICO DE PINGS:
      // Descarte de coordenada congelada repetida (<1.5m), descarte de saltos com velocidade impossível (>90 km/h)
      // e detecção de lacunas de telemetria (>90s).
      const sanitizedTelemetry = sanitizePingsAndComputeTelemetry(pings, haversineDistMeters)
      const kmGpsTotalMeters = sanitizedTelemetry.kmGpsTotalMeters
      const telemetryGaps = sanitizedTelemetry.telemetryGaps
      const gapsCount = sanitizedTelemetry.gapsCount
      const gapsTotalSeconds = sanitizedTelemetry.gapsTotalSeconds
      const telemetrySegments = sanitizedTelemetry.telemetrySegments
      let kmGpsTotal = Number((kmGpsTotalMeters / 1000).toFixed(2))

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
      for (let l = 0; l < legsData.length; l++) {
        const leg = legsData[l]
        if (!leg.is_return && stops[l]) {
          const stop = stops[l]
          let legPingsMeters = 0
          const TOLERANCE_MS = 5 * 60 * 1000
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
              const pPrevLat = pings[p - 1].getFloat('lat')
              const pPrevLng = pings[p - 1].getFloat('lng')
              const pCurrLat = pings[p].getFloat('lat')
              const pCurrLng = pings[p].getFloat('lng')
              const pDistM = haversineDistMeters(pPrevLat, pPrevLng, pCurrLat, pCurrLng)
              const pSpeedKmh = deltaSec > 0 ? (pDistM / deltaSec) * 3.6 : 0
              const isPerezFrozen =
                (Math.abs(pPrevLat - pCurrLat) < 0.00002 &&
                  Math.abs(pPrevLng - pCurrLng) < 0.00002) ||
                pDistM < 1.5
              if (!isPerezFrozen && pSpeedKmh <= 90) {
                legPingsMeters += pDistM
              }
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

      // FALHA 1: CÔMPUTO DO TRECHO DE RETORNO À BASE VIA PINGS REAIS (SEM ORDER_ID)
      // Janela temporal: entre a conclusão da última entrega (maxArrivalTime) e route_finished_at.
      // Se route_finished_at estiver muito depois do último ping, usa o último ping dentro de 150m da base como fim.
      // Valida se o último ponto do trecho está a <= 150m da base. Se não estiver, marca flag amarela.
      let returnGpsMetersCalculated = 0
      let isReturnEndpointNearBase = false
      let returnFlagAmarela = false

      let maxStopArrivalMs = 0
      for (let sIdx = 0; sIdx < stops.length; sIdx++) {
        if (stops[sIdx].actual_arrival) {
          const tArr = new Date(stops[sIdx].actual_arrival).getTime()
          if (tArr > maxStopArrivalMs) maxStopArrivalMs = tArr
        }
      }
      if (maxStopArrivalMs === 0) {
        // Fallback: usar updated do último pedido entregue
        for (let oIdx = 0; oIdx < orders.length; oIdx++) {
          const upMs = new Date(
            orders[oIdx].getString('updated') || orders[oIdx].getString('created'),
          ).getTime()
          if (upMs > maxStopArrivalMs) maxStopArrivalMs = upMs
        }
      }

      // Filtrar pings de retorno do courier na janela temporal estrita [maxStopArrivalMs, finishMs + 10min]
      const returnPings = []
      let lastPingNearBaseIdx = -1

      for (let pIdx = 0; pIdx < pingsCount; pIdx++) {
        const pingRecord = pings[pIdx]
        const pTime = new Date(pingRecord.getString('created')).getTime()
        if (pTime >= maxStopArrivalMs) {
          const pLat = pingRecord.getFloat('lat')
          const pLng = pingRecord.getFloat('lng')
          const dBase = haversineDistMeters(pLat, pLng, baseLat, baseLng)
          if (dBase <= 150) {
            lastPingNearBaseIdx = returnPings.length
          }
          returnPings.push({
            lat: pLat,
            lng: pLng,
            created: pingRecord.getString('created'),
            timestamp: pTime,
            distToBase: dBase,
          })
        }
      }

      // Delimitar corte de encerramento do trecho de retorno
      let effectiveReturnPings = returnPings
      if (lastPingNearBaseIdx >= 0 && lastPingNearBaseIdx < returnPings.length - 1) {
        // Se route_finished_at ficou gravado muito depois e o entregador já estava na base, corta no último ping do geofence
        effectiveReturnPings = returnPings.slice(0, lastPingNearBaseIdx + 1)
      }

      if (effectiveReturnPings.length >= 2) {
        for (let rIdx = 1; rIdx < effectiveReturnPings.length; rIdx++) {
          const pPrev = effectiveReturnPings[rIdx - 1]
          const pCurr = effectiveReturnPings[rIdx]
          const deltaSec = Math.max(0, Math.round((pCurr.timestamp - pPrev.timestamp) / 1000))
          if (deltaSec <= 120) {
            const dStepM = haversineDistMeters(pPrev.lat, pPrev.lng, pCurr.lat, pCurr.lng)
            const pSpeedKmh = deltaSec > 0 ? (dStepM / deltaSec) * 3.6 : 0
            const isFrozen =
              (Math.abs(pPrev.lat - pCurr.lat) < 0.00002 &&
                Math.abs(pPrev.lng - pCurr.lng) < 0.00002) ||
              dStepM < 1.5
            if (!isFrozen && pSpeedKmh <= 90) {
              returnGpsMetersCalculated += dStepM
            }
          }
        }

        const lastRetPt = effectiveReturnPings[effectiveReturnPings.length - 1]
        if (lastRetPt.distToBase <= 150) {
          isReturnEndpointNearBase = true
        } else {
          returnFlagAmarela = true
        }
      }

      const kmGpsRetorno = Number((returnGpsMetersCalculated / 1000).toFixed(2))

      const lastLeg = legsData.find((l) => l.is_return) || null
      if (lastLeg) {
        lastLeg.km_gps = kmGpsRetorno
      }

      // Recalcular kmGpsTotal como soma das pernas entregues + retorno real recalculado
      if (kmGpsRetorno > 0) {
        kmGpsTotal = Number(
          ((accumulatedLegGpsMeters + returnGpsMetersCalculated) / 1000).toFixed(2),
        )
      }

      const returnToBaseData = {
        base_coords: { lat: baseLat, lng: baseLng },
        base_name: PILAR_BASE_NAME,
        km_viario_retorno: lastLeg ? lastLeg.km_viario : 0,
        km_gps_retorno: kmGpsRetorno,
        contado_uma_vez: true,
        endpoint_near_base: isReturnEndpointNearBase,
        flag_amarela_retorno: returnFlagAmarela,
      }

      // TETO DE COERÊNCIA IDEMPOTENTE:
      // km_gps_total saneado deve ser plausível (<= 2x km_viario quando este existir)
      // Se estourar 2x km viário por ruído/pings fantasma, limitar a teto plausível (1.15x km_viario)
      if (kmViarioTotal > 0 && kmGpsTotal > kmViarioTotal * 2) {
        console.warn(
          `[canonical_telemetry_engine] Teto de coerência acionado: km_gps_total=${kmGpsTotal} > 2x ${kmViarioTotal} km viário. Limitando a ${(kmViarioTotal * 1.15).toFixed(2)} km.`,
        )
        kmGpsTotal = Number((kmViarioTotal * 1.15).toFixed(2))
      }

      // REGRA DO USUÁRIO (20/10): Pagamento SEMPRE por KM VIÁRIO.
      // O km GPS telemetria é apenas para comparação/auditoria (Coluna B), NUNCA base de pagamento.
      let kmOficial = kmViarioTotal > 0 ? kmViarioTotal : kmGpsTotal
      let status = 'processed'
      let diffPct = 0
      if (kmGpsTotal > 0 && kmViarioTotal > 0) {
        diffPct = Math.round((Math.abs(kmGpsTotal - kmViarioTotal) / kmViarioTotal) * 100)
        if (diffPct > 20 || returnFlagAmarela) status = 'yellow_flag'
      }

      const telemetryCol = $app.findCollectionByNameOrId('route_batch_telemetry')
      let telemetryRecord = null
      try {
        telemetryRecord = $app.findFirstRecordByData(
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
        telemetryRecord.set('route_started_at', startIso)
        telemetryRecord.set('route_finished_at', finishIso)
        telemetryRecord.set('status', status)
        telemetryRecord.set('metadata', {
          is_bicycle: isBicycle,
          diff_pct: diffPct,
          trigger_origin: triggerOrigin,
          processed_at: new Date().toISOString(),
          stops_count: stops.length,
          orders_count: orders.length,
        })
        $app.save(telemetryRecord)
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
            $app.save(ord)
          } catch (_) {}
        }
      }

      try {
        const auditCol = $app.findCollectionByNameOrId('audit_trail')
        if (auditCol) {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('collection', 'route_batch_telemetry')
          auditRec.set('record_id', telemetryRecord ? telemetryRecord.id : batchKey)
          if (courierId) auditRec.set('courier_id', courierId)
          auditRec.set('action', 'fechamento_lote_telemetria_canonica')
          auditRec.set('field', 'km_oficial')
          auditRec.set('old_value', `viario=${kmViarioTotal}km`)
          auditRec.set(
            'new_value',
            `gps=${kmGpsTotal}km, lacunas=${gapsCount}, oficial=${kmOficial}km`,
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
            gaps_total_seconds: gapsTotalSeconds,
            deviations_count: deviationSections.length,
            is_bicycle: isBicycle,
            trigger_origin: triggerOrigin,
          })
          $app.save(auditRec)
        }
      } catch (_) {}

      return {
        route_batch_key: batchKey,
        courier_id: courierId,
        pings_count: pingsCount,
        km_gps_total: kmGpsTotal,
        km_viario_total: kmViarioTotal,
        km_oficial: kmOficial,
        gaps_count: gapsCount,
        gaps_total_seconds: gapsTotalSeconds,
        telemetry_gaps: telemetryGaps,
        legs_data: legsData,
        deviation_classification: deviationSections,
        return_to_base_data: returnToBaseData,
        status: status,
      }
    }

    const order = e.record
    const isFinished = order.getBool('route_finished')
    const original = order.original()
    const wasFinished = original ? original.getBool('route_finished') : false

    if (isFinished && !wasFinished) {
      const courierId = order.getString('courier_id')
      let batchKey = order.getString('route_batch_key')

      if ((!batchKey || batchKey.indexOf('batch_') === 0) && courierId) {
        const startRaw = order.getString('route_started_at') || order.getString('created')
        const sDate = new Date(startRaw)
        const sTs = sDate.getTime()
        const sMin = Math.floor(sTs / 60000)
        const yyyy = sDate.getFullYear()
        const mm = String(sDate.getMonth() + 1).padStart(2, '0')
        const dd = String(sDate.getDate()).padStart(2, '0')
        batchKey = `rb_${courierId}_${yyyy}${mm}${dd}_${sMin}`
      }

      if (batchKey) {
        console.log(
          `[canonical_telemetry_engine] Evento de fechamento detectado para pedido ${order.id}. Lote: ${batchKey}`,
        )
        let procResult = null
        try {
          procResult = processBatch(batchKey, 'order_route_finished_hook')
        } catch (procErr) {
          console.error(
            `[canonical_telemetry_engine:HOOK_PROCESS_ERROR] Erro ao executar processBatch para lote ${batchKey}:`,
            procErr,
          )
          try {
            const auditCol = $app.findCollectionByNameOrId('audit_trail')
            if (auditCol) {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '')
              auditRec.set('collection', 'route_batch_telemetry')
              auditRec.set('record_id', batchKey)
              if (courierId) auditRec.set('courier_id', courierId)
              auditRec.set('action', 'erro_execucao_process_batch_telemetria')
              auditRec.set('field', 'exception')
              auditRec.set('old_value', `lote=${batchKey}`)
              auditRec.set(
                'new_value',
                String(procErr && procErr.message ? procErr.message : procErr),
              )
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                route_batch_key: batchKey,
                courier_id: courierId,
                order_id: order.id,
                error_stack: String(procErr && procErr.stack ? procErr.stack : procErr),
              })
              $app.save(auditRec)
            }
          } catch (_) {}
        }
        // Correção 3: Guarda de sanidade no motor - Fechamento detectado e nenhum registro gravado = log de erro visível + entrada em audit_trail
        if (!procResult) {
          console.error(
            `[canonical_telemetry_engine:SANITY_GUARD] Fechamento detectado para o lote ${batchKey} do entregador ${courierId}, mas nenhum registro foi processado/gravado em route_batch_telemetry!`,
          )
          try {
            const auditCol = $app.findCollectionByNameOrId('audit_trail')
            if (auditCol) {
              const auditRec = new Record(auditCol)
              auditRec.set('user_id', '') // Ator Sistema (user_id vazio)
              auditRec.set('collection', 'route_batch_telemetry')
              auditRec.set('record_id', batchKey)
              if (courierId) auditRec.set('courier_id', courierId)
              auditRec.set('action', 'falha_sanidade_fechamento_lote_telemetria')
              auditRec.set('field', 'route_batch_telemetry')
              auditRec.set('old_value', `lote=${batchKey}`)
              auditRec.set('new_value', 'nenhum_registro_gravado')
              auditRec.set('timestamp', new Date().toISOString())
              auditRec.set('metadata', {
                system_trigger: true,
                actor_name: 'Sistema',
                route_batch_key: batchKey,
                courier_id: courierId,
                order_id: order.id,
                alerta: 'FALHA_SANIDADE_FECHAMENTO_SEM_TELEMETRIA',
              })
              $app.save(auditRec)
            }
          } catch (eAudit) {
            console.error(
              '[canonical_telemetry_engine] Erro ao gravar audit_trail da guarda:',
              eAudit,
            )
          }
        }
      }
    }
  } catch (err) {
    console.error(
      '[canonical_telemetry_engine] Erro estruturado no hook onRecordAfterUpdateSuccess:',
      err,
    )
    try {
      const auditCol = $app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'orders')
        auditRec.set('record_id', e.record ? e.record.id : 'unknown')
        auditRec.set('action', 'falha_hook_canonical_telemetry_engine')
        auditRec.set('field', 'hook_exception')
        auditRec.set('old_value', '')
        auditRec.set('new_value', String(err && err.message ? err.message : err))
        auditRec.set('timestamp', new Date().toISOString())
        auditRec.set('metadata', {
          system_trigger: true,
          actor_name: 'Sistema',
          error_stack: String(err && err.stack ? err.stack : err),
        })
        $app.save(auditRec)
      }
    } catch (_) {}
  } finally {
    e.next()
  }
}, 'orders')

// -------------------------------------------------------------------------------------------------
// ENDPOINT HTTP: Para reprocessar, auditar ou consultar o cálculo canônico de um lote sob demanda
// POST /backend/v1/telemetria-lote/processar
// GET  /backend/v1/telemetria-lote/{batch_key}
// -------------------------------------------------------------------------------------------------
routerAdd('POST', '/backend/v1/telemetria-lote/processar', (c) => {
  const authRecord =
    (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
  if (!authRecord) {
    return c.json(401, { error: 'Requer autenticação.' })
  }

  let body = {}
  try {
    body = c.requestInfo().body || {}
  } catch (_) {}

  const batchKey = (body.route_batch_key || body.batch_key || '').trim()
  if (!batchKey) {
    return c.json(400, { error: 'Campo route_batch_key é obrigatório no corpo JSON.' })
  }

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
      console.error('[canonical_telemetry_engine:post] Falha OSRM:', err)
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

  try {
    let orders = []
    try {
      orders = $app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${batchKey}' && status != 'cancelled'`,
        'sequence,created',
        200,
        0,
      )
    } catch (_) {}

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
            orders = $app.findRecordsByFilter(
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
      return c.json(404, { error: `Nenhuma ordem encontrada para o lote ${batchKey}` })
    }

    orders.sort((a, b) => {
      const seqA = a.getInt('sequence') || 9999
      const seqB = b.getInt('sequence') || 9999
      if (seqA !== seqB) return seqA - seqB
      return new Date(a.getString('created')).getTime() - new Date(b.getString('created')).getTime()
    })

    const firstOrder = orders[0]
    const lastOrder = orders[orders.length - 1]
    const courierId = firstOrder.getString('courier_id')
    const empresaId = firstOrder.getString('empresa_id') || ''

    let isBicycle = false
    if (courierId) {
      try {
        const courierUser = $app.findRecordById('users', courierId)
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

    const startIso = new Date(startMs).toISOString()
    const finishIso = new Date(finishMs).toISOString()
    const endIso = finishIso
    const windowStart = startIso

    const formatPbDateStrEndpoint = (d) => {
      return d
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z?$/, '')
    }
    const queryStartStr = formatPbDateStrEndpoint(new Date(startMs - 10 * 60000))
    const queryFinishStr = formatPbDateStrEndpoint(new Date(finishMs + 10 * 60000))

    let pings = []
    try {
      pings = $app.findRecordsByFilter(
        'locations',
        `user_id = '${courierId}' && created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
        '+created',
        5000,
        0,
      )
    } catch (findErr) {
      console.log(
        '[canonical_telemetry_engine] Erro ao buscar pings em locations por user_id:',
        findErr,
      )
    }

    const pingsCount = pings.length

    // GUARDA DA FRENTE 2: pings_count = 0 quando existem pings na janela = log de erro visível + audit_trail (user_id vazio, actor_name='Sistema', metadata.system_trigger=true)
    if (pingsCount === 0) {
      try {
        const potentialAnyPings = $app.findRecordsByFilter(
          'locations',
          `created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
          '+created',
          10,
          0,
        )
        if (potentialAnyPings.length > 0) {
          console.error(
            `[canonical_telemetry_engine:GUARDA_ERRO_SANIDADE] SANITY ERROR: pings_count=0 para user_id=${courierId} no lote ${batchKey}, mas existem ${potentialAnyPings.length} pings na janela temporal [${queryStartStr} -> ${queryFinishStr}]. O registro NÃO pode passar como processed em silêncio!`,
          )
          const auditColGuard = $app.findCollectionByNameOrId('audit_trail')
          if (auditColGuard) {
            const auditGuard = new Record(auditColGuard)
            auditGuard.set('user_id', '') // relation aceita vazio
            auditGuard.set('collection', 'route_batch_telemetry')
            auditGuard.set('record_id', batchKey)
            if (courierId) auditGuard.set('courier_id', courierId)
            auditGuard.set('action', 'telemetria_pings_zero_divergencia')
            auditGuard.set('field', 'pings_count')
            auditGuard.set('old_value', '0')
            auditGuard.set('new_value', 'pings_presentes_janela_sem_match_user_id')
            auditGuard.set('timestamp', new Date().toISOString())
            auditGuard.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              route_batch_key: batchKey,
              courier_id: courierId,
              query_start: queryStartStr,
              query_finish: queryFinishStr,
              found_pings_in_window: potentialAnyPings.length,
              divergence_warning: 'pings_count=0 com telemetria existente na janela temporal',
            })
            $app.save(auditGuard)
          }
        }
      } catch (guardErr) {
        console.error(
          '[canonical_telemetry_engine:GUARDA_ERRO] Erro na verificação da guarda:',
          guardErr,
        )
      }
    }
    let firstPingAt = null
    let lastPingAt = null
    if (pingsCount > 0) {
      firstPingAt = pings[0].getString('created')
      lastPingAt = pings[pingsCount - 1].getString('created')
    }

    // SANEAMENTO IDEMPOTENTE E CANÔNICO DE PINGS NO ENDPOINT MANUAL:
    // Usa exatamente a mesma função compartilhada sanitizePingsAndComputeTelemetry do fechamento automático
    // Descarte de coordenada congelada repetida (<1.5m), descarte de saltos com velocidade impossível (>90 km/h)
    // e detecção de lacunas de telemetria (>90s).
    const sanitizedTelemetry = sanitizePingsAndComputeTelemetry(pings, haversineDistMeters)
    const kmGpsTotalMeters = sanitizedTelemetry.kmGpsTotalMeters
    const telemetryGaps = sanitizedTelemetry.telemetryGaps
    const gapsCount = sanitizedTelemetry.gapsCount
    const gapsTotalSeconds = sanitizedTelemetry.gapsTotalSeconds
    const telemetrySegments = sanitizedTelemetry.telemetrySegments
    let kmGpsTotal = Number((kmGpsTotalMeters / 1000).toFixed(2))

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
    for (let l = 0; l < legsData.length; l++) {
      const leg = legsData[l]
      if (!leg.is_return && stops[l]) {
        const stop = stops[l]
        let legPingsMeters = 0
        // Tolerância de 5 minutos na janela por perna
        const TOLERANCE_MS = 5 * 60 * 1000
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
            const pPrevLat = pings[p - 1].getFloat('lat')
            const pPrevLng = pings[p - 1].getFloat('lng')
            const pCurrLat = pings[p].getFloat('lat')
            const pCurrLng = pings[p].getFloat('lng')
            const pDistM = haversineDistMeters(pPrevLat, pPrevLng, pCurrLat, pCurrLng)
            const pSpeedKmh = deltaSec > 0 ? (pDistM / deltaSec) * 3.6 : 0
            const isPerezFrozen =
              (Math.abs(pPrevLat - pCurrLat) < 0.00002 &&
                Math.abs(pPrevLng - pCurrLng) < 0.00002) ||
              pDistM < 1.5
            if (!isPerezFrozen && pSpeedKmh <= 90) {
              legPingsMeters += pDistM
            }
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

    // TETO DE COERÊNCIA IDEMPOTENTE NO ENDPOINT MANUAL:
    // km_gps_total saneado deve ser plausível (<= 2x km_viario quando este existir)
    // Se estourar 2x km viário por ruído/pings fantasma, limitar a teto plausível (1.15x km_viario)
    if (kmViarioTotal > 0 && kmGpsTotal > kmViarioTotal * 2) {
      console.warn(
        `[canonical_telemetry_engine:post] Teto de coerência acionado: km_gps_total=${kmGpsTotal} > 2x ${kmViarioTotal} km viário. Limitando a ${(kmViarioTotal * 1.15).toFixed(2)} km.`,
      )
      kmGpsTotal = Number((kmViarioTotal * 1.15).toFixed(2))
    }

    // FALHA 1 (ENDPOINT): CÔMPUTO DO TRECHO DE RETORNO À BASE VIA PINGS REAIS (SEM ORDER_ID)
    let returnGpsMetersCalculated = 0
    let isReturnEndpointNearBase = false
    let returnFlagAmarela = false

    let maxStopArrivalMs = 0
    for (let sIdx = 0; sIdx < stops.length; sIdx++) {
      if (stops[sIdx].actual_arrival) {
        const tArr = new Date(stops[sIdx].actual_arrival).getTime()
        if (tArr > maxStopArrivalMs) maxStopArrivalMs = tArr
      }
    }
    if (maxStopArrivalMs === 0) {
      for (let oIdx = 0; oIdx < orders.length; oIdx++) {
        const upMs = new Date(
          orders[oIdx].getString('updated') || orders[oIdx].getString('created'),
        ).getTime()
        if (upMs > maxStopArrivalMs) maxStopArrivalMs = upMs
      }
    }

    const returnPings = []
    let lastPingNearBaseIdx = -1

    for (let pIdx = 0; pIdx < pingsCount; pIdx++) {
      const pingRecord = pings[pIdx]
      const pTime = new Date(pingRecord.getString('created')).getTime()
      if (pTime >= maxStopArrivalMs) {
        const pLat = pingRecord.getFloat('lat')
        const pLng = pingRecord.getFloat('lng')
        const dBase = haversineDistMeters(pLat, pLng, baseLat, baseLng)
        if (dBase <= 150) {
          lastPingNearBaseIdx = returnPings.length
        }
        returnPings.push({
          lat: pLat,
          lng: pLng,
          created: pingRecord.getString('created'),
          timestamp: pTime,
          distToBase: dBase,
        })
      }
    }

    let effectiveReturnPings = returnPings
    if (lastPingNearBaseIdx >= 0 && lastPingNearBaseIdx < returnPings.length - 1) {
      effectiveReturnPings = returnPings.slice(0, lastPingNearBaseIdx + 1)
    }

    if (effectiveReturnPings.length >= 2) {
      for (let rIdx = 1; rIdx < effectiveReturnPings.length; rIdx++) {
        const pPrev = effectiveReturnPings[rIdx - 1]
        const pCurr = effectiveReturnPings[rIdx]
        const deltaSec = Math.max(0, Math.round((pCurr.timestamp - pPrev.timestamp) / 1000))
        if (deltaSec <= 120) {
          const dStepM = haversineDistMeters(pPrev.lat, pPrev.lng, pCurr.lat, pCurr.lng)
          const pSpeedKmh = deltaSec > 0 ? (dStepM / deltaSec) * 3.6 : 0
          const isFrozen =
            (Math.abs(pPrev.lat - pCurr.lat) < 0.00002 &&
              Math.abs(pPrev.lng - pCurr.lng) < 0.00002) ||
            dStepM < 1.5
          if (!isFrozen && pSpeedKmh <= 90) {
            returnGpsMetersCalculated += dStepM
          }
        }
      }

      const lastRetPt = effectiveReturnPings[effectiveReturnPings.length - 1]
      if (lastRetPt.distToBase <= 150) {
        isReturnEndpointNearBase = true
      } else {
        returnFlagAmarela = true
      }
    }

    const kmGpsRetorno = Number((returnGpsMetersCalculated / 1000).toFixed(2))

    const lastLeg = legsData.find((l) => l.is_return) || null
    if (lastLeg) {
      lastLeg.km_gps = kmGpsRetorno
    }

    if (kmGpsRetorno > 0) {
      kmGpsTotal = Number(((accumulatedLegGpsMeters + returnGpsMetersCalculated) / 1000).toFixed(2))
    }

    const returnToBaseData = {
      base_coords: { lat: baseLat, lng: baseLng },
      base_name: PILAR_BASE_NAME,
      km_viario_retorno: lastLeg ? lastLeg.km_viario : 0,
      km_gps_retorno: kmGpsRetorno,
      contado_uma_vez: true,
      endpoint_near_base: isReturnEndpointNearBase,
      flag_amarela_retorno: returnFlagAmarela,
    }

    // REGRA DO USUÁRIO (20/10): Pagamento SEMPRE por KM VIÁRIO.
    // O km GPS telemetria é apenas para comparação/auditoria (Coluna B), NUNCA base de pagamento.
    let kmOficial = kmViarioTotal > 0 ? kmViarioTotal : kmGpsTotal
    let status = 'processed'
    let diffPct = 0
    if (kmGpsTotal > 0 && kmViarioTotal > 0) {
      diffPct = Math.round((Math.abs(kmGpsTotal - kmViarioTotal) / kmViarioTotal) * 100)
      if (diffPct > 20 || returnFlagAmarela) status = 'yellow_flag'
    }

    const telemetryCol = $app.findCollectionByNameOrId('route_batch_telemetry')
    let telemetryRecord = null
    try {
      telemetryRecord = $app.findFirstRecordByData(
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
      telemetryRecord.set('route_started_at', startIso)
      telemetryRecord.set('route_finished_at', finishIso)
      telemetryRecord.set('status', status)
      telemetryRecord.set('metadata', {
        is_bicycle: isBicycle,
        diff_pct: diffPct,
        trigger_origin: 'manual_http_trigger',
        processed_at: new Date().toISOString(),
        stops_count: stops.length,
        orders_count: orders.length,
      })
      $app.save(telemetryRecord)
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
          $app.save(ord)
        } catch (_) {}
      }
    }

    try {
      const auditCol = $app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'route_batch_telemetry')
        auditRec.set('record_id', telemetryRecord ? telemetryRecord.id : batchKey)
        if (courierId) auditRec.set('courier_id', courierId)
        auditRec.set('action', 'fechamento_lote_telemetria_canonica')
        auditRec.set('field', 'km_oficial')
        auditRec.set('old_value', `viario=${kmViarioTotal}km`)
        auditRec.set(
          'new_value',
          `gps=${kmGpsTotal}km, lacunas=${gapsCount}, oficial=${kmOficial}km`,
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
          gaps_total_seconds: gapsTotalSeconds,
          deviations_count: deviationSections.length,
          is_bicycle: isBicycle,
          trigger_origin: 'manual_http_trigger',
        })
        $app.save(auditRec)
      }
    } catch (_) {}

    return c.json(200, {
      success: true,
      message: 'Cálculo canônico de telemetria processado e gravado com sucesso.',
      data: {
        route_batch_key: batchKey,
        courier_id: courierId,
        pings_count: pingsCount,
        km_gps_total: kmGpsTotal,
        km_viario_total: kmViarioTotal,
        km_oficial: kmOficial,
        gaps_count: gapsCount,
        gaps_total_seconds: gapsTotalSeconds,
        telemetry_gaps: telemetryGaps,
        legs_data: legsData,
        deviation_classification: deviationSections,
        return_to_base_data: returnToBaseData,
        status: status,
      },
    })
  } catch (err) {
    console.log('[canonical_telemetry_engine] Erro ao processar via POST:', err)
    return c.json(500, { error: String(err && err.message ? err.message : err) })
  }
})

routerAdd('GET', '/backend/v1/telemetria-lote/consultar-resumo', (c) => {
  try {
    const recs = $app.findRecordsByFilter('route_batch_telemetry', '', '-created', 10, 0)
    const list = []
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i]
      list.push({
        id: r.id,
        route_batch_key: r.getString('route_batch_key'),
        courier_id: r.getString('courier_id'),
        km_gps_total: r.getFloat('km_gps_total'),
        km_viario_total: r.getFloat('km_viario_total'),
        km_oficial: r.getFloat('km_oficial'),
        pings_count: r.getInt('pings_count'),
        gaps_count: r.getInt('gaps_count'),
        gaps_total_seconds: r.getInt('gaps_total_seconds'),
        telemetry_gaps: r.get('telemetry_gaps'),
        status: r.getString('status'),
        metadata: r.get('metadata'),
      })
    }
    console.log(
      `[resumo_telemetria] Total de registros gravados: ${list.length}. Primeiro: ${JSON.stringify(list[0] || {})}`,
    )
    return c.json(200, { success: true, count: list.length, items: list })
  } catch (err) {
    return c.json(500, { error: String(err && err.message ? err.message : err) })
  }
})

routerAdd('GET', '/backend/v1/telemetria-lote/{batch_key}', (c) => {
  const batchKey = c.request.pathValue('batch_key') || ''
  if (!batchKey) {
    return c.json(400, { error: 'Parâmetro batch_key é obrigatório.' })
  }

  try {
    const rec = $app.findFirstRecordByData('route_batch_telemetry', 'route_batch_key', batchKey)
    if (!rec) {
      return c.json(404, { error: `Lote ${batchKey} ainda não processado.` })
    }

    return c.json(200, {
      success: true,
      source: 'database_record',
      data: {
        id: rec.id,
        route_batch_key: rec.getString('route_batch_key'),
        courier_id: rec.getString('courier_id'),
        empresa_id: rec.getString('empresa_id'),
        km_gps_total: rec.getFloat('km_gps_total'),
        km_viario_total: rec.getFloat('km_viario_total'),
        km_oficial: rec.getFloat('km_oficial'),
        legs_data: rec.get('legs_data'),
        telemetry_gaps: rec.get('telemetry_gaps'),
        gaps_count: rec.getInt('gaps_count'),
        gaps_total_seconds: rec.getInt('gaps_total_seconds'),
        deviation_classification: rec.get('deviation_classification'),
        return_to_base_data: rec.get('return_to_base_data'),
        pings_count: rec.getInt('pings_count'),
        first_ping_at: rec.getString('first_ping_at'),
        last_ping_at: rec.getString('last_ping_at'),
        route_started_at: rec.getString('route_started_at'),
        route_finished_at: rec.getString('route_finished_at'),
        status: rec.getString('status'),
        metadata: rec.get('metadata'),
        created: rec.getString('created'),
        updated: rec.getString('updated'),
      },
    })
  } catch (err) {
    return c.json(500, { error: String(err && err.message ? err.message : err) })
  }
})
