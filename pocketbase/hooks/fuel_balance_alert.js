/**
 * pocketbase/hooks/fuel_balance_alert.js
 *
 * Motor oficial de apuração de combustível e alertas de saldo da conta corrente do Rotaly.
 *
 * REGRAS OFICIAIS DE PRODUTO (PARIDADE TOTAL COM O CARD DO PAINEL / FRONTEND):
 * - KM oficial = Trajeto viário da rota planejada (`total_route_with_return_km`) contado UMA VEZ por LOTE de rota
 *   (ciclo Base -> paradas -> retorno à base);
 * - O combustível da rota é rateado pro-rata entre os pedidos do lote (com absorção de resíduo na última parada);
 * - Entregas conjuntas no mesmo cliente (janela <= 45 minutos no mesmo dia local): a 1ª parada (primária) mantém o KM/combustível;
 *   pedidos secundários têm KM=0 e combustível=0 (viagem já paga, deduplicação);
 * - Parâmetros de combustível (consumo km/l e preço/litro) obtidos das configurações atuais do sistema (`app_settings`),
 *   diferenciados por categoria de veículo (moto, carro/van, caminhão, bicicleta);
 * - NUNCA somar o campo `fuel_cost` individual bruto gravado nos pedidos;
 * - O cálculo dos meses fechados (histórico para média mensal) e meses passados (carry-over) utiliza rigorosamente
 *   este mesmo motor oficial;
 * - FÓRMULA OFICIAL DE CONTA CORRENTE:
 *   carryOverBalance = Adiantamentos Passados - Gastos Passados (meses anteriores)
 *   Saldo Atual = carryOverBalance + Adiantamentos Mês Corrente - Gasto Mês Corrente
 * - GATILHO DO ALERTA: Consumo do mês corrente >= 80% da média mensal do entregador (ou saldo restante <= 20% da média com consumo > 0);
 * - SUGESTÃO DE RECARGA: Média mensal - Consumo do mês, limitado ao teto da média mensal;
 * - FREQUÊNCIA: Máximo 1 alerta por entregador por dia (coleção `fuel_balance_alerts`);
 * - DESTINATÁRIOS:
 *   1. notifications_email da empresa
 *   2. admin membro ativo da empresa do entregador
 *   3. e-mail comercial da empresa
 *   4. primeiro admin/master do sistema
 *   5. fallback fixo: tributarefacil@gmail.com
 *
 * NOTA DE ARQUITETURA POCKETBASE (GOJA JSVM):
 * No runtime Goja do PocketBase, callbacks registrados em cronAdd e routerAdd rodam em pools isoladas.
 * Não são permitidas declarações de topo de arquivo (top-level functions/variables) acessadas dentro dos callbacks.
 * Toda a lógica de apuração deve residir inline dentro de cada callback.
 */

// 1. Cron Job Diário (08:00 AM) para verificação preventiva de saldo de combustível.
cronAdd('daily_fuel_balance_check', '0 8 * * *', () => {
  function formatCurrency(val) {
    var n = Number(val) || 0
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  function getBrazilDateString(d) {
    var dateObj = d || new Date()
    var utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    var spTime = new Date(utc - 3 * 3600000)
    var yyyy = spTime.getFullYear()
    var mm = String(spTime.getMonth() + 1).padStart(2, '0')
    var dd = String(spTime.getDate()).padStart(2, '0')
    return yyyy + '-' + mm + '-' + dd
  }

  function getYearMonthKey(dateStr) {
    if (!dateStr) return ''
    var s = String(dateStr).trim()
    if (s.length >= 7) {
      return s.substring(0, 7)
    }
    return ''
  }

  function parseSafeTimestamp(dateVal) {
    if (!dateVal) return 0
    try {
      if (typeof dateVal === 'number') {
        return isNaN(dateVal) ? 0 : dateVal
      }
      if (dateVal instanceof Date) {
        var t = dateVal.getTime()
        return isNaN(t) ? 0 : t
      }
      if (typeof dateVal === 'string') {
        var trimmed = dateVal.trim()
        if (!trimmed) return 0
        var normalized = trimmed.indexOf('T') !== -1 ? trimmed : trimmed.replace(' ', 'T')
        if (
          /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed) &&
          !trimmed.endsWith('Z') &&
          !/[+-]\d{2}:?\d{2}$/.test(trimmed)
        ) {
          normalized = normalized + 'Z'
        }
        var parsed = new Date(normalized).getTime()
        if (!isNaN(parsed)) return parsed
        var fallback = new Date(trimmed).getTime()
        return isNaN(fallback) ? 0 : fallback
      }
      return 0
    } catch (_) {
      return 0
    }
  }

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

  function loadFuelSettings() {
    var s = {
      pricePerLiter: 6.49,
      consumptionKml: 35.0,
      motoPrice: 6.49,
      motoKml: 35.0,
      carroPrice: 6.49,
      carroKml: 12.0,
      caminhaoPrice: 6.49,
      caminhaoKml: 7.0,
    }

    try {
      var recs = $app.findRecordsByFilter('app_settings', "key = 'global_settings'", '', 1, 0)
      if (recs && recs.length > 0) {
        var r = recs[0]
        var basePrice = Number(r.getFloat('fuel_price_per_liter')) || 6.49
        var baseKml = Number(r.getFloat('fuel_consumption_kml')) || 35.0

        var mPrice = Number(r.getFloat('moto_fuel_price')) || basePrice
        var mKml = Number(r.getFloat('moto_consumption_kml')) || baseKml

        var cPrice = Number(r.getFloat('carro_fuel_price')) || basePrice
        var cKml = Number(r.getFloat('carro_consumption_kml')) || 12.0

        var tPrice = Number(r.getFloat('caminhao_fuel_price')) || basePrice
        var tKml = Number(r.getFloat('caminhao_consumption_kml')) || 7.0

        s.pricePerLiter = mPrice
        s.consumptionKml = mKml
        s.motoPrice = mPrice
        s.motoKml = mKml
        s.carroPrice = cPrice
        s.carroKml = cKml
        s.caminhaoPrice = tPrice
        s.caminhaoKml = tKml
      }
    } catch (err) {
      console.log('[daily_fuel_balance_check] Aviso ao ler app_settings:', err)
    }

    return s
  }

  function getVehicleParams(vType, settings) {
    var v = (vType || 'moto').toLowerCase()
    if (v.indexOf('bicicleta') !== -1 || v.indexOf('bicycle') !== -1) {
      return { category: 'bicicleta', price: 0, kml: 0, isBike: true }
    }
    if (v.indexOf('carro') !== -1 || v.indexOf('van') !== -1) {
      return {
        category: 'carro',
        price: settings.carroPrice || settings.pricePerLiter,
        kml: settings.carroKml || 12.0,
        isBike: false,
      }
    }
    if (v.indexOf('caminhao') !== -1 || v.indexOf('truck') !== -1) {
      return {
        category: 'caminhao',
        price: settings.caminhaoPrice || settings.pricePerLiter,
        kml: settings.caminhaoKml || 7.0,
        isBike: false,
      }
    }
    return {
      category: 'moto',
      price: settings.motoPrice || settings.pricePerLiter,
      kml: settings.motoKml || settings.consumptionKml,
      isBike: false,
    }
  }

  function isCourierEligibleOrder(ord, courierId) {
    if (ord.getString('courier_id') !== courierId) return false
    var notes = (ord.getString('notes') || '').toLowerCase()
    if (notes.indexOf('erro de sistema') !== -1) return false
    if (ord.getString('completion_reason') === 'cancelado_vendedor') return false

    var baseLat = Number(ord.getFloat('start_base_lat')) || 0
    var baseLng = Number(ord.getFloat('start_base_lng')) || 0
    if (
      baseLat === 0 &&
      baseLng === 0 &&
      !ord.getString('start_base_name') &&
      !ord.getString('start_base_address')
    ) {
      return false
    }

    var status = ord.getString('status')
    if (status === 'delivered') return true
    if (status === 'address_error' || status === 'client_absent') return true
    return false
  }

  function buildJointDeliveryMetaMap(orders) {
    var metaMap = {}
    var JOINT_DELIVERY_WINDOW_MS = 45 * 60 * 1000

    var buckets = {}
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i]
      var cId = o.getString('courier_id')
      var custId = o.getString('customer_id')
      if (!cId) continue

      var effectiveCustomerKey = custId
      if (!effectiveCustomerKey) {
        var rawAddr = (o.getString('end_address_text') || o.getString('start_base_address') || o.id)
          .toLowerCase()
          .trim()
        effectiveCustomerKey = 'addr_' + rawAddr
      }

      var oDateVal =
        o.getString('actual_arrival') || o.getString('route_finished_at') || o.getString('created')
      var dayKey = getBrazilDateString(new Date(parseSafeTimestamp(oDateVal)))
      var bKey = cId + ':::' + effectiveCustomerKey + ':::' + dayKey

      if (!buckets[bKey]) buckets[bKey] = []
      buckets[bKey].push(o)
    }

    var bucketKeys = Object.keys(buckets)
    for (var b = 0; b < bucketKeys.length; b++) {
      var bOrders = buckets[bucketKeys[b]]
      if (bOrders.length < 2) continue

      bOrders.sort(function (a, bOrd) {
        var ta =
          parseSafeTimestamp(a.getString('actual_arrival')) ||
          parseSafeTimestamp(a.getString('route_finished_at')) ||
          parseSafeTimestamp(a.getString('created'))
        var tb =
          parseSafeTimestamp(bOrd.getString('actual_arrival')) ||
          parseSafeTimestamp(bOrd.getString('route_finished_at')) ||
          parseSafeTimestamp(bOrd.getString('created'))
        if (ta !== tb) return ta - tb
        return (
          parseSafeTimestamp(a.getString('created')) - parseSafeTimestamp(bOrd.getString('created'))
        )
      })

      var clusters = []
      var curCluster = [bOrders[0]]

      for (var j = 1; j < bOrders.length; j++) {
        var ord = bOrders[j]
        var prevOrd = curCluster[curCluster.length - 1]
        var tOrd =
          parseSafeTimestamp(ord.getString('actual_arrival')) ||
          parseSafeTimestamp(ord.getString('route_finished_at')) ||
          parseSafeTimestamp(ord.getString('created'))
        var tPrev =
          parseSafeTimestamp(prevOrd.getString('actual_arrival')) ||
          parseSafeTimestamp(prevOrd.getString('route_finished_at')) ||
          parseSafeTimestamp(prevOrd.getString('created'))

        if (Math.abs(tOrd - tPrev) <= JOINT_DELIVERY_WINDOW_MS) {
          curCluster.push(ord)
        } else {
          if (curCluster.length >= 2) {
            clusters.push(curCluster)
          }
          curCluster = [ord]
        }
      }
      if (curCluster.length >= 2) {
        clusters.push(curCluster)
      }

      for (var k = 0; k < clusters.length; k++) {
        var cluster = clusters[k]
        var primary = cluster[0]
        for (var ci = 0; ci < cluster.length; ci++) {
          var cOrd = cluster[ci]
          metaMap[cOrd.id] = {
            isJointDelivery: true,
            isJointPrimary: ci === 0,
            isJointSecondary: ci > 0,
            primaryId: primary.id,
          }
        }
      }
    }

    return metaMap
  }

  function computeOrderWeight(ord) {
    var baseLat = Number(ord.getFloat('start_base_lat')) || -22.7001402
    var baseLng = Number(ord.getFloat('start_base_lng')) || -43.2982834
    var endLat = Number(ord.getFloat('end_address_lat')) || 0
    var endLng = Number(ord.getFloat('end_address_lng')) || 0

    var roadDist = 0.8
    if (endLat !== 0 && endLng !== 0) {
      var directMeters = haversineMeters(baseLat, baseLng, endLat, endLng)
      roadDist = Math.max(directMeters / 1000, 0.8)
    }

    var dKm = Number(ord.getFloat('distance_km')) || 0
    if (dKm > 0) {
      roadDist = Math.max(roadDist, dKm)
    }

    var rKm = Number(ord.getFloat('return_trip_km')) || 0
    return Math.max(roadDist + rKm, 0.8)
  }

  function computeCourierFuelMetricsOfficial(courier, orders, currentYearMonth, settings) {
    var courierId = courier.id
    var vehicleType = courier.getString('vehicle_type') || 'moto'
    var vParams = getVehicleParams(vehicleType, settings)

    if (vParams.isBike) {
      return {
        currentMonthSpent: 0,
        currentMonthKm: 0,
        pastOrdersSpentTotal: 0,
        pastMonthSpentMap: {},
      }
    }

    var eligibleOrders = []
    for (var i = 0; i < orders.length; i++) {
      var ord = orders[i]
      if (isCourierEligibleOrder(ord, courierId)) {
        eligibleOrders.push(ord)
      }
    }

    if (eligibleOrders.length === 0) {
      return {
        currentMonthSpent: 0,
        currentMonthKm: 0,
        pastOrdersSpentTotal: 0,
        pastMonthSpentMap: {},
      }
    }

    var jointMetaMap = buildJointDeliveryMetaMap(eligibleOrders)

    var routeBatches = {}
    for (var oIdx = 0; oIdx < eligibleOrders.length; oIdx++) {
      var o = eligibleOrders[oIdx]
      var assignedKey = null
      var rStart = o.getString('route_started_at')
      var rFinish = o.getString('route_finished_at')

      if (rStart && rFinish) {
        assignedKey = 'route_' + rStart + '_' + rFinish
      } else if (rStart) {
        var oTime = parseSafeTimestamp(rStart)
        var batchKeys = Object.keys(routeBatches)
        for (var bk = 0; bk < batchKeys.length; bk++) {
          var exKey = batchKeys[bk]
          if (exKey.indexOf('batch_') === 0 && exKey.indexOf('batch_created_') === -1) {
            var bTime = Number(exKey.replace('batch_', '')) * (15 * 60 * 1000)
            if (Math.abs(oTime - bTime) <= 15 * 60 * 1000) {
              assignedKey = exKey
              break
            }
          }
        }
        if (!assignedKey) {
          assignedKey = 'batch_' + Math.floor(oTime / (15 * 60 * 1000))
        }
      } else {
        var cTime = parseSafeTimestamp(o.getString('created'))
        if (cTime > 0) {
          var batchKeysCreated = Object.keys(routeBatches)
          for (var bkc = 0; bkc < batchKeysCreated.length; bkc++) {
            var exKeyC = batchKeysCreated[bkc]
            if (exKeyC.indexOf('batch_created_') === 0) {
              var bTimeC = Number(exKeyC.replace('batch_created_', '')) * (15 * 60 * 1000)
              if (Math.abs(cTime - bTimeC) <= 15 * 60 * 1000) {
                assignedKey = exKeyC
                break
              }
            }
          }
          if (!assignedKey) {
            assignedKey = 'batch_created_' + Math.floor(cTime / (15 * 60 * 1000))
          }
        } else {
          assignedKey = 'single_' + o.id
        }
      }

      if (!routeBatches[assignedKey]) routeBatches[assignedKey] = []
      routeBatches[assignedKey].push(o)
    }

    var currentMonthSpent = 0
    var currentMonthKm = 0
    var pastOrdersSpentTotal = 0
    var pastMonthSpentMap = {}

    var batchKeysAll = Object.keys(routeBatches)
    for (var bIdx = 0; bIdx < batchKeysAll.length; bIdx++) {
      var bKey = batchKeysAll[bIdx]
      var batchOrders = routeBatches[bKey]
      var batchCount = batchOrders.length

      var maxRoadKmInBatch = 0
      for (var bi = 0; bi < batchCount; bi++) {
        var rKm = Number(batchOrders[bi].getFloat('total_route_with_return_km')) || 0
        if (rKm > maxRoadKmInBatch) maxRoadKmInBatch = rKm
      }

      var batchTotalOfficialKm = 0
      if (maxRoadKmInBatch > 0) {
        batchTotalOfficialKm = Number(maxRoadKmInBatch.toFixed(1))
      } else {
        var sumWeights = 0
        for (var swi = 0; swi < batchCount; swi++) {
          sumWeights += computeOrderWeight(batchOrders[swi])
        }
        batchTotalOfficialKm = Number(sumWeights.toFixed(1))
      }

      var batchTotalLiters =
        vParams.kml > 0 ? Number((batchTotalOfficialKm / vParams.kml).toFixed(2)) : 0
      var batchTotalFuelCost = Number((batchTotalLiters * vParams.price).toFixed(2))

      var totalBatchWeight = 0
      for (var wi = 0; wi < batchCount; wi++) {
        totalBatchWeight += computeOrderWeight(batchOrders[wi])
      }

      var allocatedKm = 0
      var allocatedFuel = 0

      for (var ordIdx = 0; ordIdx < batchCount; ordIdx++) {
        var currentOrder = batchOrders[ordIdx]
        var isLast = ordIdx === batchCount - 1
        var thisWeight = computeOrderWeight(currentOrder)
        var ratio = totalBatchWeight > 0 ? thisWeight / totalBatchWeight : 1 / batchCount

        var itemKm = 0
        var itemFuel = 0

        if (batchCount === 1) {
          itemKm = batchTotalOfficialKm
          itemFuel = batchTotalFuelCost
        } else if (isLast) {
          itemKm = Number(Math.max(0, batchTotalOfficialKm - allocatedKm).toFixed(1))
          itemFuel = Number(Math.max(0, batchTotalFuelCost - allocatedFuel).toFixed(2))
        } else {
          itemKm = Number((batchTotalOfficialKm * ratio).toFixed(1))
          var itemLiters = vParams.kml > 0 ? Number((itemKm / vParams.kml).toFixed(2)) : 0
          itemFuel = Number((itemLiters * vParams.price).toFixed(2))

          allocatedKm += itemKm
          allocatedFuel += itemFuel
        }

        var jMeta = jointMetaMap[currentOrder.id]
        if (jMeta && jMeta.isJointSecondary) {
          itemKm = 0
          itemFuel = 0
        }

        var orderDateVal =
          currentOrder.getString('route_finished_at') ||
          currentOrder.getString('actual_arrival') ||
          currentOrder.getString('created')
        var orderMonth = getYearMonthKey(orderDateVal)

        if (orderMonth === currentYearMonth) {
          currentMonthSpent += itemFuel
          currentMonthKm += itemKm
        } else if (orderMonth && orderMonth < currentYearMonth) {
          pastOrdersSpentTotal += itemFuel
          if (!pastMonthSpentMap[orderMonth]) {
            pastMonthSpentMap[orderMonth] = 0
          }
          pastMonthSpentMap[orderMonth] += itemFuel
        }
      }
    }

    currentMonthSpent = Number(currentMonthSpent.toFixed(2))
    currentMonthKm = Number(currentMonthKm.toFixed(1))
    pastOrdersSpentTotal = Number(pastOrdersSpentTotal.toFixed(2))

    var pMonths = Object.keys(pastMonthSpentMap)
    for (var pm = 0; pm < pMonths.length; pm++) {
      pastMonthSpentMap[pMonths[pm]] = Number(pastMonthSpentMap[pMonths[pm]].toFixed(2))
    }

    return {
      currentMonthSpent: currentMonthSpent,
      currentMonthKm: currentMonthKm,
      pastOrdersSpentTotal: pastOrdersSpentTotal,
      pastMonthSpentMap: pastMonthSpentMap,
    }
  }

  try {
    console.log(
      '[daily_fuel_balance_check] Iniciando verificação diária de saldo com motor oficial...',
    )
    var now = new Date()
    var todayStr = getBrazilDateString(now)
    var currentYearMonth = todayStr.substring(0, 7)

    var fuelSettings = loadFuelSettings()

    var couriers = []
    try {
      couriers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'courier' && status = 'active'",
        'name',
        200,
        0,
      )
    } catch (errCouriers) {
      console.log('[daily_fuel_balance_check] Erro ao buscar entregadores:', errCouriers)
      return
    }

    if (!couriers || couriers.length === 0) {
      console.log('[daily_fuel_balance_check] Nenhum entregador ativo encontrado.')
      return
    }

    var allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status != 'cancelled'",
        '-date,-created',
        5000,
        0,
      )
    } catch (errAdv) {
      console.log('[daily_fuel_balance_check] Erro ao buscar fuel_advances:', errAdv)
    }

    var allOrders = []
    try {
      allOrders = $app.findRecordsByFilter(
        'orders',
        "(status = 'delivered' || status = 'address_error' || status = 'client_absent') && completion_reason != 'cancelado_vendedor'",
        '-created',
        10000,
        0,
      )
    } catch (errOrd) {
      console.log('[daily_fuel_balance_check] Erro ao buscar orders:', errOrd)
    }

    var allMembros = []
    try {
      allMembros = $app.findRecordsByFilter('membros', 'ativo = true', '-created', 1000, 0)
    } catch (_) {}

    var allEmpresas = []
    try {
      allEmpresas = $app.findRecordsByFilter('empresas', 'id != ""', 'nome_fantasia', 100, 0)
    } catch (_) {}

    var adminUsers = []
    try {
      adminUsers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'admin' || role = 'master'",
        '-created',
        50,
        0,
      )
    } catch (_) {}

    var processedCount = 0
    var alertsSentCount = 0

    for (var c = 0; c < couriers.length; c++) {
      var courier = couriers[c]
      var courierId = courier.id
      var courierName = courier.getString('name') || courier.getString('email') || 'Entregador'
      var vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()

      if (vehicleType === 'bicicleta' || vehicleType === 'bicycle') {
        continue
      }

      processedCount++

      var existingTodayAlert = []
      try {
        existingTodayAlert = $app.findRecordsByFilter(
          'fuel_balance_alerts',
          `courier_id = '${courierId}' && alert_date = '${todayStr}' && status = 'sent'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (existingTodayAlert && existingTodayAlert.length > 0) {
        console.log(
          `[daily_fuel_balance_check] Alerta já enviado hoje para ${courierName}. Ignorando anti-spam.`,
        )
        continue
      }

      var courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)

      var metrics = computeCourierFuelMetricsOfficial(
        courier,
        allOrders,
        currentYearMonth,
        fuelSettings,
      )

      var currentMonthSpent = metrics.currentMonthSpent
      var pastOrdersSpentTotal = metrics.pastOrdersSpentTotal
      var pastMonthSpentMap = metrics.pastMonthSpentMap

      var currentMonthAdvances = 0
      var pastAdvancesTotal = 0

      for (var a = 0; a < courierAdvances.length; a++) {
        var adv = courierAdvances[a]
        var advDateVal = adv.getString('date') || adv.getString('created')
        var advMonth = getYearMonthKey(advDateVal)
        var advAmount = Number(adv.getFloat('amount')) || 0

        if (advMonth === currentYearMonth) {
          currentMonthAdvances += advAmount
        } else if (advMonth && advMonth < currentYearMonth) {
          pastAdvancesTotal += advAmount
        }
      }

      var carryOverBalance = Number((pastAdvancesTotal - pastOrdersSpentTotal).toFixed(2))
      var currentBalance = Number(
        (carryOverBalance + currentMonthAdvances - currentMonthSpent).toFixed(2),
      )

      var closedMonths = Object.keys(pastMonthSpentMap)
      var monthlyAverage = 0

      if (closedMonths.length > 0) {
        var sumPastSpent = 0
        for (var m = 0; m < closedMonths.length; m++) {
          sumPastSpent += pastMonthSpentMap[closedMonths[m]]
        }
        monthlyAverage = Number((sumPastSpent / closedMonths.length).toFixed(2))
      }

      if (monthlyAverage <= 0) {
        if (vehicleType.indexOf('caminhao') !== -1) {
          monthlyAverage = 1200.0
        } else if (vehicleType.indexOf('carro') !== -1 || vehicleType.indexOf('van') !== -1) {
          monthlyAverage = 800.0
        } else {
          monthlyAverage = 450.0
        }
        if (currentMonthSpent > monthlyAverage) {
          monthlyAverage = currentMonthSpent
        }
      }

      var threshold80 = Number((monthlyAverage * 0.8).toFixed(2))
      var reachedThreshold =
        currentMonthSpent >= threshold80 ||
        (currentBalance <= monthlyAverage * 0.2 && currentMonthSpent > 0)

      if (!reachedThreshold) {
        continue
      }

      var suggestedRecharge = monthlyAverage - currentMonthSpent
      if (suggestedRecharge > monthlyAverage) {
        suggestedRecharge = monthlyAverage
      }
      if (suggestedRecharge < 0) {
        suggestedRecharge = 0
      }
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))

      var empresaId = ''
      var empresaNome = 'Rotaly Logística'
      var notificationsEmail = ''
      var commercialEmail = ''

      var courierMembro = allMembros.find((mb) => mb.getString('user_id') === courierId)
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        var emp = allEmpresas.find((e) => e.id === empresaId)
        if (emp) {
          empresaNome =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || empresaNome
          notificationsEmail = (emp.getString('notifications_email') || '').trim()
          commercialEmail = (emp.getString('email') || '').trim()
        }
      }

      var targetAdminEmail = ''
      var targetAdminName = 'Administrador'

      if (notificationsEmail) {
        targetAdminEmail = notificationsEmail
        targetAdminName = empresaNome
      }

      if (!targetAdminEmail && empresaId) {
        var adminMembro = allMembros.find(
          (mb) => mb.getString('empresa_id') === empresaId && mb.getString('papel') === 'admin',
        )
        if (adminMembro) {
          var adminUser = adminUsers.find((u) => u.id === adminMembro.getString('user_id'))
          if (adminUser) {
            targetAdminEmail = (adminUser.getString('email') || '').trim()
            targetAdminName = adminUser.getString('name') || targetAdminName
          }
        }
      }

      if (!targetAdminEmail && commercialEmail) {
        targetAdminEmail = commercialEmail
        targetAdminName = empresaNome
      }

      if (!targetAdminEmail && adminUsers.length > 0) {
        targetAdminEmail = (adminUsers[0].getString('email') || '').trim()
        targetAdminName = adminUsers[0].getString('name') || targetAdminName
      }

      if (!targetAdminEmail) {
        targetAdminEmail = 'tributarefacil@gmail.com'
      }

      var senderAddress =
        ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
      var senderName =
        ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

      var htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
          <div style="background: linear-gradient(135deg, #002855, #004b99); padding: 28px; border-radius: 12px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">⛽ Alerta de Saldo de Combustível</h1>
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% da média mensal)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de consumo de combustível no mês corrente para a empresa <strong>${empresaNome}</strong>.
            </p>

            <div style="margin: 20px 0; padding: 16px; background-color: #f1f5f9; border-radius: 10px; border-left: 4px solid #f59e0b;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${courierName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Veículo:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; text-transform: uppercase;">${vehicleType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Atual:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: ${currentBalance < 0 ? '#dc2626' : '#059669'}; font-weight: 700;">${formatCurrency(currentBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Consumo Acumulado no Mês:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(currentMonthSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Mensal do Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(monthlyAverage)}</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga Recomendada</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <span style="display: block; font-size: 11px; color: #475569;">
                Calculada com base na média mensal (${formatCurrency(monthlyAverage)}) deduzindo o consumo acumulado (${formatCurrency(currentMonthSpent)}), sem ultrapassar o teto da média do entregador.
              </span>
            </div>

            <p style="font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0;">
              Acesse o painel do Rotaly para lançar o adiantamento de combustível ou realizar os ajustes necessários na conta corrente do entregador.
            </p>
          </div>

          <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
            Rotaly • Gestão Inteligente de Entregas &amp; Auditoria de Combustível<br />
            Este é um alerta automático gerado pelo sistema de verificação diária.
          </p>
        </div>
      `

      var sendStatus = 'sent'
      var sendError = ''

      try {
        var mailer = $app.newMailClient()
        mailer.send({
          from: {
            address: senderAddress,
            name: senderName,
          },
          to: [{ address: targetAdminEmail }],
          subject: `⛽ Alerta de Saldo de Combustível: ${courierName} (${formatCurrency(currentBalance)})`,
          html: htmlBody,
        })
        console.log(
          `[daily_fuel_balance_check] E-mail de alerta enviado para ${targetAdminEmail} sobre ${courierName}.`,
        )
        alertsSentCount++
      } catch (mailErr) {
        sendStatus = 'failed'
        sendError = String(mailErr)
        console.log(
          `[daily_fuel_balance_check] Falha ao enviar e-mail para ${targetAdminEmail}:`,
          mailErr,
        )
      }

      try {
        var alertsCol = $app.findCollectionByNameOrId('fuel_balance_alerts')
        var alertRec = new Record(alertsCol)
        alertRec.set('courier_id', courierId)
        if (empresaId) alertRec.set('empresa_id', empresaId)
        alertRec.set('alert_date', todayStr)
        alertRec.set('balance', currentBalance)
        alertRec.set('monthly_spent', currentMonthSpent)
        alertRec.set('monthly_average', monthlyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        if (sendError) alertRec.set('notes', sendError)
        $app.save(alertRec)
      } catch (saveErr) {
        console.log(
          '[daily_fuel_balance_check] Erro ao gravar registro em fuel_balance_alerts:',
          saveErr,
        )
      }
    }

    console.log(
      `[daily_fuel_balance_check] Verificação finalizada. Processados: ${processedCount}, Enviados: ${alertsSentCount}`,
    )
  } catch (errGlobal) {
    console.log('[daily_fuel_balance_check] Erro global no cron de combustível:', errGlobal)
  }
})

// 2. Endpoint HTTP administrativo para acionamento sob demanda por administradores.
// POST /backend/v1/fuel-balance/check-now
routerAdd('POST', '/backend/v1/fuel-balance/check-now', (c) => {
  function formatCurrency(val) {
    var n = Number(val) || 0
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  function getBrazilDateString(d) {
    var dateObj = d || new Date()
    var utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    var spTime = new Date(utc - 3 * 3600000)
    var yyyy = spTime.getFullYear()
    var mm = String(spTime.getMonth() + 1).padStart(2, '0')
    var dd = String(spTime.getDate()).padStart(2, '0')
    return yyyy + '-' + mm + '-' + dd
  }

  function getYearMonthKey(dateStr) {
    if (!dateStr) return ''
    var s = String(dateStr).trim()
    if (s.length >= 7) {
      return s.substring(0, 7)
    }
    return ''
  }

  function parseSafeTimestamp(dateVal) {
    if (!dateVal) return 0
    try {
      if (typeof dateVal === 'number') {
        return isNaN(dateVal) ? 0 : dateVal
      }
      if (dateVal instanceof Date) {
        var t = dateVal.getTime()
        return isNaN(t) ? 0 : t
      }
      if (typeof dateVal === 'string') {
        var trimmed = dateVal.trim()
        if (!trimmed) return 0
        var normalized = trimmed.indexOf('T') !== -1 ? trimmed : trimmed.replace(' ', 'T')
        if (
          /^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(trimmed) &&
          !trimmed.endsWith('Z') &&
          !/[+-]\d{2}:?\d{2}$/.test(trimmed)
        ) {
          normalized = normalized + 'Z'
        }
        var parsed = new Date(normalized).getTime()
        if (!isNaN(parsed)) return parsed
        var fallback = new Date(trimmed).getTime()
        return isNaN(fallback) ? 0 : fallback
      }
      return 0
    } catch (_) {
      return 0
    }
  }

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

  function loadFuelSettings() {
    var s = {
      pricePerLiter: 6.49,
      consumptionKml: 35.0,
      motoPrice: 6.49,
      motoKml: 35.0,
      carroPrice: 6.49,
      carroKml: 12.0,
      caminhaoPrice: 6.49,
      caminhaoKml: 7.0,
    }

    try {
      var recs = $app.findRecordsByFilter('app_settings', "key = 'global_settings'", '', 1, 0)
      if (recs && recs.length > 0) {
        var r = recs[0]
        var basePrice = Number(r.getFloat('fuel_price_per_liter')) || 6.49
        var baseKml = Number(r.getFloat('fuel_consumption_kml')) || 35.0

        var mPrice = Number(r.getFloat('moto_fuel_price')) || basePrice
        var mKml = Number(r.getFloat('moto_consumption_kml')) || baseKml

        var cPrice = Number(r.getFloat('carro_fuel_price')) || basePrice
        var cKml = Number(r.getFloat('carro_consumption_kml')) || 12.0

        var tPrice = Number(r.getFloat('caminhao_fuel_price')) || basePrice
        var tKml = Number(r.getFloat('caminhao_consumption_kml')) || 7.0

        s.pricePerLiter = mPrice
        s.consumptionKml = mKml
        s.motoPrice = mPrice
        s.motoKml = mKml
        s.carroPrice = cPrice
        s.carroKml = cKml
        s.caminhaoPrice = tPrice
        s.caminhaoKml = tKml
      }
    } catch (err) {
      console.log('[/backend/v1/fuel-balance/check-now] Aviso ao ler app_settings:', err)
    }

    return s
  }

  function getVehicleParams(vType, settings) {
    var v = (vType || 'moto').toLowerCase()
    if (v.indexOf('bicicleta') !== -1 || v.indexOf('bicycle') !== -1) {
      return { category: 'bicicleta', price: 0, kml: 0, isBike: true }
    }
    if (v.indexOf('carro') !== -1 || v.indexOf('van') !== -1) {
      return {
        category: 'carro',
        price: settings.carroPrice || settings.pricePerLiter,
        kml: settings.carroKml || 12.0,
        isBike: false,
      }
    }
    if (v.indexOf('caminhao') !== -1 || v.indexOf('truck') !== -1) {
      return {
        category: 'caminhao',
        price: settings.caminhaoPrice || settings.pricePerLiter,
        kml: settings.caminhaoKml || 7.0,
        isBike: false,
      }
    }
    return {
      category: 'moto',
      price: settings.motoPrice || settings.pricePerLiter,
      kml: settings.motoKml || settings.consumptionKml,
      isBike: false,
    }
  }

  function isCourierEligibleOrder(ord, courierId) {
    if (ord.getString('courier_id') !== courierId) return false
    var notes = (ord.getString('notes') || '').toLowerCase()
    if (notes.indexOf('erro de sistema') !== -1) return false
    if (ord.getString('completion_reason') === 'cancelado_vendedor') return false

    var baseLat = Number(ord.getFloat('start_base_lat')) || 0
    var baseLng = Number(ord.getFloat('start_base_lng')) || 0
    if (
      baseLat === 0 &&
      baseLng === 0 &&
      !ord.getString('start_base_name') &&
      !ord.getString('start_base_address')
    ) {
      return false
    }

    var status = ord.getString('status')
    if (status === 'delivered') return true
    if (status === 'address_error' || status === 'client_absent') return true
    return false
  }

  function buildJointDeliveryMetaMap(orders) {
    var metaMap = {}
    var JOINT_DELIVERY_WINDOW_MS = 45 * 60 * 1000

    var buckets = {}
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i]
      var cId = o.getString('courier_id')
      var custId = o.getString('customer_id')
      if (!cId) continue

      var effectiveCustomerKey = custId
      if (!effectiveCustomerKey) {
        var rawAddr = (o.getString('end_address_text') || o.getString('start_base_address') || o.id)
          .toLowerCase()
          .trim()
        effectiveCustomerKey = 'addr_' + rawAddr
      }

      var oDateVal =
        o.getString('actual_arrival') || o.getString('route_finished_at') || o.getString('created')
      var dayKey = getBrazilDateString(new Date(parseSafeTimestamp(oDateVal)))
      var bKey = cId + ':::' + effectiveCustomerKey + ':::' + dayKey

      if (!buckets[bKey]) buckets[bKey] = []
      buckets[bKey].push(o)
    }

    var bucketKeys = Object.keys(buckets)
    for (var b = 0; b < bucketKeys.length; b++) {
      var bOrders = buckets[bucketKeys[b]]
      if (bOrders.length < 2) continue

      bOrders.sort(function (a, bOrd) {
        var ta =
          parseSafeTimestamp(a.getString('actual_arrival')) ||
          parseSafeTimestamp(a.getString('route_finished_at')) ||
          parseSafeTimestamp(a.getString('created'))
        var tb =
          parseSafeTimestamp(bOrd.getString('actual_arrival')) ||
          parseSafeTimestamp(bOrd.getString('route_finished_at')) ||
          parseSafeTimestamp(bOrd.getString('created'))
        if (ta !== tb) return ta - tb
        return (
          parseSafeTimestamp(a.getString('created')) - parseSafeTimestamp(bOrd.getString('created'))
        )
      })

      var clusters = []
      var curCluster = [bOrders[0]]

      for (var j = 1; j < bOrders.length; j++) {
        var ord = bOrders[j]
        var prevOrd = curCluster[curCluster.length - 1]
        var tOrd =
          parseSafeTimestamp(ord.getString('actual_arrival')) ||
          parseSafeTimestamp(ord.getString('route_finished_at')) ||
          parseSafeTimestamp(ord.getString('created'))
        var tPrev =
          parseSafeTimestamp(prevOrd.getString('actual_arrival')) ||
          parseSafeTimestamp(prevOrd.getString('route_finished_at')) ||
          parseSafeTimestamp(prevOrd.getString('created'))

        if (Math.abs(tOrd - tPrev) <= JOINT_DELIVERY_WINDOW_MS) {
          curCluster.push(ord)
        } else {
          if (curCluster.length >= 2) {
            clusters.push(curCluster)
          }
          curCluster = [ord]
        }
      }
      if (curCluster.length >= 2) {
        clusters.push(curCluster)
      }

      for (var k = 0; k < clusters.length; k++) {
        var cluster = clusters[k]
        var primary = cluster[0]
        for (var ci = 0; ci < cluster.length; ci++) {
          var cOrd = cluster[ci]
          metaMap[cOrd.id] = {
            isJointDelivery: true,
            isJointPrimary: ci === 0,
            isJointSecondary: ci > 0,
            primaryId: primary.id,
          }
        }
      }
    }

    return metaMap
  }

  function computeOrderWeight(ord) {
    var baseLat = Number(ord.getFloat('start_base_lat')) || -22.7001402
    var baseLng = Number(ord.getFloat('start_base_lng')) || -43.2982834
    var endLat = Number(ord.getFloat('end_address_lat')) || 0
    var endLng = Number(ord.getFloat('end_address_lng')) || 0

    var roadDist = 0.8
    if (endLat !== 0 && endLng !== 0) {
      var directMeters = haversineMeters(baseLat, baseLng, endLat, endLng)
      roadDist = Math.max(directMeters / 1000, 0.8)
    }

    var dKm = Number(ord.getFloat('distance_km')) || 0
    if (dKm > 0) {
      roadDist = Math.max(roadDist, dKm)
    }

    var rKm = Number(ord.getFloat('return_trip_km')) || 0
    return Math.max(roadDist + rKm, 0.8)
  }

  function computeCourierFuelMetricsOfficial(courier, orders, currentYearMonth, settings) {
    var courierId = courier.id
    var vehicleType = courier.getString('vehicle_type') || 'moto'
    var vParams = getVehicleParams(vehicleType, settings)

    if (vParams.isBike) {
      return {
        currentMonthSpent: 0,
        currentMonthKm: 0,
        pastOrdersSpentTotal: 0,
        pastMonthSpentMap: {},
      }
    }

    var eligibleOrders = []
    for (var i = 0; i < orders.length; i++) {
      var ord = orders[i]
      if (isCourierEligibleOrder(ord, courierId)) {
        eligibleOrders.push(ord)
      }
    }

    if (eligibleOrders.length === 0) {
      return {
        currentMonthSpent: 0,
        currentMonthKm: 0,
        pastOrdersSpentTotal: 0,
        pastMonthSpentMap: {},
      }
    }

    var jointMetaMap = buildJointDeliveryMetaMap(eligibleOrders)

    var routeBatches = {}
    for (var oIdx = 0; oIdx < eligibleOrders.length; oIdx++) {
      var o = eligibleOrders[oIdx]
      var assignedKey = null
      var rStart = o.getString('route_started_at')
      var rFinish = o.getString('route_finished_at')

      if (rStart && rFinish) {
        assignedKey = 'route_' + rStart + '_' + rFinish
      } else if (rStart) {
        var oTime = parseSafeTimestamp(rStart)
        var batchKeys = Object.keys(routeBatches)
        for (var bk = 0; bk < batchKeys.length; bk++) {
          var exKey = batchKeys[bk]
          if (exKey.indexOf('batch_') === 0 && exKey.indexOf('batch_created_') === -1) {
            var bTime = Number(exKey.replace('batch_', '')) * (15 * 60 * 1000)
            if (Math.abs(oTime - bTime) <= 15 * 60 * 1000) {
              assignedKey = exKey
              break
            }
          }
        }
        if (!assignedKey) {
          assignedKey = 'batch_' + Math.floor(oTime / (15 * 60 * 1000))
        }
      } else {
        var cTime = parseSafeTimestamp(o.getString('created'))
        if (cTime > 0) {
          var batchKeysCreated = Object.keys(routeBatches)
          for (var bkc = 0; bkc < batchKeysCreated.length; bkc++) {
            var exKeyC = batchKeysCreated[bkc]
            if (exKeyC.indexOf('batch_created_') === 0) {
              var bTimeC = Number(exKeyC.replace('batch_created_', '')) * (15 * 60 * 1000)
              if (Math.abs(cTime - bTimeC) <= 15 * 60 * 1000) {
                assignedKey = exKeyC
                break
              }
            }
          }
          if (!assignedKey) {
            assignedKey = 'batch_created_' + Math.floor(cTime / (15 * 60 * 1000))
          }
        } else {
          assignedKey = 'single_' + o.id
        }
      }

      if (!routeBatches[assignedKey]) routeBatches[assignedKey] = []
      routeBatches[assignedKey].push(o)
    }

    var currentMonthSpent = 0
    var currentMonthKm = 0
    var pastOrdersSpentTotal = 0
    var pastMonthSpentMap = {}

    var batchKeysAll = Object.keys(routeBatches)
    for (var bIdx = 0; bIdx < batchKeysAll.length; bIdx++) {
      var bKey = batchKeysAll[bIdx]
      var batchOrders = routeBatches[bKey]
      var batchCount = batchOrders.length

      var maxRoadKmInBatch = 0
      for (var bi = 0; bi < batchCount; bi++) {
        var rKm = Number(batchOrders[bi].getFloat('total_route_with_return_km')) || 0
        if (rKm > maxRoadKmInBatch) maxRoadKmInBatch = rKm
      }

      var batchTotalOfficialKm = 0
      if (maxRoadKmInBatch > 0) {
        batchTotalOfficialKm = Number(maxRoadKmInBatch.toFixed(1))
      } else {
        var sumWeights = 0
        for (var swi = 0; swi < batchCount; swi++) {
          sumWeights += computeOrderWeight(batchOrders[swi])
        }
        batchTotalOfficialKm = Number(sumWeights.toFixed(1))
      }

      var batchTotalLiters =
        vParams.kml > 0 ? Number((batchTotalOfficialKm / vParams.kml).toFixed(2)) : 0
      var batchTotalFuelCost = Number((batchTotalLiters * vParams.price).toFixed(2))

      var totalBatchWeight = 0
      for (var wi = 0; wi < batchCount; wi++) {
        totalBatchWeight += computeOrderWeight(batchOrders[wi])
      }

      var allocatedKm = 0
      var allocatedFuel = 0

      for (var ordIdx = 0; ordIdx < batchCount; ordIdx++) {
        var currentOrder = batchOrders[ordIdx]
        var isLast = ordIdx === batchCount - 1
        var thisWeight = computeOrderWeight(currentOrder)
        var ratio = totalBatchWeight > 0 ? thisWeight / totalBatchWeight : 1 / batchCount

        var itemKm = 0
        var itemFuel = 0

        if (batchCount === 1) {
          itemKm = batchTotalOfficialKm
          itemFuel = batchTotalFuelCost
        } else if (isLast) {
          itemKm = Number(Math.max(0, batchTotalOfficialKm - allocatedKm).toFixed(1))
          itemFuel = Number(Math.max(0, batchTotalFuelCost - allocatedFuel).toFixed(2))
        } else {
          itemKm = Number((batchTotalOfficialKm * ratio).toFixed(1))
          var itemLiters = vParams.kml > 0 ? Number((itemKm / vParams.kml).toFixed(2)) : 0
          itemFuel = Number((itemLiters * vParams.price).toFixed(2))

          allocatedKm += itemKm
          allocatedFuel += itemFuel
        }

        var jMeta = jointMetaMap[currentOrder.id]
        if (jMeta && jMeta.isJointSecondary) {
          itemKm = 0
          itemFuel = 0
        }

        var orderDateVal =
          currentOrder.getString('route_finished_at') ||
          currentOrder.getString('actual_arrival') ||
          currentOrder.getString('created')
        var orderMonth = getYearMonthKey(orderDateVal)

        if (orderMonth === currentYearMonth) {
          currentMonthSpent += itemFuel
          currentMonthKm += itemKm
        } else if (orderMonth && orderMonth < currentYearMonth) {
          pastOrdersSpentTotal += itemFuel
          if (!pastMonthSpentMap[orderMonth]) {
            pastMonthSpentMap[orderMonth] = 0
          }
          pastMonthSpentMap[orderMonth] += itemFuel
        }
      }
    }

    currentMonthSpent = Number(currentMonthSpent.toFixed(2))
    currentMonthKm = Number(currentMonthKm.toFixed(1))
    pastOrdersSpentTotal = Number(pastOrdersSpentTotal.toFixed(2))

    var pMonths = Object.keys(pastMonthSpentMap)
    for (var pm = 0; pm < pMonths.length; pm++) {
      pastMonthSpentMap[pMonths[pm]] = Number(pastMonthSpentMap[pMonths[pm]].toFixed(2))
    }

    return {
      currentMonthSpent: currentMonthSpent,
      currentMonthKm: currentMonthKm,
      pastOrdersSpentTotal: pastOrdersSpentTotal,
      pastMonthSpentMap: pastMonthSpentMap,
    }
  }

  try {
    var authRecord =
      (typeof c.Auth === 'function' ? c.Auth() : null) || c.auth || c.get('authRecord')
    var role = authRecord ? authRecord.getString('role') : ''
    if (!authRecord || (role !== 'master' && role !== 'admin' && role !== 'superadmin')) {
      return c.json(403, {
        error: 'Acesso negado. Apenas administradores podem acionar a verificação de combustível.',
      })
    }

    var now = new Date()
    var todayStr = getBrazilDateString(now)
    var currentYearMonth = todayStr.substring(0, 7)

    var fuelSettings = loadFuelSettings()

    var couriers = []
    try {
      couriers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'courier' && status = 'active'",
        'name',
        200,
        0,
      )
    } catch (errCouriers) {
      return c.json(500, { error: String(errCouriers) })
    }

    var allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status != 'cancelled'",
        '-date,-created',
        5000,
        0,
      )
    } catch (_) {}

    var allOrders = []
    try {
      allOrders = $app.findRecordsByFilter(
        'orders',
        "(status = 'delivered' || status = 'address_error' || status = 'client_absent') && completion_reason != 'cancelado_vendedor'",
        '-created',
        10000,
        0,
      )
    } catch (_) {}

    var allMembros = []
    try {
      allMembros = $app.findRecordsByFilter('membros', 'ativo = true', '-created', 1000, 0)
    } catch (_) {}

    var allEmpresas = []
    try {
      allEmpresas = $app.findRecordsByFilter('empresas', 'id != ""', 'nome_fantasia', 100, 0)
    } catch (_) {}

    var adminUsers = []
    try {
      adminUsers = $app.findRecordsByFilter(
        '_pb_users_auth_',
        "role = 'admin' || role = 'master'",
        '-created',
        50,
        0,
      )
    } catch (_) {}

    var processed = 0
    var alertsSent = 0
    var alertDetails = []

    for (var cIdx = 0; cIdx < couriers.length; cIdx++) {
      var courier = couriers[cIdx]
      var courierId = courier.id
      var courierName = courier.getString('name') || courier.getString('email') || 'Entregador'
      var vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()

      if (vehicleType === 'bicicleta' || vehicleType === 'bicycle') continue

      processed++

      var existingTodayAlert = []
      try {
        existingTodayAlert = $app.findRecordsByFilter(
          'fuel_balance_alerts',
          `courier_id = '${courierId}' && alert_date = '${todayStr}' && status = 'sent'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (existingTodayAlert && existingTodayAlert.length > 0) {
        alertDetails.push({
          courierId: courierId,
          courierName: courierName,
          status: 'skipped_already_sent_today',
        })
        continue
      }

      var courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)

      var metrics = computeCourierFuelMetricsOfficial(
        courier,
        allOrders,
        currentYearMonth,
        fuelSettings,
      )

      var currentMonthSpent = metrics.currentMonthSpent
      var pastOrdersSpentTotal = metrics.pastOrdersSpentTotal
      var pastMonthSpentMap = metrics.pastMonthSpentMap

      var currentMonthAdvances = 0
      var pastAdvancesTotal = 0

      for (var a = 0; a < courierAdvances.length; a++) {
        var adv = courierAdvances[a]
        var advDateVal = adv.getString('date') || adv.getString('created')
        var advMonth = getYearMonthKey(advDateVal)
        var advAmount = Number(adv.getFloat('amount')) || 0

        if (advMonth === currentYearMonth) {
          currentMonthAdvances += advAmount
        } else if (advMonth && advMonth < currentYearMonth) {
          pastAdvancesTotal += advAmount
        }
      }

      var carryOverBalance = Number((pastAdvancesTotal - pastOrdersSpentTotal).toFixed(2))
      var currentBalance = Number(
        (carryOverBalance + currentMonthAdvances - currentMonthSpent).toFixed(2),
      )

      var closedMonths = Object.keys(pastMonthSpentMap)
      var monthlyAverage = 0

      if (closedMonths.length > 0) {
        var sumPastSpent = 0
        for (var m = 0; m < closedMonths.length; m++) {
          sumPastSpent += pastMonthSpentMap[closedMonths[m]]
        }
        monthlyAverage = Number((sumPastSpent / closedMonths.length).toFixed(2))
      }

      if (monthlyAverage <= 0) {
        if (vehicleType.indexOf('caminhao') !== -1) monthlyAverage = 1200.0
        else if (vehicleType.indexOf('carro') !== -1 || vehicleType.indexOf('van') !== -1)
          monthlyAverage = 800.0
        else monthlyAverage = 450.0

        if (currentMonthSpent > monthlyAverage) monthlyAverage = currentMonthSpent
      }

      var threshold80 = Number((monthlyAverage * 0.8).toFixed(2))
      var reachedThreshold =
        currentMonthSpent >= threshold80 ||
        (currentBalance <= monthlyAverage * 0.2 && currentMonthSpent > 0)

      if (!reachedThreshold) {
        alertDetails.push({
          courierId: courierId,
          courierName: courierName,
          status: 'ok_not_triggered',
          balance: currentBalance,
          monthlySpent: currentMonthSpent,
          monthlyAverage: monthlyAverage,
        })
        continue
      }

      var suggestedRecharge = monthlyAverage - currentMonthSpent
      if (suggestedRecharge > monthlyAverage) suggestedRecharge = monthlyAverage
      if (suggestedRecharge < 0) suggestedRecharge = 0
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))

      var empresaId = ''
      var empresaNome = 'Rotaly Logística'
      var notificationsEmail = ''
      var commercialEmail = ''

      var courierMembro = allMembros.find((mb) => mb.getString('user_id') === courierId)
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        var emp = allEmpresas.find((e) => e.id === empresaId)
        if (emp) {
          empresaNome =
            emp.getString('nome_fantasia') || emp.getString('nome_razao_social') || empresaNome
          notificationsEmail = (emp.getString('notifications_email') || '').trim()
          commercialEmail = (emp.getString('email') || '').trim()
        }
      }

      var targetAdminEmail = ''
      var targetAdminName = 'Administrador'

      if (notificationsEmail) {
        targetAdminEmail = notificationsEmail
        targetAdminName = empresaNome
      }

      if (!targetAdminEmail && empresaId) {
        var adminMembro = allMembros.find(
          (mb) => mb.getString('empresa_id') === empresaId && mb.getString('papel') === 'admin',
        )
        if (adminMembro) {
          var adminUser = adminUsers.find((u) => u.id === adminMembro.getString('user_id'))
          if (adminUser) {
            targetAdminEmail = (adminUser.getString('email') || '').trim()
            targetAdminName = adminUser.getString('name') || targetAdminName
          }
        }
      }

      if (!targetAdminEmail && commercialEmail) {
        targetAdminEmail = commercialEmail
        targetAdminName = empresaNome
      }

      if (!targetAdminEmail && adminUsers.length > 0) {
        targetAdminEmail = (adminUsers[0].getString('email') || '').trim()
        targetAdminName = adminUsers[0].getString('name') || targetAdminName
      }

      if (!targetAdminEmail) targetAdminEmail = 'tributarefacil@gmail.com'

      var senderAddress =
        ($app.settings().meta && $app.settings().meta.senderAddress) || 'no-reply@goskip.app'
      var senderName =
        ($app.settings().meta && $app.settings().meta.senderName) || 'Rotaly Gestão de Entregas'

      var htmlBody = `
        <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; background-color: #f8fafc; border-radius: 16px; border: 1px solid #e2e8f0;">
          <div style="background: linear-gradient(135deg, #002855, #004b99); padding: 28px; border-radius: 12px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 700; letter-spacing: -0.5px;">⛽ Alerta de Saldo de Combustível</h1>
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% da média mensal)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de consumo de combustível no mês corrente para a empresa <strong>${empresaNome}</strong>.
            </p>

            <div style="margin: 20px 0; padding: 16px; background-color: #f1f5f9; border-radius: 10px; border-left: 4px solid #f59e0b;">
              <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${courierName}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Veículo:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; text-transform: uppercase;">${vehicleType}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Atual:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: ${currentBalance < 0 ? '#dc2626' : '#059669'}; font-weight: 700;">${formatCurrency(currentBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Consumo Acumulado no Mês:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(currentMonthSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Mensal do Entregador:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(monthlyAverage)}</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga Recomendada</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <span style="display: block; font-size: 11px; color: #475569;">
                Calculada com base na média mensal (${formatCurrency(monthlyAverage)}) deduzindo o consumo acumulado (${formatCurrency(currentMonthSpent)}), sem ultrapassar o teto da média do entregador.
              </span>
            </div>

            <p style="font-size: 12px; color: #64748b; line-height: 1.4; margin-bottom: 0;">
              Acesse o painel do Rotaly para lançar o adiantamento de combustível ou realizar os ajustes necessários na conta corrente do entregador.
            </p>
          </div>

          <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
            Rotaly • Gestão Inteligente de Entregas &amp; Auditoria de Combustível<br />
            Este é um alerta automático gerado pelo sistema de verificação diária.
          </p>
        </div>
      `

      var sendStatus = 'sent'
      var sendError = ''

      try {
        var mailer = $app.newMailClient()
        mailer.send({
          from: {
            address: senderAddress,
            name: senderName,
          },
          to: [{ address: targetAdminEmail }],
          subject: `⛽ Alerta de Saldo de Combustível: ${courierName} (${formatCurrency(currentBalance)})`,
          html: htmlBody,
        })
        alertsSent++
      } catch (mailErr) {
        sendStatus = 'failed'
        sendError = String(mailErr)
      }

      try {
        var alertsCol = $app.findCollectionByNameOrId('fuel_balance_alerts')
        var alertRec = new Record(alertsCol)
        alertRec.set('courier_id', courierId)
        if (empresaId) alertRec.set('empresa_id', empresaId)
        alertRec.set('alert_date', todayStr)
        alertRec.set('balance', currentBalance)
        alertRec.set('monthly_spent', currentMonthSpent)
        alertRec.set('monthly_average', monthlyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        if (sendError) alertRec.set('notes', sendError)
        $app.save(alertRec)
      } catch (_) {}

      alertDetails.push({
        courierId: courierId,
        courierName: courierName,
        status: sendStatus,
        recipient: targetAdminEmail,
        balance: currentBalance,
        monthlySpent: currentMonthSpent,
        monthlyAverage: monthlyAverage,
        suggestedRecharge: suggestedRecharge,
        error: sendError || undefined,
      })
    }

    return c.json(200, {
      success: true,
      date: todayStr,
      processed: processed,
      alertsSent: alertsSent,
      details: alertDetails,
    })
  } catch (err) {
    return c.json(500, { error: String(err) })
  }
})
