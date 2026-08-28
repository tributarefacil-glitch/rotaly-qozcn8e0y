import pb from '@/lib/pocketbase/client'
import type {
  OrderRecord,
  CustomerRecord,
  LocationRecord,
  NotificationRecord,
  UserRecord,
  OptimizedRouteResult,
  AppSettingsRecord,
} from '@/types/delivery'

export const deliveryService = {
  // Orders
  async getOrders(filter = '', sort = '-created', expand = 'customer_id,courier_id,seller_id') {
    return pb.collection<OrderRecord>('orders').getFullList({
      filter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async getOrderById(id: string) {
    return pb.collection<OrderRecord>('orders').getOne(id, {
      expand: 'customer_id,courier_id,seller_id',
      requestKey: null,
    })
  },

  async getOrderByTrackingCode(trackingCode: string) {
    const list = await pb.collection<OrderRecord>('orders').getList(1, 1, {
      filter: `tracking_code = '${trackingCode.trim().toUpperCase()}'`,
      expand: 'customer_id,courier_id,seller_id',
      requestKey: null,
    })
    return list.items[0] || null
  },

  async createOrder(data: Partial<OrderRecord>) {
    return pb.collection<OrderRecord>('orders').create(data)
  },

  async updateOrder(id: string, data: Partial<OrderRecord> | FormData) {
    return pb.collection<OrderRecord>('orders').update(id, data)
  },

  async deleteOrder(id: string) {
    return pb.collection<OrderRecord>('orders').delete(id)
  },

  // Customers
  async getCustomers() {
    return pb.collection<CustomerRecord>('customers').getFullList({
      sort: 'name',
      requestKey: null,
    })
  },

  /**
   * Searches for customer by any of their up to 3 phone numbers (digits normalized).
   * Excludes a specific customerId if passed (useful during customer edits).
   */
  async findCustomerByPhone(
    rawPhone: string,
    excludeCustomerId?: string,
  ): Promise<CustomerRecord | null> {
    const digits = rawPhone.replace(/\D/g, '')
    if (!digits || digits.length < 8) return null

    try {
      // Direct query with exact or clean match across phone, phone2 and phone3
      const filter = `phone ~ '${digits}' || phone2 ~ '${digits}' || phone3 ~ '${digits}' || phone = '${rawPhone}'`
      const records = await pb.collection<CustomerRecord>('customers').getList(1, 20, {
        filter,
        sort: '-created',
        requestKey: null,
      })

      if (records.items.length > 0) {
        // Find the record where stripped phone matches stripped digits exactly or as national suffix
        const candidates = excludeCustomerId
          ? records.items.filter((c) => c.id !== excludeCustomerId)
          : records.items

        const match = candidates.find((c) => {
          const d1 = (c.phone || '').replace(/\D/g, '')
          const d2 = (c.phone2 || '').replace(/\D/g, '')
          const d3 = (c.phone3 || '').replace(/\D/g, '')
          return (
            (d1 &&
              (d1 === digits ||
                (d1.length >= 8 &&
                  digits.length >= 8 &&
                  (d1.endsWith(digits) || digits.endsWith(d1))))) ||
            (d2 &&
              (d2 === digits ||
                (d2.length >= 8 &&
                  digits.length >= 8 &&
                  (d2.endsWith(digits) || digits.endsWith(d2))))) ||
            (d3 &&
              (d3 === digits ||
                (d3.length >= 8 &&
                  digits.length >= 8 &&
                  (d3.endsWith(digits) || digits.endsWith(d3)))))
          )
        })
        return match || null
      }
      return null
    } catch (e) {
      console.warn('findCustomerByPhone search error:', e)
      return null
    }
  },

  /**
   * Checks if any of the given phone numbers already belongs to another customer.
   * Returns conflicting CustomerRecord if duplicate found, or null if all phones are unique.
   */
  async checkPhoneConflict(
    phones: (string | undefined | null)[],
    excludeCustomerId?: string,
  ): Promise<{ conflict: boolean; customer?: CustomerRecord; duplicatePhone?: string }> {
    for (const p of phones) {
      if (!p) continue
      const digits = p.replace(/\D/g, '')
      if (digits.length >= 8) {
        const found = await this.findCustomerByPhone(p, excludeCustomerId)
        if (found) {
          return { conflict: true, customer: found, duplicatePhone: p }
        }
      }
    }
    return { conflict: false }
  },

  async createCustomer(data: Partial<CustomerRecord>) {
    return pb.collection<CustomerRecord>('customers').create(data)
  },

  async updateCustomer(id: string, data: Partial<CustomerRecord>) {
    return pb.collection<CustomerRecord>('customers').update(id, data)
  },

  // Users / Couriers / Sellers
  async getCouriers() {
    return pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'courier'",
      sort: '-created',
      requestKey: null,
    })
  },

  async getSellers() {
    return pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'seller'",
      sort: '-created',
      requestKey: null,
    })
  },

  async getAllUsers() {
    return pb.collection<UserRecord>('users').getFullList({
      sort: '-created',
      requestKey: null,
    })
  },

  async updateUser(id: string, data: Partial<UserRecord> | FormData) {
    return pb.collection<UserRecord>('users').update(id, data)
  },

  async deleteUser(id: string) {
    return pb.collection<UserRecord>('users').delete(id)
  },

  async createUser(
    data:
      | {
          email: string
          password: string
          passwordConfirm: string
          name?: string
          role?: 'admin' | 'seller' | 'courier'
          status?: 'active' | 'inactive' | 'pending' | 'idle' | 'busy'
          phone?: string
          vehicle_type?: string
          vehicle_model?: string
          vehicle_year?: number
          vehicle_plate?: string
          [key: string]: unknown
        }
      | FormData,
  ) {
    if (data instanceof FormData) {
      return pb.collection<UserRecord>('users').create(data)
    }

    const { verified: _omittedVerified, ...rest } = data
    const payload: Record<string, unknown> = {
      ...rest,
      email: data.email.trim().toLowerCase(),
    }

    // Auto-generate username from email if not provided
    if (!payload.username) {
      const emailPrefix = data.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '')
      const randomSuffix = Math.floor(1000 + Math.random() * 9000)
      payload.username = `${emailPrefix || 'user'}_${randomSuffix}`
    }

    return pb.collection<UserRecord>('users').create(payload)
  },

  // Password Reset Native PocketBase
  async requestPasswordReset(email: string) {
    return pb.collection('users').requestPasswordReset(email.trim().toLowerCase())
  },

  async confirmPasswordReset(token: string, password: string, passwordConfirm: string) {
    return pb.collection('users').confirmPasswordReset(token.trim(), password, passwordConfirm)
  },

  // Helper to build file URL from PocketBase record
  getFileUrl(record: UserRecord, filename: string) {
    if (!filename) return ''
    return pb.files.getURL(record, filename)
  },

  // Locations
  async getLatestLocations() {
    return pb.collection<LocationRecord>('locations').getFullList({
      sort: '-created',
      expand: 'user_id',
      requestKey: null,
    })
  },

  async updateCourierLocation(userId: string, lat: number, lng: number, speed = 0, heading = 0) {
    return pb.collection<LocationRecord>('locations').create({
      user_id: userId,
      lat,
      lng,
      speed,
      heading,
    })
  },

  async getLatestLocationForCourier(courierId: string) {
    try {
      const records = await pb.collection<LocationRecord>('locations').getList(1, 1, {
        filter: `user_id = '${courierId}'`,
        sort: '-created',
        requestKey: null,
      })
      return records.items[0] || null
    } catch {
      return null
    }
  },

  // Notifications
  async getNotifications(userId?: string) {
    const filter = userId ? `user_id = '${userId}' || user_id = ''` : ''
    return pb.collection<NotificationRecord>('notifications').getFullList({
      filter,
      sort: '-created',
      requestKey: null,
    })
  },

  async markNotificationAsRead(id: string) {
    return pb.collection<NotificationRecord>('notifications').update(id, { read: true })
  },

  async markAllNotificationsAsRead(notifications: NotificationRecord[]) {
    await Promise.all(
      notifications
        .filter((n) => !n.read)
        .map((n) => pb.collection('notifications').update(n.id, { read: true })),
    )
  },

  async createNotification(data: Partial<NotificationRecord>) {
    return pb.collection<NotificationRecord>('notifications').create(data)
  },

  // App Settings (Fuel Price & Consumption)
  async getSettings(): Promise<AppSettingsRecord> {
    try {
      const records = await pb.collection<AppSettingsRecord>('app_settings').getList(1, 1, {
        filter: "key = 'global_settings'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return records.items[0]
      }
    } catch (e) {
      console.warn('Error fetching app_settings:', e)
    }

    // Default fallback
    return {
      id: 'default',
      key: 'global_settings',
      fuel_price_per_liter: 5.59,
      fuel_consumption_kml: 35.0,
      created: '',
      updated: '',
      collectionId: '',
      collectionName: 'app_settings',
    } as AppSettingsRecord
  },

  async updateSettings(data: { fuel_price_per_liter: number; fuel_consumption_kml: number }) {
    try {
      const records = await pb.collection<AppSettingsRecord>('app_settings').getList(1, 1, {
        filter: "key = 'global_settings'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return await pb
          .collection<AppSettingsRecord>('app_settings')
          .update(records.items[0].id, data)
      } else {
        return await pb.collection<AppSettingsRecord>('app_settings').create({
          key: 'global_settings',
          ...data,
        })
      }
    } catch (e) {
      console.error('Error updating app_settings:', e)
      throw e
    }
  },

  // Calculate Fuel Cost
  // Formula: Distância (km) * Preço do Litro (R$/L) / Consumo (km/L)
  calculateFuelCost(distanceKm: number, fuelPrice = 5.59, consumptionKml = 35.0): number {
    if (consumptionKml <= 0) return 0
    return (distanceKm * fuelPrice) / consumptionKml
  },

  // Route optimization with Google Maps Traffic or fallback
  async optimizeRoute(
    orderIds: string[],
    originLat = -23.55052,
    originLng = -46.633308,
  ): Promise<OptimizedRouteResult> {
    return this.clientSideOptimizeRoute(orderIds, originLat, originLng)
  },

  // Client-side intelligent TSP router using Google Maps Directions with trafficModel (departureTime=now)
  async clientSideOptimizeRoute(
    orderIds: string[],
    originLat = -23.55052,
    originLng = -46.633308,
  ): Promise<OptimizedRouteResult> {
    const allOrders = await pb.collection<OrderRecord>('orders').getFullList({
      filter: orderIds.map((id) => `id = '${id}'`).join(' || '),
      expand: 'customer_id',
      requestKey: null,
    })

    const settings = await this.getSettings()
    const fuelPrice = settings.fuel_price_per_liter || 5.59
    const fuelConsumption = settings.fuel_consumption_kml || 35.0

    const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
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

    const items = allOrders.map((o) => {
      const cust = o.expand?.customer_id
      return {
        id: o.id,
        tracking_code: o.tracking_code,
        priority: o.priority || 'normal',
        status: o.status,
        customer_name: cust?.name || 'Cliente',
        address: cust?.address || 'Endereço',
        lat: cust?.lat || originLat,
        lng: cust?.lng || originLng,
      }
    })

    const unvisited = [...items]
    const optimized: Array<{
      id: string
      tracking_code: string
      priority: string
      status: string
      customer_name: string
      address: string
      lat: number
      lng: number
      step_distance_meters: number
      cumulative_distance_meters: number
      step_duration_seconds?: number
    }> = []

    let curLat = originLat
    let curLng = originLng
    let totalDistMeters = 0

    while (unvisited.length > 0) {
      let bestIdx = -1
      let bestScore = Infinity

      for (let i = 0; i < unvisited.length; i++) {
        const item = unvisited[i]
        const d = calcDist(curLat, curLng, item.lat, item.lng)
        let weightMultiplier = 1.0
        if (item.priority === 'urgent') weightMultiplier = 0.4
        else if (item.priority === 'high') weightMultiplier = 0.7

        const score = d * weightMultiplier
        if (score < bestScore) {
          bestScore = score
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        const next = unvisited.splice(bestIdx, 1)[0]
        const actualD = calcDist(curLat, curLng, next.lat, next.lng)
        totalDistMeters += actualD
        curLat = next.lat
        curLng = next.lng
        optimized.push({
          ...next,
          step_distance_meters: Math.round(actualD),
          cumulative_distance_meters: Math.round(totalDistMeters),
        })
      } else {
        break
      }
    }

    // Try Google Maps Directions for accurate driving time with live traffic if window.google is loaded
    let durationMins = Math.round((totalDistMeters / 1000) * 3.5 + optimized.length * 5)
    let finalDistMeters = totalDistMeters

    if (typeof window !== 'undefined') {
      const win = window as any
      if (
        win.google &&
        win.google.maps &&
        win.google.maps.DirectionsService &&
        optimized.length > 0
      ) {
        try {
          const directionsService = new win.google.maps.DirectionsService()
          const origin = new win.google.maps.LatLng(originLat, originLng)
          const destination = new win.google.maps.LatLng(
            optimized[optimized.length - 1].lat,
            optimized[optimized.length - 1].lng,
          )

          const waypoints = optimized.slice(0, -1).map((opt) => ({
            location: new win.google.maps.LatLng(opt.lat, opt.lng),
            stopover: true,
          }))

          // Request directions with live traffic (departureTime: now, trafficModel: BEST_GUESS)
          const result = await new Promise<any>((resolve) => {
            directionsService.route(
              {
                origin,
                destination,
                waypoints: waypoints.slice(0, 23), // Google maps limits waypoints to 25
                optimizeWaypoints: false, // Already ordered by our TSP
                travelMode: win.google.maps.TravelMode.DRIVING,
                drivingOptions: {
                  departureTime: new Date(),
                  trafficModel: win.google.maps.TrafficModel.BEST_GUESS,
                },
              },
              (res: any, status: any) => {
                if (status === win.google.maps.DirectionsStatus.OK) {
                  resolve(res)
                } else {
                  resolve(null)
                }
              },
            )
          })

          if (result && result.routes && result.routes[0]) {
            const legs = result.routes[0].legs || []
            let legDistSum = 0
            let legDurationSum = 0

            legs.forEach((leg: any, idx: number) => {
              legDistSum += leg.distance?.value || 0
              const legDur = leg.duration_in_traffic?.value || leg.duration?.value || 0
              legDurationSum += legDur
              if (optimized[idx]) {
                optimized[idx].step_duration_seconds = legDur
                optimized[idx].step_distance_meters =
                  leg.distance?.value || optimized[idx].step_distance_meters
              }
            })

            if (legDistSum > 0) finalDistMeters = legDistSum
            if (legDurationSum > 0) {
              // Duration from traffic + 5 min per stop for delivery interaction
              durationMins = Math.round(legDurationSum / 60 + optimized.length * 5)
            }
          }
        } catch (trafficErr) {
          console.warn('Traffic duration fetch fallback applied:', trafficErr)
        }
      }
    }

    const distKm = finalDistMeters / 1000
    const fuelCost = (distKm * fuelPrice) / fuelConsumption

    return {
      optimized_orders: optimized,
      total_distance_km: distKm.toFixed(2),
      estimated_duration_minutes: durationMins,
      estimated_fuel_cost: Number(fuelCost.toFixed(2)),
      stops_count: optimized.length,
    }
  },
}
