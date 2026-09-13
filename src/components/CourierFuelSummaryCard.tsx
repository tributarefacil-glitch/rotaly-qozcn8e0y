import React from 'react'
import {
  CreditCard,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  Navigation,
  Fuel,
  Info,
  ChevronRight,
  TrendingUp,
  AlertTriangle,
} from 'lucide-react'
import type { CourierFuelCalculationResult } from '@/hooks/useCourierFuelMetrics'
import type { UserRecord } from '@/types/delivery'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { deliveryService } from '@/services/deliveryService'

interface CourierFuelSummaryCardProps {
  metrics: CourierFuelCalculationResult
  courier?: UserRecord | null
  onOpenHistoryModal: () => void
  title?: string
  subtitle?: string
  showPricingExplanation?: boolean
  className?: string
}

export const CourierFuelSummaryCard: React.FC<CourierFuelSummaryCardProps> = ({
  metrics,
  courier,
  onOpenHistoryModal,
  title = 'Saldo da Conta Corrente',
  subtitle,
  showPricingExplanation = true,
  className = '',
}) => {
  const isPositive = metrics.balance >= 0
  const activeCourier = courier || metrics.courier
  const isBicycle =
    metrics.vehicleCategory === 'bicicleta' ||
    deliveryService.normalizeVehicleCategory(activeCourier?.vehicle_type) === 'bicicleta'
  const vehicleLabel =
    activeCourier?.vehicle_model ||
    (isBicycle
      ? 'Bicicleta'
      : metrics.vehicleCategory === 'carro'
        ? 'Carro'
        : metrics.vehicleCategory === 'caminhao'
          ? 'Caminhão'
          : 'Moto')

  return (
    <Card
      onClick={onOpenHistoryModal}
      className={`border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden cursor-pointer hover:border-[#0052CC]/60 hover:shadow-md transition-all group bg-white dark:bg-[#0E1738] ${className}`}
    >
      <div
        className={`absolute top-0 left-0 right-0 h-1.5 ${
          isPositive ? 'bg-emerald-500' : 'bg-rose-500'
        }`}
      />

      <CardHeader className="p-4 pb-2">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-300 font-bold text-xs shrink-0">
              {activeCourier?.name ? activeCourier.name.slice(0, 2).toUpperCase() : 'EN'}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {activeCourier?.name || 'Entregador'}
              </CardTitle>
              <p className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-1 truncate">
                <span>{activeCourier?.vehicle_plate || 'Sem placa'}</span>
                <span>•</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 truncate">
                  {vehicleLabel}
                </span>
                <Badge
                  variant="outline"
                  className="text-[9px] px-1 py-0 uppercase font-mono font-bold shrink-0 ml-0.5"
                >
                  {isBicycle
                    ? '🚲 Bicicleta'
                    : deliveryService.normalizeVehicleCategory(activeCourier?.vehicle_type)}
                </Badge>
              </p>
            </div>
          </div>

          <Badge
            className={`text-[10px] font-bold shrink-0 ${
              isPositive
                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-300'
                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-300'
            }`}
          >
            {isPositive ? 'Crédito Disponível' : 'Saldo Devedor / A Repor'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-2 space-y-3 text-xs">
        {/* Saldo Principal */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">
              {title}
            </span>
            <span
              className={`text-xl sm:text-2xl font-black font-mono ${
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              R$ {metrics.balance.toFixed(2)}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <Badge
                variant="outline"
                className={`text-[9px] px-1.5 py-0.5 font-bold ${
                  metrics.calculationSource === 'odometro'
                    ? 'border-indigo-400 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300'
                    : 'border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300'
                }`}
              >
                {metrics.calculationSource === 'odometro'
                  ? '🏍️ Odômetro da Moto'
                  : '🗺️ Histórico Viário de Rotas'}
              </Badge>
            </div>
            {subtitle && (
              <span className="text-[10px] text-slate-400 block mt-0.5">{subtitle}</span>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
              {metrics.advanceCount} adiantamento(s)
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
              {metrics.deliveriesCount} entregas
            </span>
          </div>
        </div>

        {/* Detalhamento: Recebido vs Gasto */}
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="p-2.5 rounded-lg bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-200/60 dark:border-emerald-900/40">
            <div className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400 font-medium">
              <ArrowDownLeft className="h-3.5 w-3.5" />
              <span>(+) Total Adiantado</span>
            </div>
            <span className="font-bold text-emerald-800 dark:text-emerald-300 font-mono text-sm block mt-0.5">
              R$ {metrics.totalAdvances.toFixed(2)}
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">Créditos antecipados</span>
          </div>

          <div className="p-2.5 rounded-lg bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40">
            <div className="flex items-center gap-1 text-amber-700 dark:text-amber-400 font-medium">
              <ArrowUpRight className="h-3.5 w-3.5 text-[#FF6B35]" />
              <span>{isBicycle ? 'Km Rodado (Sem Combustível)' : '(-) Gasto Rota Oficial'}</span>
            </div>
            <span className="font-bold text-amber-800 dark:text-amber-300 font-mono text-sm block mt-0.5">
              {isBicycle
                ? `${metrics.totalOfficialKm.toFixed(1)} km`
                : `R$ ${metrics.totalSpent.toFixed(2)}`}
            </span>
            <span className="text-[9px] text-slate-400 block mt-0.5">
              {isBicycle
                ? 'Telemetria GPS apurada'
                : `${metrics.totalOfficialKm.toFixed(1)} km reais oficiais`}
            </span>
          </div>
        </div>

        {/* KM Oficial vs KM Desvios & Odômetro Real */}
        <div className="grid grid-cols-2 gap-2 text-[10px] pt-0.5">
          <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">KM Real Oficial:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
              {metrics.totalOfficialKm.toFixed(1)} km
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">KM Desvios:</span>
            <span
              className={`font-mono font-bold ${
                metrics.totalDeviationKm > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-400'
              }`}
            >
              +{metrics.totalDeviationKm.toFixed(1)} km
            </span>
          </div>
        </div>

        {/* Resumo da Regra de Preço / Consumo */}
        {showPricingExplanation && (
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900/50 border border-slate-200/60 dark:border-slate-800 text-[10px] text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <Fuel className="h-3.5 w-3.5 text-[#FF6B35] shrink-0" />
            <div className="truncate">
              {isBicycle ? (
                <span className="text-emerald-600 dark:text-emerald-400 font-medium">
                  🚲 Bicicleta: sem custo de combustível. Telemetria GPS apura KM real rodado.
                </span>
              ) : (
                <span>
                  R$ {metrics.pricePerLiter.toFixed(2)}/L • {metrics.consumptionKml.toFixed(1)} km/L
                  ={' '}
                  <strong className="text-slate-700 dark:text-slate-300 font-mono">
                    R$ {(metrics.pricePerLiter / (metrics.consumptionKml || 1)).toFixed(4)}/km
                  </strong>
                </span>
              )}
            </div>
          </div>
        )}

        {/* Dica / Link de clique para histórico detalhado */}
        <div className="pt-1 flex items-center justify-between text-[11px] text-[#0052CC] dark:text-[#60A5FA] font-medium group-hover:underline">
          <span className="flex items-center gap-1.5">
            <CreditCard className="h-3.5 w-3.5" />
            Ver histórico detalhado de entregas &amp; telemetria
          </span>
          <ChevronRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
        </div>
      </CardContent>
    </Card>
  )
}
