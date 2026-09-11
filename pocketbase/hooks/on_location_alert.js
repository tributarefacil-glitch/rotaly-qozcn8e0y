// Hook on location creation to detect off-route deviations (>600m) and unexpected stops (>600m from destination and base with speed <= 2 km/h)
// Regra 1: Alertas de desvio/parada só devem ser gerados quando o pedido estiver com rota iniciada (route_started = true e status 'in_transit')
// Regra 2: Limiar unificado de 600 metros conforme src/lib/geo.ts (DEVIATION_THRESHOLD_METERS = 600, UNEXPECTED_STOP_THRESHOLD_METERS = 600)
// PocketBase JSVM: todas as variáveis e constantes devem estar inline dentro do callback do hook

onRecordAfterCreateSuccess((e) => {
  // Constantes de limiar geográfico sincronizadas com src/lib/geo.ts
  const DEVIATION_THRESHOLD_METERS = 600
  const UNEXPECTED_STOP_THRESHOLD_METERS = 600

  const loc = e.record
  const courierId = loc.getString('user_id')
  const lat = loc.getFloat('lat')
  const lng = loc.getFloat('lng')
  const speedKmh = loc.getFloat('speed') || 0

  if (!courierId || !lat || !lng) {
    e.next()
    return
  }

  // Find active orders for this courier strictly with route_started = true and status = 'in_transit'
  let activeOrders = []
  try {
    activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && route_started = true && status = 'in_transit'`,
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

  // Calculate Haversine distance in meters to customer destination
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

  // Base coordinates (if set on the order, else fallback to null)
  let baseLat = activeOrder.getFloat('start_base_lat') || null
  let baseLng = activeOrder.getFloat('start_base_lng') || null
  let distToBaseMeters = null
  if (baseLat !== null && baseLng !== null) {
    const bφ2 = (baseLat * Math.PI) / 180
    const bΔφ = ((baseLat - lat) * Math.PI) / 180
    const bΔλ = ((baseLng - lng) * Math.PI) / 180
    const ba =
      Math.sin(bΔφ / 2) * Math.sin(bΔφ / 2) +
      Math.cos(φ1) * Math.cos(bφ2) * Math.sin(bΔλ / 2) * Math.sin(bΔλ / 2)
    distToBaseMeters = R * 2 * Math.atan2(Math.sqrt(ba), Math.sqrt(1 - ba))
  }

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

  // 1. Check for Unexpected Stop (Parada fora do local):
  // Velocidade <= 2 km/h, distância > 600m do cliente de destino E > 600m da base (se conhecida)
  // e entregador parado no mesmo local em relação ao ponto anterior
  const isFarFromCustomer = distToCustomerMeters > UNEXPECTED_STOP_THRESHOLD_METERS
  const isFarFromBase =
    distToBaseMeters === null || distToBaseMeters > UNEXPECTED_STOP_THRESHOLD_METERS

  if (speedKmh <= 2 && isFarFromCustomer && isFarFromBase && prevLat && prevLng) {
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
          ev.set(
            'notes',
            `Parada não planejada fora do local a ${Math.round(distToCustomerMeters)}m do destino (>600m).`,
          )
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
            notif.set('title', '⚠️ Parada Suspeita de Entregador (>600m)')
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

  // 2. Check for Route Deviation (> 600 meters moving away from target or unusual trajectory)
  // Regra unificada: limiar de desvio DEVIATION_THRESHOLD_METERS = 600m
  // Se houver desvio de rota superior a 600 metros, o trecho não deve ser contabilizado no combustível
  if (speedKmh > 10 && prevDistanceToCustomer !== null) {
    const deviationDelta = distToCustomerMeters - prevDistanceToCustomer

    // If courier moved significantly further from destination (>= 600m increase)
    if (deviationDelta >= DEVIATION_THRESHOLD_METERS) {
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
            `Desvio de rota superior a 600m detectado (+${Math.round(deviationDelta)}m). Trecho não contabilizado no consumo de combustível.`,
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
          notif.set('title', '🚨 Alerta de Desvio de Rota (>600m)')
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
            notif.set('title', '🚨 Desvio de Rota do Entregador (>600m)')
            notif.set(
              'message',
              `O entregador ${courierName} desviou mais de 600m da rota do pedido ${trackingCode}. Trecho desconsiderado da medição de combustível.`,
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
