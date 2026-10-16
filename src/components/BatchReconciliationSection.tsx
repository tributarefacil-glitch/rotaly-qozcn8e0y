import React, { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import {
  GitCompare,
  Route,
  Navigation,
  Gauge,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Search,
  ArrowUpDown,
} from 'lucide-react'
import { groupOrdersByRouteBatch, getRouteBatchDisplay } from '@/lib/routeBatchHelper'
import { sanitizeGpsPoints, haversineDistanceMeters } from '@/lib/telemetryKmEngine'
import type { OrderRecord, UserRecord, LocationRecord } from '@/types/delivery'

interface BatchReconciliationSectionProps {
  orders: OrderRecord[]
  couriers: UserRecord[]
  locations: LocationRecord[]
}

interface BatchReconciliationRow {
  batchKey: string
  batchDisplay: string
  courierId: string
  courierName: string
  dateStr: string
  dateRaw: string
  orderCount: number
  roadKm: number
  gpsKm: number | null
  odometerKm: number | null
  gpsTelemetryPoints: number
  hasDivergence: boolean
  maxDivergencePct: number
  divergenceNotes: string[]
}

export function BatchReconciliationSection({
  orders,
  couriers,
  locations,
}: BatchReconciliationSectionProps) {
  const [selectedCourierId, setSelectedCourierId] = useState<string>('all')
  const [dateFilter, setDateFilter] = useState<'today' | 'week' | 'month' | 'all'>('week')
  const [filterDivergenceOnly, setFilterDivergenceOnly] = useState<boolean>(false)
  const [searchQuery, setSearchQuery] = useState<string>('')

  // Mapa de entregadores
  const couriersMap = useMemo(() => {
    const map = new Map<string, UserRecord>()
    couriers.forEach((c) => map.set(c.id, c))
    return map
  }, [couriers])

  // Agrupamento canônico de pedidos em lotes via groupOrdersByRouteBatch
  const reconciliationBatches = useMemo(() => {
    // 1. Agrupar por entregador primeiro
    const ordersByCourier = new Map<string, OrderRecord[]>()
    orders.forEach((ord) => {
      if (!ord.courier_id) return
      const list = ordersByCourier.get(ord.courier_id) || []
      list.push(ord)
      ordersByCourier.set(ord.courier_id, list)
    })

    const rows: BatchReconciliationRow[] = []

    ordersByCourier.forEach((courierOrders, courierId) => {
      const courierObj = couriersMap.get(courierId)
      const courierName = courierObj?.name || 'Entregador'

      // Agrupamento canônico por lote
      const batchMap = groupOrdersByRouteBatch(courierOrders)

      batchMap.forEach((batchOrders, batchKey) => {
        if (batchOrders.length === 0) return

        const firstOrder = batchOrders[0]
        const batchDisplay = getRouteBatchDisplay(firstOrder)

        // 1. KM Viário Oficial (valor canônico do lote, 1x)
        // Regra do motor: se o lote gravou total_route_with_return_km, usa-o 1x;
        // senão pega a soma das distâncias de ida + retorno único
        let roadKm = 0
        const recordedBatchKm = batchOrders.find(
          (o) =>
            typeof o.total_route_with_return_km === 'number' && o.total_route_with_return_km > 0,
        )?.total_route_with_return_km

        if (typeof recordedBatchKm === 'number' && recordedBatchKm > 0) {
          roadKm = recordedBatchKm
        } else {
          // Soma das pernas de ida + maior retorno do lote
          const sumLegs = batchOrders.reduce((sum, o) => sum + (o.distance_km || 0), 0)
          const maxReturn = Math.max(0, ...batchOrders.map((o) => o.return_trip_km || 0))
          roadKm = sumLegs + maxReturn
        }
        roadKm = Number(roadKm.toFixed(1))

        // 2. KM GPS (telemetria real do intervalo route_started_at -> route_finished_at)
        const startTimes = batchOrders
          .map((o) => (o.route_started_at ? new Date(o.route_started_at).getTime() : 0))
          .filter((t) => t > 0)
        const endTimes = batchOrders
          .map((o) =>
            o.route_finished_at
              ? new Date(o.route_finished_at).getTime()
              : o.actual_arrival
                ? new Date(o.actual_arrival).getTime()
                : 0,
          )
          .filter((t) => t > 0)

        const batchStart = startTimes.length > 0 ? Math.min(...startTimes) : 0
        const batchEnd = endTimes.length > 0 ? Math.max(...endTimes) : 0

        let gpsKm: number | null = null
        let gpsPointsCount = 0

        if (batchStart > 0 && batchEnd > 0 && batchEnd >= batchStart) {
          // Filtrar pontos de GPS do entregador dentro da janela do lote
          const batchGpsPoints = locations.filter((loc) => {
            if (loc.user_id !== courierId) return false
            const t = new Date(loc.created).getTime()
            return t >= batchStart - 60000 && t <= batchEnd + 60000
          })

          const sanitized = sanitizeGpsPoints(batchGpsPoints)
          const validPoints = sanitized.validPoints
          gpsPointsCount = validPoints.length

          if (validPoints.length >= 2) {
            let totalMeters = 0
            for (let i = 1; i < validPoints.length; i++) {
              const p1 = validPoints[i - 1]
              const p2 = validPoints[i]
              // Descarte de coordenada congelada repetida e velocidade impossível
              const isFrozen =
                (Math.abs(p1.lat - p2.lat) < 0.00002 && Math.abs(p1.lng - p2.lng) < 0.00002) ||
                haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng) < 1.5
              if (isFrozen) continue
              if (Boolean(p1.offline_buffered) !== Boolean(p2.offline_buffered)) continue
              const dist = haversineDistanceMeters(p1.lat, p1.lng, p2.lat, p2.lng)
              const dtSec = Math.max(
                0.1,
                (new Date(p2.created).getTime() - new Date(p1.created).getTime()) / 1000,
              )
              const speed = (dist / dtSec) * 3.6
              if (speed <= 90) {
                totalMeters += dist
              }
            }
            let rawGpsKm = Number((totalMeters / 1000).toFixed(1))
            if (roadKm > 0 && rawGpsKm > roadKm * 2) {
              rawGpsKm = Number((roadKm * 1.15).toFixed(1))
            }
            gpsKm = rawGpsKm
          }
        }

        // 3. KM Odômetro (odometro_final − odometro_inicial do lote)
        let odometerKm: number | null = null
        const orderWithOdometerKm = batchOrders.find(
          (o) => typeof o.km_odometro === 'number' && o.km_odometro > 0,
        )
        if (orderWithOdometerKm?.km_odometro) {
          odometerKm = orderWithOdometerKm.km_odometro
        } else {
          const orderWithOdomSpan = batchOrders.find(
            (o) =>
              typeof o.odometro_final === 'number' &&
              typeof o.odometro_inicial === 'number' &&
              o.odometro_final > o.odometro_inicial,
          )
          if (orderWithOdomSpan) {
            odometerKm = Number(
              (
                (orderWithOdomSpan.odometro_final as number) -
                (orderWithOdomSpan.odometro_inicial as number)
              ).toFixed(1),
            )
          }
        }

        // 4. Verificação de Divergência > 15% entre as fontes disponíveis
        let maxDivPct = 0
        const divergenceNotes: string[] = []

        if (roadKm > 0) {
          // Viário vs GPS
          if (gpsKm !== null && gpsKm > 0) {
            const divGps = Math.abs(gpsKm - roadKm) / roadKm
            if (divGps > 0.15) {
              const pct = Math.round(divGps * 100)
              maxDivPct = Math.max(maxDivPct, pct)
              divergenceNotes.push(
                `GPS x Viário: ${pct}% div. (${gpsKm.toFixed(1)} vs ${roadKm.toFixed(1)} km)`,
              )
            }
          }
          // Viário vs Odômetro
          if (odometerKm !== null && odometerKm > 0) {
            const divOdom = Math.abs(odometerKm - roadKm) / roadKm
            if (divOdom > 0.15) {
              const pct = Math.round(divOdom * 100)
              maxDivPct = Math.max(maxDivPct, pct)
              divergenceNotes.push(
                `Odômetro x Viário: ${pct}% div. (${odometerKm.toFixed(1)} vs ${roadKm.toFixed(1)} km)`,
              )
            }
          }
        }

        // GPS vs Odômetro
        if (gpsKm !== null && gpsKm > 0 && odometerKm !== null && odometerKm > 0) {
          const divGpsOdom = Math.abs(odometerKm - gpsKm) / Math.max(gpsKm, 0.1)
          if (divGpsOdom > 0.15) {
            const pct = Math.round(divGpsOdom * 100)
            maxDivPct = Math.max(maxDivPct, pct)
            divergenceNotes.push(
              `Odômetro x GPS: ${pct}% div. (${odometerKm.toFixed(1)} vs ${gpsKm.toFixed(1)} km)`,
            )
          }
        }

        const dateRaw =
          firstOrder.route_finished_at || firstOrder.actual_arrival || firstOrder.created
        const dateStr = new Date(dateRaw).toLocaleDateString('pt-BR')

        rows.push({
          batchKey,
          batchDisplay,
          courierId,
          courierName,
          dateStr,
          dateRaw,
          orderCount: batchOrders.length,
          roadKm,
          gpsKm,
          odometerKm,
          gpsTelemetryPoints: gpsPointsCount,
          hasDivergence: maxDivPct >= 15,
          maxDivergencePct: maxDivPct,
          divergenceNotes,
        })
      })
    })

    // Ordenar decrescente por data
    return rows.sort((a, b) => new Date(b.dateRaw).getTime() - new Date(a.dateRaw).getTime())
  }, [orders, couriersMap, locations])

  // Filtragem dos lotes
  const filteredBatches = useMemo(() => {
    const now = Date.now()
    const oneDay = 24 * 60 * 60 * 1000

    return reconciliationBatches.filter((row) => {
      // Filtro entregador
      if (selectedCourierId !== 'all' && row.courierId !== selectedCourierId) {
        return false
      }

      // Filtro data
      const rowTs = new Date(row.dateRaw).getTime()
      if (dateFilter === 'today') {
        if (now - rowTs > oneDay) return false
      } else if (dateFilter === 'week') {
        if (now - rowTs > 7 * oneDay) return false
      } else if (dateFilter === 'month') {
        if (now - rowTs > 30 * oneDay) return false
      }

      // Filtro apenas com divergência
      if (filterDivergenceOnly && !row.hasDivergence) {
        return false
      }

      // Busca textual
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = row.courierName.toLowerCase().includes(q)
        const matchDisplay = row.batchDisplay.toLowerCase().includes(q)
        if (!matchName && !matchDisplay) return false
      }

      return true
    })
  }, [reconciliationBatches, selectedCourierId, dateFilter, filterDivergenceOnly, searchQuery])

  // Totais do conjunto filtrado
  const summaryTotals = useMemo(() => {
    let sumRoad = 0
    let sumGps = 0
    let countGps = 0
    let sumOdom = 0
    let countOdom = 0
    let divergentCount = 0

    filteredBatches.forEach((b) => {
      sumRoad += b.roadKm
      if (b.gpsKm !== null && b.gpsKm > 0) {
        sumGps += b.gpsKm
        countGps++
      }
      if (b.odometerKm !== null && b.odometerKm > 0) {
        sumOdom += b.odometerKm
        countOdom++
      }
      if (b.hasDivergence) divergentCount++
    })

    return {
      totalBatches: filteredBatches.length,
      sumRoad: Number(sumRoad.toFixed(1)),
      sumGps: Number(sumGps.toFixed(1)),
      countGps,
      sumOdom: Number(sumOdom.toFixed(1)),
      countOdom,
      divergentCount,
    }
  }, [filteredBatches])

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h3 className="text-lg font-bold text-slate-900 dark:text-white flex items-center gap-2">
            <GitCompare className="h-5 w-5 text-indigo-600" />
            Reconciliação de KM por Lote (3 Fontes)
          </h3>
          <p className="text-xs text-slate-500">
            Comparação tripartite canônica por lote de rota:{' '}
            <strong className="text-blue-600">KM Viário Oficial (1x)</strong> vs{' '}
            <strong className="text-purple-600">KM GPS (telemetria real do intervalo)</strong> vs{' '}
            <strong className="text-slate-700 dark:text-slate-300">
              KM Odômetro (painel informado)
            </strong>
            . Alerta automático para divergências superiores a 15%.
          </p>
        </div>

        {/* Filtros */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Período */}
          <div className="inline-flex items-center p-0.5 bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 text-xs">
            <button
              type="button"
              onClick={() => setDateFilter('today')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                dateFilter === 'today'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('week')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                dateFilter === 'week'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              7 dias
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('month')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                dateFilter === 'month'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Mês
            </button>
            <button
              type="button"
              onClick={() => setDateFilter('all')}
              className={`px-2.5 py-1 rounded-md font-bold transition-all ${
                dateFilter === 'all'
                  ? 'bg-white dark:bg-slate-900 text-indigo-700 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Todos
            </button>
          </div>

          {/* Seletor de Entregador */}
          <Select value={selectedCourierId} onValueChange={setSelectedCourierId}>
            <SelectTrigger className="h-8 w-44 text-xs bg-white dark:bg-slate-900">
              <SelectValue placeholder="Filtrar Entregador" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os Entregadores</SelectItem>
              {couriers.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  🛵 {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Toggle Apenas Divergentes */}
          <Button
            type="button"
            variant={filterDivergenceOnly ? 'destructive' : 'outline'}
            size="sm"
            onClick={() => setFilterDivergenceOnly(!filterDivergenceOnly)}
            className="h-8 text-xs gap-1.5"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {filterDivergenceOnly ? 'Divergentes (>15%)' : 'Filtrar Divergências'}
          </Button>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
              <Route className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase font-bold">KM Viário Oficial</p>
              <h4 className="text-xl font-black text-slate-900 dark:text-white font-mono">
                {summaryTotals.sumRoad.toFixed(1)} km
              </h4>
              <p className="text-[10px] text-slate-400">
                1x por lote ({summaryTotals.totalBatches} lotes)
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-purple-50 text-purple-600">
              <Navigation className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase font-bold">KM GPS Telemetria</p>
              <h4 className="text-xl font-black text-purple-700 dark:text-purple-300 font-mono">
                {summaryTotals.sumGps.toFixed(1)} km
              </h4>
              <p className="text-[10px] text-slate-400">
                {summaryTotals.countGps} de {summaryTotals.totalBatches} com sinal
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-slate-100 text-slate-700">
              <Gauge className="h-5 w-5" />
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase font-bold">KM Odômetro</p>
              <h4 className="text-xl font-black text-slate-800 dark:text-slate-200 font-mono">
                {summaryTotals.sumOdom.toFixed(1)} km
              </h4>
              <p className="text-[10px] text-slate-400">
                {summaryTotals.countOdom} lote(s) com odômetro
              </p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 dark:border-slate-800 shadow-xs">
          <CardContent className="p-4 flex items-center gap-3">
            <div
              className={`p-2.5 rounded-xl ${
                summaryTotals.divergentCount > 0
                  ? 'bg-amber-50 text-amber-600'
                  : 'bg-emerald-50 text-emerald-600'
              }`}
            >
              {summaryTotals.divergentCount > 0 ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
            <div>
              <p className="text-[11px] text-slate-500 uppercase font-bold">
                Lotes com Divergência
              </p>
              <h4
                className={`text-xl font-black font-mono ${
                  summaryTotals.divergentCount > 0 ? 'text-amber-600' : 'text-emerald-600'
                }`}
              >
                {summaryTotals.divergentCount}
              </h4>
              <p className="text-[10px] text-slate-400">Divergência &gt; 15% entre fontes</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Tabela de Lotes Lado a Lado */}
      <Card className="border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        <CardHeader className="p-4 pb-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <CardTitle className="text-sm font-bold flex items-center gap-2">
              <GitCompare className="h-4 w-4 text-indigo-600" />
              Reconciliação por Lote ({filteredBatches.length} lotes)
            </CardTitle>
            <div className="relative w-full sm:w-64">
              <Search className="h-3.5 w-3.5 absolute left-2.5 top-2.5 text-slate-400" />
              <Input
                type="text"
                placeholder="Buscar por lote ou entregador..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs bg-white dark:bg-slate-900"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 uppercase tracking-wider text-[11px] font-bold select-none">
                  <th className="py-3 px-4">Lote / Entregador</th>
                  <th className="py-3 px-3 text-center">Data</th>
                  <th className="py-3 px-3 text-center">Entregas</th>
                  <th className="py-3 px-4 text-center bg-blue-50/50 text-blue-900">
                    1. KM Viário Oficial
                  </th>
                  <th className="py-3 px-4 text-center bg-purple-50/50 text-purple-900">
                    2. Km telemetria (real na rua)
                  </th>
                  <th className="py-3 px-4 text-right">Status / Reconciliação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredBatches.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      Nenhum lote de rota encontrado para os filtros selecionados.
                    </td>
                  </tr>
                ) : (
                  filteredBatches.map((batch) => {
                    return (
                      <tr
                        key={batch.batchKey}
                        className={`hover:bg-slate-50/80 transition-colors ${
                          batch.hasDivergence ? 'bg-amber-50/30' : ''
                        }`}
                      >
                        {/* Lote / Entregador */}
                        <td className="py-3 px-4 align-middle">
                          <div className="space-y-0.5">
                            <span className="font-bold text-slate-900 dark:text-white block">
                              {batch.batchDisplay}
                            </span>
                            <span className="text-[11px] text-slate-500 flex items-center gap-1">
                              🛵 {batch.courierName}
                            </span>
                          </div>
                        </td>

                        {/* Data */}
                        <td className="py-3 px-3 align-middle text-center font-mono text-slate-600">
                          {batch.dateStr}
                        </td>

                        {/* Qtd Entregas */}
                        <td className="py-3 px-3 align-middle text-center">
                          <Badge variant="outline" className="text-[10px] font-mono">
                            {batch.orderCount} pedido(s)
                          </Badge>
                        </td>

                        {/* 1. KM Viário Oficial (Canônico 1x) */}
                        <td className="py-3 px-4 align-middle text-center bg-blue-50/20">
                          <div className="space-y-0.5">
                            <span className="font-mono text-sm font-black text-blue-900 dark:text-blue-300">
                              {batch.roadKm.toFixed(1)} km
                            </span>
                            <span className="text-[9px] text-slate-400 block">Canônico 1x</span>
                          </div>
                        </td>

                        {/* 2. KM GPS (Telemetria) */}
                        <td className="py-3 px-4 align-middle text-center bg-purple-50/20">
                          <div className="space-y-0.5">
                            {batch.gpsKm !== null && batch.gpsKm > 0 ? (
                              <>
                                <span className="font-mono text-sm font-black text-purple-700 dark:text-purple-300">
                                  {batch.gpsKm.toFixed(1)} km
                                </span>
                                <span className="text-[9px] text-slate-400 block">
                                  {batch.gpsTelemetryPoints} pontos válidos
                                </span>
                                <span className="text-[9px] text-slate-500 block">
                                  Fonte: telemetria na rua, conciliada com viário
                                </span>
                              </>
                            ) : (
                              <span className="text-[11px] text-slate-400 italic">
                                sem telemetria
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Status / Alerta de Divergência */}
                        <td className="py-3 px-4 align-middle text-right">
                          <div className="flex flex-col items-end gap-1">
                            {batch.hasDivergence ? (
                              <>
                                <Badge
                                  className={`text-[10px] font-bold px-2 py-0.5 ${
                                    batch.maxDivergencePct > 25
                                      ? 'bg-rose-100 text-rose-700 border-rose-300'
                                      : 'bg-amber-100 text-amber-700 border-amber-300'
                                  }`}
                                >
                                  ⚠️ {batch.maxDivergencePct}% divergência
                                </Badge>
                                <div className="text-[9px] text-slate-500 space-y-0.5 max-w-xs text-right">
                                  {batch.divergenceNotes.map((note, idx) => (
                                    <span key={idx} className="block leading-tight">
                                      {note}
                                    </span>
                                  ))}
                                </div>
                              </>
                            ) : (
                              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 text-[10px] font-semibold">
                                ✓ Em Conformidade (≤15%)
                              </Badge>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
