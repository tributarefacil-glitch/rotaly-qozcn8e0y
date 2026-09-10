// Hook on location creation to detect off-route deviations (>300m) and unexpected stops
// Regra 2: O desvio, alerta e parada só podem ser considerados após o entregador INICIAR a rota (route_started = true)
// Regra 2: Se houver desvio superior a 300m, o trecho NÃO deve ser contabilizado na km nem consumo de combustível

onRecordAfterCreateSuccess((e) => {
  const loc = e.record
  const courierId = loc.getString('user_id')
  const lat = loc.getFloat('lat')
  const lng = loc.getFloat('lng')
  const speedKmh = loc.getFloat('speed') || 0

  if (!courierId || !lat || !lng) {
    e.next()
    return
  }

  // Find active orders for this courier with route_started = true
  // Considera status 'in_transit', 'address_error' e 'client_absent' (rotas parciais até o retorno à base)
  let activeOrders = []
  try {
    activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && route_started = true && (status = 'in_transit' || status = 'address_error' || status = 'client_absent')`,
      '-updated',
      1,
      0,
    )
  } catch (err) {
    console.log('Error finding orders for location check:', err)
    e.next()
    return
  }

  if (activeOrders.length === 0) {
    e.next()
    return
  }

  const activeOrder = activeOrders[0]
  const customerId = activeOrder.getString('customer_id')
  const trackingCode = activeOrder.getString('tracking_code')
  const sellerId = activeOrder.getString('seller_id')

  // Find courier user name
  let courierName = 'Entregador'
  try {
    const courierUser = $app.findRecordById('users', courierId)
    if (courierUser) {
      courierName = courierUser.getString('name') || courierUser.getString('email') || 'Entregador'
    }
  } catch (_) {}

  // Find customer to get destination coordinates
  let custLat = null
  let custLng = null
  let custAddress = ''
  if (customerId) {
    try {
      const cust = $app.findRecordById('customers', customerId)
      if (cust) {
        custLat = cust.getFloat('lat')
        custLng = cust.getFloat('lng')
        custAddress = cust.getString('address')
      }
    } catch (errCust) {
      console.log('Error finding customer:', errCust)
    }
  }

  if (custLat === null || custLng === null) {
    e.next()
    return
  }

  // Calculate Haversine distance in meters
  const R = 6371e3
  const φ1 = (lat * Math.PI) / 180
  const φ2 = (custLat * Math.PI) / 180
  const Δφ = ((custLat - lat) * Math.PI) / 180
  const Δλ = ((custLng - lng) * Math.PI) / 180
  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  const distToCustomerMeters = R * c

  // Fetch previous location for this courier to detect stop or deviation
  let prevLocations = []
  try {
    prevLocations = $app.findRecordsByFilter(
      'locations',
      `user_id = '${courierId}' && id != '${loc.id}'`,
      '-created',
      2,
      0,
    )
  } catch (_) {}

  let prevDistanceToCustomer = null
  let prevLat = null
  let prevLng = null

  if (prevLocations.length > 0) {
    prevLat = prevLocations[0].getFloat('lat')
    prevLng = prevLocations[0].getFloat('lng')

    if (prevLat && prevLng) {
      const pφ1 = (prevLat * Math.PI) / 180
      const pΔφ = ((custLat - prevLat) * Math.PI) / 180
      const pΔλ = ((custLng - prevLng) * Math.PI) / 180
      const pa =
        Math.sin(pΔφ / 2) * Math.sin(pΔφ / 2) +
        Math.cos(pφ1) * Math.cos(φ2) * Math.sin(pΔλ / 2) * Math.sin(pΔλ / 2)
      const pc = 2 * Math.atan2(Math.sqrt(pa), Math.sqrt(1 - pa))
      prevDistanceToCustomer = R * pc
    }
  }

  // 1. Check for Unexpected Stop:
  // If courier is standing still (speed < 2 km/h) and distance to customer is > 200m (not yet arrived)
  // and was also still at same spot in previous check
  if (speedKmh < 2 && distToCustomerMeters > 200 && prevLat && prevLng) {
    const pΔφ = ((lat - prevLat) * Math.PI) / 180
    const pΔλ = ((lng - prevLng) * Math.PI) / 180
    const pa =
      Math.sin(pΔφ / 2) * Math.sin(pΔφ / 2) +
      Math.cos((prevLat * Math.PI) / 180) *
        Math.cos((lat * Math.PI) / 180) *
        Math.sin(pΔλ / 2) *
        Math.sin(pΔλ / 2)
    const moveDistanceMeters = R * 2 * Math.atan2(Math.sqrt(pa), Math.sqrt(1 - pa))

    if (moveDistanceMeters < 30) {
      // Only trigger alert once every 10 minutes per courier
      let recentStopAlerts = []
      try {
        const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString()
        recentStopAlerts = $app.findRecordsByFilter(
          'notifications',
          `user_id = '${courierId}' && type = 'off_route' && created >= '${tenMinAgo}'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (recentStopAlerts.length === 0) {
        // Log off_route_events
        try {
          const offRouteCol = $app.findCollectionByNameOrId('off_route_events')
          const ev = new Record(offRouteCol)
          ev.set('courier_id', courierId)
          ev.set('order_id', activeOrder.id)
          ev.set('event_type', 'unexpected_stop')
          ev.set('lat', lat)
          ev.set('lng', lng)
          ev.set('notes', `Parada não planejada a ${Math.round(distToCustomerMeters)}m do destino.`)
          $app.save(ev)
        } catch (errEv) {
          console.log('Error saving off_route event:', errEv)
        }

        // Create notification for Courier
        try {
          const notifCol = $app.findCollectionByNameOrId('notifications')
          const notif = new Record(notifCol)
          notif.set('user_id', courierId)
          notif.set('order_id', activeOrder.id)
          notif.set('type', 'warning')
          notif.set('title', '⚠️ Alerta de Parada Inesperada')
          notif.set(
            'message',
            `Você está parado a ${Math.round(distToCustomerMeters)}m da entrega ${trackingCode}. Caso precise de ajuda, contate a central.`,
          )
          notif.set('is_read', false)
          $app.save(notif)
        } catch (errNotif) {
          console.log('Error creating courier notification:', errNotif)
        }

        // Create notification for Seller
        if (sellerId) {
          try {
            const notifCol = $app.findCollectionByNameOrId('notifications')
            const notif = new Record(notifCol)
            notif.set('user_id', sellerId)
            notif.set('order_id', activeOrder.id)
            notif.set('type', 'off_route')
            notif.set('title', '⚠️ Parada Suspeita de Entregador')
            notif.set(
              'message',
              `O entregador ${courierName} está parado a ${Math.round(distToCustomerMeters)}m do pedido ${trackingCode}.`,
            )
            notif.set('is_read', false)
            $app.save(notif)
          } catch (errNotif) {
            console.log('Error creating seller notification:', errNotif)
          }
        }
      }
    }
  }

  // 2. Check for Route Deviation (> 300 meters moving away from target or unusual trajectory)
  // Regra 2: Se houver desvio de rota superior a 300 metros, esse trecho NÃO deve ser contabilizado na km/combustível
  if (speedKmh > 10 && prevDistanceToCustomer !== null) {
    const deviationDelta = distToCustomerMeters - prevDistanceToCustomer

    // If courier moved significantly further from destination (>= 300m increase)
    if (deviationDelta >= 300) {
      // Check cooldown: avoid spamming alerts if one was created in last 5 min
      let recentAlerts = []
      try {
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()
        recentAlerts = $app.findRecordsByFilter(
          'notifications',
          `user_id = '${courierId}' && type = 'off_route' && created >= '${fiveMinAgo}'`,
          '-created',
          1,
          0,
        )
      } catch (_) {}

      if (recentAlerts.length === 0) {
        // Log off_route_events
        try {
          const offRouteCol = $app.findCollectionByNameOrId('off_route_events')
          const ev = new Record(offRouteCol)
          ev.set('courier_id', courierId)
          ev.set('order_id', activeOrder.id)
          ev.set('event_type', 'route_deviation')
          ev.set('distance_deviation_meters', Math.round(deviationDelta))
          ev.set('lat', lat)
          ev.set('lng', lng)
          ev.set(
            'notes',
            `Desvio de rota superior a 300m detectado (+${Math.round(deviationDelta)}m). Trecho não contabilizado no consumo de combustível.`,
          )
          $app.save(ev)
        } catch (errDev) {
          console.log('Error saving deviation event:', errDev)
        }

        // Create notification for Courier
        try {
          const notifCol = $app.findCollectionByNameOrId('notifications')
          const notif = new Record(notifCol)
          notif.set('user_id', courierId)
          notif.set('order_id', activeOrder.id)
          notif.set('type', 'off_route')
          notif.set('title', '🚨 Alerta de Desvio de Rota (>300m)')
          notif.set(
            'message',
            `Você está se afastando da rota do pedido ${trackingCode} (+${Math.round(deviationDelta)}m). Trecho desconsiderado no cálculo de combustível.`,
          )
          notif.set('is_read', false)
          $app.save(notif)
        } catch (errNotif) {
          console.log('Error creating courier notification:', errNotif)
        }

        // Create notification for Seller
        if (sellerId) {
          try {
            const notifCol = $app.findCollectionByNameOrId('notifications')
            const notif = new Record(notifCol)
            notif.set('user_id', sellerId)
            notif.set('order_id', activeOrder.id)
            notif.set('type', 'off_route')
            notif.set('title', '🚨 Desvio de Rota do Entregador (>300m)')
            notif.set(
              'message',
              `O entregador ${courierName} desviou mais de 300m da rota do pedido ${trackingCode}. Trecho desconsiderado da medição de combustível.`,
            )
            notif.set('is_read', false)
            $app.save(notif)
          } catch (errNotif) {
            console.log('Error creating seller notification:', errNotif)
          }
        }
      }
    }
  }

  e.next()
}, 'locations')
