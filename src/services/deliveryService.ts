import pb from '@/lib/pocketbase/client'
import type {
  OrderRecord,
  CustomerRecord,
  LocationRecord,
  NotificationRecord,
  UserRecord,
  OptimizedRouteResult,
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

  // Route optimization via backend hook
  async optimizeRoute(
    orderIds: string[],
    originLat?: number,
    originLng?: number,
  ): Promise<OptimizedRouteResult> {
    try {
      const res = await fetch(`${import.meta.env.VITE_POCKETBASE_URL}/backend/v1/optimize-route`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: pb.authStore.token,
        },
        body: JSON.stringify({
          order_ids: orderIds,
          origin_lat: originLat,
          origin_lng: originLng,
        }),
      })

      if (res.ok) {
        return await res.json()
      }
    } catch (e) {
      console.warn(
        'Backend optimize-route fetch failed, running client-side optimization fallback:',
        e,
      )
    }

    // Client-side fallback if backend hook is unavailable or throws
    return this.clientSideOptimizeRoute(orderIds, originLat, originLng)
  },

  // Client-side intelligent TSP router for fallback & multi-courier clustering
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
    const optimized = []
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

    const durationMins = Math.round((totalDistMeters / 1000) * 3.5 + optimized.length * 5)

    return {
      optimized_orders: optimized,
      total_distance_km: (totalDistMeters / 1000).toFixed(2),
      estimated_duration_minutes: durationMins,
      stops_count: optimized.length,
    }
  },
}
