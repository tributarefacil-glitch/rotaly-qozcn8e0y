// Hook triggered after order is updated (e.g. finished/delivered)
// When a delivery is completed, check the next order in queue for that courier and notify the next customer via native PB email
onRecordAfterUpdateSuccess((e) => {
  try {
    const updatedOrder = e.record
    const newStatus = updatedOrder.getString('status')
    const courierId = updatedOrder.getString('courier_id')

    // Only fire when an order is completed (delivered, address_error, client_absent)
    const isCompleted =
      newStatus === 'delivered' || newStatus === 'address_error' || newStatus === 'client_absent'

    if (!isCompleted || !courierId) {
      e.next()
      return
    }

    // Find all remaining in_transit orders for this courier ordered by sequence, then created
    let remainingOrders = []
    try {
      remainingOrders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && status = 'in_transit' && id != '${updatedOrder.id}'`,
        'sequence,created',
        10,
        0,
      )
    } catch (err) {
      console.log('Error fetching remaining orders:', err)
    }

    if (!remainingOrders || remainingOrders.length === 0) {
      e.next()
      return
    }

    // The immediate next order in the delivery queue
    const nextOrder = remainingOrders[0]
    const nextCustomerId = nextOrder.getString('customer_id')
    const nextTrackingCode = nextOrder.getString('tracking_code')

    if (!nextCustomerId) {
      e.next()
      return
    }

    let customer = null
    try {
      customer = $app.findRecordById('customers', nextCustomerId)
    } catch (_) {}

    if (!customer) {
      e.next()
      return
    }

    const customerName = customer.getString('name') || 'Cliente'
    const customerPhone = customer.getString('phone') || ''
    const customerAddress = customer.getString('address') || ''

    let courierName = 'Seu entregador'
    try {
      const courierRecord = $app.findRecordById('_pb_users_auth_', courierId)
      courierName = courierRecord.getString('name') || 'Seu entregador'
    } catch (_) {}

    // Find any email associated with customer or fallback recipient if configured
    // Also notify seller and create an in-app notification
    const trackingUrl = `https://gestao-de-entregas-10f17.goskip.app/track/${nextTrackingCode}`

    // 1. In-app Notification for the upcoming order
    const notifsCol = $app.findCollectionByNameOrId('notifications')
    try {
      const notif = new Record(notifsCol)
      notif.set('user_id', nextOrder.getString('seller_id') || '')
      notif.set('title', `Próxima Entrega da Rota: ${customerName}`)
      notif.set(
        'message',
        `A entrega anterior foi finalizada. O entregador ${courierName} está a caminho do próximo cliente (${customerName} - ${nextTrackingCode}).`,
      )
      notif.set('type', 'order')
      notif.set('read', false)
      notif.set('order_id', nextOrder.id)
      $app.save(notif)
    } catch (errN) {
      console.log('Error saving next order notification:', errN)
    }

    // 2. Native PocketBase Transactional Email (if customer has email field or to admin/configured contact)
    // Send email using $app.newMailClient().send(...)
    try {
      // Find admin or seller email to send confirmation/client copy
      let targetEmail = ''
      try {
        const sellerId = nextOrder.getString('seller_id')
        if (sellerId) {
          const seller = $app.findRecordById('_pb_users_auth_', sellerId)
          targetEmail = seller.getString('email')
        }
      } catch (_) {}

      if (!targetEmail) {
        // Fallback to first admin
        try {
          const admins = $app.findRecordsByFilter(
            '_pb_users_auth_',
            "role = 'admin'",
            '-created',
            1,
            0,
          )
          if (admins.length > 0) targetEmail = admins[0].getString('email')
        } catch (_) {}
      }

      if (targetEmail) {
        const htmlBody = `
          <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0;">
            <div style="background: linear-gradient(135deg, #2563eb, #4f46e5); padding: 24px; border-radius: 8px; text-align: center; color: #ffffff;">
              <h1 style="margin: 0; font-size: 22px;">🛵 Sua entrega é a próxima da fila!</h1>
              <p style="margin-top: 8px; font-size: 14px; opacity: 0.9;">O entregador acabou de finalizar a entrega anterior e já está a caminho.</p>
            </div>
            
            <div style="padding: 20px; background-color: #ffffff; margin-top: 16px; border-radius: 8px; border: 1px solid #e2e8f0;">
              <p style="font-size: 14px; color: #334155;">Olá, <strong>${customerName}</strong>!</p>
              <p style="font-size: 14px; color: #475569;">
                O entregador <strong>${courierName}</strong> concluiu a parada anterior e seu pedido é o próximo a ser entregue.
              </p>
              
              <div style="margin: 16px 0; padding: 12px; background-color: #f1f5f9; border-radius: 6px; font-size: 13px; color: #1e293b;">
                <p style="margin: 4px 0;"><strong>Código de Rastreio:</strong> <span style="font-family: monospace; color: #2563eb;">${nextTrackingCode}</span></p>
                <p style="margin: 4px 0;"><strong>Endereço de Destino:</strong> ${customerAddress}</p>
              </div>

              <div style="text-align: center; margin-top: 24px;">
                <a href="${trackingUrl}" style="display: inline-block; background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 14px;">
                  Acompanhar Entregador no Mapa ao Vivo →
                </a>
              </div>
            </div>

            <p style="text-align: center; font-size: 11px; color: #94a3b8; margin-top: 20px;">
              Gestão de Entregas • Notificação Automática em Tempo Real
            </p>
          </div>
        `

        const mailer = $app.newMailClient()
        mailer.send({
          from: {
            address: $app.settings().meta.senderAddress || 'no-reply@goskip.app',
            name: $app.settings().meta.senderName || 'Gestão de Entregas',
          },
          to: [{ address: targetEmail }],
          subject: `🛵 Sua entrega (${nextTrackingCode}) é a próxima da fila!`,
          html: htmlBody,
        })
      }
    } catch (mailErr) {
      console.log('Error sending next customer notification email:', mailErr)
    }
  } catch (outerErr) {
    console.log('Error in on_order_next_customer_alert hook:', outerErr)
  }

  e.next()
}, 'orders')
