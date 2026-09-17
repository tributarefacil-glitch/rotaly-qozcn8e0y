import React from 'react'
import { Car, Truck } from 'lucide-react'
import { OrderRecord, UserRecord, LocationRecord, AppSettingsRecord } from '@/types/delivery'
import { getVehicleLabel } from '@/components/LiveMap'
import { LatLngPoint } from '@/services/osrmRoutingService'
import { RouteWorkShiftMetrics } from '@/lib/routeWorkShift'

export interface ControlTowerProps {
  orders?: OrderRecord[]
  couriers?: UserRecord[]
  locations?: LocationRecord[]
  settings?: AppSettingsRecord | null
  offRouteEvents?: any[]
  onRefresh?: () => void
  userRole?: 'seller' | 'admin'
}

export type KanbanColumnKey = 'pending' | 'in_transit' | 'delivered' | 'issues'

export interface KanbanColumnConfig {
  key: KanbanColumnKey
  title: string
  subtitle: string
  badgeBg: string
  badgeText: string
  borderColor: string
  headerBg: string
  columnBg: string
  indicatorColor: string
}

export const KANBAN_COLUMNS: KanbanColumnConfig[] = [
  {
    key: 'pending',
    title: 'Aguardando Início',
    subtitle: 'Atribuídas / Fila do entregador',
    badgeBg: 'bg-slate-700/60',
    badgeText: 'text-slate-200',
    borderColor: 'border-slate-700/80',
    headerBg: 'bg-slate-900/90 border-b border-slate-800',
    columnBg: 'bg-[#0c142e]/70',
    indicatorColor: '#94A3B8',
  },
  {
    key: 'in_transit',
    title: 'Em Trânsito',
    subtitle: 'Rota iniciada / A caminho',
    badgeBg: 'bg-blue-500/20',
    badgeText: 'text-[#60A5FA]',
    borderColor: 'border-blue-500/40',
    headerBg: 'bg-[#0f214d]/90 border-b border-blue-900/60',
    columnBg: 'bg-[#0d1b3e]/70',
    indicatorColor: '#3B82F6',
  },
  {
    key: 'delivered',
    title: 'Entregue',
    subtitle: 'Concluídas com sucesso',
    badgeBg: 'bg-emerald-500/20',
    badgeText: 'text-[#34D399]',
    borderColor: 'border-emerald-500/40',
    headerBg: 'bg-[#0e2a27]/90 border-b border-emerald-900/60',
    columnBg: 'bg-[#0b2120]/60',
    indicatorColor: '#10B981',
  },
  {
    key: 'issues',
    title: 'Exceções & Problemas',
    subtitle: 'Ausente / Endereço / Desvio',
    badgeBg: 'bg-rose-500/20',
    badgeText: 'text-[#F87171]',
    borderColor: 'border-rose-500/40',
    headerBg: 'bg-[#2a1322]/90 border-b border-rose-900/60',
    columnBg: 'bg-[#20101b]/60',
    indicatorColor: '#EF4444',
  },
]

export interface ActiveRouteCourierData {
  courier: UserRecord
  lat: number
  lng: number
  hasValidCoords: boolean
  speed: number
  battery_level?: number
  location_timestamp?: string
  gps_status?: string
  gps_reason?: string
  offline_buffered?: boolean
  accuracy?: number
  hasRouteStarted: boolean
  statusColor: 'green' | 'yellow' | 'red'
  statusLabel: string
  activeOrdersCount: number
  inTransitCount: number
  pendingCount: number
  problemCount: number
  finishedCount: number
  hasPendingReturnToBase: boolean
  nextOrder: OrderRecord | null
  lastDelivered: OrderRecord | null
  vehicle: string
  allAssignedOrders: OrderRecord[]
}

export interface ActiveRouteCalculatedItem {
  courierId: string
  orderId: string
  points: LatLngPoint[]
  forwardPoints?: LatLngPoint[]
  returnPoints?: LatLngPoint[]
  courierPos: LatLngPoint
  custPos: LatLngPoint
  basePos?: LatLngPoint
  returnBasePos?: LatLngPoint
  isDeviated: boolean
  deviationMeters: number
  nearestPointOnRoute: LatLngPoint
  isUnexpectedStop: boolean
  etaMinutes: number
  etaNextDeliveryTime?: string
  etaReturnBaseMinutes?: number
  etaReturnBaseTime?: string
  remainingRouteMinutes?: number
  projectedEndTime?: Date
  projectedEndTimeFormatted?: string
  isOvertime?: boolean
  overtimeMinutes?: number
  shiftMetrics?: RouteWorkShiftMetrics
  order: OrderRecord
  courier: UserRecord
}

export interface ControlTowerMetrics {
  total: number
  pending: number
  inTransit: number
  delivered: number
  issues: number
}

export function formatVehicle(type?: string): string {
  return getVehicleLabel(type)
}

export function renderVehicleIcon(type?: string): React.ReactNode {
  const norm = (type || '').toLowerCase().trim()
  if (norm === 'carro' || norm === 'car' || norm === 'van') {
    return React.createElement(Car, { className: 'h-4 w-4 text-blue-400' })
  }
  if (norm === 'caminhao' || norm === 'caminhão' || norm === 'truck') {
    return React.createElement(Truck, { className: 'h-4 w-4 text-purple-400' })
  }
  if (norm === 'bicicleta' || norm === 'bicycle' || norm === 'bike') {
    return React.createElement('span', { className: 'text-sm select-none leading-none' }, '🚲')
  }
  return React.createElement('span', { className: 'text-sm select-none leading-none' }, '🛵')
}

export function getOrderKanbanCategory(order: OrderRecord): KanbanColumnKey {
  if (
    order.status === 'address_error' ||
    order.status === 'client_absent' ||
    order.status === 'cancelled' ||
    order.completion_reason === 'address_error' ||
    order.completion_reason === 'client_absent' ||
    (order.notes && order.notes.toLowerCase().includes('problema'))
  ) {
    return 'issues'
  }

  if (order.status === 'delivered') {
    return 'delivered'
  }

  if (
    order.status === 'in_transit' ||
    order.route_started === true ||
    Boolean(order.route_started_at)
  ) {
    return 'in_transit'
  }

  return 'pending'
}

export function getEtaDisplay(
  order: OrderRecord,
  activeRoutesData?: ActiveRouteCalculatedItem[],
): string {
  const courierId = order.courier_id || order.expand?.courier_id?.id
  const routeInfo =
    courierId && activeRoutesData
      ? activeRoutesData.find((r) => r.courierId === courierId)
      : undefined

  if (routeInfo) {
    if (routeInfo.etaNextDeliveryTime && routeInfo.etaReturnBaseTime) {
      return `Entrega ~${routeInfo.etaNextDeliveryTime} • Volta à base ~${routeInfo.etaReturnBaseTime}`
    }
    if (routeInfo.etaReturnBaseTime && !routeInfo.etaNextDeliveryTime) {
      return `Retornando à base • Chegada ~${routeInfo.etaReturnBaseTime}`
    }
    if (routeInfo.etaNextDeliveryTime) {
      return `Entrega ~${routeInfo.etaNextDeliveryTime}`
    }
  }

  if (order.estimated_arrival) {
    const d = new Date(order.estimated_arrival)
    if (!isNaN(d.getTime())) {
      return `Entrega ~${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
    }
  }
  if (order.estimated_duration_minutes) {
    return `~${order.estimated_duration_minutes} min`
  }
  return '--:--'
}
