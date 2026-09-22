// Public Tracking Route Details hook
// Endpoint público para fornecer informações da rota ativa de uma encomenda (waypoints anteriores na ordem otimizada)
// Permite o cálculo real da rota viária e ETA com paradas anteriores de forma segura, sem expor dados sensíveis.

routerAdd('GET', '/backend/v1/public-track/{tracking_code}/route', (e) => {
  try {
    const trackingCode = (e.request.pathValue('tracking_code') || '').trim().toUpperCase()
    if (!trackingCode) {
      return e.json(400, { error: 'Código de rastreamento obrigatório.' })
    }

    let targetOrder = null
    try {
      const records = $app.findRecordsByFilter(
        'orders',
        `tracking_code = '${trackingCode}'`,
        '-created',
        1,
        0,
      )
      if (records && records.length > 0) {
        targetOrder = records[0]
      }
    } catch (err) {
      console.log('Erro ao buscar pedido por tracking_code:', err)
    }

    if (!targetOrder) {
      return e.json(404, { error: 'Pedido não encontrado.' })
    }

    const courierId = targetOrder.getString('courier_id')
    const targetSequence = targetOrder.getInt('sequence') || 0
    const targetStatus = targetOrder.getString('status')
    const customerId = targetOrder.getString('customer_id')

    // Obter dados do cliente deste pedido
    let targetCustomer = null
    if (customerId) {
      try {
        targetCustomer = $app.findRecordById('customers', customerId)
      } catch (_) {}
    }

    // Dados do pedido para resposta pública (sempre disponíveis mesmo se não liberado ou pendente)
    const baseResponse = {
      order_id: targetOrder.id,
      tracking_code: trackingCode,
      status: targetStatus,
      sequence: targetSequence,
      courier_id: courierId,
      route_released: targetOrder.getBool('route_released'),
      route_started: targetOrder.getBool('route_started'),
      estimated_arrival: targetOrder.getString('estimated_arrival'),
      destination: targetCustomer
        ? {
            name: targetCustomer.getString('name'),
            lat: targetCustomer.getFloat('lat'),
            lng: targetCustomer.getFloat('lng'),
            address: targetCustomer.getString('address'),
          }
        : null,
      stops_before: [],
      total_stops_before: 0,
    }

    // Se a entrega já foi finalizada ou cancelada, ou se não tem entregador
    if (targetStatus === 'delivered' || targetStatus === 'cancelled' || !courierId) {
      return e.json(200, baseResponse)
    }

    // Buscar pedidos anteriores do mesmo entregador que ainda estão pendentes/em trânsito
    // na mesma remessa/dia
    let stopsBefore = []
    try {
      const activeOrders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && (status = 'in_transit' || status = 'pending')`,
        'sequence',
        100,
        0,
      )

      for (const ord of activeOrders) {
        if (ord.id === targetOrder.id) continue

        const ordSeq = ord.getInt('sequence') || 0

        // Se o pedido alvo tem sequência definida (> 0), paradas anteriores são ordSeq < targetSequence
        // Se ambos não tiverem sequência ou tiverem sequence=0, comparar por id ou data
        let isBefore = false
        if (targetSequence > 0) {
          isBefore = ordSeq > 0 && ordSeq < targetSequence
        } else {
          // Se o pedido alvo não tiver sequência definida mas outros tiverem,
          // ou se tiver status pending/in_transit
          isBefore = ordSeq > 0
        }

        if (isBefore) {
          const cId = ord.getString('customer_id')
          let cust = null
          if (cId) {
            try {
              cust = $app.findRecordById('customers', cId)
            } catch (_) {}
          }

          if (cust && cust.getFloat('lat') && cust.getFloat('lng')) {
            stopsBefore.push({
              sequence: ordSeq,
              lat: cust.getFloat('lat'),
              lng: cust.getFloat('lng'),
            })
          }
        }
      }
    } catch (err) {
      console.log('Erro ao buscar paradas anteriores:', err)
    }

    // Ordenar paradas anteriores por sequência crescente
    stopsBefore.sort((a, b) => a.sequence - b.sequence)

    const finalResponse = Object.assign({}, baseResponse, {
      stops_before: stopsBefore,
      total_stops_before: stopsBefore.length,
    })

    return e.json(200, finalResponse)
  } catch (globalErr) {
    console.log('Erro no endpoint de rota pública:', globalErr)
    return e.json(500, { error: 'Erro interno ao consultar rota pública.' })
  }
})
