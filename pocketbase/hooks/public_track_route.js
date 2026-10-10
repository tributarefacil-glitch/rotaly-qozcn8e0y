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

    // Obter apenas o PRIMEIRO NOME do entregador para segurança pública (nunca CPF, telefone, email ou sobrenome completo)
    let courierFirstName = ''
    if (courierId) {
      try {
        const courierRecord = $app.findRecordById('users', courierId)
        if (courierRecord) {
          const rawName = (courierRecord.getString('name') || '').trim()
          if (rawName) {
            courierFirstName = rawName.split(/\s+/)[0]
          }
        }
      } catch (_) {}
    }

    // Buscar a localização mais recente do entregador para verificar atividade (<15 minutos)
    let latestCourierLocation = null
    let isGpsFresh = false
    const FIFTEEN_MINUTES_MS = 15 * 60 * 1000

    if (courierId && targetStatus === 'in_transit') {
      try {
        const locRecords = $app.findRecordsByFilter(
          'locations',
          `user_id = '${courierId}'`,
          '-created',
          1,
          0,
        )
        if (locRecords && locRecords.length > 0) {
          const loc = locRecords[0]
          const locCreatedStr = loc.getString('created') || loc.get('created')
          const locTime = new Date(locCreatedStr).getTime()
          const now = Date.now()
          const ageMs = now - locTime
          if (!isNaN(locTime) && ageMs >= 0 && ageMs <= FIFTEEN_MINUTES_MS) {
            isGpsFresh = true
            latestCourierLocation = {
              lat: loc.getFloat('lat'),
              lng: loc.getFloat('lng'),
              speed: loc.getFloat('speed') || 0,
              created: locCreatedStr,
              age_seconds: Math.round(ageMs / 1000),
            }
          }
        }
      } catch (locErr) {
        console.log('Erro ao buscar localização recente do entregador:', locErr)
      }
    }

    // Dados do pedido para resposta pública (sempre seguros: NUNCA expor dados sensíveis do entregador)
    const baseResponse = {
      order_id: targetOrder.id,
      tracking_code: trackingCode,
      status: targetStatus,
      sequence: targetSequence,
      courier_id: courierId ? courierId : null,
      courier_first_name: courierFirstName || null,
      route_released: targetOrder.getBool('route_released'),
      route_started: targetOrder.getBool('route_started'),
      route_finished: targetOrder.getBool('route_finished'),
      estimated_arrival: targetOrder.getString('estimated_arrival'),
      destination: targetCustomer
        ? {
            name: targetCustomer.getString('name'),
            lat: targetCustomer.getFloat('lat'),
            lng: targetCustomer.getFloat('lng'),
            address: targetCustomer.getString('address'),
          }
        : null,
      courier_location: isGpsFresh ? latestCourierLocation : null,
      is_gps_active: isGpsFresh,
      stops_before: [],
      total_stops_before: 0,
      completed_stops_before: 0,
      queue_position: 1,
      total_deliveries_in_batch: 1,
    }

    // Se a entrega já foi finalizada ou cancelada, ou se não tem entregador
    // NUNCA expor marcador nem dados do entregador após entrega/cancelamento
    if (targetStatus === 'delivered' || targetStatus === 'cancelled' || !courierId) {
      baseResponse.courier_first_name = null
      baseResponse.courier_location = null
      baseResponse.is_gps_active = false
      return e.json(200, baseResponse)
    }

    // Buscar pedidos anteriores do mesmo entregador que ainda estão pendentes/em trânsito
    // na mesma remessa/dia, além de contar paradas já concluídas
    let stopsBefore = []
    let completedStopsBefore = 0
    let totalInBatch = 1

    try {
      const allBatchOrders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && status != 'cancelled'`,
        'sequence',
        100,
        0,
      )

      totalInBatch = allBatchOrders.length || 1

      for (const ord of allBatchOrders) {
        if (ord.id === targetOrder.id) continue

        const ordSeq = ord.getInt('sequence') || 0
        const ordStatus = ord.getString('status')

        let isBefore = false
        if (targetSequence > 0) {
          isBefore = ordSeq > 0 && ordSeq < targetSequence
        } else {
          isBefore = ordSeq > 0
        }

        if (isBefore) {
          if (ordStatus === 'delivered') {
            completedStopsBefore++
          } else if (ordStatus === 'in_transit' || ordStatus === 'pending') {
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
      }
    } catch (err) {
      console.log('Erro ao buscar paradas anteriores:', err)
    }

    // Ordenar paradas anteriores por sequência crescente
    stopsBefore.sort((a, b) => a.sequence - b.sequence)

    // Posição na fila: paradas concluídas antes + paradas pendentes antes + 1
    const queuePosition = completedStopsBefore + stopsBefore.length + 1

    const finalResponse = Object.assign({}, baseResponse, {
      stops_before: stopsBefore,
      total_stops_before: stopsBefore.length,
      completed_stops_before: completedStopsBefore,
      queue_position: queuePosition,
      total_deliveries_in_batch: Math.max(totalInBatch, queuePosition),
    })

    return e.json(200, finalResponse)
  } catch (globalErr) {
    console.log('Erro no endpoint de rota pública:', globalErr)
    return e.json(500, { error: 'Erro interno ao consultar rota pública.' })
  }
})
