/**
 * pocketbase/hooks/fuel_balance_alert.js
 *
 * Motor oficial de apuração de combustível, conta corrente e alertas de saldo do Rotaly.
 *
 * REGRAS OFICIAIS DE PRODUTO (PARIDADE TOTAL COM O CARD DO PAINEL / FRONTEND):
 * - Consome EXCLUSIVAMENTE a coleção `route_batch_telemetry` como fonte de km e rotas:
 *   filtrar por courier_id, dedup 1x por route_batch_key, usar km_oficial viário auditado
 *   (fallback km_viario_total se km_oficial vazio/zerado; GPS apenas auditoria).
 * - PROIBIDO: km_gps_total cru somado, km de desvio, orders como fonte de km.
 * - Gasto = km oficial ÷ taxa de consumo do veículo em app_settings (moto 30 km/L) × preço do litro (R$ 6,49).
 * - Bicicleta = custo zero (fuel_cost = 0, gasto = 0).
 * - Média diária = gasto canônico ÷ dias civis efetivamente trabalhados.
 * - Sugestão de recarga = max(0, média − consumo do período), máx 1 e-mail/dia como já existe.
 * - Saldo = saldo de abertura + adiantamentos pós-corte − gasto canônico pós-corte.
 * - Aprovação manual do admin: registros em `route_km_approvals` (status = 'approved') têm soberania sobre o trecho.
 * - Preserva rigorosamente a ordem de avisos e templates HTML já existentes.
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

  function loadFuelSettings() {
    var s = {
      pricePerLiter: 6.49,
      consumptionKml: 30.0,
      motoPrice: 6.49,
      motoKml: 30.0,
      carroPrice: 6.49,
      carroKml: 10.0,
      caminhaoPrice: 6.49,
      caminhaoKml: 7.0,
      alertThresholdPct: 80,
    }

    try {
      var recs = $app.findRecordsByFilter('app_settings', "key = 'global_settings'", '', 1, 0)
      if (recs && recs.length > 0) {
        var r = recs[0]
        var basePrice = Number(r.getFloat('fuel_price_per_liter')) || 6.49
        var baseKml = Number(r.getFloat('fuel_consumption_kml')) || 30.0

        var mPrice = Number(r.getFloat('moto_fuel_price')) || basePrice
        var mKml = Number(r.getFloat('moto_consumption_kml')) || baseKml

        var cPrice = Number(r.getFloat('carro_fuel_price')) || basePrice
        var cKml = Number(r.getFloat('carro_consumption_kml')) || 10.0

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
        kml: settings.carroKml || 10.0,
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

  /**
   * Processa os lotes dedup 1x por route_batch_key consumindo EXCLUSIVAMENTE route_batch_telemetry.
   * Regras canônicas:
   * 1. Dedup 1x por route_batch_key (mantém o mais recente se houver chave duplicada);
   * 2. KM Oficial canônico: km_oficial viário. Fallback: km_viario_total se km_oficial vazio/zerado;
   * 3. Saneamento: se viario > 0 e gps > 2x viario, limita gps a viario * 1.15; se oficial > 2x viario, recalcula pela regra do MENOR;
   * 4. Aprovação manual do admin em route_km_approvals tem soberania;
   * 5. Gasto = km_oficial ÷ consumoKml × pricePerLiter (bicicleta = 0);
   * 6. PROIBIDO: km_gps_total cru somado, km de desvio, orders como fonte de km.
   */
  function buildCanonicalBatches(rawBatches, approvalsByBatch) {
    var map = {}
    for (var i = 0; i < rawBatches.length; i++) {
      var b = rawBatches[i]
      var k = b.getString('route_batch_key')
      if (!k) continue
      var existing = map[k]
      if (!existing) {
        map[k] = b
      } else {
        var tB = parseSafeTimestamp(b.getString('updated') || b.getString('created'))
        var tEx = parseSafeTimestamp(existing.getString('updated') || existing.getString('created'))
        if (tB > tEx) {
          map[k] = b
        }
      }
    }

    var result = []
    var keys = Object.keys(map)
    for (var j = 0; j < keys.length; j++) {
      var bKey = keys[j]
      var bRec = map[bKey]

      var viario = Number(bRec.getFloat('km_viario_total')) || 0
      var gps = Number(bRec.getFloat('km_gps_total')) || 0
      var kmOficial = Number(bRec.getFloat('km_oficial')) || 0

      // Guarda de sanidade nos somatórios (teto de coerência)
      if (viario > 0 && gps > viario * 2) {
        gps = Number((viario * 1.15).toFixed(2))
      }
      if (kmOficial <= 0 || (viario > 0 && kmOficial > viario * 2)) {
        kmOficial = viario > 0 ? viario : gps
      }

      // Aprovação manual do admin pelo lote
      var batchApprovals = approvalsByBatch ? approvalsByBatch[bKey] : null
      if (batchApprovals && batchApprovals.length > 0) {
        var sumApproved = 0
        var hasApproved = false
        for (var ap = 0; ap < batchApprovals.length; ap++) {
          var apItem = batchApprovals[ap]
          if (apItem.status === 'approved' && apItem.approvedKm > 0) {
            sumApproved += apItem.approvedKm
            hasApproved = true
          }
        }
        if (hasApproved && sumApproved > 0) {
          kmOficial = sumApproved
        }
      }

      kmOficial = Number(kmOficial.toFixed(2))

      var dateVal =
        bRec.getString('route_finished_at') ||
        bRec.getString('route_started_at') ||
        bRec.getString('created')
      var ts = parseSafeTimestamp(dateVal)
      var civilDay = getCivilDateKey(dateVal)

      result.push({
        batchKey: bKey,
        record: bRec,
        kmOficial: kmOficial,
        kmViario: viario,
        kmGps: gps,
        timestamp: ts,
        civilDay: civilDay,
      })
    }

    return result
  }

  try {
    console.log(
      '[daily_fuel_balance_check] Iniciando verificação com fonte EXCLUSIVA route_batch_telemetry...',
    )
    var now = new Date()
    var todayStr = getBrazilDateString(now)

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

    // Carrega EXCLUSIVAMENTE a telemetria auditada
    var allTelemetryBatches = []
    try {
      allTelemetryBatches = $app.findRecordsByFilter(
        'route_batch_telemetry',
        'id != ""',
        '-created',
        10000,
        0,
      )
    } catch (errTelem) {
      console.log('[daily_fuel_balance_check] Erro ao buscar route_batch_telemetry:', errTelem)
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

    // Aprovações de KM vigentes
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
        var aBatchKey = aRec.getString('route_batch_key')
        var aStatus = aRec.getString('status') || 'pending'
        var aKm = Number(aRec.getFloat('approved_km')) || 0

        if (aBatchKey) {
          if (!approvalsByBatch[aBatchKey]) {
            approvalsByBatch[aBatchKey] = []
          }
          approvalsByBatch[aBatchKey].push({ status: aStatus, approvedKm: aKm })
        }
      }
    } catch (errAp) {
      console.log('[daily_fuel_balance_check] Aviso ao carregar route_km_approvals:', errAp)
    }

    // Janela de calendário civil do mês corrente (fuso America/Sao_Paulo)
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

    var processedCount = 0
    var alertsSentCount = 0

    for (var c = 0; c < couriers.length; c++) {
      var courier = couriers[c]
      var courierId = courier.id
      var courierName = courier.getString('name') || courier.getString('email') || 'Entregador'
      var vehicleType = (courier.getString('vehicle_type') || 'moto').toLowerCase()

      // Bicicleta = custo zero (fuel_cost=0, gasto=0). Pula envio de alerta financeiro.
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

      // Parâmetros de combustível do veículo
      var vParams = getVehicleParams(vehicleType, fuelSettings)
      var consumptionKml = vParams.kml || 30.0
      var pricePerLiter = vParams.price || 6.49

      // 1. Filtrar lotes de telemetria do entregador e dedup 1x por route_batch_key
      var courierBatchesRaw = []
      for (var tbIdx = 0; tbIdx < allTelemetryBatches.length; tbIdx++) {
        if (allTelemetryBatches[tbIdx].getString('courier_id') === courierId) {
          courierBatchesRaw.push(allTelemetryBatches[tbIdx])
        }
      }
      var canonicalBatches = buildCanonicalBatches(courierBatchesRaw, approvalsByBatch)

      // 2. Adiantamentos ativos do entregador
      var courierAdvances = allAdvances.filter(function (a) {
        return a.getString('courier_id') === courierId
      })

      // 3. FRENTE 1: Saldo Canônico com opening_balance e cutoff_date
      var cutoffDateStr = courier.getString('cutoff_date') || ''
      var cutoffTs = cutoffDateStr ? parseSafeTimestamp(cutoffDateStr) : 0
      var hasCutoff = Boolean(cutoffDateStr && cutoffTs > 0)
      var openingBalance = courier.getFloat('opening_balance')

      var postCutoffAdvancesTotal = 0
      var postCutoffKm = 0

      // Adiantamentos pós-corte (data civil >= cutoff_date)
      for (var ai = 0; ai < courierAdvances.length; ai++) {
        var adv = courierAdvances[ai]
        var advDate = adv.getString('date') || adv.getString('created')
        if (!hasCutoff || isAdvancePostCutoff(advDate, cutoffDateStr)) {
          postCutoffAdvancesTotal += Number(adv.getFloat('amount')) || 0
        }
      }

      // KM pós-corte derivado EXCLUSIVAMENTE de route_batch_telemetry
      for (var bi = 0; bi < canonicalBatches.length; bi++) {
        var bItem = canonicalBatches[bi]
        var isPostCutoff = !hasCutoff || bItem.timestamp >= cutoffTs
        if (isPostCutoff) {
          postCutoffKm += bItem.kmOficial
        }
      }

      // Gasto = km oficial ÷ taxa de consumo do veículo em app_settings × preço do litro
      var postCutoffSpent = 0
      if (!vParams.isBike && consumptionKml > 0) {
        postCutoffSpent = Number(((postCutoffKm / consumptionKml) * pricePerLiter).toFixed(2))
      }

      // Saldo = saldo de abertura + adiantamentos pós-corte − gasto canônico pós-corte
      var currentBalance = Number(
        (openingBalance + postCutoffAdvancesTotal - postCutoffSpent).toFixed(2),
      )
      var availableBalance = Number((openingBalance + postCutoffAdvancesTotal).toFixed(2))

      // 4. FRENTE 2: Média diária = gasto canônico ÷ dias civis efetivamente trabalhados
      // Janela deslizante de 30 dias a partir de route_batch_telemetry
      var workedDaysSet = {}
      var spent30dKm = 0
      for (var b30 = 0; b30 < canonicalBatches.length; b30++) {
        var cb = canonicalBatches[b30]
        if (cb.timestamp >= window30dStartTs) {
          spent30dKm += cb.kmOficial
          if (cb.civilDay && cb.kmOficial > 0) {
            workedDaysSet[cb.civilDay] = true
          }
        }
      }

      var spent30d = 0
      if (!vParams.isBike && consumptionKml > 0) {
        spent30d = Number(((spent30dKm / consumptionKml) * pricePerLiter).toFixed(2))
      }

      var workedDaysCount = Object.keys(workedDaysSet).length
      var dailyAverage = 0
      var averageLabel = 'Média 30d'

      if (workedDaysCount > 0 && spent30d > 0) {
        dailyAverage = Number((spent30d / workedDaysCount).toFixed(2))
        averageLabel = 'Média ' + workedDaysCount + 'd trab'
      }

      // FÓRMULA OFICIAL DE RECARGA SUGERIDA (PARIDADE COM O PAINEL):
      // sugestao = max(0, média − consumo do período), com teto na média (nunca > média)
      var rawRecharge = Number((dailyAverage - postCutoffSpent).toFixed(2))
      var suggestedRecharge =
        rawRecharge < 0 ? 0 : rawRecharge > dailyAverage ? dailyAverage : rawRecharge
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))
      var projection = Number((dailyAverage * remainingDays).toFixed(2))

      // 5. FRENTE 3: Disparo do alerta (gasto atingiu limiar de 80% do saldo disponibilizado ou saldo negativo)
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
        continue
      }

      // Ordem rigorosa de avisos preservada:
      // notifications_email da empresa → admin membro → e-mail comercial da empresa → primeiro admin/master → fallback fixo
      var empresaId = ''
      var empresaNome = 'Rotaly Logística'
      var notificationsEmail = ''
      var commercialEmail = ''

      var courierMembro = allMembros.find(function (mb) {
        return mb.getString('user_id') === courierId
      })
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        var emp = allEmpresas.find(function (e) {
          return e.id === empresaId
        })
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
        var adminMembro = allMembros.find(function (mb) {
          return mb.getString('empresa_id') === empresaId && mb.getString('papel') === 'admin'
        })
        if (adminMembro) {
          var adminUser = adminUsers.find(function (u) {
            return u.id === adminMembro.getString('user_id')
          })
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
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Diária (${averageLabel}):</strong></td>
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
                <strong>Cálculo:</strong> max(0, Média (${formatCurrency(dailyAverage)}) − Consumo (${formatCurrency(postCutoffSpent)})) = <strong>${formatCurrency(suggestedRecharge)}</strong>
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
        var detailNote = `${averageLabel}: R$ ${dailyAverage.toFixed(2)}/dia | Período: ${remainingIntervalLabel} | Projeção: R$ ${projection.toFixed(2)} | KM Oficial: ${postCutoffKm.toFixed(1)} km`
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

  function loadFuelSettings() {
    var s = {
      pricePerLiter: 6.49,
      consumptionKml: 30.0,
      motoPrice: 6.49,
      motoKml: 30.0,
      carroPrice: 6.49,
      carroKml: 10.0,
      caminhaoPrice: 6.49,
      caminhaoKml: 7.0,
      alertThresholdPct: 80,
    }

    try {
      var recs = $app.findRecordsByFilter('app_settings', "key = 'global_settings'", '', 1, 0)
      if (recs && recs.length > 0) {
        var r = recs[0]
        var basePrice = Number(r.getFloat('fuel_price_per_liter')) || 6.49
        var baseKml = Number(r.getFloat('fuel_consumption_kml')) || 30.0

        var mPrice = Number(r.getFloat('moto_fuel_price')) || basePrice
        var mKml = Number(r.getFloat('moto_consumption_kml')) || baseKml

        var cPrice = Number(r.getFloat('carro_fuel_price')) || basePrice
        var cKml = Number(r.getFloat('carro_consumption_kml')) || 10.0

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
        kml: settings.carroKml || 10.0,
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

  function buildCanonicalBatches(rawBatches, approvalsByBatch) {
    var map = {}
    for (var i = 0; i < rawBatches.length; i++) {
      var b = rawBatches[i]
      var k = b.getString('route_batch_key')
      if (!k) continue
      var existing = map[k]
      if (!existing) {
        map[k] = b
      } else {
        var tB = parseSafeTimestamp(b.getString('updated') || b.getString('created'))
        var tEx = parseSafeTimestamp(existing.getString('updated') || existing.getString('created'))
        if (tB > tEx) {
          map[k] = b
        }
      }
    }

    var result = []
    var keys = Object.keys(map)
    for (var j = 0; j < keys.length; j++) {
      var bKey = keys[j]
      var bRec = map[bKey]

      var viario = Number(bRec.getFloat('km_viario_total')) || 0
      var gps = Number(bRec.getFloat('km_gps_total')) || 0
      var kmOficial = Number(bRec.getFloat('km_oficial')) || 0

      // Guarda de sanidade nos somatórios (teto de coerência)
      if (viario > 0 && gps > viario * 2) {
        gps = Number((viario * 1.15).toFixed(2))
      }
      if (kmOficial <= 0 || (viario > 0 && kmOficial > viario * 2)) {
        kmOficial = viario > 0 ? viario : gps
      }

      var batchApprovals = approvalsByBatch ? approvalsByBatch[bKey] : null
      if (batchApprovals && batchApprovals.length > 0) {
        var sumApproved = 0
        var hasApproved = false
        for (var ap = 0; ap < batchApprovals.length; ap++) {
          var apItem = batchApprovals[ap]
          if (apItem.status === 'approved' && apItem.approvedKm > 0) {
            sumApproved += apItem.approvedKm
            hasApproved = true
          }
        }
        if (hasApproved && sumApproved > 0) {
          kmOficial = sumApproved
        }
      }

      kmOficial = Number(kmOficial.toFixed(2))

      var dateVal =
        bRec.getString('route_finished_at') ||
        bRec.getString('route_started_at') ||
        bRec.getString('created')
      var ts = parseSafeTimestamp(dateVal)
      var civilDay = getCivilDateKey(dateVal)

      result.push({
        batchKey: bKey,
        record: bRec,
        kmOficial: kmOficial,
        kmViario: viario,
        kmGps: gps,
        timestamp: ts,
        civilDay: civilDay,
      })
    }

    return result
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

    // Carrega EXCLUSIVAMENTE a telemetria auditada
    var allTelemetryBatches = []
    try {
      allTelemetryBatches = $app.findRecordsByFilter(
        'route_batch_telemetry',
        'id != ""',
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
        var aBatchKeyC = aRecC.getString('route_batch_key')
        var aStatusC = aRecC.getString('status') || 'pending'
        var aKmC = Number(aRecC.getFloat('approved_km')) || 0

        if (aBatchKeyC) {
          if (!approvalsByBatchCheck[aBatchKeyC]) {
            approvalsByBatchCheck[aBatchKeyC] = []
          }
          approvalsByBatchCheck[aBatchKeyC].push({ status: aStatusC, approvedKm: aKmC })
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

      var vParams = getVehicleParams(vehicleType, fuelSettings)
      var consumptionKml = vParams.kml || 30.0
      var pricePerLiter = vParams.price || 6.49

      var courierBatchesRaw = []
      for (var tb = 0; tb < allTelemetryBatches.length; tb++) {
        if (allTelemetryBatches[tb].getString('courier_id') === courierId) {
          courierBatchesRaw.push(allTelemetryBatches[tb])
        }
      }
      var canonicalBatches = buildCanonicalBatches(courierBatchesRaw, approvalsByBatchCheck)

      var courierAdvances = allAdvances.filter(function (a) {
        return a.getString('courier_id') === courierId
      })

      // FRENTE 1: Saldo Canônico
      var cutoffDateStr = courier.getString('cutoff_date') || ''
      var cutoffTs = cutoffDateStr ? parseSafeTimestamp(cutoffDateStr) : 0
      var hasCutoff = Boolean(cutoffDateStr && cutoffTs > 0)
      var openingBalance = courier.getFloat('opening_balance')

      var postCutoffAdvancesTotal = 0
      var postCutoffKm = 0

      for (var ai = 0; ai < courierAdvances.length; ai++) {
        var adv = courierAdvances[ai]
        var advDate = adv.getString('date') || adv.getString('created')
        if (!hasCutoff || isAdvancePostCutoff(advDate, cutoffDateStr)) {
          postCutoffAdvancesTotal += Number(adv.getFloat('amount')) || 0
        }
      }

      for (var bi = 0; bi < canonicalBatches.length; bi++) {
        var bItem = canonicalBatches[bi]
        var isPostCutoff = !hasCutoff || bItem.timestamp >= cutoffTs
        if (isPostCutoff) {
          postCutoffKm += bItem.kmOficial
        }
      }

      var postCutoffSpent = 0
      if (!vParams.isBike && consumptionKml > 0) {
        postCutoffSpent = Number(((postCutoffKm / consumptionKml) * pricePerLiter).toFixed(2))
      }

      var currentBalance = Number(
        (openingBalance + postCutoffAdvancesTotal - postCutoffSpent).toFixed(2),
      )
      var availableBalance = Number((openingBalance + postCutoffAdvancesTotal).toFixed(2))

      // FRENTE 2: Média diária = gasto canônico ÷ dias civis efetivamente trabalhados
      var workedDaysSet = {}
      var spent30dKm = 0
      for (var b30 = 0; b30 < canonicalBatches.length; b30++) {
        var cb = canonicalBatches[b30]
        if (cb.timestamp >= window30dStartTs) {
          spent30dKm += cb.kmOficial
          if (cb.civilDay && cb.kmOficial > 0) {
            workedDaysSet[cb.civilDay] = true
          }
        }
      }

      var spent30d = 0
      if (!vParams.isBike && consumptionKml > 0) {
        spent30d = Number(((spent30dKm / consumptionKml) * pricePerLiter).toFixed(2))
      }

      var workedDaysCount = Object.keys(workedDaysSet).length
      var dailyAverage = 0
      var averageLabel = 'Média 30d'

      if (workedDaysCount > 0 && spent30d > 0) {
        dailyAverage = Number((spent30d / workedDaysCount).toFixed(2))
        averageLabel = 'Média ' + workedDaysCount + 'd trab'
      }

      var rawRecharge = Number((dailyAverage - postCutoffSpent).toFixed(2))
      var suggestedRecharge =
        rawRecharge < 0 ? 0 : rawRecharge > dailyAverage ? dailyAverage : rawRecharge
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))
      var projection = Number((dailyAverage * remainingDays).toFixed(2))

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
          officialKm: postCutoffKm,
          workedDaysCount: workedDaysCount,
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

      var courierMembro = allMembros.find(function (mb) {
        return mb.getString('user_id') === courierId
      })
      if (courierMembro) {
        empresaId = courierMembro.getString('empresa_id')
        var emp = allEmpresas.find(function (e) {
          return e.id === empresaId
        })
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
        var adminMembro = allMembros.find(function (mb) {
          return mb.getString('empresa_id') === empresaId && mb.getString('papel') === 'admin'
        })
        if (adminMembro) {
          var adminUser = adminUsers.find(function (u) {
            return u.id === adminMembro.getString('user_id')
          })
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
                  <td style="padding: 6px 0; color: #64748b;"><strong>Média Diária (${averageLabel}):</strong></td>
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
                <strong>Cálculo:</strong> max(0, Média (${formatCurrency(dailyAverage)}) − Consumo (${formatCurrency(postCutoffSpent)})) = <strong>${formatCurrency(suggestedRecharge)}</strong>
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
        var detailNote = `${averageLabel}: R$ ${dailyAverage.toFixed(2)}/dia | Período: ${remainingIntervalLabel} | Projeção: R$ ${projection.toFixed(2)} | KM Oficial: ${postCutoffKm.toFixed(1)} km`
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
        officialKm: postCutoffKm,
        workedDaysCount: workedDaysCount,
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
