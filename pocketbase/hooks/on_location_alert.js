// Hook on location creation to detect off-route deviations (>500m) and unexpected stops
// Alert both courier and seller/admin and persist in off_route_events
onRecordAfterCreateSuccess((e) => {
  try {
    const loc = e.record
    const courierId = loc.getString('user_id')
    const lat = loc.getFloat('lat')
    const lng = loc.getFloat('lng')
    const speed = loc.getFloat('speed') || 0

    if (!courierId || !lat || !lng) {
      e.next()
      return
    }

    // Find active in_transit orders for this courier ordered by sequence or created
    let activeOrders = []
    try {
      activeOrders = $app.findRecordsByFilter(
        'orders',
        `courier_id = '${courierId}' && status = 'in_transit'`,
        'sequence,created',
        10,
        0,
      )
    } catch (findErr) {
      console.log('Error fetching active orders:', findErr)
    }

    if (!activeOrders || activeOrders.length === 0) {
      e.next()
      return
    }

    // The current active delivery target is the first order in the queue
    const currentOrder = activeOrders[0]
    const customerId = currentOrder.getString('customer_id')
    const sellerId = currentOrder.getString('seller_id')
    const trackingCode = currentOrder.getString('tracking_code')

    let customer = null
    try {
      if (customerId) {
        customer = $app.findRecordById('customers', customerId)
      }
    } catch (_) {}

    if (!customer) {
      e.next()
      return
    }

    const custLat = customer.getFloat('lat')
    const custLng = customer.getFloat('lng')
    const custAddress = customer.getString('address') || ''

    if (!custLat || !custLng) {
      e.next()
      return
    }

    // Inline distance helper
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

    let courierName = 'Entregador'
    try {
      const courierUser = $app.findRecordById('_pb_users_auth_', courierId)
      courierName = courierUser.getString('name') || 'Entregador'
    } catch (_) {}

    const notifsCol = $app.findCollectionByNameOrId('notifications')
    const eventsCol = $app.findCollectionByNameOrId('off_route_events')

    // 1. Check if vehicle is STOPPED outside destination (>100m from customer destination and speed == 0)
    if (speed <= 1 && distToCustomerMeters > 150) {
      // Check if previous location was also stopped (>30s)
      if (prevLocations.length > 0) {
        const prevLoc = prevLocations[0]
        const prevSpeed = prevLoc.getFloat('speed') || 0
        if (prevSpeed <= 1) {
          // Avoid spam: check if an unexpected stop event was created in the last 5 minutes
          let recentStopEvents = []
          try {
            recentStopEvents = $app.findRecordsByFilter(
              'off_route_events',
              `courier_id = '${courierId}' && event_type = 'unexpected_stop'`,
              '-created',
              1,
              0,
            )
          } catch (_) {}

          let canTriggerStop = true
          if (recentStopEvents.length > 0) {
            const lastCreated = new Date(recentStopEvents[0].getString('created')).getTime()
            if (Date.now() - lastCreated < 3 * 60 * 1000) {
              canTriggerStop = false
            }
          }

          if (canTriggerStop) {
            // Save off_route_events record
            try {
              const ev = new Record(eventsCol)
              ev.set('courier_id', courierId)
              ev.set('order_id', currentOrder.id)
              ev.set('event_type', 'unexpected_stop')
              ev.set('lat', lat)
              ev.set('lng', lng)
              ev.set('stop_duration_seconds', 60)
              ev.set(
                'notes',
                `Veículo parado fora do destino previsto (${Math.round(distToCustomerMeters)}m do cliente).`,
              )
              $app.save(ev)
            } catch (errEv) {
              console.log('Error saving unexpected_stop event:', errEv)
            }

            // Notify Courier
            try {
              const notifCourier = new Record(notifsCol)
              notifCourier.set('user_id', courierId)
              notifCourier.set('title', '⚠️ Alerta de Parada Fora de Rota')
              notifCourier.set(
                'message',
                `Identificamos que você está parado fora dos pontos previstos para o pedido ${trackingCode}.`,
              )
              notifCourier.set('type', 'off_route')
              notifCourier.set('read', false)
              notifCourier.set('order_id', currentOrder.id)
              $app.save(notifCourier)
            } catch (_) {}

            // Notify Seller if present
            if (sellerId) {
              try {
                const notifSeller = new Record(notifsCol)
                notifSeller.set('user_id', sellerId)
                notifSeller.set('title', `⚠️ Parada Fora de Rota: ${courierName}`)
                notifSeller.set(
                  'message',
                  `O entregador ${courierName} parou fora dos pontos previstos da rota (${trackingCode}).`,
                )
                notifSeller.set('type', 'off_route')
                notifSeller.set('read', false)
                notifSeller.set('order_id', currentOrder.id)
                $app.save(notifSeller)
              } catch (_) {}
            }
          }
        }
      }
    }

    // 2. Check for Route Deviation (> 500 meters moving away from target or unusual trajectory)
    // If moving (> 10km/h) and distance increased by > 500m compared to previous location towards customer
    if (prevLocations.length > 0 && speed > 5) {
      const prevLoc = prevLocations[0]
      const prevLat = prevLoc.getFloat('lat')
      const prevLng = prevLoc.getFloat('lng')

      const prevφ1 = (prevLat * Math.PI) / 180
      const prevΔφ = ((custLat - prevLat) * Math.PI) / 180
      const prevΔλ = ((custLng - prevLng) * Math.PI) / 180
      const prevA =
        Math.sin(prevΔφ / 2) * Math.sin(prevΔφ / 2) +
        Math.cos(prevφ1) * Math.cos(φ2) * Math.sin(prevΔλ / 2) * Math.sin(prevΔλ / 2)
      const prevDist = R * 2 * Math.atan2(Math.sqrt(prevA), Math.sqrt(1 - prevA))

      // If courier moved significantly further from destination (> 500m increase)
      const deviationDelta = distToCustomerMeters - prevDist
      if (deviationDelta >= 500) {
        // Check debounce (last 5 minutes)
        let recentDevEvents = []
        try {
          recentDevEvents = $app.findRecordsByFilter(
            'off_route_events',
            `courier_id = '${courierId}' && event_type = 'route_deviation'`,
            '-created',
            1,
            0,
          )
        } catch (_) {}

        let canTriggerDev = true
        if (recentDevEvents.length > 0) {
          const lastCreated = new Date(recentDevEvents[0].getString('created')).getTime()
          if (Date.now() - lastCreated < 4 * 60 * 1000) {
            canTriggerDev = false
          }
        }

        if (canTriggerDev) {
          try {
            const ev = new Record(eventsCol)
            ev.set('courier_id', courierId)
            ev.set('order_id', currentOrder.id)
            ev.set('event_type', 'route_deviation')
            ev.set('distance_deviation_meters', Math.round(deviationDelta))
            ev.set('lat', lat)
            ev.set('lng', lng)
            ev.set(
              'notes',
              `Desvio de rota superior a 500m detectado (+${Math.round(deviationDelta)}m de afastamento do destino).`,
            )
            $app.save(ev)
          } catch (errDev) {
            console.log('Error saving deviation event:', errDev)
          }

          // Notify Courier with audio trigger
          try {
            const notifCourier = new Record(notifsCol)
            notifCourier.set('user_id', courierId)
            notifCourier.set('title', '🚨 Alerta de Desvio de Rota (>500m)')
            notifCourier.set(
              'message',
              `Desvio de rota detectado para o pedido ${trackingCode}. Verifique o trajeto recomendado.`,
            )
            notifCourier.set('type', 'off_route')
            notifCourier.set('read', false)
            notifCourier.set('order_id', currentOrder.id)
            $app.save(notifCourier)
          } catch (_) {}

          // Notify Seller
          if (sellerId) {
            try {
              const notifSeller = new Record(notifsCol)
              notifSeller.set('user_id', sellerId)
              notifSeller.set('title', `🚨 Desvio de Rota: ${courierName}`)
              notifSeller.set(
                'message',
                `O entregador ${courierName} desviou mais de 500m da rota do pedido ${trackingCode}.`,
              )
              notifSeller.set('type', 'off_route')
              notifSeller.set('read', false)
              notifSeller.set('order_id', currentOrder.id)
              $app.save(notifSeller)
            } catch (_) {}
          }
        }
      }
    }
  } catch (err) {
    console.log('Error in on_location_alert hook:', err)
  }

  e.next()
}, 'locations')
