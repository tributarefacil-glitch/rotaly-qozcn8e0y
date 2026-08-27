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

    if (!res.ok) {
      const err = await res.json().catch(() => ({}))
      throw new Error(err.error || 'Falha ao calcular rota otimizada')
    }

    return res.json()
  },
}
