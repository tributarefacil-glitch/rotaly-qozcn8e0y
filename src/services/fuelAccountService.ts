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
import { getMatrizCompanyId } from '@/lib/companyResolver'

export interface UnifiedCourierFuelAccount {
  courier: UserRecord
  totalAdvances: number
  totalRouteKm: number
  totalSpent: number
  balance: number
  advanceCount: number
  deliveriesCount: number
  calculationSource: 'odometro' | 'gps' | 'viario'
  metrics: CourierFuelCalculationResult
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
    periodFilter?: 'all' | 'month' | 'week'
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

    const metrics = calculateCourierFuelMetrics({
      courier,
      advances,
      orders,
      locations,
      offRouteEvents,
      settings,
      periodFilter,
    })

    const isBicycle =
      metrics.vehicleCategory === 'bicicleta' ||
      courier.vehicle_type === 'bicicleta' ||
      courier.vehicle_type === 'bicycle'

    const totalSpent = isBicycle ? 0 : metrics.totalSpent
    const balance = metrics.balance

    return {
      courier,
      totalAdvances: metrics.totalAdvances,
      totalRouteKm: metrics.totalOfficialKm,
      totalSpent,
      balance,
      advanceCount: metrics.advanceCount,
      deliveriesCount: metrics.deliveriesCount,
      calculationSource: metrics.calculationSource,
      metrics,
    }
  }

  /**
   * Carrega todos os dados necessários e calcula a conta corrente de um entregador individual
   * (usado diretamente pelo app do entregador).
   */
  async getCourierSingleAccount(
    courierId: string,
    periodFilter: 'all' | 'month' | 'week' = 'all',
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
          .getFirstListItem("key = 'main_settings'", { requestKey: null })
          .catch(() => null),
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
    periodFilter?: 'all' | 'month' | 'week'
  }): Promise<UnifiedCourierFuelAccount[]> {
    const { companyId, ordersPool, periodFilter = 'all' } = params || {}
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
        .getFirstListItem("key = 'main_settings'", { requestKey: null })
        .catch(() => null),
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
}

export const fuelAccountService = FuelAccountService.getInstance()
