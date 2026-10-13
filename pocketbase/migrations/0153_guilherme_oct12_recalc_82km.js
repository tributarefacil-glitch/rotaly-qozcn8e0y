/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0153_guilherme_oct12_recalc_82km.js
 *
 * Ajuste único de dados do dia 12/10/2026 para o entregador Guilherme de Paiva (u6zr2qtcos1ljxd).
 * O dono decidiu: pagar 82,0 km ao entregador Guilherme de Paiva pelo dia 12/10/2026,
 * valendo para km rodado (pagamento) E para o cálculo de combustível.
 *
 * Contexto: o dia dele fechou com telemetria GPS de 68,8 km (cobertura perdida no fim — celular com bateria 10%)
 * e odômetro/informado de ~86 km. O dono aprovou 82 km como ajuste manual.
 *
 * Parâmetros reais obtidos de app_settings (key = 'global_settings'):
 * moto_consumption_kml: 30 km/L (fallback 40 km/L)
 * moto_fuel_price: R$ 6,49 (fallback R$ 6,09)
 *
 * Audit trail: user_id vazio (''), actor_name 'Sistema', metadata.system_trigger=true,
 * justificativa: 'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'
 */

migrate(
  (app) => {
    const courierId = 'u6zr2qtcos1ljxd'
    const targetOfficialDayKm = 82.0
    const justificationText =
      'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'
    const nowIso = new Date().toISOString()
    const targetDayStr = '2026-10-12'

    // 1. Ler parâmetros reais em app_settings usando SDK Record API (evita bug de ponteiro do dbx)
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
      console.log('[0153] Erro lendo app_settings, usando fallback:', eSettings)
    }

    const totalLiters = Number((targetOfficialDayKm / consumptionKml).toFixed(2))
    const totalFuelCost = Number((totalLiters * fuelPrice).toFixed(2))

    console.log(
      `[0153] Guilherme 12/10/2026 -> Config: ${consumptionKml} km/L, R$ ${fuelPrice.toFixed(2)}/L -> Meta: ${targetOfficialDayKm} km, ${totalLiters} L, R$ ${totalFuelCost.toFixed(2)}`,
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

    // 2. Buscar ordens do Guilherme em 12/10/2026 via findRecordsByFilter
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

    if (dayOrders.length === 0) {
      console.log('[0153] Nenhuma ordem encontrada em 12/10/2026!')
      return
    }

    console.log(`[0153] Ordens encontradas para o dia 12/10: ${dayOrders.length}`)

    // 3. Agrupar em lotes (2 min tolerância de route_started_at)
    const batches = []
    for (let i = 0; i < dayOrders.length; i++) {
      const ord = dayOrders[i]
      const tRaw = ord.getString('route_started_at') || ord.getString('created')
      const ts = tRaw ? new Date(tRaw).getTime() : 0

      let targetB = null
      for (let b = 0; b < batches.length; b++) {
        if (Math.abs(batches[b].startTime - ts) <= 2 * 60 * 1000) {
          targetB = batches[b]
          break
        }
      }

      if (targetB) {
        targetB.orders.push(ord)
      } else {
        const startMin = Math.floor(ts / 60000)
        batches.push({
          startTime: ts,
          batchKey: `rb_${courierId}_${targetDayStr}_${startMin}`,
          orders: [ord],
        })
      }
    }

    batches.sort((a, b) => a.startTime - b.startTime)

    // 4. Calcular pesos atuais de cada lote
    let sumCurrentKm = 0
    for (let b = 0; b < batches.length; b++) {
      let bMax = 0
      let bSumDist = 0
      for (let o = 0; o < batches[b].orders.length; o++) {
        const ord = batches[b].orders[o]
        const rKm = ord.getFloat('total_route_with_return_km')
        const dKm = ord.getFloat('distance_km')
        if (rKm > bMax) bMax = rKm
        bSumDist += dKm
      }
      const bKm = bMax > 0 ? bMax : Math.max(bSumDist, 1.0)
      batches[b].currentKm = bKm
      sumCurrentKm += bKm
    }

    let auditCol = null
    try {
      auditCol = app.findCollectionByNameOrId('audit_trail')
    } catch (_) {}

    // 5. Atualizar ordens e gravar audit_trail
    let allocatedBatchKm = 0
    let allocatedBatchFuel = 0
    let totalUpdated = 0

    for (let b = 0; b < batches.length; b++) {
      const bObj = batches[b]
      const isLastBatch = b === batches.length - 1

      let bNewKm = 0
      let bNewFuel = 0

      if (isLastBatch) {
        bNewKm = Number(Math.max(0, targetOfficialDayKm - allocatedBatchKm).toFixed(1))
        bNewFuel = Number(Math.max(0, totalFuelCost - allocatedBatchFuel).toFixed(2))
      } else {
        const ratio = sumCurrentKm > 0 ? bObj.currentKm / sumCurrentKm : 1 / batches.length
        bNewKm = Number((targetOfficialDayKm * ratio).toFixed(1))
        bNewFuel = Number((totalFuelCost * ratio).toFixed(2))
        allocatedBatchKm += bNewKm
        allocatedBatchFuel += bNewFuel
      }

      let sumLegDistance = 0
      for (let o = 0; o < bObj.orders.length; o++) {
        sumLegDistance += Number(bObj.orders[o].getFloat('distance_km')) || 0
      }

      let allocatedOrderFuel = 0

      for (let o = 0; o < bObj.orders.length; o++) {
        const ord = bObj.orders[o]
        const isLastOrder = o === bObj.orders.length - 1
        const legDist = Number(ord.getFloat('distance_km')) || 0

        let ordFuel = 0
        if (isLastOrder) {
          ordFuel = Number(Math.max(0, bNewFuel - allocatedOrderFuel).toFixed(2))
        } else {
          const ordRatio = sumLegDistance > 0 ? legDist / sumLegDistance : 1 / bObj.orders.length
          ordFuel = Number((bNewFuel * ordRatio).toFixed(2))
          allocatedOrderFuel += ordFuel
        }

        const oldKm = ord.getFloat('total_route_with_return_km')
        const oldRouteFuel = ord.getFloat('total_route_fuel_cost')
        const oldOrdFuel = ord.getFloat('fuel_cost')

        // Atualizar campos da ordem
        try {
          ord.set('total_route_with_return_km', bNewKm)
          ord.set('total_route_fuel_cost', bNewFuel)
          ord.set('fuel_cost', ordFuel)
          app.save(ord)
          totalUpdated++
        } catch (eSave) {
          console.log('[0153] Erro ao salvar ordem ' + ord.id + ':', eSave)
        }

        // Gravar audit_trail segundo a convenção estrita:
        // user_id vazio (''), actor_name 'Sistema', metadata.system_trigger=true
        if (auditCol) {
          try {
            const trail = new Record(auditCol)
            trail.set('collection', 'orders')
            trail.set('record_id', ord.id)
            trail.set('action', 'recalculate_km_manual_adjustment')
            trail.set('field', 'total_route_with_return_km')
            trail.set('old_value', `${oldKm} km (fuel: R$ ${oldRouteFuel}, ord: R$ ${oldOrdFuel})`)
            trail.set('new_value', `${bNewKm} km (fuel: R$ ${bNewFuel}, ord: R$ ${ordFuel})`)
            trail.set('courier_id', courierId)
            trail.set('timestamp', nowIso)
            trail.set('user_id', '') // String vazia obrigatória

            const metaPayload = {
              system_trigger: true,
              actor_role: 'system',
              actor_name: 'Sistema',
              justification: justificationText,
              reason: justificationText,
              courier_id: courierId,
              order_id: ord.id,
              tracking_code: ord.getString('tracking_code'),
              date: targetDayStr,
              batch_index: b + 1,
              batch_key: bObj.batchKey,
              km_antes: oldKm,
              km_depois: bNewKm,
              fuel_antes: oldRouteFuel,
              fuel_depois: bNewFuel,
              day_target_km: targetOfficialDayKm,
              day_target_fuel_cost: totalFuelCost,
              day_target_fuel_liters: totalLiters,
              consumption_kml: consumptionKml,
              fuel_price: fuelPrice,
            }
            trail.set('metadata', metaPayload)
            app.save(trail)
          } catch (eAudit) {
            console.log('[0153] Erro ao salvar audit_trail para ' + ord.id + ':', eAudit)
          }
        }
      }
    }

    // 6. Atualizar ou rejeitar route_km_approvals prévios de 12/10
    try {
      const approvals = app.findRecordsByFilter(
        'route_km_approvals',
        `courier_id = '${courierId}' && created >= '2026-10-12 00:00:00.000Z' && created <= '2026-10-13 04:00:00.000Z'`,
        '-created',
        100,
        0,
      )
      for (let a = 0; a < approvals.length; a++) {
        const ap = approvals[a]
        if (ap.getString('status') === 'approved') {
          ap.set('status', 'rejected')
          ap.set(
            'justification',
            'Substituído pelo ajuste manual global do dono para o dia 12/10/2026 (82 km oficial)',
          )
          app.save(ap)
        }
      }
    } catch (eAp) {
      console.log('[0153] Erro em route_km_approvals:', eAp)
    }

    console.log(
      `[0153] Concluído! Guilherme 12/10/2026: 82 km oficial, ${totalLiters} L, R$ ${totalFuelCost.toFixed(2)}. Ordens atualizadas: ${totalUpdated}.`,
    )
  },
  (app) => {
    console.log('[0153] Rollback.')
  },
)
