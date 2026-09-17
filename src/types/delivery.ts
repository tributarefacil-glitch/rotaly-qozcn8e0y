import type { RecordModel } from 'pocketbase'

export type UserRole = 'admin' | 'seller' | 'courier'
export type UserStatus = 'active' | 'inactive' | 'pending' | 'idle' | 'busy'
export type VehicleType =
  | 'moto'
  | 'carro'
  | 'van'
  | 'caminhao'
  | 'motorcycle'
  | 'car'
  | 'truck'
  | 'bicycle'
  | 'bicicleta'

export interface EmpresaRecord extends RecordModel {
  nome_razao_social: string
  nome_fantasia?: string
  cnpj?: string
  logradouro?: string
  numero?: string
  complemento?: string
  bairro?: string
  cidade?: string
  uf?: string
  cep?: string
  endereco_completo?: string
  telefone?: string
  email?: string
  ativa?: boolean
}

export type MembroPapel = 'admin' | 'vendedor' | 'entregador' | 'gestor'

export interface MembroRecord extends RecordModel {
  empresa_id: string
  user_id: string
  papel?: MembroPapel
  ativo?: boolean
  expand?: {
    empresa_id?: EmpresaRecord
    user_id?: UserRecord
  }
}

export interface ColaboradorRecord extends RecordModel {
  empresa_id: string
  user_id?: string
  nome: string
  email?: string
  telefone?: string
  cpf?: string
  cargo?: 'entregador' | 'vendedor' | 'gerente' | 'motorista' | 'administrativo'
  tipo_veiculo?: string
  placa_veiculo?: string
  ativo?: boolean
}

export interface RotaRecord extends RecordModel {
  empresa_id: string
  courier_id?: string
  codigo_rota?: string
  status?: 'planejada' | 'em_andamento' | 'concluida' | 'cancelada'
  data_inicio?: string
  data_fim?: string
  distancia_km?: number
  tempo_estimado_minutos?: number
  custo_combustivel?: number
  dados_planejamento?: any
  odometro_inicial?: number
  odometro_final?: number
  km_odometro?: number
  foto_odometro_inicial?: string
  foto_odometro_final?: string
  data?: string
}

export interface EntregaRecord extends RecordModel {
  empresa_id: string
  codigo_rastreio: string
  order_id?: string
  courier_id?: string
  destinatario_nome?: string
  destinatario_endereco?: string
  status?: 'pendente' | 'em_transito' | 'entregue' | 'erro_endereco' | 'ausente' | 'cancelada'
  valor_total?: number
  data_entrega?: string
  comprovante_foto?: string
}

export interface RelatorioRecord extends RecordModel {
  empresa_id: string
  titulo: string
  tipo?: 'combustivel' | 'entregas' | 'desvios' | 'financeiro' | 'geral'
  periodo_inicio?: string
  periodo_fim?: string
  resumo?: any
  gerado_por?: string
}

export interface UserRecord extends RecordModel {
  email: string
  name: string
  role?: UserRole
  status?: UserStatus
  avatar?: string
  phone?: string
  document?: string
  vehicle_type?: VehicleType
  vehicle_model?: string
  vehicle_year?: number
  vehicle_plate?: string
  documents?: string[]
  selfie?: string
}

export interface CustomerRecord extends RecordModel {
  empresa_id?: string
  name: string
  phone: string
  phone2?: string
  phone3?: string
  document?: string
  notes?: string
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
  | 'assigned'
  | 'in_transit'
  | 'delivered'
  | 'address_error'
  | 'client_absent'
  | 'cancelled'

export type CompletionReason =
  | 'delivered'
  | 'address_error'
  | 'client_absent'
  | 'cancelado_vendedor'
  | 'other'
export type OrderPriority = 'normal' | 'urgent' | 'high'

export interface OrderItem {
  name: string
  qty: number
  price: number
}

export type AssignmentType = 'manual' | 'automatic'
export type RouteSuggestionStatus = 'accepted' | 'rejected' | 'edited' | 'none'

export interface RouteSuggestionDetails {
  courier_id: string
  courier_name: string
  vehicle_type: VehicleType
  order_in_route: number
  estimated_time: string
  km_saved: number
  distance_km: number
  reason?: string
}

export type BaseAddressType = 'base' | 'end_point' | 'store' | 'warehouse'

export interface BaseAddressRecord extends RecordModel {
  name: string
  type: BaseAddressType
  address: string
  street?: string
  neighborhood?: string
  city?: string
  state?: string
  postal_code?: string
  lat?: number
  lng?: number
  is_default?: boolean
  is_end_default?: boolean
  created_by?: string
}

export interface OrderRecord extends RecordModel {
  empresa_id?: string
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
  receiver_name?: string
  notes?: string
  assignment_type?: AssignmentType
  route_suggestion_status?: RouteSuggestionStatus
  route_suggestion_details?: RouteSuggestionDetails | string
  // Route Lifecycle & Bases (Regras 1, 3, 4, 5)
  route_released?: boolean
  route_released_at?: string
  route_started?: boolean
  route_started_at?: string
  route_finished?: boolean
  route_finished_at?: string
  start_base_name?: string
  start_base_address?: string
  start_base_lat?: number
  start_base_lng?: number
  end_address_name?: string
  end_address_text?: string
  end_address_lat?: number
  end_address_lng?: number
  return_trip_km?: number
  total_route_with_return_km?: number
  total_route_fuel_cost?: number
  // Campos de Odômetro Físico (Prioridade 1 de Cálculo)
  odometro_inicial?: number
  odometro_final?: number
  km_odometro?: number
  foto_odometro_inicial?: string
  foto_odometro_final?: string
  // expanded relations
  expand?: {
    customer_id?: CustomerRecord
    courier_id?: UserRecord
    seller_id?: UserRecord
  }
}

export type OfficialVehicleCategory = 'moto' | 'carro' | 'caminhao'

export interface VehicleFuelParam {
  pricePerLiter: number
  consumptionKml: number
}

export interface SiteContentRecord extends RecordModel {
  key: string
  about_title?: string
  about_subtitle?: string
  about_paragraph_1?: string
  about_paragraph_2?: string
  about_paragraph_3?: string
  phone?: string
  whatsapp?: string
  email?: string
  address?: string
  opening_hours?: string
  facebook_url?: string
  instagram_url?: string
  linkedin_url?: string
  extra?: Record<string, unknown>
}

export interface AppSettingsRecord extends RecordModel {
  key: string
  fuel_price_per_liter: number
  fuel_consumption_kml: number
  moto_fuel_price?: number
  moto_consumption_kml?: number
  carro_fuel_price?: number
  carro_consumption_kml?: number
  caminhao_fuel_price?: number
  caminhao_consumption_kml?: number
  work_start_time?: string // Horário de entrada padrão (ex: "08:00")
  lunch_start_time?: string // Saída para almoço (ex: "12:00")
  lunch_end_time?: string // Retorno do almoço (ex: "13:00")
  work_end_time?: string // Fim do expediente (ex: "18:30")
  extra?: Record<string, unknown>
}

export type FuelPaymentMethod = 'pix' | 'dinheiro' | 'transferencia' | 'outro'

export interface FuelAdvanceRecord extends RecordModel {
  courier_id: string
  amount: number
  date: string
  notes?: string
  payment_method?: FuelPaymentMethod
  created_by?: string
  expand?: {
    courier_id?: UserRecord
    created_by?: UserRecord
  }
}

export interface ReviewRecord extends RecordModel {
  order_id: string
  courier_id?: string
  seller_id?: string
  courier_rating: number
  seller_rating: number
  comment?: string
  customer_name?: string
  expand?: {
    order_id?: OrderRecord
    courier_id?: UserRecord
    seller_id?: UserRecord
  }
}

export type OffRouteEventType = 'route_deviation' | 'unexpected_stop'

export interface OffRouteEventRecord extends RecordModel {
  courier_id: string
  order_id?: string
  event_type: OffRouteEventType
  distance_deviation_meters?: number
  stop_duration_seconds?: number
  lat: number
  lng: number
  address?: string
  notes?: string
  expand?: {
    courier_id?: UserRecord
    order_id?: OrderRecord
  }
}

export interface CourierFuelAccount {
  courier: UserRecord
  totalAdvances: number
  totalRouteKm: number
  totalSpent: number
  balance: number // totalAdvances - totalSpent
  advanceCount: number
  deliveriesCount: number
  advances?: FuelAdvanceRecord[]
  calculationSource?: 'odometro' | 'gps' | 'road' | 'historico_viario'
}

export type GpsFailureReason =
  | 'permission_denied'
  | 'weak_signal'
  | 'position_unavailable'
  | 'unsupported'
  | 'network_offline'

export interface LocationRecord extends RecordModel {
  user_id: string
  lat: number
  lng: number
  speed?: number
  heading?: number
  battery_level?: number
  gps_status?: 'active' | 'disabled' | 'offline' | string
  gps_reason?: GpsFailureReason | string
  offline_buffered?: boolean
  accuracy?: number
  created?: string
  updated?: string
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
  outbound_distance_km?: number
  return_distance_km?: number
  start_base?: { name: string; address: string; lat: number; lng: number }
  end_base?: { name: string; address: string; lat: number; lng: number }
}

export interface CourierOptimizationPlan {
  courier: UserRecord
  color: string
  orders: OrderRecord[]
  stops: OptimizedStop[]
  total_distance_km: string
  outbound_distance_km?: number
  return_distance_km?: number
  estimated_duration_minutes: number
  estimated_fuel_cost: number
  start_base?: { name: string; address: string; lat: number; lng: number }
  end_base?: { name: string; address: string; lat: number; lng: number }
}

export interface MultiCourierOptimizationResult {
  courierPlans: CourierOptimizationPlan[]
  unassignedOrders: OrderRecord[]
  totalOrders: number
  totalDistanceKm: string
  outboundDistanceKm?: string
  returnDistanceKm?: string
  totalEstimatedFuelCost: number
  totalDurationMinutes: number
  startBase?: BaseAddressRecord | { name: string; address: string; lat: number; lng: number }
  endBase?: BaseAddressRecord | { name: string; address: string; lat: number; lng: number }
}
