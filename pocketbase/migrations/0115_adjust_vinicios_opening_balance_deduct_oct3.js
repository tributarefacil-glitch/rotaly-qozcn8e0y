/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0115_adjust_vinicios_opening_balance_deduct_oct3.js
 *
 * Decisão do admin/usuário (v0.0.330):
 * "abertura R$ 82,03 já desconta a rota de 03/10? — sim, precisamos descontar".
 * A abertura de R$ 82,03 do entregador VINICIOS LUNZ (id o9nccdbkmc9onh0) NÃO
 * embutia o gasto da rota de 03/10. O sistema agora desconta esse gasto do opening_balance dele.
 *
 * 1. Apuração oficial do gasto de 03/10 pelo motor oficial de KM e combustível:
 *    - 4 lotes de rotas viárias em 03/10 (horário de Brasília):
 *      * Lote 1 (15:41): 3 pedidos (TRK-2026-01697890, TRK-2026-81288101, TRK-2026-42252777)
 *        Rota oficial: 9.3 km -> R$ 1.42 (0.25 + 0.38 + 0.79)
 *      * Lote 2 (17:15): 7 pedidos (TRK-2026-44131121, TRK-2026-73276445, TRK-2026-45772981,
 *        TRK-2026-20414579, TRK-2026-67426011, TRK-2026-84132869, TRK-2026-30476226)
 *        Rotas oficiais: 8.57 km (R$ 1.59) + 19.1 km (R$ 4.14) -> R$ 5.73
 *      * Lote 3 (19:55): 8 pedidos entregues + 1 cancelado (TRK-2026-47063590, duplicado cancelado vendedor)
 *        Rota oficial: 41.1 km -> R$ 6.26
 *      * Lote 4 (22:33): 5 pedidos saneados (TRK-2026-56727106, TRK-2026-30089852, TRK-2026-63761377,
 *        TRK-2026-22435852 ROSELITO saneado, TRK-2026-46846671 amanda saneado)
 *        Rota oficial: 6.6 km -> R$ 1.00
 *    - Total de KM oficial de 03/10: 84.67 km (~84.7 km)
 *    - Gasto oficial total de 03/10: R$ 1.42 + R$ 5.73 + R$ 6.26 + R$ 1.00 = R$ 14,41
 *
 * 2. Novo opening_balance:
 *    82,03 − 14,41 = R$ 67,62.
 *
 * 3. Trilha de auditoria (audit_trail):
 *    Registro com user_id="system", collection="users", record_id="o9nccdbkmc9onh0",
 *    action="update", field="opening_balance", old_value="82.03", new_value="67.62",
 *    motivo: "desconto do gasto oficial da rota de 03/10 (decisão do admin: abertura não embute a rota)".
 */

migrate(
  (app) => {
    const courierId = 'o9nccdbkmc9onh0'
    const oldOpening = 82.03
    const oct3FuelSpent = 14.41 // 1.42 + 5.73 + 6.26 + 1.00
    const newOpening = 67.62 // 82.03 - 14.41

    console.log(`[0115] Iniciando ajuste de opening_balance do Vinicios Lunz (${courierId})...`)

    let courier = null
    try {
      courier = app.findRecordById('users', courierId)
    } catch (err) {
      console.warn(`[0115] Entregador com ID ${courierId} não encontrado pelo findRecordById:`, err)
      try {
        const found = app.findRecordsByFilter(
          'users',
          `id = '${courierId}' || name ~ 'VINICIOS LUNZ'`,
          '',
          1,
          0,
        )
        if (found && found.length > 0) {
          courier = found[0]
        }
      } catch (fErr) {
        console.error('[0115] Erro ao buscar Vinicios Lunz:', fErr)
      }
    }

    if (!courier) {
      console.error(`[0115] Entregador Vinicios Lunz (${courierId}) não encontrado. Abortando.`)
      return
    }

    const currentOpening = courier.getFloat('opening_balance')
    console.log(`[0115] Vinicios Lunz encontrado: opening_balance atual = ${currentOpening}`)

    courier.set('opening_balance', newOpening)
    app.save(courier)
    console.log(
      `[0115] opening_balance de Vinicios Lunz atualizado: ${currentOpening} -> ${newOpening}`,
    )

    // Registrar na coleção audit_trail
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', 'system')
        auditRec.set('courier_id', courierId)
        auditRec.set('collection', 'users')
        auditRec.set('record_id', courierId)
        auditRec.set('action', 'update')
        auditRec.set('field', 'opening_balance')
        auditRec.set('old_value', String(currentOpening || oldOpening))
        auditRec.set('new_value', String(newOpening))
        auditRec.set('timestamp', new Date().toISOString())
        auditRec.set('metadata', {
          target_user_name: courier.getString('name') || 'VINICIOS LUNZ',
          previous_opening_balance: currentOpening || oldOpening,
          oct3_official_fuel_spent: oct3FuelSpent,
          new_opening_balance: newOpening,
          reason:
            'desconto do gasto oficial da rota de 03/10 (decisão do admin: abertura não embute a rota)',
        })
        app.save(auditRec)
        console.log('[0115] Registro de auditoria gravado em audit_trail com sucesso.')
      }
    } catch (auditErr) {
      console.warn('[0115] Aviso ao gravar audit_trail:', auditErr)
    }

    console.log('[0115] Migração 0115 concluída com sucesso.')
  },
  (app) => {
    const courierId = 'o9nccdbkmc9onh0'
    const rollbackOpening = 82.03

    console.log(`[0115] Revertendo opening_balance de Vinicios Lunz para ${rollbackOpening}...`)
    try {
      const courier = app.findRecordById('users', courierId)
      if (courier) {
        courier.set('opening_balance', rollbackOpening)
        app.save(courier)
        console.log(`[0115] Reversão concluída: opening_balance = ${rollbackOpening}`)
      }
    } catch (err) {
      console.warn('[0115] Erro no rollback da migração 0115:', err)
    }
  },
)
