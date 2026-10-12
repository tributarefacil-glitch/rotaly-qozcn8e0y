/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0141_reconcile_guilherme_october_official_numbers.js
 *
 * Reconciliação dos números oficiais de KM, gasto e saldo do entregador GUILHERME (u6zr2qtcos1ljxd)
 * para OUTUBRO de 2026.
 * Fonte soberana: Planilha oficial do usuário (odômetro físico da moto).
 * Os valores da planilha PREVALECEM sobre qualquer cálculo do sistema.
 *
 * RESUMO DOS NÚMEROS OFICIAIS DA PLANILHA (OUTUBRO):
 * - Saldo Abertura (Setembro carregado em 01/10): R$ 42,35
 * - Cutoff date: 2026-10-01 03:00:00.000Z (01/10 00:00:00 em Brasília America/Sao_Paulo)
 * - Adiantamento em 04/10: R$ 200,00 (id n8c3i0yl4fhu6fr)
 * - Demais adiantamentos de outubro: CANCELADOS (para garantir total oficial de adiantamentos = R$ 200,00)
 * - Total de adiantamentos + abertura: 42,35 + 200,00 = R$ 242,35
 *
 * KM e GASTO OFICIAIS POR DIA:
 * - 01/10: 0 km, gasto R$ 0,00
 * - 02/10: 120,0 km, gasto R$ 25,96
 * - 03/10: 0 km, gasto R$ 0,00
 * - 04/10: 59,0 km, gasto R$ 12,76
 * - 05/10: 0 km, gasto R$ 0,00
 * - 06/10: 124,0 km, gasto R$ 26,83
 * - 07/10: 0 km, gasto R$ 0,00
 * - 08/10: 123,0 km, gasto R$ 26,61
 * - 09/10: 0 km, gasto R$ 0,00
 * - 10/10: 115,0 km, gasto R$ 24,88
 * - 11/10 a 31/10: 0 km, gasto R$ 0,00
 *
 * Gasto total de Outubro: 25,96 + 12,76 + 26,83 + 26,61 + 24,88 = R$ 117,04
 * Saldo oficial resultante: 242,35 - 117,04 = R$ 125,31
 *
 * ISOLAMENTO:
 * Apenas o entregador Guilherme (u6zr2qtcos1ljxd) é afetado.
 * Edson (tetrfu5oi19jbwz) e Vinicios (o9nccdbkmc9onh0) permanecem 100% intocados.
 *
 * AUDITORIA (audit_trail):
 * user_id = '', actor_name = 'Sistema', metadata.system_trigger = true,
 * metadata.source = 'planilha_usuario_outubro', com old_value -> new_value.
 */

migrate(
  (app) => {
    const courierId = 'u6zr2qtcos1ljxd'
    const auditCol = app.findCollectionByNameOrId('audit_trail')
    const nowIso = new Date().toISOString()

    console.log('[0141] Iniciando reconciliação oficial do Guilherme para Outubro...')

    function logAudit(collectionName, recordId, action, field, oldValue, newValue, extraMeta) {
      if (!auditCol) return
      try {
        const trail = new Record(auditCol)
        trail.set('collection', collectionName)
        trail.set('record_id', recordId)
        trail.set('action', action)
        trail.set('field', field)
        trail.set('old_value', String(oldValue !== null && oldValue !== undefined ? oldValue : ''))
        trail.set('new_value', String(newValue !== null && newValue !== undefined ? newValue : ''))
        trail.set('courier_id', courierId)
        trail.set('timestamp', nowIso)
        trail.set('user_id', '') // String vazia para ações do Sistema (relação users)

        const meta = {
          actor_name: 'Sistema',
          actor_role: 'system',
          system_trigger: true,
          source: 'planilha_usuario_outubro',
          courier_id: courierId,
          ...extraMeta,
        }
        trail.set('metadata', meta)
        app.save(trail)
      } catch (err) {
        console.warn(`[0141] Falha ao registrar audit_trail (${collectionName}:${recordId}):`, err)
      }
    }

    // =========================================================================
    // 1) FICHA DO GUILHERME (users): opening_balance = 42.35 e cutoff_date = 2026-10-01 03:00:00.000Z
    // =========================================================================
    let courierUser = null
    try {
      courierUser = app.findRecordById('users', courierId)
    } catch (e) {
      console.error(`[0141] Usuário Guilherme (${courierId}) não encontrado:`, e)
      return
    }

    const prevOpeningBalance = courierUser.getFloat('opening_balance')
    const prevCutoffDate = courierUser.getString('cutoff_date')
    const targetOpeningBalance = 42.35
    const targetCutoffDate = '2026-10-01 03:00:00.000Z'

    console.log(
      `[0141] Ficha do Guilherme: opening_balance ${prevOpeningBalance} -> ${targetOpeningBalance}, cutoff_date ${prevCutoffDate} -> ${targetCutoffDate}`,
    )

    courierUser.set('opening_balance', targetOpeningBalance)
    courierUser.set('cutoff_date', targetCutoffDate)
    app.save(courierUser)

    logAudit(
      'users',
      courierId,
      'reconcile_opening_balance',
      'opening_balance',
      prevOpeningBalance,
      targetOpeningBalance,
      {
        description:
          'Ajuste de saldo de abertura de Outubro conforme planilha oficial (saldo de setembro carregado em 01/10)',
      },
    )
    logAudit(
      'users',
      courierId,
      'reconcile_cutoff_date',
      'cutoff_date',
      prevCutoffDate,
      targetCutoffDate,
      {
        description:
          'Ajuste da data de corte para início civil de Outubro em Brasília (2026-10-01 03:00:00.000Z)',
      },
    )

    // =========================================================================
    // 2) ADIANTAMENTOS (fuel_advances):
    //    Garantir lançamento de R$ 200,00 em 04/10 ativo.
    //    CANCELAR qualquer outro adiantamento ativo de Outubro do Guilherme que não conste na planilha.
    //    Total oficial de adiantamentos de Outubro: R$ 242,35 (42,35 abertura + 200,00).
    // =========================================================================
    const userAdvances = app.findRecordsByFilter(
      'fuel_advances',
      `courier_id = '${courierId}'`,
      'date,created',
      500,
      0,
    )

    console.log(`[0141] Adiantamentos encontrados para o Guilherme: ${userAdvances.length}`)

    // Identificar adiantamento legítimo de R$ 200,00 em 04/10
    let advance200Found = false

    for (let i = 0; i < userAdvances.length; i++) {
      const adv = userAdvances[i]
      const advId = adv.id
      const amt = Number(adv.getFloat('amount')) || 0
      const advDate = adv.getString('date') || adv.getString('created') || ''
      const entryType = adv.getString('entry_type') || 'advance'
      const status = adv.getString('status') || 'active'

      // Verificar se o adiantamento pertence ao período pós-corte de Outubro
      // (data >= 2026-10-01 em Brasília)
      const isOctoberAdvance = advDate.startsWith('2026-10')

      if (!isOctoberAdvance) {
        continue
      }

      // Adiantamento legítimo de R$ 200,00 em 04/10
      if (amt === 200 && advDate.startsWith('2026-10-04') && entryType === 'advance') {
        advance200Found = true
        if (status !== 'active') {
          console.log(`[0141] Reativando adiantamento oficial de R$ 200 de 04/10 (${advId})...`)
          adv.set('status', 'active')
          adv.set('cancellation_reason', '')
          adv.set('cancelled_at', '')
          adv.set('cancelled_by', '')
          app.save(adv)

          logAudit('fuel_advances', advId, 'activate_advance', 'status', status, 'active', {
            amount: 200,
            date: advDate,
            reason: 'Reativação de adiantamento oficial de Outubro conforme planilha soberana',
          })
        } else {
          console.log(`[0141] Adiantamento oficial de R$ 200 de 04/10 (${advId}) já está ativo.`)
        }
      } else {
        // Outros lançamentos de outubro (ajustes legados, correções duplicadas, etc.)
        if (status === 'active') {
          console.log(
            `[0141] Cancelando adiantamento/ajuste não-oficial de Outubro: ${advId} (R$ ${amt}, tipo: ${entryType}, data: ${advDate})...`,
          )
          adv.set('status', 'cancelled')
          adv.set(
            'cancellation_reason',
            'Cancelado na reconciliação oficial de Outubro (planilha soberana do usuário prevê apenas R$ 200 em 04/10)',
          )
          adv.set('cancelled_at', nowIso)
          adv.set('cancelled_by', '')
          app.save(adv)

          logAudit('fuel_advances', advId, 'cancel_advance', 'status', 'active', 'cancelled', {
            amount: amt,
            entry_type: entryType,
            date: advDate,
            cancellation_reason:
              'Cancelado na reconciliação oficial de Outubro (planilha soberana do usuário prevê apenas R$ 200 em 04/10)',
          })
        }
      }
    }

    // Se porventura o adiantamento de R$ 200 não existisse, criaria aqui
    if (!advance200Found) {
      console.log('[0141] Criando adiantamento oficial de R$ 200,00 em 04/10...')
      const advCol = app.findCollectionByNameOrId('fuel_advances')
      const newAdv = new Record(advCol)
      newAdv.set('courier_id', courierId)
      newAdv.set('amount', 200.0)
      newAdv.set('date', '2026-10-04 00:00:00.000Z')
      newAdv.set('entry_type', 'advance')
      newAdv.set('status', 'active')
      newAdv.set('payment_method', 'pix')
      newAdv.set('notes', 'Adiantamento oficial de combustível (planilha soberana)')
      newAdv.set('created_by', '')
      app.save(newAdv)

      logAudit('fuel_advances', newAdv.id, 'create_advance', 'amount', 0, 200.0, {
        date: '2026-10-04 00:00:00.000Z',
        reason: 'Criação do adiantamento oficial de R$ 200 de 04/10 conforme planilha soberana',
      })
    }

    // =========================================================================
    // 3) CANCELAMENTO / LIMPEZA DE APROVAÇÕES MANUAIS EM route_km_approvals
    //    Como useCourierFuelMetrics dá precedência a approvalsMap sobre o total_route_with_return_km
    //    do lote quando status === 'approved', devemos revogar aprovações manuais que interfiram
    //    nos dias de Outubro do Guilherme para que a planilha soberana prevaleça 100%.
    // =========================================================================
    try {
      const courierApprovals = app.findRecordsByFilter(
        'route_km_approvals',
        `courier_id = '${courierId}' && status = 'approved'`,
        '-created',
        500,
        0,
      )
      console.log(
        `[0141] Avaliando ${courierApprovals.length} aprovações manuais do Guilherme para revogação...`,
      )
      let revokedApprovalsCount = 0
      for (let apIdx = 0; apIdx < courierApprovals.length; apIdx++) {
        const apRec = courierApprovals[apIdx]
        const apOrderId = apRec.getString('order_id')
        // Checar se a ordem pertence a Outubro/2026
        try {
          const ord = app.findRecordById('orders', apOrderId)
          const ordDate = ord.getString('created') || ord.getString('route_started_at') || ''
          if (ordDate.startsWith('2026-10')) {
            const oldApStatus = apRec.getString('status')
            const oldApKm = apRec.getFloat('approved_km')
            apRec.set('status', 'rejected')
            apRec.set(
              'justification',
              'Revogada pela migração 0141 (soberania da planilha física de odômetro de Outubro)',
            )
            app.save(apRec)
            revokedApprovalsCount++

            logAudit(
              'route_km_approvals',
              apRec.id,
              'revoke_approval',
              'status',
              oldApStatus,
              'rejected',
              {
                order_id: apOrderId,
                approved_km: oldApKm,
                reason:
                  'Revogada pela migração 0141 (soberania da planilha física de odômetro de Outubro)',
              },
            )
          }
        } catch (_) {}
      }
      console.log(`[0141] Aprovações manuais de Outubro revogadas: ${revokedApprovalsCount}`)
    } catch (eAp) {
      console.warn('[0141] Aviso ao verificar route_km_approvals:', eAp)
    }

    // =========================================================================
    // 4) KM E GASTO OFICIAIS POR DIA DE OUTUBRO
    //    Tabela soberana (America/Sao_Paulo):
    //    - 01/10: 0 km, R$ 0,00
    //    - 02/10: 120,0 km, R$ 25,96
    //    - 03/10: 0 km, R$ 0,00
    //    - 04/10: 59,0 km, R$ 12,76
    //    - 05/10: 0 km, R$ 0,00
    //    - 06/10: 124,0 km, R$ 26,83
    //    - 07/10: 0 km, R$ 0,00
    //    - 08/10: 123,0 km, R$ 26,61
    //    - 09/10: 0 km, R$ 0,00
    //    - 10/10: 115,0 km, R$ 24,88 (já calibrado na 0138; confirmação)
    //    - 11/10 a 31/10: 0 km, R$ 0,00
    // =========================================================================

    const dailyOfficialTargets = {
      '2026-10-01': { targetKm: 0.0, targetFuel: 0.0 },
      '2026-10-02': { targetKm: 120.0, targetFuel: 25.96 },
      '2026-10-03': { targetKm: 0.0, targetFuel: 0.0 },
      '2026-10-04': { targetKm: 59.0, targetFuel: 12.76 },
      '2026-10-05': { targetKm: 0.0, targetFuel: 0.0 },
      '2026-10-06': { targetKm: 124.0, targetFuel: 26.83 },
      '2026-10-07': { targetKm: 0.0, targetFuel: 0.0 },
      '2026-10-08': { targetKm: 123.0, targetFuel: 26.61 },
      '2026-10-09': { targetKm: 0.0, targetFuel: 0.0 },
      '2026-10-10': { targetKm: 115.0, targetFuel: 24.88 },
    }

    // Helper para converter UTC timestamp para data civil YYYY-MM-DD em America/Sao_Paulo (UTC-3)
    function getSpCivilDate(utcString) {
      if (!utcString) return null
      // Subtrair 3 horas (10800000 ms) do UTC
      const ts = new Date(utcString).getTime()
      if (isNaN(ts) || ts <= 0) return null
      const spDate = new Date(ts - 3 * 3600 * 1000)
      const y = spDate.getUTCFullYear()
      const m = String(spDate.getUTCMonth() + 1).padStart(2, '0')
      const d = String(spDate.getUTCDate()).padStart(2, '0')
      return `${y}-${m}-${d}`
    }

    // Buscar TODOS os pedidos de Outubro do Guilherme
    const allOctOrders = app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && created >= '2026-10-01 00:00:00.000Z' && created <= '2026-11-01 03:00:00.000Z'`,
      'route_started_at,created,sequence',
      2000,
      0,
    )

    console.log(
      `[0141] Total de pedidos de Outubro do Guilherme para reconciliação: ${allOctOrders.length}`,
    )

    // Agrupar pedidos por dia civil de Brasília
    const ordersBySpDay = {}
    for (let oIdx = 0; oIdx < allOctOrders.length; oIdx++) {
      const ord = allOctOrders[oIdx]
      // Data de referência da entrega / rota
      const refDateRaw =
        ord.getString('route_started_at') ||
        ord.getString('route_finished_at') ||
        ord.getString('actual_arrival') ||
        ord.getString('created')
      const dayKey = getSpCivilDate(refDateRaw)

      if (!dayKey || !dayKey.startsWith('2026-10')) {
        continue
      }

      if (!ordersBySpDay[dayKey]) {
        ordersBySpDay[dayKey] = []
      }
      ordersBySpDay[dayKey].push(ord)
    }

    // Processar cada dia de Outubro (1 a 31)
    for (let dayNum = 1; dayNum <= 31; dayNum++) {
      const dayStr = String(dayNum).padStart(2, '0')
      const dayKey = `2026-10-${dayStr}`
      const target = dailyOfficialTargets[dayKey] || { targetKm: 0.0, targetFuel: 0.0 }
      const dayOrders = ordersBySpDay[dayKey] || []

      console.log(
        `[0141] Dia ${dayKey}: ${dayOrders.length} ordens encontradas. Alvo oficial: ${target.targetKm} km, R$ ${target.targetFuel}`,
      )

      if (dayOrders.length === 0) {
        continue
      }

      // CASO A: Dias com ALVO ZERO (01, 03, 05, 07, 09, 11 a 31)
      if (target.targetKm === 0 && target.targetFuel === 0) {
        let zeroedCount = 0
        for (let j = 0; j < dayOrders.length; j++) {
          const ord = dayOrders[j]
          const oldKm = ord.getFloat('total_route_with_return_km')
          const oldFuel = ord.getFloat('total_route_fuel_cost')
          const oldOrderFuel = ord.getFloat('fuel_cost')

          if (oldKm !== 0 || oldFuel !== 0 || oldOrderFuel !== 0) {
            ord.set('total_route_with_return_km', 0.0)
            ord.set('total_route_fuel_cost', 0.0)
            ord.set('fuel_cost', 0.0)
            app.save(ord)
            zeroedCount++

            logAudit(
              'orders',
              ord.id,
              'reconcile_km_zero_day',
              'total_route_with_return_km',
              oldKm,
              0.0,
              {
                tracking_code: ord.getString('tracking_code'),
                dayKey,
                previous_route_km: oldKm,
                previous_route_fuel: oldFuel,
                previous_order_fuel: oldOrderFuel,
                reason: `Dia sem expediente na planilha soberana (${dayKey}): km e combustível zerados`,
              },
            )
          }
        }
        console.log(`[0141] Dia ${dayKey} zerado com sucesso (${zeroedCount} ordens alteradas).`)
        continue
      }

      // CASO B: Dia 10/10 (já correto com 115,0 km e R$ 24,88)
      // Confirmar se a soma dos lotes canônicos bate exatamente 115,0 km e 24,88. Se já bate, não mexer.
      if (dayKey === '2026-10-10') {
        const batchKeysSeen = new Set()
        let sumKm10 = 0
        let sumFuel10 = 0
        for (let j = 0; j < dayOrders.length; j++) {
          const ord = dayOrders[j]
          const rStart = ord.getString('route_started_at')
          const bKey = rStart ? rStart.substring(0, 16) : ord.id
          if (!batchKeysSeen.has(bKey)) {
            batchKeysSeen.add(bKey)
            sumKm10 += ord.getFloat('total_route_with_return_km')
            sumFuel10 += ord.getFloat('total_route_fuel_cost')
          }
        }
        sumKm10 = Number(sumKm10.toFixed(1))
        sumFuel10 = Number(sumFuel10.toFixed(2))

        console.log(
          `[0141] Dia 10/10 verificação: apurado ${sumKm10} km e R$ ${sumFuel10} (alvo: 115,0 km / R$ 24,88)`,
        )
        if (Math.abs(sumKm10 - 115.0) < 0.2 && Math.abs(sumFuel10 - 24.88) < 0.2) {
          console.log(
            '[0141] Dia 10/10 já está conforme a planilha oficial. Preservado sem alterações.',
          )
          continue
        }
      }

      // CASO C: Dias com expediente oficial positivo (02/10, 04/10, 06/10, 08/10 e eventual 10/10 se precisasse)
      // Agrupar ordens do dia por lote (route_batch_key baseado em route_started_at com tolerância de 2 min)
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
          batches.push({
            startTime: startTs,
            orders: [ord],
          })
        }
      }

      // Ordenar lotes cronologicamente
      batches.sort((a, b) => a.startTime - b.startTime)
      console.log(`[0141] Dia ${dayKey}: ${batches.length} lote(s) de rota identificado(s).`)

      // Calcular a soma atual dos lotes (usando max de total_route_with_return_km ou peso das pernas)
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
      }

      console.log(
        `[0141] Dia ${dayKey}: KM atual somado dos lotes = ${currentTotalDayKm.toFixed(1)} km -> Alvo = ${target.targetKm} km`,
      )

      // Distribuir o KM e combustível alvo proporcionalmente entre os lotes
      // com o último lote carregando o resíduo exato para fechar a conta com precisão perfeita
      let allocatedDayKm = 0
      let allocatedDayFuel = 0

      for (let b = 0; b < batches.length; b++) {
        const isLastBatch = b === batches.length - 1
        const bObj = batches[b]

        let bTargetKm = 0
        let bTargetFuel = 0

        if (isLastBatch) {
          bTargetKm = Number(Math.max(0, target.targetKm - allocatedDayKm).toFixed(1))
          bTargetFuel = Number(Math.max(0, target.targetFuel - allocatedDayFuel).toFixed(2))
        } else {
          const ratio =
            currentTotalDayKm > 0 ? bObj.currentKm / currentTotalDayKm : 1 / batches.length
          bTargetKm = Number((target.targetKm * ratio).toFixed(1))
          bTargetFuel = Number((target.targetFuel * ratio).toFixed(2))

          allocatedDayKm += bTargetKm
          allocatedDayFuel += bTargetFuel
        }

        console.log(
          `[0141]   Lote #${b + 1} (${bObj.orders.length} ordens): KM ${bObj.currentKm} -> ${bTargetKm} km, Fuel: R$ ${bTargetFuel}`,
        )

        // Ratear o combustível do lote entre as ordens do lote
        const bOrders = bObj.orders
        let sumLegDistance = 0
        for (let bo = 0; bo < bOrders.length; bo++) {
          sumLegDistance += bOrders[bo].getFloat('distance_km')
        }

        let allocatedOrderFuel = 0
        for (let bo = 0; bo < bOrders.length; bo++) {
          const ord = bOrders[bo]
          const isLastOrder = bo === bOrders.length - 1
          const dist = ord.getFloat('distance_km')

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

          // Gravar valores canônicos na ordem
          ord.set('total_route_with_return_km', bTargetKm)
          ord.set('total_route_fuel_cost', bTargetFuel)
          ord.set('fuel_cost', ordFuel)
          app.save(ord)

          logAudit(
            'orders',
            ord.id,
            'reconcile_october_official_numbers',
            'total_route_with_return_km',
            oldRouteKm,
            bTargetKm,
            {
              tracking_code: ord.getString('tracking_code'),
              dayKey,
              batch_index: b + 1,
              previous_route_km: oldRouteKm,
              new_route_km: bTargetKm,
              previous_route_fuel: oldRouteFuel,
              new_route_fuel: bTargetFuel,
              previous_order_fuel: oldOrderFuel,
              new_order_fuel: ordFuel,
              day_target_km: target.targetKm,
              day_target_fuel: target.targetFuel,
              reason: `Reconciliação oficial Outubro/2026 (planilha soberana): total do dia ${target.targetKm} km e R$ ${target.targetFuel}`,
            },
          )
        }
      }
    }

    console.log('[0141] Reconciliação oficial do Guilherme de Outubro concluída com sucesso!')
  },
  (app) => {
    console.log('[0141] Rollback da migração 0141.')
  },
)
