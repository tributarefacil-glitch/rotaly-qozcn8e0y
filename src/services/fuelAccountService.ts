import pb from '@/lib/pocketbase/client'
import type {
  AppSettingsRecord,
  FuelAdvanceRecord,
  FuelBalanceAlertRecord,
  LocationRecord,
  MembroRecord,
  OffRouteEventRecord,
  OrderRecord,
  UserRecord,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'
import {
  calculateCourierFuelMetrics,
  type CourierFuelCalculationResult,
} from '@/hooks/useCourierFuelMetrics'
import { deliveryService } from '@/services/deliveryService'
import { calculateCanonicalCourierTotals } from '@/services/canonicalCourierTotalsService'
import { getMatrizCompanyId } from '@/lib/companyResolver'
import {
  getCivilDateKeyInTz,
  isAdvancePostCutoff,
  isBeforeCurrentMonthInTz,
  isCurrentMonthInTz,
  parseSafeTimestamp,
} from '@/lib/operationalWindow'
import { groupOrdersByRouteBatch } from '@/lib/routeBatchHelper'

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
  averageLabel?: string
  hasManualAdjustment?: boolean
  manualAdjustmentKm?: number
  manualAdjustmentFuelCost?: number
  manualAdjustmentDeltaKm?: number
  manualAdjustmentPeriodLabel?: string
  rawOfficialKmBeforeAdjustment?: number
  // Derivados de Pagamento de Combustível (10% desconto a partir de 26/10):
  km_pagamento?: number
  combustivel_pagamento?: number
  desconto_km?: number
  desconto_combustivel?: number
  todayAlertSent?: {
    id: string
    alert_date: string
    balance: number
    monthly_spent: number
    monthly_average: number
    suggested_recharge: number
    recipient_email?: string
    status: 'sent' | 'failed'
    notes?: string
    created: string
  } | null
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
    approvalsMap?: Map<
      string,
      { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
    >
    activeBaseCoords?: { lat: number; lng: number } | null
    allPostCutoffOrders?: OrderRecord[]
    telemetryBatches?: RouteBatchTelemetryRecord[]
  }): UnifiedCourierFuelAccount {
    const {
      courier,
      advances,
      orders,
      settings,
      locations = [],
      offRouteEvents = [],
      periodFilter = 'all',
      approvalsMap,
      activeBaseCoords,
      allPostCutoffOrders,
      telemetryBatches = [],
    } = params

    // GUARDA DE ENTRADA (REGRA DE OURO, v0.0.464):
    // Nenhum entregador nulo/sem id pode derrubar a tela com "Cannot read properties of null (reading 'id')".
    // Registro inválido retorna conta zerada segura (km 0, gasto 0, saldos 0) sem lançar exceção.
    if (!courier || !courier.id) {
      console.warn(
        '[FuelAccountService] calculateAccountForCourier ignorado: entregador nulo ou sem id.',
      )
      const safeZeroAccount: UnifiedCourierFuelAccount = {
        courier: (courier || ({} as UserRecord)) as UserRecord,
        totalAdvances: 0,
        totalRouteKm: 0,
        totalSpent: 0,
        balance: 0,
        advanceCount: 0,
        deliveriesCount: 0,
        advances: [],
        calculationSource: 'historico_viario',
        openingBalance: 0,
        cutoffDate: undefined,
        periodAdvances: 0,
        periodAdjustments: 0,
        periodSpent: 0,
        carryOverBalance: 0,
        dailyAverage30d: 0,
        spent30d: 0,
        remainingDays: 0,
        remainingIntervalLabel: '',
        projectionRemainingMonth: 0,
        suggestedRecharge: 0,
        availableBalance: 0,
        reachedAlertThreshold: false,
        averageLabel: 'Média 0d (registro inválido ignorado)',
        km_pagamento: 0,
        combustivel_pagamento: 0,
        desconto_km: 0,
        desconto_combustivel: 0,
      }
      return safeZeroAccount
    }

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
    // Regra 1a: totalAdvances deve somar SOMENTE registros com entry_type === 'advance'
    // (ou entry_type vazio/ausente por retrocompatibilidade) E status !== 'cancelled'.
    // Excluir toda entrada entry_type === 'balance_adjustment'.
    let totalPostCutoffAdvances = 0
    let totalPostCutoffAdjustments = 0
    postCutoffAdvances.forEach((a) => {
      const amount = Number(a.amount) || 0
      if (a.entry_type === 'balance_adjustment') {
        totalPostCutoffAdjustments += amount
      } else if (!a.entry_type || a.entry_type === 'advance') {
        totalPostCutoffAdvances += amount
      }
    })

    // Pedidos do entregador
    const courierOrders = orders.filter((o) => o && o.courier_id === courier.id)

    // FONTE ÚNICA: Obter totais canônicos auditados via calculateCanonicalCourierTotals
    // dedup 1x por route_batch_key, respeitando telemetria oficial e regra do MENOR
    const fullOrderPool =
      allPostCutoffOrders && allPostCutoffOrders.length > 0
        ? allPostCutoffOrders.filter((o) => o && o.courier_id === courier.id)
        : courierOrders

    const canonicalTotals = calculateCanonicalCourierTotals({
      courier,
      telemetryBatches,
      orders: fullOrderPool,
      advances: postCutoffAdvances,
      settings,
      periodFilter,
      approvalsMap,
    })

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
      approvalsMap,
      activeBaseCoords,
      telemetryBatches,
    })

    const isBicycle =
      metrics.vehicleCategory === 'bicicleta' ||
      courier.vehicle_type === 'bicicleta' ||
      courier.vehicle_type === 'bicycle'
    // v0.0.464: entregador sem veículo definido NUNCA derruba o cálculo — trata como 'moto' (padrão).
    if (!courier.vehicle_type) {
      console.warn(
        `[FuelAccountService] Entregador ${courier.id} sem vehicle_type; tratando como 'moto'.`,
      )
    }

    // Alinhar métricas com a FONTE ÚNICA CANÔNICA
    metrics.totalOfficialKm = canonicalTotals.totalOfficialKm
    metrics.totalSpent = canonicalTotals.totalSpent
    metrics.balance = canonicalTotals.balance
    metrics.totalAdvances = canonicalTotals.postCutoffAdvances
    metrics.totalDeviationKm = 0

    const periodSpent = canonicalTotals.totalSpent
    const postCutoffSpent = canonicalTotals.postCutoffSpent
    // REGRA DO USUÁRIO: NÃO alterar saldo conta corrente, total adiantado nem pagamentos.
    // O saldo de conta corrente pós-corte deve permanecer intacto (openingBalance + adiantamentos - gasto pós-corte não alterado pelo ajuste).
    const finalBalance = canonicalTotals.balance

    // Parcelas informativas do período selecionado (para exibição em colunas/cards quando aplicável)
    const periodAdvances = Number((metrics.periodAdvances ?? totalPostCutoffAdvances).toFixed(2))
    const periodAdjustments = Number(
      (metrics.periodAdjustments ?? totalPostCutoffAdjustments).toFixed(2),
    )

    // Sincronizar o objeto metrics interno para carregar o saldo oficial invariante
    metrics.balance = finalBalance
    metrics.totalAdvances = Number(totalPostCutoffAdvances.toFixed(2))
    metrics.advanceCount = postCutoffAdvances.filter(
      (a) => !a.entry_type || a.entry_type === 'advance',
    ).length
    if (metrics.fuelAccount) {
      metrics.fuelAccount.balance = finalBalance
      metrics.fuelAccount.totalAdvances = Number(totalPostCutoffAdvances.toFixed(2))
      metrics.fuelAccount.advanceCount = postCutoffAdvances.filter(
        (a) => !a.entry_type || a.entry_type === 'advance',
      ).length
      metrics.fuelAccount.totalSpent = periodSpent
      metrics.fuelAccount.deliveriesCount =
        metrics.totalOfficialKm > 0 || metrics.orderCalculations.length > 0
          ? metrics.orderCalculations.length
          : metrics.deliveriesCount
    }

    // FRENTE 2 & 3: Média diária (30d ou janela disponível real), projeção até fim do mês civil e sugestão de recarga
    // Regra 1c: dailyAverage30d: dividir o gasto da janela REAL de 30 dias por 30.
    // Se a janela disponível for menor (ex.: 7 dias), rotular o card como "Média 7d" — nunca dividir gasto de 7 dias por 30.
    // Regra 1d: suggestedRecharge: max(0, projeçãoRestanteDoMês − finalBalance). Com saldo 220,99 → R$ 0,00, badge verde "Crédito Disponível".
    let dailyAverage30d = 0
    let spent30d = 0
    let remainingDays = 0
    let remainingIntervalLabel = ''
    let projectionRemainingMonth = 0
    let suggestedRecharge = 0
    let averageLabel = 'Média 30d'
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

      // Filtragem de lotes dos últimos 30 dias:
      // Excluir:
      // 1. Pedidos com aprovação pending/rejected em route_km_approvals (approvalsMap).
      // 2. Lotes com reconciliation_diff_pct > 30 (entre telemetria GPS e trajeto viário).
      const batches30d = groupOrdersByRouteBatch(orders30d, courier.id)
      let excludedBatchesDiff30 = 0
      let excludedOrdersApprovalPendingOrRejected = 0
      const eligibleOrders30d: OrderRecord[] = []

      batches30d.forEach((batchOrders) => {
        // Filtrar pedidos do lote que possuem aprovação pendente ou rejeitada
        const validBatchOrders: OrderRecord[] = []
        for (const ord of batchOrders) {
          const app = approvalsMap?.get(ord.id)
          if (app && (app.status === 'pending' || app.status === 'rejected')) {
            excludedOrdersApprovalPendingOrRejected++
            continue
          }
          validBatchOrders.push(ord)
        }

        if (validBatchOrders.length === 0) {
          return
        }

        // Checar desvio do lote (reconciliation_diff_pct > 30):
        // Trajeto viário vs Telemetria GPS (se disponível)
        const maxRoadKmInBatch = validBatchOrders.reduce((max, ord) => {
          const roadKm =
            typeof ord.total_route_with_return_km === 'number' ? ord.total_route_with_return_km : 0
          return Math.max(max, roadKm)
        }, 0)

        // Odômetro ou GPS no lote
        let batchGpsKm = 0
        validBatchOrders.forEach((ord) => {
          if (typeof ord.km_real_rodado === 'number' && ord.km_real_rodado > 0) {
            batchGpsKm = Math.max(batchGpsKm, ord.km_real_rodado)
          } else if (typeof ord.km_odometro === 'number' && ord.km_odometro > 0) {
            batchGpsKm += ord.km_odometro
          }
        })

        // Se há trajeto viário e telemetria GPS, computa a divergência percentual
        if (maxRoadKmInBatch > 0 && batchGpsKm > 0) {
          const diffPct = Math.round(
            (Math.abs(batchGpsKm - maxRoadKmInBatch) / maxRoadKmInBatch) * 100,
          )
          if (diffPct > 30) {
            excludedBatchesDiff30++
            return // Exclui o lote da média
          }
        }

        validBatchOrders.forEach((vo) => eligibleOrders30d.push(vo))
      })

      if (eligibleOrders30d.length > 0) {
        const metrics30d = calculateCourierFuelMetrics({
          courier,
          advances: postCutoffAdvances,
          orders: eligibleOrders30d,
          locations,
          offRouteEvents,
          settings,
          periodFilter: 'all',
          carryOverBalance: openingBalance,
          approvalsMap,
          activeBaseCoords,
          isPostCutoffComputation: true,
          telemetryBatches,
        })
        spent30d = metrics30d.totalSpent

        // Denominador: apenas dias civis de Brasília (getCivilDateKeyInTz) com pelo menos 1 lote auditado elegível.
        // Dias com 0 km são folga da escala 12x36 e ficam FORA da média.
        const workedCivilDaysSet = new Set<string>()
        eligibleOrders30d.forEach((o) => {
          const oDateVal = o.route_finished_at || o.actual_arrival || o.created
          const civilKey = getCivilDateKeyInTz(oDateVal)
          if (civilKey) {
            workedCivilDaysSet.add(civilKey)
          }
        })

        const workedDaysCount = workedCivilDaysSet.size

        // Amplitude total da janela observada em dias civis (máx 30)
        const oldestOrderTs = eligibleOrders30d.reduce((minTs, o) => {
          const t = new Date(o.route_finished_at || o.actual_arrival || o.created).getTime()
          return t < minTs ? t : minTs
        }, now.getTime())
        const elapsedCalendarDays = Math.min(
          30,
          Math.max(1, Math.ceil((now.getTime() - oldestOrderTs) / (24 * 3600000))),
        )
        const daysOff12x36 = Math.max(0, elapsedCalendarDays - workedDaysCount)

        if (workedDaysCount > 0 && spent30d > 0) {
          dailyAverage30d = Number((spent30d / workedDaysCount).toFixed(2))

          const exclusionNotes: string[] = []
          if (daysOff12x36 > 0) {
            exclusionNotes.push(`${daysOff12x36} folga${daysOff12x36 > 1 ? 's' : ''} 12x36`)
          }
          if (excludedBatchesDiff30 > 0) {
            exclusionNotes.push(
              `${excludedBatchesDiff30} lote${excludedBatchesDiff30 > 1 ? 's' : ''} desvio >30% excluído${excludedBatchesDiff30 > 1 ? 's' : ''}`,
            )
          }
          if (excludedOrdersApprovalPendingOrRejected > 0) {
            exclusionNotes.push(
              `${excludedOrdersApprovalPendingOrRejected} pedido${excludedOrdersApprovalPendingOrRejected > 1 ? 's' : ''} pend/rejeit`,
            )
          }

          if (exclusionNotes.length > 0) {
            averageLabel = `Média ${workedDaysCount}d trab (${exclusionNotes.join(', ')})`
          } else {
            averageLabel = `Média ${workedDaysCount}d trab`
          }
        } else {
          // Se não sobrar dia elegível, dailyAverage = 0 (não dispara)
          dailyAverage30d = 0
          averageLabel = 'Média 0d (sem dias elegíveis)'
        }
      } else {
        dailyAverage30d = 0
        averageLabel = 'Média 0d (sem pedidos elegíveis)'
      }

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
      // Fórmula canônica do hook pocketbase/hooks/fuel_balance_alert.js:
      // const rawRecharge = Number((dailyAverage - periodSpent).toFixed(2));
      // const suggestedRecharge = rawRecharge < 0 ? 0 : (rawRecharge > dailyAverage ? dailyAverage : rawRecharge)
      const rawRecharge = Number((dailyAverage30d - periodSpent).toFixed(2))
      suggestedRecharge =
        rawRecharge < 0 ? 0 : rawRecharge > dailyAverage30d ? dailyAverage30d : rawRecharge
      suggestedRecharge = Number(suggestedRecharge.toFixed(2))
    }

    // Gatilho do alerta: configurável via app_settings.extra.fuel_alert_threshold_pct (padrão 80)
    let thresholdPct = 80
    if (settings && settings.extra && typeof settings.extra === 'object') {
      const customPct = Number((settings.extra as Record<string, unknown>).fuel_alert_threshold_pct)
      if (!isNaN(customPct) && customPct > 0 && customPct <= 100) {
        thresholdPct = customPct
      }
    }
    const triggerHighRatio = thresholdPct / 100
    const triggerLowRatio = (100 - thresholdPct) / 100

    let reachedAlertThreshold = false
    if (finalBalance < 0) {
      reachedAlertThreshold = true
    } else if (availableBalance > 0) {
      if (
        postCutoffSpent >= availableBalance * triggerHighRatio ||
        finalBalance <= availableBalance * triggerLowRatio
      ) {
        reachedAlertThreshold = true
      }
    } else if (postCutoffSpent > 0) {
      reachedAlertThreshold = true
    }

    const realAdvancesCount = postCutoffAdvances.filter(
      (a) => !a.entry_type || a.entry_type === 'advance',
    ).length

    return {
      courier,
      totalAdvances: Number(totalPostCutoffAdvances.toFixed(2)),
      totalRouteKm: metrics.totalOfficialKm,
      totalSpent: periodSpent,
      balance: finalBalance,
      advanceCount: realAdvancesCount,
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
      averageLabel,
      hasManualAdjustment: canonicalTotals.hasManualAdjustment,
      manualAdjustmentKm: canonicalTotals.manualAdjustmentKm,
      manualAdjustmentFuelCost: canonicalTotals.manualAdjustmentFuelCost,
      manualAdjustmentDeltaKm: canonicalTotals.manualAdjustmentDeltaKm,
      manualAdjustmentPeriodLabel: canonicalTotals.manualAdjustmentPeriodLabel,
      rawOfficialKmBeforeAdjustment: canonicalTotals.rawOfficialKmBeforeAdjustment,
      km_pagamento: canonicalTotals.km_pagamento,
      combustivel_pagamento: canonicalTotals.combustivel_pagamento,
      desconto_km: canonicalTotals.desconto_km,
      desconto_combustivel: canonicalTotals.desconto_combustivel,
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
  /**
   * Obtém os alertas de saldo enviados hoje civil (America/Sao_Paulo) para paridade com o painel.
   */
  async getTodayAlerts(courierIds?: string[]): Promise<Map<string, FuelBalanceAlertRecord>> {
    const alertMap = new Map<string, FuelBalanceAlertRecord>()
    try {
      const now = new Date()
      const spParts = new Intl.DateTimeFormat('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(now)
      const pMap: Record<string, string> = {}
      spParts.forEach((p) => {
        if (p.type !== 'literal') pMap[p.type] = p.value
      })
      const todayDateStr = `${pMap.year}-${pMap.month}-${pMap.day}`

      let filter = `alert_date = '${todayDateStr}' && status = 'sent'`
      if (courierIds && courierIds.length > 0) {
        const idFilter = courierIds.map((id) => `courier_id = '${id}'`).join(' || ')
        filter = `(${filter}) && (${idFilter})`
      }

      const alerts = await pb
        .collection<FuelBalanceAlertRecord>('fuel_balance_alerts')
        .getFullList({
          filter,
          sort: '-created',
          requestKey: null,
        })

      alerts.forEach((alert) => {
        // Se houver mais de um, mantém o mais recente
        if (alert.courier_id && !alertMap.has(alert.courier_id)) {
          alertMap.set(alert.courier_id, alert)
        }
      })
    } catch (err) {
      console.warn('[FuelAccountService] Erro ao buscar fuel_balance_alerts do dia civil:', err)
    }
    return alertMap
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

      // 2. Carrega concorrentemente adiantamentos, pedidos, configurações, locais, desvios, aprovações e alerta do dia
      const [advances, orders, settings, locations, offRouteEvents, approvalsList, todayAlertsMap] =
        await Promise.all([
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
          pb
            .collection('route_km_approvals')
            .getFullList<{
              order_id: string
              approved_km: number
              justification?: string
              status: 'approved' | 'rejected' | 'pending'
            }>({
              filter: `courier_id = '${courierId}'`,
              requestKey: null,
            })
            .catch(() => []),
          this.getTodayAlerts([courierId]),
        ])

      const approvalsMap = new Map<
        string,
        { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
      >()
      approvalsList.forEach((a) => {
        if (a && a.order_id) {
          approvalsMap.set(a.order_id, {
            approvedKm: Number(a.approved_km) || 0,
            justification: a.justification,
            status: a.status || 'pending',
          })
        }
      })

      const account = this.calculateAccountForCourier({
        courier: courierUser,
        advances,
        orders,
        settings,
        locations,
        offRouteEvents,
        periodFilter,
        approvalsMap,
      })

      const alertRecord = todayAlertsMap.get(courierId)
      if (alertRecord) {
        account.todayAlertSent = {
          id: alertRecord.id,
          alert_date: alertRecord.alert_date,
          balance: alertRecord.balance,
          monthly_spent: alertRecord.monthly_spent,
          monthly_average: alertRecord.monthly_average,
          suggested_recharge: alertRecord.suggested_recharge,
          recipient_email: alertRecord.recipient_email,
          status: alertRecord.status,
          notes: alertRecord.notes,
          created: alertRecord.created,
        }
        // Paridade estrita: quando existe registro gravado hoje, usa seus números oficiais
        account.balance = alertRecord.balance
        account.dailyAverage30d = alertRecord.monthly_average
        account.suggestedRecharge = alertRecord.suggested_recharge
      }

      return account
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

    const allCouriers = await this.getCouriers(targetCompanyId)
    // Filtrar fora couriers com status 'inactive' e registros inválidos (REGRA DE OURO, v0.0.464)
    const couriers = allCouriers.filter((c) => c && c.id && c.status !== 'inactive')
    if (couriers.length === 0) {
      return []
    }

    const courierIds = couriers.map((c) => c.id)

    const [advances, settings, locations, offRouteEvents, approvalsList, todayAlertsMap] =
      await Promise.all([
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
        pb
          .collection('route_km_approvals')
          .getFullList<{
            order_id: string
            approved_km: number
            justification?: string
            status: 'approved' | 'rejected' | 'pending'
          }>({
            requestKey: null,
          })
          .catch(() => []),
        this.getTodayAlerts(courierIds),
      ])

    const approvalsMap = new Map<
      string,
      { approvedKm: number; justification?: string; status: 'approved' | 'rejected' | 'pending' }
    >()
    approvalsList.forEach((a) => {
      if (a && a.order_id) {
        approvalsMap.set(a.order_id, {
          approvedKm: Number(a.approved_km) || 0,
          justification: a.justification,
          status: a.status || 'pending',
        })
      }
    })

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

    return couriers.map((courier) => {
      const account = this.calculateAccountForCourier({
        courier,
        advances,
        orders: effectiveOrders || [],
        settings,
        locations,
        offRouteEvents,
        periodFilter,
        approvalsMap,
      })

      const alertRecord = todayAlertsMap.get(courier.id)
      if (alertRecord) {
        account.todayAlertSent = {
          id: alertRecord.id,
          alert_date: alertRecord.alert_date,
          balance: alertRecord.balance,
          monthly_spent: alertRecord.monthly_spent,
          monthly_average: alertRecord.monthly_average,
          suggested_recharge: alertRecord.suggested_recharge,
          recipient_email: alertRecord.recipient_email,
          status: alertRecord.status,
          notes: alertRecord.notes,
          created: alertRecord.created,
        }
        // Paridade estrita com o e-mail enviado hoje
        account.balance = alertRecord.balance
        account.dailyAverage30d = alertRecord.monthly_average
        account.suggestedRecharge = alertRecord.suggested_recharge
      }

      return account
    })
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
