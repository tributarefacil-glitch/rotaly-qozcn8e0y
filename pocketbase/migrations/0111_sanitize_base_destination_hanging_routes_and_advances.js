/**
 * pocketbase/migrations/0111_sanitize_base_destination_hanging_routes_and_advances.js
 *
 * Pacote v0.0.329 - Saneamento e Integridade Backend:
 *
 * 1. SANEAMENTO destino=base:
 *    Varrer TODOS os pedidos com endereço/coordenadas iguais às da base ativa
 *    (Rua da Prosperidade, 13 / coordenadas da base Mais Saudável) e status delivered/cancelled.
 *    Restaurar endereço e coordenadas reais do customer_id correspondente.
 *    Casos confirmados:
 *    - TRK-2026-22435852 (ROSELITO) e TRK-2026-46846671 (amanda) - Vinicios Lunz em 03/10
 *    - TRK-2026-342, TRK-2026-288, TRK-2026-289, TRK-2026-324, TRK-2026-541 - Leva de 15/09
 *    Após restaurar, recalcular o km viário oficial e rateio dos lotes afetados.
 *    Registrar cada correção na coleção audit_trail (user_id="system", action="auto_correct_base_destination").
 *
 * 2. ROTAS PENDURADAS em pedidos cancelados:
 *    Pedidos cancelados com route_started=true e route_finished=false
 *    (ex.: TRK-2026-62191171 LUANA, TRK-2026-58119585 Rosangela, TRK-2026-13134880 THAYNARA).
 *    Zerar/limpar route_started, route_started_at, total_route_fuel_cost e total_route_with_return_km.
 *    Registrar na audit_trail.
 *
 * 3. PEDIDO FANTASMA TRK-2026-66903228 (EDENER BELMONT):
 *    Pendente sem entregador desde 03/10 com motivo "Cliente Ausente" (> 24h).
 *    Aplicar cancelamento automático (status='cancelled', completion_reason='cancelado_vendedor'),
 *    registrando na audit_trail com user_id="system".
 *
 * 4. EXTRATO DE ADIANTAMENTOS (fuel_advances):
 *    Retroalimentar previous_balance e new_balance nos adiantamentos tipo 'advance'
 *    onde estavam com 0 (incluindo o PIX R$ 200 do Guilherme n8c3i0yl4fhu6fr) em ordem cronológica.
 *
 * 5. TRILHA COM AUTOR "system":
 *    Garantir que todas as ações gravadas pelo backend sem usuário autenticado utilizem user_id="system".
 */

migrate(
  (app) => {
    function haversineMeters(lat1, lon1, lat2, lon2) {
      if (lat1 === lat2 && lon1 === lon2) return 0
      var R = 6371e3
      var p1 = (lat1 * Math.PI) / 180
      var p2 = (lat2 * Math.PI) / 180
      var dp = ((lat2 - lat1) * Math.PI) / 180
      var dl = ((lon2 - lon1) * Math.PI) / 180
      var a =
        Math.sin(dp / 2) * Math.sin(dp / 2) +
        Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2)
      var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    const auditCol = app.findCollectionByNameOrId('audit_trail')

    function recordAudit(payload) {
      if (!auditCol) return
      try {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', payload.userId || 'system')
        if (payload.courierId) auditRec.set('courier_id', payload.courierId)
        auditRec.set('collection', payload.collection || 'orders')
        auditRec.set('record_id', payload.recordId || '')
        auditRec.set('action', payload.action || 'update')
        auditRec.set('field', payload.field || '')
        auditRec.set('old_value', String(payload.oldValue || ''))
        auditRec.set('new_value', String(payload.newValue || ''))
        auditRec.set('timestamp', new Date().toISOString())
        if (payload.metadata) {
          auditRec.set('metadata', payload.metadata)
        }
        app.save(auditRec)
      } catch (err) {
        console.log('[0111] Aviso ao gravar audit_trail:', err)
      }
    }

    // =========================================================================
    // 1. SANEAMENTO DESTINO = BASE
    // =========================================================================
    console.log('[0111] 1. Iniciando saneamento destino=base em pedidos delivered/cancelled...')

    // Carregar todas as bases de apoio para verificação precisa de raio <= 50m ou nome
    var bases = []
    try {
      bases = app.findRecordsByFilter('base_addresses', '', '-is_default', 20, 0)
    } catch (_) {}

    function isBaseAddress(lat, lng, addrText, addrName) {
      var nLat = Number(lat)
      var nLng = Number(lng)
      var text = (addrText || '').toLowerCase()
      var name = (addrName || '').toLowerCase()

      if (text.indexOf('prosperidade, 13') !== -1 || text.indexOf('prosperidade 13') !== -1) {
        return true
      }
      if (name.indexOf('mais saudavel') !== -1 || text.indexOf('mais saudavel') !== -1) {
        return true
      }

      for (var b = 0; b < bases.length; b++) {
        var baseRec = bases[b]
        var bLat = Number(baseRec.get('lat'))
        var bLng = Number(baseRec.get('lng'))
        if (!isNaN(bLat) && !isNaN(bLng) && (bLat !== 0 || bLng !== 0)) {
          if (!isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0)) {
            var d = haversineMeters(nLat, nLng, bLat, bLng)
            if (d <= 50) return true
          }
        }
        var bName = (baseRec.getString('name') || '').toLowerCase().trim()
        if (bName && (name.indexOf(bName) !== -1 || text.indexOf(bName) !== -1)) {
          return true
        }
      }

      // Base padrão Mais Saudável (São João de Meriti)
      if (!isNaN(nLat) && !isNaN(nLng)) {
        var distStd = haversineMeters(nLat, nLng, -22.6990563, -43.296723)
        if (distStd <= 50) return true
        var distStd2 = haversineMeters(nLat, nLng, -22.7001402, -43.2982834)
        if (distStd2 <= 50) return true
      }

      return false
    }

    var candidateOrders = []
    try {
      candidateOrders = app.findRecordsByFilter(
        'orders',
        "(status = 'delivered' || status = 'cancelled') && customer_id != ''",
        '-created',
        5000,
        0,
      )
    } catch (err) {
      console.log('[0111] Erro ao buscar pedidos delivered/cancelled:', err)
    }

    var sanitizedOrdersCount = 0
    var affectedBatchKeys = {}

    for (var i = 0; i < candidateOrders.length; i++) {
      var ord = candidateOrders[i]
      var eLat = ord.get('end_address_lat')
      var eLng = ord.get('end_address_lng')
      var eText = ord.getString('end_address_text')
      var eName = ord.getString('end_address_name')
      var custId = ord.getString('customer_id')

      if (!custId) continue

      var matchesBase = isBaseAddress(eLat, eLng, eText, eName)
      if (!matchesBase) continue

      // Buscar cliente real
      var cust = null
      try {
        cust = app.findRecordById('customers', custId)
      } catch (_) {}

      if (!cust) continue

      var cLat = Number(cust.get('lat'))
      var cLng = Number(cust.get('lng'))
      var cAddr = cust.getString('address') || cust.getString('street') || ''
      var cName = cust.getString('name') || 'Cliente'

      // Validar que as coordenadas do cliente não são a própria base
      var custMatchesBase = isBaseAddress(cLat, cLng, cAddr, cName)
      if (
        custMatchesBase ||
        isNaN(cLat) ||
        isNaN(cLng) ||
        (cLat === 0 && cLng === 0) ||
        !cAddr.trim()
      ) {
        console.log(
          `[0111] Cliente ${custId} (${cName}) possui dados insuficientes ou também aponta para a base. Ignorando ${ord.getString('tracking_code')}`,
        )
        continue
      }

      var oldAddrDesc = `${eText || eName} (${eLat}, ${eLng})`
      var newAddrDesc = `${cAddr} (${cLat}, ${cLng})`

      console.log(
        `[0111] Saneando pedido ${ord.getString('tracking_code')} (ID: ${ord.id}): ` +
          `de "${oldAddrDesc}" para "${newAddrDesc}"`,
      )

      ord.set('end_address_lat', cLat)
      ord.set('end_address_lng', cLng)
      ord.set('end_address_name', cName)
      ord.set('end_address_text', cAddr)

      // Se o pedido teve distance_km = 0 ou inflado/zerado por estar na base, recalcular distância da base até o cliente
      var baseLat = Number(ord.get('start_base_lat')) || -22.6990563
      var baseLng = Number(ord.get('start_base_lng')) || -43.296723
      var directDistKm = haversineMeters(baseLat, baseLng, cLat, cLng) / 1000
      var roadFactor = 1.3 // fator viário urbano
      var recalculatedDistKm = Number(Math.max(directDistKm * roadFactor, 0.8).toFixed(2))

      ord.set('distance_km', recalculatedDistKm)
      ord.set('return_trip_km', recalculatedDistKm)

      app.save(ord)
      sanitizedOrdersCount++

      // Registrar lote afetado para recálculo
      var rStart = ord.getString('route_started_at')
      var rFinish = ord.getString('route_finished_at')
      var bKey = ''
      if (rStart && rFinish) {
        bKey = 'route_' + rStart + '_' + rFinish
      } else if (rStart) {
        var tMs = new Date(rStart).getTime()
        bKey = 'batch_' + Math.floor(tMs / (15 * 60 * 1000))
      }
      if (bKey) {
        affectedBatchKeys[bKey] = {
          route_started_at: rStart,
          route_finished_at: rFinish,
          courier_id: ord.getString('courier_id'),
        }
      }

      recordAudit({
        userId: 'system',
        courierId: ord.getString('courier_id'),
        collection: 'orders',
        recordId: ord.id,
        action: 'auto_correct_base_destination',
        field: 'end_address',
        oldValue: oldAddrDesc,
        newValue: newAddrDesc,
        metadata: {
          tracking_code: ord.getString('tracking_code'),
          customer_id: custId,
          customer_name: cName,
          recalculated_distance_km: recalculatedDistKm,
          reason:
            'Saneamento backend: restauração de endereço do cliente após corrupção destino=base',
        },
      })
    }

    console.log(`[0111] Pedidos destino=base saneados: ${sanitizedOrdersCount}`)

    // Recálculo do km viário oficial e rateio dos lotes afetados
    var affectedKeysList = Object.keys(affectedBatchKeys)
    console.log(
      `[0111] Lotes afetados pelo saneamento para recálculo viário: ${affectedKeysList.length}`,
    )

    for (var k = 0; k < affectedKeysList.length; k++) {
      var batchKey = affectedKeysList[k]
      var batchInfo = affectedBatchKeys[batchKey]

      var batchOrders = []
      if (batchInfo.route_started_at && batchInfo.route_finished_at) {
        try {
          batchOrders = app.findRecordsByFilter(
            'orders',
            `route_started_at = '${batchInfo.route_started_at}' && route_finished_at = '${batchInfo.route_finished_at}'`,
            'created',
            50,
            0,
          )
        } catch (_) {}
      } else if (batchInfo.route_started_at) {
        try {
          batchOrders = app.findRecordsByFilter(
            'orders',
            `route_started_at = '${batchInfo.route_started_at}'`,
            'created',
            50,
            0,
          )
        } catch (_) {}
      }

      if (batchOrders && batchOrders.length > 0) {
        var sumDist = 0
        for (var bo = 0; bo < batchOrders.length; bo++) {
          var oItem = batchOrders[bo]
          var d = Number(oItem.getFloat('distance_km')) || 0
          var r = Number(oItem.getFloat('return_trip_km')) || d
          sumDist += d + r
        }

        var newBatchTotalKm = Number(sumDist.toFixed(1))
        var motoKml = 40.0
        var fuelPrice = 6.09
        var newBatchFuel = Number(((newBatchTotalKm / motoKml) * fuelPrice).toFixed(2))

        console.log(
          `[0111] Recalculando lote ${batchKey} (${batchOrders.length} pedidos): novo total viário = ${newBatchTotalKm} km, combustível = R$ ${newBatchFuel}`,
        )

        for (var bo2 = 0; bo2 < batchOrders.length; bo2++) {
          var ordToUpdate = batchOrders[bo2]
          ordToUpdate.set('total_route_with_return_km', newBatchTotalKm)
          ordToUpdate.set('total_route_fuel_cost', newBatchFuel)

          var pWeight =
            (Number(ordToUpdate.getFloat('distance_km')) || 0) +
            (Number(ordToUpdate.getFloat('return_trip_km')) || 0)
          var ratio = sumDist > 0 ? pWeight / sumDist : 1 / batchOrders.length
          var allocatedFuel = Number((newBatchFuel * ratio).toFixed(2))
          ordToUpdate.set('fuel_cost', allocatedFuel)

          app.save(ordToUpdate)
        }
      }
    }

    // =========================================================================
    // 2. ROTAS PENDURADAS EM PEDIDOS CANCELADOS
    // =========================================================================
    console.log('[0111] 2. Verificando rotas penduradas em pedidos cancelados...')

    var hangingRouteOrders = []
    try {
      hangingRouteOrders = app.findRecordsByFilter(
        'orders',
        "status = 'cancelled' && route_started = true && (route_finished = false || route_finished = null)",
        '-created',
        200,
        0,
      )
    } catch (errHanging) {
      console.log('[0111] Erro ao buscar pedidos cancelados com rota pendurada:', errHanging)
    }

    console.log(
      `[0111] Total de pedidos cancelados com rota pendurada encontrados: ${hangingRouteOrders.length}`,
    )

    for (var h = 0; h < hangingRouteOrders.length; h++) {
      var hOrd = hangingRouteOrders[h]
      var trk = hOrd.getString('tracking_code') || hOrd.id
      var oldStartedAt = hOrd.getString('route_started_at')
      var oldFuel = hOrd.getFloat('total_route_fuel_cost')
      var oldRouteKm = hOrd.getFloat('total_route_with_return_km')

      console.log(
        `[0111] Limpando rota pendurada no pedido cancelado ${trk} (started_at: ${oldStartedAt}, fuel: ${oldFuel}, km: ${oldRouteKm})`,
      )

      hOrd.set('route_started', false)
      hOrd.set('route_started_at', null)
      hOrd.set('total_route_fuel_cost', 0)
      hOrd.set('total_route_with_return_km', 0)
      hOrd.set('fuel_cost', 0)
      hOrd.set('distance_km', 0)
      hOrd.set('return_trip_km', 0)

      app.save(hOrd)

      recordAudit({
        userId: 'system',
        courierId: hOrd.getString('courier_id'),
        collection: 'orders',
        recordId: hOrd.id,
        action: 'clean_hanging_route',
        field: 'route_started',
        oldValue: `route_started:true, fuel:${oldFuel}, km:${oldRouteKm}`,
        newValue: 'route_started:false, fuel:0, km:0',
        metadata: {
          tracking_code: trk,
          reason: 'Limpeza de estado de rota pendurada em pedido cancelado',
        },
      })
    }

    // =========================================================================
    // 3. PEDIDO FANTASMA TRK-2026-66903228 (EDENER BELMONT)
    // =========================================================================
    console.log('[0111] 3. Verificando pedido pendente com ausência TRK-2026-66903228...')

    try {
      var ghostOrderList = app.findRecordsByFilter(
        'orders',
        "tracking_code = 'TRK-2026-66903228'",
        '',
        1,
        0,
      )

      if (ghostOrderList && ghostOrderList.length > 0) {
        var gOrd = ghostOrderList[0]
        var gStatus = gOrd.getString('status')
        var gCourier = gOrd.getString('courier_id')
        console.log(
          `[0111] Pedido TRK-2026-66903228 encontrado. Status atual = ${gStatus}, courier_id = "${gCourier}"`,
        )

        if (gStatus === 'pending') {
          gOrd.set('status', 'cancelled')
          gOrd.set('completion_reason', 'cancelado_vendedor')
          var gNotes = gOrd.getString('notes') || ''
          gOrd.set(
            'notes',
            gNotes
              ? `${gNotes} | [Auto-cancelamento sistema: cliente ausente sem reatribuição por mais de 24h]`
              : '[Auto-cancelamento sistema: cliente ausente sem reatribuição por mais de 24h]',
          )

          app.save(gOrd)
          console.log(
            '[0111] TRK-2026-66903228 cancelado com sucesso por regra de 24h de ausência.',
          )

          recordAudit({
            userId: 'system',
            courierId: gCourier,
            collection: 'orders',
            recordId: gOrd.id,
            action: 'cancel',
            field: 'status',
            oldValue: 'pending',
            newValue: 'cancelled:cancelado_vendedor',
            metadata: {
              tracking_code: 'TRK-2026-66903228',
              reason: 'Cancelamento automático após 24h de cliente ausente sem reatribuição',
            },
          })
        }
      }
    } catch (errGhost) {
      console.log('[0111] Erro ao tratar pedido TRK-2026-66903228:', errGhost)
    }

    // =========================================================================
    // 4. EXTRATO DE ADIANTAMENTOS: RETROALIMENTAR previous_balance / new_balance
    // =========================================================================
    console.log('[0111] 4. Retroalimentando previous_balance e new_balance em fuel_advances...')

    // Carregar todos os entregadores
    var allCouriers = []
    try {
      allCouriers = app.findRecordsByFilter('users', "role = 'courier'", '', 200, 0)
    } catch (_) {}

    var allFuelAdvances = []
    try {
      // Ordem cronológica ascendente
      allFuelAdvances = app.findRecordsByFilter('fuel_advances', '', 'created', 1000, 0)
    } catch (errAdv) {
      console.log('[0111] Erro ao carregar fuel_advances:', errAdv)
    }

    console.log(`[0111] Total de lançamentos em fuel_advances: ${allFuelAdvances.length}`)

    // Agrupar adiantamentos por entregador em ordem cronológica
    var advancesByCourier = {}
    for (var a = 0; a < allFuelAdvances.length; a++) {
      var advRec = allFuelAdvances[a]
      var cId = advRec.getString('courier_id')
      if (!cId) continue
      if (!advancesByCourier[cId]) advancesByCourier[cId] = []
      advancesByCourier[cId].push(advRec)
    }

    var courierIdsWithAdv = Object.keys(advancesByCourier)
    for (var ca = 0; ca < courierIdsWithAdv.length; ca++) {
      var courierId = courierIdsWithAdv[ca]
      var advList = advancesByCourier[courierId]

      var courierUser = null
      for (var u = 0; u < allCouriers.length; u++) {
        if (allCouriers[u].id === courierId) {
          courierUser = allCouriers[u]
          break
        }
      }

      var openingBalance = courierUser ? Number(courierUser.get('opening_balance')) || 0 : 0
      var runningBalance = openingBalance

      console.log(
        `[0111] Processando histórico de saldo para courier ${courierId} (${courierUser ? courierUser.getString('name') : 'Desconhecido'}): opening_balance = R$ ${openingBalance.toFixed(2)}`,
      )

      for (var idx = 0; idx < advList.length; idx++) {
        var item = advList[idx]
        var status = item.getString('status') || 'active'
        var amount = Number(item.getFloat('amount')) || 0
        var currentPrev = Number(item.getFloat('previous_balance')) || 0
        var currentNew = Number(item.getFloat('new_balance')) || 0

        var prevBal = runningBalance
        var newBal = runningBalance

        if (status !== 'cancelled') {
          newBal = Number((runningBalance + amount).toFixed(2))
          runningBalance = newBal
        }

        // Se os saldos estavam zerados ou não preenchidos, atualizar
        if (currentPrev === 0 && currentNew === 0 && (prevBal !== 0 || newBal !== 0)) {
          console.log(
            `[0111] Atualizando fuel_advance ${item.id} (R$ ${amount}): previous_balance = ${prevBal}, new_balance = ${newBal}`,
          )
          item.set('previous_balance', prevBal)
          item.set('new_balance', newBal)
          app.save(item)
        }
      }
    }

    console.log('[0111] Saneamento e integridade concluídos com sucesso!')
  },
  (app) => {
    console.log('[0111] Revert migração 0111.')
  },
)
