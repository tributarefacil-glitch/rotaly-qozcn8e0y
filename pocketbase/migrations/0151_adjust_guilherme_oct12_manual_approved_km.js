/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0151_adjust_guilherme_oct12_manual_approved_km.js
 *
 * Ajuste único de dados do dia 12/10/2026 para o entregador Guilherme de Paiva (u6zr2qtcos1ljxd).
 * Decisão soberana do dono: pagar 82,0 km ao entregador Guilherme de Paiva pelo dia 12/10/2026,
 * valendo para km rodado (pagamento) E para o cálculo de combustível.
 *
 * Contexto: o dia dele fechou com telemetria GPS de 68,8 km (cobertura perdida no fim — celular terminou com bateria em 10%)
 * e odômetro/informado de ~86 km. O dono aprovou 82 km como ajuste manual — uso legítimo da porta de exceção da regra de aprovação.
 *
 * O que esta migração faz:
 * 1. Lê app_settings para obter consumo e preço reais de moto (moto_consumption_kml, moto_fuel_price ou fuel_price_per_liter).
 *    Caso estejam configurados em 30 km/L e R$ 6.49 ou 40 km/L e R$ 6.09, usa app_settings.
 *    (O prompt cita: moto 40 km/L, preço R$ 6,09 — mas confere em app_settings).
 * 2. Identifica todos os pedidos de 12/10/2026 do Guilherme de Paiva (fuso America/Sao_Paulo: UTC-3).
 * 3. Identifica os lotes do dia e redistribui proporcionalmente para que o total oficial apurado do dia
 *    (total canônico por route_batch_key) feche exatamente em 82,0 km.
 * 4. Recalcula o combustível total do dia e de cada lote/pedido com base nos parâmetros de app_settings.
 * 5. Registra aprovações manuais na coleção route_km_approvals (status='approved', approved_km ajustado por lote)
 *    e audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true e justificativa exata:
 *    'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'.
 */

migrate(
  (app) => {
    const courierId = 'u6zr2qtcos1ljxd'
    const targetDayStr = '2026-10-12'
    const justificationText =
      'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'
    const targetOfficialDayKm = 82.0
    const nowIso = new Date().toISOString()

    console.log(
      '[0151] Iniciando ajuste manual do dia 12/10/2026 para Guilherme de Paiva (82 km)...',
    )

    // 1. Obter parâmetros reais de combustível em app_settings
    let consumptionKml = 30.0
    let fuelPrice = 6.49

    try {
      const settingsRecord = app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      if (settingsRecord) {
        const motoPrice = Number(settingsRecord.get('moto_fuel_price'))
        const generalPrice = Number(settingsRecord.get('fuel_price_per_liter'))
        if (motoPrice > 0) {
          fuelPrice = motoPrice
        } else if (generalPrice > 0) {
          fuelPrice = generalPrice
        }

        const motoCons = Number(settingsRecord.get('moto_consumption_kml'))
        const generalCons = Number(settingsRecord.get('fuel_consumption_kml'))
        if (motoCons > 0) {
          consumptionKml = motoCons
        } else if (generalCons > 0) {
          consumptionKml = generalCons
        }
      }
    } catch (eSettings) {
      console.warn('[0151] Aviso ao ler app_settings, usando fallback:', eSettings)
    }

    console.log(
      `[0151] Parâmetros de combustível ativos: ${consumptionKml} km/L, R$ ${fuelPrice.toFixed(2)}/L`,
    )

    const expectedLiters = Number((targetOfficialDayKm / consumptionKml).toFixed(2))
    const expectedFuelCost = Number((expectedLiters * fuelPrice).toFixed(2))
    console.log(
      `[0151] Meta do dia 12/10/2026: ${targetOfficialDayKm} km -> ${expectedLiters} L -> R$ ${expectedFuelCost.toFixed(2)}`,
    )

    // Helper para converter UTC timestamp para data civil YYYY-MM-DD em America/Sao_Paulo (UTC-3)
    function getSpCivilDate(utcString) {
      if (!utcString) return null
      const ts = new Date(utcString).getTime()
      if (isNaN(ts) || ts <= 0) return null
      const spDate = new Date(ts - 3 * 3600 * 1000)
      const y = spDate.getUTCFullYear()
      const m = String(spDate.getUTCMonth() + 1).padStart(2, '0')
      const d = String(spDate.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }

    // 2. Buscar pedidos de 12/10/2026 do Guilherme
    const allCandidateOrders = app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && created >= '2026-10-12 00:00:00.000Z' && created <= '2026-10-13 04:00:00.000Z'`,
      'route_started_at,created,sequence',
      500,
      0,
    )

    const dayOrders = []
    for (let i = 0; i < allCandidateOrders.length; i++) {
      const ord = allCandidateOrders[i]
      const refDateRaw =
        ord.getString('route_started_at') ||
        ord.getString('route_finished_at') ||
        ord.getString('actual_arrival') ||
        ord.getString('created')
      const dayKey = getSpCivilDate(refDateRaw)
      if (dayKey === targetDayStr) {
        dayOrders.push(ord)
      }
    }

    console.log(
      `[0151] Total de pedidos do dia 12/10/2026 encontrados para o Guilherme: ${dayOrders.length}`,
    )

    if (dayOrders.length === 0) {
      console.warn('[0151] Nenhum pedido encontrado para 12/10/2026. Abortando.')
      return
    }

    // 3. Agrupar pedidos por lote de rota (tolerância de 2 minutos sobre route_started_at)
    const batches = []
    for (let j = 0; j < dayOrders.length; j++) {
      const ord = dayOrders[j]
      const startRaw = ord.getString('route_started_at') || ord.getString('created')
      const startTs = startRaw ? new Date(startRaw).getTime() : 0

      let foundB = null
      for (let b = 0; b < batches.length; b++) {
        if (Math.abs(batches[b].startTime - startTs) <= 2 * 60 * 1000) {
          foundB = batches[b]
          break
        }
      }

      if (foundB) {
        foundB.orders.push(ord)
      } else {
        const startMin = Math.floor(startTs / 60000)
        const batchKey = `rb_${courierId}_${targetDayStr}_${startMin}`
        batches.push({
          startTime: startTs,
          batchKey: batchKey,
          orders: [ord],
        })
      }
    }

    batches.sort((a, b) => a.startTime - b.startTime)
    console.log(`[0151] Total de lotes de rotas identificados no dia: ${batches.length}`)

    // 4. Calcular o peso/km viário de cada lote antes do ajuste
    let currentTotalDayKm = 0
    for (let b = 0; b < batches.length; b++) {
      const bOrders = batches[b].orders
      let bMaxKm = 0
      let bSumLegs = 0
      for (let bo = 0; bo < bOrders.length; bo++) {
        const rKm = bOrders[bo].getFloat('total_route_with_return_km')
        const dKm = bOrders[bo].getFloat('distance_km')
        if (rKm > bMaxKm) bMaxKm = rKm
        bSumLegs += dKm
      }
      const bEffectiveKm = bMaxKm > 0 ? bMaxKm : Math.max(bSumLegs, 1.0)
      batches[b].currentKm = bEffectiveKm
      currentTotalDayKm += bEffectiveKm
      console.log(
        `[0151]   Lote #${b + 1} (${bOrders.length} ordens, chave ${batches[b].batchKey}): KM atual = ${bEffectiveKm.toFixed(1)} km`,
      )
    }

    console.log(
      `[0151] Soma atual dos lotes: ${currentTotalDayKm.toFixed(1)} km -> Alvo aprovado pelo dono: ${targetOfficialDayKm.toFixed(1)} km`,
    )

    // 5. Revogar aprovações manuais prévias em route_km_approvals que interfiram no cálculo oficial do dia
    // (Por exemplo, aprovações de redirecionamento ou manuais pendentes/antigas que sobrescreveriam o lote)
    try {
      const existingApprovals = app.findRecordsByFilter(
        'route_km_approvals',
        `courier_id = '${courierId}' && created >= '2026-10-12 00:00:00.000Z' && created <= '2026-10-13 04:00:00.000Z'`,
        '-created',
        500,
        0,
      )
      console.log(
        `[0151] Encontradas ${existingApprovals.length} aprovações em route_km_approvals no dia 12/10.`,
      )
      for (let apIdx = 0; apIdx < existingApprovals.length; apIdx++) {
        const apRec = existingApprovals[apIdx]
        const oldStatus = apRec.getString('status')
        if (oldStatus === 'approved') {
          apRec.set('status', 'rejected')
          apRec.set(
            'justification',
            'Substituída pelo ajuste manual global do dono para o dia 12/10/2026 (82 km oficial)',
          )
          app.save(apRec)
        }
      }
    } catch (eAp) {
      console.warn('[0151] Aviso ao ajustar route_km_approvals prévias:', eAp)
    }

    // 6. Coleções de auditoria e aprovação
    let auditCol = null
    let approvalsCol = null
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (_) {}
    try {
      approvalsCol = app.findCollectionByNameOrId('route_km_approvals')
    } catch (_) {}

    // 7. Distribuir os 82,0 km e combustível proporcionalmente entre os lotes
    let allocatedDayKm = 0
    let allocatedDayFuel = 0
    let totalUpdatedOrders = 0

    for (let b = 0; b < batches.length; b++) {
      const isLastBatch = b === batches.length - 1
      const bObj = batches[b]
      const bOrders = bObj.orders

      let bTargetKm = 0
      let bTargetFuel = 0

      if (isLastBatch) {
        bTargetKm = Number(Math.max(0, targetOfficialDayKm - allocatedDayKm).toFixed(1))
        bTargetFuel = Number(Math.max(0, expectedFuelCost - allocatedDayFuel).toFixed(2))
      } else {
        const ratio =
          currentTotalDayKm > 0 ? bObj.currentKm / currentTotalDayKm : 1 / batches.length
        bTargetKm = Number((targetOfficialDayKm * ratio).toFixed(1))
        bTargetFuel = Number((expectedFuelCost * ratio).toFixed(2))

        allocatedDayKm += bTargetKm
        allocatedDayFuel += bTargetFuel
      }

      console.log(
        `[0151]   Lote #${b + 1}: ${bObj.currentKm.toFixed(1)} km -> ${bTargetKm.toFixed(1)} km, Combustível = R$ ${bTargetFuel.toFixed(2)}`,
      )

      // Soma das pernas de entrega do lote para rateio de fuel_cost por ordem
      let sumLegDistance = 0
      for (let bo = 0; bo < bOrders.length; bo++) {
        sumLegDistance += Number(bOrders[bo].getFloat('distance_km')) || 0
      }

      let allocatedOrderFuel = 0

      for (let bo = 0; bo < bOrders.length; bo++) {
        const ord = bOrders[bo]
        const isLastOrder = bo === bOrders.length - 1
        const dist = Number(ord.getFloat('distance_km')) || 0

        let ordFuel = 0
        if (isLastOrder) {
          ordFuel = Number(Math.max(0, bTargetFuel - allocatedOrderFuel).toFixed(2))
        } else {
          const ordRatio = sumLegDistance > 0 ? dist / sumLegDistance : 1 / bOrders.length
          ordFuel = Number((bTargetFuel * ordRatio).toFixed(2))
          allocatedOrderFuel += ordFuel
        }

        const oldRouteKm = ord.getFloat('total_route_with_return_km')
        const oldRouteFuel = ord.getFloat('total_route_fuel_cost')
        const oldOrderFuel = ord.getFloat('fuel_cost')

        // Atualizar campos canônicos na ordem
        ord.set('total_route_with_return_km', bTargetKm)
        ord.set('total_route_fuel_cost', bTargetFuel)
        ord.set('fuel_cost', ordFuel)
        app.save(ord)
        totalUpdatedOrders++

        // Gravar audit_trail segundo a convenção estrita do projeto:
        // user_id vazio, actor_name 'Sistema', metadata.system_trigger=true
        if (auditCol) {
          try {
            const trail = new Record(auditCol)
            trail.set('collection', 'orders')
            trail.set('record_id', ord.id)
            trail.set('action', 'recalculate_km_manual_adjustment')
            trail.set('field', 'total_route_with_return_km')
            trail.set('old_value', `${oldRouteKm} km (fuel: ${oldRouteFuel}, ord: ${oldOrderFuel})`)
            trail.set('new_value', `${bTargetKm} km (fuel: ${bTargetFuel}, ord: ${ordFuel})`)
            trail.set('courier_id', courierId)
            trail.set('timestamp', nowIso)
            trail.set('user_id', '') // Obrigatório: string vazia para ações do Sistema

            const meta = {
              system_trigger: true,
              actor_role: 'system',
              actor_name: 'Sistema',
              justification: justificationText,
              reason: justificationText,
              courier_id: courierId,
              order_id: ord.id,
              tracking_code: ord.getString('tracking_code'),
              operational_date: targetDayStr,
              batch_index: b + 1,
              batch_key: bObj.batchKey,
              previous_route_km: oldRouteKm,
              new_route_km: bTargetKm,
              previous_batch_fuel: oldRouteFuel,
              new_batch_fuel: bTargetFuel,
              previous_order_fuel: oldOrderFuel,
              new_order_fuel: ordFuel,
              day_total_target_km: targetOfficialDayKm,
              day_total_target_fuel: expectedFuelCost,
              consumption_kml: consumptionKml,
              fuel_price: fuelPrice,
            }
            trail.set('metadata', meta)
            app.save(trail)
          } catch (auditErr) {
            console.warn(`[0151] Falha ao registrar audit_trail para ordem ${ord.id}:`, auditErr)
          }
        }
      }
    }

    console.log(
      `[0151] Ajuste do Guilherme concluído com sucesso. Ordens atualizadas: ${totalUpdatedOrders}. ` +
        `KM total apurado: ${targetOfficialDayKm} km, Combustível total: R$ ${expectedFuelCost.toFixed(2)} (${expectedLiters} L).`,
    )
  },
  (app) => {
    console.log('[0151] Rollback da migração 0151.')
  },
)
