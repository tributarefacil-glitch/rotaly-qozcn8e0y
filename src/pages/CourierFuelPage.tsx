import React, { useState, useEffect } from 'react'
import {
  Fuel,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingDown,
  Calendar,
  Clock,
  RefreshCw,
  Info,
  CheckCircle2,
  ShieldCheck,
  Receipt,
  Route as RouteIcon,
  Zap,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { deliveryService } from '@/services/deliveryService'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import type { FuelAdvanceRecord, OrderRecord, AppSettingsRecord } from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { toast } from 'sonner'

export default function CourierFuelPage() {
  const { user } = useAuth()
  const [advances, setAdvances] = useState<FuelAdvanceRecord[]>([])
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [periodFilter, setPeriodFilter] = useState<'all' | 'month' | 'week'>('all')

  const loadFinancialData = async () => {
    if (!user?.id) return

    try {
      // STRICT FILTER: Courier can ONLY access their OWN records
      const [userAdvances, userOrders, appSettings] = await Promise.all([
        deliveryService.getFuelAdvances(`courier_id = '${user.id}'`, '-date,-created'),
        deliveryService.getOrders(`courier_id = '${user.id}'`, '-created'),
        deliveryService.getSettings(),
      ])

      setAdvances(userAdvances)
      setOrders(userOrders)
      setSettings(appSettings)
    } catch (err) {
      console.error('Error loading courier fuel data:', err)
      toast.error('Erro ao carregar dados financeiros de combustível.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadFinancialData()
  }, [user])

  // Realtime updates for fuel advances and orders for this courier
  useRealtime<FuelAdvanceRecord>('fuel_advances', (e) => {
    if (e.record.courier_id === user?.id) {
      if (e.action === 'create') {
        toast.success(
          `⛽ Novo adiantamento recebido: R$ ${Number(e.record.amount || 0).toFixed(2)}`,
        )
      }
      loadFinancialData()
    }
  })

  useRealtime<OrderRecord>('orders', (e) => {
    if (e.record.courier_id === user?.id) {
      loadFinancialData()
    }
  })

  // Calculation parameters
  const fuelPrice = settings?.fuel_price_per_liter || 5.59
  const fuelConsumption = settings?.fuel_consumption_kml || 35.0

  // Filtered advances by period
  const now = new Date()
  const filteredAdvances = advances.filter((adv) => {
    if (!adv.date && !adv.created) return true
    const advDate = new Date(adv.date || adv.created)

    if (periodFilter === 'month') {
      return advDate.getMonth() === now.getMonth() && advDate.getFullYear() === now.getFullYear()
    }
    if (periodFilter === 'week') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return advDate >= sevenDaysAgo
    }
    return true
  })

  // Official route orders: Considera rotas com route_started === true OU status in_transit/delivered/address_error/client_absent
  const officialRouteOrders = orders.filter(
    (o) =>
      o.route_started === true ||
      o.status === 'delivered' ||
      o.status === 'in_transit' ||
      o.status === 'address_error' ||
      o.status === 'client_absent',
  )

  const filteredOrders = officialRouteOrders.filter((o) => {
    const oDate = new Date(o.created)
    if (periodFilter === 'month') {
      return oDate.getMonth() === now.getMonth() && oDate.getFullYear() === now.getFullYear()
    }
    if (periodFilter === 'week') {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      return oDate >= sevenDaysAgo
    }
    return true
  })

  // Total Advance Received
  const totalAdvances = filteredAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

  // Total Official Route Km (Ida e Volta considerada, incluindo rotas parciais)
  const totalRouteKm = filteredOrders.reduce((sum, o) => {
    let baseKm = typeof o.distance_km === 'number' && o.distance_km > 0 ? o.distance_km : 0
    let returnKm =
      typeof o.return_trip_km === 'number' && o.return_trip_km > 0 ? o.return_trip_km : 0

    if (
      baseKm === 0 &&
      (o.status === 'address_error' || o.status === 'client_absent' || o.route_started)
    ) {
      baseKm = 4.5
      if (returnKm === 0) returnKm = 4.5
    }

    return sum + baseKm + returnKm
  }, 0)
  // Total estimated spent in routes
  const totalSpent = fuelConsumption > 0 ? (totalRouteKm * fuelPrice) / fuelConsumption : 0

  // Real-time Balance
  const balance = totalAdvances - totalSpent
  const isPositive = balance >= 0

  return (
    <div className="min-h-screen bg-[#070D1E] text-slate-100 flex flex-col pb-20 md:pb-6 font-sans">
      <Header />

      <main className="flex-1 max-w-2xl mx-auto w-full p-4 space-y-4">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[#1E2B58]">
          <div>
            <h1 className="font-heading text-xl font-black text-white flex items-center gap-2">
              <Fuel className="h-5 w-5 text-[#22C55E]" />
              Minha Conta de Combustível LOGHYPE
            </h1>
            <p className="font-sans text-xs text-slate-400">
              Acompanhe seus adiantamentos e gastos calculados em tempo real.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadFinancialData}
            className="h-9 gap-1.5 border-[#1E2B58] bg-[#0E1738] hover:bg-[#121E46] text-slate-200 text-xs"
          >
            <RefreshCw className="h-3.5 w-3.5 text-[#60A5FA]" />
            Atualizar
          </Button>
        </div>

        {/* PERIOD SELECTOR TABS */}
        <div className="flex items-center justify-between">
          <Tabs
            value={periodFilter}
            onValueChange={(v) => setPeriodFilter(v as 'all' | 'month' | 'week')}
            className="w-full"
          >
            <TabsList className="grid grid-cols-3 bg-[#0A1128] border border-[#1E2B58] h-10 p-1 rounded-xl font-heading">
              <TabsTrigger
                value="all"
                className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white rounded-lg font-bold"
              >
                Todo o Período
              </TabsTrigger>
              <TabsTrigger
                value="month"
                className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white rounded-lg font-bold"
              >
                Este Mês
              </TabsTrigger>
              <TabsTrigger
                value="week"
                className="text-xs text-slate-300 data-[state=active]:bg-[#0052CC] data-[state=active]:text-white rounded-lg font-bold"
              >
                Últimos 7 dias
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* MAIN CURRENT ACCOUNT BALANCE CARD */}
        <Card className="border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark relative overflow-hidden rounded-xl">
          <div
            className={`absolute top-0 left-0 right-0 h-1.5 ${
              isPositive ? 'bg-[#22C55E]' : 'bg-[#EF4444]'
            }`}
          />

          <CardHeader className="p-4 pb-2 flex flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-9 w-9 items-center justify-center rounded-card bg-blue-50 border border-blue-200 text-[#0052CC]">
                <Wallet className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="font-heading text-xs uppercase tracking-wider text-slate-500 font-bold">
                  Saldo da Minha Conta Corrente
                </CardTitle>
                <p className="text-[11px] text-slate-500 font-sans">
                  Adiantamentos recebidos − Custo de rota realizada
                </p>
              </div>
            </div>

            <Badge
              className={`text-[10px] font-bold ${
                isPositive
                  ? 'bg-emerald-50 text-[#00AA44] border-emerald-200'
                  : 'bg-red-50 text-[#E74C3C] border-red-200'
              }`}
            >
              {isPositive ? 'Crédito Disponível' : 'Saldo Devedor / A Repor'}
            </Badge>
          </CardHeader>

          <CardContent className="p-4 pt-1 space-y-4 font-sans">
            {/* Big Balance Number */}
            <div className="flex items-baseline justify-between border-b border-slate-100 pb-3">
              <div>
                <span
                  className={`font-heading text-3xl sm:text-4xl font-black font-mono tracking-tight ${
                    isPositive ? 'text-[#00AA44]' : 'text-[#E74C3C]'
                  }`}
                >
                  R$ {balance.toFixed(2)}
                </span>
                <span className="block text-[10px] text-slate-500 mt-0.5">
                  {isPositive
                    ? 'Você ainda possui saldo de combustível adiantado pela empresa.'
                    : 'Gasto em rotas superou os adiantamentos atuais.'}
                </span>
              </div>
            </div>

            {/* Inflow vs Outflow Metrics Grid */}
            <div className="grid grid-cols-2 gap-3">
              {/* Adiantamentos Recebidos (+) */}
              <div className="p-3 rounded-lg bg-[#0A1128] border border-[#1E2B58] space-y-1">
                <div className="flex items-center gap-1.5 text-[#22C55E] text-xs font-semibold font-heading">
                  <ArrowDownLeft className="h-4 w-4" />
                  <span>Adiantamentos Recebidos</span>
                </div>
                <p className="text-xl font-bold font-mono text-[#22C55E]">
                  + R$ {totalAdvances.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {filteredAdvances.length} lançamento(s) efetuados
                </p>
              </div>

              {/* Gasto em Rotas (-) */}
              <div className="p-3 rounded-lg bg-[#0A1128] border border-[#1E2B58] space-y-1">
                <div className="flex items-center gap-1.5 text-[#FF6B35] text-xs font-semibold font-heading">
                  <ArrowUpRight className="h-4 w-4" />
                  <span>Gasto em Rotas Oficiais</span>
                </div>
                <p className="text-xl font-bold font-mono text-[#FF6B35]">
                  - R$ {totalSpent.toFixed(2)}
                </p>
                <p className="text-[10px] text-slate-400">
                  {totalRouteKm.toFixed(1)} km em {filteredOrders.length} entregas
                </p>
              </div>
            </div>

            {/* Current Pricing Rule Summary */}
            <div className="p-3 rounded-lg bg-[#0A1128] border border-[#1E2B58] text-[11px] text-slate-300 flex items-start gap-2">
              <Info className="h-4 w-4 text-[#60A5FA] shrink-0 mt-0.5" />
              <div>
                <p className="text-white font-semibold font-heading">
                  Regra de Cálculo de Combustível:
                </p>
                <p className="mt-0.5 text-slate-300">
                  R$ {fuelPrice.toFixed(2)} / Litro ÷ {fuelConsumption.toFixed(1)} km/L ={' '}
                  <strong className="text-[#60A5FA]">
                    R$ {(fuelPrice / (fuelConsumption || 1)).toFixed(4)} por km percorrido
                  </strong>
                  .
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* DETAILED ADVANCES HISTORY (Adiantamentos recebidos) */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-[#1a1a1a] flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-[#00AA44]" />
              Histórico de Adiantamentos Recebidos ({filteredAdvances.length})
            </h3>
          </div>

          {filteredAdvances.length === 0 ? (
            <div className="rounded-card border border-dashed border-slate-200 bg-white p-8 text-center text-slate-400 space-y-2">
              <Fuel className="h-8 w-8 mx-auto text-slate-400" />
              <p className="text-xs font-medium">
                Nenhum adiantamento registrado para este período.
              </p>
              <p className="text-[11px] text-slate-500">
                Os valores cadastrados pelo gestor/administrador aparecerão automaticamente aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-2 font-sans">
              {filteredAdvances.map((adv) => (
                <div
                  key={adv.id}
                  className="p-3.5 rounded-card border border-slate-200 bg-white shadow-brand flex items-center justify-between gap-3 hover:border-slate-300 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-card bg-emerald-50 border border-emerald-200 text-[#00AA44] shrink-0 mt-0.5">
                      <ArrowDownLeft className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#00AA44] font-mono">
                          + R$ {Number(adv.amount || 0).toFixed(2)}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] uppercase font-mono bg-slate-100 border-slate-200 text-slate-700"
                        >
                          {adv.payment_method || 'PIX'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        {adv.notes || 'Adiantamento de combustível para rotas'}
                      </p>
                      <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
                        <Calendar className="h-3 w-3" />
                        <span>
                          {adv.date
                            ? new Date(adv.date).toLocaleDateString('pt-BR')
                            : new Date(adv.created).toLocaleDateString('pt-BR')}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#00AA44] font-semibold bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">
                      <CheckCircle2 className="h-3 w-3" />
                      Recebido
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* OFFICIAL ROUTE DELIVERIES (Gasto por Rota) */}
        <div className="space-y-3 pt-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-[#1a1a1a] flex items-center gap-1.5">
              <RouteIcon className="h-4 w-4 text-[#0052CC]" />
              Detalhamento de Km & Consumo por Entrega ({filteredOrders.length})
            </h3>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="rounded-card border border-dashed border-slate-200 bg-white p-6 text-center text-slate-400 text-xs">
              Nenhuma entrega computada para este período.
            </div>
          ) : (
            <div className="space-y-2 font-sans">
              {filteredOrders.map((order) => {
                const baseKm =
                  typeof order.distance_km === 'number' && order.distance_km > 0
                    ? order.distance_km
                    : 0
                const returnKm =
                  typeof order.return_trip_km === 'number' && order.return_trip_km > 0
                    ? order.return_trip_km
                    : 0
                const totalOrderKm = baseKm + returnKm
                const cost = fuelConsumption > 0 ? (totalOrderKm * fuelPrice) / fuelConsumption : 0

                return (
                  <div
                    key={order.id}
                    className="p-3 rounded-card border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[#60A5FA]">
                          {order.tracking_code}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-[#0A1128] border-[#1E2B58] text-slate-300"
                        >
                          {order.status === 'delivered'
                            ? '✓ Entregue'
                            : order.status === 'address_error'
                              ? '⚠️ Erro Endereço (Rota Parcial)'
                              : order.status === 'client_absent'
                                ? '⚠️ Cliente Ausente (Rota Parcial)'
                                : 'Em Rota Iniciada'}
                        </Badge>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate max-w-[200px] mt-0.5">
                        {order.expand?.customer_id?.name || 'Cliente'}
                      </p>
                      {order.start_base_name && (
                        <p className="text-[10px] text-slate-400">Base: {order.start_base_name}</p>
                      )}
                    </div>

                    <div className="text-right">
                      <p className="font-bold text-[#FF6B35] font-mono">- R$ {cost.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-400">
                        {totalOrderKm > 0 ? `${totalOrderKm.toFixed(1)} km (c/ volta)` : 'Km N/D'}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <CourierBottomNav />
    </div>
  )
}
