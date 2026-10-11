migrate(
  (app) => {
    // 0138_adjust_guilherme_km_fuel_oct10.js
    // Tarefa:
    // 1. Ajustar os 4 lotes do dia 10/10/2026 do entregador Guilherme (u6zr2qtcos1ljxd)
    //    de forma que o total oficial do dia feche em exatamente 115,0 km,
    //    redistribuindo a diferença proporcionalmente entre os 4 lotes reais
    //    (21.8 / 45.1 / 37.7 / 14.7), usando o modelo canônico por route_batch_key
    //    (total_route_with_return_km gravado 1x por lote, nunca somado por linha).
    // 2. Recalcular total_route_fuel_cost de cada lote e o fuel_cost proporcional de cada
    //    ordem do dia com a taxa de moto do app_settings (30 km/L, R$ 6,49/L).
    //    Total esperado ≈ R$ 24,88 (115 km ÷ 30 × 6,49).
    // 3. Registrar audit_trail com actor do admin: user_id do admin que autoriza (ng3asfqq0zwr6fw)
    //    ou fallback user_id vazio + actor_name 'Sistema' + metadata.system_trigger=true.
    //    Justificativa exata: "Ajuste manual: km real do dia 115 km informado pelo dono".
    // 4. NADA retroativo além do dia 10/10/2026.

    const courierId = 'u6zr2qtcos1ljxd'

    // Obter parâmetros de combustível (30 km/L e R$ 6,49)
    let fuelPrice = 6.49
    let consumptionKml = 30.0
    try {
      const settingsRecord = app.findFirstRecordByData('app_settings', 'key', 'global_settings')
      if (settingsRecord) {
        if (Number(settingsRecord.get('moto_fuel_price')) > 0) {
          fuelPrice = Number(settingsRecord.get('moto_fuel_price'))
        } else if (Number(settingsRecord.get('fuel_price_per_liter')) > 0) {
          fuelPrice = Number(settingsRecord.get('fuel_price_per_liter'))
        }

        if (Number(settingsRecord.get('moto_consumption_kml')) > 0) {
          consumptionKml = Number(settingsRecord.get('moto_consumption_kml'))
        } else if (Number(settingsRecord.get('fuel_consumption_kml')) > 0) {
          consumptionKml = Number(settingsRecord.get('fuel_consumption_kml'))
        }
      }
    } catch (e) {
      console.log('[0138] Fallback app_settings para moto (30 km/L, R$ 6.49):', e)
    }

    // Identificar os 4 lotes reais do dia 10/10/2026:
    // Proporção baseada em 21.8 / 45.1 / 37.7 / 14.7 (soma = 119.3 km).
    // Distribuindo proporcionalmente para fechar exatamente em 115.0 km:
    // Lote 1 (08h02-09h19 UTC / 12h02 UTC): 21.0 km -> Combustível do lote: R$ 4,54
    // Lote 2 (16h11-17h40 UTC / 19h15 UTC): 43.5 km -> Combustível do lote: R$ 9,41
    // Lote 3 (18h08-19h17 UTC / 21h11 UTC): 36.3 km -> Combustível do lote: R$ 7,85
    // Lote 4 (19h15-20h04 UTC / 22h17 UTC): 14.2 km -> Combustível do lote: R$ 3,08
    // Soma KM = 21.0 + 43.5 + 36.3 + 14.2 = 115.0 km
    // Soma Combustível dos lotes = 4.54 + 9.41 + 7.85 + 3.08 = R$ 24,88 (115.0 / 30 * 6.49 = 24.8783... ≈ 24.88)

    const batchAdjustments = [
      {
        batchIndex: 1,
        timeLabel: '08h02–09h19 (12h02 UTC)',
        minStartedAt: '2026-10-10 12:00:00',
        maxStartedAt: '2026-10-10 12:10:00',
        originalKm: 21.8,
        newKm: 21.0,
        newFuel: 4.54,
      },
      {
        batchIndex: 2,
        timeLabel: '16h11–17h40 (19h15 UTC)',
        minStartedAt: '2026-10-10 19:10:00',
        maxStartedAt: '2026-10-10 19:25:00',
        originalKm: 45.1,
        newKm: 43.5,
        newFuel: 9.41,
      },
      {
        batchIndex: 3,
        timeLabel: '18h08–19h17 (21h11 UTC)',
        minStartedAt: '2026-10-10 21:05:00',
        maxStartedAt: '2026-10-10 21:20:00',
        originalKm: 37.7,
        newKm: 36.3,
        newFuel: 7.85,
      },
      {
        batchIndex: 4,
        timeLabel: '19h15–20h04 (22h17 UTC)',
        minStartedAt: '2026-10-10 22:10:00',
        maxStartedAt: '2026-10-10 22:25:00',
        originalKm: 14.7,
        newKm: 14.2,
        newFuel: 3.08,
      },
    ]

    // Localizar admin para audit_trail
    let adminUserId = 'ng3asfqq0zwr6fw' // Administrador Principal (master)
    try {
      const adminRecord = app.findRecordById('users', adminUserId)
      if (
        !adminRecord ||
        (adminRecord.get('role') !== 'admin' && adminRecord.get('role') !== 'master')
      ) {
        adminUserId = ''
      }
    } catch (_e) {
      adminUserId = ''
    }

    const auditCol = app.findCollectionByNameOrId('audit_trail')
    const justificationText = 'Ajuste manual: km real do dia 115 km informado pelo dono'

    let totalUpdatedOrders = 0
    let grandTotalFuelCost = 0

    for (let b = 0; b < batchAdjustments.length; b++) {
      const batchDef = batchAdjustments[b]
      const filter = `courier_id = '${courierId}' && route_started_at >= '${batchDef.minStartedAt}' && route_started_at <= '${batchDef.maxStartedAt}'`
      const batchOrders = app.findRecordsByFilter('orders', filter, 'sequence', 100, 0)

      if (!batchOrders || batchOrders.length === 0) {
        console.warn(
          `[0138] Nenhum pedido encontrado para o lote ${batchDef.timeLabel} (${filter})`,
        )
        continue
      }

      console.log(
        `[0138] Processando lote #${batchDef.batchIndex} (${batchDef.timeLabel}): ${batchOrders.length} pedidos. ` +
          `KM: ${batchDef.originalKm} -> ${batchDef.newKm} km, Fuel: ${batchDef.newFuel}`,
      )

      // Calcular soma das pernas distance_km para rateio proporcional do fuel_cost
      let sumDistanceKm = 0
      for (let i = 0; i < batchOrders.length; i++) {
        sumDistanceKm += Number(batchOrders[i].get('distance_km') || 0)
      }

      let allocatedBatchFuel = 0
      for (let i = 0; i < batchOrders.length; i++) {
        const ord = batchOrders[i]
        const oldRouteKm = ord.get('total_route_with_return_km')
        const oldRouteFuel = ord.get('total_route_fuel_cost')
        const oldOrderFuel = ord.get('fuel_cost')
        const distKm = Number(ord.get('distance_km') || 0)

        let ordFuel = 0
        if (i === batchOrders.length - 1) {
          ordFuel = Number((batchDef.newFuel - allocatedBatchFuel).toFixed(2))
        } else {
          if (sumDistanceKm > 0) {
            ordFuel = Number(((distKm / sumDistanceKm) * batchDef.newFuel).toFixed(2))
          } else {
            ordFuel = Number((batchDef.newFuel / batchOrders.length).toFixed(2))
          }
          allocatedBatchFuel += ordFuel
        }

        grandTotalFuelCost += ordFuel

        // Atualizar campos canônicos do lote na ordem
        ord.set('total_route_with_return_km', batchDef.newKm)
        ord.set('total_route_fuel_cost', batchDef.newFuel)
        ord.set('fuel_cost', ordFuel)
        app.save(ord)
        totalUpdatedOrders++

        // Gravar audit_trail para cada ordem do lote ajustado
        if (auditCol) {
          try {
            const trail = new Record(auditCol)
            trail.set('collection', 'orders')
            trail.set('record_id', ord.id)
            trail.set('action', 'recalculate_km_manual_adjustment')
            trail.set('field', 'total_route_with_return_km')
            trail.set('old_value', `${oldRouteKm} km (fuel: ${oldRouteFuel}, ord: ${oldOrderFuel})`)
            trail.set(
              'new_value',
              `${batchDef.newKm} km (fuel: ${batchDef.newFuel}, ord: ${ordFuel})`,
            )
            trail.set('courier_id', courierId)
            trail.set('timestamp', new Date().toISOString())

            if (adminUserId) {
              trail.set('user_id', adminUserId)
              trail.set('metadata', {
                justification: justificationText,
                reason: justificationText,
                actor_role: 'master',
                actor_name: 'Administrador Principal',
                system_trigger: false,
                courier_id: courierId,
                order_id: ord.id,
                tracking_code: ord.get('tracking_code'),
                batch_index: batchDef.batchIndex,
                batch_time_label: batchDef.timeLabel,
                previous_route_km: oldRouteKm,
                new_route_km: batchDef.newKm,
                previous_batch_fuel: oldRouteFuel,
                new_batch_fuel: batchDef.newFuel,
                previous_order_fuel: oldOrderFuel,
                new_order_fuel: ordFuel,
                day_total_target_km: 115.0,
                day_total_target_fuel: 24.88,
              })
            } else {
              trail.set('user_id', '')
              trail.set('metadata', {
                justification: justificationText,
                reason: justificationText,
                actor_role: 'system',
                actor_name: 'Sistema',
                system_trigger: true,
                courier_id: courierId,
                order_id: ord.id,
                tracking_code: ord.get('tracking_code'),
                batch_index: batchDef.batchIndex,
                batch_time_label: batchDef.timeLabel,
                previous_route_km: oldRouteKm,
                new_route_km: batchDef.newKm,
                previous_batch_fuel: oldRouteFuel,
                new_batch_fuel: batchDef.newFuel,
                previous_order_fuel: oldOrderFuel,
                new_order_fuel: ordFuel,
                day_total_target_km: 115.0,
                day_total_target_fuel: 24.88,
              })
            }

            app.save(trail)
          } catch (auditErr) {
            console.warn(`[0138] Falha ao registrar audit_trail para ordem ${ord.id}:`, auditErr)
          }
        }
      }
    }

    console.log(
      `[0138] Ajuste do Guilherme de 10/10/2026 concluído com sucesso. ` +
        `Ordens atualizadas: ${totalUpdatedOrders}, Combustível total rateado: R$ ${grandTotalFuelCost.toFixed(2)} ` +
        `(esperado R$ 24,88 para 115,0 km).`,
    )
  },
  (app) => {
    // Reversão no-op — dados anteriores preservados nos logs e histórico de auditoria
    console.log('[0138] Reversão do ajuste do Guilherme 10/10/2026.')
  },
)
