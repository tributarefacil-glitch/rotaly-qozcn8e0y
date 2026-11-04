/// <reference path="../pb_data/types.d.ts" />

/**
 * Migração 0178: Reconciliação do Carry-Over de Novembro do Entregador Guilherme de Paiva.
 *
 * O que o usuário informou (fonte da verdade):
 * "O Guilherme recebeu R$ 352,25 mês passado, sobrou R$ 12,78 para esse mês, hoje ele recebeu R$ 100,00 de adiantamento.
 *  Ele deveria ter R$ 112,78 hoje de manhã, antes das rotas de hoje. São esses números que precisam estar no card de todas
 *  as telas, vendedor, administrador e entregador."
 *
 * Regra permanente do projeto:
 * - Cards de combustível/adiantamento iniciam ZERADOS a cada mês (só dados do mês corrente).
 * - Apenas o saldo da conta corrente carrega para o mês seguinte via carry-over.
 * - Meses anteriores ficam somente no histórico.
 *
 * Ação desta migração:
 * 1. Atualizar opening_balance do Guilherme para 12.78 e cutoff_date para 2026-11-01 03:00:00.000Z.
 * 2. Registrar no audit_trail com actor_name = 'Sistema', user_id = '', metadata.system_trigger = true.
 * 3. Não tocar nos lançamentos históricos de setembro/outubro nem nos outros entregadores.
 */
migrate(
  (app) => {
    const courierId = 'u6zr2qtcos1ljxd'

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
          reconciliation: 'guilherme_november_opening_balance',
          courier_id: courierId,
          ...extraMeta,
        }
        trail.set('metadata', meta)
        app.save(trail)
      } catch (err) {
        console.warn(`[0178] Falha ao registrar audit_trail (${collectionName}:${recordId}):`, err)
      }
    }

    let courierUser = null
    try {
      courierUser = app.findRecordById('users', courierId)
    } catch (e) {
      console.error(`[0178] Usuário Guilherme (${courierId}) não encontrado:`, e)
      return
    }

    const prevOpeningBalance = courierUser.getFloat('opening_balance')
    const prevCutoffDate = courierUser.getString('cutoff_date')
    const targetOpeningBalance = 12.78
    const targetCutoffDate = '2026-11-01 03:00:00.000Z'

    console.log(
      `[0178] Ficha do Guilherme: opening_balance ${prevOpeningBalance} -> ${targetOpeningBalance}, cutoff_date ${prevCutoffDate} -> ${targetCutoffDate}`,
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
          'Carry-over novembro Guilherme corrigido de 42.35 para 12.78 conforme contabilidade real do dono',
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
      const courierUser = app.findRecordById('users', 'u6zr2qtcos1ljxd')
      courierUser.set('opening_balance', 42.35)
      courierUser.set('cutoff_date', '2026-10-01 03:00:00.000Z')
      app.save(courierUser)
    } catch (e) {
      console.warn('[0178] Falha no rollback:', e)
    }
  },
)
