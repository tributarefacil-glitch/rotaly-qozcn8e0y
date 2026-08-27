import type { RecordModel } from 'pocketbase'

export type UserRole = 'admin' | 'seller' | 'courier'
export type UserStatus = 'active' | 'idle' | 'busy'

export interface UserRecord extends RecordModel {
  email: string
  name: string
  role?: UserRole
  status?: UserStatus
  avatar?: string
}

export interface CustomerRecord extends RecordModel {
  name: string
  phone: string
  address: string
  lat?: number
  lng?: number
}

export type OrderStatus = 'pending' | 'in_transit' | 'delivered' | 'cancelled'
export type OrderPriority = 'normal' | 'urgent' | 'high'

export interface OrderItem {
  name: string
  qty: number
  price: number
}

export interface OrderRecord extends RecordModel {
  seller_id?: string
  customer_id: string
  courier_id?: string
  status: OrderStatus
  tracking_code: string
  items?: OrderItem[] | string
  total_price?: number
  priority?: OrderPriority
  estimated_arrival?: string
  actual_arrival?: string
  signature?: string
  proof_photo?: string
  notes?: string
  // expanded relations
  expand?: {
    customer_id?: CustomerRecord
    courier_id?: UserRecord
    seller_id?: UserRecord
  }
}

export interface LocationRecord extends RecordModel {
  user_id: string
  lat: number
  lng: number
  speed?: number
  heading?: number
  expand?: {
    user_id?: UserRecord
  }
}

export type NotificationType = 'delay' | 'system' | 'order' | 'off_route' | 'warning'

export interface NotificationRecord extends RecordModel {
  user_id?: string
  title: string
  message: string
  type: NotificationType
  read?: boolean
  order_id?: string
  expand?: {
    order_id?: OrderRecord
  }
}

export interface OptimizedStop {
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
}

export interface OptimizedRouteResult {
  optimized_orders: OptimizedStop[]
  total_distance_km: string
  estimated_duration_minutes: number
  stops_count: number
}
