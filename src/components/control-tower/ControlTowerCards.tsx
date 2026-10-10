import React from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Columns3, Map as MapIcon, Clock, RefreshCw, Search, Check } from 'lucide-react'
import { UserRecord, OrderRecord } from '@/types/delivery'
import { ControlTowerMetrics } from './utils'
import { formatTimeInTz } from '@/lib/operationalWindow'

export interface DeliveredNotice {
  orderId: string
  trackingCode: string
  customerName: string
  courierName: string
  timestamp: Date
}

interface NewOrderAwaitingOptimizationBannerProps {
  onOpenOptimizer: () => void
  count?: number
}

export const NewOrderAwaitingOptimizationBanner: React.FC<
  NewOrderAwaitingOptimizationBannerProps
> = ({ onOpenOptimizer, count }) => {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-amber-500/20 via-orange-500/15 to-amber-600/20 border-2 border-amber-400 p-3.5 sm:p-4 shadow-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 animate-in slide-in-from-top-2 duration-300">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-full bg-amber-500/30 border border-amber-400 text-amber-300 flex items-center justify-center shrink-0">
          <RefreshCw className="h-4 w-4 text-amber-300 animate-spin" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-amber-400 text-slate-950 font-black text-[11px] uppercase px-2 py-0.5">
              ROTA IMUTÁVEL
            </Badge>
            {count && count > 0 ? (
              <span className="font-mono text-xs font-bold text-amber-200">
                {count} {count === 1 ? 'pedido novo' : 'pedidos novos'}
              </span>
            ) : null}
          </div>
          <p className="text-sm font-bold text-white mt-0.5">
            Pedido novo aguardando — otimize para reposicionar
          </p>
        </div>
      </div>
      <Button
        size="sm"
        onClick={onOpenOptimizer}
        className="h-8 bg-amber-400 hover:bg-amber-500 text-slate-950 font-black text-xs rounded-xl shadow-md gap-1.5 self-end sm:self-center"
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Otimizar Rota
      </Button>
    </div>
  )
}

interface ControlTowerHeroBannerProps {
  metrics: ControlTowerMetrics
  activeTab: 'kanban' | 'map' | 'split'
  setActiveTab: (tab: 'kanban' | 'map' | 'split') => void
  lastUpdated: Date
  isLoading: boolean
  onRefresh: () => void
  isPrimaryLoading?: boolean
}

export const ControlTowerHeroBanner: React.FC<ControlTowerHeroBannerProps> = ({
  metrics,
  activeTab,
  setActiveTab,
  lastUpdated,
  isLoading,
  onRefresh,
  isPrimaryLoading = false,
}) => {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0A1128] via-[#0E1E4A] to-[#122B68] border border-[#1E2B58] p-5 sm:p-6 shadow-xl">
      <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
      <div className="absolute bottom-0 left-1/3 -mb-8 w-48 h-48 rounded-full bg-emerald-500/10 blur-2xl pointer-events-none" />

      <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-[#0052CC]/30 border border-[#60A5FA]/40 text-[#60A5FA] text-xs font-bold tracking-wide">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
            </span>
            <span>SISTEMA DE MONITORAMENTO LOGÍSTICO EM TEMPO REAL</span>
          </div>

          <div className="flex items-center gap-3">
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white font-heading">
              Torre de Controle
            </h1>
            <Badge className="bg-[#0052CC] text-white hover:bg-[#0052CC] font-bold text-xs uppercase px-2.5 py-0.5 shadow-sm">
              Rotaly • Dark Navy
            </Badge>
          </div>

          <p className="text-xs sm:text-sm text-slate-300 max-w-2xl leading-relaxed">
            Painel estilo Kanban logístico (inspirado no modelo VUUPT): clique no card de cada
            cliente para abrir o drawer com o entregador responsável, rota e previsão de chegada em
            tempo real via PocketBase.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* View Switcher: Split / Kanban / Map */}
          <div className="bg-slate-100 p-1 rounded-xl border border-slate-200 flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab('split')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'split'
                  ? 'bg-[#0052CC] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              <span>Kanban + Mapa</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('kanban')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'kanban'
                  ? 'bg-[#0052CC] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <Columns3 className="h-3.5 w-3.5" />
              <span>Apenas Kanban</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('map')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                activeTab === 'map'
                  ? 'bg-[#0052CC] text-white shadow-sm'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800/40'
              }`}
            >
              <MapIcon className="h-3.5 w-3.5" />
              <span>Apenas Mapa</span>
            </button>
          </div>

          <div className="flex items-center text-xs text-slate-600 bg-white border border-slate-200 px-3 py-2 rounded-xl shadow-xs">
            <Clock className="w-3.5 h-3.5 mr-1.5 text-slate-400" />
            <span>10s • {formatTimeInTz(lastUpdated, true)}</span>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isLoading}
            className="h-9 gap-1.5 text-xs bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:text-[#002855] rounded-xl"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Banner "Acompanhe em tempo real" pills com suporte a Skeletons durante Etapa 1 */}
      {isPrimaryLoading ? (
        <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={`metrics-skel-${i}`}
              className="bg-[#070D1E]/60 border border-slate-800 rounded-xl p-2.5 flex items-center justify-between animate-pulse"
            >
              <div className="h-3.5 w-24 bg-slate-700/60 rounded" />
              <div className="h-4 w-6 bg-slate-600/70 rounded" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-5 pt-4 border-t border-[#1E2B58]/80 grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <div className="bg-[#070D1E]/60 border border-slate-700/50 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-slate-400 font-medium">Aguardando Início:</span>
            <span className="font-bold font-mono text-slate-200 text-sm">{metrics.pending}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-blue-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-blue-300 font-medium">Em Trânsito:</span>
            <span className="font-bold font-mono text-blue-400 text-sm">{metrics.inTransit}</span>
          </div>
          <div className="bg-[#070D1E]/60 border border-emerald-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-emerald-300 font-medium">Entregues hoje:</span>
            <span className="font-bold font-mono text-emerald-400 text-sm">
              {metrics.delivered}
            </span>
          </div>
          <div className="bg-[#070D1E]/60 border border-rose-500/30 rounded-xl p-2.5 flex items-center justify-between">
            <span className="text-rose-300 font-medium">Exceções / Falhas:</span>
            <span className="font-bold font-mono text-rose-400 text-sm">{metrics.issues}</span>
          </div>
        </div>
      )}
    </div>
  )
}

interface ControlTowerDeliveredNoticeProps {
  notice: DeliveredNotice
  orders: OrderRecord[]
  onOpenOrderDetails: (order: OrderRecord) => void
  onDismiss: () => void
}

export const ControlTowerDeliveredNotice: React.FC<ControlTowerDeliveredNoticeProps> = ({
  notice,
  orders,
  onOpenOrderDetails,
  onDismiss,
}) => {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-emerald-950 via-teal-900 to-emerald-900 border-2 border-emerald-400 p-4 sm:p-5 shadow-2xl animate-in slide-in-from-top-4 duration-300">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-emerald-500/30 border border-emerald-400 text-emerald-300 flex items-center justify-center shrink-0">
            <Check className="h-6 w-6 text-emerald-300 stroke-[3]" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-500 text-slate-950 font-black text-xs uppercase px-2 py-0.5">
                NOVA ENTREGA CONCLUÍDA AGORA
              </Badge>
              <span className="font-mono text-xs font-bold text-emerald-200">
                {notice.trackingCode}
              </span>
            </div>
            <h3 className="text-base font-bold text-white mt-0.5">
              Destinatário: <span className="text-emerald-200">{notice.customerName}</span>
              <span className="text-slate-300 text-xs font-normal ml-2">
                • Finalizado por: <strong className="text-white">{notice.courierName}</strong>
              </span>
            </h3>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          <Button
            size="sm"
            onClick={() => {
              const targetOrder = orders.find((o) => o.id === notice.orderId)
              if (targetOrder) onOpenOrderDetails(targetOrder)
            }}
            className="h-8 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-black text-xs rounded-lg shadow"
          >
            Ver Detalhes
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={onDismiss}
            className="h-8 text-xs text-slate-300 hover:text-white hover:bg-emerald-800/40"
          >
            Fechar
          </Button>
        </div>
      </div>
    </div>
  )
}

interface ControlTowerFiltersProps {
  statusFilter: string
  setStatusFilter: (val: string) => void
  courierFilter: string
  setCourierFilter: (val: string) => void
  couriers: UserRecord[]
  searchQuery: string
  setSearchQuery: (val: string) => void
}

export const ControlTowerFilters: React.FC<ControlTowerFiltersProps> = ({
  statusFilter,
  setStatusFilter,
  courierFilter,
  setCourierFilter,
  couriers,
  searchQuery,
  setSearchQuery,
}) => {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
          Filtros do Fluxo:
        </span>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-8 text-xs w-[160px] bg-slate-50 border-slate-200 text-slate-800">
            <SelectValue placeholder="Coluna / Status" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-800">
            <SelectItem value="all">Todas as Colunas</SelectItem>
            <SelectItem value="pending">Aguardando Início</SelectItem>
            <SelectItem value="in_transit">Em Trânsito</SelectItem>
            <SelectItem value="delivered">Entregue</SelectItem>
            <SelectItem value="issues">Exceções / Problemas</SelectItem>
          </SelectContent>
        </Select>

        <Select value={courierFilter} onValueChange={setCourierFilter}>
          <SelectTrigger className="h-8 text-xs w-[180px] bg-slate-50 border-slate-200 text-slate-800">
            <SelectValue placeholder="Entregador" />
          </SelectTrigger>
          <SelectContent className="bg-white border-slate-200 text-slate-800">
            <SelectItem value="all">Todos os Entregadores</SelectItem>
            {couriers.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name || c.email}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="relative min-w-[220px]">
        <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-slate-400" />
        <Input
          placeholder="Buscar por cliente, rastreio, rua..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-8 h-8 text-xs bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 rounded-lg focus:border-[#00A3FF] focus:bg-white"
        />
      </div>
    </div>
  )
}
