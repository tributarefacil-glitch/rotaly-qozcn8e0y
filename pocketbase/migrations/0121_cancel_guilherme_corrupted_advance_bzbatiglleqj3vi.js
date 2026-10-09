/// <reference path="../pb_data/types.d.ts" />

/**
 * pocketbase/migrations/0121_cancel_guilherme_corrupted_advance_bzbatiglleqj3vi.js
 *
 * Migration 0121:
 * Cancela o ajuste manual indevido de +R$ 188,45 do Guilherme (fuel_advances id: bzbatiglleqj3vi),
 * criado em 05/10 sobre o card bugado da v0.0.299 (notes: "erro no saldo do sistema").
 * O saldo canônico pós-corte do Guilherme é R$ 220,99 (abertura R$ 22,10 + adiantamento legítimo
 * de R$ 200,00 de 07/10 - gastos pós-corte). Manter esse ajuste ativo duplicaria o saldo.
 *
 * Registra a ação na audit_trail com:
 * user_id vazio, actor_name='Sistema', metadata.system_trigger=true
 * para conformidade estrita com as regras da trilha canônica.
 */

migrate(
  (app) => {
    const advanceId = 'bzbatiglleqj3vi'
    const courierId = 'u6zr2qtcos1ljxd'

    try {
      const advRecord = app.findFirstRecordByData('fuel_advances', 'id', advanceId)
      if (advRecord) {
        const currentStatus = advRecord.getString('status')
        if (currentStatus !== 'cancelled') {
          console.log(`[0121] Cancelando fuel_advance ${advanceId} (${advRecord.get('amount')})...`)
          advRecord.set('status', 'cancelled')
          advRecord.set(
            'cancellation_reason',
            'Ajuste manual da v0.0.299 cancelado para restaurar o saldo canônico da v0.0.331 (evitar duplicação do saldo)',
          )
          advRecord.set('cancelled_at', new Date().toISOString())
          advRecord.set('cancelled_by', '')
          app.save(advRecord)
          console.log(`[0121] fuel_advance ${advanceId} cancelado com sucesso.`)
        } else {
          console.log(`[0121] fuel_advance ${advanceId} já estava cancelado.`)
        }
      } else {
        console.warn(`[0121] fuel_advance ${advanceId} não encontrado.`)
      }
    } catch (err) {
      console.warn(`[0121] Erro ao buscar/atualizar fuel_advance ${advanceId}:`, err)
    }

    // Registra na audit_trail
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const existingAudit = app.findRecordsByFilter(
          'audit_trail',
          `record_id = '${advanceId}' && action = 'cancel'`,
          '-created',
          1,
          0,
        )

        if (!existingAudit || existingAudit.length === 0) {
          const auditRec = new Record(auditCol)
          auditRec.set('collection', 'fuel_advances')
          auditRec.set('record_id', advanceId)
          auditRec.set('courier_id', courierId)
          auditRec.set('action', 'cancel')
          auditRec.set('field', 'status')
          auditRec.set('old_value', 'active')
          auditRec.set('new_value', 'cancelled')
          auditRec.set('timestamp', new Date().toISOString())
          auditRec.set('metadata', {
            amount: 188.45,
            cancellation_reason:
              'Ajuste manual da v0.0.299 cancelado para restaurar o saldo canônico da v0.0.331 (evitar duplicação do saldo)',
            cancelled_by: 'Sistema',
            target_user_name: 'GUILHERME SILVA',
            system_trigger: true,
            actor_name: 'Sistema',
            actor_email: 'sistema@rotaly.com',
            actor_role: 'system',
          })
          app.save(auditRec)
          console.log(
            `[0121] Registro de audit_trail para cancelamento de ${advanceId} salvo com sucesso.`,
          )
        }
      }
    } catch (auditErr) {
      console.warn('[0121] Erro ao gravar audit_trail:', auditErr)
    }
  },
  (app) => {
    console.log('[0121] Rollback da migração 0121.')
    try {
      const advRecord = app.findFirstRecordByData('fuel_advances', 'id', 'bzbatiglleqj3vi')
      if (advRecord) {
        advRecord.set('status', 'active')
        advRecord.set('cancellation_reason', '')
        advRecord.set('cancelled_at', '')
        advRecord.set('cancelled_by', '')
        app.save(advRecord)
      }
    } catch (err) {
      console.warn('[0121] Erro no rollback:', err)
    }
  },
)
