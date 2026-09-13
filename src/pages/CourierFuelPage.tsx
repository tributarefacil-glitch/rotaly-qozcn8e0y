import React, { useState, useEffect, useRef } from 'react'
import { haversineDistanceMeters } from '@/lib/geo'
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
  Receipt,
  Route as RouteIcon,
  Zap,
  CreditCard,
  FileSpreadsheet,
  AlertTriangle,
  ChevronRight,
  Compass,
} from 'lucide-react'
import { Header } from '@/components/Header'
import { CourierBottomNav } from '@/components/CourierBottomNav'
import { CourierFuelSummaryCard } from '@/components/CourierFuelSummaryCard'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'
import { deliveryService } from '@/services/deliveryService'
import { useAuth } from '@/contexts/AuthContext'
import { useRealtime } from '@/hooks/use-realtime'
import { useCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import type {
  FuelAdvanceRecord,
  OrderRecord,
  AppSettingsRecord,
  LocationRecord,
  OffRouteEventRecord,
} from '@/types/delivery'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { toast } from 'sonner'

export default function CourierFuelPage() {
  const { user } = useAuth()
  const [advances, setAdvances] = useState<FuelAdvanceRecord[]>([])
  const [orders, setOrders] = useState<OrderRecord[]>([])
  const [locations, setLocations] = useState<LocationRecord[]>([])
  const [offRouteEvents, setOffRouteEvents] = useState<OffRouteEventRecord[]>([])
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [periodFilter, setPeriodFilter] = useState<'all' | 'month' | 'week'>('all')
  const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

  const loadFinancialData = async () => {
    if (!user?.id) return

    try {
      // STRICT FILTER: Courier can ONLY access their OWN records
      const [userAdvances, userOrders, appSettings, userLocations, userEvents] = await Promise.all([
        deliveryService.getFuelAdvances(`courier_id = '${user.id}'`, '-date,-created'),
        deliveryService.getOrders(`courier_id = '${user.id}'`, '-created'),
        deliveryService.getSettings(),
        deliveryService.getLatestLocations(`user_id = '${user.id}'`),
        deliveryService.getOffRouteEvents(`courier_id = '${user.id}'`),
      ])

      setAdvances(userAdvances)
      setOrders(userOrders)
      setSettings(appSettings)
      setLocations(userLocations)
      setOffRouteEvents(userEvents)
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

  // Dedupe e lock de GPS na página de combustível
  const lastRecordedGpsRef = useRef<{ lat: number; lng: number; timestamp: number } | null>(null)
  const isSendingLocationRef = useRef<boolean>(false)

  // Telemetria GPS com dedupe e lock
  useEffect(() => {
    if (!user?.id) return

    const updateLocation = async () => {
      if (typeof navigator !== 'undefined' && navigator.geolocation) {
        if (isSendingLocationRef.current) return

        let batteryLevel: number | null = null
        try {
          const nav = typeof navigator !== 'undefined' ? (navigator as any) : null
          if (nav && typeof nav.getBattery === 'function') {
            const b = await nav.getBattery()
            if (typeof b?.level === 'number') batteryLevel = Math.round(b.level * 100)
          }
        } catch {
          /* ignore */
        }

        navigator.geolocation.getCurrentPosition(
          async (pos) => {
            const lat = pos.coords.latitude
            const lng = pos.coords.longitude
            const now = Date.now()
            const last = lastRecordedGpsRef.current

            if (last) {
              const timeDiff = (now - last.timestamp) / 1000
              const dist = haversineDistanceMeters(last.lat, last.lng, lat, lng)
              if (timeDiff < 30 && dist < 20) return
            }

            if (isSendingLocationRef.current) return
            isSendingLocationRef.current = true

            let calculatedSpeed = 0
            if (
              typeof pos.coords.speed === 'number' &&
              !isNaN(pos.coords.speed) &&
              pos.coords.speed > 0
            ) {
              calculatedSpeed = Math.round(pos.coords.speed * 3.6)
            } else if (last) {
              const timeDiffSeconds = (now - last.timestamp) / 1000
              const dist = haversineDistanceMeters(last.lat, last.lng, lat, lng)
              if (dist < 2) {
                calculatedSpeed = 0
              } else if (timeDiffSeconds > 0 && timeDiffSeconds < 120) {
                calculatedSpeed = Math.round((dist / timeDiffSeconds) * 3.6)
              }
            }

            try {
              await deliveryService.updateCourierLocation(
                user.id,
                lat,
                lng,
                calculatedSpeed,
                90,
                batteryLevel,
              )
              lastRecordedGpsRef.current = { lat, lng, timestamp: now }
            } catch (e) {
              console.error('Failed to post live location in fuel page:', e)
            } finally {
              isSendingLocationRef.current = false
            }
          },
          () => {
            /* sem mock arbitrário */
          },
          { enableHighAccuracy: true, timeout: 10000 },
        )
      }
    }

    updateLocation()
    const interval = setInterval(updateLocation, 30000)
    return () => clearInterval(interval)
  }, [user])

  // Realtime updates for fuel advances, orders, locations and off_route_events
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

  useRealtime<OffRouteEventRecord>('off_route_events', (e) => {
    if (e.record.courier_id === user?.id) {
      loadFinancialData()
    }
  })

  // Hook Compartilhado: mesmo motor de telemetria e regras de consumo do Admin
  const metrics = useCourierFuelMetrics({
    courier: user,
    advances,
    orders,
    locations,
    offRouteEvents,
    settings,
    periodFilter,
  })

  const {
    balance,
    totalAdvances,
    totalSpent,
    totalOfficialKm,
    totalDeviationKm,
    pricePerLiter,
    consumptionKml,
    vehicleCategory,
    orderCalculations,
    fuelAccount,
  } = metrics

  const isPositive = balance >= 0

  return (
    <div className="min-h-screen bg-white text-[#002855] flex flex-col pb-20 md:pb-6 font-sans">
      <Header />

      <main className="flex-1 max-w-2xl mx-auto w-full p-4 space-y-4">
        {/* Top Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[#1E2B58]">
          <div>
            <h1 className="font-heading text-xl font-black text-white flex items-center gap-2">
              <Fuel className="h-5 w-5 text-[#22C55E]" />
              Minha Conta de Combustível Rotaly
            </h1>
            <p className="font-sans text-xs text-slate-400">
              Telemetria real oficial sincronizada com o administrador.
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

        {/* COMPONENTE COMPARTILHADO: CARD DE CONTA CORRENTE (IDENTICO AO ADMIN) */}
        <CourierFuelSummaryCard
          metrics={metrics}
          courier={user}
          onOpenHistoryModal={() => setIsHistoryModalOpen(true)}
          subtitle="Valores 100% sincronizados com a contabilidade do gestor"
        />

        {/* BOTÃO RÁPIDO PARA ABRIR O HISTÓRICO COMPLETO */}
        <Button
          onClick={() => setIsHistoryModalOpen(true)}
          className="w-full h-11 bg-gradient-to-r from-[#0052CC] to-[#1D4ED8] hover:from-[#0047B3] hover:to-[#1E40AF] text-white font-bold text-xs rounded-xl shadow-brand flex items-center justify-center gap-2 border border-blue-400/30"
        >
          <CreditCard className="h-4 w-4" />
          <span>Abrir Histórico Completo de Entregas &amp; Telemetria</span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {/* DETAILED ADVANCES HISTORY (Adiantamentos recebidos) */}
        <div className="space-y-3 pt-2">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <Receipt className="h-4 w-4 text-[#00AA44]" />
              Histórico de Adiantamentos Recebidos ({metrics.advanceCount})
            </h3>
          </div>

          {metrics.advanceCount === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1E2B58] bg-[#0E1738]/60 p-8 text-center text-slate-400 space-y-2">
              <Fuel className="h-8 w-8 mx-auto text-slate-500" />
              <p className="text-xs font-medium">
                Nenhum adiantamento registrado para este período.
              </p>
              <p className="text-[11px] text-slate-500">
                Os adiantamentos cadastrados pelo gestor/administrador aparecerão automaticamente
                aqui.
              </p>
            </div>
          ) : (
            <div className="space-y-2 font-sans">
              {advances.map((adv) => (
                <div
                  key={adv.id}
                  className="p-3.5 rounded-xl border border-[#1E2B58] bg-[#0E1738] shadow-brand-dark flex items-center justify-between gap-3 hover:border-[#60A5FA]/40 transition"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-[#22C55E] shrink-0 mt-0.5">
                      <ArrowDownLeft className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm text-[#22C55E] font-mono">
                          + R$ {Number(adv.amount || 0).toFixed(2)}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[9px] uppercase font-mono bg-[#0A1128] border-[#1E2B58] text-slate-300"
                        >
                          {adv.payment_method || 'PIX'}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
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
                    <span className="inline-flex items-center gap-1 text-[10px] text-[#22C55E] font-semibold bg-emerald-500/10 px-2 py-1 rounded-md border border-emerald-500/30">
                      <CheckCircle2 className="h-3 w-3" />
                      Recebido
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* OFFICIAL ROUTE DELIVERIES (Gasto por Rota com Telemetria Real) */}
        <div className="space-y-3 pt-4">
          <div className="flex items-center justify-between px-1">
            <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <RouteIcon className="h-4 w-4 text-[#60A5FA]" />
              Detalhamento de Km &amp; Telemetria por Entrega ({orderCalculations.length})
            </h3>
            <span className="text-[10px] text-slate-400">
              Total Real: {totalOfficialKm.toFixed(1)} km
            </span>
          </div>

          {orderCalculations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#1E2B58] bg-[#0E1738]/60 p-6 text-center text-slate-400 text-xs">
              Nenhuma entrega computada para este período.
            </div>
          ) : (
            <div className="space-y-2 font-sans">
              {orderCalculations.map((calc) => {
                const { order, officialKm, deviationKm, fuelCost, isRealTelemetry, offRouteCount } =
                  calc

                return (
                  <div
                    key={order.id}
                    onClick={() => setIsHistoryModalOpen(true)}
                    className="p-3 rounded-xl border border-[#1E2B58] bg-[#0E1738] text-white shadow-brand-dark flex items-center justify-between text-xs cursor-pointer hover:border-[#60A5FA]/50 transition group"
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex flex-wrap items-center gap-1.5">
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
                              ? '⚠️ Erro Endereço'
                              : order.status === 'client_absent'
                                ? '⚠️ Ausente'
                                : 'Em Trânsito'}
                        </Badge>

                        {isRealTelemetry ? (
                          <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[9px] font-bold">
                            100% Real (GPS)
                          </Badge>
                        ) : (
                          <Badge className="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-[9px]">
                            ~Estimado
                          </Badge>
                        )}

                        {offRouteCount > 0 && (
                          <Badge className="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[9px]">
                            {offRouteCount} desvio(s)
                          </Badge>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-300 truncate max-w-[220px] mt-1 font-medium">
                        {order.expand?.customer_id?.name || 'Cliente'}
                      </p>
                      <p className="text-[10px] text-slate-400 truncate max-w-[220px]">
                        {order.expand?.customer_id?.street || order.expand?.customer_id?.address}
                      </p>
                    </div>

                    <div className="text-right shrink-0">
                      {vehicleCategory === 'bicicleta' ? (
                        <>
                          <p className="font-bold text-emerald-400 font-mono text-sm">
                            {officialKm.toFixed(1)} km
                          </p>
                          <p className="text-[10px] text-slate-400">Sem combustível</p>
                        </>
                      ) : (
                        <>
                          <p className="font-bold text-[#FF6B35] font-mono text-sm">
                            - R$ {fuelCost.toFixed(2)}
                          </p>
                          <p className="text-[10px] text-slate-300 font-mono">
                            {officialKm.toFixed(1)} km oficial
                          </p>
                        </>
                      )}
                      {deviationKm > 0 && (
                        <p className="text-[9px] text-rose-400 font-mono">
                          +{deviationKm.toFixed(1)} km desvios
                        </p>
                      )}
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

      {/* CourierDeliveryHistoryModal (MESMO MODAL DO ADMIN, FILTRADO PARA ESTE ENTREGADOR) */}
      <CourierDeliveryHistoryModal
        isOpen={isHistoryModalOpen}
        onClose={() => setIsHistoryModalOpen(false)}
        courier={user}
        fuelAccount={fuelAccount}
        orders={orders}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings}
      />
    </div>
  )
}
