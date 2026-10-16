/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0177:
 * Recalcula gasto/saldo/km oficial do período de todos os couriers a partir exclusivamente da fonte canônica:
 * - Registros de route_batch_telemetry dedup 1x por route_batch_key (com km_oficial auditado)
 * - Teto de coerência: rejeitar fonte com km > 2x viário
 * - Regra do MENOR e aprovação manual do admin preservadas
 * - Desvio de rota NUNCA vira km pago, combustível ou desconto
 * - Grava audit_trail com user_id vazio, actor_name='Sistema', metadata.system_trigger=true
 */
migrate(
  (app) => {
    function recordAudit(recordId, action, fieldName, oldValue, newValue, metadata) {
      try {
        const auditCollection = app.findCollectionByNameOrId('audit_trail')
        const record = new Record(auditCollection)
        record.set('user_id', '') // Ações automáticas do sistema = user_id vazio
        record.set('collection', 'users')
        record.set('record_id', recordId || '')
        record.set('action', action)
        record.set('field', fieldName)
        record.set('old_value', String(oldValue ?? ''))
        record.set('new_value', String(newValue ?? ''))
        record.set('courier_id', recordId || '')
        record.set('timestamp', new Date().toISOString())
        record.set('metadata', {
          ...(metadata || {}),
          actor_name: 'Sistema',
          actor_role: 'system',
          system_trigger: true,
          migration: '0177_recalculate_canonical_courier_totals',
        })
        app.save(record)
      } catch (err) {
        console.warn('[0177] Erro ao gravar audit_trail:', err)
      }
    }

    // 1. Obter app_settings global
    let defaultMotoKml = 30.0
    let defaultMotoPrice = 6.49
    try {
      const settingsRec = app.findFirstRecordByFilter('app_settings', "key = 'global_settings'")
      if (settingsRec) {
        const fuelMoto =
          settingsRec.getFloat('fuel_consumption_moto_kml') ||
          settingsRec.getFloat('fuel_price_gasoline')
        const price =
          settingsRec.getFloat('fuel_price_per_liter') ||
          settingsRec.getFloat('fuel_price_gasoline')
        if (fuelMoto > 0) defaultMotoKml = fuelMoto
        if (price > 0) defaultMotoPrice = price
      }
    } catch (_) {}

    // 2. Buscar todos os entregadores (users role='courier')
    const couriers = app.findRecordsByFilter('users', "role = 'courier'", 'name', 500, 0)

    console.log(`[0177] Iniciando recálculo canônico para ${couriers.length} couriers...`)
    let couriersRecalculatedCount = 0

    for (const courier of couriers) {
      const cId = courier.id
      const cName = courier.getString('name')
      const vehicleType = courier.getString('vehicle_type') || 'moto'
      const isBicycle = vehicleType === 'bicicleta' || vehicleType === 'bicycle'

      const consumptionKml =
        courier.getFloat('consumption_kml') > 0
          ? courier.getFloat('consumption_kml')
          : defaultMotoKml

      const pricePerLiter =
        courier.getFloat('fuel_price') > 0 ? courier.getFloat('fuel_price') : defaultMotoPrice

      const openingBalance = courier.getFloat('opening_balance') || 0
      const cutoffDateStr = courier.getString('cutoff_date') || ''
      const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
      const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)

      // 2a. Buscar lotes de telemetria do courier
      const batches = app.findRecordsByFilter(
        'route_batch_telemetry',
        `courier_id = '${cId}'`,
        '-created',
        1000,
        0,
      )

      // Deduplicação 1x por route_batch_key
      const uniqueBatchesMap = new Map()
      for (const b of batches) {
        const bKey = b.getString('route_batch_key')
        if (bKey && !uniqueBatchesMap.has(bKey)) {
          uniqueBatchesMap.set(bKey, b)
        }
      }

      // Buscar adiantamentos ativos do courier
      const advances = app.findRecordsByFilter(
        'fuel_advances',
        `courier_id = '${cId}' && status != 'cancelled'`,
        '-created',
        1000,
        0,
      )

      // Adiantamentos pós-corte (excluindo balance_adjustment)
      let postCutoffAdvancesTotal = 0
      for (const adv of advances) {
        const eType = adv.getString('entry_type')
        if (eType === 'balance_adjustment') continue
        if (eType && eType !== 'advance') continue

        const advDateStr = adv.getString('date') || adv.getString('created')
        const advTs = new Date(advDateStr).getTime()
        if (!hasCutoff || advTs >= cutoffTime) {
          postCutoffAdvancesTotal += adv.getFloat('amount') || 0
        }
      }

      // Processar KM Oficial Canônico dos lotes
      let totalOfficialKmAll = 0
      let totalOfficialKmPostCutoff = 0
      let totalDeviationEpisodes = 0
      let maxDeviationMeters = 0

      uniqueBatchesMap.forEach((batchRec, bKey) => {
        let viario = batchRec.getFloat('km_viario_total') || 0
        let gps = batchRec.getFloat('km_gps_total') || 0
        let oficial = batchRec.getFloat('km_oficial') || 0

        // Guarda de sanidade: rejeitar GPS > 2x viário
        if (viario > 0 && gps > viario * 2) {
          gps = Number((viario * 1.15).toFixed(2))
        }
        if (oficial <= 0 || (viario > 0 && oficial > viario * 2)) {
          oficial = viario > 0 ? (gps > 0 ? Math.min(viario, gps) : viario) : gps
        }
        oficial = Number(oficial.toFixed(2))

        // Desvios: apenas contagem e máxima distância
        try {
          const rawDev = batchRec.get('deviation_classification')
          if (Array.isArray(rawDev)) {
            totalDeviationEpisodes += rawDev.length
            for (const d of rawDev) {
              const dist = Number(d.max_deviation_meters) || 0
              if (dist > maxDeviationMeters) maxDeviationMeters = dist
            }
          }
        } catch (_) {}

        totalOfficialKmAll += oficial

        const dateVal = batchRec.getString('route_finished_at') || batchRec.getString('created')
        const dateTs = new Date(dateVal).getTime()
        if (!hasCutoff || dateTs >= cutoffTime) {
          totalOfficialKmPostCutoff += oficial
        }
      })

      // Cálculo de Combustível e Gasto
      const postCutoffFuelSpent =
        !isBicycle && consumptionKml > 0
          ? Number(((totalOfficialKmPostCutoff / consumptionKml) * pricePerLiter).toFixed(2))
          : 0

      const canonicalBalance = Number(
        (openingBalance + postCutoffAdvancesTotal - postCutoffFuelSpent).toFixed(2),
      )

      // Valores anteriores para auditoria
      const oldBalance = courier.getFloat('current_balance') || 0

      recordAudit(
        cId,
        'recalculo_canonico_totais_courier_0177',
        'current_balance',
        oldBalance,
        canonicalBalance,
        {
          courier_id: cId,
          courier_name: cName,
          vehicle_type: vehicleType,
          consumption_kml: consumptionKml,
          fuel_price_per_liter: pricePerLiter,
          total_official_km_all: Number(totalOfficialKmAll.toFixed(2)),
          total_official_km_post_cutoff: Number(totalOfficialKmPostCutoff.toFixed(2)),
          post_cutoff_advances_total: Number(postCutoffAdvancesTotal.toFixed(2)),
          post_cutoff_fuel_spent: postCutoffFuelSpent,
          canonical_balance: canonicalBalance,
          batches_count: uniqueBatchesMap.size,
          deviation_episodes_count: totalDeviationEpisodes,
          max_deviation_meters: maxDeviationMeters,
        },
      )

      couriersRecalculatedCount++
    }

    console.log(
      `[0177] Concluído: ${couriersRecalculatedCount} couriers recalculados a partir da fonte canônica.`,
    )
  },
  (app) => {
    // Idempotente
  },
)
