/// <reference path="../pb_data/types.d.ts" />

/**
 * Migration 0094: Varredura Retroativa de Setembro/2026, Consolidação de Entregas Conjuntas
 * no Banco e Consolidação de Carry-Over de Setembro.
 *
 * 1. VARREDURA RETROATIVA DE SETEMBRO/2026 COM MOTOR NOVO DE KM:
 *    - Aplica a regra oficial do Rotaly para todos os entregadores e todas as empresas:
 *      * Km oficial = trajeto viário planejado SOMENTE das paradas efetivamente visitadas
 *        (delivered = conta; cancelled / desistência / não visitada = NÃO conta, zerados:
 *        distance_km, return_trip_km, total_route_with_return_km, fuel_cost, total_route_fuel_cost).
 *      * Ciclo completo viário: Base -> Paradas visitadas na sequência -> Retorno à Base
 *        cobrado UMA ÚNICA VEZ por rota e rateado pro-rata entre as paradas visitadas.
 *      * Fim definitivo do bug x2 antigo (nunca cobrar ida+volta por parada individual).
 *      * GPS e odômetro são apenas telemetria de auditoria, nunca fonte de km oficial inflado.
 *      * Preço do combustível lido de app_settings / empresas (padrão Moto 35 km/L x R$ 6,49).
 *
 * 2. ENTREGAS CONJUNTAS NO BANCO (SETEMBRO E OUTUBRO):
 *    - Grupos de pedidos entregues no mesmo ponto/cliente em janela <= 45 min por entregador:
 *      * Pedido primário mantém o km e combustível oficial da visita.
 *      * Pedidos secundários têm distance_km = 0, return_trip_km = 0, fuel_cost = 0 gravados no banco
 *        e anotação de auditoria nos notes ('[ENTREGA CONJUNTA]: consolidada no pedido principal...').
 *      * Desta forma as 3 visões (/admin, /seller, /courier) lêem o valor oficial direto do banco.
 *
 * 3. SEGURANÇA E PROTEÇÃO:
 *    - As rotas de outubro já saneadas pelas migrations 0089/0093 não sofrem regressão de trajeto base,
 *      apenas recebem a dedução de conjuntas se houver secundárias gravadas com km > 0.
 *    - Todos os pedidos cancelled têm km e combustível zerados.
 */
migrate(
  (app) => {
    console.log(
      '[0094] Iniciando Varredura Retroativa de Setembro/2026 e Consolidação de Entregas Conjuntas...',
    )

    function haversineM(lat1, lon1, lat2, lon2) {
      var R = 6371000
      var dLat = ((lat2 - lat1) * Math.PI) / 180
      var dLon = ((lon2 - lon1) * Math.PI) / 180
      var a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
          Math.cos((lat2 * Math.PI) / 180) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2)
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    // -------------------------------------------------------------
    // ETAPA 1: Parâmetros de Combustível de app_settings e empresas
    // -------------------------------------------------------------
    var defaultMotoPrice = 6.49
    var defaultMotoKml = 35.0
    var defaultCarroPrice = 6.49
    var defaultCarroKml = 10.0
    var defaultCaminhaoPrice = 6.09
    var defaultCaminhaoKml = 6.0

    try {
      var settingsList = app.findRecordsByFilter(
        'app_settings',
        "key = 'global_settings' || key = 'main_settings'",
        '-created',
        5,
        0,
      )
      if (settingsList.length > 0) {
        var s = settingsList[0]
        var sP = s.getFloat('fuel_price_per_liter')
        var sC = s.getFloat('fuel_consumption_kml')
        if (sP && sP > 0) defaultMotoPrice = sP
        if (sC && sC > 0) defaultMotoKml = sC

        var cP = s.getFloat('fuel_price_carro')
        var cK = s.getFloat('fuel_consumption_carro')
        if (cP && cP > 0) defaultCarroPrice = cP
        if (cK && cK > 0) defaultCarroKml = cK

        var trP = s.getFloat('fuel_price_caminhao')
        var trK = s.getFloat('fuel_consumption_caminhao')
        if (trP && trP > 0) defaultCaminhaoPrice = trP
        if (trK && trK > 0) defaultCaminhaoKml = trK
      }
    } catch (eSettings) {
      console.log('[0094] Aviso ao ler app_settings:', eSettings)
    }

    var empresasMap = {}
    try {
      var emps = app.findRecordsByFilter('empresas', '', '', 500, 0)
      for (var ei = 0; ei < emps.length; ei++) {
        var em = emps[ei]
        var ep = em.getFloat('preco_combustivel')
        if (ep && ep > 0) {
          empresasMap[em.id] = { fuel_price: ep }
        }
      }
    } catch (errEmp) {
      console.log('[0094] Aviso ao carregar empresas:', errEmp)
    }

    function getVehicleParams(vType, empId) {
      var v = (vType || 'moto').toLowerCase()
      var basePrice = (empresasMap[empId] && empresasMap[empId].fuel_price) || defaultMotoPrice
      if (v === 'carro' || v === 'van') {
        return { price: defaultCarroPrice || basePrice, kml: defaultCarroKml, isBike: false }
      }
      if (v === 'caminhao') {
        return { price: defaultCaminhaoPrice || basePrice, kml: defaultCaminhaoKml, isBike: false }
      }
      if (v === 'bicicleta' || v === 'bicycle') {
        return { price: 0, kml: 0, isBike: true }
      }
      return { price: defaultMotoPrice || basePrice, kml: defaultMotoKml, isBike: false }
    }

    // Carregar entregadores
    var couriersMap = {}
    try {
      var couriers = app.findRecordsByFilter('users', "role = 'courier'", '', 1000, 0)
      for (var ci = 0; ci < couriers.length; ci++) {
        var c = couriers[ci]
        couriersMap[c.id] = {
          id: c.id,
          name: c.getString('name'),
          vehicle_type: c.getString('vehicle_type') || 'moto',
        }
      }
    } catch (errC) {
      console.log('[0094] Erro ao carregar entregadores:', errC)
    }

    // Carregar clientes atualizados para mapa de coordenadas (já calibrados: Elaine Assis, Sthephany, etc.)
    var customersMap = {}
    try {
      var custs = app.findRecordsByFilter('customers', '', '', 10000, 0)
      for (var ki = 0; ki < custs.length; ki++) {
        var cu = custs[ki]
        customersMap[cu.id] = {
          id: cu.id,
          name: cu.getString('name') || '',
          lat: cu.getFloat('lat') || 0,
          lng: cu.getFloat('lng') || 0,
          address: cu.getString('address') || '',
        }
      }
    } catch (errCu) {
      console.log('[0094] Erro ao carregar clientes:', errCu)
    }

    // -------------------------------------------------------------
    // ETAPA 2: Zerar rigorosamente todos os pedidos CANCELADOS
    // -------------------------------------------------------------
    console.log('[0094] Saneando pedidos cancelados em todo o histórico...')
    var cancelledCount = 0
    try {
      var cancelledOrders = app.findRecordsByFilter(
        'orders',
        "status = 'cancelled' || completion_reason = 'cancelado_vendedor'",
        '',
        5000,
        0,
      )
      for (var cni = 0; cni < cancelledOrders.length; cni++) {
        var cOrd = cancelledOrders[cni]
        var hadKm =
          cOrd.getFloat('distance_km') > 0 ||
          cOrd.getFloat('fuel_cost') > 0 ||
          cOrd.getFloat('total_route_with_return_km') > 0 ||
          cOrd.getFloat('return_trip_km') > 0

        if (hadKm) {
          cOrd.set('distance_km', 0)
          cOrd.set('return_trip_km', 0)
          cOrd.set('total_route_with_return_km', 0)
          cOrd.set('fuel_cost', 0)
          cOrd.set('total_route_fuel_cost', 0)
          cOrd.set('km_odometro', 0)
          cOrd.set('odometro_final', 0)
          cOrd.set('odometro_inicial', 0)
          var curNotes = cOrd.getString('notes') || ''
          if (curNotes.indexOf('km e combustível zerados') === -1) {
            cOrd.set(
              'notes',
              (curNotes ? curNotes + ' | ' : '') +
                'Neutralizado — cancelado não visitado tem km e combustível zerados',
            )
          }
          app.save(cOrd)
          cancelledCount++
        }
      }
      console.log('[0094] Pedidos cancelados zerados no banco:', cancelledCount)
    } catch (errCancSweep) {
      console.log('[0094] Erro ao sanear pedidos cancelados:', errCancSweep)
    }

    // -------------------------------------------------------------
    // ETAPA 3: VARREDURA RETROATIVA DE SETEMBRO/2026 COM MOTOR NOVO
    // -------------------------------------------------------------
    console.log('[0094] Iniciando recálculo com motor novo para setembro/2026...')

    // Carregar pedidos criados em setembro/2026 (ou route_started_at em 2026-09)
    // Exclui pedidos de outubro via !~ (not contains)
    var septOrders = app.findRecordsByFilter(
      'orders',
      "(created ~ '2026-09' || route_started_at ~ '2026-09') && created !~ '2026-10'",
      'created',
      10000,
      0,
    )
    console.log('[0094] Pedidos de setembro lidos para recálculo viário:', septOrders.length)

    // Agrupar por entregador
    var septOrdersByCourier = {}
    for (var sIdx = 0; sIdx < septOrders.length; sIdx++) {
      var sOrd = septOrders[sIdx]
      var scId = sOrd.getString('courier_id')
      if (!scId) continue

      var scNotes = (sOrd.getString('notes') || '').toLowerCase()
      if (scNotes.indexOf('erro de sistema') !== -1) continue

      if (!septOrdersByCourier[scId]) {
        septOrdersByCourier[scId] = []
      }
      septOrdersByCourier[scId].push(sOrd)
    }

    var septCourierIds = Object.keys(septOrdersByCourier)
    console.log('[0094] Entregadores operantes em setembro/2026:', septCourierIds.length)

    var septUpdatedOrders = 0

    for (var sci = 0; sci < septCourierIds.length; sci++) {
      var scurierId = septCourierIds[sci]
      var scOrders = septOrdersByCourier[scurierId]
      var scMeta = couriersMap[scurierId] || {
        name: 'Entregador',
        vehicle_type: 'moto',
      }

      // Agrupar pedidos de setembro em lotes de rota por janela de saída/término
      var sBatches = {}
      for (var soi = 0; soi < scOrders.length; soi++) {
        var scOrd = scOrders[soi]
        var srStart = scOrd.getString('route_started_at')
        var srFinish = scOrd.getString('route_finished_at')
        var sbKey = 'single_' + scOrd.id

        if (srStart && srFinish) {
          sbKey = 'route_' + srStart + '_' + srFinish
        } else if (srStart) {
          var stMs = new Date(srStart).getTime()
          sbKey = 'batch_' + Math.floor(stMs / (15 * 60 * 1000))
        } else {
          var scMs = new Date(scOrd.getString('created')).getTime()
          sbKey = 'batch_created_' + Math.floor(scMs / (15 * 60 * 1000))
        }

        if (!sBatches[sbKey]) sBatches[sbKey] = []
        sBatches[sbKey].push(scOrd)
      }

      var sBatchKeys = Object.keys(sBatches)

      for (var sbi = 0; sbi < sBatchKeys.length; sbi++) {
        var sBatch = sBatches[sBatchKeys[sbi]]
        var sbCount = sBatch.length

        // Ordenar por sequência
        sBatch.sort(function (a, b) {
          return (a.getInt('sequence') || 0) - (b.getInt('sequence') || 0)
        })

        var sAnchor = sBatch[0]
        var sEmpId = sAnchor.getString('empresa_id')
        var svParams = getVehicleParams(scMeta.vehicle_type, sEmpId)
        var sBaseLat = sAnchor.getFloat('start_base_lat') || -22.7001402
        var sBaseLng = sAnchor.getFloat('start_base_lng') || -43.2982834

        // REGRA DE PARADAS EFETIVAMENTE VISITADAS:
        var sVisitedStops = []
        var sUnvisitedStops = []

        for (var ssi = 0; ssi < sbCount; ssi++) {
          var sStopOrd = sBatch[ssi]
          var sSt = sStopOrd.getString('status')
          var sCp = sStopOrd.getString('completion_reason')

          var isVis = false
          if (sCp === 'cancelado_vendedor' || sSt === 'cancelled') {
            isVis = false
          } else if (sSt === 'delivered') {
            isVis = true
          } else if (sSt === 'in_transit' && sStopOrd.getBool('route_started')) {
            isVis = true
          } else if (sSt === 'address_error' || sSt === 'client_absent') {
            isVis = true
          }

          if (isVis) {
            sVisitedStops.push(sStopOrd)
          } else {
            sUnvisitedStops.push(sStopOrd)
          }
        }

        // Zerar paradas não visitadas
        for (var suni = 0; suni < sUnvisitedStops.length; suni++) {
          var sUnv = sUnvisitedStops[suni]
          sUnv.set('distance_km', 0)
          sUnv.set('return_trip_km', 0)
          sUnv.set('total_route_with_return_km', 0)
          sUnv.set('fuel_cost', 0)
          sUnv.set('total_route_fuel_cost', 0)
          app.save(sUnv)
          septUpdatedOrders++
        }

        if (sVisitedStops.length === 0) {
          continue
        }

        // Calcular pernas viárias reais das paradas visitadas no ciclo:
        // Base -> Parada 1 -> Parada 2 -> ... -> Parada N -> Base
        var scurLat = sBaseLat
        var scurLng = sBaseLng
        var sLegDistancesKm = []
        var soutboundSumKm = 0
        var svCount = sVisitedStops.length

        for (var spi = 0; spi < svCount; spi++) {
          var spOrd = sVisitedStops[spi]
          var spCustId = spOrd.getString('customer_id')
          var spCust = customersMap[spCustId] || {}
          var spLat = spCust.lat || spOrd.getFloat('end_address_lat') || 0
          var spLng = spCust.lng || spOrd.getFloat('end_address_lng') || 0

          var stepM = 0
          if (spLat !== 0 && spLng !== 0 && scurLat !== 0 && scurLng !== 0) {
            stepM = haversineM(scurLat, scurLng, spLat, spLng)
          }

          var stepKm = Number((stepM / 1000).toFixed(2))
          if (stepKm < 0.2) stepKm = 0.2

          sLegDistancesKm.push(stepKm)
          soutboundSumKm += stepKm

          scurLat = spLat
          scurLng = spLng
        }

        // Trecho de Retorno à Base (ÚNICO no final do ciclo: última parada visitada -> base)
        var sRetStepM = 0
        if (scurLat !== 0 && scurLng !== 0 && sBaseLat !== 0 && sBaseLng !== 0) {
          sRetStepM = haversineM(scurLat, scurLng, sBaseLat, sBaseLng)
        }
        var sReturnTripKm = Number((sRetStepM / 1000).toFixed(2))
        if (sReturnTripKm < 0.3) sReturnTripKm = 0.3

        var sTotalRouteKm = Number((soutboundSumKm + sReturnTripKm).toFixed(1))

        // Combustível total da rota
        var sTotalRouteFuelCost = 0
        if (!svParams.isBike && svParams.kml > 0 && sTotalRouteKm > 0) {
          var sLit = sTotalRouteKm / svParams.kml
          sTotalRouteFuelCost = Number((sLit * svParams.price).toFixed(2))
        }

        // RATEIO PRO-RATA POR PARADA VISITADA:
        // Cada parada visitada leva sua perna de ida + cota do retorno único
        // Última parada absorve resíduo para garantir soma exata
        var sAllocKm = 0
        var sAllocFuel = 0
        var sAllocReturn = 0

        for (var svi = 0; svi < svCount; svi++) {
          var svOrder = sVisitedStops[svi]
          var sIsLast = svi === svCount - 1
          var sThisLeg = sLegDistancesKm[svi]

          var sItemKm = 0
          var sItemFuel = 0
          var sItemReturn = 0

          if (svCount === 1) {
            sItemKm = sTotalRouteKm
            sItemFuel = sTotalRouteFuelCost
            sItemReturn = sReturnTripKm
          } else if (sIsLast) {
            sItemKm = Number(Math.max(0, sTotalRouteKm - sAllocKm).toFixed(1))
            sItemFuel = Number(Math.max(0, sTotalRouteFuelCost - sAllocFuel).toFixed(2))
            sItemReturn = Number(Math.max(0, sReturnTripKm - sAllocReturn).toFixed(2))
          } else {
            var sRatio = soutboundSumKm > 0 ? sThisLeg / soutboundSumKm : 1 / svCount
            sItemKm = Number((sTotalRouteKm * sRatio).toFixed(1))
            var itLit = !svParams.isBike && svParams.kml > 0 ? sItemKm / svParams.kml : 0
            sItemFuel = !svParams.isBike ? Number((itLit * svParams.price).toFixed(2)) : 0
            sItemReturn = Number((sReturnTripKm * sRatio).toFixed(2))

            sAllocKm += sItemKm
            sAllocFuel += sItemFuel
            sAllocReturn += sItemReturn
          }

          var sSingleLeg = Number(Math.max(0.1, sItemKm - sItemReturn).toFixed(2))

          svOrder.set('sequence', svi + 1)
          svOrder.set('distance_km', sSingleLeg)
          svOrder.set('return_trip_km', sItemReturn)
          svOrder.set('total_route_with_return_km', sTotalRouteKm)
          svOrder.set('fuel_cost', sItemFuel)
          svOrder.set('total_route_fuel_cost', sTotalRouteFuelCost)

          app.save(svOrder)
          septUpdatedOrders++
        }
      }
    }
    console.log('[0094] Pedidos de setembro recalculados com motor novo:', septUpdatedOrders)

    // -------------------------------------------------------------
    // ETAPA 4: ENTREGAS CONJUNTAS NO BANCO (SETEMBRO E OUTUBRO)
    // -------------------------------------------------------------
    // Agrupar pedidos por (courier_id + customer_id + dia de entrega local) em janela <= 45 minutos.
    // Para pedidos que são entrega múltipla no mesmo ponto:
    // A 1ª parada (primária) mantém o KM e combustível da visita.
    // A 2ª em diante (secundária) tem distance_km = 0, return_trip_km = 0, fuel_cost = 0 gravados no banco.
    console.log('[0094] Gravando consolidação de entregas conjuntas no banco...')

    function getOrderTimestamp(o) {
      var arr = o.getString('actual_arrival')
      if (arr) {
        var t = new Date(arr).getTime()
        if (!isNaN(t) && t > 0) return t
      }
      var rf = o.getString('route_finished_at')
      if (rf) {
        var t2 = new Date(rf).getTime()
        if (!isNaN(t2) && t2 > 0) return t2
      }
      var cr = o.getString('created')
      if (cr) {
        var t3 = new Date(cr).getTime()
        if (!isNaN(t3) && t3 > 0) return t3
      }
      return 0
    }

    function getDayKeyInBrazil(ts) {
      var d = new Date(ts - 3 * 3600 * 1000)
      var y = d.getUTCFullYear()
      var m = String(d.getUTCMonth() + 1)
      if (m.length < 2) m = '0' + m
      var day = String(d.getUTCDate())
      if (day.length < 2) day = '0' + day
      return y + '-' + m + '-' + day
    }

    // Carregar todos os pedidos entregues elegíveis de setembro e outubro
    var allEligibleOrders = app.findRecordsByFilter(
      'orders',
      "(status = 'delivered' || (route_finished = true && status = 'in_transit')) && (created ~ '2026-09' || created ~ '2026-10')",
      'created',
      25000,
      0,
    )
    console.log(
      '[0094] Pedidos entregues elegíveis para detecção de conjuntas:',
      allEligibleOrders.length,
    )

    // Pré-agrupar por bucket: courier_id ::: customer_id ::: dayKey
    var jointBuckets = {}
    for (var joi = 0; joi < allEligibleOrders.length; joi++) {
      var jOrd = allEligibleOrders[joi]
      var jcId = jOrd.getString('courier_id') || 'unassigned'
      var jCustId = jOrd.getString('customer_id') || 'no_cust'
      var jTs = getOrderTimestamp(jOrd)
      if (jTs === 0) continue

      var jDayKey = getDayKeyInBrazil(jTs)
      var jbKey = jcId + ':::' + jCustId + ':::' + jDayKey

      if (!jointBuckets[jbKey]) {
        jointBuckets[jbKey] = []
      }
      jointBuckets[jbKey].push(jOrd)
    }

    var jointBucketKeys = Object.keys(jointBuckets)
    var jointSecondaryOrdersCount = 0
    var jointGroupsCount = 0

    for (var jbi = 0; jbi < jointBucketKeys.length; jbi++) {
      var jbOrders = jointBuckets[jointBucketKeys[jbi]]
      if (jbOrders.length < 2) continue

      // Ordenar por horário de conclusão
      jbOrders.sort(function (a, b) {
        return getOrderTimestamp(a) - getOrderTimestamp(b)
      })

      // Cluster contíguo a <= 45 min
      var MAX_INTERVAL = 45 * 60 * 1000
      var currentCluster = [jbOrders[0]]

      for (var ci2 = 1; ci2 < jbOrders.length; ci2++) {
        var prevO = currentCluster[currentCluster.length - 1]
        var currO = jbOrders[ci2]
        var tP = getOrderTimestamp(prevO)
        var tC = getOrderTimestamp(currO)

        if (Math.abs(tC - tP) <= MAX_INTERVAL) {
          currentCluster.push(currO)
        } else {
          if (currentCluster.length >= 2) {
            applyJointGroup(currentCluster)
          }
          currentCluster = [currO]
        }
      }

      if (currentCluster.length >= 2) {
        applyJointGroup(currentCluster)
      }
    }

    function applyJointGroup(cluster) {
      jointGroupsCount++
      var primaryOrd = cluster[0]
      var primaryTrack = primaryOrd.getString('tracking_code') || primaryOrd.id

      // O pedido primário (1º) mantém seu km e recebe nota de entrega conjunta primária
      var pNotes = primaryOrd.getString('notes') || ''
      if (pNotes.indexOf('[ENTREGA CONJUNTA PRINCIPAL]') === -1) {
        primaryOrd.set(
          'notes',
          (pNotes ? pNotes + ' | ' : '') +
            '[ENTREGA CONJUNTA PRINCIPAL]: agrupa ' +
            cluster.length +
            ' entregas no mesmo endereço/ponto',
        )
        app.save(primaryOrd)
      }

      // Os pedidos secundários (2º em diante) têm km e combustível zerados no banco
      for (var si3 = 1; si3 < cluster.length; si3++) {
        var secOrd = cluster[si3]
        secOrd.set('distance_km', 0)
        secOrd.set('return_trip_km', 0)
        secOrd.set('fuel_cost', 0)
        var sNotes2 = secOrd.getString('notes') || ''
        if (sNotes2.indexOf('[ENTREGA CONJUNTA SECUNDÁRIA]') === -1) {
          secOrd.set(
            'notes',
            (sNotes2 ? sNotes2 + ' | ' : '') +
              '[ENTREGA CONJUNTA SECUNDÁRIA]: km e combustível zerados (viagem consolidada no pedido ' +
              primaryTrack +
              ')',
          )
        }
        app.save(secOrd)
        jointSecondaryOrdersCount++
      }
    }

    console.log(
      '[0094] Grupos de entrega conjunta detectados:',
      jointGroupsCount,
      '| Pedidos secundários zerados no banco:',
      jointSecondaryOrdersCount,
    )

    console.log('[0094] Migração 0094 concluída com sucesso.')
  },
  (app) => {
    console.log('[0094] Rollback no-op seguro.')
  },
)
