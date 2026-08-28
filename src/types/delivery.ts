import type { RecordModel } from 'pocketbase'

export type UserRole = 'admin' | 'seller' | 'courier'
export type UserStatus = 'active' | 'inactive' | 'pending' | 'idle' | 'busy'
export type VehicleType = 'moto' | 'carro' | 'van' | 'caminhao'

export interface UserRecord extends RecordModel {
  email: string
  name: string
  role?: UserRole
  status?: UserStatus
  avatar?: string
  phone?: string
  vehicle_type?: VehicleType
  vehicle_model?: string
  vehicle_year?: number
  vehicle_plate?: string
  documents?: string[]
  selfie?: string
}

export interface CustomerRecord extends RecordModel {
  name: string
  phone: string
  phone2?: string
  phone3?: string
  address: string
  street?: string
  neighborhood?: string
  city?: string
  state?: string
  postal_code?: string
  complement?: string
  lat?: number
  lng?: number
}

export type OrderStatus =
  | 'pending'
  | 'in_transit'
  | 'delivered'
  | 'address_error'
  | 'client_absent'
  | 'cancelled'

export type CompletionReason = 'delivered' | 'address_error' | 'client_absent' | 'other'
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
  completion_reason?: CompletionReason
  sequence?: number
  distance_km?: number
  estimated_duration_minutes?: number
  fuel_cost?: number
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

export interface AppSettingsRecord extends RecordModel {
  key: string
  fuel_price_per_liter: number
  fuel_consumption_kml: number
  extra?: Record<string, unknown>
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
  step_duration_seconds?: number
}

export interface OptimizedRouteResult {
  optimized_orders: OptimizedStop[]
  total_distance_km: string
  estimated_duration_minutes: number
  estimated_fuel_cost: number
  stops_count: number
}

export interface CourierOptimizationPlan {
  courier: UserRecord
  color: string
  orders: OrderRecord[]
  stops: OptimizedStop[]
  total_distance_km: string
  estimated_duration_minutes: number
  estimated_fuel_cost: number
}

export interface MultiCourierOptimizationResult {
  courierPlans: CourierOptimizationPlan[]
  unassignedOrders: OrderRecord[]
  totalOrders: number
  totalDistanceKm: string
  totalEstimatedFuelCost: number
  totalDurationMinutes: number
}
