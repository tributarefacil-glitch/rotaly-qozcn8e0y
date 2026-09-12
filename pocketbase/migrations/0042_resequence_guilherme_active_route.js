migrate(
  (app) => {
    // 0042_resequence_guilherme_active_route.js
    //
    // Objetivo da Migração:
    // 1. Encontrar a rota ativa do entregador Guilherme de Paiva (pedidos pendentes/em trânsito não entregues e não finalizados).
    // 2. EXCLUIR do cálculo o pedido fantasma TRK-2026-622 (Thais Sampaio, de 11/09 com telemetria corrompida).
    // 3. Executar o sequenciamento viário (origem = base ativa 'Mais Saudavel', paradas = pedidos pendentes válidos, destino = volta à base).
    // 4. Gravar os novos valores de sequence (1, 2, 3...) e métricas viárias recalculadas em cada pedido:
    //    start_base_*, end_address_*, distance_km, return_trip_km, total_route_with_return_km, total_route_fuel_cost, estimated_duration_minutes.
    // 5. Garantir que a migração é idempotente.

    try {
      console.log('0042: Iniciando resequenciamento viário da rota do Guilherme de Paiva...')

      // 1. Localizar o entregador Guilherme de Paiva
      var guilherme
      try {
        var couriers = app.findRecordsByFilter(
          'users',
          "name ~ 'GUILHERME DE PAIVA' || name ~ 'Guilherme de Paiva'",
          'created',
          1,
          0,
        )
        if (couriers.length > 0) {
          guilherme = couriers[0]
        }
      } catch (eCourier) {
        console.log('0042: Erro ao buscar entregador:', eCourier)
      }

      if (!guilherme) {
        console.log('0042: Entregador Guilherme de Paiva não encontrado. Abortando com segurança.')
        return
      }

      var courierId = guilherme.id
      console.log('0042: Entregador localizado:', guilherme.getString('name'), 'ID:', courierId)

      // 2. Localizar a Base Ativa (padrão 'Mais Saudavel')
      var baseLat = -22.7001402
      var baseLng = -43.2982834
      var baseName = 'Mais Saudavel'
      var baseAddress = 'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil'

      try {
        var bases = app.findRecordsByFilter('base_addresses', 'is_default = true', 'created', 1, 0)
        if (bases.length > 0) {
          var b = bases[0]
          baseLat = b.get('lat') || baseLat
          baseLng = b.get('lng') || baseLng
          baseName = b.getString('name') || baseName
          baseAddress = b.getString('address') || baseAddress
        }
      } catch (eBase) {
        console.log('0042: Aviso ao buscar base padrão, usando fallback Mais Saudavel:', eBase)
      }

      // Parâmetros de combustível da moto (Honda CG 160)
      var pricePerLiter = 5.89
      var consumptionKml = 32.0
      try {
        var settingsList = app.findRecordsByFilter(
          'app_settings',
          "key = 'default'",
          'created',
          1,
          0,
        )
        if (settingsList.length > 0) {
          var s = settingsList[0]
          var p = s.get('moto_fuel_price') || s.get('fuel_price_per_liter')
          var c = s.get('moto_consumption_kml') || s.get('fuel_consumption_kml')
          if (p && p > 0) pricePerLiter = p
          if (c && c > 0) consumptionKml = c
        }
      } catch (eSettings) {
        console.log('0042: Usando parâmetros padrão de combustível (R$ 5.89 / 32 km/l)')
      }

      // 3. Buscar pedidos ativos do Guilherme (não finalizados, não entregues, não cancelados)
      var activeOrders = app.findRecordsByFilter(
        'orders',
        "courier_id = '" +
          courierId +
          "' && route_finished = false && status != 'delivered' && status != 'cancelled'",
        'created',
        200,
        0,
      )

      console.log('0042: Total de pedidos ativos encontrados:', activeOrders.length)

      // 4. Filtrar: EXCLUIR o pedido fantasma TRK-2026-622
      var validOrders = []
      var ghostExcluded = false

      for (var i = 0; i < activeOrders.length; i++) {
        var ord = activeOrders[i]
        var tracking = ord.getString('tracking_code')
        if (tracking === 'TRK-2026-622') {
          ghostExcluded = true
          console.log(
            '0042: Pedido fantasma TRK-2026-622 identificado e EXCLUÍDO do resequenciamento viário.',
          )
          continue
        }
        validOrders.push(ord)
      }

      console.log('0042: Pedidos válidos para resequenciamento viário:', validOrders.length)

      if (validOrders.length === 0) {
        console.log('0042: Nenhum pedido ativo válido para resequenciar.')
        return
      }

      // Helper: Haversine distance in meters
      var haversineMeters = function (lat1, lon1, lat2, lon2) {
        var R = 6371e3
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

      // Helper: Normalização de logradouro
      var normStreet = function (addr) {
        if (!addr) return ''
        var s = ('' + addr).toLowerCase()
        s = s.replace(/,\s*n[º°o]?\s*\d+.*/i, '')
        s = s.replace(/,\s*\d+.*/i, '')
        s = s.replace(/\s+lt\s+\d+.*/i, '')
        s = s.replace(/\s+qd\s+[\w\d]+.*/i, '')
        s = s.replace(/^(rua|av\.|avenida|travessa|alameda|estrada|rodovia|praça)\s+/i, '')
        return s.trim()
      }

      var sameStreet = function (addr1, addr2) {
        var n1 = normStreet(addr1)
        var n2 = normStreet(addr2)
        if (!n1 || !n2 || n1.length < 3 || n2.length < 3) return false
        return n1 === n2 || n1.indexOf(n2) !== -1 || n2.indexOf(n1) !== -1
      }

      // Montar candidatos com coordenadas reais dos clientes
      var candidates = []
      for (var v = 0; v < validOrders.length; v++) {
        var oRecord = validOrders[v]
        var custId = oRecord.getString('customer_id')
        var stopLat = oRecord.get('end_address_lat')
        var stopLng = oRecord.get('end_address_lng')
        var stopAddr = oRecord.getString('end_address_text')
        var stopName = oRecord.getString('end_address_name')

        // Se o pedido não tem coordenada válida ou herdou da base, buscar no cliente
        var needsCustomerLookup =
          !stopLat ||
          !stopLng ||
          stopLat === 0 ||
          stopLng === 0 ||
          (Math.abs(stopLat - baseLat) < 0.0001 && Math.abs(stopLng - baseLng) < 0.0001)

        if (needsCustomerLookup && custId) {
          try {
            var custRec = app.findFirstRecordByData('customers', 'id', custId)
            var cLat = custRec.get('lat')
            var cLng = custRec.get('lng')
            if (cLat && cLng && cLat !== 0 && cLng !== 0) {
              stopLat = cLat
              stopLng = cLng
              if (!stopAddr) stopAddr = custRec.getString('address')
              if (!stopName) stopName = custRec.getString('name')
            }
          } catch (eCustFind) {
            // Cliente sem registro individual
          }
        }

        candidates.push({
          record: oRecord,
          id: oRecord.id,
          tracking: oRecord.getString('tracking_code'),
          lat: Number(stopLat || baseLat),
          lng: Number(stopLng || baseLng),
          address: stopAddr || '',
          name: stopName || '',
          priority: oRecord.getString('priority') || 'normal',
        })
      }

      // 5. Motor de Sequenciamento Determinístico (Nearest Neighbor + Bônus de Mesma Rua + 2-Opt)
      var unvisited = candidates.slice()
      var ordered = []
      var curLat = baseLat
      var curLng = baseLng
      var lastAddress = ''

      while (unvisited.length > 0) {
        var bestIdx = -1
        var bestScore = 999999999

        for (var u = 0; u < unvisited.length; u++) {
          var cand = unvisited[u]
          var dist = haversineMeters(curLat, curLng, cand.lat, cand.lng)

          var priorityMult = 1.0
          if (cand.priority === 'urgent') priorityMult = 0.4
          else if (cand.priority === 'high') priorityMult = 0.7

          var sameStreetBonus = 1.0
          if (lastAddress && sameStreet(lastAddress, cand.address)) {
            if (dist <= 1500) {
              sameStreetBonus = 0.15
            }
          }
          if (dist <= 150) {
            sameStreetBonus = Math.min(sameStreetBonus, 0.2)
          }

          var score = dist * priorityMult * sameStreetBonus
          if (score < bestScore) {
            bestScore = score
            bestIdx = u
          }
        }

        if (bestIdx >= 0) {
          var chosen = unvisited.splice(bestIdx, 1)[0]
          ordered.push(chosen)
          curLat = chosen.lat
          curLng = chosen.lng
          lastAddress = chosen.address
        } else {
          break
        }
      }

      // Refinamento Local 2-Opt
      var evalTourCost = function (tour) {
        var total = 0
        var pLat = baseLat
        var pLng = baseLng
        for (var t = 0; t < tour.length; t++) {
          total += haversineMeters(pLat, pLng, tour[t].lat, tour[t].lng)
          pLat = tour[t].lat
          pLng = tour[t].lng
        }
        total += haversineMeters(pLat, pLng, baseLat, baseLng)
        return total
      }

      if (ordered.length >= 4) {
        var currentCost = evalTourCost(ordered)
        var improved = true
        var iters = 0
        while (improved && iters < 40) {
          improved = false
          iters++
          for (var iOpt = 0; iOpt < ordered.length - 1; iOpt++) {
            for (var kOpt = iOpt + 1; kOpt < ordered.length; kOpt++) {
              var a1 = ordered[iOpt]
              var a2 = ordered[iOpt + 1]
              if (sameStreet(a1.address, a2.address)) {
                var dSame = haversineMeters(a1.lat, a1.lng, a2.lat, a2.lng)
                if (dSame < 500 && kOpt === iOpt + 1) continue
              }

              // Testar inversão
              var candidateTour = ordered
                .slice(0, iOpt)
                .concat(ordered.slice(iOpt, kOpt + 1).reverse())
                .concat(ordered.slice(kOpt + 1))

              var candCost = evalTourCost(candidateTour)
              if (candCost < currentCost - 10) {
                ordered = candidateTour
                currentCost = candCost
                improved = true
                break
              }
            }
            if (improved) break
          }
        }
      }

      // Consolidar adjacência de mesma rua (Same-Street Cohesion)
      if (ordered.length > 2) {
        var consolidated = []
        var usedIds = {}
        for (var cIdx = 0; cIdx < ordered.length; cIdx++) {
          var curr = ordered[cIdx]
          if (usedIds[curr.id]) continue
          consolidated.push(curr)
          usedIds[curr.id] = true

          for (var pIdx = cIdx + 1; pIdx < ordered.length; pIdx++) {
            var peer = ordered[pIdx]
            if (usedIds[peer.id]) continue
            if (sameStreet(curr.address, peer.address)) {
              var dPeer = haversineMeters(curr.lat, curr.lng, peer.lat, peer.lng)
              if (dPeer < 1500) {
                consolidated.push(peer)
                usedIds[peer.id] = true
              }
            }
          }
        }
        ordered = consolidated
      }

      // 6. Recalcular métricas viárias reais da rota sequenciada
      var curLegLat = baseLat
      var curLegLng = baseLng
      var outboundMeters = 0
      var legDetails = []

      for (var seqIdx = 0; seqIdx < ordered.length; seqIdx++) {
        var stop = ordered[seqIdx]
        var directM = haversineMeters(curLegLat, curLegLng, stop.lat, stop.lng)
        var isSame = seqIdx > 0 ? sameStreet(ordered[seqIdx - 1].address, stop.address) : false
        var streetFactor = isSame ? 1.05 : 1.28
        var stepMeters = Math.round(directM * streetFactor)
        if (stepMeters < 300 && directM > 50) stepMeters = 300 // mínimo urbano
        outboundMeters += stepMeters

        var stepDurationSec = Math.round((stepMeters / 1000) * 160 + 300) // ~22 km/h + 5 min parada

        legDetails.push({
          stop: stop,
          sequence: seqIdx + 1,
          stepMeters: stepMeters,
          stepKm: Number((stepMeters / 1000).toFixed(2)),
          durationMin: Math.max(5, Math.round(stepDurationSec / 60)),
        })

        curLegLat = stop.lat
        curLegLng = stop.lng
      }

      // Trecho de retorno da última parada à base
      var lastCand = ordered[ordered.length - 1]
      var directReturnM = haversineMeters(lastCand.lat, lastCand.lng, baseLat, baseLng)
      var returnMeters = Math.round(directReturnM * 1.28)
      var returnTripKm = Number((returnMeters / 1000).toFixed(2))

      var outboundKm = Number((outboundMeters / 1000).toFixed(2))
      var totalRouteKm = Number((outboundKm + returnTripKm).toFixed(2))
      var totalDurationMinutes = Math.round((totalRouteKm / 22) * 60 + ordered.length * 5)
      var totalRouteFuelCost = Number(((totalRouteKm * pricePerLiter) / consumptionKml).toFixed(2))

      console.log(
        '0042: Nova Rota Otimizada - Total:',
        totalRouteKm,
        'km (Ida:',
        outboundKm,
        'km, Retorno:',
        returnTripKm,
        'km). Paradas:',
        ordered.length,
      )
      console.log(
        '0042: Custo Estimado de Combustível:',
        totalRouteFuelCost,
        'Duração Estimada:',
        totalDurationMinutes,
        'min.',
      )

      // 7. Atualizar cada pedido com os dados de cabeçalho e linha viária
      var nowIso = new Date().toISOString()
      var cumulativeArrivalMins = 0

      for (var k = 0; k < legDetails.length; k++) {
        var leg = legDetails[k]
        var rec = leg.stop.record

        cumulativeArrivalMins += leg.durationMin
        var etaDate = new Date(Date.now() + cumulativeArrivalMins * 60 * 1000).toISOString()

        rec.set('sequence', leg.sequence)
        rec.set('distance_km', leg.stepKm > 0 ? leg.stepKm : 0.8)
        rec.set('estimated_duration_minutes', leg.durationMin)
        rec.set('estimated_arrival', etaDate)

        // Custo de combustível da parada (proporcional à sua perna)
        var legFuelCost = Number(((leg.stepKm * pricePerLiter) / consumptionKml).toFixed(2))
        rec.set('fuel_cost', legFuelCost)

        // Metadados de cabeçalho da rota compartilhados entre as linhas da rota ativa
        rec.set('start_base_name', baseName)
        rec.set('start_base_address', baseAddress)
        rec.set('start_base_lat', baseLat)
        rec.set('start_base_lng', baseLng)

        rec.set('end_address_name', leg.stop.name)
        rec.set('end_address_text', leg.stop.address)
        rec.set('end_address_lat', leg.stop.lat)
        rec.set('end_address_lng', leg.stop.lng)

        rec.set('return_trip_km', returnTripKm)
        rec.set('total_route_with_return_km', totalRouteKm)
        rec.set('total_route_fuel_cost', totalRouteFuelCost)

        // Assegurar status e liberação na rota ativa
        rec.set('route_released', true)
        if (!rec.getString('route_released_at')) {
          rec.set('route_released_at', nowIso)
        }
        rec.set('route_started', true)
        if (!rec.getString('route_started_at')) {
          rec.set('route_started_at', nowIso)
        }
        rec.set('status', 'in_transit')

        app.save(rec)

        console.log(
          '0042: Parada #' +
            leg.sequence +
            ' [' +
            leg.stop.tracking +
            '] ' +
            leg.stop.name +
            ' | Dist: ' +
            leg.stepKm +
            'km | Coords: ' +
            leg.stop.lat +
            ', ' +
            leg.stop.lng,
        )
      }

      console.log('0042: Resequenciamento viário da rota do Guilherme concluído com sucesso!')
      if (ghostExcluded) {
        console.log(
          '0042: CONFIRMAÇÃO: Pedido fantasma TRK-2026-622 foi PRESERVADO e mantido fora do cálculo viário.',
        )
      }
    } catch (eGlobal) {
      console.log('0042: Erro fatal ao executar migração 0042:', eGlobal)
      throw eGlobal
    }
  },
  (app) => {
    // Reversão no-op idempotente
  },
)
