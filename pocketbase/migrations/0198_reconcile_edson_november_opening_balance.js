/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0198: Reconciliação do Carry-Over de Novembro do Entregador Edson Pereira da Silva Junior (RIT9I49).
 *
 * O que o usuário informou (fonte canônica da verdade):
 * - Edson trouxe R$ 5,32 do mês anterior (carry-over real).
 * - Já gastou R$ 17,48 em novembro (este mês corrente).
 * - Hoje (03/11) recebeu R$ 100,00 de adiantamento.
 * - Portanto o saldo da conta corrente dele deveria ser R$ 105,32 de manhã, antes das rotas de hoje,
 *   e R$ 105,32 − 17,48 = R$ 87,84 considerando o gasto do período.
 * - O ajuste manual de outubro (731 km / R$ 155,70 ou R$ 158,14) pertence estritamente ao histórico de outubro
 *   e não pode vazar nem ser contado como gasto de novembro.
 *
 * Ação desta migração:
 * 1. Atualizar opening_balance do Edson para 5.32 e cutoff_date para 2026-11-01 03:00:00.000Z.
 * 2. Registrar no audit_trail com actor_name = 'Sistema', user_id = '', metadata.system_trigger = true.
 * 3. Não tocar nos lançamentos históricos nem nos outros entregadores.
 */
migrate(
  (app) => {
    const courierId = 'tetrfu5oi19jbwz'

    function logAudit(collectionName, recordId, action, fieldName, oldVal, newVal, extraMeta = {}) {
      try {
        const auditCol = app.findCollectionByNameOrId('audit_trail')
        const trail = new Record(auditCol)
        trail.set('action', action)
        trail.set('user_id', '') // relation users não aceita 'system'
        trail.set('actor_name', 'Sistema')
        trail.set('actor_role', 'system')
        trail.set('target_collection', collectionName)
        trail.set('target_record_id', recordId)
        trail.set('field_name', fieldName)
        trail.set('old_value', oldVal !== undefined && oldVal !== null ? String(oldVal) : '')
        trail.set('new_value', newVal !== undefined && newVal !== null ? String(newVal) : '')
        const meta = {
          system_trigger: true,
          reconciliation: 'edson_november_opening_balance',
          courier_id: courierId,
          ...extraMeta,
        }
        trail.set('metadata', meta)
        app.save(trail)
      } catch (err) {
        console.warn(`[0198] Falha ao registrar audit_trail (${collectionName}:${recordId}):`, err)
      }
    }

    let courierUser = null
    try {
      courierUser = app.findRecordById('users', courierId)
    } catch (e) {
      console.error(`[0198] Usuário Edson (${courierId}) não encontrado:`, e)
      return
    }

    const prevOpeningBalance = courierUser.getFloat('opening_balance')
    const prevCutoffDate = courierUser.getString('cutoff_date')
    const targetOpeningBalance = 5.32
    const targetCutoffDate = '2026-11-01 03:00:00.000Z'

    console.log(
      `[0198] Ficha do Edson: opening_balance ${prevOpeningBalance} -> ${targetOpeningBalance}, cutoff_date ${prevCutoffDate} -> ${targetCutoffDate}`,
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
          'Carry-over novembro Edson fixado em R$ 5,32 conforme contabilidade canônica declarada pelo dono',
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
          'Data de corte atualizada para 01/11/2026 00:00 Brasília (2026-11-01 03:00:00.000Z) para fechamento de mês',
      },
    )
  },
  (app) => {
    // Reversão
    try {
      const courierUser = app.findRecordById('users', 'tetrfu5oi19jbwz')
      courierUser.set('opening_balance', 0)
      courierUser.set('cutoff_date', '2026-10-04 01:00:00.000Z')
      app.save(courierUser)
    } catch (e) {
      console.warn('[0198] Falha no rollback:', e)
    }
  },
)
