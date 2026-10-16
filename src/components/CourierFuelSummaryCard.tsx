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
  Package,
  Mail,
} from 'lucide-react'
import type { CourierFuelCalculationResult } from '@/hooks/useCourierFuelMetrics'
import type { UserRecord, CourierFuelAccount } from '@/types/delivery'
import type { UnifiedCourierFuelAccount } from '@/services/fuelAccountService'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { deliveryService } from '@/services/deliveryService'

interface CourierFuelSummaryCardProps {
  metrics: CourierFuelCalculationResult
  courier?: UserRecord | null
  account?: UnifiedCourierFuelAccount | CourierFuelAccount | null
  onOpenHistoryModal: () => void
  title?: string
  subtitle?: string
  periodLabel?: string
  showPricingExplanation?: boolean
  className?: string
}

export const CourierFuelSummaryCard: React.FC<CourierFuelSummaryCardProps> = ({
  metrics,
  courier,
  account,
  onOpenHistoryModal,
  title = 'Saldo da Conta Corrente',
  subtitle,
  periodLabel,
  showPricingExplanation = true,
  className = '',
}) => {
  const activeCourier = courier || metrics?.courier
  const courierName = String(activeCourier?.name || 'Entregador')

  const openingBalanceNum =
    typeof activeCourier?.opening_balance === 'number'
      ? activeCourier.opening_balance
      : typeof metrics?.openingBalance === 'number'
        ? metrics.openingBalance
        : typeof metrics?.carryOverBalance === 'number'
          ? metrics.carryOverBalance
          : 0

  const periodAdvancesNum =
    typeof metrics?.periodAdvances === 'number'
      ? metrics.periodAdvances
      : typeof metrics?.totalAdvances === 'number'
        ? metrics.totalAdvances
        : 0

  const periodAdjustmentsNum =
    typeof metrics?.periodAdjustments === 'number' ? metrics.periodAdjustments : 0
  const totalSpentNum = Number(metrics?.totalSpent) || 0
  const totalOfficialKmNum = Number(metrics?.totalOfficialKm) || 0
  const totalDeviationKmNum = Number(metrics?.totalDeviationKm) || 0
  const jointSavedKmNum = Number(metrics?.jointSavedKm) || 0
  const jointSavedFuelCostNum = Number(metrics?.jointSavedFuelCost) || 0

  // Saldo canônico oficial do motor de conta corrente: SEMPRE período-independente
  // Usa o metrics.balance oficial calculado pelo motor
  const balanceNum =
    typeof metrics?.balance === 'number'
      ? metrics.balance
      : Number(
          (openingBalanceNum + periodAdvancesNum + periodAdjustmentsNum - totalSpentNum).toFixed(2),
        )

  const pricePerLiterNum = Number(metrics?.pricePerLiter) || 0
  const consumptionKmlNum = Number(metrics?.consumptionKml) || 1

  // Formatador da Data de Corte (mostrar a data real do corte ou null se não houver)
  const cutoffDateRaw = activeCourier?.cutoff_date || metrics?.cutoffDate
  const formattedCutoffDate = React.useMemo(() => {
    if (!cutoffDateRaw) return null
    try {
      const d = new Date(cutoffDateRaw)
      if (isNaN(d.getTime())) return null
      const day = String(d.getDate()).padStart(2, '0')
      const month = String(d.getMonth() + 1).padStart(2, '0')
      const hours = String(d.getHours()).padStart(2, '0')
      const mins = String(d.getMinutes()).padStart(2, '0')
      return `${day}/${month} às ${hours}:${mins}`
    } catch {
      return null
    }
  }, [cutoffDateRaw])

  const isPositive = balanceNum >= 0
  const isBicycle =
    metrics?.vehicleCategory === 'bicicleta' ||
    deliveryService.normalizeVehicleCategory(activeCourier?.vehicle_type) === 'bicicleta'
  const vehicleLabel =
    activeCourier?.vehicle_model ||
    (isBicycle
      ? 'Bicicleta'
      : metrics?.vehicleCategory === 'carro'
        ? 'Carro'
        : metrics?.vehicleCategory === 'caminhao'
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
              {courierName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <CardTitle className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {courierName}
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
        {/* Paridade de Alerta por E-mail do Dia Civil */}
        {account?.todayAlertSent && (
          <div className="p-2 rounded-lg bg-indigo-50/80 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-900/60 flex items-center justify-between gap-2 text-[11px]">
            <div className="flex items-center gap-1.5 min-w-0">
              <Mail className="h-3.5 w-3.5 text-indigo-600 dark:text-indigo-400 shrink-0" />
              <span className="font-semibold text-indigo-900 dark:text-indigo-200 truncate">
                📧 E-mail enviado hoje
                {account.todayAlertSent.created ? (
                  <>
                    {' às '}
                    {new Intl.DateTimeFormat('pt-BR', {
                      timeZone: 'America/Sao_Paulo',
                      hour: '2-digit',
                      minute: '2-digit',
                    }).format(new Date(account.todayAlertSent.created))}
                  </>
                ) : null}
                {account.todayAlertSent.recipient_email ? (
                  <span className="text-slate-500 font-normal ml-1">
                    → {account.todayAlertSent.recipient_email}
                  </span>
                ) : null}
              </span>
            </div>
            <Badge
              variant="outline"
              className="text-[9px] px-1.5 py-0 font-bold border-indigo-300 bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shrink-0"
            >
              Recarga: R$ {account.todayAlertSent.suggested_recharge.toFixed(2)}
            </Badge>
          </div>
        )}

        {/* Rótulo de Período Explícito */}
        <div className="flex items-center justify-between">
          {(Number(metrics?.deliveriesCount) || 0) === 0 &&
          (Number(metrics?.advanceCount) || 0) === 0 ? (
            <Badge
              variant="outline"
              className="text-[10px] font-medium bg-slate-800 text-slate-300 border-slate-700"
            >
              {formattedCutoffDate
                ? 'Nenhuma movimentação desde o corte — saldo = abertura'
                : 'Nenhuma movimentação no período'}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[10px] font-bold border-emerald-300 bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              {periodLabel
                ? `Período: ${periodLabel}`
                : formattedCutoffDate
                  ? 'Período: Pós-corte'
                  : 'Período: Geral'}
            </Badge>
          )}
          {formattedCutoffDate && (
            <span
              className="text-[10px] font-mono text-slate-500 dark:text-slate-400"
              title="Corte de saldo"
            >
              Corte: {formattedCutoffDate}
            </span>
          )}
        </div>

        {/* Saldo Principal */}
        <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80 flex items-center justify-between">
          <div>
            <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 block">
              {title} {periodLabel ? `(${periodLabel})` : ''}
            </span>
            <span
              className={`text-xl sm:text-2xl font-black font-mono ${
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              R$ {balanceNum.toFixed(2)}
            </span>
            <div className="flex items-center gap-1.5 mt-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  if (onOpenHistoryModal) onOpenHistoryModal()
                }}
                className="inline-flex items-center"
              >
                <Badge
                  variant="outline"
                  className={`text-[9px] px-1.5 py-0.5 font-bold hover:opacity-80 transition-opacity cursor-pointer ${
                    metrics?.calculationSource === 'odometro'
                      ? 'border-indigo-400 text-indigo-600 bg-indigo-50 dark:bg-indigo-950/40 dark:text-indigo-300'
                      : 'border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-950/40 dark:text-blue-300'
                  }`}
                >
                  📖 Histórico Viário de Rotas
                </Badge>
              </button>
            </div>
            {subtitle && (
              <span className="text-[10px] text-slate-400 block mt-0.5">{subtitle}</span>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
              {Number(metrics?.advanceCount) || 0} adiantamento(s) pós-corte
            </span>
            <span className="text-[10px] text-slate-500 dark:text-slate-400 block font-medium">
              {Number(metrics?.deliveriesCount) || 0} entrega(s) pós-corte
            </span>
          </div>
        </div>

        {/* Composição Oficial Linha a Linha */}
        <div className="p-2.5 rounded-lg bg-slate-50/80 dark:bg-slate-900/50 border border-slate-200/70 dark:border-slate-800 space-y-1.5 text-[11px]">
          <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 pb-1 border-b border-slate-200/50 dark:border-slate-800 flex justify-between items-center">
            <span>Composição do Saldo</span>
            {formattedCutoffDate && (
              <span className="font-mono text-[9px] lowercase font-normal">
                corte em {formattedCutoffDate}
              </span>
            )}
          </div>

          {/* 1. Saldo de Abertura */}
          <div className="flex items-center justify-between text-slate-700 dark:text-slate-300">
            <span className="flex items-center gap-1 font-medium">
              <Wallet className="h-3 w-3 text-slate-500" />
              Saldo de Abertura{formattedCutoffDate ? ` (${formattedCutoffDate})` : ''}
            </span>
            <span className="font-mono font-bold">R$ {openingBalanceNum.toFixed(2)}</span>
          </div>

          {/* 2. + Adiantamentos do Período */}
          <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
            <span className="flex items-center gap-1 font-medium">
              <ArrowDownLeft className="h-3 w-3 text-emerald-500" />+ Adiantamentos do Período
            </span>
            <span className="font-mono font-bold">R$ {periodAdvancesNum.toFixed(2)}</span>
          </div>

          {/* 3. ± Ajustes Lançados */}
          {periodAdjustmentsNum !== 0 && (
            <div
              className={`flex items-center justify-between ${
                periodAdjustmentsNum >= 0
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-rose-700 dark:text-rose-400'
              }`}
            >
              <span className="flex items-center gap-1 font-medium">
                <Info className="h-3 w-3" />± Ajustes Lançados
              </span>
              <span className="font-mono font-bold">
                {periodAdjustmentsNum >= 0 ? '+' : ''} R$ {periodAdjustmentsNum.toFixed(2)}
              </span>
            </div>
          )}

          {/* 4. − Combustível Consumido */}
          <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
            <span className="flex items-center gap-1 font-medium">
              <ArrowUpRight className="h-3 w-3 text-amber-500" />− Combustível Consumido (Motor
              Oficial)
            </span>
            <span className="font-mono font-bold">− R$ {totalSpentNum.toFixed(2)}</span>
          </div>

          {/* 5. = Saldo Final */}
          <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/70 dark:border-slate-800 text-slate-900 dark:text-white font-bold">
            <span className="flex items-center gap-1 uppercase text-[10px]">= Saldo Final</span>
            <span
              className={`font-mono text-sm ${
                isPositive
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}
            >
              R$ {balanceNum.toFixed(2)}
            </span>
          </div>
        </div>

        {/* KM Oficial vs Desvios de Rota (Episódios - NUNCA somados em KM ou dinheiro) */}
        <div className="grid grid-cols-2 gap-2 text-[10px] pt-0.5">
          <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">KM Oficial:</span>
            <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
              {totalOfficialKmNum.toLocaleString('pt-BR', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{' '}
              km
            </span>
          </div>
          <div className="p-2 rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800 flex items-center justify-between">
            <span className="text-slate-500 dark:text-slate-400">Desvios:</span>
            <span
              className="font-mono font-bold text-slate-500 dark:text-slate-400"
              title="Desvios de rota são monitorados como episódios e nunca entram no pagamento de km ou combustível"
            >
              0 ep. (auditado)
            </span>
          </div>
        </div>

        {/* Badge / Indicador de Entregas Conjuntas se houver */}
        {(Number(metrics?.jointDeliveriesConsolidatedCount) || 0) > 0 && (
          <div className="p-2 rounded-md bg-purple-50 dark:bg-purple-950/30 border border-purple-200 dark:border-purple-800/40 text-[10px] text-purple-700 dark:text-purple-300 flex items-center justify-between">
            <div className="flex items-center gap-1.5 truncate">
              <Package className="h-3 w-3 shrink-0" />
              <span className="truncate">
                📦 {Number(metrics?.jointDeliveriesConsolidatedCount) || 0} entrega(s) conjunta(s)
                no mesmo ponto
              </span>
            </div>
            <span className="font-mono font-bold shrink-0 ml-1">
              -
              {jointSavedKmNum.toLocaleString('pt-BR', {
                minimumFractionDigits: 1,
                maximumFractionDigits: 1,
              })}{' '}
              km (-R${' '}
              {jointSavedFuelCostNum.toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              )
            </span>
          </div>
        )}

        {/* FRENTE 2: Sugestão de Recarga baseada na Média dos Últimos 30 Dias */}
        {!isBicycle && account?.dailyAverage30d !== undefined && account.dailyAverage30d > 0 && (
          <div className="p-2.5 rounded-lg bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/50 space-y-1.5 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-800 dark:text-blue-300 flex items-center gap-1">
                <Fuel className="h-3 w-3 text-[#0052CC]" />
                Sugestão de Recarga (Restante do Mês)
              </span>
              <Badge
                variant="outline"
                className="text-[9px] px-1.5 py-0 font-bold border-blue-300 bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300"
              >
                {account.remainingIntervalLabel || 'Mês Civil'}
              </Badge>
            </div>

            <div className="flex items-baseline justify-between pt-0.5">
              <div>
                <span className="text-[10px] text-slate-500 block">
                  {account.averageLabel || 'Média 30d'}:{' '}
                  <strong>R$ {account.dailyAverage30d.toFixed(2)}/dia</strong> • Projeção: R${' '}
                  {(account.projectionRemainingMonth || 0).toFixed(2)}
                </span>
              </div>
              <span className="font-mono text-base font-black text-blue-700 dark:text-blue-400">
                R$ {(account.suggestedRecharge || 0).toFixed(2)}
              </span>
            </div>

            <p className="text-[9px] text-slate-500 leading-tight">
              Média diária × {account.remainingDays || 0} dias restantes − saldo atual (R${' '}
              {balanceNum.toFixed(2)}). Nunca ultrapassa o necessário até o fim do mês civil.
            </p>
          </div>
        )}

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
                  R${' '}
                  {pricePerLiterNum.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                  /L •{' '}
                  {consumptionKmlNum.toLocaleString('pt-BR', {
                    minimumFractionDigits: 1,
                    maximumFractionDigits: 1,
                  })}{' '}
                  km/L ={' '}
                  <strong className="text-slate-700 dark:text-slate-300 font-mono">
                    R${' '}
                    {(pricePerLiterNum / (consumptionKmlNum || 1)).toLocaleString('pt-BR', {
                      minimumFractionDigits: 4,
                      maximumFractionDigits: 4,
                    })}
                    /km
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
