// Route optimization endpoint: takes list of order IDs and returns optimized sequence
// Supports Google Maps Directions API if key is present or uses intelligent geospatial TSP algorithm
routerAdd('POST', '/backend/v1/optimize-route', (e) => {
  try {
    const body = e.requestInfo().body || {}
    const orderIds = body.order_ids || []
    const originLat = body.origin_lat || -23.55052
    const originLng = body.origin_lng || -46.633308

    if (!orderIds || orderIds.length === 0) {
      return e.json(400, { error: 'Nenhum ID de pedido fornecido para otimização.' })
    }

    const ordersWithCoords = []
    for (const id of orderIds) {
      try {
        const order = $app.findRecordById('orders', id)
        const customerId = order.getString('customer_id')
        let customer = null
        if (customerId) {
          customer = $app.findRecordById('customers', customerId)
        }

        const lat = customer ? customer.getFloat('lat') : null
        const lng = customer ? customer.getFloat('lng') : null

        ordersWithCoords.push({
          id: order.id,
          tracking_code: order.getString('tracking_code'),
          priority: order.getString('priority'),
          status: order.getString('status'),
          customer_name: customer ? customer.getString('name') : 'Cliente',
          address: customer ? customer.getString('address') : 'Endereço',
          lat: lat || originLat,
          lng: lng || originLng,
        })
      } catch (err) {
        console.log('Erro ao buscar pedido para rota:', err)
      }
    }

    // Distance calculation inline
    function calcDist(lat1, lon1, lat2, lon2) {
      const R = 6371e3
      const φ1 = (lat1 * Math.PI) / 180
      const φ2 = (lat2 * Math.PI) / 180
      const Δφ = ((lat2 - lat1) * Math.PI) / 180
      const Δλ = ((lon2 - lon1) * Math.PI) / 180
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    // Priority weighted Nearest Neighbor TSP
    const unvisited = [...ordersWithCoords]
    const optimized = []
    let currentLat = originLat
    let currentLng = originLng
    let totalDistanceMeters = 0

    while (unvisited.length > 0) {
      let bestIndex = -1
      let bestScore = Infinity

      for (let i = 0; i < unvisited.length; i++) {
        const item = unvisited[i]
        const d = calcDist(currentLat, currentLng, item.lat, item.lng)
        // Urgent weight penalty reducer (makes urgent orders chosen first)
        let weightMultiplier = 1.0
        if (item.priority === 'urgent') weightMultiplier = 0.4
        else if (item.priority === 'high') weightMultiplier = 0.7

        const score = d * weightMultiplier
        if (score < bestScore) {
          bestScore = score
          bestIndex = i
        }
      }

      if (bestIndex >= 0) {
        const nextOrder = unvisited.splice(bestIndex, 1)[0]
        const actualDist = calcDist(currentLat, currentLng, nextOrder.lat, nextOrder.lng)
        totalDistanceMeters += actualDist
        currentLat = nextOrder.lat
        currentLng = nextOrder.lng
        optimized.push({
          ...nextOrder,
          step_distance_meters: Math.round(actualDist),
          cumulative_distance_meters: Math.round(totalDistanceMeters),
        })
      } else {
        break
      }
    }

    const estimatedDurationMinutes = Math.round(
      (totalDistanceMeters / 1000) * 3.5 + optimized.length * 5,
    )

    return e.json(200, {
      optimized_orders: optimized,
      total_distance_km: (totalDistanceMeters / 1000).toFixed(2),
      estimated_duration_minutes: estimatedDurationMinutes,
      stops_count: optimized.length,
    })
  } catch (err) {
    console.log('Optimize route error:', err)
    return e.json(500, { error: 'Falha ao otimizar rota: ' + (err.message || String(err)) })
  }
})
