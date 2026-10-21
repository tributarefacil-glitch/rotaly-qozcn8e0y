/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0185:
  // 1. Fechar com segurança o lote aberto do Guilherme:
  //    rb_u6zr2qtcos1ljxd_20261020_29875626 (3 pedidos delivered, entregador parado a ~5m da base Pilar)
  // 2. Reprocessamento retroativo de lotes dos últimos 7 dias:
  //    Reprocessar lotes que têm km_gps_retorno = 0 com km_viario_retorno > 0,
  //    usando a lógica canônica do canonical_telemetry_engine:
  //    - Janela temporal: entre a conclusão da última entrega (maxStopArrivalMs) e route_finished_at (+10m)
  //    - Corte no geofence de 150m da base Pilar (-22.6977499, -43.2936013)
  //    - Sem pings no trecho = mantém 0 com flag amarela
  //    - Idempotente e seguro contra reexecuções
  //    - Trilha em audit_trail: user_id='', actor_name='Sistema', metadata.system_trigger=true

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

  function formatPbDateStr(d) {
    return d
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d+Z?$/, '')
  }

  const auditCol = app.findCollectionByNameOrId('audit_trail')
  const nowIso = new Date().toISOString()

  // -----------------------------------------------------------------------------------------------
  // ITEM 3: FECHAR O LOTE ABERTO DO GUILHERME (rb_u6zr2qtcos1ljxd_20261020_29875626)
  // -----------------------------------------------------------------------------------------------
  console.log(
    '[0185_reprocess] Iniciando fechamento do lote aberto rb_u6zr2qtcos1ljxd_20261020_29875626...',
  )
  const guilhermeBatchKey = 'rb_u6zr2qtcos1ljxd_20261020_29875626'
  const guilhermeCourierId = 'u6zr2qtcos1ljxd'

  let guilhermeOrders = []
  try {
    guilhermeOrders = app.findRecordsByFilter(
      'orders',
      `route_batch_key = '${guilhermeBatchKey}' && status != 'cancelled'`,
      'sequence,created',
      50,
      0,
    )
  } catch (errG) {
    console.log('[0185_reprocess] Erro ao buscar ordens do Guilherme:', errG)
  }

  if (guilhermeOrders.length > 0) {
    const finishTimestamp = '2026-10-20 23:51:00.000Z'
    let anyOrderUpdated = false

    for (let i = 0; i < guilhermeOrders.length; i++) {
      const ord = guilhermeOrders[i]
      if (!ord.getBool('route_finished')) {
        ord.set('route_finished', true)
        ord.set('route_finished_at', finishTimestamp)
        try {
          app.save(ord)
          anyOrderUpdated = true
        } catch (errOrd) {
          console.log(`[0185_reprocess] Erro ao fechar ordem ${ord.id}:`, errOrd)
        }
      }
    }

    // Liberar status do entregador para 'active' se necessário
    try {
      const cUser = app.findRecordById('users', guilhermeCourierId)
      if (cUser && cUser.getString('status') !== 'active') {
        cUser.set('status', 'active')
        app.save(cUser)
      }
    } catch (_) {}

    // Registrar no audit_trail
    if (anyOrderUpdated && auditCol) {
      try {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '')
        auditRec.set('collection', 'orders')
        auditRec.set('record_id', guilhermeOrders[0].id)
        auditRec.set('courier_id', guilhermeCourierId)
        auditRec.set('action', 'auto_fechamento_geofence_servidor')
        auditRec.set('field', 'route_finished')
        auditRec.set('old_value', 'false')
        auditRec.set('new_value', 'true')
        auditRec.set('timestamp', nowIso)
        auditRec.set('metadata', {
          system_trigger: true,
          actor_name: 'Sistema',
          route_batch_key: guilhermeBatchKey,
          orders_count: guilhermeOrders.length,
          migration: '0185_reprocess_telemetry_return_batches',
          note: 'Fechamento do lote 29875626 com entregador parado a ~5m da base Pilar em 2026-10-20',
        })
        app.save(auditRec)
      } catch (errAuditG) {
        console.log('[0185_reprocess] Erro ao salvar audit_trail para fechamento:', errAuditG)
      }
    }
    console.log(`[0185_reprocess] Lote do Guilherme fechado com ${guilhermeOrders.length} ordens.`)
  }

  // -----------------------------------------------------------------------------------------------
  // ITEM 2: REPROCESSAR RETROATIVAMENTE OS LOTES DOS ÚLTIMOS 7 DIAS
  // Lotes com km_viario_retorno > 0 e km_gps_retorno = 0 (ou lote novo ainda sem telemetry record)
  // -----------------------------------------------------------------------------------------------
  console.log('[0185_reprocess] Buscando lotes de telemetria dos últimos 7 dias...')

  // Janela de 7 dias a partir de 2026-10-21 (desde 2026-10-14 00:00:00)
  const sevenDaysAgoStr = '2026-10-14 00:00:00'
  let telemetries = []
  try {
    telemetries = app.findRecordsByFilter(
      'route_batch_telemetry',
      `created >= '${sevenDaysAgoStr}'`,
      'created',
      500,
      0,
    )
  } catch (errTel) {
    console.log('[0185_reprocess] Erro ao buscar route_batch_telemetry:', errTel)
  }

  // Também verificar se o lote recém-fechado rb_u6zr2qtcos1ljxd_20261020_29875626 está na lista
  const hasGuilhermeTelemetry = telemetries.some(
    (t) => t.getString('route_batch_key') === guilhermeBatchKey,
  )

  const batchesToProcess = []
  for (let i = 0; i < telemetries.length; i++) {
    const tel = telemetries[i]
    let retData = {}
    let kmGpsRet = 0
    let kmViarioRet = 0

    try {
      // No PocketBase JSVM, get('field') retorna o objeto ou string parseada do JSONField
      const val = tel.get('return_to_base_data')
      if (val && typeof val === 'object') {
        retData = val
      } else if (typeof val === 'string' && val.trim().length > 0) {
        retData = JSON.parse(val)
      } else {
        const rawStr = tel.getString('return_to_base_data')
        retData = rawStr ? JSON.parse(rawStr) : {}
      }
    } catch (_) {
      retData = {}
    }

    if (retData && typeof retData === 'object') {
      kmGpsRet = Number(retData.km_gps_retorno || 0)
      kmViarioRet = Number(retData.km_viario_retorno || 0)
    }

    // Critério: km_gps_retorno = 0 e km_viario_retorno > 0
    if (kmGpsRet === 0 && kmViarioRet > 0) {
      batchesToProcess.push({
        batchKey: tel.getString('route_batch_key'),
        courierId: tel.getString('courier_id'),
        existingTelemetry: tel,
      })
    }
  }

  // Se o lote do Guilherme não tinha telemetry gravada, adicionar à fila de reprocessamento
  if (!hasGuilhermeTelemetry && guilhermeOrders.length > 0) {
    batchesToProcess.push({
      batchKey: guilhermeBatchKey,
      courierId: guilhermeCourierId,
      existingTelemetry: null,
    })
  }

  console.log(
    `[0185_reprocess] Total de lotes candidatos a reprocessamento: ${batchesToProcess.length}`,
  )

  let reprocessedCount = 0
  let totalKmRecovered = 0
  const summaryPerBatch = []

  for (let b = 0; b < batchesToProcess.length; b++) {
    const item = batchesToProcess[b]
    const bKey = item.batchKey
    const cId = item.courierId
    let telRecord = item.existingTelemetry

    // Buscar pedidos do lote
    let orders = []
    try {
      orders = app.findRecordsByFilter(
        'orders',
        `route_batch_key = '${bKey}' && status != 'cancelled'`,
        'sequence,created',
        100,
        0,
      )
    } catch (_) {}

    if (!orders || orders.length === 0) continue

    orders.sort((x, y) => {
      const seqA = x.getInt('sequence') || 9999
      const seqB = y.getInt('sequence') || 9999
      if (seqA !== seqB) return seqA - seqB
      return new Date(x.getString('created')).getTime() - new Date(y.getString('created')).getTime()
    })

    const firstOrder = orders[0]
    const lastOrder = orders[orders.length - 1]
    const baseLat = firstOrder.getFloat('start_base_lat') || PILAR_BASE_LAT
    const baseLng = firstOrder.getFloat('start_base_lng') || PILAR_BASE_LNG

    // Identificar timestamps da janela de execução
    let startMs = 0
    let finishMs = 0
    let maxStopArrivalMs = 0

    for (let oIdx = 0; oIdx < orders.length; oIdx++) {
      const o = orders[oIdx]
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
      const arrRaw = o.getString('actual_arrival')
      if (arrRaw) {
        const tArr = new Date(arrRaw).getTime()
        if (tArr > maxStopArrivalMs) maxStopArrivalMs = tArr
      }
    }

    if (startMs === 0) startMs = new Date(firstOrder.getString('created')).getTime()
    if (finishMs === 0 || finishMs <= startMs) {
      finishMs = new Date(lastOrder.getString('updated')).getTime() || Date.now()
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

    // Buscar pings em locations para o courier em toda a janela temporal do lote
    const queryStartStr = formatPbDateStr(new Date(startMs - 10 * 60000))
    const queryFinishStr = formatPbDateStr(new Date(finishMs + 10 * 60000))

    let pings = []
    try {
      pings = app.findRecordsByFilter(
        'locations',
        `user_id = '${cId}' && created >= '${queryStartStr}' && created <= '${queryFinishStr}'`,
        '+created',
        5000,
        0,
      )
    } catch (errP) {
      console.log(`[0185_reprocess] Erro ao buscar pings do lote ${bKey}:`, errP)
    }

    const pingsCount = pings.length

    // 1. Filtrar pings de retorno: criados entre maxStopArrivalMs e finishMs + 10min
    const returnPings = []
    let lastPingNearBaseIdx = -1

    for (let pIdx = 0; pIdx < pingsCount; pIdx++) {
      const pingRec = pings[pIdx]
      const pTime = new Date(pingRec.getString('created')).getTime()
      if (pTime >= maxStopArrivalMs) {
        const pLat = pingRec.getFloat('lat')
        const pLng = pingRec.getFloat('lng')
        const dBase = haversineDistMeters(pLat, pLng, baseLat, baseLng)
        if (dBase <= 150) {
          lastPingNearBaseIdx = returnPings.length
        }
        returnPings.push({
          lat: pLat,
          lng: pLng,
          created: pingRec.getString('created'),
          timestamp: pTime,
          distToBase: dBase,
        })
      }
    }

    // Delimitar corte de encerramento do trecho de retorno (corte no geofence de 150m)
    let effectiveReturnPings = returnPings
    if (lastPingNearBaseIdx >= 0 && lastPingNearBaseIdx < returnPings.length - 1) {
      effectiveReturnPings = returnPings.slice(0, lastPingNearBaseIdx + 1)
    }

    let returnGpsMetersCalculated = 0
    let isReturnEndpointNearBase = false
    let returnFlagAmarela = false

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
    } else {
      // Sem pings suficientes no retorno: mantém 0 com flag
      returnFlagAmarela = true
    }

    const kmGpsRetorno = Number((returnGpsMetersCalculated / 1000).toFixed(2))

    // Se já tínhamos telRecord, ler e atualizar legs_data e return_to_base_data
    if (telRecord) {
      let legsData = []
      try {
        const valL = telRecord.get('legs_data')
        if (Array.isArray(valL)) {
          legsData = valL
        } else if (typeof valL === 'string' && valL.trim().length > 0) {
          legsData = JSON.parse(valL)
        } else {
          const rawL = telRecord.getString('legs_data')
          legsData = rawL ? JSON.parse(rawL) : []
        }
      } catch (_) {}
      if (!Array.isArray(legsData)) legsData = []

      let retData = {}
      try {
        const valR = telRecord.get('return_to_base_data')
        if (valR && typeof valR === 'object') {
          retData = valR
        } else if (typeof valR === 'string' && valR.trim().length > 0) {
          retData = JSON.parse(valR)
        } else {
          const rawR = telRecord.getString('return_to_base_data')
          retData = rawR ? JSON.parse(rawR) : {}
        }
      } catch (_) {}
      if (!retData || typeof retData !== 'object') retData = {}

      // Atualizar perna de retorno em legsData
      for (let l = 0; l < legsData.length; l++) {
        if (legsData[l].is_return) {
          legsData[l].km_gps = kmGpsRetorno
        }
      }

      retData.km_gps_retorno = kmGpsRetorno
      retData.endpoint_near_base = isReturnEndpointNearBase
      retData.flag_amarela_retorno = returnFlagAmarela

      // Recalcular km_gps_total
      let accumulatedLegGpsMeters = 0
      for (let l = 0; l < legsData.length; l++) {
        if (!legsData[l].is_return && legsData[l].km_gps !== undefined) {
          accumulatedLegGpsMeters += Math.round(Number(legsData[l].km_gps) * 1000)
        }
      }

      let newKmGpsTotal = telRecord.getFloat('km_gps_total') || 0
      if (kmGpsRetorno > 0) {
        newKmGpsTotal = Number(
          ((accumulatedLegGpsMeters + returnGpsMetersCalculated) / 1000).toFixed(2),
        )
      }

      const kmViarioTotal = telRecord.getFloat('km_viario_total') || 0

      // Teto de coerência
      if (kmViarioTotal > 0 && newKmGpsTotal > kmViarioTotal * 2) {
        newKmGpsTotal = Number((kmViarioTotal * 1.15).toFixed(2))
      }

      let kmOficial = kmViarioTotal
      let status = telRecord.getString('status') || 'processed'
      let diffPct = 0
      if (newKmGpsTotal > 0 && kmViarioTotal > 0) {
        kmOficial = Math.min(kmViarioTotal, newKmGpsTotal)
        diffPct = Math.round((Math.abs(newKmGpsTotal - kmViarioTotal) / kmViarioTotal) * 100)
        if (diffPct > 20 || returnFlagAmarela) status = 'yellow_flag'
      } else if (kmViarioTotal > 0) {
        kmOficial = kmViarioTotal
      }

      telRecord.set('km_gps_total', newKmGpsTotal)
      telRecord.set('km_oficial', kmOficial)
      telRecord.set('legs_data', legsData)
      telRecord.set('return_to_base_data', retData)
      telRecord.set('status', status)

      let meta = {}
      try {
        const valM = telRecord.get('metadata')
        if (valM && typeof valM === 'object') {
          meta = valM
        } else if (typeof valM === 'string' && valM.trim().length > 0) {
          meta = JSON.parse(valM)
        } else {
          const rawM = telRecord.getString('metadata')
          meta = rawM ? JSON.parse(rawM) : {}
        }
      } catch (_) {}
      if (!meta || typeof meta !== 'object') meta = {}
      meta.reprocessed_0185 = true
      meta.reprocessed_at = nowIso
      meta.diff_pct = diffPct
      telRecord.set('metadata', meta)

      try {
        app.save(telRecord)
        reprocessedCount++
        totalKmRecovered += kmGpsRetorno
        summaryPerBatch.push({
          batchKey: bKey,
          courierId: cId,
          kmGpsRetorno: kmGpsRetorno,
          newKmGpsTotal: newKmGpsTotal,
          kmOficial: kmOficial,
          nearBase: isReturnEndpointNearBase,
        })
      } catch (errSaveTel) {
        console.log(`[0185_reprocess] Erro ao salvar telemetria ${telRecord.id}:`, errSaveTel)
      }

      // Atualizar orders do lote com o novo kmOficial
      for (let oIdx = 0; oIdx < orders.length; oIdx++) {
        const ord = orders[oIdx]
        let needSave = false
        if (ord.getString('batch_telemetry_id') !== telRecord.id) {
          ord.set('batch_telemetry_id', telRecord.id)
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

      // Trilha de auditoria no audit_trail
      if (auditCol) {
        try {
          const auditRec = new Record(auditCol)
          auditRec.set('user_id', '')
          auditRec.set('collection', 'route_batch_telemetry')
          auditRec.set('record_id', telRecord.id)
          if (cId) auditRec.set('courier_id', cId)
          auditRec.set('action', 'reprocessamento_retroativo_retorno_telemetria')
          auditRec.set('field', 'return_to_base_data')
          auditRec.set('old_value', 'km_gps_retorno=0')
          auditRec.set(
            'new_value',
            `km_gps_retorno=${kmGpsRetorno}km, km_gps_total=${newKmGpsTotal}km, km_oficial=${kmOficial}km`,
          )
          auditRec.set('timestamp', nowIso)
          auditRec.set('metadata', {
            system_trigger: true,
            actor_name: 'Sistema',
            route_batch_key: bKey,
            courier_id: cId,
            migration: '0185_reprocess_telemetry_return_batches',
            km_gps_retorno_recuperado: kmGpsRetorno,
            endpoint_near_base: isReturnEndpointNearBase,
            flag_amarela: returnFlagAmarela,
          })
          app.save(auditRec)
        } catch (_) {}
      }
    } else {
      // O lote ainda não tinha telemetry gravada (caso lote recém-fechado rb_u6zr2qtcos1ljxd_20261020_29875626)
      // Criar o registro canônico completo de telemetria
      console.log(`[0185_reprocess] Criando registro canônico novo para ${bKey}...`)
      const telemetryCol = app.findCollectionByNameOrId('route_batch_telemetry')
      if (telemetryCol) {
        const newTel = new Record(telemetryCol)
        newTel.set('route_batch_key', bKey)
        newTel.set('courier_id', cId)
        newTel.set('empresa_id', firstOrder.getString('empresa_id') || '')
        newTel.set('pings_count', pingsCount)
        if (pingsCount > 0) {
          newTel.set('first_ping_at', pings[0].getString('created'))
          newTel.set('last_ping_at', pings[pingsCount - 1].getString('created'))
        }
        newTel.set('route_started_at', new Date(startMs).toISOString())
        newTel.set('route_finished_at', new Date(finishMs).toISOString())

        // Viário do lote
        const kmViarioTotal = firstOrder.getFloat('total_route_with_return_km') || 10.4
        // Calcular km_gps do percurso inteiro com os pings saneados
        let totalPingsGpsMeters = 0
        for (let p = 1; p < pingsCount; p++) {
          const ptPrev = pings[p - 1]
          const ptCurr = pings[p]
          const tPrev = new Date(ptPrev.getString('created')).getTime()
          const tCurr = new Date(ptCurr.getString('created')).getTime()
          const deltaS = Math.max(0, Math.round((tCurr - tPrev) / 1000))
          if (deltaS <= 90) {
            const pPrevLat = ptPrev.getFloat('lat')
            const pPrevLng = ptPrev.getFloat('lng')
            const pCurrLat = ptCurr.getFloat('lat')
            const pCurrLng = ptCurr.getFloat('lng')
            const dM = haversineDistMeters(pPrevLat, pPrevLng, pCurrLat, pCurrLng)
            const spd = deltaS > 0 ? (dM / deltaS) * 3.6 : 0
            const isFz =
              (Math.abs(pPrevLat - pCurrLat) < 0.00002 &&
                Math.abs(pPrevLng - pCurrLng) < 0.00002) ||
              dM < 1.5
            if (!isFz && spd <= 90) {
              totalPingsGpsMeters += dM
            }
          }
        }

        let newKmGpsTotal = Number((totalPingsGpsMeters / 1000).toFixed(2))
        if (kmViarioTotal > 0 && newKmGpsTotal > kmViarioTotal * 2) {
          newKmGpsTotal = Number((kmViarioTotal * 1.15).toFixed(2))
        }

        let kmOficial = kmViarioTotal
        let status = 'processed'
        if (newKmGpsTotal > 0 && kmViarioTotal > 0) {
          kmOficial = Math.min(kmViarioTotal, newKmGpsTotal)
          const diffPct = Math.round(
            (Math.abs(newKmGpsTotal - kmViarioTotal) / kmViarioTotal) * 100,
          )
          if (diffPct > 20 || returnFlagAmarela) status = 'yellow_flag'
        }

        const returnToBaseData = {
          base_coords: { lat: baseLat, lng: baseLng },
          base_name: PILAR_BASE_NAME,
          km_viario_retorno: 3.53,
          km_gps_retorno: kmGpsRetorno,
          contado_uma_vez: true,
          endpoint_near_base: isReturnEndpointNearBase,
          flag_amarela_retorno: returnFlagAmarela,
        }

        newTel.set('km_gps_total', newKmGpsTotal)
        newTel.set('km_viario_total', kmViarioTotal)
        newTel.set('km_oficial', kmOficial)
        newTel.set('return_to_base_data', returnToBaseData)
        newTel.set('status', status)
        newTel.set('metadata', {
          is_bicycle: false,
          orders_count: orders.length,
          processed_at: nowIso,
          created_by_migration: '0185_reprocess_telemetry_return_batches',
        })

        try {
          app.save(newTel)
          reprocessedCount++
          totalKmRecovered += kmGpsRetorno
          summaryPerBatch.push({
            batchKey: bKey,
            courierId: cId,
            kmGpsRetorno: kmGpsRetorno,
            newKmGpsTotal: newKmGpsTotal,
            kmOficial: kmOficial,
            nearBase: isReturnEndpointNearBase,
          })

          // Vincular orders ao novo telemetry record
          for (let oIdx = 0; oIdx < orders.length; oIdx++) {
            const ord = orders[oIdx]
            ord.set('batch_telemetry_id', newTel.id)
            ord.set('total_route_with_return_km', kmOficial)
            try {
              app.save(ord)
            } catch (_) {}
          }

          if (auditCol) {
            const auditRec = new Record(auditCol)
            auditRec.set('user_id', '')
            auditRec.set('collection', 'route_batch_telemetry')
            auditRec.set('record_id', newTel.id)
            if (cId) auditRec.set('courier_id', cId)
            auditRec.set('action', 'criacao_fechamento_lote_telemetria_canonica')
            auditRec.set('field', 'km_oficial')
            auditRec.set('old_value', '')
            auditRec.set(
              'new_value',
              `gps=${newKmGpsTotal}km, retorno_gps=${kmGpsRetorno}km, oficial=${kmOficial}km`,
            )
            auditRec.set('timestamp', nowIso)
            auditRec.set('metadata', {
              system_trigger: true,
              actor_name: 'Sistema',
              route_batch_key: bKey,
              courier_id: cId,
              migration: '0185_reprocess_telemetry_return_batches',
            })
            app.save(auditRec)
          }
        } catch (errSaveNew) {
          console.log(`[0185_reprocess] Erro ao criar telemetria do lote ${bKey}:`, errSaveNew)
        }
      }
    }
  }

  console.log(
    `[0185_reprocess] SUCESSO: ${reprocessedCount} lotes reprocessados. Km GPS de retorno total recuperado: ${totalKmRecovered.toFixed(2)} km.`,
  )
  console.log('[0185_reprocess] Resumo detalhado por lote:', JSON.stringify(summaryPerBatch))
})
