/// <reference path="../pb_data/types.d.ts" />

migrate(
  (app) => {
    // 0111: Cancelar de fato o pedido duplicado da Daiana TRK-2026-47063590
    // e registrar a alteração na coleção audit_trail.
    let adminUserId = ''
    try {
      const masterUser = app.findFirstRecordByFilter('users', "role = 'master' || role = 'admin'")
      if (masterUser) {
        adminUserId = masterUser.id
      }
    } catch (_) {}

    try {
      const dupOrder = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-47063590' || id = '26bkn5g6pg1qqy5'",
      )

      if (dupOrder) {
        const oldStatus = dupOrder.getString('status')
        const oldReason = dupOrder.getString('completion_reason')
        const oldNotes = dupOrder.getString('notes')
        const courierId = dupOrder.getString('courier_id')

        const cancellationReason = 'cancelado_vendedor'
        const appendNote = '[Cancelado pela reauditoria]: duplicado do TRK-2026-63761377'
        const updatedNotes = oldNotes ? oldNotes + ' | ' + appendNote : appendNote

        dupOrder.set('status', 'cancelled')
        dupOrder.set('completion_reason', cancellationReason)
        dupOrder.set('notes', updatedNotes)
        app.save(dupOrder)

        console.log(
          `[0111] Pedido TRK-2026-47063590 cancelado com sucesso. Status anterior: ${oldStatus} -> cancelled, reason: ${cancellationReason}`,
        )

        // Registrar no audit_trail
        try {
          const auditCol = app.findCollectionByNameOrId('audit_trail')
          if (auditCol) {
            const auditRec = new Record(auditCol)
            if (adminUserId) {
              auditRec.set('user_id', adminUserId)
            }
            if (courierId) {
              auditRec.set('courier_id', courierId)
            }
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', dupOrder.id)
            auditRec.set('action', 'cancel_duplicate_order')
            auditRec.set('field', 'status')
            auditRec.set('old_value', oldStatus)
            auditRec.set('new_value', 'cancelled')
            auditRec.set('timestamp', new Date().toISOString())
            auditRec.set('metadata', {
              tracking_code: 'TRK-2026-47063590',
              twin_tracking_code: 'TRK-2026-63761377',
              reason: 'duplicado do TRK-2026-63761377',
              previous_completion_reason: oldReason,
              completion_reason: cancellationReason,
              customer_name: dupOrder.getString('end_address_name'),
            })
            app.save(auditRec)
            console.log('[0111] Registro de auditoria gravado em audit_trail com sucesso.')
          }
        } catch (auditErr) {
          console.warn('[0111] Aviso ao gravar audit_trail:', auditErr)
        }
      } else {
        console.warn('[0111] Pedido TRK-2026-47063590 não encontrado.')
      }
    } catch (err) {
      console.error('[0111] Erro ao cancelar pedido duplicado TRK-2026-47063590:', err)
      throw err
    }
  },
  (app) => {
    // Reverter se necessário
    try {
      const dupOrder = app.findFirstRecordByFilter(
        'orders',
        "tracking_code = 'TRK-2026-47063590' || id = '26bkn5g6pg1qqy5'",
      )
      if (dupOrder) {
        dupOrder.set('status', 'delivered')
        dupOrder.set('completion_reason', 'delivered')
        app.save(dupOrder)
      }
    } catch (_) {}
  },
)
