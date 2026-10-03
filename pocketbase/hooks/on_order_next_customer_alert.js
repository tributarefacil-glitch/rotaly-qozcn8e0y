// Hook triggered after order is updated (e.g. finished/delivered)
// When a delivery is completed, check the next order in queue for that courier and notify the next customer via native PB email
onRecordAfterUpdateSuccess((e) => {
  try {
    const updatedOrder = e.record
    const originalOrder = updatedOrder.original()

    const newStatus = updatedOrder.getString('status')
    const oldStatus = originalOrder ? originalOrder.getString('status') : ''
    const courierId = updatedOrder.getString('courier_id')

    // 1. DISPARO SÓ NA TRANSIÇÃO RELEVANTE:
    // O pedido atual precisa ter acabando de MUDAR de um status anterior não-finalizado para um status de finalização.
    // Se o status não mudou (ex: PATCH de telemetria, odômetro, fotos, sequence), aborta imediatamente.
    const isCompletedStatus =
      newStatus === 'delivered' || newStatus === 'address_error' || newStatus === 'client_absent'

    const wasAlreadyCompleted =
      oldStatus === 'delivered' || oldStatus === 'address_error' || oldStatus === 'client_absent'

    if (!isCompletedStatus || wasAlreadyCompleted || !courierId) {
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
    const customerAddress = customer.getString('address') || ''
    const customerEmail = (customer.getString('email') || '').trim()

    let courierName = 'Seu entregador'
    try {
      const courierRecord = $app.findRecordById('_pb_users_auth_', courierId)
      courierName = courierRecord.getString('name') || 'Seu entregador'
    } catch (_) {}

    // 4. LINK DE RASTREIO DINÂMICO COM APP_PUBLIC_URL E FALLBACK
    const appBaseUrl = (
      $os.getenv('APP_PUBLIC_URL') ||
      $os.getenv('SITE_URL') ||
      'https://www.rotaly.com.br'
    ).replace(/\/+$/, '')

    const trackingUrl = `${appBaseUrl}/track/${nextTrackingCode}`

    // 1. In-app Notification for the upcoming order (mantido para a operação do vendedor)
    try {
      const notifsCol = $app.findCollectionByNameOrId('notifications')
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

    // 3. DESTINO CORRETO DO E-MAIL:
    // Se o cliente não tiver e-mail cadastrado, NÃO enviar para equipe interna (seller/admin).
    // Registrar em log e pular o envio de e-mail ao cliente.
    if (!customerEmail) {
      console.log(
        `[NEXT_CUSTOMER_ALERT] Cliente ${customerName} (pedido ${nextTrackingCode}) não possui e-mail cadastrado. ` +
          `Envio de e-mail ao cliente pulado (sem poluição da caixa da equipe interna).`,
      )
      e.next()
      return
    }

    // 2. DEDUPLICAÇÃO PERSISTENTE:
    // Chave única: order_id:tipo_notificacao (ex: "gf1rx3t6i2y9mye:next_customer_alert")
    // Se já houver registro com menos de 1 hora, pular envio.
    // Tratar erro de unique como "já enviado recentemente" e abortar sem e-mail.
    const dedupKey = `${nextOrder.id}:next_customer_alert`
    const oneHourAgoIso = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ')

    try {
      // Verificar se já existe registro recente na coleção notification_dedup
      let existingRecent = []
      try {
        existingRecent = $app.findRecordsByFilter(
          'notification_dedup',
          `dedup_key = '${dedupKey}' && created >= '${oneHourAgoIso}'`,
          '-created',
          1,
          0,
        )
      } catch (errFind) {
        // Se a busca falhou ou retornou erro, prossegue com verificação por chave
      }

      if (existingRecent && existingRecent.length > 0) {
        console.log(
          `[NEXT_CUSTOMER_ALERT] Deduplicação ativa: Alerta para o pedido ${nextOrder.id} (${nextTrackingCode}) ` +
            `já foi enviado em ${existingRecent[0].getString('created')}. Envio abortado.`,
        )
        e.next()
        return
      }

      // Tenta gravar ou atualizar a chave no banco de dados
      const dedupCol = $app.findCollectionByNameOrId('notification_dedup')
      let dedupRecord = null

      try {
        dedupRecord = $app.findFirstRecordByData('notification_dedup', 'dedup_key', dedupKey)
      } catch (_) {
        // Não existe ainda
      }

      if (dedupRecord) {
        // Se existe mas foi criado há mais de 1 hora, atualiza
        const recordCreated = dedupRecord.getString('created')
        if (recordCreated && recordCreated >= oneHourAgoIso) {
          console.log(
            `[NEXT_CUSTOMER_ALERT] Registro existente há menos de 1 hora (${recordCreated}). Abortando envio.`,
          )
          e.next()
          return
        }
        dedupRecord.set('recipient', customerEmail)
        dedupRecord.set('updated', new Date().toISOString())
        $app.save(dedupRecord)
      } else {
        const newRecord = new Record(dedupCol)
        newRecord.set('dedup_key', dedupKey)
        newRecord.set('tipo_notificacao', 'next_customer_alert')
        newRecord.set('order_id', nextOrder.id)
        newRecord.set('recipient', customerEmail)
        $app.save(newRecord)
      }
    } catch (dedupErr) {
      // Se ocorrer erro de UNIQUE ou conflito concorrente no banco, considera como já enviado
      console.log(
        `[NEXT_CUSTOMER_ALERT] Conflito de deduplicação ou registro já gravado para chave ${dedupKey}:`,
        dedupErr,
      )
      e.next()
      return
    }

    // Enviar e-mail transacional ao CLIENTE destinatário
    try {
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
            Rotaly Logística • Notificação Automática em Tempo Real
          </p>
        </div>
      `

      const mailer = $app.newMailClient()
      mailer.send({
        from: {
          address: $app.settings().meta.senderAddress || 'no-reply@rotaly.com.br',
          name: $app.settings().meta.senderName || 'Rotaly Entregas',
        },
        to: [{ address: customerEmail }],
        subject: `🛵 Sua entrega (${nextTrackingCode}) é a próxima da fila!`,
        html: htmlBody,
      })

      console.log(
        `[NEXT_CUSTOMER_ALERT] E-mail enviado com sucesso para ${customerEmail} (pedido ${nextTrackingCode}).`,
      )
    } catch (mailErr) {
      console.log('Error sending next customer notification email:', mailErr)
    }
  } catch (outerErr) {
    console.log('Error in on_order_next_customer_alert hook:', outerErr)
  }

  e.next()
}, 'orders')
