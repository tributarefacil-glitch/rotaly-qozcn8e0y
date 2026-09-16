import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Columns3, Clock, MapPin, ChevronRight, AlertTriangle } from 'lucide-react'
import { OrderRecord } from '@/types/delivery'
import {
  KANBAN_COLUMNS,
  KanbanColumnKey,
  renderVehicleIcon,
  getEtaDisplay,
  ActiveRouteCalculatedItem,
} from './utils'
import { DeliveredNotice } from './ControlTowerCards'

interface ControlTowerColumnsProps {
  kanbanColumnsData: Record<KanbanColumnKey, OrderRecord[]>
  filteredOrdersCount: number
  activeRoutesData: ActiveRouteCalculatedItem[]
  latestDeliveredNotice: DeliveredNotice | null
  onOpenOrderDetails: (order: OrderRecord) => void
  isPrimaryLoading?: boolean
}

export const ControlTowerColumns: React.FC<ControlTowerColumnsProps> = ({
  kanbanColumnsData,
  filteredOrdersCount,
  activeRoutesData,
  latestDeliveredNotice,
  onOpenOrderDetails,
  isPrimaryLoading = false,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Columns3 className="h-4 w-4 text-[#60A5FA]" />
          <h2 className="text-sm font-bold uppercase tracking-wider text-slate-200">
            Fluxo de Entregas por Status (Kanban VUUPT)
          </h2>
        </div>
        <span className="text-xs text-slate-400">
          Arraste lateralmente • {filteredOrdersCount} cards carregados
        </span>
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4 pt-1 snap-x scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {KANBAN_COLUMNS.map((col) => {
          const columnOrders = kanbanColumnsData[col.key] || []

          return (
            <div
              key={col.key}
              className={`w-[320px] sm:w-[340px] shrink-0 rounded-2xl border ${col.borderColor} ${col.columnBg} shadow-lg flex flex-col max-h-[720px] overflow-hidden`}
            >
              {/* Cabeçalho colorido da coluna */}
              <div className={`p-3.5 ${col.headerBg} flex items-center justify-between`}>
                <div className="flex items-center gap-2">
                  <span
                    className="h-3 w-3 rounded-full shrink-0 shadow-sm"
                    style={{ backgroundColor: col.indicatorColor }}
                  />
                  <div>
                    <h3 className="font-heading text-sm font-bold text-white tracking-wide">
                      {col.title}
                    </h3>
                    <p className="text-[10px] text-slate-400">{col.subtitle}</p>
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={`text-xs font-mono font-bold ${col.badgeBg} ${col.badgeText} border-transparent`}
                >
                  {columnOrders.length}
                </Badge>
              </div>

              {/* Lista de Cards da Coluna com Skeleton pulsante durante a Etapa 1 */}
              <div className="p-3 space-y-3 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-slate-800">
                {isPrimaryLoading ? (
                  <div className="space-y-3 animate-pulse">
                    {[1, 2, 3].map((skelId) => (
                      <div
                        key={`col-skel-${col.key}-${skelId}`}
                        className="rounded-xl p-3.5 border border-slate-700/40 bg-[#0e1738]/50 space-y-2.5"
                      >
                        <div className="flex items-center justify-between">
                          <div className="h-3.5 w-20 bg-slate-700/60 rounded" />
                          <div className="h-3 w-12 bg-slate-800 rounded" />
                        </div>
                        <div className="h-4 w-36 bg-slate-600/60 rounded" />
                        <div className="h-3 w-48 bg-slate-800/80 rounded" />
                        <div className="pt-2 border-t border-slate-800/60 flex items-center justify-between">
                          <div className="h-3 w-24 bg-slate-700/40 rounded" />
                          <div className="h-3 w-8 bg-slate-700/40 rounded" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : columnOrders.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-xl bg-[#070D1E]/40">
                    Nenhuma entrega nesta etapa
                  </div>
                ) : (
                  columnOrders.map((order) => {
                    const cust = order.expand?.customer_id
                    const courier = order.expand?.courier_id
                    const etaTime = getEtaDisplay(order, activeRoutesData)

                    // Styling per card based on column
                    const isRecentlyDelivered = latestDeliveredNotice?.orderId === order.id
                    const borderAccent = isRecentlyDelivered
                      ? 'border-l-4 border-l-emerald-400 ring-2 ring-emerald-400 animate-pulse'
                      : col.key === 'delivered'
                        ? 'border-l-4 border-l-emerald-500'
                        : col.key === 'issues'
                          ? 'border-l-4 border-l-rose-500'
                          : col.key === 'in_transit'
                            ? 'border-l-4 border-l-blue-500'
                            : 'border-l-4 border-l-slate-400'

                    const bgTint = isRecentlyDelivered
                      ? 'bg-emerald-950/80 hover:bg-emerald-900/90'
                      : col.key === 'delivered'
                        ? 'bg-[#0f2425]/90 hover:bg-[#133031]'
                        : col.key === 'issues'
                          ? 'bg-[#29131e]/90 hover:bg-[#341827]'
                          : col.key === 'in_transit'
                            ? 'bg-[#0f1f45]/90 hover:bg-[#132857]'
                            : 'bg-[#0e1738]/90 hover:bg-[#121e46]'

                    return (
                      <div
                        key={order.id}
                        onClick={() => onOpenOrderDetails(order)}
                        className={`rounded-xl p-3.5 border border-slate-700/60 ${borderAccent} ${bgTint} cursor-pointer transition-all duration-200 shadow-md hover:shadow-xl hover:-translate-y-0.5 group`}
                      >
                        {/* Linha superior: Rastreio & ETA / Horário de Entrega */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono text-xs font-black text-[#60A5FA] group-hover:text-white transition">
                            {order.tracking_code}
                          </span>
                          <div className="flex items-center gap-1 text-[11px] text-slate-300 font-mono bg-slate-900/60 px-2 py-0.5 rounded-md border border-slate-700/50">
                            <Clock className="h-3 w-3 text-slate-400" />
                            <span>
                              {order.status === 'delivered' && order.actual_arrival
                                ? `Entregue às ${new Date(order.actual_arrival).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                                : etaTime}
                            </span>
                          </div>
                        </div>

                        {/* Nome do Cliente */}
                        <div className="mt-2">
                          <h4 className="text-sm font-bold text-white truncate">
                            {cust?.name || 'Cliente sem nome'}
                          </h4>
                          <p className="text-[11px] text-slate-400 truncate flex items-center gap-1 mt-0.5">
                            <MapPin className="h-3 w-3 text-slate-500 shrink-0" />
                            <span>{cust?.address || 'Endereço não cadastrado'}</span>
                          </p>
                        </div>

                        {/* Informações do Entregador Responsável */}
                        <div className="mt-3 pt-2.5 border-t border-slate-700/50 flex items-center justify-between">
                          {courier ? (
                            <div className="flex items-center gap-1.5 text-xs text-slate-200">
                              {renderVehicleIcon(courier.vehicle_type)}
                              <span className="font-semibold truncate max-w-[150px]">
                                {courier.name || courier.email}
                              </span>
                            </div>
                          ) : (
                            <span className="text-[11px] text-slate-500 italic">
                              Sem entregador
                            </span>
                          )}

                          <div className="flex items-center gap-1">
                            {order.sequence && (
                              <Badge
                                variant="outline"
                                className="text-[9px] px-1.5 py-0 bg-blue-500/20 text-[#60A5FA] border-blue-500/30 font-bold"
                              >
                                #{order.sequence}
                              </Badge>
                            )}
                            <ChevronRight className="h-4 w-4 text-slate-500 group-hover:text-white group-hover:translate-x-0.5 transition" />
                          </div>
                        </div>

                        {/* Badges de ocorrência se houver */}
                        {col.key === 'issues' && (
                          <div className="mt-2 text-[10px] text-rose-300 bg-rose-950/60 border border-rose-800/60 px-2 py-1 rounded font-medium truncate flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3 text-rose-400 shrink-0" />
                            <span>
                              {order.completion_reason === 'address_error' ||
                              order.status === 'address_error'
                                ? 'Erro de Endereço'
                                : order.completion_reason === 'client_absent' ||
                                    order.status === 'client_absent'
                                  ? 'Cliente Ausente'
                                  : order.notes || 'Atenção necessária'}
                            </span>
                          </div>
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
