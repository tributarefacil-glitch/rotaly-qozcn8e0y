/**
 * pocketbase/hooks/orders_client_absent_auto_cancel.js
 *
 * Regra do Rotaly para pedidos pendentes com "Cliente Ausente":
 * - Pedidos pending com cliente ausente ficam disponíveis para reatribuição.
 * - Após 24h do registro de ausência, se ainda estiverem pendentes sem entregador,
 *   são cancelados automaticamente com completion_reason = 'cancelado_vendedor',
 *   registrando a ação na trilha de auditoria (audit_trail) com user_id="system".
 *
 * Executa a cada hora para verificar pedidos que completaram 24h de ausência.
 */

cronAdd('hourly_client_absent_auto_cancel', '0 * * * *', () => {
  try {
    const twentyFourHoursAgoMs = Date.now() - 24 * 60 * 60 * 1000
    const twentyFourHoursAgoIso = new Date(twentyFourHoursAgoMs).toISOString()

    // Buscar pedidos pending onde houve cliente ausente há mais de 24 horas
    const absentOrders = $app.findRecordsByFilter(
      'orders',
      "status = 'pending' && (courier_id = '' || courier_id = null) && (completion_reason = 'client_absent' || notes ~ 'Cliente Ausente')",
      '-updated',
      200,
      0,
    )

    if (!absentOrders || absentOrders.length === 0) {
      return
    }

    const auditCol = $app.findCollectionByNameOrId('audit_trail')

    for (let i = 0; i < absentOrders.length; i++) {
      const order = absentOrders[i]
      const updatedStr = order.getString('updated') || order.getString('created')
      const updatedMs = new Date(updatedStr).getTime()

      if (updatedMs <= twentyFourHoursAgoMs) {
        const trackingCode = order.getString('tracking_code') || order.id
        console.log(
          `[hourly_client_absent_auto_cancel] Auto-cancelando pedido pendente com ausência > 24h: ${trackingCode}`,
        )

        order.set('status', 'cancelled')
        order.set('completion_reason', 'cancelado_vendedor')
        const currentNotes = order.getString('notes') || ''
        order.set(
          'notes',
          currentNotes
            ? `${currentNotes} | [Auto-cancelamento sistema: cliente ausente sem reatribuição por mais de 24h]`
            : '[Auto-cancelamento sistema: cliente ausente sem reatribuição por mais de 24h]',
        )

        $app.save(order)

        if (auditCol) {
          try {
            const auditRec = new Record(auditCol)
            // user_id vazio para sistema
            auditRec.set('collection', 'orders')
            auditRec.set('record_id', order.id)
            auditRec.set('action', 'cancel')
            auditRec.set('field', 'status')
            auditRec.set('old_value', 'pending')
            auditRec.set('new_value', 'cancelled:cancelado_vendedor')
            auditRec.set('timestamp', new Date().toISOString())
            auditRec.set('metadata', {
              reason: 'Cancelamento automático após 24h de cliente ausente sem reatribuição',
              tracking_code: trackingCode,
              order_id: order.id,
              actor_name: 'Sistema',
              actor_email: 'sistema@rotaly.com',
              actor_role: 'system',
              system_trigger: true,
            })
            $app.save(auditRec)
          } catch (auditErr) {
            console.warn('[hourly_client_absent_auto_cancel] Erro ao gravar audit_trail:', auditErr)
          }
        }
      }
    }
  } catch (err) {
    console.warn('[hourly_client_absent_auto_cancel] Erro global no cron de cliente ausente:', err)
  }
})
