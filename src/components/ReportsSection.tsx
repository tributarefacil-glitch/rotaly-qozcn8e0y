import React, { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  FileText,
  Download,
  Share2,
  Printer,
  TrendingUp,
  Clock,
  DollarSign,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Package,
  Calendar,
  Users,
  ChevronRight,
  Filter,
  BarChart2,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
  Star,
  MapPin,
  Fuel,
  Car,
  Truck,
  Bike,
  Activity,
  Check,
  ExternalLink,
  Gauge,
  Loader2,
  Receipt,
  UserCheck,
} from 'lucide-react'
import {
  OrderRecord,
  UserRecord,
  AppSettingsRecord,
  OffRouteEventRecord,
  LocationRecord,
} from '@/types/delivery'
import { deliveryService } from '@/services/deliveryService'
import { calculateRealKmForOrder } from '@/lib/telemetryKmEngine'
import {
  formatPbTimestamp,
  getOperationalWindow,
  isNeutralizedSystemError,
  isTimestampInOperationalWindow,
  isTodayOrder,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import { useToast } from '@/hooks/use-toast'
import { CourierDeliveryHistoryModal } from '@/components/CourierDeliveryHistoryModal'

interface ReportsSectionProps {
  orders: OrderRecord[]
  couriers: UserRecord[]
  sellers?: UserRecord[]
  settings?: AppSettingsRecord | null
  offRouteEvents?: OffRouteEventRecord[]
  locations?: LocationRecord[]
}

export const ReportsSection: React.FC<ReportsSectionProps> = ({
  orders,
  couriers,
  sellers: propSellers,
  settings,
  offRouteEvents = [],
  locations = [],
}) => {
  const { toast } = useToast()
  // SELETOR DE PERÍODO: hoje, semana, mês, personalizado (todos)
  const [period, setPeriod] = useState<'today' | 'week' | 'month' | 'all'>('month')
  const [periodOrders, setPeriodOrders] = useState<OrderRecord[]>([])
  const [isLoadingPeriodOrders, setIsLoadingPeriodOrders] = useState<boolean>(false)
  const [loadedPeriod, setLoadedPeriod] = useState<string | null>(null)
  const [sellersList, setSellersList] = useState<UserRecord[]>(propSellers || [])

  const [copiedLink, setCopiedLink] = useState(false)
  const [selectedCourierForModal, setSelectedCourierForModal] = useState<UserRecord | null>(null)
  const [isCourierModalOpen, setIsCourierModalOpen] = useState(false)

  const fuelPrice = settings?.fuel_price_per_liter || 5.59
  const fuelConsumption = settings?.fuel_consumption_kml || 35.0

  // Se sellers não foi passado via props, carregar do deliveryService
  React.useEffect(() => {
    if (propSellers && propSellers.length > 0) {
      setSellersList(propSellers)
      return
    }
    let isMounted = true
    deliveryService
      .getSellers()
      .then((s) => {
        if (isMounted) setSellersList(s)
      })
      .catch((err) => console.warn('Erro ao carregar vendedores para relatórios:', err))
    return () => {
      isMounted = false
    }
  }, [propSellers])

  // Carregar os pedidos do período diretamente do banco via paginação de ~200
  React.useEffect(() => {
    let isCancelled = false
    const fetchPeriodData = async () => {
      // Para 'today', se já temos initialOrders filtrados ou podemos buscar a janela operacional
      const now = new Date()
      let filter = ''

      if (period === 'today') {
        const opWindow = getOperationalWindow(now)
        const startStr = opWindow.startPbString
        const endStr = opWindow.endPbString
        filter = `(created >= '${startStr}' && created <= '${endStr}') || (route_started = true && route_finished != true) || (route_released != true && (status = 'pending' || status = 'assigned'))`
      } else if (period === 'week') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        const startStr = formatPbTimestamp(sevenDaysAgo)
        filter = `created >= '${startStr}'`
      } else if (period === 'month') {
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
        const startStr = formatPbTimestamp(thirtyDaysAgo)
        filter = `created >= '${startStr}'`
      } else {
        // all: sem filtro de data
        filter = ''
      }

      setIsLoadingPeriodOrders(true)
      try {
        const fetched = await deliveryService.getOrdersInBatches(
          filter,
          '-created',
          'customer_id,courier_id,seller_id',
          200,
        )
        if (!isCancelled) {
          setPeriodOrders(fetched)
          setLoadedPeriod(period)
        }
      } catch (err) {
        console.error('Erro ao carregar pedidos do período:', err)
        if (!isCancelled) {
          // Fallback para orders em caso de falha de rede
          setPeriodOrders(orders)
          setLoadedPeriod(period)
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingPeriodOrders(false)
        }
      }
    }

    fetchPeriodData()

    return () => {
      isCancelled = true
    }
  }, [period])

  // Pedidos ativos baseados no carregamento direto do período
  const activeOrdersPool =
    periodOrders.length > 0 || loadedPeriod === period ? periodOrders : orders

  // Filter orders by period usando a janela operacional oficial (05:00 - 23:59)
  // E exclusão obrigatória de pedidos neutralizados como erro de sistema
  const filteredOrders = useMemo(() => {
    const now = new Date()
    const currentWindow = getOperationalWindow(now)

    return activeOrdersPool.filter((o) => {
      // Excluir expressamente qualquer pedido neutralizado como erro de sistema de todas as métricas
      if (isNeutralizedSystemError(o)) {
        return false
      }

      if (period === 'today') {
        return isTodayOrder(o, currentWindow)
      }

      // Avalia o timestamp do pedido para intervalos semanais/mensais
      // Usando created como âncora principal (respeitando o filtro do período carregado),
      // ou timestamps de conclusão de rota se existirem.
      const relevantTs =
        parseSafeTimestamp(o.created) ||
        parseSafeTimestamp(o.route_finished_at) ||
        parseSafeTimestamp(o.actual_arrival) ||
        parseSafeTimestamp(o.route_started_at) ||
        0

      if (period === 'week') {
        const oneWeekAgo = now.getTime() - 7 * 24 * 60 * 60 * 1000
        return relevantTs >= oneWeekAgo
      }
      if (period === 'month') {
        const oneMonthAgo = now.getTime() - 30 * 24 * 60 * 60 * 1000
        return relevantTs >= oneMonthAgo
      }
      return true
    })
  }, [activeOrdersPool, period])

  // MÉTRICA 1: Resumo do Período com Regras Blindadas Rotaly
  // Total Válido = pedidos do período EXCETO erros de sistema neutralizados
  // Bem-sucedidas % = status='delivered' / total válido
  // Com Problema % = (client_absent + address_error NÃO neutralizados) / total válido
  // Canceladas % = cancelled (excluindo neutralizados) / total válido
  const summary = useMemo(() => {
    // filteredOrders já exclui isNeutralizedSystemError(o)
    const totalValido = filteredOrders.length
    const successful = filteredOrders.filter((o) => o.status === 'delivered').length
    const problem = filteredOrders.filter(
      (o) => o.status === 'address_error' || o.status === 'client_absent',
    ).length
    const cancelled = filteredOrders.filter((o) => o.status === 'cancelled').length
    const inTransit = filteredOrders.filter((o) => o.status === 'in_transit').length
    const pending = filteredOrders.filter(
      (o) => o.status === 'pending' || o.status === 'assigned',
    ).length

    const successRate = totalValido > 0 ? (successful / totalValido) * 100 : 0
    const problemRate = totalValido > 0 ? (problem / totalValido) * 100 : 0
    const cancelRate = totalValido > 0 ? (cancelled / totalValido) * 100 : 0

    return {
      total: totalValido,
      successful,
      problem,
      cancelled,
      inTransit,
      pending,
      successRate,
      problemRate,
      cancelRate,
    }
  }, [filteredOrders])

  // MÉTRICA 2: Por Entregador (Gráfico & Resumos)
  const courierStats = useMemo(() => {
    return couriers.map((courier) => {
      const courierOrders = filteredOrders.filter((o) => o.courier_id === courier.id)
      const deliveredCount = courierOrders.filter((o) => o.status === 'delivered').length
      const problemCount = courierOrders.filter(
        (o) => o.status === 'address_error' || o.status === 'client_absent',
      ).length
      const cancelledCount = courierOrders.filter((o) => o.status === 'cancelled').length
      const count = deliveredCount
      const percentOfTotal = summary.successful > 0 ? (count / summary.successful) * 100 : 0
      const totalAssignedInPeriod = courierOrders.length
      const successRate =
        totalAssignedInPeriod > 0 ? (deliveredCount / totalAssignedInPeriod) * 100 : 0

      // Calculate average time in minutes (estimated or actual arrival)
      let totalMins = 0
      let timeCount = 0
      courierOrders.forEach((o) => {
        if (o.estimated_duration_minutes) {
          totalMins += o.estimated_duration_minutes
          timeCount++
        } else if (o.created && o.actual_arrival) {
          const diffMs = new Date(o.actual_arrival).getTime() - new Date(o.created).getTime()
          const diffMins = Math.max(10, Math.min(180, Math.round(diffMs / 60000)))
          totalMins += diffMins
          timeCount++
        }
      })
      const avgTimeMinutes = timeCount > 0 ? Math.round(totalMins / timeCount) : 28

      // Simulated rating based on success rate (from 4.5 to 5.0)
      const baseRating = 4.2 + (successRate / 100) * 0.8
      const rating = Math.min(5.0, Math.max(3.8, parseFloat(baseRating.toFixed(1))))

      return {
        courier,
        count,
        deliveredCount,
        problemCount,
        cancelledCount,
        assignedCount: totalAssignedInPeriod,
        percentOfTotal: Number(percentOfTotal.toFixed(1)),
        successRate: Number(successRate.toFixed(1)),
        avgTimeMinutes,
        rating,
      }
    })
  }, [filteredOrders, summary.successful])

  // BREAKDOWN 1: VENDAS POR VENDEDOR
  // Agrupar por seller_id (com expand users), nome, nº de pedidos, faturamento total (soma total_price em R$), ticket médio e % de participação.
  const salesBySeller = useMemo(() => {
    // Agrupamento por seller_id
    const sellerMap = new Map<
      string,
      {
        sellerId: string
        sellerName: string
        sellerEmail: string
        ordersCount: number
        totalRevenue: number
      }
    >()

    // Total de faturamento do período para cálculo do % de participação
    let periodTotalRevenue = 0

    filteredOrders.forEach((order) => {
      const sellerId = order.seller_id || 'sem_vendedor'
      let sellerName = 'Não atribuído'
      let sellerEmail = ''

      if (order.expand?.seller_id) {
        sellerName = order.expand.seller_id.name || order.expand.seller_id.email || 'Vendedor'
        sellerEmail = order.expand.seller_id.email || ''
      } else if (order.seller_id) {
        const found = sellersList.find((s) => s.id === order.seller_id)
        if (found) {
          sellerName = found.name || found.email || 'Vendedor'
          sellerEmail = found.email || ''
        } else {
          sellerName = `Vendedor (${order.seller_id.slice(0, 5)})`
        }
      }

      const orderPrice =
        typeof order.total_price === 'number' && order.total_price > 0 ? order.total_price : 0
      periodTotalRevenue += orderPrice

      const entry = sellerMap.get(sellerId) || {
        sellerId,
        sellerName,
        sellerEmail,
        ordersCount: 0,
        totalRevenue: 0,
      }
      entry.ordersCount += 1
      entry.totalRevenue += orderPrice
      sellerMap.set(sellerId, entry)
    })

    const list = Array.from(sellerMap.values()).map((item) => {
      const avgTicket = item.ordersCount > 0 ? item.totalRevenue / item.ordersCount : 0
      const sharePercentage =
        periodTotalRevenue > 0 ? (item.totalRevenue / periodTotalRevenue) * 100 : 0

      return {
        ...item,
        avgTicket: Number(avgTicket.toFixed(2)),
        sharePercentage: Number(sharePercentage.toFixed(1)),
      }
    })

    // Ordenar por faturamento desc (ou pedidos desc)
    list.sort((a, b) => b.totalRevenue - a.totalRevenue || b.ordersCount - a.ordersCount)

    return {
      items: list,
      totalRevenue: periodTotalRevenue,
      totalOrders: filteredOrders.length,
    }
  }, [filteredOrders, sellersList])

  // BREAKDOWN 2: ENTREGAS POR ENTREGADOR
  // Agrupar por courier_id (expand users), nome, atribuídas, concluídas (delivered), com problema, canceladas e taxa de sucesso.
  const deliveriesByCourier = useMemo(() => {
    // Mapeia tanto os couriers passados como eventuais courier_ids encontrados nos pedidos
    const courierMap = new Map<
      string,
      {
        courierId: string
        courierName: string
        courierEmail: string
        vehicleType: string
        vehiclePlate: string
        assignedCount: number
        deliveredCount: number
        problemCount: number
        cancelledCount: number
        rawCourier?: UserRecord
      }
    >()

    // Inicializar com couriers conhecidos
    couriers.forEach((c) => {
      courierMap.set(c.id, {
        courierId: c.id,
        courierName: c.name || c.email || 'Entregador',
        courierEmail: c.email || '',
        vehicleType: c.vehicle_type || 'moto',
        vehiclePlate: c.vehicle_plate || '—',
        assignedCount: 0,
        deliveredCount: 0,
        problemCount: 0,
        cancelledCount: 0,
        rawCourier: c,
      })
    })

    // Contabilizar pedidos do período
    filteredOrders.forEach((o) => {
      const courierId = o.courier_id || 'sem_entregador'
      let entry = courierMap.get(courierId)
      if (!entry) {
        let name = 'Não atribuído'
        let email = ''
        let vehicleType = 'moto'
        let vehiclePlate = '—'
        let raw: UserRecord | undefined = undefined

        if (o.expand?.courier_id) {
          name = o.expand.courier_id.name || o.expand.courier_id.email || 'Entregador'
          email = o.expand.courier_id.email || ''
          vehicleType = o.expand.courier_id.vehicle_type || 'moto'
          vehiclePlate = o.expand.courier_id.vehicle_plate || '—'
          raw = o.expand.courier_id as unknown as UserRecord
        }
        entry = {
          courierId,
          courierName: name,
          courierEmail: email,
          vehicleType,
          vehiclePlate,
          assignedCount: 0,
          deliveredCount: 0,
          problemCount: 0,
          cancelledCount: 0,
          rawCourier: raw,
        }
        courierMap.set(courierId, entry)
      }

      entry.assignedCount += 1
      if (o.status === 'delivered') {
        entry.deliveredCount += 1
      } else if (o.status === 'address_error' || o.status === 'client_absent') {
        entry.problemCount += 1
      } else if (o.status === 'cancelled') {
        entry.cancelledCount += 1
      }
    })

    const list = Array.from(courierMap.values()).map((c) => {
      const successRate = c.assignedCount > 0 ? (c.deliveredCount / c.assignedCount) * 100 : 0
      return {
        ...c,
        successRate: Number(successRate.toFixed(1)),
      }
    })

    // Ordenar por atribuídas desc
    list.sort((a, b) => b.assignedCount - a.assignedCount)

    return list
  }, [filteredOrders])

  // BREAKDOWN 3: HISTÓRICO DE KM E COMBUSTÍVEL POR ENTREGADOR
  // Usa o motor corrigido calculateCourierFuelMetrics com deduplicação por rota única:
  // - KM e combustível SOMENTE de pedidos com status='delivered'
  // - Pedidos do mesmo ciclo route_started_at + route_finished_at contam o km/combustível da rota UMA VEZ
  // - Cancelled/client_absent/address_error nunca somam em km, combustível ou faturamento
  // - Hierarquia oficial mantida no motor: odômetro > histórico viário de rotas > telemetria GPS
  const fuelAndKmByCourier = useMemo(() => {
    return couriers.map((courier) => {
      // Invocar motor oficial de telemetria e combustível Rotaly
      const metrics = calculateCourierFuelMetrics({
        courier,
        advances: [],
        orders: filteredOrders, // contexto dos pedidos do período
        locations,
        offRouteEvents,
        settings: settings || null,
        periodFilter: 'all', // já está filtrado em filteredOrders
      })

      const isBicycle = courier.vehicle_type === 'bicicleta'
      const officialKm = metrics.totalOfficialKm
      const kmSource = metrics.calculationSourceLabel || 'Histórico Viário de Rotas'
      const totalFuel = isBicycle ? 0 : metrics.totalSpent

      return {
        courier,
        deliveredCount: metrics.deliveriesCount,
        officialKm,
        kmSource,
        totalOdometer: metrics.totalOdometerKm,
        totalRoadReturnKm: metrics.totalOfficialKm,
        deviationKm: metrics.totalDeviationKm,
        fuelCost: Number(totalFuel.toFixed(2)),
        isBicycle,
        vehicleType: courier.vehicle_type || 'moto',
        vehiclePlate: courier.vehicle_plate || '—',
      }
    })
  }, [couriers, filteredOrders, locations, offRouteEvents, settings])

  // MÉTRICA 3: Análise de Tempo (tempo médio, mínimo, máximo, horários de pico)
  const timeAnalysis = useMemo(() => {
    const times: number[] = []
    const hourlyCounts: Record<number, number> = {}

    // Init 24h
    for (let h = 8; h <= 21; h++) {
      hourlyCounts[h] = 0
    }

    filteredOrders.forEach((o) => {
      // Estimated or actual duration
      let dur = o.estimated_duration_minutes
      if (!dur && o.created && o.actual_arrival) {
        const diff = new Date(o.actual_arrival).getTime() - new Date(o.created).getTime()
        dur = Math.round(diff / 60000)
      }
      if (dur && dur > 0 && dur < 300) {
        times.push(dur)
      }

      // Hour of delivery
      if (o.created) {
        const hour = new Date(o.created).getHours()
        if (hourlyCounts[hour] !== undefined) {
          hourlyCounts[hour]++
        } else {
          hourlyCounts[hour] = 1
        }
      }
    })

    const avgTime =
      times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 32
    const minTime = times.length > 0 ? Math.min(...times) : 12
    const maxTime = times.length > 0 ? Math.max(...times) : 65

    // Find peak hour
    let peakHour = 14
    let maxHourCount = 0
    Object.entries(hourlyCounts).forEach(([h, cnt]) => {
      if (cnt > maxHourCount) {
        maxHourCount = cnt
        peakHour = parseInt(h, 10)
      }
    })

    return {
      avgTime,
      minTime,
      maxTime,
      peakHour: `${peakHour}:00 - ${peakHour + 1}:00`,
      hourlyCounts,
    }
  }, [filteredOrders])

  // MÉTRICA 4: Análise de Custo por Tipo de Veículo com KM Real Rodado (descontados desvios e paradas)
  const costAnalysis = useMemo(() => {
    let totalKm = 0
    let totalCost = 0
    // Blindagem de KM/Custo:
    // Pedidos com status de insucesso (client_absent, address_error, cancelled)
    // e pedidos com base 0,0 não imputam km/custo aos relatórios do dia.
    const UNSUCCESSFUL_STATUSES = new Set(['cancelled', 'client_absent', 'address_error'])

    const activeRouteOrders = filteredOrders.filter((o) => {
      if (UNSUCCESSFUL_STATUSES.has(o.status as string)) return false
      const baseLat = Number(o.start_base_lat) || 0
      const baseLng = Number(o.start_base_lng) || 0
      if (baseLat === 0 && baseLng === 0 && !o.start_base_name && !o.start_base_address) {
        return false
      }
      return o.status === 'delivered' || (o.route_started === true && o.status === 'in_transit')
    })

    activeRouteOrders.forEach((o) => {
      const realTelemetry = calculateRealKmForOrder({
        order: o,
        allCourierLocations: locations,
        courierEvents: offRouteEvents,
        allCourierOrders: activeOrdersPool,
      })

      const orderKm = realTelemetry.officialRealKm
      totalKm += orderKm

      const courier = couriers.find((c) => c.id === o.courier_id) || o.expand?.courier_id
      const vehicleType = courier?.vehicle_type || 'moto'
      const { pricePerLiter, consumptionKml, category } = deliveryService.getVehicleFuelParams(
        settings,
        vehicleType,
      )

      if (category !== 'bicicleta' && consumptionKml > 0 && pricePerLiter > 0) {
        totalCost += (orderKm * pricePerLiter) / consumptionKml
      }
    })

    const costPerKm = totalKm > 0 ? totalCost / totalKm : 0.16
    const avgCostPerDelivery =
      activeRouteOrders.length > 0 ? totalCost / activeRouteOrders.length : 0

    return {
      totalKm: Number(totalKm.toFixed(1)),
      costPerKm: Number(costPerKm.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      avgCostPerDelivery: Number(avgCostPerDelivery.toFixed(2)),
      activeRouteOrdersCount: activeRouteOrders.length,
    }
  }, [filteredOrders, couriers, settings, offRouteEvents, activeOrdersPool, locations])

  // MÉTRICA 5: Problemas Registrados (tipo de problema, frequência, entregador)
  const problemRecords = useMemo(() => {
    return filteredOrders
      .filter(
        (o) =>
          !isNeutralizedSystemError(o) &&
          (o.status === 'address_error' ||
            o.status === 'client_absent' ||
            o.status === 'cancelled' ||
            (o.completion_reason && o.completion_reason !== 'delivered')),
      )
      .map((o) => {
        let problemType = 'Outro Problema'
        if (o.completion_reason === 'address_error' || o.status === 'address_error') {
          problemType = 'Endereço Errado / Incompleto'
        } else if (o.completion_reason === 'client_absent' || o.status === 'client_absent') {
          problemType = 'Cliente Ausente / Não Atendeu'
        } else if (o.status === 'cancelled') {
          problemType = 'Cancelamento pelo Cliente/Loja'
        }

        const courier = couriers.find((c) => c.id === o.courier_id)

        return {
          id: o.id,
          trackingCode: o.tracking_code,
          customerName: o.expand?.customer_id?.name || 'Cliente',
          problemType,
          courierName: courier?.name || 'Não atribuído',
          date: o.created ? new Date(o.created).toLocaleDateString('pt-BR') : 'Hoje',
          notes: o.notes || 'Sem observações adicionais',
        }
      })
  }, [filteredOrders, couriers])

  // Problem frequencies summary
  const problemFrequency = useMemo(() => {
    const counts: Record<string, number> = {}
    problemRecords.forEach((p) => {
      counts[p.problemType] = (counts[p.problemType] || 0) + 1
    })
    return counts
  }, [problemRecords])

  // AÇÕES: Exportar PDF, Compartilhar, Imprimir
  const handlePrint = () => {
    window.print()
  }

  const handleExportPDF = () => {
    window.print()
    toast({
      title: 'Gerando PDF do Relatório',
      description: 'A janela de impressão permite Salvar como PDF com layout profissional.',
    })
  }

  const handleShareLink = () => {
    const url = window.location.href
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
    }
    setCopiedLink(true)
    toast({
      title: 'Link copiado!',
      description: 'O link do painel de relatórios foi copiado para a área de transferência.',
    })
    setTimeout(() => setCopiedLink(false), 2500)
  }

  return (
    <div className="space-y-6" id="reports-export-area">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <div className="flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-[#0052CC]" />
            <h1 className="font-heading text-2xl font-bold tracking-tight text-[#1a1a1a]">
              Relatórios & Inteligência Operacional Rotaly
            </h1>
          </div>
          <p className="font-sans text-sm text-slate-600">
            Análise aprofundada de desempenho, custos, tempo e ocorrências de entrega.
          </p>
        </div>

        {/* Seletor de Período e Botões de Ação */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Seletor de Período: hoje, semana, mês, personalizado */}
          <Select
            value={period}
            onValueChange={(v) => setPeriod(v as 'today' | 'week' | 'month' | 'all')}
          >
            <SelectTrigger className="h-9 w-[150px] text-xs font-semibold bg-white border-slate-200 rounded-input">
              <Calendar className="h-3.5 w-3.5 mr-1.5 text-[#0052CC]" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-white">
              <SelectItem value="today">Hoje</SelectItem>
              <SelectItem value="week">Últimos 7 dias</SelectItem>
              <SelectItem value="month">Último Mês</SelectItem>
              <SelectItem value="all">Personalizado (Todos)</SelectItem>
            </SelectContent>
          </Select>

          {/* Botão Exportar PDF */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleExportPDF}
            className="h-9 text-xs gap-1.5 font-medium border-slate-200 hover:bg-slate-50 rounded-input text-slate-700"
          >
            <Download className="h-3.5 w-3.5 text-[#E74C3C]" />
            Exportar PDF
          </Button>

          {/* Botão Compartilhar */}
          <Button
            size="sm"
            variant="outline"
            onClick={handleShareLink}
            className="h-9 text-xs gap-1.5 font-medium border-slate-200 hover:bg-slate-50 rounded-input text-slate-700"
          >
            {copiedLink ? (
              <Check className="h-3.5 w-3.5 text-[#00AA44]" />
            ) : (
              <Share2 className="h-3.5 w-3.5 text-[#0052CC]" />
            )}
            {copiedLink ? 'Copiado!' : 'Compartilhar'}
          </Button>

          {/* Botão Imprimir */}
          <Button
            size="sm"
            variant="outline"
            onClick={handlePrint}
            className="h-9 text-xs gap-1.5 font-medium border-slate-200 hover:bg-slate-50 rounded-input text-slate-700"
          >
            <Printer className="h-3.5 w-3.5 text-slate-600" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* CARD RESUMO DE DESVIOS & TELEMETRIA COM LINK EM 1 CLIQUE */}
      <div className="p-4 rounded-xl border border-amber-300 bg-amber-50/80 text-amber-950 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-lg bg-amber-500 text-white shrink-0">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h4 className="font-heading text-sm font-bold text-amber-950">
                Auditoria de Desvios de Rota &amp; Paradas (Telemetria)
              </h4>
              <Badge
                variant="outline"
                className="border-amber-400 bg-amber-100 text-amber-800 text-[10px] font-bold"
              >
                Telemetria Ativa
              </Badge>
            </div>
            <p className="font-sans text-xs text-amber-800 mt-0.5">
              Acesse a auditoria completa de trechos fora de rota (&gt;600m) e rotas parciais de
              retorno com 1 clique.
            </p>
          </div>
        </div>
        <Link
          to="/admin?tab=deviations"
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold shadow-sm transition whitespace-nowrap self-start sm:self-center"
        >
          <span>Abrir Relatório de Desvios</span>
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>

      {isLoadingPeriodOrders && (
        <div className="flex items-center justify-center p-3 rounded-lg bg-blue-50 border border-blue-200 text-[#0052CC] text-xs font-semibold gap-2 animate-pulse">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Carregando dados históricos do período selecionado diretamente do banco...</span>
        </div>
      )}

      {/* 1. RESUMO DO PERÍODO */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border border-slate-200 border-l-4 border-l-[#0052CC] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Total de Entregas
            </p>
            <p className="font-heading text-2xl font-bold text-[#1a1a1a] mt-1">{summary.total}</p>
            <p className="font-sans text-xs text-slate-500 mt-1 flex items-center gap-1">
              <span>{summary.inTransit} em rota</span> • <span>{summary.pending} pendentes</span>
            </p>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#00AA44] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Bem-Sucedidas (%)
            </p>
            <p className="font-heading text-2xl font-bold text-[#00AA44] mt-1">
              {summary.successRate.toFixed(1)}%
            </p>
            <p className="font-sans text-xs text-[#00AA44] mt-1 font-semibold">
              {summary.successful} entregas finalizadas
            </p>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#FF6B35] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Com Problema (%)
            </p>
            <p className="font-heading text-2xl font-bold text-[#FF6B35] mt-1">
              {summary.problemRate.toFixed(1)}%
            </p>
            <p className="font-sans text-xs text-[#FF6B35] mt-1 font-semibold">
              {summary.problem} ocorrências registradas
            </p>
          </CardContent>
        </Card>

        <Card className="border border-slate-200 border-l-4 border-l-[#E74C3C] bg-white shadow-brand rounded-card">
          <CardContent className="p-4">
            <p className="font-heading text-xs font-semibold text-slate-500 uppercase tracking-wider">
              Canceladas (%)
            </p>
            <p className="font-heading text-2xl font-bold text-[#E74C3C] mt-1">
              {summary.cancelRate.toFixed(1)}%
            </p>
            <p className="font-sans text-xs text-[#E74C3C] mt-1 font-semibold">
              {summary.cancelled} cancelamentos
            </p>
          </CardContent>
        </Card>
      </div>

      {/* VISUALIZAÇÃO GRÁFICA & ANÁLISES */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* GRÁFICO DE BARRAS: ENTREGAS POR ENTREGADOR */}
        <Card className="shadow-sm lg:col-span-2">
          <CardHeader className="pb-3 border-b">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-bold flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-blue-600" />
                Gráfico: Entregas por Entregador
              </CardTitle>
              <span className="text-xs text-gray-500">{couriers.length} entregadores</span>
            </div>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {courierStats.length === 0 ? (
              <p className="text-xs text-gray-400 py-6 text-center">Nenhum dado no período.</p>
            ) : (
              courierStats.map((item) => {
                const maxCount = Math.max(...courierStats.map((c) => c.count), 1)
                const barWidth = Math.max(8, Math.round((item.count / maxCount) * 100))

                return (
                  <div key={item.courier.id} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-semibold text-gray-800">
                        {item.courier.name || item.courier.email}
                      </span>
                      <div className="flex items-center gap-2 text-gray-600">
                        <span className="font-bold text-blue-600">{item.count} entregas</span>
                        <span className="text-gray-400">({item.percentOfTotal}%)</span>
                      </div>
                    </div>
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden flex">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                )
              })
            )}
          </CardContent>
        </Card>

        {/* GRÁFICO DE PIZZA / TAXA DE SUCESSO VS PROBLEMAS */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 border-b">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <PieChartIcon className="h-4 w-4 text-emerald-600" />
              Taxa de Sucesso vs Problemas
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            {/* Visual Ring Representation */}
            <div className="flex items-center justify-center p-3">
              <div className="relative w-32 h-32 rounded-full border-8 border-emerald-500 flex items-center justify-center bg-gray-50">
                <div className="text-center">
                  <p className="text-xl font-extrabold text-emerald-600">
                    {summary.successRate.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-gray-500 uppercase font-semibold">Sucesso</p>
                </div>
              </div>
            </div>

            {/* Breakdown Legend */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between p-2 rounded bg-emerald-50 text-emerald-900 border border-emerald-100">
                <span className="flex items-center gap-1.5 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                  Entregues com Sucesso
                </span>
                <b>
                  {summary.successful} ({summary.successRate.toFixed(1)}%)
                </b>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-amber-50 text-amber-900 border border-amber-100">
                <span className="flex items-center gap-1.5 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-500" />
                  Ocorrências / Problemas
                </span>
                <b>
                  {summary.problem} ({summary.problemRate.toFixed(1)}%)
                </b>
              </div>

              <div className="flex items-center justify-between p-2 rounded bg-rose-50 text-rose-900 border border-rose-100">
                <span className="flex items-center gap-1.5 font-semibold">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  Cancelamentos
                </span>
                <b>
                  {summary.cancelled} ({summary.cancelRate.toFixed(1)}%)
                </b>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 3. ANÁLISE DE TEMPO & 4. ANÁLISE DE CUSTO */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* 3. ANÁLISE DE TEMPO */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 border-b bg-blue-50/40">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-blue-950">
              <Clock className="h-4 w-4 text-blue-600" />
              3. Análise de Tempo de Entrega
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Tempo Médio:</span>
                <span className="text-xl font-bold text-blue-600">{timeAnalysis.avgTime} min</span>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Horário de Pico:</span>
                <span className="text-sm font-bold text-indigo-700">{timeAnalysis.peakHour}</span>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Tempo Mínimo:</span>
                <span className="text-base font-bold text-emerald-600">
                  {timeAnalysis.minTime} min
                </span>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Tempo Máximo:</span>
                <span className="text-base font-bold text-amber-600">
                  {timeAnalysis.maxTime} min
                </span>
              </div>
            </div>

            {/* GRÁFICO DE LINHA / HORÁRIOS DE PICO */}
            <div className="pt-2">
              <p className="text-xs font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
                <LineChartIcon className="h-3.5 w-3.5 text-blue-600" />
                Gráfico: Entregas por Hora do Dia
              </p>
              <div className="h-24 flex items-end gap-1.5 bg-gray-50 p-2 rounded-lg border">
                {Object.entries(timeAnalysis.hourlyCounts).map(([hour, count]) => {
                  const maxH = Math.max(...Object.values(timeAnalysis.hourlyCounts), 1)
                  const heightPct = Math.max(12, Math.round((count / maxH) * 100))
                  return (
                    <div
                      key={hour}
                      className="flex-1 flex flex-col items-center gap-1 h-full justify-end"
                      title={`${hour}h: ${count} entregas`}
                    >
                      <div
                        className="w-full bg-blue-500 hover:bg-blue-600 rounded-t transition-all"
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="text-[9px] text-gray-400">{hour}h</span>
                    </div>
                  )
                })}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* 4. ANÁLISE DE CUSTO */}
        <Card className="shadow-sm">
          <CardHeader className="pb-3 border-b bg-emerald-50/40">
            <CardTitle className="text-base font-bold flex items-center gap-2 text-emerald-950">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              4. Análise de Custo Operacional
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
                <span className="text-gray-500 block">Custo Médio / Entrega:</span>
                <span className="text-xl font-bold text-emerald-700">
                  R$ {costAnalysis.avgCostPerDelivery.toFixed(2)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-emerald-50/60 border border-emerald-100">
                <span className="text-gray-500 block">Custo Total do Período:</span>
                <span className="text-xl font-bold text-emerald-800">
                  R$ {costAnalysis.totalCost.toFixed(2)}
                </span>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Distância Total:</span>
                <span className="text-base font-bold text-gray-800">{costAnalysis.totalKm} km</span>
              </div>
              <div className="p-3 rounded-lg bg-gray-50 border">
                <span className="text-gray-500 block">Custo por Km Rodado:</span>
                <span className="text-base font-bold text-gray-800">
                  R$ {costAnalysis.costPerKm.toFixed(2)}/km
                </span>
              </div>
            </div>

            <div className="p-3 rounded-lg bg-gray-50 border text-xs text-gray-600 space-y-1">
              <p className="font-semibold text-gray-800">Parâmetros de Combustível:</p>
              <p>
                Preço do litro: R$ {fuelPrice.toFixed(2)} | Consumo médio: {fuelConsumption} km/L
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 2. VENDAS POR VENDEDOR */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-3 border-b bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
                <Receipt className="h-4 w-4 text-[#0052CC]" />
                Vendas por Vendedor
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Faturamento total, pedidos gerados, ticket médio e participação de cada vendedor no
                período
              </CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-xs font-semibold text-slate-600 bg-white px-2.5 py-1 rounded-md border shadow-sm">
                Faturamento Total:{' '}
                <strong className="text-emerald-700 font-mono">
                  R${' '}
                  {salesBySeller.totalRevenue.toLocaleString('pt-BR', {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </strong>
              </span>
              <span className="text-xs text-slate-500">
                {salesBySeller.items.length} vendedores
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b">
                <tr>
                  <th className="py-3 px-4">Vendedor</th>
                  <th className="py-3 px-4 text-center">Nº Pedidos</th>
                  <th className="py-3 px-4">Faturamento (R$)</th>
                  <th className="py-3 px-4">Ticket Médio</th>
                  <th className="py-3 px-4">Participação (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {salesBySeller.items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-6 text-center text-slate-400">
                      Nenhum pedido com vendedor registrado no período selecionado.
                    </td>
                  </tr>
                ) : (
                  salesBySeller.items.map((seller) => (
                    <tr key={seller.sellerId} className="hover:bg-slate-50 transition">
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        <div className="flex items-center gap-2">
                          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[#0052CC] font-bold text-xs uppercase">
                            {seller.sellerName.slice(0, 2)}
                          </div>
                          <div>
                            <span className="block font-medium">{seller.sellerName}</span>
                            {seller.sellerEmail && (
                              <span className="block text-[11px] text-slate-400 font-normal">
                                {seller.sellerEmail}
                              </span>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 font-bold text-slate-800 text-center">
                        {seller.ordersCount}
                      </td>
                      <td className="py-3 px-4 font-mono font-bold text-emerald-700">
                        R${' '}
                        {seller.totalRevenue.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-700">
                        R${' '}
                        {seller.avgTicket.toLocaleString('pt-BR', {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-[#0052CC] rounded-full"
                              style={{
                                width: `${Math.min(100, Math.max(0, seller.sharePercentage))}%`,
                              }}
                            />
                          </div>
                          <span className="font-semibold text-slate-700">
                            {seller.sharePercentage}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 3. ENTREGAS POR ENTREGADOR (BREAKDOWN COMPLETO) */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-3 border-b bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
                <Truck className="h-4 w-4 text-[#0052CC]" />
                Entregas por Entregador
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Total atribuídas, concluídas com sucesso (delivered), ocorrências com problema,
                canceladas e taxa de sucesso
              </CardDescription>
            </div>
            <span className="text-xs text-slate-500">
              {deliveriesByCourier.length} entregadores ativos
            </span>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b">
                <tr>
                  <th className="py-3 px-4">Entregador</th>
                  <th className="py-3 px-4 text-center">Atribuídas</th>
                  <th className="py-3 px-4 text-center">Concluídas</th>
                  <th className="py-3 px-4 text-center">Com Problema</th>
                  <th className="py-3 px-4 text-center">Canceladas</th>
                  <th className="py-3 px-4">Taxa de Sucesso</th>
                  <th className="py-3 px-4 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveriesByCourier.map((item) => (
                  <tr
                    key={item.courierId}
                    className="hover:bg-slate-50 cursor-pointer transition"
                    onClick={() => {
                      if (item.rawCourier) {
                        setSelectedCourierForModal(item.rawCourier)
                        setIsCourierModalOpen(true)
                      }
                    }}
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[#0052CC] font-bold text-xs uppercase">
                          {item.courierName ? item.courierName.slice(0, 2) : 'EN'}
                        </div>
                        <div>
                          <span>{item.courierName}</span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {item.vehiclePlate} • {item.vehicleType}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-bold text-slate-800 text-center">
                      {item.assignedCount}
                    </td>
                    <td className="py-3 px-4 font-bold text-emerald-700 text-center">
                      {item.deliveredCount}
                    </td>
                    <td className="py-3 px-4 font-bold text-amber-600 text-center">
                      {item.problemCount}
                    </td>
                    <td className="py-3 px-4 font-bold text-rose-600 text-center">
                      {item.cancelledCount}
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant="outline"
                        className={
                          item.successRate >= 90
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                            : item.successRate >= 70
                              ? 'bg-amber-50 text-amber-700 border-amber-300'
                              : 'bg-rose-50 text-rose-700 border-rose-300'
                        }
                      >
                        {item.successRate}%
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right">
                      {item.rawCourier && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation()
                            setSelectedCourierForModal(item.rawCourier!)
                            setIsCourierModalOpen(true)
                          }}
                          className="h-7 text-xs gap-1 border-blue-200 text-[#0052CC] hover:bg-blue-50 font-semibold"
                        >
                          <Fuel className="h-3.5 w-3.5 text-[#0052CC]" />
                          KM & Combustível
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 4. HISTÓRICO DE KM E COMBUSTÍVEL POR ENTREGADOR */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="pb-3 border-b bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base font-bold flex items-center gap-2 text-slate-900">
                <Gauge className="h-4 w-4 text-[#0052CC]" />
                Histórico de KM e Combustível por Entregador
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Hierarquia oficial de KM (Odômetro &gt; Histórico de Rota c/ Retorno &gt;
                Telemetria) e reembolso de combustível (Bicicleta = R$ 0)
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-600 bg-white px-2.5 py-1 rounded-md border shadow-sm">
                Total Período:{' '}
                <strong className="text-emerald-700 font-mono">
                  R$ {fuelAndKmByCourier.reduce((sum, c) => sum + c.fuelCost, 0).toFixed(2)}
                </strong>
              </span>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 text-slate-600 uppercase border-b">
                <tr>
                  <th className="py-3 px-4">Entregador</th>
                  <th className="py-3 px-4 text-center">Tipo / Placa</th>
                  <th className="py-3 px-4 text-center">Entregas Efetivas</th>
                  <th className="py-3 px-4">KM Oficial</th>
                  <th className="py-3 px-4">Fonte do KM</th>
                  <th className="py-3 px-4 text-right">Combustível Total (R$)</th>
                  <th className="py-3 px-4 text-right">Detalhar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {fuelAndKmByCourier.map((item) => (
                  <tr
                    key={item.courier.id}
                    className="hover:bg-slate-50 cursor-pointer transition"
                    onClick={() => {
                      setSelectedCourierForModal(item.courier)
                      setIsCourierModalOpen(true)
                    }}
                  >
                    <td className="py-3 px-4 font-semibold text-slate-900">
                      <div className="flex items-center gap-2">
                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-100 text-[#0052CC] font-bold text-xs uppercase">
                          {item.courier.name ? item.courier.name.slice(0, 2) : 'EN'}
                        </div>
                        <div>
                          <span>{item.courier.name || item.courier.email}</span>
                          <span className="block text-[10px] text-slate-400 font-normal">
                            {item.courier.email}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4 text-center">
                      <Badge variant="outline" className="text-[10px] uppercase font-semibold">
                        {item.vehicleType}
                      </Badge>
                      <span className="block text-[10px] text-slate-400 font-mono mt-0.5">
                        {item.vehiclePlate}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-bold text-slate-800">
                      {item.deliveredCount}
                    </td>
                    <td className="py-3 px-4 font-mono font-bold text-blue-700">
                      {item.officialKm.toFixed(1)} km
                    </td>
                    <td className="py-3 px-4">
                      <Badge
                        variant="outline"
                        className={
                          item.kmSource.includes('odômetro')
                            ? 'bg-purple-50 text-purple-700 border-purple-200 text-[10px]'
                            : item.kmSource.includes('viário')
                              ? 'bg-blue-50 text-blue-700 border-blue-200 text-[10px]'
                              : 'bg-slate-50 text-slate-600 border-slate-200 text-[10px]'
                        }
                      >
                        {item.kmSource}
                      </Badge>
                    </td>
                    <td className="py-3 px-4 text-right font-mono font-bold">
                      {item.isBicycle ? (
                        <span className="text-slate-400">R$ 0,00 (Bicicleta)</span>
                      ) : (
                        <span className="text-emerald-700">R$ {item.fuelCost.toFixed(2)}</span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedCourierForModal(item.courier)
                          setIsCourierModalOpen(true)
                        }}
                        className="h-7 text-xs gap-1 border-blue-200 text-[#0052CC] hover:bg-blue-50 font-semibold"
                      >
                        <Fuel className="h-3.5 w-3.5 text-[#0052CC]" />
                        Auditoria
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* 5. PROBLEMAS REGISTRADOS */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b bg-rose-50/30">
          <CardTitle className="text-base font-bold flex items-center gap-2 text-rose-950">
            <AlertTriangle className="h-4 w-4 text-rose-600" />
            5. Ocorrências e Problemas Registrados ({problemRecords.length})
          </CardTitle>
          <CardDescription className="text-xs">
            Motivo, frequência e entregador envolvido em insucessos de entrega
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-4">
          {/* Frequência por Tipo de Problema */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {Object.entries(problemFrequency).map(([type, freq]) => (
              <div key={type} className="p-3 bg-white rounded-lg border border-rose-200 shadow-sm">
                <span className="text-xs font-semibold text-gray-700 block truncate">{type}</span>
                <span className="text-xl font-bold text-rose-600 mt-1 block">
                  {freq} ocorrências
                </span>
              </div>
            ))}
          </div>

          {/* Tabela de Ocorrências */}
          {problemRecords.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">
              Nenhum problema registrado no período selecionado.
            </p>
          ) : (
            <div className="overflow-x-auto border rounded-lg">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 uppercase border-b">
                  <tr>
                    <th className="py-2.5 px-3">Código / Cliente</th>
                    <th className="py-2.5 px-3">Tipo de Problema</th>
                    <th className="py-2.5 px-3">Entregador Envolvido</th>
                    <th className="py-2.5 px-3">Data</th>
                    <th className="py-2.5 px-3">Observação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {problemRecords.map((p) => (
                    <tr key={p.id} className="hover:bg-rose-50/40">
                      <td className="py-2.5 px-3 font-mono font-bold text-gray-900">
                        {p.trackingCode}
                        <span className="block font-normal font-sans text-gray-600 text-[11px]">
                          {p.customerName}
                        </span>
                      </td>
                      <td className="py-2.5 px-3">
                        <Badge variant="destructive" className="text-[10px]">
                          {p.problemType}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-gray-800 font-medium">{p.courierName}</td>
                      <td className="py-2.5 px-3 text-gray-500">{p.date}</td>
                      <td className="py-2.5 px-3 text-gray-600 max-w-xs truncate">{p.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TABELA: DETALHES POR ENTREGA (TABELA GERAL) */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3 border-b">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Package className="h-4 w-4 text-blue-600" />
            Tabela Detalhada de Todas as Entregas do Período ({filteredOrders.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-gray-50 text-gray-500 uppercase border-b">
                <tr>
                  <th className="py-3 px-4">Código / Cliente</th>
                  <th className="py-3 px-4">Data / Hora</th>
                  <th className="py-3 px-4">Entregador</th>
                  <th className="py-3 px-4">Status Final</th>
                  <th className="py-3 px-4">Distância</th>
                  <th className="py-3 px-4">Tempo Total</th>
                  <th className="py-3 px-4 text-right">Custo Estimado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filteredOrders.slice(0, 30).map((order) => {
                  const cust = order.expand?.customer_id
                  const courier = couriers.find((c) => c.id === order.courier_id)
                  const isUnsuccessful =
                    order.status === 'client_absent' ||
                    order.status === 'address_error' ||
                    order.status === 'cancelled'
                  const baseLat = Number(order.start_base_lat) || 0
                  const baseLng = Number(order.start_base_lng) || 0
                  const isZeroBase =
                    baseLat === 0 &&
                    baseLng === 0 &&
                    !order.start_base_name &&
                    !order.start_base_address

                  const baseDist =
                    !isUnsuccessful &&
                    !isZeroBase &&
                    typeof order.distance_km === 'number' &&
                    order.distance_km > 0
                      ? order.distance_km
                      : 0
                  const returnDist =
                    !isUnsuccessful &&
                    !isZeroBase &&
                    typeof order.return_trip_km === 'number' &&
                    order.return_trip_km > 0
                      ? order.return_trip_km
                      : 0
                  const dist =
                    isUnsuccessful || isZeroBase
                      ? 0
                      : baseDist > 0 || returnDist > 0
                        ? baseDist + returnDist
                        : 4.2
                  const cost = fuelConsumption > 0 ? (dist * fuelPrice) / fuelConsumption : 0

                  return (
                    <tr key={order.id} className="hover:bg-gray-50">
                      <td className="py-3 px-4">
                        <span className="font-mono font-bold text-gray-900 block">
                          {order.tracking_code}
                        </span>
                        <span className="text-gray-500 text-[11px]">{cust?.name || 'Cliente'}</span>
                      </td>
                      <td className="py-3 px-4 text-gray-600">
                        {order.created ? new Date(order.created).toLocaleString('pt-BR') : 'Hoje'}
                      </td>
                      <td className="py-3 px-4 text-gray-800">
                        {courier?.name || 'Não atribuído'}
                      </td>
                      <td className="py-3 px-4">
                        {order.status === 'delivered' ? (
                          <Badge className="bg-emerald-500 text-white">Entregue</Badge>
                        ) : order.status === 'in_transit' ? (
                          <Badge className="bg-amber-500 text-white">Em Rota</Badge>
                        ) : order.status === 'address_error' || order.status === 'client_absent' ? (
                          <Badge variant="destructive">Problema</Badge>
                        ) : (
                          <Badge variant="outline">{order.status}</Badge>
                        )}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-700">
                        {dist.toFixed(1)} km {returnDist > 0 ? '(c/ volta)' : ''}
                      </td>
                      <td className="py-3 px-4 font-mono text-gray-700">
                        {order.estimated_duration_minutes
                          ? `${order.estimated_duration_minutes} min`
                          : '~25 min'}
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold text-emerald-700">
                        R$ {cost.toFixed(2)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* MODAL DETALHADO DO ENTREGADOR (KM, COMBUSTÍVEL, DESVIOS E PARADAS) */}
      <CourierDeliveryHistoryModal
        isOpen={isCourierModalOpen}
        onClose={() => {
          setIsCourierModalOpen(false)
          setSelectedCourierForModal(null)
        }}
        courier={selectedCourierForModal}
        orders={activeOrdersPool}
        offRouteEvents={offRouteEvents}
        locations={locations}
        settings={settings || null}
      />
    </div>
  )
}
