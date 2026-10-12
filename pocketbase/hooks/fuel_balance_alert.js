/**
 * pocketbase/hooks/fuel_balance_alert.js
 *
 * Motor oficial de apuração de combustível, conta corrente e alertas de saldo do Rotaly.
 *
 * REGRAS OFICIAIS DE PRODUTO (PARIDADE TOTAL COM O CARD DO PAINEL / FRONTEND):
 * - KM oficial = Trajeto viário da rota planejada (`total_route_with_return_km`) contado UMA VEZ por LOTE de rota;
 * - O combustível da rota é rateado pro-rata entre os pedidos do lote (com absorção de resíduo na última parada);
 * - Entregas conjuntas no mesmo cliente (janela <= 45 minutos no mesmo dia local): a 1ª parada (primária) mantém o KM/combustível;
 *   pedidos secundários têm KM=0 e combustível=0 (viagem já paga, deduplicação);
 * - Parâmetros de combustível (consumo km/l e preço/litro) obtidos das configurações atuais do sistema (`app_settings`),
 *   diferenciados por categoria de veículo (moto, carro/van, caminhão, bicicleta);
 * - NUNCA somar o campo `fuel_cost` individual bruto gravado nos pedidos;
 * - Aprovações de KM vigentes em `route_km_approvals` (status = 'approved') têm soberania sobre o trecho oficial;
 *
 * FRENTE 1 — SALDO NO E-MAIL/REGISTRO:
 *   Se o entregador possuir opening_balance e cutoff_date preenchidos:
 *   Saldo Atual = opening_balance + adiantamentos (status='active' com data civil >= cutoff_date) - gasto oficial pós-cutoff.
 *   Fallback: sem opening_balance/cutoff_date, mantém a apuração de conta corrente padrão (carry-over + adiantamentos - gastos).
 *   Filtrar SEMPRE status='active' para adiantamentos considerados no saldo.
 *
 * FRENTE 2 — NOVA SUGESTÃO DE RECARGA (MÉDIA ÚLTIMOS 30 DIAS):
 *   média_diária = gasto oficial apurado pelo motor nos últimos 30 dias (janela deslizante, fuso America/Sao_Paulo, operacional 05h–23h59) ÷ 30;
 *   dias_restantes = do dia seguinte ao corrente até o último dia do mês civil (ex: alerta em 08/10 -> 09/10 a 31/10 = 23 dias);
 *   projeção = média_diária × dias_restantes;
 *   sugestão = max(0, média_diária × dias_restantes − saldo_atual);
 *   Componentes detalhados no e-mail e no registro: média diária, intervalo e dias restantes, projeção, saldo e sugestão.
 *
 * FRENTE 3 — NOVO DISPARO DO ALERTA (80% DO SALDO DISPONIBILIZADO):
 *   Disparar quando o gasto apurado atingir 80% do saldo disponibilizado (opening_balance + adiantamentos active pós-cutoff),
 *   ou seja, saldo restante <= 20% do disponibilizado; ou imediatamente se saldo < 0.
 *   Substitui o gatilho antigo (80% da média mensal).
 *   Máximo 1 alerta por entregador por dia (coleção `fuel_balance_alerts`), sem apagar histórico.
 *
 * NOTA DE ARQUITETURA POCKETBASE (GOJA JSVM):
 * Callbacks em cronAdd e routerAdd rodam em pools isoladas: funções auxiliares declaradas inline.
 */

// 1. Cron Job Diário (08:00 AM) para verificação preventiva de saldo de combustível.
cronAdd('daily_fuel_balance_check', '0 8 * * *', () => {
  function formatCurrency(val) {
    var n = Number(val) || 0
    return 'R$ ' + n.toFixed(2).replace('.', ',')
  }

  function getBrazilParts(d) {
    var dateObj = d || new Date()
    var utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    var spTime = new Date(utc - 3 * 3600000)
    return {
      year: spTime.getFullYear(),
      month: spTime.getMonth() + 1,
      day: spTime.getDate(),
      hour: spTime.getHours(),
      minute: spTime.getMinutes(),
      second: spTime.getSeconds(),
      spDate: spTime,
    }
  }

  function getBrazilDateString(d) {
    var p = getBrazilParts(d)
    var mm = String(p.month).padStart(2, '0')
    var dd = String(p.day).padStart(2, '0')
    return p.year + '-' + mm + '-' + dd
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

  function getCivilDateKey(dateVal) {
    if (!dateVal && dateVal !== 0) return ''
    if (typeof dateVal === 'string') {
      var trimmed = dateVal.trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed
      }
      var midnightMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s]00:00:00(\.000)?Z?$/)
      if (midnightMatch) {
        return midnightMatch[1]
      }
    }
    var ts = parseSafeTimestamp(dateVal)
    if (ts <= 0) return ''
    return getBrazilDateString(new Date(ts))
  }

  function isAdvancePostCutoff(advDateVal, cutoffDateVal) {
    if (!cutoffDateVal) return true
    var advKey = getCivilDateKey(advDateVal)
    var cutoffKey = getCivilDateKey(cutoffDateVal)
    if (!cutoffKey) return true
    if (!advKey) return false
    return advKey >= cutoffKey
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
      alertThresholdPct: 80,
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

        try {
          var extraData = r.get('extra')
          if (typeof extraData === 'string' && extraData) {
            extraData = JSON.parse(extraData)
          }
          if (extraData && typeof extraData === 'object') {
            var rawThreshold = Number(extraData.fuel_alert_threshold_pct)
            if (!isNaN(rawThreshold) && rawThreshold > 0 && rawThreshold <= 100) {
              s.alertThresholdPct = rawThreshold
            }
          }
        } catch (_) {}
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

  // Motor oficial que computa o gasto de uma lista de pedidos
  function computeOrdersOfficialSpent(ordersSubset, courier, settings, approvalsMap) {
    var vehicleType = courier.getString('vehicle_type') || 'moto'
    var vParams = getVehicleParams(vehicleType, settings)
    if (vParams.isBike || !ordersSubset || ordersSubset.length === 0) {
      return 0
    }

    var jointMetaMap = buildJointDeliveryMetaMap(ordersSubset)

    var routeBatches = {}
    for (var oIdx = 0; oIdx < ordersSubset.length; oIdx++) {
      var o = ordersSubset[oIdx]
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

    var totalSpent = 0
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

        if (approvalsMap && approvalsMap[currentOrder.id] !== undefined) {
          var approvedVal = approvalsMap[currentOrder.id]
          if (!(jMeta && jMeta.isJointSecondary)) {
            itemKm = approvedVal
            var appLiters = vParams.kml > 0 ? Number((itemKm / vParams.kml).toFixed(2)) : 0
            itemFuel = Number((appLiters * vParams.price).toFixed(2))
          }
        }

        totalSpent += itemFuel
      }
    }

    return Number(totalSpent.toFixed(2))
  }

  try {
    console.log(
      '[daily_fuel_balance_check] Iniciando verificação diária com motor canônico e nova sugestão 30d...',
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

    // Apenas adiantamentos ativos (status = 'active')
    var allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status = 'active'",
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

    // Carrega aprovações em route_km_approvals: aprovadas (para substituição de km) e completas (para auditoria de lotes)
    var approvalsMap = {}
    var approvalsByOrder = {}
    var approvalsByBatch = {}
    try {
      var allApprovals = $app.findRecordsByFilter(
        'route_km_approvals',
        'id != ""',
        '-created',
        5000,
        0,
      )
      for (var ap = 0; ap < allApprovals.length; ap++) {
        var aRec = allApprovals[ap]
        var aOrderId = aRec.getString('order_id')
        var aBatchKey = aRec.getString('route_batch_key')
        var aStatus = aRec.getString('status') || 'pending'
        var aKm = Number(aRec.getFloat('approved_km')) || 0

        if (aOrderId) {
          if (!approvalsByOrder[aOrderId]) {
            approvalsByOrder[aOrderId] = { status: aStatus, approvedKm: aKm, batchKey: aBatchKey }
          }
          if (aStatus === 'approved' && approvalsMap[aOrderId] === undefined) {
            approvalsMap[aOrderId] = aKm
          }
        }
        if (aBatchKey) {
          if (!approvalsByBatch[aBatchKey]) {
            approvalsByBatch[aBatchKey] = []
          }
          approvalsByBatch[aBatchKey].push({ orderId: aOrderId, status: aStatus, approvedKm: aKm })
        }
      }
    } catch (errAp) {
      console.log('[daily_fuel_balance_check] Aviso ao carregar route_km_approvals:', errAp)
    }
    // Cálculo do calendário civil do mês corrente (fuso America/Sao_Paulo)
    // Janela deslizante de 30 dias operacionais: de (today - 30 dias) às 05:00 até hoje às 23:59:59.999
    var nowParts = getBrazilParts(now)
    var todayOperationalDay = nowParts.day
    if (nowParts.hour < 5) {
      var prevDayDate = new Date(nowParts.spDate.getTime() - 24 * 3600000)
      var prevDayParts = getBrazilParts(prevDayDate)
      todayOperationalDay = prevDayParts.day
    }

    // Janela 30 dias: 30 * 24h atrás a partir de agora
    var window30dStartTs = now.getTime() - 30 * 24 * 3600000

    // Dias restantes no mês civil: do dia seguinte até o último dia do mês
    // Último dia do mês corrente:
    var lastDayOfMonth = new Date(nowParts.year, nowParts.month, 0).getDate()
    var remainingDays = Math.max(0, lastDayOfMonth - todayOperationalDay)
    var nextDayNum = Math.min(todayOperationalDay + 1, lastDayOfMonth)
    var nextDayStr =
      String(nextDayNum).padStart(2, '0') + '/' + String(nowParts.month).padStart(2, '0')
    var lastDayStr =
      String(lastDayOfMonth).padStart(2, '0') + '/' + String(nowParts.month).padStart(2, '0')
    var remainingIntervalLabel =
      nextDayStr +
      ' até ' +
      lastDayStr +
      ' • ' +
      remainingDays +
      ' dia' +
      (remainingDays === 1 ? '' : 's')

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
          `[daily_fuel_balance_check] Alerta já enviado hoje para ${courierName}. Anti-spam mantido.`,
        )
        continue
      }

      // 1. Pedidos elegíveis do entregador
      var courierOrders = []
      for (var oi = 0; oi < allOrders.length; oi++) {
        if (isCourierEligibleOrder(allOrders[oi], courierId)) {
          courierOrders.push(allOrders[oi])
        }
      }

      // 2. Adiantamentos ativos do entregador
      var courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)

      // 3. FRENTE 1: Saldo Canônico com opening_balance e cutoff_date
      var cutoffDateStr = courier.getString('cutoff_date') || ''
      var cutoffTs = cutoffDateStr ? parseSafeTimestamp(cutoffDateStr) : 0
      var hasCutoff = Boolean(cutoffDateStr && cutoffTs > 0)
      var openingBalance = courier.getFloat('opening_balance')

      var currentBalance = 0
      var postCutoffAdvancesTotal = 0
      var postCutoffSpent = 0
      var availableBalance = 0

      if (hasCutoff) {
        // Adiantamentos status='active' com data civil >= cutoff_date
        var postAdvances = courierAdvances.filter(function (a) {
          var aDate = a.getString('date') || a.getString('created')
          return isAdvancePostCutoff(aDate, cutoffDateStr)
        })
        for (var pa = 0; pa < postAdvances.length; pa++) {
          postCutoffAdvancesTotal += Number(postAdvances[pa].getFloat('amount')) || 0
        }

        // Pedidos pós-cutoff (timestamp >= cutoffTs)
        var postOrders = courierOrders.filter(function (ord) {
          var oDateVal =
            ord.getString('route_finished_at') ||
            ord.getString('actual_arrival') ||
            ord.getString('created')
          return parseSafeTimestamp(oDateVal) >= cutoffTs
        })

        postCutoffSpent = computeOrdersOfficialSpent(
          postOrders,
          courier,
          fuelSettings,
          approvalsMap,
        )
        currentBalance = Number(
          (openingBalance + postCutoffAdvancesTotal - postCutoffSpent).toFixed(2),
        )
        availableBalance = Number((openingBalance + postCutoffAdvancesTotal).toFixed(2))
      } else {
        // Fallback: cálculo padrão de conta corrente se não houver cutoff_date
        var pastOrdersSpent = 0
        var currentMonthSpentFallback = 0
        for (var foi = 0; foi < courierOrders.length; foi++) {
          var cord = courierOrders[foi]
          var cordDate =
            cord.getString('route_finished_at') ||
            cord.getString('actual_arrival') ||
            cord.getString('created')
          var cMonth = (cordDate || '').substring(0, 7)
          var cSpent = computeOrdersOfficialSpent([cord], courier, fuelSettings, approvalsMap)
          if (cMonth === currentYearMonth) {
            currentMonthSpentFallback += cSpent
          } else if (cMonth && cMonth < currentYearMonth) {
            pastOrdersSpent += cSpent
          }
        }

        var pastAdvTotal = 0
        var currentMonthAdvTotal = 0
        for (var fai = 0; fai < courierAdvances.length; fai++) {
          var fadv = courierAdvances[fai]
          var fDate = fadv.getString('date') || fadv.getString('created')
          var fMonth = (fDate || '').substring(0, 7)
          var fAmt = Number(fadv.getFloat('amount')) || 0
          if (fMonth === currentYearMonth) {
            currentMonthAdvTotal += fAmt
          } else if (fMonth && fMonth < currentYearMonth) {
            pastAdvTotal += fAmt
          }
        }

        var carryOver = pastAdvTotal - pastOrdersSpent
        currentBalance = Number(
          (carryOver + currentMonthAdvTotal - currentMonthSpentFallback).toFixed(2),
        )
        postCutoffSpent = currentMonthSpentFallback
        availableBalance = Number((carryOver + currentMonthAdvTotal).toFixed(2))
      }

      // 4. FRENTE 2: Média com janela real e sugestão de recarga (alinhada 100% com o painel)
      var ordersLast30d = courierOrders.filter(function (ord) {
        var oDateVal =
          ord.getString('route_finished_at') ||
          ord.getString('actual_arrival') ||
          ord.getString('created')
        var ts = parseSafeTimestamp(oDateVal)
        return ts >= window30dStartTs
      })

      var spent30d = computeOrdersOfficialSpent(ordersLast30d, courier, fuelSettings, approvalsMap)
      var dailyAverage = 0
      var averageLabel = 'Média 30d'

      if (ordersLast30d.length > 0) {
        var oldestOrderTs = ordersLast30d.reduce(function (minTs, o) {
          var oDateVal =
            o.getString('route_finished_at') ||
            o.getString('actual_arrival') ||
            o.getString('created')
          var t = parseSafeTimestamp(oDateVal)
          return t > 0 && t < minTs ? t : minTs
        }, now.getTime())

        var elapsedDays = Math.max(1, Math.ceil((now.getTime() - oldestOrderTs) / (24 * 3600000)))
        var windowDays = Math.min(30, elapsedDays)

        if (windowDays < 28) {
          dailyAverage = Number((spent30d / windowDays).toFixed(2))
          averageLabel = 'Média ' + windowDays + 'd'
        } else {
          dailyAverage = Number((spent30d / 30).toFixed(2))
          averageLabel = 'Média 30d'
        }
      }

      // FÓRMULA OFICIAL DE RECARGA SUGERIDA:
      // recarga = media - consumo_do_periodo
      // Com teto: se resultado < 0 -> 0; se resultado > media -> media.
      // media = dailyAverage
      // consumo_do_periodo = postCutoffSpent
      var rawRecharge = Number((dailyAverage - postCutoffSpent).toFixed(2))
      var suggestedRecharge =
        rawRecharge < 0 ? 0 : rawRecharge > dailyAverage ? dailyAverage : rawRecharge
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))
      var projection = Number((dailyAverage * remainingDays).toFixed(2))

      // 5. FRENTE 3: Disparo do alerta (gasto atingiu limiar de app_settings ou saldo negativo)
      var thresholdPct = fuelSettings.alertThresholdPct || 80
      var triggerHighRatio = thresholdPct / 100
      var triggerLowRatio = (100 - thresholdPct) / 100

      var reachedThreshold = false
      if (currentBalance < 0) {
        reachedThreshold = true
      } else if (availableBalance > 0) {
        if (
          postCutoffSpent >= availableBalance * triggerHighRatio ||
          currentBalance <= availableBalance * triggerLowRatio
        ) {
          reachedThreshold = true
        }
      } else {
        // Se availableBalance <= 0 e gastou algo, já atingiu
        if (postCutoffSpent > 0) {
          reachedThreshold = true
        }
      }

      if (!reachedThreshold) {
        continue
      }

      // Destinatários
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
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% do saldo disponibilizado)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de saldo de combustível na empresa <strong>${empresaNome}</strong>.
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
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Disponibilizado:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(availableBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Gasto Apurado (Motor Oficial):</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(postCutoffSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Diária (Últimos 30 dias):</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(dailyAverage)} / dia</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga para Restante do Mês</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <div style="font-size: 11px; color: #475569; line-height: 1.5; margin-top: 6px;">
                <strong>Período:</strong> ${remainingIntervalLabel}<br />
                <strong>Projeção de Consumo:</strong> ${formatCurrency(dailyAverage)}/dia × ${remainingDays} dias = ${formatCurrency(projection)}<br />
                <strong>Cálculo:</strong> Projeção (${formatCurrency(projection)}) − Saldo Atual (${formatCurrency(currentBalance)}) = <strong>${formatCurrency(suggestedRecharge)}</strong>
              </div>
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
        alertRec.set('monthly_spent', postCutoffSpent)
        alertRec.set('monthly_average', dailyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        var detailNote = `${averageLabel}: R$ ${dailyAverage.toFixed(2)}/dia | Período: ${remainingIntervalLabel} | Projeção: R$ ${projection.toFixed(2)}`
        if (sendError) detailNote += ` | Erro: ${sendError}`
        alertRec.set('notes', detailNote)
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

  function getBrazilParts(d) {
    var dateObj = d || new Date()
    var utc = dateObj.getTime() + dateObj.getTimezoneOffset() * 60000
    var spTime = new Date(utc - 3 * 3600000)
    return {
      year: spTime.getFullYear(),
      month: spTime.getMonth() + 1,
      day: spTime.getDate(),
      hour: spTime.getHours(),
      minute: spTime.getMinutes(),
      second: spTime.getSeconds(),
      spDate: spTime,
    }
  }

  function getBrazilDateString(d) {
    var p = getBrazilParts(d)
    var mm = String(p.month).padStart(2, '0')
    var dd = String(p.day).padStart(2, '0')
    return p.year + '-' + mm + '-' + dd
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

  function getCivilDateKey(dateVal) {
    if (!dateVal && dateVal !== 0) return ''
    if (typeof dateVal === 'string') {
      var trimmed = dateVal.trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return trimmed
      }
      var midnightMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T\s]00:00:00(\.000)?Z?$/)
      if (midnightMatch) {
        return midnightMatch[1]
      }
    }
    var ts = parseSafeTimestamp(dateVal)
    if (ts <= 0) return ''
    return getBrazilDateString(new Date(ts))
  }

  function isAdvancePostCutoff(advDateVal, cutoffDateVal) {
    if (!cutoffDateVal) return true
    var advKey = getCivilDateKey(advDateVal)
    var cutoffKey = getCivilDateKey(cutoffDateVal)
    if (!cutoffKey) return true
    if (!advKey) return false
    return advKey >= cutoffKey
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
      alertThresholdPct: 80,
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

        try {
          var extraData = r.get('extra')
          if (typeof extraData === 'string' && extraData) {
            extraData = JSON.parse(extraData)
          }
          if (extraData && typeof extraData === 'object') {
            var rawThreshold = Number(extraData.fuel_alert_threshold_pct)
            if (!isNaN(rawThreshold) && rawThreshold > 0 && rawThreshold <= 100) {
              s.alertThresholdPct = rawThreshold
            }
          }
        } catch (_) {}
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

  function computeOrdersOfficialSpent(ordersSubset, courier, settings, approvalsMap) {
    var vehicleType = courier.getString('vehicle_type') || 'moto'
    var vParams = getVehicleParams(vehicleType, settings)
    if (vParams.isBike || !ordersSubset || ordersSubset.length === 0) {
      return 0
    }

    var jointMetaMap = buildJointDeliveryMetaMap(ordersSubset)

    var routeBatches = {}
    for (var oIdx = 0; oIdx < ordersSubset.length; oIdx++) {
      var o = ordersSubset[oIdx]
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

    var totalSpent = 0
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

        if (approvalsMap && approvalsMap[currentOrder.id] !== undefined) {
          var approvedVal = approvalsMap[currentOrder.id]
          if (!(jMeta && jMeta.isJointSecondary)) {
            itemKm = approvedVal
            var appLiters = vParams.kml > 0 ? Number((itemKm / vParams.kml).toFixed(2)) : 0
            itemFuel = Number((appLiters * vParams.price).toFixed(2))
          }
        }

        totalSpent += itemFuel
      }
    }

    return Number(totalSpent.toFixed(2))
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

    // Apenas adiantamentos ativos (status = 'active')
    var allAdvances = []
    try {
      allAdvances = $app.findRecordsByFilter(
        'fuel_advances',
        "status = 'active'",
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

    var approvalsMapCheck = {}
    var approvalsByOrderCheck = {}
    var approvalsByBatchCheck = {}
    try {
      var allApprovalsCheck = $app.findRecordsByFilter(
        'route_km_approvals',
        'id != ""',
        '-created',
        5000,
        0,
      )
      for (var apc = 0; apc < allApprovalsCheck.length; apc++) {
        var aRecC = allApprovalsCheck[apc]
        var aOrderIdC = aRecC.getString('order_id')
        var aBatchKeyC = aRecC.getString('route_batch_key')
        var aStatusC = aRecC.getString('status') || 'pending'
        var aKmC = Number(aRecC.getFloat('approved_km')) || 0

        if (aOrderIdC) {
          if (!approvalsByOrderCheck[aOrderIdC]) {
            approvalsByOrderCheck[aOrderIdC] = {
              status: aStatusC,
              approvedKm: aKmC,
              batchKey: aBatchKeyC,
            }
          }
          if (aStatusC === 'approved' && approvalsMapCheck[aOrderIdC] === undefined) {
            approvalsMapCheck[aOrderIdC] = aKmC
          }
        }
        if (aBatchKeyC) {
          if (!approvalsByBatchCheck[aBatchKeyC]) {
            approvalsByBatchCheck[aBatchKeyC] = []
          }
          approvalsByBatchCheck[aBatchKeyC].push({
            orderId: aOrderIdC,
            status: aStatusC,
            approvedKm: aKmC,
          })
        }
      }
    } catch (_) {}
    // Parâmetros de data para sugestão 30d
    var nowParts = getBrazilParts(now)
    var todayOperationalDay = nowParts.day
    if (nowParts.hour < 5) {
      var prevDayDate = new Date(nowParts.spDate.getTime() - 24 * 3600000)
      var prevDayParts = getBrazilParts(prevDayDate)
      todayOperationalDay = prevDayParts.day
    }

    var window30dStartTs = now.getTime() - 30 * 24 * 3600000
    var lastDayOfMonth = new Date(nowParts.year, nowParts.month, 0).getDate()
    var remainingDays = Math.max(0, lastDayOfMonth - todayOperationalDay)
    var nextDayNum = Math.min(todayOperationalDay + 1, lastDayOfMonth)
    var nextDayStr =
      String(nextDayNum).padStart(2, '0') + '/' + String(nowParts.month).padStart(2, '0')
    var lastDayStr =
      String(lastDayOfMonth).padStart(2, '0') + '/' + String(nowParts.month).padStart(2, '0')
    var remainingIntervalLabel =
      nextDayStr +
      ' até ' +
      lastDayStr +
      ' • ' +
      remainingDays +
      ' dia' +
      (remainingDays === 1 ? '' : 's')

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

      // Pedidos elegíveis
      var courierOrders = []
      for (var oi = 0; oi < allOrders.length; oi++) {
        if (isCourierEligibleOrder(allOrders[oi], courierId)) {
          courierOrders.push(allOrders[oi])
        }
      }

      // Adiantamentos ativos
      var courierAdvances = allAdvances.filter((a) => a.getString('courier_id') === courierId)

      // FRENTE 1: Saldo Canônico
      var cutoffDateStr = courier.getString('cutoff_date') || ''
      var cutoffTs = cutoffDateStr ? parseSafeTimestamp(cutoffDateStr) : 0
      var hasCutoff = Boolean(cutoffDateStr && cutoffTs > 0)
      var openingBalance = courier.getFloat('opening_balance')

      var currentBalance = 0
      var postCutoffAdvancesTotal = 0
      var postCutoffSpent = 0
      var availableBalance = 0

      if (hasCutoff) {
        var postAdvances = courierAdvances.filter(function (a) {
          var aDate = a.getString('date') || a.getString('created')
          return isAdvancePostCutoff(aDate, cutoffDateStr)
        })
        for (var pa = 0; pa < postAdvances.length; pa++) {
          postCutoffAdvancesTotal += Number(postAdvances[pa].getFloat('amount')) || 0
        }

        var postOrders = courierOrders.filter(function (ord) {
          var oDateVal =
            ord.getString('route_finished_at') ||
            ord.getString('actual_arrival') ||
            ord.getString('created')
          return parseSafeTimestamp(oDateVal) >= cutoffTs
        })

        postCutoffSpent = computeOrdersOfficialSpent(
          postOrders,
          courier,
          fuelSettings,
          approvalsMapCheck,
        )
        currentBalance = Number(
          (openingBalance + postCutoffAdvancesTotal - postCutoffSpent).toFixed(2),
        )
        availableBalance = Number((openingBalance + postCutoffAdvancesTotal).toFixed(2))
      } else {
        var pastOrdersSpent = 0
        var currentMonthSpentFallback = 0
        for (var foi = 0; foi < courierOrders.length; foi++) {
          var cord = courierOrders[foi]
          var cordDate =
            cord.getString('route_finished_at') ||
            cord.getString('actual_arrival') ||
            cord.getString('created')
          var cMonth = (cordDate || '').substring(0, 7)
          var cSpent = computeOrdersOfficialSpent([cord], courier, fuelSettings, approvalsMapCheck)
          if (cMonth === currentYearMonth) {
            currentMonthSpentFallback += cSpent
          } else if (cMonth && cMonth < currentYearMonth) {
            pastOrdersSpent += cSpent
          }
        }

        var pastAdvTotal = 0
        var currentMonthAdvTotal = 0
        for (var fai = 0; fai < courierAdvances.length; fai++) {
          var fadv = courierAdvances[fai]
          var fDate = fadv.getString('date') || fadv.getString('created')
          var fMonth = (fDate || '').substring(0, 7)
          var fAmt = Number(fadv.getFloat('amount')) || 0
          if (fMonth === currentYearMonth) {
            currentMonthAdvTotal += fAmt
          } else if (fMonth && fMonth < currentYearMonth) {
            pastAdvTotal += fAmt
          }
        }

        var carryOver = pastAdvTotal - pastOrdersSpent
        currentBalance = Number(
          (carryOver + currentMonthAdvTotal - currentMonthSpentFallback).toFixed(2),
        )
        postCutoffSpent = currentMonthSpentFallback
        availableBalance = Number((carryOver + currentMonthAdvTotal).toFixed(2))
      }

      // FRENTE 2: Média de DIAS TRABALHADOS com KM AUDITADO e sugestão com teto na média (v0.0.405)
      // Regra 1: Sugestão = média − consumo do período, com TETO na média (nunca negativa, nunca > média).
      // Regra 2: Média usa só dias TRABALHADOS (escala 12x36, folga fora) e km AUDITADO (exclui desvio >30% e aprovações pendentes/rejeitadas).
      // FRENTE 3: Gatilho com limiar configurável de app_settings
      var thresholdPct = fuelSettings.alertThresholdPct || 80
      var triggerHighRatio = thresholdPct / 100
      var triggerLowRatio = (100 - thresholdPct) / 100

      var reachedThreshold = false
      if (currentBalance < 0) {
        reachedThreshold = true
      } else if (availableBalance > 0) {
        if (
          postCutoffSpent >= availableBalance * triggerHighRatio ||
          currentBalance <= availableBalance * triggerLowRatio
        ) {
          reachedThreshold = true
        }
      } else {
        if (postCutoffSpent > 0) {
          reachedThreshold = true
        }
      }

      if (!reachedThreshold) {
        alertDetails.push({
          courierId: courierId,
          courierName: courierName,
          status: 'ok_not_triggered',
          balance: currentBalance,
          availableBalance: availableBalance,
          monthlySpent: postCutoffSpent,
          dailyAverage30d: dailyAverage,
          remainingDays: remainingDays,
          suggestedRecharge: suggestedRecharge,
        })
        continue
      }

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
            <p style="margin-top: 8px; margin-bottom: 0; font-size: 14px; opacity: 0.9;">Consumo atingiu a faixa de atenção (80% do saldo disponibilizado)</p>
          </div>

          <div style="padding: 24px; background-color: #ffffff; margin-top: 16px; border-radius: 12px; border: 1px solid #e2e8f0; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
            <p style="font-size: 14px; color: #334155; margin-top: 0;">
              Olá, <strong>${targetAdminName}</strong>!
            </p>
            <p style="font-size: 14px; color: #475569; line-height: 1.5;">
              Identificamos que o entregador <strong>${courierName}</strong> atingiu a faixa de atenção de saldo de combustível na empresa <strong>${empresaNome}</strong>.
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
                  <td style="padding: 6px 0; color: #64748b;"><strong>Saldo Disponibilizado:</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(availableBalance)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Gasto Apurado (Motor Oficial):</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #dc2626; font-weight: 700;">${formatCurrency(postCutoffSpent)}</td>
                </tr>
                <tr>
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Diária (Últimos 30 dias):</strong></td>
                  <td style="padding: 6px 0; text-align: right; color: #002855; font-weight: 600;">${formatCurrency(dailyAverage)} / dia</td>
                </tr>
              </table>
            </div>

            <div style="background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; border-radius: 10px; padding: 18px; text-align: center; margin: 20px 0;">
              <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #1e40af;">Sugestão de Recarga para Restante do Mês</span>
              <span style="display: block; font-size: 26px; font-weight: 800; color: #002855; margin: 6px 0;">${formatCurrency(suggestedRecharge)}</span>
              <div style="font-size: 11px; color: #475569; line-height: 1.5; margin-top: 6px;">
                <strong>Período:</strong> ${remainingIntervalLabel}<br />
                <strong>Projeção de Consumo:</strong> ${formatCurrency(dailyAverage)}/dia × ${remainingDays} dias = ${formatCurrency(projection)}<br />
                <strong>Cálculo:</strong> Projeção (${formatCurrency(projection)}) − Saldo Atual (${formatCurrency(currentBalance)}) = <strong>${formatCurrency(suggestedRecharge)}</strong>
              </div>
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
        alertRec.set('monthly_spent', postCutoffSpent)
        alertRec.set('monthly_average', dailyAverage)
        alertRec.set('suggested_recharge', suggestedRecharge)
        alertRec.set('recipient_email', targetAdminEmail)
        alertRec.set('status', sendStatus)
        var detailNote = `${averageLabel}: R$ ${dailyAverage.toFixed(2)}/dia | Período: ${remainingIntervalLabel} | Projeção: R$ ${projection.toFixed(2)}`
        if (sendError) detailNote += ` | Erro: ${sendError}`
        alertRec.set('notes', detailNote)
        $app.save(alertRec)
      } catch (_) {}

      alertDetails.push({
        courierId: courierId,
        courierName: courierName,
        status: sendStatus,
        recipient: targetAdminEmail,
        balance: currentBalance,
        availableBalance: availableBalance,
        monthlySpent: postCutoffSpent,
        dailyAverage30d: dailyAverage,
        remainingDays: remainingDays,
        averageLabel: averageLabel,
        intervalLabel: remainingIntervalLabel,
        projection: projection,
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
