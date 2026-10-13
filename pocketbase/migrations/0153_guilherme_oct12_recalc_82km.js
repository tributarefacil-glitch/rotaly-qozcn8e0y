/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0153_guilherme_oct12_recalc_82km.js
 *
 * Ajuste único de dados do dia 12/10/2026 para o entregador Guilherme de Paiva (u6zr2qtcos1ljxd).
 * O dono decidiu: pagar 82 km ao entregador Guilherme de Paiva pelo dia 12/10/2026,
 * valendo para km rodado (pagamento) E para o cálculo de combustível.
 *
 * Contexto: o dia dele fechou com telemetria GPS de 68,8 km (cobertura perdida no fim — celular com bateria 10%)
 * e odômetro/informado de ~86 km. O dono aprovou 82 km como ajuste manual.
 *
 * Moto 40 km/L, preço R$ 6,09:
 * 82,0 km / 40 km/L = 2,05 L -> 2,05 L * R$ 6,09 = R$ 12,48
 *
 * Audit trail: user_id vazio, actor_name 'Sistema', metadata.system_trigger=true,
 * justificativa: 'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'
 */

migrate(
  (app) => {
    const courierId = 'u6zr2qtcos1ljxd'
    const targetOfficialDayKm = 82.0
    const justificationText =
      'Ajuste manual do dono — telemetria 68,8 com lacuna de cobertura (bateria 10%), odômetro 86, aprovado 82'
    const nowIso = new Date().toISOString()

    // 1. Ler parâmetros reais em app_settings
    let consumptionKml = 40.0
    let fuelPrice = 6.09

    try {
      const settingsRows = app
        .db()
        .newQuery("SELECT * FROM app_settings WHERE key = 'global_settings' LIMIT 1")
        .all()
      if (settingsRows && settingsRows.length > 0) {
        const s = settingsRows[0]
        const p = Number(s.moto_fuel_price || s.fuel_price_per_liter)
        const c = Number(s.moto_consumption_kml || s.fuel_consumption_kml)
        if (p > 0) fuelPrice = p
        if (c > 0) consumptionKml = c
      }
    } catch (eSettings) {
      console.log('[0153] Erro lendo app_settings:', eSettings)
    }

    const totalLiters = Number((targetOfficialDayKm / consumptionKml).toFixed(2))
    const totalFuelCost = Number((totalLiters * fuelPrice).toFixed(2))

    // 2. Buscar ordens do Guilherme em 12/10/2026
    const ordersQuery =
      'SELECT id, tracking_code, sequence, distance_km, total_route_with_return_km, fuel_cost, total_route_fuel_cost, route_started_at, created ' +
      'FROM orders ' +
      "WHERE courier_id = '" +
      courierId +
      "' " +
      "AND ((route_started_at >= '2026-10-12 00:00:00' AND route_started_at <= '2026-10-13 03:00:00') " +
      "OR (created >= '2026-10-12 00:00:00' AND created <= '2026-10-13 03:00:00')) " +
      'ORDER BY route_started_at ASC, created ASC, sequence ASC'

    const orderRows = app.db().newQuery(ordersQuery).all()
    if (!orderRows || orderRows.length === 0) {
      console.log('[0153] Nenhuma ordem encontrada em 12/10/2026!')
      return
    }

    // 3. Agrupar em lotes (2 min tolerância de route_started_at)
    const batches = []
    for (let i = 0; i < orderRows.length; i++) {
      const row = orderRows[i]
      const tRaw = row.route_started_at || row.created
      const ts = tRaw ? new Date(tRaw).getTime() : 0

      let targetB = null
      for (let b = 0; b < batches.length; b++) {
        if (Math.abs(batches[b].startTime - ts) <= 2 * 60 * 1000) {
          targetB = batches[b]
          break
        }
      }

      if (targetB) {
        targetB.orders.push(row)
      } else {
        const startMin = Math.floor(ts / 60000)
        batches.push({
          startTime: ts,
          batchKey: 'rb_' + courierId + '_2026-10-12_' + startMin,
          orders: [row],
        })
      }
    }

    // 4. Calcular pesos atuais
    let sumCurrentKm = 0
    for (let b = 0; b < batches.length; b++) {
      let bMax = 0
      let bSumDist = 0
      for (let o = 0; o < batches[b].orders.length; o++) {
        const ord = batches[b].orders[o]
        const rKm = Number(ord.total_route_with_return_km) || 0
        const dKm = Number(ord.distance_km) || 0
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
        sumLegDistance += Number(bObj.orders[o].distance_km) || 0
      }

      let allocatedOrderFuel = 0

      for (let o = 0; o < bObj.orders.length; o++) {
        const ord = bObj.orders[o]
        const isLastOrder = o === bObj.orders.length - 1
        const legDist = Number(ord.distance_km) || 0

        let ordFuel = 0
        if (isLastOrder) {
          ordFuel = Number(Math.max(0, bNewFuel - allocatedOrderFuel).toFixed(2))
        } else {
          const ordRatio = sumLegDistance > 0 ? legDist / sumLegDistance : 1 / bObj.orders.length
          ordFuel = Number((bNewFuel * ordRatio).toFixed(2))
          allocatedOrderFuel += ordFuel
        }

        const oldKm = Number(ord.total_route_with_return_km) || 0
        const oldRouteFuel = Number(ord.total_route_fuel_cost) || 0
        const oldOrdFuel = Number(ord.fuel_cost) || 0

        // Atualizar ordem
        try {
          const orderRecord = app.findRecordById('orders', ord.id)
          if (orderRecord) {
            orderRecord.set('total_route_with_return_km', bNewKm)
            orderRecord.set('total_route_fuel_cost', bNewFuel)
            orderRecord.set('fuel_cost', ordFuel)
            app.save(orderRecord)
            totalUpdated++
          }
        } catch (eSave) {
          console.log('[0153] Erro ao salvar ordem ' + ord.id + ':', eSave)
        }

        // Gravar audit_trail
        if (auditCol) {
          try {
            const trail = new Record(auditCol)
            trail.set('collection', 'orders')
            trail.set('record_id', ord.id)
            trail.set('action', 'recalculate_km_manual_adjustment')
            trail.set('field', 'total_route_with_return_km')
            trail.set('old_value', oldKm + ' km (fuel: R$ ' + oldRouteFuel + ')')
            trail.set('new_value', bNewKm + ' km (fuel: R$ ' + bNewFuel + ')')
            trail.set('courier_id', courierId)
            trail.set('timestamp', nowIso)
            trail.set('user_id', '')

            const metaPayload = {
              system_trigger: true,
              actor_role: 'system',
              actor_name: 'Sistema',
              justification: justificationText,
              reason: justificationText,
              courier_id: courierId,
              order_id: ord.id,
              tracking_code: ord.tracking_code,
              date: '2026-10-12',
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
            trail.set('metadata', JSON.stringify(metaPayload))
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
        "courier_id = '" +
          courierId +
          "' && created >= '2026-10-12 00:00:00' && created <= '2026-10-13 03:00:00' && status = 'approved'",
        '-created',
        100,
        0,
      )
      for (let a = 0; a < approvals.length; a++) {
        const ap = approvals[a]
        ap.set('status', 'rejected')
        ap.set(
          'justification',
          'Substituído pelo ajuste manual global do dono para o dia 12/10/2026 (82 km oficial)',
        )
        app.save(ap)
      }
    } catch (eAp) {
      console.log('[0153] Erro em route_km_approvals:', eAp)
    }

    console.log(
      `[0153] Concluído! Guilherme 12/10/2026: 82 km, ${totalLiters} L, R$ ${totalFuelCost.toFixed(2)}. Ordens atualizadas: ${totalUpdated}.`,
    )
  },
  (app) => {
    console.log('[0153] Rollback.')
  },
)
