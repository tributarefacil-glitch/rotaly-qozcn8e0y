/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0087_recalculate_official_km_telemetry_odometer.js
    //
    // OBJETIVO:
    // 1. Aplicar a nova regra de KM Oficial sem nenhum multiplicador artificial (*1.31, *1.25)
    // 2. Hierarquia de fontes:
    //    Prioridade 1: Odômetro físico registrado pelo entregador (km_odometro ou odometro_final - odometro_inicial)
    //    Prioridade 2: Trajeto viário oficial das paradas da rota
    //    Prioridade 3: Telemetria GPS saneada (com filtro anti-jitter e descarte de spikes)
    //    Falha transitória de GPS nunca reduz o KM do entregador.
    // 3. Proibição de inventar números.
    // 4. Recalcular retroativamente as rotas finalizadas no banco, atualizando apenas os campos derivados
    //    (distance_km, return_trip_km, total_route_with_return_km, fuel_cost, total_route_fuel_cost)
    //    sem alterar os pontos GPS brutos da coleção 'locations'.

    console.log('[0087] Iniciando recálculo retroativo oficial de KM e combustível...')

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

    // 1. Carregar parâmetros de combustível
    var motoPrice = 6.49
    var motoKml = 35.0
    var carroPrice = 6.49
    var carroKml = 10.0
    var caminhaoPrice = 6.49
    var caminhaoKml = 7.0

    try {
      var settingsList = app.findRecordsByFilter(
        'app_settings',
        "key = 'global_settings'",
        '',
        1,
        0,
      )
      if (settingsList.length > 0) {
        var s = settingsList[0]
        motoPrice = s.getFloat('moto_fuel_price') || s.getFloat('fuel_price_per_liter') || motoPrice
        motoKml =
          s.getFloat('moto_consumption_kml') || s.getFloat('fuel_consumption_kml') || motoKml
        carroPrice =
          s.getFloat('carro_fuel_price') || s.getFloat('fuel_price_per_liter') || carroPrice
        carroKml = s.getFloat('carro_consumption_kml') || carroKml
        caminhaoPrice = s.getFloat('caminhao_fuel_price') || caminhaoPrice
        caminhaoKml = s.getFloat('caminhao_consumption_kml') || caminhaoKml
      }
    } catch (e) {
      console.log('[0087] Aviso ao carregar app_settings:', e)
    }

    function getVehicleParams(vType) {
      var v = (vType || 'moto').toLowerCase()
      if (v === 'carro' || v === 'van') {
        return { price: carroPrice, kml: carroKml, isBike: false }
      }
      if (v === 'caminhao') {
        return { price: caminhaoPrice, kml: caminhaoKml, isBike: false }
      }
      if (v === 'bicicleta' || v === 'bicycle') {
        return { price: 0, kml: 0, isBike: true }
      }
      return { price: motoPrice, kml: motoKml, isBike: false }
    }

    // 2. Carregar entregadores
    var couriersMap = {}
    try {
      var couriers = app.findRecordsByFilter('users', "role = 'courier'", '', 500, 0)
      for (var ci = 0; ci < couriers.length; ci++) {
        var c = couriers[ci]
        couriersMap[c.id] = {
          id: c.id,
          name: c.getString('name'),
          vehicle_type: c.getString('vehicle_type') || 'moto',
        }
      }
    } catch (errC) {
      console.log('[0087] Erro ao carregar entregadores:', errC)
    }

    // 3. Carregar clientes
    var customersMap = {}
    try {
      var custs = app.findRecordsByFilter('customers', '', '', 2000, 0)
      for (var ki = 0; ki < custs.length; ki++) {
        var cu = custs[ki]
        customersMap[cu.id] = {
          lat: cu.getFloat('lat') || 0,
          lng: cu.getFloat('lng') || 0,
        }
      }
    } catch (errCu) {
      console.log('[0087] Erro ao carregar clientes:', errCu)
    }

    // 4. Buscar todos os pedidos
    var allOrders = app.findRecordsByFilter('orders', '', 'created', 10000, 0)
    console.log('[0087] Total de pedidos lidos:', allOrders.length)

    // Agrupar pedidos elegíveis por entregador
    var ordersByCourier = {}
    for (var j = 0; j < allOrders.length; j++) {
      var o = allOrders[j]
      var courierId = o.getString('courier_id')
      if (!courierId) continue

      var oStatus = o.getString('status')
      var oCompReason = o.getString('completion_reason')
      var oNotes = (o.getString('notes') || '').toLowerCase()

      if (oCompReason === 'cancelado_vendedor') continue
      if (oNotes.indexOf('erro de sistema') !== -1) continue

      var isEligible = false
      if (oStatus === 'delivered') isEligible = true
      else if (oStatus === 'in_transit' && o.getBool('route_started')) isEligible = true
      else if (oStatus === 'address_error' || oStatus === 'client_absent') isEligible = true
      else if (oStatus === 'cancelled') {
        var isLocal =
          oNotes.indexOf('cancelamento: [desistência do cliente]') !== -1 ||
          oNotes.indexOf('desistência do cliente') !== -1 ||
          oNotes.indexOf('desistencia do cliente') !== -1
        var hadAttempt = Boolean(o.getString('route_started_at') || o.getString('actual_arrival'))
        if (isLocal && hadAttempt) isEligible = true
      }

      if (!isEligible) continue

      if (!ordersByCourier[courierId]) {
        ordersByCourier[courierId] = []
      }
      ordersByCourier[courierId].push(o)
    }

    var alteredCount = 0
    var untouchedCount = 0
    var comparisonTable = []

    var courierIds = Object.keys(ordersByCourier)
    for (var cIdx = 0; cIdx < courierIds.length; cIdx++) {
      var cId = courierIds[cIdx]
      var cOrders = ordersByCourier[cId]
      var courierMeta = couriersMap[cId] || { name: 'Entregador', vehicle_type: 'moto' }
      var vParams = getVehicleParams(courierMeta.vehicle_type)

      // Carregar todas as localizações deste entregador
      var courierLocs = []
      try {
        courierLocs = app.findRecordsByFilter(
          'locations',
          "user_id = '" + cId + "'",
          'created',
          15000,
          0,
        )
      } catch (eLoc) {
        console.log('[0087] Aviso ao carregar locations do entregador ' + cId + ':', eLoc)
      }

      // Agrupamento estrito por lote de rota
      var batches = {}
      for (var oi = 0; oi < cOrders.length; oi++) {
        var cord = cOrders[oi]
        var rStart = cord.getString('route_started_at')
        var rFinish = cord.getString('route_finished_at')
        var bKey = 'single_' + cord.id

        if (rStart && rFinish) {
          bKey = 'route_' + rStart + '_' + rFinish
        } else if (rStart) {
          var tMs = new Date(rStart).getTime()
          bKey = 'batch_' + Math.floor(tMs / (15 * 60 * 1000))
        } else {
          var cMs = new Date(cord.getString('created')).getTime()
          bKey = 'batch_created_' + Math.floor(cMs / (15 * 60 * 1000))
        }

        if (!batches[bKey]) batches[bKey] = []
        batches[bKey].push(cord)
      }

      var batchKeys = Object.keys(batches)
      for (var bi = 0; bi < batchKeys.length; bi++) {
        var batch = batches[batchKeys[bi]]
        var bCount = batch.length

        batch.sort(function (a, b) {
          return (a.getInt('sequence') || 0) - (b.getInt('sequence') || 0)
        })

        var anchor = batch[0]
        var baseLat = anchor.getFloat('start_base_lat') || -22.7001402
        var baseLng = anchor.getFloat('start_base_lng') || -43.2982834

        // 1. Apurar odômetro físico informado no lote
        var batchOdometerKm = 0
        for (var omi = 0; omi < bCount; omi++) {
          var oord = batch[omi]
          var oKm = oord.getFloat('km_odometro')
          var oInit = oord.getFloat('odometro_inicial')
          var oFinal = oord.getFloat('odometro_final')
          if (oKm > 0) batchOdometerKm += oKm
          else if (oFinal > oInit && oInit > 0) batchOdometerKm += oFinal - oInit
        }

        // 2. Apurar histórico viário gravado (total_route_with_return_km)
        var maxRoadKmInBatch = 0
        for (var rki = 0; rki < bCount; rki++) {
          var rKm = batch[rki].getFloat('total_route_with_return_km')
          if (rKm > maxRoadKmInBatch) maxRoadKmInBatch = rKm
        }

        // 3. Janela de tempo do lote
        var minStart = 0
        var maxEnd = 0
        for (var ti = 0; ti < bCount; ti++) {
          var tOrd = batch[ti]
          var sStr = tOrd.getString('route_started_at') || tOrd.getString('created')
          var eStr =
            tOrd.getString('route_finished_at') ||
            tOrd.getString('actual_arrival') ||
            tOrd.getString('updated')
          if (sStr) {
            var sVal = new Date(sStr).getTime()
            if (minStart === 0 || sVal < minStart) minStart = sVal
          }
          if (eStr) {
            var eVal = new Date(eStr).getTime()
            if (maxEnd === 0 || eVal > maxEnd) maxEnd = eVal
          }
        }
        if (minStart > 0 && maxEnd === 0) {
          maxEnd = minStart + 2 * 60 * 60 * 1000
        }

        // 4. Filtrar pontos GPS da janela temporal com o NOVO motor saneado
        var validGpsPts = []
        if (courierLocs.length > 0 && minStart > 0 && maxEnd > 0) {
          var winStart = minStart - 30 * 1000
          var winEnd = maxEnd + 30 * 1000

          var rawPoints = []
          for (var li = 0; li < courierLocs.length; li++) {
            var loc = courierLocs[li]
            var lTime = new Date(loc.getString('created')).getTime()
            if (lTime >= winStart && lTime <= winEnd) {
              var lLat = loc.getFloat('lat')
              var lLng = loc.getFloat('lng')
              var lAcc = loc.getFloat('accuracy')
              var lSpd = loc.getFloat('speed')
              if (
                !isNaN(lLat) &&
                !isNaN(lLng) &&
                Math.abs(lLat) > 0.001 &&
                Math.abs(lLng) > 0.001
              ) {
                if (!lAcc || lAcc <= 100) {
                  rawPoints.push({
                    lat: lLat,
                    lng: lLng,
                    accuracy: lAcc || 10,
                    speed: lSpd,
                    time: lTime,
                    isOffline: loc.getBool('offline_buffered'),
                  })
                }
              }
            }
          }

          // Anti-jitter e descarte de saltos
          if (rawPoints.length > 0) {
            validGpsPts.push(rawPoints[0])
            for (var ri = 1; ri < rawPoints.length; ri++) {
              var pPrev = validGpsPts[validGpsPts.length - 1]
              var pCurr = rawPoints[ri]
              var dM = haversineM(pPrev.lat, pPrev.lng, pCurr.lat, pCurr.lng)
              var dtSec = Math.max(0.1, (pCurr.time - pPrev.time) / 1000)

              // Sensor velocidade < 1.2 km/h
              if (pCurr.speed >= 0 && pCurr.speed < 0.333 && dM < 25) continue
              // Jitter parado (<12m em <45s)
              if (dM < 12 && dtSec < 45) continue
              // Dentro da precisão das antenas
              var combAcc = Math.max(pPrev.accuracy, pCurr.accuracy)
              if (dM <= combAcc && dtSec < 60) continue

              // Salto impossível (> 90 km/h)
              var spdKmh = (dM / dtSec) * 3.6
              if (spdKmh > 90) continue

              validGpsPts.push(pCurr)
            }
          }
        }

        // Medir deslocamento GPS puro (SEM NENHUM MULTIPLICADOR)
        var pureGpsMeters = 0
        if (validGpsPts.length >= 2) {
          for (var gi = 1; gi < validGpsPts.length; gi++) {
            if (validGpsPts[gi - 1].isOffline !== validGpsPts[gi].isOffline) continue
            var stepD = haversineM(
              validGpsPts[gi - 1].lat,
              validGpsPts[gi - 1].lng,
              validGpsPts[gi].lat,
              validGpsPts[gi].lng,
            )
            pureGpsMeters += stepD
          }
        }
        var pureGpsKm = pureGpsMeters / 1000

        // 5. Calcular pesos viários individuais de cada parada
        var weights = []
        var sumWeights = 0
        var hasValidCoordsInBatch = false

        for (var pi = 0; pi < bCount; pi++) {
          var pOrd = batch[pi]
          var custId = pOrd.getString('customer_id')
          var cData = customersMap[custId] || {}
          var cLat = cData.lat || pOrd.getFloat('end_address_lat') || 0
          var cLng = cData.lng || pOrd.getFloat('end_address_lng') || 0

          var roadDist = 0.8
          if (cLat !== 0 && cLng !== 0 && (baseLat !== 0 || baseLng !== 0)) {
            hasValidCoordsInBatch = true
            var dBaseToCust = haversineM(baseLat, baseLng, cLat, cLng)
            roadDist = Math.max(dBaseToCust / 1000, 0.8)
          }

          var existingDist = pOrd.getFloat('distance_km')
          if (existingDist > 0) {
            roadDist = Math.max(roadDist, existingDist)
          }

          var retKm = pOrd.getFloat('return_trip_km')
          if (!retKm || retKm <= 0) {
            retKm = roadDist
          }

          var w = Math.max(roadDist, 0.8) + retKm
          weights.push(w)
          sumWeights += w
        }

        // 6. HIERARQUIA DE FONTES RIGOROSA:
        // Prioridade 1 = Odômetro físico da moto
        // Prioridade 2 = Trajeto viário oficial das paradas (maxRoadKmInBatch ou soma viária)
        // Prioridade 3 = Telemetria GPS saneada pura (sem multiplicador)
        // Falha transitória de GPS nunca reduz o km: max(viário, GPS)
        var batchOfficialKm = 0
        var sourceUsed = 'dados_insuficientes'

        if (batchOdometerKm > 0) {
          batchOfficialKm = Number(batchOdometerKm.toFixed(1))
          sourceUsed = 'odometro'
        } else if (maxRoadKmInBatch > 0) {
          var viarioBase = maxRoadKmInBatch
          batchOfficialKm = Number(Math.max(viarioBase, pureGpsKm).toFixed(1))
          sourceUsed = batchOfficialKm > viarioBase ? 'gps_puro_saneado' : 'historico_viario'
        } else if (pureGpsKm > 0) {
          var viarioSum = sumWeights > 0 && hasValidCoordsInBatch ? sumWeights : 0
          batchOfficialKm = Number(Math.max(viarioSum, pureGpsKm).toFixed(1))
          sourceUsed = batchOfficialKm > viarioSum ? 'gps_puro_saneado' : 'viario_calculado'
        } else if (sumWeights > 0 && hasValidCoordsInBatch) {
          batchOfficialKm = Number(sumWeights.toFixed(1))
          sourceUsed = 'viario_calculado'
        } else {
          batchOfficialKm = 0
          sourceUsed = 'zerado_sem_dados_suficientes'
        }

        // 7. Combustível oficial (Bicicleta = 0)
        var batchTotalFuel = 0
        if (!vParams.isBike && vParams.kml > 0 && batchOfficialKm > 0) {
          var liters = batchOfficialKm / vParams.kml
          batchTotalFuel = Number((liters * vParams.price).toFixed(2))
        }

        // 8. Rateio preservando o total do lote
        var allocatedKmAcc = 0
        var allocatedFuelAcc = 0

        for (var ui = 0; ui < bCount; ui++) {
          var uOrd = batch[ui]
          var isLast = ui === bCount - 1
          var pWeight = weights[ui]
          var ratio = sumWeights > 0 ? pWeight / sumWeights : 1 / bCount

          var itemKm = 0
          var itemFuel = 0

          if (batchOfficialKm === 0) {
            itemKm = 0
            itemFuel = 0
          } else if (bCount === 1) {
            itemKm = batchOfficialKm
            itemFuel = batchTotalFuel
          } else if (isLast) {
            itemKm = Number(Math.max(0, batchOfficialKm - allocatedKmAcc).toFixed(1))
            itemFuel = Number(Math.max(0, batchTotalFuel - allocatedFuelAcc).toFixed(2))
          } else {
            itemKm = Number((batchOfficialKm * ratio).toFixed(1))
            var itLiters = !vParams.isBike && vParams.kml > 0 ? itemKm / vParams.kml : 0
            itemFuel = !vParams.isBike ? Number((itLiters * vParams.price).toFixed(2)) : 0

            allocatedKmAcc += itemKm
            allocatedFuelAcc += itemFuel
          }

          var singleKm = Number((itemKm / 2).toFixed(2))
          var retTrip = Number((itemKm - singleKm).toFixed(2))

          var prevDist = uOrd.getFloat('distance_km')
          var prevFuel = uOrd.getFloat('fuel_cost')
          var prevTotalKm = uOrd.getFloat('total_route_with_return_km')
          var prevTotalFuel = uOrd.getFloat('total_route_fuel_cost')

          var changed =
            Math.abs(prevDist - singleKm) > 0.05 ||
            Math.abs(prevFuel - itemFuel) > 0.05 ||
            Math.abs(prevTotalKm - batchOfficialKm) > 0.05 ||
            Math.abs(prevTotalFuel - batchTotalFuel) > 0.05

          if (changed) {
            uOrd.set('distance_km', singleKm)
            uOrd.set('return_trip_km', retTrip)
            uOrd.set('fuel_cost', itemFuel)
            uOrd.set('total_route_with_return_km', batchOfficialKm)
            uOrd.set('total_route_fuel_cost', batchTotalFuel)
            app.save(uOrd)
            alteredCount++

            comparisonTable.push({
              code: uOrd.getString('tracking_code'),
              courier: courierMeta.name,
              date: uOrd.getString('created').slice(0, 10),
              oldKm: Number((prevDist + uOrd.getFloat('return_trip_km')).toFixed(1)),
              newKm: itemKm,
              batchKm: batchOfficialKm,
              source: sourceUsed,
            })
          } else {
            untouchedCount++
          }
        }
      }
    }

    console.log('===========================================================')
    console.log('[0087] RECÁLCULO RETROATIVO CONCLUÍDO COM SUCESSO')
    console.log('[0087] Total de pedidos atualizados:', alteredCount)
    console.log('[0087] Total de pedidos preservados (intocados):', untouchedCount)
    console.log('[0087] Amostra comparativa de rotas alteradas:')
    for (var mi = 0; mi < Math.min(comparisonTable.length, 15); mi++) {
      var item = comparisonTable[mi]
      console.log(
        '  - [' +
          item.code +
          '] ' +
          item.courier +
          ' (' +
          item.date +
          '): KM antigo = ' +
          item.oldKm +
          ' -> KM novo = ' +
          item.newKm +
          ' (Fonte: ' +
          item.source +
          ')',
      )
    }
    console.log('===========================================================')
  },
  (app) => {
    // Reversão no-op segura
  },
)
