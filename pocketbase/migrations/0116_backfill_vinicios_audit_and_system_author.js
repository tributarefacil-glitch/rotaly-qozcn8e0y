/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0116_backfill_vinicios_audit_and_system_author.js
 *
 * Migration 0116:
 * (a) Insere a entrada faltante na audit_trail do ajuste do Vinicios (82,03 -> 67,62,
 *     action 'adjust_opening_balance', target Vinicios Lunz, metadata com os 4 lotes de 03/10:
 *     km 9,3/27,7/41,1/6,6 = 84,67 km, gastos R$ 1,42/5,73/6,26/1,00 = R$ 14,41,
 *     system_trigger='migration_0115_backfill', user_id vazio).
 * (b) Atualiza retroativamente os registros automáticos com user_id vazio
 *     (auto_correct_base_destination, clean_hanging_route, etc.) para actor_name='Sistema' no metadata.
 */

migrate(
  (app) => {
    const courierId = 'o9nccdbkmc9onh0'
    const auditCol = app.findCollectionByNameOrId('audit_trail')
    if (!auditCol) {
      console.warn('[0116] Coleção audit_trail não encontrada.')
      return
    }

    // (a) Inserir entrada faltante do Vinicios se ainda não existir
    try {
      const existing = app.findRecordsByFilter(
        'audit_trail',
        `courier_id = '${courierId}' && (action = 'adjust_opening_balance' || field = 'opening_balance')`,
        '-created',
        1,
        0,
      )

      if (!existing || existing.length === 0) {
        console.log('[0116] Inserindo entrada faltante de auditoria para Vinicios Lunz...')
        const rec = new Record(auditCol)
        rec.set('courier_id', courierId)
        rec.set('collection', 'users')
        rec.set('record_id', courierId)
        rec.set('action', 'adjust_opening_balance')
        rec.set('field', 'opening_balance')
        rec.set('old_value', '82.03')
        rec.set('new_value', '67.62')
        rec.set('timestamp', '2026-10-05 02:37:00.000Z')
        rec.set('metadata', {
          target_user_name: 'VINICIOS LUNZ',
          previous_opening_balance: 82.03,
          new_opening_balance: 67.62,
          difference: -14.41,
          oct3_batches: [
            { batch: 1, time: '15:41', km: 9.3, spent: 1.42 },
            { batch: 2, time: '17:15', km: 27.7, spent: 5.73 },
            { batch: 3, time: '19:55', km: 41.1, spent: 6.26 },
            { batch: 4, time: '22:33', km: 6.6, spent: 1.0 },
          ],
          total_oct3_km: 84.67,
          total_oct3_fuel_spent: 14.41,
          reason:
            'desconto do gasto oficial da rota de 03/10 (decisão do admin: abertura não embute a rota)',
          system_trigger: 'migration_0115_backfill',
          actor_name: 'Sistema',
          actor_email: 'sistema@rotaly.com',
          actor_role: 'system',
        })
        app.save(rec)
        console.log('[0116] Entrada de auditoria de Vinicios Lunz gravada com sucesso.')
      } else {
        console.log('[0116] Registro de auditoria para Vinicios Lunz já existia.')
      }
    } catch (err) {
      console.warn('[0116] Erro ao gravar auditoria do Vinicios:', err)
    }

    // (b) Atualizar retroativamente os registros automáticos com user_id vazio para actor_name='Sistema'
    try {
      // Ler registros de audit_trail diretamente via SQL ou records
      const systemRecords = app.findRecordsByFilter(
        'audit_trail',
        "user_id = '' || user_id = null",
        '-created',
        500,
        0,
      )

      console.log(
        `[0116] Registros com user_id vazio encontrados para atualização de metadata: ${systemRecords.length}`,
      )
      let updatedCount = 0

      for (let i = 0; i < systemRecords.length; i++) {
        const item = systemRecords[i]
        let meta = {}
        try {
          const raw = item.getString('metadata')
          if (raw) {
            meta = JSON.parse(raw)
          } else {
            const rawObj = item.get('metadata')
            if (rawObj && typeof rawObj === 'object') {
              meta = rawObj
            }
          }
        } catch (_) {
          meta = {}
        }

        let changed = false
        if (!meta.actor_name) {
          meta.actor_name = 'Sistema'
          changed = true
        }
        if (!meta.actor_role) {
          meta.actor_role = 'system'
          changed = true
        }
        if (meta.system_trigger === undefined) {
          meta.system_trigger = true
          changed = true
        }

        if (changed) {
          // Usar newQuery para atualizar campo metadata diretamente no SQLite como JSON string
          app
            .db()
            .newQuery('UPDATE audit_trail SET metadata = {:meta} WHERE id = {:id}')
            .bind({ meta: JSON.stringify(meta), id: item.id })
            .execute()
          updatedCount++
        }
      }

      console.log(`[0116] Registros retroativos atualizados com metadata Sistema: ${updatedCount}`)
    } catch (errMeta) {
      console.warn('[0116] Erro ao atualizar registros retroativos na audit_trail:', errMeta)
    }
  },
  (app) => {
    console.log('[0116] Rollback da migração 0116.')
  },
)
