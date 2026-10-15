// Public Tracking Route Details hook
// Endpoint público para fornecer informações da rota ativa de uma encomenda (waypoints anteriores na ordem otimizada)
// Permite o cálculo real da rota viária e ETA com paradas anteriores de forma segura, sem expor dados sensíveis.
// Protegido contra enumeração/adivinhação e varredura de bots com Rate Limiting por IP (~30 req/min).

function handlePublicTrackingRequest(e) {
  try {
    // 1. Rate Limit por IP para conter varredura de bots e enumeração (~30 requisições/minuto)
    let clientIp = 'default_client_ip'
    try {
      const req = e.request
      const xForwardedFor = req.header
        ? req.header.get('X-Forwarded-For') || req.header.get('x-forwarded-for')
        : ''
      if (xForwardedFor) {
        const parts = xForwardedFor.split(',')
        const first = (parts[0] || '').trim()
        if (first) clientIp = first
      } else {
        const xRealIp = req.header ? req.header.get('X-Real-IP') || req.header.get('x-real-ip') : ''
        if (xRealIp) {
          clientIp = xRealIp.trim()
        } else {
          const cfConnectingIp = req.header
            ? req.header.get('CF-Connecting-IP') || req.header.get('cf-connecting-ip')
            : ''
          if (cfConnectingIp) {
            clientIp = cfConnectingIp.trim()
          } else if (req.remoteAddr) {
            clientIp = String(req.remoteAddr).split(':')[0]
          }
        }
      }
    } catch (_) {}

    const now = Date.now()
    const windowMs = 60 * 1000
    const maxRequests = 30

    let rateAllowed = true
    let retryAfter = 60

    try {
      if (!globalThis.__publicTrackRateLimit) {
        globalThis.__publicTrackRateLimit = {}
      }
      const cache = globalThis.__publicTrackRateLimit
      const keys = Object.keys(cache)
      if (keys.length > 500) {
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]
          if (now - cache[k].startTime > windowMs) {
            delete cache[k]
          }
        }
      }

      const record = cache[clientIp]
      if (!record || now - record.startTime > windowMs) {
        cache[clientIp] = { count: 1, startTime: now }
      } else {
        record.count++
        if (record.count > maxRequests) {
          rateAllowed = false
          retryAfter = Math.max(1, Math.ceil((record.startTime + windowMs - now) / 1000))
        }
      }
    } catch (rlErr) {
      console.log('[public_track_route] Aviso no rate limiter:', rlErr)
    }

    if (!rateAllowed) {
      return e.json(429, {
        error: 'Muitas consultas recentes. Limite de 30 requisições por minuto excedido.',
        retry_after_seconds: retryAfter,
      })
    }

    const rawCode = (
      e.request.pathValue('tracking_code') ||
      e.request.pathValue('code') ||
      ''
    ).trim()
    const trackingCode = rawCode.toUpperCase()
    if (!trackingCode) {
      return e.json(400, { error: 'Código de rastreamento obrigatório.' })
    }

    let targetOrder = null
    try {
      // Consulta direta via $app com privilégio de sistema (contorna restrições de RLS anônimo em orders)
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

    // Se a entrega já foi finalizada ou cancelada, ou se não tem entregador:
    // NUNCA expor marcador nem dados do entregador após entrega/cancelamento (status final)
    if (targetStatus === 'delivered' || targetStatus === 'cancelled' || !courierId) {
      const finishedResponse = {
        order_id: targetOrder.id,
        tracking_code: trackingCode,
        status: targetStatus,
        sequence: targetSequence,
        courier_id: null,
        courier_first_name: null,
        route_released: targetOrder.getBool('route_released'),
        route_started: targetOrder.getBool('route_started'),
        route_finished: targetOrder.getBool('route_finished'),
        estimated_arrival: targetOrder.getString('estimated_arrival'),
        total_price: targetOrder.getFloat('total_price') || 0,
        destination: targetCustomer
          ? {
              name: targetCustomer.getString('name'),
              lat: targetCustomer.getFloat('lat'),
              lng: targetCustomer.getFloat('lng'),
              address: targetCustomer.getString('address'),
            }
          : null,
        courier_location: null,
        is_gps_active: false,
        stops_before: [],
        total_stops_before: 0,
        completed_stops_before: 0,
        queue_position: 1,
        total_deliveries_in_batch: 1,
      }
      return e.json(200, finishedResponse)
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

    // DTO sanitizado mínimo conforme especificação
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
      total_price: targetOrder.getFloat('total_price') || 0,
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

    let stopsBefore = []
    let completedStopsBefore = 0
    let totalInBatch = 1

    const targetRouteStartedAtStr = targetOrder.getString('route_started_at')
    const targetRouteStartedTs = targetRouteStartedAtStr
      ? new Date(targetRouteStartedAtStr).getTime()
      : 0
    const THREE_MINUTES_MS = 3 * 60 * 1000

    try {
      let filterQuery = `courier_id = '${courierId}' && status != 'cancelled'`

      if (targetRouteStartedTs && !isNaN(targetRouteStartedTs)) {
        const minDateStr = new Date(targetRouteStartedTs - THREE_MINUTES_MS)
          .toISOString()
          .replace('T', ' ')
        const maxDateStr = new Date(targetRouteStartedTs + THREE_MINUTES_MS)
          .toISOString()
          .replace('T', ' ')
        filterQuery += ` && route_started_at >= '${minDateStr}' && route_started_at <= '${maxDateStr}'`
      }

      const candidateOrders = $app.findRecordsByFilter('orders', filterQuery, 'sequence', 100, 0)

      const batchOrders = []
      for (const candidate of candidateOrders) {
        if (targetRouteStartedTs && !isNaN(targetRouteStartedTs)) {
          const candStartStr = candidate.getString('route_started_at')
          const candStartTs = candStartStr ? new Date(candStartStr).getTime() : 0
          if (!candStartTs || isNaN(candStartTs)) continue
          if (Math.abs(candStartTs - targetRouteStartedTs) > THREE_MINUTES_MS) continue
        }
        batchOrders.push(candidate)
      }

      totalInBatch = batchOrders.length || 1

      for (const ord of batchOrders) {
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

    stopsBefore.sort((a, b) => a.sequence - b.sequence)

    const queuePosition =
      targetSequence > 0 ? targetSequence : completedStopsBefore + stopsBefore.length + 1

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
}

// Endpoint canônico completo /route
routerAdd('GET', '/backend/v1/public-track/{tracking_code}/route', (e) => {
  return handlePublicTrackingRequest(e)
})

// Endpoint canônico /code direto para clientes anônimos
routerAdd('GET', '/backend/v1/public-track/{code}', (e) => {
  return handlePublicTrackingRequest(e)
})
