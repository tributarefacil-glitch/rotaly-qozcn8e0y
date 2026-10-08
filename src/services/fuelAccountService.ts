import pb from '@/lib/pocketbase/client'
import type {
  AppSettingsRecord,
  FuelAdvanceRecord,
  LocationRecord,
  MembroRecord,
  OffRouteEventRecord,
  OrderRecord,
  UserRecord,
} from '@/types/delivery'
import {
  calculateCourierFuelMetrics,
  type CourierFuelCalculationResult,
} from '@/hooks/useCourierFuelMetrics'
import { deliveryService } from '@/services/deliveryService'
import { getMatrizCompanyId } from '@/lib/companyResolver'
import {
  isAdvancePostCutoff,
  isBeforeCurrentMonthInTz,
  isCurrentMonthInTz,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'

export interface UnifiedCourierFuelAccount {
  courier: UserRecord
  totalAdvances: number
  totalRouteKm: number
  totalSpent: number
  balance: number
  advanceCount: number
  deliveriesCount: number
  advances: FuelAdvanceRecord[]
  calculationSource?: 'odometro' | 'historico_viario' | 'gps'
  metrics?: CourierFuelCalculationResult
  openingBalance?: number
  cutoffDate?: string
  periodAdvances?: number
  periodAdjustments?: number
  periodSpent?: number
  carryOverBalance?: number
  // Frente 2 & 3: Sugestão de Recarga e Métricas de 30 dias
  dailyAverage30d?: number
  spent30d?: number
  remainingDays?: number
  remainingIntervalLabel?: string
  projectionRemainingMonth?: number
  suggestedRecharge?: number
  availableBalance?: number
  reachedAlertThreshold?: boolean
}
export class FuelAccountService {
  private static instance: FuelAccountService

  public static getInstance(): FuelAccountService {
    if (!FuelAccountService.instance) {
      FuelAccountService.instance = new FuelAccountService()
    }
    return FuelAccountService.instance
  }

  /**
   * Obtém a empresa ativa com fallback automático e resiliente para a Matriz dinâmica.
   */
  async resolveActiveCompanyId(explicitCompanyId?: string): Promise<string> {
    if (explicitCompanyId && explicitCompanyId !== 'ALL') {
      return explicitCompanyId
    }
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('rotaly_active_empresa_id')
      if (stored) return stored
    }
    try {
      const matrizId = await getMatrizCompanyId()
      return matrizId || '7wo05iyvfcfh01h'
    } catch (err) {
      console.warn('[FuelAccountService] Erro ao resolver Matriz Company ID:', err)
      return '7wo05iyvfcfh01h'
    }
  }

  /**
   * Carrega os entregadores ativos de uma empresa ou de forma global com fallback em cascata.
   * NUNCA consulta a coleção inexistente 'couriers'.
   * Usa users (role='courier') cruzados com membros (papel='entregador' || papel='courier', user_id).
   */
  async getCouriers(companyId?: string): Promise<UserRecord[]> {
    const targetCompanyId = await this.resolveActiveCompanyId(companyId)
    const couriersMap = new Map<string, UserRecord>()

    // 1. Tenta carregar a partir da coleção 'membros' da empresa (campo correto: user_id)
    try {
      const members = await pb.collection<MembroRecord>('membros').getFullList({
        filter: `empresa_id = '${targetCompanyId}' && ativo = true && (papel = 'courier' || papel = 'entregador')`,
        expand: 'user_id',
        sort: '-created',
        requestKey: null,
      })

      for (const m of members) {
        const u = m.expand?.user_id as UserRecord | undefined
        if (u && u.id && (u.role === 'courier' || !u.role)) {
          couriersMap.set(u.id, {
            ...u,
            vehicle_type: u.vehicle_type || 'moto',
            status: u.status === 'inactive' ? 'inactive' : 'active',
          })
        }
      }
    } catch (err) {
      console.warn('[FuelAccountService] Falha ao listar membros entregadores:', err)
    }

    // 2. Consulta complementar na coleção users para garantir que nenhum entregador seja perdido
    try {
      const userCouriers = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'courier'",
        sort: '-created',
        requestKey: null,
      })

      // Se não for matriz, descobre membros de outras empresas para não vazar entregadores de outras filiais
      let otherCompanyUserIds = new Set<string>()
      const isMatriz =
        targetCompanyId === '7wo05iyvfcfh01h' || (await getMatrizCompanyId()) === targetCompanyId
      if (!isMatriz) {
        try {
          const otherMembers = await pb.collection<MembroRecord>('membros').getFullList({
            filter: `empresa_id != '${targetCompanyId}' && ativo = true && (papel = 'courier' || papel = 'entregador')`,
            fields: 'user_id',
            requestKey: null,
          })
          otherCompanyUserIds = new Set(otherMembers.map((m) => m.user_id))
        } catch {
          // segue tolerante
        }
      }

      for (const u of userCouriers) {
        if (!couriersMap.has(u.id)) {
          if (!isMatriz && otherCompanyUserIds.has(u.id)) {
            continue
          }
          couriersMap.set(u.id, {
            ...u,
            vehicle_type: u.vehicle_type || 'moto',
            status: u.status === 'inactive' ? 'inactive' : 'active',
          })
        }
      }
    } catch (usersErr) {
      console.warn('[FuelAccountService] Erro ao buscar users role=courier:', usersErr)
    }

    return Array.from(couriersMap.values())
  }

  /**
   * Busca adiantamentos de combustível da coleção fuel_advances com isolamento estrito e tolerante.
   * REGRAS FUNDAMENTAIS:
   * 1. NUNCA filtra fuel_advances por empresa_id (campo inexistente).
   * 2. Filtra por courier_id in (ids dos entregadores permitidos).
   * 3. Fallback em cascata: se a query filtrada falhar ou voltar vazia, busca todos os adiantamentos e filtra em memória.
   */
  async getFuelAdvances(
    courierIds?: string | string[],
    companyId?: string,
    filterInput?: string,
  ): Promise<FuelAdvanceRecord[]> {
    let targetCourierIds: string[] = []

    if (typeof courierIds === 'string' && courierIds.trim()) {
      targetCourierIds = [courierIds.trim()]
    } else if (Array.isArray(courierIds) && courierIds.length > 0) {
      targetCourierIds = courierIds.filter(Boolean)
    } else {
      // Se não foram passados courierIds específicos, obtém os entregadores da empresa ativa
      const couriers = await this.getCouriers(companyId)
      targetCourierIds = couriers.map((c) => c.id)
    }

    // Se temos IDs de entregadores alvo, monta o filtro com OR
    let filter = ''
    if (targetCourierIds.length > 0) {
      filter = targetCourierIds.map((id) => `courier_id = '${id}'`).join(' || ')
    }
    if (filterInput) {
      const sanitizedExtra = filterInput.replace(/\buser_id\b/g, 'courier_id')
      filter = filter ? `(${filter}) && (${sanitizedExtra})` : sanitizedExtra
    }

    try {
      if (filter) {
        const records = await pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
          filter,
          sort: '-date,-created',
          expand: 'courier_id,created_by',
          requestKey: null,
        })
        if (records.length > 0) {
          return records
        }
      }
    } catch (filterErr) {
      console.warn(
        '[FuelAccountService] Erro na query filtrada de fuel_advances, aplicando fallback em memória:',
        filterErr,
      )
    }

    // Fallback defensivo: busca todos os adiantamentos e filtra em memória por targetCourierIds
    try {
      const allAdvances = await pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
        sort: '-date,-created',
        expand: 'courier_id,created_by',
        requestKey: null,
      })

      if (targetCourierIds.length === 0) {
        return allAdvances
      }

      const allowedSet = new Set(targetCourierIds)
      return allAdvances.filter((adv) => adv.courier_id && allowedSet.has(adv.courier_id))
    } catch (fallbackErr) {
      console.error('[FuelAccountService] Falha crítica no fallback de fuel_advances:', fallbackErr)
      return []
    }
  }

  /**
   * Calcula o extrato e balanço financeiro de combustível para um único entregador.
   * Utiliza o motor puro e oficial calculateCourierFuelMetrics.
   */
  calculateAccountForCourier(params: {
    courier: UserRecord
    advances: FuelAdvanceRecord[]
    orders: OrderRecord[]
    settings: Partial<AppSettingsRecord> | null
    locations?: LocationRecord[]
    offRouteEvents?: OffRouteEventRecord[]
    periodFilter?: 'all' | 'month' | 'week' | 'today'
    carryOverBalance?: number
  }): UnifiedCourierFuelAccount {
    const {
      courier,
      advances,
      orders,
      settings,
      locations = [],
      offRouteEvents = [],
      periodFilter = 'all',
    } = params

    // DATA DE CORTE E SALDO DE ABERTURA OFICIAIS
    // (Se não houver cutoff_date gravado, não aplicar corte: saldo = abertura + todos movimentos)
    const cutoffDateStr = courier.cutoff_date || undefined
    const cutoffTime = cutoffDateStr ? new Date(cutoffDateStr).getTime() : 0
    const hasCutoff = Boolean(cutoffDateStr && !isNaN(cutoffTime) && cutoffTime > 0)
    const openingBalance = typeof courier.opening_balance === 'number' ? courier.opening_balance : 0

    // Filtra adiantamentos específicos deste entregador
    const courierAdvances = advances.filter((a) => a && a.courier_id === courier.id)

    // Adiantamentos e Ajustes pós-corte canônicos (ou todos se não houver cutoff):
    // REGRA DE OURO: usa SEMPRE data civil em America/Sao_Paulo (isAdvancePostCutoff).
    // Adiantamentos/Ajustes com data civil < cutoffDate NUNCA entram na lista pós-corte nem no saldo,
    // pois já estão estritamente embutidos no opening_balance.
    const postCutoffAdvances = courierAdvances.filter((a) => {
      if (a.status === 'cancelled') return false
      if (!hasCutoff) return true
      return isAdvancePostCutoff(a.date || a.created, cutoffDateStr)
    })

    // Totais pós-corte consolidados (período-independentes, para compor o Saldo canônico):
    let totalPostCutoffAdvances = 0
    let totalPostCutoffAdjustments = 0
    postCutoffAdvances.forEach((a) => {
      const amount = Number(a.amount) || 0
      if (a.entry_type === 'balance_adjustment') {
        totalPostCutoffAdjustments += amount
      } else {
        totalPostCutoffAdvances += amount
      }
    })

    // Pedidos do entregador
    const courierOrders = orders.filter((o) => o && o.courier_id === courier.id)

    // Métricas de exibição calculadas sobre os pedidos elegíveis do periodFilter selecionado
    const metrics = calculateCourierFuelMetrics({
      courier,
      advances: postCutoffAdvances,
      orders: courierOrders,
      locations,
      offRouteEvents,
      settings,
      periodFilter,
      carryOverBalance: openingBalance,
    })

    const isBicycle =
      metrics.vehicleCategory === 'bicicleta' ||
      courier.vehicle_type === 'bicicleta' ||
      courier.vehicle_type === 'bicycle'

    // Gasto do período selecionado (meramente informativo)
    const periodSpent = isBicycle ? 0 : metrics.totalSpent

    // GASTO PÓS-CORTE CANÔNICO PARA O SALDO:
    // Saldo é SEMPRE período-independente: opening_balance + totalPostCutoffAdvances − totalPostCutoffSpent.
    // Pedidos >= cutoffTime calculados com periodFilter 'all'.
    // calculateCourierFuelMetrics já computa e consolida o saldo e gasto canônico internamente (com isPostCutoffComputation de guarda).
    let postCutoffSpent = 0
    if (!isBicycle) {
      if (!hasCutoff) {
        if (periodFilter === 'all') {
          postCutoffSpent = metrics.totalSpent
        } else {
          const allTimeMetrics = calculateCourierFuelMetrics({
            courier,
            advances: postCutoffAdvances,
            orders: courierOrders,
            locations,
            offRouteEvents,
            settings,
            periodFilter: 'all',
            carryOverBalance: openingBalance,
            isPostCutoffComputation: true,
          })
          postCutoffSpent = allTimeMetrics.totalSpent
        }
      } else {
        const postCutoffOrdersList = courierOrders.filter((o) => {
          const orderDateVal = o.route_finished_at || o.actual_arrival || o.created
          const orderTs = new Date(orderDateVal).getTime()
          return orderTs >= cutoffTime
        })

        if (postCutoffOrdersList.length > 0) {
          const postCutoffMetrics = calculateCourierFuelMetrics({
            courier,
            advances: postCutoffAdvances,
            orders: postCutoffOrdersList,
            locations,
            offRouteEvents,
            settings,
            periodFilter: 'all',
            carryOverBalance: openingBalance,
            isPostCutoffComputation: true,
          })
          postCutoffSpent = postCutoffMetrics.totalSpent
        }
      }
    }

    // FÓRMULA ÚNICA E INVARIANTE DO SALDO:
    // balance = opening_balance + totalPostCutoffAdvances + totalPostCutoffAdjustments − postCutoffSpent
    const finalBalance = Number(
      (
        openingBalance +
        totalPostCutoffAdvances +
        totalPostCutoffAdjustments -
        postCutoffSpent
      ).toFixed(2),
    )

    // Parcelas informativas do período selecionado (para exibição em colunas/cards quando aplicável)
    const periodAdvances = Number((metrics.periodAdvances ?? totalPostCutoffAdvances).toFixed(2))
    const periodAdjustments = Number(
      (metrics.periodAdjustments ?? totalPostCutoffAdjustments).toFixed(2),
    )

    // Sincronizar o objeto metrics interno para carregar o saldo oficial invariante
    metrics.balance = finalBalance
    metrics.totalAdvances = Number(
      (totalPostCutoffAdvances + totalPostCutoffAdjustments).toFixed(2),
    )
    metrics.advanceCount = postCutoffAdvances.length
    if (metrics.fuelAccount) {
      metrics.fuelAccount.balance = finalBalance
      metrics.fuelAccount.totalAdvances = Number(
        (totalPostCutoffAdvances + totalPostCutoffAdjustments).toFixed(2),
      )
      metrics.fuelAccount.advanceCount = postCutoffAdvances.length
      metrics.fuelAccount.totalSpent = periodSpent
      metrics.fuelAccount.deliveriesCount =
        metrics.totalOfficialKm > 0 || metrics.orderCalculations.length > 0
          ? metrics.orderCalculations.length
          : metrics.deliveriesCount
    }

    // FRENTE 2 & 3: Média dos últimos 30 dias, projeção até fim do mês civil e sugestão de recarga
    let dailyAverage30d = 0
    let spent30d = 0
    let remainingDays = 0
    let remainingIntervalLabel = ''
    let projectionRemainingMonth = 0
    let suggestedRecharge = 0
    const availableBalance = Number((openingBalance + totalPostCutoffAdvances).toFixed(2))

    if (!isBicycle) {
      const now = new Date()
      const window30dStartTs = now.getTime() - 30 * 24 * 3600000

      // Pedidos dos últimos 30 dias corridos
      const orders30d = courierOrders.filter((o) => {
        const orderDateVal = o.route_finished_at || o.actual_arrival || o.created
        const orderTs = new Date(orderDateVal).getTime()
        return orderTs >= window30dStartTs
      })

      if (orders30d.length > 0) {
        const metrics30d = calculateCourierFuelMetrics({
          courier,
          advances: postCutoffAdvances,
          orders: orders30d,
          locations,
          offRouteEvents,
          settings,
          periodFilter: 'all',
          carryOverBalance: openingBalance,
          isPostCutoffComputation: true,
        })
        spent30d = metrics30d.totalSpent
      }

      dailyAverage30d = Number((spent30d / 30).toFixed(2))

      // Calendário operacional civil (America/Sao_Paulo)
      // Se hora < 5 da manhã, dia operacional é o dia anterior
      const spTimeParts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        hour12: false,
      }).formatToParts(now)

      const partMap: Record<string, number> = {}
      spTimeParts.forEach((p) => {
        if (p.type !== 'literal') partMap[p.type] = Number(p.value)
      })

      let spDay = partMap.day || now.getDate()
      const spMonth = partMap.month || now.getMonth() + 1
      const spYear = partMap.year || now.getFullYear()
      const spHour = partMap.hour !== undefined ? partMap.hour : now.getHours()

      if (spHour < 5) {
        const prevDay = new Date(now.getTime() - 24 * 3600000)
        const prevParts = new Intl.DateTimeFormat('pt-BR', {
          timeZone: 'America/Sao_Paulo',
          day: 'numeric',
        }).formatToParts(prevDay)
        const prevDayPart = prevParts.find((p) => p.type === 'day')
        if (prevDayPart) spDay = Number(prevDayPart.value)
      }

      const lastDayOfMonth = new Date(spYear, spMonth, 0).getDate()
      remainingDays = Math.max(0, lastDayOfMonth - spDay)
      const nextDayNum = Math.min(spDay + 1, lastDayOfMonth)
      const nextDayStr = `${String(nextDayNum).padStart(2, '0')}/${String(spMonth).padStart(2, '0')}`
      const lastDayStr = `${String(lastDayOfMonth).padStart(2, '0')}/${String(spMonth).padStart(2, '0')}`
      remainingIntervalLabel = `${nextDayStr} a ${lastDayStr} • ${remainingDays} dia${remainingDays === 1 ? '' : 's'}`

      projectionRemainingMonth = Number((dailyAverage30d * remainingDays).toFixed(2))
      suggestedRecharge = Math.max(0, Number((projectionRemainingMonth - finalBalance).toFixed(2)))
    }

    // Gatilho do alerta: gasto >= 80% do saldo disponibilizado (saldo <= 20% do disponibilizado) ou saldo < 0
    let reachedAlertThreshold = false
    if (finalBalance < 0) {
      reachedAlertThreshold = true
    } else if (availableBalance > 0) {
      if (postCutoffSpent >= availableBalance * 0.8 || finalBalance <= availableBalance * 0.2) {
        reachedAlertThreshold = true
      }
    } else if (postCutoffSpent > 0) {
      reachedAlertThreshold = true
    }

    return {
      courier,
      totalAdvances: Number((totalPostCutoffAdvances + totalPostCutoffAdjustments).toFixed(2)),
      totalRouteKm: metrics.totalOfficialKm,
      totalSpent: periodSpent,
      balance: finalBalance,
      advanceCount: postCutoffAdvances.length,
      deliveriesCount: metrics.deliveriesCount,
      advances: courierAdvances,
      calculationSource: metrics.calculationSource,
      metrics,
      openingBalance,
      cutoffDate: cutoffDateStr,
      periodAdvances,
      periodAdjustments,
      periodSpent,
      carryOverBalance: openingBalance,
      dailyAverage30d,
      spent30d,
      remainingDays,
      remainingIntervalLabel,
      projectionRemainingMonth,
      suggestedRecharge,
      availableBalance,
      reachedAlertThreshold,
    }
  }

  /**
   * Computa o carry-over de conta corrente acumulado até o mês anterior.
   * Regra inviolável:
   * "O saldo dos entregadores sempre é levado para o próximo mês, saldo negativo ou positivo de conta corrente.
   *  O km sempre será calculado dentro do mês fechado."
   *
   * carryOverBalance = (adiantamentos acumulados até antes do mês atual) - (combustível das rotas até antes do mês atual)
   */
  calculateCarryOverBalance(params: {
    courierId: string
    courierVehicleType?: string
    advances: FuelAdvanceRecord[]
    orders: OrderRecord[]
    settings: Partial<AppSettingsRecord> | null
    referenceDate?: Date
  }): number {
    const {
      courierId,
      courierVehicleType,
      advances,
      orders,
      settings,
      referenceDate = new Date(),
    } = params

    // 1. Adiantamentos ativos até o mês anterior (fuso America/Sao_Paulo)
    // Cancelados são desconsiderados no saldo
    const pastAdvances = advances.filter((a) => {
      if (a.courier_id !== courierId) return false
      if (a.status === 'cancelled') return false
      const advRaw = a.date || a.created
      return isBeforeCurrentMonthInTz(advRaw, referenceDate)
    })
    const pastAdvancesTotal = pastAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

    // 2. Pedidos até o mês anterior (fuso America/Sao_Paulo)
    const pastOrders = orders.filter((o) => {
      if (o.courier_id !== courierId) return false
      const oDateVal = o.route_finished_at || o.actual_arrival || o.created
      return isBeforeCurrentMonthInTz(oDateVal, referenceDate)
    })

    if (pastOrders.length === 0) {
      return Number(pastAdvancesTotal.toFixed(2))
    }

    // Gasto histórico vem SEMPRE do motor oficial (calculateCourierFuelMetrics):
    // km viário por lote, rateio, dedup 45 min, aprovações, parâmetros app_settings.
    // Soma de fuel_cost gravado por pedido NÃO é mais fonte.
    // Fórmula única de saldo: adiantamentos + ajustes − gasto oficial.
    const courierObj = { id: courierId, vehicle_type: courierVehicleType } as UserRecord
    const pastMetrics = calculateCourierFuelMetrics({
      courier: courierObj,
      advances: pastAdvances,
      orders: pastOrders,
      locations: [],
      offRouteEvents: [],
      settings,
      periodFilter: 'all',
      carryOverBalance: 0,
    })
    const pastSpentTotal = pastMetrics.vehicleCategory === 'bicicleta' ? 0 : pastMetrics.totalSpent

    return Number((pastAdvancesTotal - pastSpentTotal).toFixed(2))
  }

  /**
   * Carrega todos os dados necessários e calcula a conta corrente de um entregador individual
   * (usado diretamente pelo app do entregador).
   */
  async getCourierSingleAccount(
    courierId: string,
    periodFilter: 'all' | 'month' | 'week' | 'today' = 'month',
  ): Promise<UnifiedCourierFuelAccount | null> {
    try {
      // 1. Carrega dados do entregador
      let courierUser: UserRecord | null = null
      try {
        courierUser = await pb.collection<UserRecord>('users').getOne(courierId, {
          requestKey: null,
        })
      } catch (userErr) {
        console.warn(`[FuelAccountService] Erro ao buscar user courier ${courierId}:`, userErr)
        const authUser = pb.authStore.record as UserRecord | null
        if (authUser && authUser.id === courierId) {
          courierUser = authUser
        }
      }

      if (!courierUser) {
        return null
      }

      // 2. Carrega concorrentemente adiantamentos, pedidos, configurações, locais e desvios do entregador
      const [advances, orders, settings, locations, offRouteEvents] = await Promise.all([
        this.getFuelAdvances(courierId),
        pb
          .collection<OrderRecord>('orders')
          .getFullList({
            filter: `courier_id = '${courierId}'`,
            sort: '-created',
            expand: 'customer_id,courier_id,seller_id',
            requestKey: null,
          })
          .catch((err) => {
            console.warn('[FuelAccountService] Erro ao buscar orders do courier:', err)
            return [] as OrderRecord[]
          }),
        pb
          .collection<AppSettingsRecord>('app_settings')
          .getFirstListItem("key = 'global_settings'", { requestKey: null })
          .catch(async () => {
            try {
              return await deliveryService.getSettings()
            } catch {
              return null
            }
          }),
        pb
          .collection<LocationRecord>('locations')
          .getFullList({
            filter: `user_id = '${courierId}'`,
            sort: '-created',
            requestKey: null,
          })
          .catch(() => [] as LocationRecord[]),
        pb
          .collection<OffRouteEventRecord>('off_route_events')
          .getFullList({
            filter: `courier_id = '${courierId}'`,
            sort: '-created',
            requestKey: null,
          })
          .catch(() => [] as OffRouteEventRecord[]),
      ])

      return this.calculateAccountForCourier({
        courier: courierUser,
        advances,
        orders,
        settings,
        locations,
        offRouteEvents,
        periodFilter,
      })
    } catch (err) {
      console.error('[FuelAccountService] Erro ao obter conta única do courier:', err)
      return null
    }
  }

  /**
   * Carrega todas as contas correntes de entregadores da empresa em lote (para Admin e Seller).
   */
  async getAllCourierFuelAccounts(params?: {
    companyId?: string
    ordersPool?: OrderRecord[]
    periodFilter?: 'all' | 'month' | 'week' | 'today'
  }): Promise<UnifiedCourierFuelAccount[]> {
    const { companyId, ordersPool, periodFilter = 'month' } = params || {}
    const targetCompanyId = await this.resolveActiveCompanyId(companyId)

    const couriers = await this.getCouriers(targetCompanyId)
    if (couriers.length === 0) {
      return []
    }

    const courierIds = couriers.map((c) => c.id)

    const [advances, settings, locations, offRouteEvents] = await Promise.all([
      this.getFuelAdvances(courierIds, targetCompanyId),
      pb
        .collection<AppSettingsRecord>('app_settings')
        .getFirstListItem("key = 'global_settings'", { requestKey: null })
        .catch(async () => {
          try {
            return await deliveryService.getSettings()
          } catch {
            return null
          }
        }),
      pb
        .collection<LocationRecord>('locations')
        .getFullList({
          sort: '-created',
          requestKey: null,
        })
        .catch(() => [] as LocationRecord[]),
      pb
        .collection<OffRouteEventRecord>('off_route_events')
        .getFullList({
          sort: '-created',
          requestKey: null,
        })
        .catch(() => [] as OffRouteEventRecord[]),
    ])

    // Se já foi passado um pool de pedidos histórico, utiliza-o; caso contrário busca pedidos
    let effectiveOrders = ordersPool
    if (!effectiveOrders || effectiveOrders.length === 0) {
      try {
        effectiveOrders = await pb.collection<OrderRecord>('orders').getFullList({
          sort: '-created',
          expand: 'customer_id,courier_id,seller_id',
          requestKey: null,
        })
      } catch (err) {
        console.warn('[FuelAccountService] Erro ao carregar pedidos para contas:', err)
        effectiveOrders = []
      }
    }

    return couriers.map((courier) =>
      this.calculateAccountForCourier({
        courier,
        advances,
        orders: effectiveOrders || [],
        settings,
        locations,
        offRouteEvents,
        periodFilter,
      }),
    )
  }

  /**
   * Aciona manualmente a verificação de saldo de combustível no backend
   * (mesma lógica executada diariamente pelo cron job daily_fuel_balance_check).
   */
  public async triggerFuelBalanceCheck(): Promise<{
    success: boolean
    date?: string
    processed?: number
    alertsSent?: number
    details?: Array<Record<string, unknown>>
    error?: string
  }> {
    try {
      const result = await pb.send<{
        success: boolean
        date?: string
        processed?: number
        alertsSent?: number
        details?: Array<Record<string, unknown>>
        error?: string
      }>('/backend/v1/fuel-balance/check-now', {
        method: 'POST',
      })
      return result
    } catch (err) {
      console.error('[FuelAccountService] Erro ao disparar verificação de saldo:', err)
      throw err
    }
  }
}

export const fuelAccountService = FuelAccountService.getInstance()
