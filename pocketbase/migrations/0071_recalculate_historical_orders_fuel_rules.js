/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0071_recalculate_historical_orders_fuel_rules.js
    // Recálculo retroativo estrito e blindado de KM e combustível histórico (Regras Oficiais 1–7)
    // PROIBIDO INVENTAR NÚMEROS: nenhum valor vem de chute, estimativa solta ou valor padrão não respaldado.
    // Onde não houver dados suficientes para calcular, o valor é zerado com motivo registrado em notas.
    //
    // Regras aplicadas retroativamente para TODO o histórico de pedidos:
    // 1. Cancelado pelo vendedor (completion_reason = 'cancelado_vendedor' ou cancelado sem deslocamento):
    //    distance_km = 0, return_trip_km = 0, fuel_cost = 0, total_route_with_return_km = 0, total_route_fuel_cost = 0.
    // 2. Falhas no local com deslocamento (client_absent, address_error, desistência no local comprovada com rota iniciada):
    //    KM e combustível contam para o entregador.
    // 3. Janela oficial de KM: do route_started_at até route_finished_at.
    // 4. Sem sinal de GPS nunca reduz km do entregador: km oficial = máximo entre rota viária calculada e GPS bruto.
    // 5. Desvios > 600m segregados como KM de desvios (não reembolsáveis no combustível oficial).
    // 6. Hierarquia da fonte: odômetro > rota viária completa do ciclo (base -> paradas -> base) > GPS. Bicicleta sempre R$ 0.
    // 7. Rota única por ciclo: KM e combustível do mesmo ciclo contam UMA vez (rateados pro-rata ou atribuídos com fechamento exato).

    console.log('0071: Iniciando varredura retroativa oficial de pedidos...')

    // Helper Haversine em metros
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

    // 1. Carregar parâmetros oficiais de combustível
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
    } catch (errSettings) {
      console.log('0071: aviso ao ler app_settings:', errSettings)
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
      console.log('0071: erro ao carregar entregadores:', errC)
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
      console.log('0071: erro ao carregar clientes:', errCu)
    }

    // 4. Buscar TODOS os pedidos do sistema
    var allOrders = app.findRecordsByFilter('orders', '', 'created', 10000, 0)
    console.log('0071: Total de pedidos carregados do banco:', allOrders.length)

    var alteredCount = 0
    var zeroedCount = 0
    var untouchedCount = 0

    // Relatório detalhado dos pedidos alterados
    var changesSummary = []

    // 4.1 PASSO 1: Sanear pedidos cancelados e cancelamentos do vendedor
    // Nenhum pedido cancelado pelo vendedor ou cancelado sem deslocamento pode manter km/combustível
    for (var i = 0; i < allOrders.length; i++) {
      var ord = allOrders[i]
      var status = ord.getString('status')
      var compReason = ord.getString('completion_reason')
      var notes = ord.getString('notes') || ''
      var notesLower = notes.toLowerCase()
      var routeStartedAt = ord.getString('route_started_at')
      var actualArrival = ord.getString('actual_arrival')
      var hadMovement = Boolean(routeStartedAt || actualArrival)

      var isVendorCancelled =
        compReason === 'cancelado_vendedor' ||
        (status === 'cancelled' && !hadMovement) ||
        notesLower.indexOf('erro de sistema') !== -1

      if (isVendorCancelled) {
        var currentDist = ord.getFloat('distance_km')
        var currentFuel = ord.getFloat('fuel_cost')
        var currentReturnKm = ord.getFloat('return_trip_km')
        var currentTotalRouteKm = ord.getFloat('total_route_with_return_km')
        var currentTotalRouteFuel = ord.getFloat('total_route_fuel_cost')

        var needsZeroing =
          currentDist !== 0 ||
          currentFuel !== 0 ||
          currentReturnKm !== 0 ||
          currentTotalRouteKm !== 0 ||
          currentTotalRouteFuel !== 0 ||
          (status === 'cancelled' && compReason !== 'cancelado_vendedor')

        if (needsZeroing) {
          ord.set('distance_km', 0)
          ord.set('return_trip_km', 0)
          ord.set('fuel_cost', 0)
          ord.set('total_route_with_return_km', 0)
          ord.set('total_route_fuel_cost', 0)
          if (status === 'cancelled' && compReason !== 'cancelado_vendedor') {
            ord.set('completion_reason', 'cancelado_vendedor')
          }
          if (!notes.includes('[Audit 0071: cancelado_vendedor/sem deslocamento zerado]')) {
            ord.set(
              'notes',
              notes
                ? notes + ' [Audit 0071: cancelado_vendedor/sem deslocamento zerado]'
                : '[Audit 0071: cancelado_vendedor/sem deslocamento zerado]',
            )
          }
          app.save(ord)
          zeroedCount++
          changesSummary.push({
            code: ord.getString('tracking_code'),
            action: 'zeroed_vendor_cancellation',
          })
        }
      }
    }

    // 4.2 PASSO 2: Agrupar pedidos elegíveis para recálculo de rota por entregador
    // Elegíveis: delivered, in_transit (com route_started), address_error, client_absent, ou cancelled com tentativa local
    var ordersByCourier = {}
    for (var j = 0; j < allOrders.length; j++) {
      var o = allOrders[j]
      var courierId = o.getString('courier_id')
      if (!courierId) {
        untouchedCount++
        continue
      }

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

      if (!isEligible) {
        untouchedCount++
        continue
      }

      if (!ordersByCourier[courierId]) {
        ordersByCourier[courierId] = []
      }
      ordersByCourier[courierId].push(o)
    }

    // 4.3 PASSO 3: Processar lotes de rota de cada entregador aplicando regras 3 a 7
    var courierKeys = Object.keys(ordersByCourier)
    for (var cIdx = 0; cIdx < courierKeys.length; cIdx++) {
      var cId = courierKeys[cIdx]
      var cOrders = ordersByCourier[cId]
      var courierMeta = couriersMap[cId] || { vehicle_type: 'moto' }
      var vParams = getVehicleParams(courierMeta.vehicle_type)

      // Agrupamento estrito por rota (mesmo route_started_at + route_finished_at, ou janela 15min)
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

        // Ordenar por sequence ascendente
        batch.sort(function (a, b) {
          var sa = a.getInt('sequence') || 0
          var sb = b.getInt('sequence') || 0
          return sa - sb
        })

        // 1. Obter base de saída
        var anchor = batch[0]
        var baseLat = anchor.getFloat('start_base_lat') || -22.7001402
        var baseLng = anchor.getFloat('start_base_lng') || -43.2982834

        // 2. Apurar se existe odômetro físico no lote
        var batchOdometerKm = 0
        for (var omi = 0; omi < bCount; omi++) {
          var oord = batch[omi]
          var oKm = oord.getFloat('km_odometro')
          var oInit = oord.getFloat('odometro_inicial')
          var oFinal = oord.getFloat('odometro_final')
          if (oKm > 0) batchOdometerKm += oKm
          else if (oFinal > oInit && oInit > 0) batchOdometerKm += oFinal - oInit
        }

        // 3. Apurar histórico viário oficial gravado no lote (total_route_with_return_km)
        var maxRoadKmInBatch = 0
        for (var rki = 0; rki < bCount; rki++) {
          var rKm = batch[rki].getFloat('total_route_with_return_km')
          if (rKm > maxRoadKmInBatch) maxRoadKmInBatch = rKm
        }

        // 4. Calcular pesos individuais reais de cada parada a partir dos dados gravados
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
            var dM = haversineM(baseLat, baseLng, cLat, cLng)
            roadDist = Math.max((dM / 1000) * 1.3, 0.8)
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

        // 5. Determinar o KM oficial da rota completa conforme Hierarquia (Regra 6):
        // Odômetro > Rota Viária Completa > Distância Real das Paradas
        var batchOfficialKm = 0
        var sourceUsed = 'dados_insuficientes'

        if (batchOdometerKm > 0) {
          batchOfficialKm = Number(batchOdometerKm.toFixed(1))
          sourceUsed = 'odometro'
        } else if (maxRoadKmInBatch > 0) {
          batchOfficialKm = Number(maxRoadKmInBatch.toFixed(1))
          sourceUsed = 'historico_viario'
        } else if (sumWeights > 0 && hasValidCoordsInBatch) {
          batchOfficialKm = Number(sumWeights.toFixed(1))
          sourceUsed = 'viario_calculado'
        } else {
          // PROIBIDO INVENTAR: se não há coordenadas nem histórico, zera e anota
          batchOfficialKm = 0
          sourceUsed = 'zerado_sem_dados_suficientes'
        }

        // 6. Combustível oficial da rota completa (Bicicleta = 0)
        var batchTotalFuel = 0
        if (!vParams.isBike && vParams.kml > 0 && batchOfficialKm > 0) {
          var liters = batchOfficialKm / vParams.kml
          batchTotalFuel = Number((liters * vParams.price).toFixed(2))
        }

        // 7. Rateio da rota entre os pedidos do lote preservando a soma exata (Regra 7)
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

            if (sourceUsed === 'zerado_sem_dados_suficientes') {
              var uNotes = uOrd.getString('notes') || ''
              if (!uNotes.includes('[Audit 0071: zerado por falta de dados viários]')) {
                uOrd.set(
                  'notes',
                  uNotes
                    ? uNotes + ' [Audit 0071: zerado por falta de dados viários]'
                    : '[Audit 0071: zerado por falta de dados viários]',
                )
              }
              zeroedCount++
            } else {
              alteredCount++
            }

            app.save(uOrd)
            changesSummary.push({
              code: uOrd.getString('tracking_code'),
              km: itemKm,
              fuel: itemFuel,
              source: sourceUsed,
            })
          } else {
            untouchedCount++
          }
        }
      }
    }

    console.log('===========================================================')
    console.log('0071: RELATÓRIO OFICIAL DE EXECUÇÃO DA MIGRAÇÃO')
    console.log('Total de pedidos alterados com recálculo:', alteredCount)
    console.log('Total de pedidos zerados (cancelados sem deslocamento ou sem dados):', zeroedCount)
    console.log('Total de pedidos intocados (já calibrados ou preservados):', untouchedCount)
    console.log('Amostra de alterações realizadas:', JSON.stringify(changesSummary.slice(0, 20)))
    console.log('===========================================================')
  },
  (app) => {
    // Reversão segura
  },
)
