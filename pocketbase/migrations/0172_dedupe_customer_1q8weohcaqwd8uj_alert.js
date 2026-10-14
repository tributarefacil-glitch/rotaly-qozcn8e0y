/// <reference path="../pb_data/types.d.ts" />

migrate((app) => {
  // Migração 0172:
  // Deduplicar alertas do cliente 1q8weohcaqwd8uj:
  // Manter i152uyfbv6usdhz (criado pelo usuário),
  // Descartar ibdo9vczzlwv6kv (gerado pelo sistema) mesclando estado,
  // Registrar o descarte em audit_trail com user_id vazio, actor_name='Sistema', metadata.system_trigger=true.
  // Idempotente.

  const KEEPER_ID = 'i152uyfbv6usdhz'
  const DISCARD_ID = 'ibdo9vczzlwv6kv'
  const CUSTOMER_ID = '1q8weohcaqwd8uj'

  let keeperRecord = null
  let discardRecord = null

  try {
    keeperRecord = app.findRecordById('address_alerts', KEEPER_ID)
  } catch (_) {
    keeperRecord = null
  }

  try {
    discardRecord = app.findRecordById('address_alerts', DISCARD_ID)
  } catch (_) {
    discardRecord = null
  }

  if (discardRecord) {
    const discardStatus = discardRecord.getString('status') || 'aprovado'
    const discardNotes = discardRecord.getString('notes') || ''
    const discardReviewedAt = discardRecord.getString('reviewed_at') || ''
    const discardReviewedBy = discardRecord.getString('reviewed_by') || ''

    if (keeperRecord) {
      // Mesclar estado se o keeper precisar de complementação
      let keeperNotes = keeperRecord.getString('notes') || ''
      if (!keeperNotes.includes(KEEPER_ID)) {
        keeperNotes = `${keeperNotes} | Mesclado e unificado com #${DISCARD_ID}`.trim()
        keeperRecord.set('notes', keeperNotes)
      }
      if (discardReviewedAt && !keeperRecord.getString('reviewed_at')) {
        keeperRecord.set('reviewed_at', discardReviewedAt)
      }
      if (discardReviewedBy && !keeperRecord.getString('reviewed_by')) {
        keeperRecord.set('reviewed_by', discardReviewedBy)
      }
      if (discardStatus === 'aprovado' && keeperRecord.getString('status') !== 'aprovado') {
        keeperRecord.set('status', 'aprovado')
      }
      try {
        app.save(keeperRecord)
        console.log(
          `[0172_migration] Keeper #${KEEPER_ID} atualizado com mesclagem de #${DISCARD_ID}`,
        )
      } catch (errKeep) {
        console.warn(`[0172_migration] Erro ao atualizar keeper #${KEEPER_ID}:`, errKeep)
      }
    }

    // Registrar o descarte em audit_trail com user_id vazio, actor_name='Sistema', metadata.system_trigger=true
    try {
      const auditCol = app.findCollectionByNameOrId('audit_trail')
      if (auditCol) {
        const auditRec = new Record(auditCol)
        auditRec.set('user_id', '') // relation não aceita 'system'
        auditRec.set('actor_name', 'Sistema')
        auditRec.set('collection', 'address_alerts')
        auditRec.set('record_id', DISCARD_ID)
        auditRec.set('action', 'descarte_alerta_duplicado')
        auditRec.set('field', 'status')
        auditRec.set('old_value', discardStatus)
        auditRec.set('new_value', 'descartado_por_duplicidade')
        auditRec.set('timestamp', new Date().toISOString())
        auditRec.set('metadata', {
          system_trigger: true,
          actor_name: 'Sistema',
          actor_role: 'system',
          customer_id: CUSTOMER_ID,
          kept_alert_id: KEEPER_ID,
          discarded_alert_id: DISCARD_ID,
          reason:
            'Deduplicação de alertas: descarte de alerta duplicado interno do sistema gerado para o cliente 1q8weohcaqwd8uj',
        })
        app.save(auditRec)
        console.log(
          `[0172_migration] audit_trail registrado com sucesso para descarte de #${DISCARD_ID}`,
        )
      }
    } catch (auditErr) {
      console.warn(`[0172_migration] Erro ao registrar audit_trail para #${DISCARD_ID}:`, auditErr)
    }

    // Deletar o alerta duplicado
    try {
      app.delete(discardRecord)
      console.log(
        `[0172_migration] Alerta duplicado #${DISCARD_ID} excluído com sucesso (mantido #${KEEPER_ID}).`,
      )
    } catch (delErr) {
      console.warn(`[0172_migration] Falha ao excluir alerta #${DISCARD_ID}:`, delErr)
    }
  } else {
    console.log(
      `[0172_migration] Alerta #${DISCARD_ID} já não existe no banco. Operação idempotente mantida.`,
    )
  }
})
