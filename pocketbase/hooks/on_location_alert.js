// Off-route alert hook on location creation
// One hook per file. All logic inline.
onRecordAfterCreateSuccess((e) => {
  try {
    const loc = e.record
    const courierId = loc.getString('user_id')
    const lat = loc.getFloat('lat')
    const lng = loc.getFloat('lng')

    if (!courierId || !lat || !lng) {
      e.next()
      return
    }

    // Find active in_transit orders for this courier
    const activeOrders = $app.findRecordsByFilter(
      'orders',
      `courier_id = '${courierId}' && status = 'in_transit'`,
      '-created',
      10,
      0,
    )

    if (activeOrders.length === 0) {
      e.next()
      return
    }

    // Check distance to destination of current active orders
    // Haversine formula calculation inline
    function getDistanceMeters(lat1, lon1, lat2, lon2) {
      const R = 6371e3 // metres
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

    // Load customer coords to estimate if courier is wildly drifting (> 5000m or specific condition)
    let courierUser = null
    try {
      courierUser = $app.findRecordById('_pb_users_auth_', courierId)
    } catch (_) {}
    const courierName = courierUser ? courierUser.getString('name') : 'Entregador'

    for (const order of activeOrders) {
      const customerId = order.getString('customer_id')
      if (!customerId) continue

      let customer = null
      try {
        customer = $app.findRecordById('customers', customerId)
      } catch (_) {}

      if (!customer) continue
      const custLat = customer.getFloat('lat')
      const custLng = customer.getFloat('lng')

      if (custLat && custLng) {
        const dist = getDistanceMeters(lat, lng, custLat, custLng)
        // If speed > 60km/h in urban or far off
        // Trigger notification if an off-route condition occurs
      }
    }
  } catch (err) {
    console.log('Error in on_location_alert hook:', err)
  }

  e.next()
}, 'locations')
