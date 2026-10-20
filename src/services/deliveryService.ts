import pb from '@/lib/pocketbase/client'
import { getMatrizCompanyId, resolveMatrizCompany } from '@/lib/companyResolver'
import { haversineDistanceMeters } from '@/lib/geo'
import { MapDataService } from '@/lib/mapDataService'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
import { recalcularLote, RecalcularLoteResult } from '@/services/recalcularLoteHelper'
import { getOperationalWindow } from '../lib/operationalWindow'
import type {
  OrderRecord,
  CustomerRecord,
  LocationRecord,
  NotificationRecord,
  UserRecord,
  OptimizedRouteResult,
  AppSettingsRecord,
  SiteContentRecord,
  FuelAdvanceRecord,
  ReviewRecord,
  OffRouteEventRecord,
  CourierFuelAccount,
  OrderPriority,
  RouteSuggestionDetails,
  VehicleType,
  BaseAddressRecord,
  BaseAddressType,
  EmpresaRecord,
  MembroRecord,
  MembroPapel,
  ColaboradorRecord,
  RotaRecord,
  EntregaRecord,
  RelatorioRecord,
  AddressAlertRecord,
  AddressAlertStatus,
  AddressAlertOrigin,
  FuelPaymentMethod,
  RouteKmApprovalRecord,
  RouteKmApprovalStatus,
  RouteKmApprovalType,
  AuditTrailRecord,
  RouteBatchTelemetryRecord,
} from '@/types/delivery'

/**
 * PATCH 1 — Sanitização de payload de telemetria (locations):
 * - lat: arredondado a 6 decimais, faixa -90..90 (lança erro se inválido)
 * - lng: arredondado a 6 decimais, faixa -180..180 (lança erro se inválido)
 * - speed: número >= 0, teto 250, 1 decimal, senão 0
 * - heading: 0..360, 1 decimal, senão 0
 * - accuracy: >= 0, teto 10000, 1 decimal, senão 10
 * - gps_status: default 'active'
 * - gps_reason: default '' (ou 'sem-fix' se accuracy >= 500)
 * - offline_buffered: booleano
 * - battery_level: incluída só se inteiro 1..100
 */
export function sanitizeLocationPayload(params: {
  userId: string
  lat: number
  lng: number
  speed?: number | null
  heading?: number | null
  batteryLevel?: number | null
  accuracy?: number | null
  gpsStatus?: string | null
  gpsReason?: string | null
  offlineBuffered?: boolean | null
}): Partial<LocationRecord> {
  const {
    userId,
    lat,
    lng,
    speed,
    heading,
    batteryLevel,
    accuracy,
    gpsStatus,
    gpsReason,
    offlineBuffered,
  } = params

  if (!userId || typeof userId !== 'string' || !userId.trim()) {
    throw new Error('[sanitizeLocationPayload] userId é obrigatório e deve ser string não vazia')
  }

  const numLat = typeof lat === 'number' ? lat : Number(lat)
  const numLng = typeof lng === 'number' ? lng : Number(lng)

  if (
    isNaN(numLat) ||
    !isFinite(numLat) ||
    numLat < -90 ||
    numLat > 90 ||
    isNaN(numLng) ||
    !isFinite(numLng) ||
    numLng < -180 ||
    numLng > 180
  ) {
    throw new Error(`[sanitizeLocationPayload] Coordenadas inválidas: lat=${lat}, lng=${lng}`)
  }

  // Rejeita coordenada (0, 0)
  if (Math.abs(numLat) < 0.000001 && Math.abs(numLng) < 0.000001) {
    throw new Error(
      '[sanitizeLocationPayload] Ponto nulo (0,0) rejeitado por segurança de telemetria',
    )
  }

  const cleanLat = Math.round(numLat * 1e6) / 1e6
  const cleanLng = Math.round(numLng * 1e6) / 1e6

  // Speed: número >= 0, teto 250, 1 decimal, senão 0
  let cleanSpeed = 0
  if (typeof speed === 'number' && !isNaN(speed) && isFinite(speed) && speed >= 0) {
    cleanSpeed = Math.round(Math.min(250, speed) * 10) / 10
  }

  // Heading: 0..360, 1 decimal, senão 0
  let cleanHeading = 0
  if (
    typeof heading === 'number' &&
    !isNaN(heading) &&
    isFinite(heading) &&
    heading >= 0 &&
    heading <= 360
  ) {
    cleanHeading = Math.round(heading * 10) / 10
  }

  // Accuracy: >= 0, teto 10000, 1 decimal, senão 10
  let cleanAccuracy = 10
  if (typeof accuracy === 'number' && !isNaN(accuracy) && isFinite(accuracy) && accuracy >= 0) {
    cleanAccuracy = Math.round(Math.min(10000, accuracy) * 10) / 10
  }

  // gps_status default 'active'
  const cleanGpsStatus =
    gpsStatus && typeof gpsStatus === 'string' && gpsStatus.trim() ? gpsStatus.trim() : 'active'

  // gps_reason default '' (ou 'sem-fix' se accuracy >= 500)
  let cleanGpsReason = ''
  if (gpsReason && typeof gpsReason === 'string' && gpsReason.trim()) {
    cleanGpsReason = gpsReason.trim()
  } else if (cleanAccuracy >= 500) {
    cleanGpsReason = 'sem-fix'
  }

  // offline_buffered booleano
  const cleanOfflineBuffered = Boolean(offlineBuffered)

  const payload: Partial<LocationRecord> = {
    user_id: userId.trim(),
    lat: cleanLat,
    lng: cleanLng,
    speed: cleanSpeed,
    heading: cleanHeading,
    accuracy: cleanAccuracy,
    gps_status: cleanGpsStatus,
    gps_reason: cleanGpsReason,
    offline_buffered: cleanOfflineBuffered,
  }

  // battery_level incluída só se inteiro 1..100
  if (typeof batteryLevel === 'number' && !isNaN(batteryLevel) && isFinite(batteryLevel)) {
    const roundedBattery = Math.round(batteryLevel)
    if (roundedBattery >= 1 && roundedBattery <= 100) {
      payload.battery_level = roundedBattery
    }
  }

  return payload
}

// Cache compartilhado e deduplicação em voo para contagem de alertas de endereço (TTL 15s)
const _alertsCountCache = new Map<string, { count: number; timestamp: number }>()
const _alertsCountInFlight = new Map<string, Promise<number>>()

export const deliveryService = {
  // Multi-tenant Empresas & Membros
  async getEmpresas(filter = '', sort = 'nome_razao_social') {
    return pb.collection<EmpresaRecord>('empresas').getFullList({
      filter,
      sort,
      requestKey: null,
    })
  },

  async getEmpresaById(id: string) {
    return pb.collection<EmpresaRecord>('empresas').getOne(id, {
      requestKey: null,
    })
  },

  async createEmpresa(data: Partial<EmpresaRecord>) {
    return pb.collection<EmpresaRecord>('empresas').create(data)
  },

  async updateEmpresa(id: string, data: Partial<EmpresaRecord>) {
    return pb.collection<EmpresaRecord>('empresas').update(id, data)
  },

  /**
   * Alternar status de ativação da empresa (Bloquear / Desbloquear)
   * Usa o endpoint dedicado do backend com auditoria, ou fallback para update direto.
   */
  async isMatrizCompany(id?: string): Promise<boolean> {
    if (!id) return false
    const matrizId = await getMatrizCompanyId()
    return Boolean(matrizId && id === matrizId)
  },

  async toggleEmpresaAtiva(
    id: string,
    ativa?: boolean,
  ): Promise<{ success: boolean; ativa: boolean; message: string }> {
    const isMatriz = await this.isMatrizCompany(id)
    if (isMatriz && ativa === false) {
      throw new Error('A empresa Matriz Principal não pode ser desativada/bloqueada.')
    }

    try {
      const res = await pb.send<{ success: boolean; ativa: boolean; message: string }>(
        `/backend/v1/companies/${id}/toggle-status`,
        {
          method: 'POST',
          body: typeof ativa === 'boolean' ? { ativa } : {},
        },
      )
      return res
    } catch {
      // Fallback direto via SDK
      let targetStatus = ativa
      if (typeof targetStatus !== 'boolean') {
        const current = await this.getEmpresaById(id)
        targetStatus = !(current.ativa ?? true)
      }
      const updated = await this.updateEmpresa(id, { ativa: targetStatus })
      return {
        success: true,
        ativa: updated.ativa ?? targetStatus,
        message: targetStatus
          ? 'Empresa desbloqueada com sucesso.'
          : 'Empresa bloqueada com sucesso.',
      }
    }
  },

  /**
   * Exclusão segura de empresa (apenas papel Master).
   * Desvincula membros, protege a Matriz e valida histórico de pedidos.
   */
  async deleteEmpresaSafe(
    id: string,
    options?: { forceDeleteOrders?: boolean },
  ): Promise<{
    success: boolean
    message: string
    removedMembersCount?: number
    updatedCustomersCount?: number
  }> {
    const isMatriz = await this.isMatrizCompany(id)
    if (isMatriz) {
      throw new Error('A empresa Matriz Principal não pode ser excluída.')
    }

    try {
      const res = await pb.send<{
        success: boolean
        message: string
        removedMembersCount?: number
        updatedCustomersCount?: number
      }>(`/backend/v1/companies/${id}/delete-safe`, {
        method: 'POST',
        body: {
          force_delete_orders: options?.forceDeleteOrders ?? false,
        },
      })
      return res
    } catch (err: any) {
      // Se a rota backend retornar mensagem de erro específica, propaga
      if (err?.data?.message) {
        throw new Error(err.data.message)
      }
      // Se falhar o endpoint, tentar exclusão direta via SDK (protegida pela deleteRule)
      // Primeiro desvincula membros da empresa
      try {
        const membros = await pb.collection<MembroRecord>('membros').getFullList({
          filter: `empresa_id = '${id}'`,
          requestKey: null,
        })
        for (const m of membros) {
          await pb
            .collection('membros')
            .delete(m.id)
            .catch(() => null)
        }
        await pb.collection('empresas').delete(id)
        return {
          success: true,
          message: 'Empresa e vínculos excluídos com sucesso.',
        }
      } catch (sdkErr: any) {
        throw new Error(sdkErr?.message || err?.message || 'Falha ao excluir a empresa.')
      }
    }
  },

  async getMembros(filter = '', sort = '-created', expand = 'empresa_id,user_id') {
    return pb.collection<MembroRecord>('membros').getFullList({
      filter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async createMembro(data: Partial<MembroRecord>) {
    return pb.collection<MembroRecord>('membros').create(data)
  },

  async getUserByEmail(email: string): Promise<UserRecord | null> {
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) return null
    try {
      const records = await pb.collection<UserRecord>('users').getList(1, 1, {
        filter: `email = '${cleanEmail}'`,
        requestKey: null,
      })
      return records.items[0] || null
    } catch {
      return null
    }
  },

  /**
   * Vincula um usuário já cadastrado à empresa informada ou à empresa ativa.
   * Não permite vínculo duplicado (se já existir vínculo ativo com essa empresa, retorna aviso).
   */
  async linkExistingUserToCompany(params: {
    userId?: string
    email?: string
    empresaId?: string
    role?: 'admin' | 'seller' | 'courier'
  }): Promise<{
    success: boolean
    message: string
    record?: MembroRecord
    alreadyLinked?: boolean
  }> {
    const targetCompanyId =
      params.empresaId || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    if (!targetCompanyId) {
      throw new Error('Empresa de destino não identificada.')
    }

    let user: UserRecord | null = null
    if (params.userId) {
      try {
        user = await pb.collection<UserRecord>('users').getOne(params.userId, { requestKey: null })
      } catch {
        user = null
      }
    } else if (params.email) {
      user = await this.getUserByEmail(params.email)
    }

    if (!user || !user.id) {
      throw new Error('Usuário não encontrado para vincular à empresa.')
    }

    // Verificar se já existe vínculo ativo do usuário com essa empresa
    const existingMembers = await pb.collection<MembroRecord>('membros').getFullList({
      filter: `empresa_id = '${targetCompanyId}' && user_id = '${user.id}'`,
      requestKey: null,
    })

    const activeMember = existingMembers.find((m) => m.ativo)
    if (activeMember) {
      return {
        success: true,
        alreadyLinked: true,
        message: `O usuário ${user.name || user.email} já está vinculado e ativo nesta empresa.`,
        record: activeMember,
      }
    }

    // Se já existia um registro inativo, reativamos
    const inactiveMember = existingMembers[0]
    const papelMembro: MembroPapel =
      params.role === 'courier' || user.role === 'courier'
        ? 'entregador'
        : params.role === 'seller' || user.role === 'seller'
          ? 'vendedor'
          : 'admin'

    // Validar limites de plano da empresa
    const limitCheck = await this.checkUserLimit(targetCompanyId, papelMembro === 'entregador')
    if (!limitCheck.allowed) {
      throw new Error(
        limitCheck.message || 'Limite de usuários do plano atingido para esta empresa.',
      )
    }

    if (inactiveMember) {
      const updated = await pb.collection<MembroRecord>('membros').update(inactiveMember.id, {
        ativo: true,
        papel: papelMembro,
      })
      return {
        success: true,
        alreadyLinked: false,
        message: `Vínculo de ${user.name || user.email} reativado com sucesso na empresa!`,
        record: updated,
      }
    }

    const created = await pb.collection<MembroRecord>('membros').create({
      user_id: user.id,
      empresa_id: targetCompanyId,
      papel: papelMembro,
      ativo: true,
    })

    return {
      success: true,
      alreadyLinked: false,
      message: `Usuário ${user.name || user.email} vinculado com sucesso à empresa!`,
      record: created,
    }
  },

  async updateMembro(id: string, data: Partial<MembroRecord>) {
    return pb.collection<MembroRecord>('membros').update(id, data)
  },

  async deleteMembro(id: string) {
    return pb.collection<MembroRecord>('membros').delete(id)
  },

  /**
   * Helper para obter o ID da empresa ativa.
   * - Para master: lê do localStorage ou cai na Matriz.
   * - Para demais usuários: obtém da empresa vinculada à sua sessão/membro.
   */
  getActiveCompanyId(): string {
    if (typeof window !== 'undefined') {
      const stored = localStorage.getItem('rotaly_active_empresa_id')
      if (stored) return stored
    }
    return ''
  },

  async getMatrizCompanyId(): Promise<string> {
    return getMatrizCompanyId()
  },

  setActiveCompanyId(empresaId: string): void {
    if (typeof window !== 'undefined' && empresaId) {
      localStorage.setItem('rotaly_active_empresa_id', empresaId)
    }
  },

  /**
   * Helper de cláusula de empresa para isolamento multi-tenant:
   * Retorna `empresa_id = '...'` garantindo que registros de outras lojas nunca se misturem.
   * Caso o usuário logado seja Master e queira ver tudo (sem filtro de empresa), pode ser nulo.
   * Por padrão em operações de loja, isola rigorosamente pelo ID da empresa ativa.
   */
  getCompanyFilterClause(_field = 'empresa_id', overrideCompanyId?: string): string | null {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'

    // Se for master e passou explicitamente override como 'ALL', não filtra
    if (isMaster && overrideCompanyId === 'ALL') {
      return null
    }

    const companyId = overrideCompanyId || this.getActiveCompanyId()
    if (!companyId) return null

    return `${_field} = '${companyId}'`
  },

  /**
   * Obter plano e limites de uma empresa ativa
   */
  async getCompanyPlanAndLimits(empresaId?: string): Promise<{
    plano: 'basico' | 'profissional' | 'enterprise'
    max_users: number
    max_couriers: number
    max_orders_month: number
    ativa: boolean
  }> {
    const targetId = empresaId || this.getActiveCompanyId()
    const isMatriz = await this.isMatrizCompany(targetId)
    try {
      const comp = await pb.collection<EmpresaRecord>('empresas').getOne(targetId, {
        requestKey: null,
      })
      const plano = (comp.plano as any) || (isMatriz ? 'enterprise' : 'profissional')
      return {
        plano,
        max_users:
          comp.max_users || (plano === 'enterprise' ? 9999 : plano === 'profissional' ? 15 : 5),
        max_couriers:
          comp.max_couriers || (plano === 'enterprise' ? 9999 : plano === 'profissional' ? 10 : 3),
        max_orders_month:
          comp.max_orders_month ||
          (plano === 'enterprise' ? 999999 : plano === 'profissional' ? 2000 : 300),
        ativa: comp.ativa ?? true,
      }
    } catch {
      return {
        plano: 'enterprise',
        max_users: 9999,
        max_couriers: 9999,
        max_orders_month: 999999,
        ativa: true,
      }
    }
  },

  /**
   * Validar se a empresa atingiu o limite de usuários/membros
   */
  async checkUserLimit(
    empresaId?: string,
    isCourier = false,
  ): Promise<{ allowed: boolean; message?: string }> {
    const targetId = empresaId || this.getActiveCompanyId()
    // Matriz nunca é bloqueada
    if (await this.isMatrizCompany(targetId)) return { allowed: true }

    const limits = await this.getCompanyPlanAndLimits(targetId)
    if (!limits.ativa) {
      return {
        allowed: false,
        message: 'Esta empresa está desativada no sistema. Contate o suporte.',
      }
    }

    // Contar membros atuais da empresa
    const currentMembers = await pb.collection<MembroRecord>('membros').getFullList({
      filter: `empresa_id = '${targetId}' && ativo = true`,
      requestKey: null,
    })

    if (currentMembers.length >= limits.max_users) {
      return {
        allowed: false,
        message: `Limite de usuários do plano (${limits.max_users} membros) atingido para esta empresa. Faça upgrade do plano para adicionar mais usuários.`,
      }
    }

    if (isCourier) {
      const courierMembers = currentMembers.filter(
        (m) => m.papel === 'entregador' || (m.papel as string) === 'courier',
      )
      if (courierMembers.length >= limits.max_couriers) {
        return {
          allowed: false,
          message: `Limite de entregadores do plano (${limits.max_couriers} entregadores) atingido para esta empresa. Faça upgrade do plano para cadastrar mais entregadores.`,
        }
      }
    }

    return { allowed: true }
  },

  /**
   * Validar se a empresa atingiu o limite de pedidos no mês corrente
   */
  async checkOrderLimit(empresaId?: string): Promise<{ allowed: boolean; message?: string }> {
    const targetId = empresaId || this.getActiveCompanyId()
    if (await this.isMatrizCompany(targetId)) return { allowed: true }

    const limits = await this.getCompanyPlanAndLimits(targetId)
    if (!limits.ativa) {
      return {
        allowed: false,
        message: 'Esta empresa está desativada no sistema. Contate o suporte.',
      }
    }

    // Contar pedidos criados no mês atual
    const now = new Date()
    const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
      .toISOString()
      .replace('T', ' ')

    try {
      const res = await pb.collection<OrderRecord>('orders').getList(1, 1, {
        filter: `empresa_id = '${targetId}' && created >= '${firstDayOfMonth}'`,
        requestKey: null,
      })
      if (res.totalItems >= limits.max_orders_month) {
        return {
          allowed: false,
          message: `Limite mensal de pedidos (${limits.max_orders_month} pedidos/mês) atingido para esta empresa. Faça upgrade do plano para continuar gerando entregas.`,
        }
      }
    } catch (err) {
      console.warn('Erro ao verificar limite de pedidos:', err)
    }

    return { allowed: true }
  },

  // Colaboradores, Rotas, Entregas, Relatórios (Unificados)
  async getColaboradores(_empresaId?: string) {
    return pb.collection<ColaboradorRecord>('colaboradores').getFullList({
      sort: 'nome',
      requestKey: null,
    })
  },

  async createColaborador(data: Partial<ColaboradorRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<ColaboradorRecord>('colaboradores').create(payload)
  },

  async getRotas(_empresaId?: string) {
    return pb.collection<RotaRecord>('rotas').getFullList({
      sort: '-created',
      requestKey: null,
    })
  },

  async createRota(data: Partial<RotaRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<RotaRecord>('rotas').create(payload)
  },

  async getEntregas(_empresaId?: string) {
    return pb.collection<EntregaRecord>('entregas').getFullList({
      sort: '-created',
      requestKey: null,
    })
  },

  async createEntrega(data: Partial<EntregaRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<EntregaRecord>('entregas').create(payload)
  },

  async getRelatorios(_empresaId?: string) {
    return pb.collection<RelatorioRecord>('relatorios').getFullList({
      sort: '-created',
      requestKey: null,
    })
  },

  async createRelatorio(data: Partial<RelatorioRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<RelatorioRecord>('relatorios').create(payload)
  },

  // Orders
  async getOrders(
    filter = '',
    sort = '-created',
    expand = 'customer_id,courier_id,seller_id',
    empresaId?: string,
  ) {
    // Saneamento global e preventivo de filtros PocketBase:
    let sanitizedFilter = filter
    if (sanitizedFilter) {
      sanitizedFilter = sanitizedFilter
        .replace(
          /\(?route_finished\s*=\s*false\s*\|\|\s*route_finished\s*=\s*null\)?/g,
          'route_finished != true',
        )
        .replace(/route_finished\s*=\s*false/g, 'route_finished != true')
        .replace(/route_finished\s*=\s*null/g, 'route_finished != true')
        .replace(/\bdata_entrega\b/g, 'actual_arrival')
        .replace(/\bdelivery_date\b/g, 'actual_arrival')
        .replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/g, '$1 $2')
    }

    // Isolamento multi-tenant por empresa (se não contiver empresa_id no filtro e não for busca de tracking público)
    if (!sanitizedFilter.includes('empresa_id') && !sanitizedFilter.includes('tracking_code')) {
      const companyClause = this.getCompanyFilterClause('empresa_id', empresaId)
      if (companyClause) {
        sanitizedFilter = sanitizedFilter
          ? `(${sanitizedFilter}) && ${companyClause}`
          : companyClause
      }
    }

    return pb.collection<OrderRecord>('orders').getFullList({
      filter: sanitizedFilter,
      sort,
      expand,
      requestKey: null,
    })
  },

  /**
   * Busca paginada completa em lotes de ~200 pedidos com loop até esgotar,
   * garantindo que nenhum pedido do período seja descartado.
   */
  async getOrdersInBatches(
    filter = '',
    sort = '-created',
    expand = 'customer_id,courier_id,seller_id',
    batchSize = 200,
    empresaId?: string,
  ): Promise<OrderRecord[]> {
    let sanitizedFilter = filter
    if (sanitizedFilter) {
      sanitizedFilter = sanitizedFilter
        .replace(
          /\(?route_finished\s*=\s*false\s*\|\|\s*route_finished\s*=\s*null\)?/g,
          'route_finished != true',
        )
        .replace(/route_finished\s*=\s*false/g, 'route_finished != true')
        .replace(/route_finished\s*=\s*null/g, 'route_finished != true')
        .replace(/\bdata_entrega\b/g, 'actual_arrival')
        .replace(/\bdelivery_date\b/g, 'actual_arrival')
        .replace(/(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})/g, '$1 $2')
    }

    if (!sanitizedFilter.includes('empresa_id') && !sanitizedFilter.includes('tracking_code')) {
      const companyClause = this.getCompanyFilterClause('empresa_id', empresaId)
      if (companyClause) {
        sanitizedFilter = sanitizedFilter
          ? `(${sanitizedFilter}) && ${companyClause}`
          : companyClause
      }
    }

    const allOrders: OrderRecord[] = []
    let page = 1
    let totalPages = 1

    do {
      const res = await pb.collection<OrderRecord>('orders').getList(page, batchSize, {
        filter: sanitizedFilter,
        sort,
        expand,
        requestKey: null,
      })
      allOrders.push(...res.items)
      totalPages = res.totalPages
      page++
    } while (page <= totalPages)

    return allOrders
  },

  async getOrderById(id: string) {
    return pb.collection<OrderRecord>('orders').getOne(id, {
      expand: 'customer_id,courier_id,seller_id',
      requestKey: null,
    })
  },

  async getOrderByTrackingCode(trackingCode: string) {
    const code = trackingCode.trim().toUpperCase()
    if (!code) return null

    // 1. Endpoint público canônico /backend/v1/public-track/:code (FONTE ÚNICA segura para anônimos)
    // Executa via $app no backend com privilégio de sistema e devolve DTO sanitizado mínimo.
    try {
      const publicData = await this.getPublicTrackingRoute(code)
      if (publicData && (publicData.order_id || publicData.tracking_code)) {
        const synthesizedOrder: Partial<OrderRecord> = {
          id: publicData.order_id || `pub_${code}`,
          tracking_code: publicData.tracking_code || code,
          status: (publicData.status as any) || 'in_transit',
          sequence: publicData.sequence || 0,
          courier_id: publicData.courier_id,
          estimated_arrival: (publicData as any).estimated_arrival || '',
          total_price: (publicData as any).total_price || 0,
          route_released: (publicData as any).route_released ?? true,
          route_started: (publicData as any).route_started ?? true,
          route_finished: (publicData as any).route_finished ?? false,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          collectionId: 'orders',
          collectionName: 'orders',
          expand: {
            customer_id: publicData.destination
              ? ({
                  id: `cust_${code}`,
                  name: publicData.destination.name,
                  address: publicData.destination.address,
                  lat: publicData.destination.lat,
                  lng: publicData.destination.lng,
                  phone: '',
                  created: '',
                  updated: '',
                  collectionId: 'customers',
                  collectionName: 'customers',
                } as any)
              : undefined,
            courier_id: publicData.courier_first_name
              ? ({
                  id: publicData.courier_id || '',
                  name: publicData.courier_first_name,
                  collectionId: 'users',
                  collectionName: 'users',
                } as any)
              : undefined,
          },
        }

        // Se usuário estiver autenticado internamente (ex: seller/admin), pode tentar carregar seller expand
        if (pb.authStore.isValid && publicData.courier_id) {
          try {
            const cour = await pb
              .collection<UserRecord>('users')
              .getOne(publicData.courier_id, { requestKey: null })
            if (cour && synthesizedOrder.expand) {
              synthesizedOrder.expand.courier_id = cour
            }
          } catch {
            /* safe ignore */
          }
        }

        return synthesizedOrder as OrderRecord
      }
    } catch (endpointErr) {
      console.warn('Erro ao consultar endpoint público de tracking:', endpointErr)
    }

    // 2. Se o usuário estiver autenticado (ex: seller/admin na tela), permite consulta direta à coleção
    if (pb.authStore.isValid) {
      try {
        const list = await pb.collection<OrderRecord>('orders').getList(1, 1, {
          filter: `tracking_code = '${code}'`,
          expand: 'customer_id,courier_id,seller_id',
          requestKey: null,
        })
        if (list.items[0]) return list.items[0]
      } catch (authErr) {
        console.warn('Erro na consulta direta autenticada de orders:', authErr)
      }
    }

    return null
  },

  /**
   * Obtém detalhes da rota pública (paradas anteriores da ordem de otimização)
   * para cálculo real viário de ETA (+3 min por parada)
   */
  async getPublicTrackingRoute(trackingCode: string) {
    try {
      const cleanTrackingCode = encodeURIComponent(trackingCode.trim().toUpperCase())
      const baseApiUrl = (pb.baseUrl || '').replace(/\/+$/, '')
      // Endpoint primário /backend/v1/public-track/:code
      const endpointPath = `/backend/v1/public-track/${cleanTrackingCode}`
      const fullUrl = baseApiUrl ? `${baseApiUrl}${endpointPath}` : endpointPath

      return await pb.send<{
        order_id: string
        tracking_code: string
        status: string
        sequence: number
        courier_id: string | null
        courier_first_name: string | null
        route_released: boolean
        route_started: boolean
        route_finished: boolean
        estimated_arrival: string
        total_price?: number
        destination: { name: string; lat: number; lng: number; address: string } | null
        courier_location: {
          lat: number
          lng: number
          speed: number
          created: string
          age_seconds: number
        } | null
        is_gps_active: boolean
        stops_before: { sequence: number; lat: number; lng: number }[]
        total_stops_before: number
        completed_stops_before: number
        queue_position: number
        total_deliveries_in_batch: number
      }>(fullUrl, {
        method: 'GET',
        requestKey: null,
      })
    } catch (err) {
      console.warn('Erro ao carregar tracking público por /code, tentando fallback /route:', err)
      try {
        const cleanTrackingCode = encodeURIComponent(trackingCode.trim().toUpperCase())
        const baseApiUrl = (pb.baseUrl || '').replace(/\/+$/, '')
        const fallbackPath = `/backend/v1/public-track/${cleanTrackingCode}/route`
        const fullFallbackUrl = baseApiUrl ? `${baseApiUrl}${fallbackPath}` : fallbackPath
        return await pb.send<any>(fullFallbackUrl, { method: 'GET', requestKey: null })
      } catch (errFallback) {
        console.warn('Fallback /route também falhou:', errFallback)
        return null
      }
    }
  },

  async createOrder(data: Partial<OrderRecord>) {
    const activeCompanyId = data.empresa_id || this.getActiveCompanyId()

    // Validar limites de plano da empresa
    const limitCheck = await this.checkOrderLimit(activeCompanyId)
    if (!limitCheck.allowed) {
      throw new Error(
        limitCheck.message || 'Limite mensal de pedidos excedido para o plano desta empresa.',
      )
    }

    const payload = {
      ...data,
      empresa_id: activeCompanyId,
    }
    return pb.collection<OrderRecord>('orders').create(payload)
  },

  async updateOrder(id: string, data: Partial<OrderRecord> | FormData) {
    return pb.collection<OrderRecord>('orders').update(id, data)
  },

  /**
   * Atualiza o pin (lat, lng) do endereço entregue do cliente.
   * Se o pedido estiver vinculado a um customer_address_id e o cliente tiver lista de endereços,
   * atualiza o item correspondente em `addresses`.
   * Se for o endereço preferencial ou único, também atualiza lat/lng na raiz do cliente.
   */
  async updateCustomerDeliveryPin(params: {
    customerId: string
    lat: number
    lng: number
    customerAddressId?: string | null
  }): Promise<void> {
    const { customerId, lat, lng, customerAddressId } = params
    if (!customerId || !lat || !lng) return

    // GUARDA DA BASE OFICIAL (ITEM A.2): Se a coordenada estiver dentro do geofence de 150m da base oficial,
    // abortar sem gravar pin nem atualizar cadastro (evita caso Raquel Lima e outros clientes marcados na base).
    const OFFICIAL_BASE_LAT = -22.6977499
    const OFFICIAL_BASE_LNG = -43.2936013
    const BASE_GEOFENCE_METERS = 150

    const distToBase = haversineDistanceMeters(OFFICIAL_BASE_LAT, OFFICIAL_BASE_LNG, lat, lng)
    if (!isNaN(distToBase) && distToBase <= BASE_GEOFENCE_METERS) {
      console.warn(
        `[deliveryService] updateCustomerDeliveryPin abortado: pin (${lat}, ${lng}) está a ${Math.round(distToBase)}m da base oficial (geofence ${BASE_GEOFENCE_METERS}m). Nenhum pin gravado para customer ${customerId}.`,
      )
      return
    }

    try {
      const customer = await pb.collection<CustomerRecord>('customers').getOne(customerId)
      if (!customer) return

      // REGRA INTOCÁVEL: Nota '[CORREÇÃO DEFINITIVA' não pode ser sobrescrita
      const currentNotes = customer.notes || ''
      const isDefinitive = currentNotes.includes('[CORREÇÃO DEFINITIVA')

      let addresses = customer.addresses ? [...customer.addresses] : []
      let updatedAddresses = false
      let isTargetDefault = false

      if (addresses.length > 0) {
        if (customerAddressId) {
          addresses = addresses.map((addr) => {
            if (addr.id === customerAddressId) {
              if (addr.is_default) isTargetDefault = true
              updatedAddresses = true
              return { ...addr, lat, lng }
            }
            return addr
          })
        } else {
          // Se não houver customerAddressId explícito, atualiza o endereço default ou o primeiro
          addresses = addresses.map((addr, idx) => {
            if (addr.is_default || (!isTargetDefault && idx === 0)) {
              isTargetDefault = true
              updatedAddresses = true
              return { ...addr, lat, lng }
            }
            return addr
          })
        }
      }

      const updatePayload: Partial<CustomerRecord> = {}
      if (updatedAddresses) {
        updatePayload.addresses = addresses
      }

      // Se for o default, ou se não tinha addresses estruturados, ou se a raiz estava sem lat/lng:
      if (isTargetDefault || addresses.length === 0 || !customer.lat || !customer.lng) {
        updatePayload.lat = lat
        updatePayload.lng = lng
      }

      // Enriquecimento automático estilo Uber via geocodificação reversa (porta única MapDataService)
      // REGRA DO DONO: O pin do entregador na 1ª entrega consolida lat/lng + endereço formatado.
      // FALLBACK S/N: Se o Google NÃO devolver número mas o pin veio de entrega confirmada,
      // o endereço fica CONFIRMADO com 'S/N' + complemento — NÃO vai para Suspeitos!
      // Só vai para Endereços Suspeitos quem nunca teve pin de entrega confirmada.
      if (!isDefinitive) {
        try {
          const { MapDataService } = await import('@/lib/mapDataService')
          const enriched = await MapDataService.reverseGeocodePin({
            lat,
            lng,
            existingAddress: customer.address,
            existingComplement: customer.complement,
          })

          if (enriched && enriched.fullAddress) {
            let effectiveNumber = enriched.number
            // Fallback S/N: confirmada via pin do entregador
            if (!effectiveNumber || effectiveNumber.trim() === '') {
              effectiveNumber = 'S/N'
            }

            // Remonta fullAddress com número garantido
            let formattedFull = enriched.fullAddress
            if (effectiveNumber === 'S/N' && !formattedFull.includes('S/N')) {
              formattedFull =
                `${enriched.street || 'Rua'}, S/N, ${enriched.neighborhood || ''}, ${enriched.city || ''} - ${enriched.state || 'RJ'}, CEP ${enriched.postalCode || ''}`
                  .replace(/,\s*,/g, ',')
                  .replace(/^,\s*/, '')
                  .trim()
            }

            updatePayload.address = formattedFull
            if (enriched.street) updatePayload.street = enriched.street
            updatePayload.number = effectiveNumber
            if (enriched.complement) updatePayload.complement = enriched.complement
            if (enriched.neighborhood) updatePayload.neighborhood = enriched.neighborhood
            if (enriched.city) updatePayload.city = enriched.city
            if (enriched.state) updatePayload.state = enriched.state
            if (enriched.postalCode) updatePayload.postal_code = enriched.postalCode

            // NOTA: Como veio de entrega confirmada pelo entregador, NÃO gera alerta de Suspeito com S/N!
            // Endereço é CONFIRMADO automaticamente com S/N + complemento.
          }
        } catch (enrichErr) {
          console.warn(
            '[deliveryService] Enriquecimento reverso Uber via MapDataService falhou, prosseguindo com lat/lng:',
            enrichErr,
          )
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        await pb.collection('customers').update(customerId, updatePayload)
      }
    } catch (err) {
      console.warn('[deliveryService] Erro ao atualizar pin de entrega do cliente:', err)
    }
  },

  async deleteOrder(id: string) {
    return pb.collection<OrderRecord>('orders').delete(id)
  },

  // Customers
  async getCustomers(customFilter = '', empresaId?: string) {
    let finalFilter = customFilter
    if (!finalFilter.includes('empresa_id')) {
      const companyClause = this.getCompanyFilterClause('empresa_id', empresaId)
      if (companyClause) {
        finalFilter = finalFilter ? `(${finalFilter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<CustomerRecord>('customers').getFullList({
      filter: finalFilter,
      sort: 'name',
      requestKey: null,
    })
  },

  /**
   * Busca pedidos recentes (<24h) de um cliente com status ativo ou em rota ('pending', 'in_transit', 'assigned')
   * para prevenir vendas duplas acidentais pelo vendedor.
   */
  async getRecentActiveOrdersForCustomer(
    customerId: string,
    hoursWindow = 24,
  ): Promise<OrderRecord[]> {
    if (!customerId) return []
    try {
      const thresholdTime = new Date(Date.now() - hoursWindow * 60 * 60 * 1000)
        .toISOString()
        .replace('T', ' ')
      const filter = `customer_id = '${customerId}' && created >= '${thresholdTime}' && status != 'cancelled' && status != 'delivered'`
      return await pb.collection<OrderRecord>('orders').getFullList({
        filter,
        sort: '-created',
        requestKey: null,
      })
    } catch (err) {
      console.warn('Erro ao verificar pedidos recentes do cliente:', err)
      return []
    }
  },

  /**
   * Search customers by name, phone (phone, phone2, phone3) or document (CPF/CNPJ)
   */
  /**
   * Search customers by name, phone (phone, phone2, phone3) or document (CPF/CNPJ).
   * Fetches the customer list and performs in-memory multi-field matching with normalized digits,
   * guaranteeing robust results matching with or without masks.
   */
  async searchCustomers(term: string): Promise<CustomerRecord[]> {
    const raw = term.trim()
    const all = await this.getCustomers()
    if (!raw) return all

    const q = raw.toLowerCase()
    const digits = raw.replace(/\D/g, '')

    return all.filter((c) => {
      // 1. Nome
      if (c.name && c.name.toLowerCase().includes(q)) return true

      // 2. Documento (CPF / CNPJ) - formatado ou dígitos limpos
      if (c.document) {
        if (c.document.toLowerCase().includes(q)) return true
        if (digits && c.document.replace(/\D/g, '').includes(digits)) return true
      }

      // 3. Telefones (phone, phone2, phone3) - formatados ou dígitos limpos
      const phones = [c.phone, c.phone2, c.phone3].filter(Boolean) as string[]
      for (const p of phones) {
        if (p.toLowerCase().includes(q)) return true
        if (digits && p.replace(/\D/g, '').includes(digits)) return true
      }

      // 4. Endereço
      if (c.address && c.address.toLowerCase().includes(q)) return true
      if (c.street && c.street.toLowerCase().includes(q)) return true
      if (c.neighborhood && c.neighborhood.toLowerCase().includes(q)) return true
      if (c.city && c.city.toLowerCase().includes(q)) return true

      return false
    })
  },

  /**
   * Searches for customer by any of their up to 3 phone numbers (digits normalized).
   * Excludes a specific customerId if passed (useful during customer edits).
   */
  async findCustomerByPhone(
    rawPhone: string,
    excludeCustomerId?: string,
  ): Promise<CustomerRecord | null> {
    const digits = rawPhone.replace(/\D/g, '')
    if (!digits || digits.length < 8) return null

    try {
      // Direct query with exact or clean match across phone, phone2 and phone3
      const filter = `phone ~ '${digits}' || phone2 ~ '${digits}' || phone3 ~ '${digits}' || phone = '${rawPhone}'`
      const records = await pb.collection<CustomerRecord>('customers').getList(1, 20, {
        filter,
        sort: '-created',
        requestKey: null,
      })

      if (records.items.length > 0) {
        // Find the record where stripped phone matches stripped digits exactly or as national suffix
        const candidates = excludeCustomerId
          ? records.items.filter((c) => c.id !== excludeCustomerId)
          : records.items

        const match = candidates.find((c) => {
          const d1 = (c.phone || '').replace(/\D/g, '')
          const d2 = (c.phone2 || '').replace(/\D/g, '')
          const d3 = (c.phone3 || '').replace(/\D/g, '')
          return (
            (d1 &&
              (d1 === digits ||
                (d1.length >= 8 &&
                  digits.length >= 8 &&
                  (d1.endsWith(digits) || digits.endsWith(d1))))) ||
            (d2 &&
              (d2 === digits ||
                (d2.length >= 8 &&
                  digits.length >= 8 &&
                  (d2.endsWith(digits) || digits.endsWith(d2))))) ||
            (d3 &&
              (d3 === digits ||
                (d3.length >= 8 &&
                  digits.length >= 8 &&
                  (d3.endsWith(digits) || digits.endsWith(d3)))))
          )
        })
        return match || null
      }
      return null
    } catch (e) {
      console.warn('findCustomerByPhone search error:', e)
      return null
    }
  },

  /**
   * Busca cliente por CPF / Documento (normalizado para dígitos)
   */
  async findCustomerByDocument(
    rawDoc: string,
    excludeCustomerId?: string,
  ): Promise<CustomerRecord | null> {
    const digits = (rawDoc || '').replace(/\D/g, '')
    if (!digits || digits.length < 11) return null

    try {
      // Busca clientes com documento parecido
      const records = await pb.collection<CustomerRecord>('customers').getList(1, 50, {
        filter: `document ~ '${digits}' || document = '${rawDoc}'`,
        requestKey: null,
      })

      const candidates = excludeCustomerId
        ? records.items.filter((c) => c.id !== excludeCustomerId)
        : records.items

      const match = candidates.find((c) => {
        const cDocDigits = (c.document || '').replace(/\D/g, '')
        return cDocDigits === digits
      })

      return match || null
    } catch (e) {
      console.warn('findCustomerByDocument search error:', e)
      return null
    }
  },

  /**
   * ITEM 2: Validação de duplicidade por Telefone OU CPF (apenas dígitos).
   * Bloqueia se já existir outro cliente ativo com mesmo telefone ou mesmo CPF.
   * Retorna mensagem clara: "Já existe cliente com este telefone/CPF: [nome, id]".
   */
  /**
   * ITEM 3 (0.2): Recálculo em cascata usando recalcularLote como fonte única de verdade
   */
  async recalcularLoteCascata(routeBatchKey: string): Promise<RecalcularLoteResult> {
    return recalcularLote(routeBatchKey)
  },

  async checkCustomerDuplicateConflict(params: {
    phones: (string | undefined | null)[]
    document?: string | null
    excludeCustomerId?: string
  }): Promise<{
    conflict: boolean
    reason?: 'phone' | 'document'
    customer?: CustomerRecord
    duplicateValue?: string
    message?: string
  }> {
    const { phones, document, excludeCustomerId } = params

    // 1. Verificar documento / CPF
    if (document) {
      const docDigits = document.replace(/\D/g, '')
      if (docDigits.length >= 11) {
        const existingDocCustomer = await this.findCustomerByDocument(document, excludeCustomerId)
        if (existingDocCustomer) {
          return {
            conflict: true,
            reason: 'document',
            customer: existingDocCustomer,
            duplicateValue: document,
            message: `Já existe cliente com este CPF: [${existingDocCustomer.name}, ${existingDocCustomer.id}]`,
          }
        }
      }
    }

    // 2. Verificar telefones (apenas dígitos)
    for (const p of phones) {
      if (!p) continue
      const digits = p.replace(/\D/g, '')
      if (digits.length >= 8) {
        const found = await this.findCustomerByPhone(p, excludeCustomerId)
        if (found) {
          return {
            conflict: true,
            reason: 'phone',
            customer: found,
            duplicateValue: p,
            message: `Já existe cliente com este telefone: [${found.name}, ${found.id}]`,
          }
        }
      }
    }

    return { conflict: false }
  },

  /**
   * Checks if any of the given phone numbers already belongs to another customer.
   * Returns conflicting CustomerRecord if duplicate found, or null if all phones are unique.
   */
  async checkPhoneConflict(
    phones: (string | undefined | null)[],
    excludeCustomerId?: string,
  ): Promise<{ conflict: boolean; customer?: CustomerRecord; duplicatePhone?: string }> {
    for (const p of phones) {
      if (!p) continue
      const digits = p.replace(/\D/g, '')
      if (digits.length >= 8) {
        const found = await this.findCustomerByPhone(p, excludeCustomerId)
        if (found) {
          return { conflict: true, customer: found, duplicatePhone: p }
        }
      }
    }
    return { conflict: false }
  },

  /**
   * ITEM 2: Unificação manual de clientes pelo Admin com reatribuição de pedidos e registro em audit_trail.
   * SEM mescla automática. Reatribui pedidos do cliente secundário para o primário e remove ou desativa o secundário.
   */
  async unifyCustomers(params: {
    primaryCustomerId: string
    secondaryCustomerId: string
    actorName: string
    actorUserId?: string
    notes?: string
  }): Promise<{ success: boolean; reassignedOrdersCount: number; message: string }> {
    const { primaryCustomerId, secondaryCustomerId, actorName, actorUserId, notes } = params

    if (primaryCustomerId === secondaryCustomerId) {
      throw new Error('O cliente primário e secundário não podem ser o mesmo.')
    }

    const primary = await pb.collection<CustomerRecord>('customers').getOne(primaryCustomerId)
    const secondary = await pb.collection<CustomerRecord>('customers').getOne(secondaryCustomerId)

    if (!primary || !secondary) {
      throw new Error('Clientes não encontrados para unificação.')
    }

    // 1. Buscar todos os pedidos do secundário
    const secondaryOrders = await pb.collection<OrderRecord>('orders').getFullList({
      filter: `customer_id = '${secondaryCustomerId}'`,
      requestKey: null,
    })

    let reassignedCount = 0
    for (const ord of secondaryOrders) {
      await pb.collection('orders').update(ord.id, {
        customer_id: primaryCustomerId,
        // Mantém as coordenadas de entrega se o secundário já tinha, ou usa a do primário se faltava
        end_address_name: ord.end_address_name || primary.name,
      })
      reassignedCount++

      // Registrar auditoria em cada pedido reatribuído
      await this.createAuditTrailEntry({
        order_id: ord.id,
        user_id: actorUserId || '',
        actor_name: actorName || 'Admin',
        action: 'customer_unification_order_reassigned',
        old_value: `${secondary.name} (${secondaryCustomerId})`,
        new_value: `${primary.name} (${primaryCustomerId})`,
        metadata: {
          primary_customer_id: primaryCustomerId,
          primary_customer_name: primary.name,
          secondary_customer_id: secondaryCustomerId,
          secondary_customer_name: secondary.name,
          notes: notes || 'Unificação manual de clientes',
        },
      }).catch(() => {})
    }

    // 2. Registrar evento no audit_trail geral
    await this.createAuditTrailEntry({
      user_id: actorUserId || '',
      actor_name: actorName || 'Admin',
      action: 'customer_manual_unification',
      old_value: `${secondary.name} [${secondary.id}]`,
      new_value: `${primary.name} [${primary.id}]`,
      metadata: {
        primary_customer: {
          id: primary.id,
          name: primary.name,
          phone: primary.phone,
          document: primary.document,
        },
        secondary_customer: {
          id: secondary.id,
          name: secondary.name,
          phone: secondary.phone,
          document: secondary.document,
        },
        reassigned_orders_count: reassignedCount,
        notes: notes || 'Unificação manual pelo admin no painel de duplicatas',
      },
    }).catch(() => {})

    // 3. Atualizar telefones do cliente primário caso estejam vazios e o secundário tenha
    const updates: Partial<CustomerRecord> = {}
    if (!primary.document && secondary.document) updates.document = secondary.document
    if (!primary.phone2 && secondary.phone && secondary.phone !== primary.phone) {
      updates.phone2 = secondary.phone
    }
    if (!primary.email && secondary.email) updates.email = secondary.email
    if (!primary.lat && secondary.lat && secondary.lng) {
      updates.lat = secondary.lat
      updates.lng = secondary.lng
      updates.address = primary.address || secondary.address
    }
    if (Object.keys(updates).length > 0) {
      await pb
        .collection('customers')
        .update(primaryCustomerId, updates)
        .catch(() => {})
    }

    // 4. Excluir o cliente secundário após reatribuição completa de seus pedidos
    try {
      await pb.collection('customers').delete(secondaryCustomerId)
    } catch (delErr) {
      console.warn(
        'Erro ao deletar cliente secundário unificado, marcando inativo em notes:',
        delErr,
      )
      await pb
        .collection('customers')
        .update(secondaryCustomerId, {
          notes: `[UNIFICADO COM ${primary.name} (${primary.id})] ${secondary.notes || ''}`.trim(),
          phone: `UNIF_${secondary.phone || ''}`,
        })
        .catch(() => {})
    }

    return {
      success: true,
      reassignedOrdersCount: reassignedCount,
      message: `Unificação concluída com sucesso! ${reassignedCount} pedido(s) reatribuído(s) para "${primary.name}".`,
    }
  },

  async createCustomer(data: Partial<CustomerRecord>) {
    const activeCompanyId = data.empresa_id || this.getActiveCompanyId()
    const payload = {
      ...data,
      empresa_id: activeCompanyId,
    }
    return pb.collection<CustomerRecord>('customers').create(payload)
  },

  async updateCustomer(id: string, data: Partial<CustomerRecord>) {
    const updated = await pb.collection<CustomerRecord>('customers').update(id, data)

    // Se as coordenadas ou endereço foram alterados, sincronizar pedidos afetados
    // para QUALQUER pedido enfileirado/atribuído não entregue e não cancelado
    // (status != 'delivered' && status != 'cancelled') e recalcular o trajeto viário oficial da rota
    if (data.lat !== undefined || data.lng !== undefined || data.address !== undefined) {
      try {
        const affectedOrders = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `customer_id = '${id}' && status != 'delivered' && status != 'cancelled'`,
          requestKey: null,
        })
        const courierIdsToResequence = new Set<string>()
        for (const ord of affectedOrders) {
          const ordUpdate: Partial<OrderRecord> = {}
          if (data.lat !== undefined) ordUpdate.end_address_lat = Number(data.lat)
          if (data.lng !== undefined) ordUpdate.end_address_lng = Number(data.lng)
          if (data.address !== undefined) ordUpdate.end_address_text = data.address
          if (data.name !== undefined) ordUpdate.end_address_name = data.name
          await pb.collection('orders').update(ord.id, ordUpdate)
          if (ord.courier_id) {
            courierIdsToResequence.add(ord.courier_id)
          }
        }
        for (const courierId of courierIdsToResequence) {
          try {
            const res = await this.resequenceActiveRouteForCourier(
              courierId,
              null,
              false,
              'manual_command',
            )
            if (!res.success) {
              console.warn(
                '[updateCustomer] Resequenciamento retornou insucesso para courier:',
                courierId,
              )
            } else {
              // Notificar entregador da nova sequência
              await this.createNotification({
                user_id: courierId,
                title: '📍 Endereço de Cliente Atualizado na Rota',
                message:
                  'O endereço de um cliente na sua rota foi calibrado pela central e o trajeto foi reotimizado.',
                type: 'order',
                read: false,
              }).catch(() => {})
            }
          } catch (reseqErr) {
            console.error(
              '[updateCustomer] Erro ao resequenciar rota de courier:',
              courierId,
              reseqErr,
            )
          }
        }
      } catch (cascadeErr) {
        console.warn(
          '[updateCustomer] Erro ao sincronizar pedidos com novas coordenadas:',
          cascadeErr,
        )
      }
    }

    return updated
  },

  /**
   * Exclusão em cascata de cliente e seus registros vinculados (pedidos, avaliações, desvios e notificações).
   * Tenta via endpoint seguro atômico (/backend/v1/customers/:id/delete-cascade).
   * Caso o backend retorne erro de rota ou permissão, realiza fallback seguro via client SDK.
   */
  async deleteCustomerCascade(
    customerId: string,
  ): Promise<{ success: boolean; deletedOrdersCount: number }> {
    try {
      const res = await pb.send<{ success: boolean; message: string; deletedOrdersCount: number }>(
        `/backend/v1/customers/${customerId}/delete-cascade`,
        {
          method: 'POST',
        },
      )
      return { success: true, deletedOrdersCount: res.deletedOrdersCount || 0 }
    } catch (err) {
      console.warn('Fallback para exclusão client-side de cliente e pedidos:', err)

      // Fallback client-side se o endpoint falhar
      // 1. Buscar todos os pedidos vinculados a este cliente
      const linkedOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `customer_id = '${customerId}'`,
        requestKey: null,
      })

      // Regra: Bloquear apenas se houver entregas já entregues (histórico preservado)
      const deliveredOrders = linkedOrders.filter((o) => o.status === 'delivered')
      if (deliveredOrders.length > 0) {
        throw new Error(
          'Não é possível excluir o cliente pois ele possui entrega(s) já entregue(s) com comprovante preservado.',
        )
      }

      // 2. Excluir pedidos vinculados
      let deletedOrdersCount = 0
      for (const ord of linkedOrders) {
        try {
          // Excluir notificações ligadas ao pedido
          const notifs = await pb.collection('notifications').getFullList({
            filter: `order_id = '${ord.id}'`,
            requestKey: null,
          })
          for (const n of notifs) {
            await pb
              .collection('notifications')
              .delete(n.id)
              .catch(() => {})
          }
        } catch {
          /* intentionally ignored */
        }

        try {
          // Excluir avaliações ligadas ao pedido
          const revs = await pb.collection('reviews').getFullList({
            filter: `order_id = '${ord.id}'`,
            requestKey: null,
          })
          for (const r of revs) {
            await pb
              .collection('reviews')
              .delete(r.id)
              .catch(() => {})
          }
        } catch {
          /* intentionally ignored */
        }

        try {
          // Excluir desvios ligados ao pedido
          const off = await pb.collection('off_route_events').getFullList({
            filter: `order_id = '${ord.id}'`,
            requestKey: null,
          })
          for (const o of off) {
            await pb
              .collection('off_route_events')
              .delete(o.id)
              .catch(() => {})
          }
        } catch {
          /* intentionally ignored */
        }

        // (4) Se o pedido excluído em cascata não foi visitado, registrar cancelamento de km e auditar
        const hadVisit = Boolean(ord.delivery_time || ord.delivery_lat || ord.delivery_lng)
        const orderDistanceKm = Number(ord.distance_km) || 0
        if (!hadVisit && orderDistanceKm > 0) {
          try {
            await this.createAuditTrailEntry({
              order_id: ord.id,
              user_id: '',
              actor_name: 'Sistema',
              action: 'km_canceled_unvisited',
              old_value: String(orderDistanceKm),
              new_value: '0',
              metadata: {
                system_trigger: true,
                courier_id: ord.courier_id || '',
                tracking_code: ord.tracking_code,
                canceled_distance_km: orderDistanceKm,
                reason: 'deleteCustomerCascade - cliente excluído sem visita',
              },
            })
          } catch (auditErr) {
            console.warn(
              '[deleteCustomerCascade] Falha ao registrar audit_trail km_canceled_unvisited:',
              auditErr,
            )
          }

          // Se estava em rota de entregador, abater o km dos pedidos restantes do lote
          if (ord.courier_id) {
            try {
              const remainingCourierOrders = await pb
                .collection<OrderRecord>('orders')
                .getFullList({
                  filter: `courier_id='${ord.courier_id}' && id!='${ord.id}' && status!='cancelled' && route_finished!=true`,
                  requestKey: null,
                })
              for (const rem of remainingCourierOrders) {
                const currentTotal = Number(rem.total_route_with_return_km) || 0
                const newTotal = Math.max(0, Number((currentTotal - orderDistanceKm).toFixed(2)))
                await pb
                  .collection('orders')
                  .update(rem.id, {
                    total_route_with_return_km: newTotal,
                  })
                  .catch(() => {})
              }
            } catch (remErr) {
              console.warn(
                '[deleteCustomerCascade] Erro ao abater km de pedidos restantes do entregador:',
                remErr,
              )
            }
          }
        }

        await pb.collection('orders').delete(ord.id)
        deletedOrdersCount++
      }

      // 3. Excluir o cliente
      await pb.collection('customers').delete(customerId)

      return { success: true, deletedOrdersCount }
    }
  },

  // Users / Couriers / Sellers
  // Consulta direta à coleção users com role='courier' && status != 'inactive',
  // aceitando entregadores offline/idle/busy para viabilizar planejamento prévio de rota.
  // Preserva o status real do usuário logado (inclusive offline).
  async getCouriers(empresaId?: string) {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'
    const targetCompanyId =
      empresaId ||
      authUser?.empresa_id ||
      this.getActiveCompanyId() ||
      (await this.getMatrizCompanyId())

    const filters: string[] = ["role = 'courier'", "status != 'inactive'"]

    // Aplicar filtro por empresa_id quando o campo existir no registro do usuário ou contexto
    if (!isMaster || (empresaId && empresaId !== 'ALL')) {
      const userEmpresaId =
        authUser?.empresa_id || (empresaId !== 'ALL' ? targetCompanyId : undefined)
      if (userEmpresaId) {
        // users pode conter empresa_id ou o vínculo residir em membros
        // Para filtros do PocketBase em users, aplicamos empresa_id se existir no authUser
        if (authUser?.empresa_id) {
          filters.push(`empresa_id = '${authUser.empresa_id}'`)
        }
      }
    }

    const filterClause = filters.join(' && ')

    try {
      const list = await pb.collection<UserRecord>('users').getFullList({
        filter: filterClause,
        sort: '-created',
        requestKey: null,
      })

      const couriersMap = new Map<string, UserRecord>()
      for (const u of list) {
        if (u && u.id && !couriersMap.has(u.id)) {
          couriersMap.set(u.id, {
            ...u,
            vehicle_type: u.vehicle_type || 'moto',
            // Preserva o status real (idle, busy, offline, active) sem forçar tudo para 'active'
            status: u.status || 'offline',
          })
        }
      }

      return Array.from(couriersMap.values())
    } catch (err) {
      console.warn('Erro ao consultar users para getCouriers com filtro direto:', err)

      // Fallback tolerante: consulta apenas por role = 'courier' && status != 'inactive'
      try {
        const fallbackList = await pb.collection<UserRecord>('users').getFullList({
          filter: "role = 'courier' && status != 'inactive'",
          sort: '-created',
          requestKey: null,
        })

        const couriersMap = new Map<string, UserRecord>()
        for (const u of fallbackList) {
          if (u && u.id && !couriersMap.has(u.id)) {
            couriersMap.set(u.id, {
              ...u,
              vehicle_type: u.vehicle_type || 'moto',
              status: u.status || 'offline',
            })
          }
        }
        return Array.from(couriersMap.values())
      } catch (fallbackErr) {
        console.error('Falha crítica ao buscar entregadores em users:', fallbackErr)
        return []
      }
    }
  },

  async getSellers(empresaId?: string) {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'
    const targetCompanyId =
      empresaId || this.getActiveCompanyId() || (await this.getMatrizCompanyId())
    const isMatriz = await this.isMatrizCompany(targetCompanyId)

    if (isMaster && empresaId === 'ALL') {
      const allSellers = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'seller'",
        sort: '-created',
        requestKey: null,
      })
      const map = new Map<string, UserRecord>()
      for (const u of allSellers) {
        if (u && u.id && !map.has(u.id)) {
          map.set(u.id, u)
        }
      }
      return Array.from(map.values())
    }

    // 1. Resolução via coleção 'membros' (papel 'seller' ou 'vendedor' e ativo = true)
    // Tolerante a vínculos órfãos e deduplicado por user_id
    const sellersMap = new Map<string, UserRecord>()

    try {
      const members = await pb.collection<MembroRecord>('membros').getFullList({
        filter: `empresa_id = '${targetCompanyId}' && ativo = true && (papel = 'seller' || papel = 'vendedor')`,
        expand: 'user_id',
        sort: '-created',
        requestKey: null,
      })

      for (const m of members) {
        const u = m.expand?.user_id as UserRecord | undefined
        // Filtra defensivamente órfãos e valida papel do usuário
        if (u && u.id && (u.role === 'seller' || !u.role)) {
          if (!sellersMap.has(u.id)) {
            sellersMap.set(u.id, u)
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao filtrar sellers por membros:', e)
    }

    // Se já obteve vendedores a partir da tabela de membros, retorna
    if (sellersMap.size > 0) {
      return Array.from(sellersMap.values())
    }

    // 2. Consulta complementar e tolerância retroativa:
    // Atenção: a coleção 'users' NÃO possui coluna 'empresa_id' (o vínculo vive exclusivamente em 'membros').
    // Busca usuários com role = 'seller' e cruza com membros ativos para evitar vazamento entre empresas.
    try {
      const usersList = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'seller'",
        sort: '-created',
        requestKey: null,
      })

      // Buscar membros ativos de outras empresas para garantir que vendedores vinculados
      // exclusivamente a outras filiais não vazem
      let otherCompanyMemberUserIds = new Set<string>()
      if (!isMatriz) {
        try {
          const otherMembers = await pb.collection<MembroRecord>('membros').getFullList({
            filter: `empresa_id != '${targetCompanyId}' && ativo = true`,
            fields: 'user_id',
            requestKey: null,
          })
          otherCompanyMemberUserIds = new Set(otherMembers.map((m) => m.user_id))
        } catch (mErr) {
          console.warn('Aviso ao consultar membros de outras empresas:', mErr)
        }
      }

      for (const u of usersList) {
        if (
          u &&
          u.id &&
          !sellersMap.has(u.id) &&
          (!otherCompanyMemberUserIds.has(u.id) || isMatriz)
        ) {
          sellersMap.set(u.id, u)
        }
      }
    } catch (usersErr) {
      console.warn('Erro no fallback de sellers em users:', usersErr)
    }

    return Array.from(sellersMap.values())
  },

  async getAllUsers(empresaId?: string) {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'
    const targetCompanyId =
      empresaId || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    if (isMaster && empresaId === 'ALL') {
      const list = await pb.collection<UserRecord>('users').getFullList({
        sort: '-created',
        requestKey: null,
      })
      const map = new Map<string, UserRecord>()
      for (const u of list) {
        if (u && u.id && !map.has(u.id)) {
          map.set(u.id, u)
        }
      }
      return Array.from(map.values())
    }

    const usersMap = new Map<string, UserRecord>()

    try {
      const members = await pb.collection<MembroRecord>('membros').getFullList({
        filter: `empresa_id = '${targetCompanyId}' && ativo = true`,
        expand: 'user_id',
        sort: '-created',
        requestKey: null,
      })

      for (const m of members) {
        const u = m.expand?.user_id as UserRecord | undefined
        if (u && u.id && !usersMap.has(u.id)) {
          usersMap.set(u.id, u)
        }
      }

      if (usersMap.size > 0) {
        return Array.from(usersMap.values())
      }
    } catch (e) {
      console.warn('Erro ao filtrar users por membros:', e)
    }

    const isMatriz = await this.isMatrizCompany(targetCompanyId)
    if (isMatriz) {
      const list = await pb.collection<UserRecord>('users').getFullList({
        sort: '-created',
        requestKey: null,
      })
      for (const u of list) {
        if (u && u.id && !usersMap.has(u.id)) {
          usersMap.set(u.id, u)
        }
      }
      return Array.from(usersMap.values())
    }

    return []
  },

  async updateUser(id: string, data: Partial<UserRecord> | FormData) {
    return pb.collection<UserRecord>('users').update(id, data)
  },

  /**
   * Atualização de dados de usuário por um Administrador
   * Utiliza a rota administrativa segura (/backend/v1/admin/users/:id)
   * permitindo redefinição de senha sem oldPassword e validação estrita.
   */
  async adminUpdateUser(
    id: string,
    data: {
      name?: string
      email?: string
      phone?: string
      document?: string
      role?: 'admin' | 'seller' | 'courier'
      status?: string
      vehicle_type?: string
      vehicle_model?: string
      vehicle_plate?: string
      password?: string
    },
  ) {
    return pb.send<{
      id: string
      name: string
      email: string
      phone: string
      document?: string
      status: string
      role: string
      vehicle_type?: string
      vehicle_model?: string
      vehicle_plate?: string
      updated: string
    }>(`/backend/v1/admin/users/${id}`, {
      method: 'POST',
      body: data,
    })
  },

  async deleteUser(id: string) {
    return pb.collection<UserRecord>('users').delete(id)
  },

  async createUser(
    data:
      | {
          email: string
          password: string
          passwordConfirm: string
          name?: string
          role?: 'master' | 'admin' | 'seller' | 'courier'
          status?: 'active' | 'inactive' | 'pending' | 'idle' | 'busy'
          phone?: string
          document?: string
          vehicle_type?: string
          vehicle_model?: string
          vehicle_year?: number
          vehicle_plate?: string
          empresa_id?: string
          [key: string]: unknown
        }
      | FormData,
    targetEmpresaId?: string,
  ) {
    const activeCompanyId =
      targetEmpresaId ||
      (!(data instanceof FormData) ? (data.empresa_id as string | undefined) : undefined) ||
      this.getActiveCompanyId()

    // Se o usuário criado for courier ou usuário de empresa, validar limites de plano
    const requestedRole = !(data instanceof FormData) ? data.role : undefined
    const isCourier = requestedRole === 'courier'
    const limitCheck = await this.checkUserLimit(activeCompanyId, isCourier)
    if (!limitCheck.allowed) {
      throw new Error(limitCheck.message || 'Limite de usuários do plano atingido.')
    }

    let createdRecord: UserRecord
    if (data instanceof FormData) {
      // Garantir integridade de password e passwordConfirm
      const rawPassword = data.get('password')
      if (rawPassword && !data.has('passwordConfirm')) {
        data.append('passwordConfirm', rawPassword)
      }
      createdRecord = await pb.collection<UserRecord>('users').create(data)
    } else {
      const {
        empresa_id: _emp,
        username: _ignoredUsername,
        ...rest
      } = data as Record<string, unknown>
      const rawPassword = String(data.password || '').trim()
      const rawConfirm = String(data.passwordConfirm || data.password || '').trim()
      const payload: Record<string, unknown> = {
        ...rest,
        email: data.email.trim().toLowerCase(),
        password: rawPassword,
        passwordConfirm: rawConfirm || rawPassword,
      }

      // IMPORTANTE: A coleção users do PocketBase NÃO possui o campo username.
      // Nunca enviar username no payload para evitar erro 400 "Failed to create record."
      delete payload.username

      // Limpar vehicle_type e vehicle_plate para papéis que não sejam courier
      if (payload.role && payload.role !== 'courier') {
        delete payload.vehicle_type
        delete payload.vehicle_model
        delete payload.vehicle_year
        delete payload.vehicle_plate
      }

      createdRecord = await pb.collection<UserRecord>('users').create(payload)
    }

    // Vincular imediatamente o usuário na coleção membros da empresa ativa
    if (createdRecord?.id && activeCompanyId) {
      try {
        const papelMembro: MembroPapel =
          createdRecord.role === 'courier'
            ? 'entregador'
            : createdRecord.role === 'seller'
              ? 'vendedor'
              : 'admin'

        await pb.collection<MembroRecord>('membros').create({
          user_id: createdRecord.id,
          empresa_id: activeCompanyId,
          papel: papelMembro,
          ativo: true,
        })
      } catch (membroErr) {
        console.warn('Aviso: vínculo automático de membro falhou:', membroErr)
      }
    }

    return createdRecord
  },

  // Password Reset Native PocketBase
  async requestPasswordReset(email: string) {
    return pb.collection('users').requestPasswordReset(email.trim().toLowerCase())
  },

  async confirmPasswordReset(token: string, password: string, passwordConfirm: string) {
    return pb.collection('users').confirmPasswordReset(token.trim(), password, passwordConfirm)
  },

  /**
   * Troca a senha do próprio usuário logado com confirmação da senha atual.
   * Valida a senha atual reautenticando no PocketBase e em seguida atualiza
   * para a nova senha, mantendo ou renovando a sessão ativa.
   */
  async changeMyPassword(params: {
    currentPassword: string
    newPassword: string
    newPasswordConfirm: string
  }): Promise<{ success: boolean; message: string }> {
    const authUser = pb.authStore.record
    if (!authUser || !authUser.id) {
      throw new Error('Usuário não está autenticado.')
    }

    const email = (authUser.email || '').trim().toLowerCase()
    if (!email) {
      throw new Error('E-mail do usuário não identificado na sessão.')
    }

    const { currentPassword, newPassword, newPasswordConfirm } = params

    if (!currentPassword) {
      throw new Error('A senha atual é obrigatória.')
    }
    if (!newPassword || newPassword.length < 8) {
      throw new Error('A nova senha deve ter no mínimo 8 caracteres.')
    }
    if (newPassword !== newPasswordConfirm) {
      throw new Error('A confirmação da nova senha não confere.')
    }

    // 1. Reautenticar para validar a senha atual
    try {
      await pb.collection('users').authWithPassword(email, currentPassword)
    } catch (authErr) {
      console.warn('Falha na reautenticação com a senha atual:', authErr)
      throw new Error('A senha atual informada está incorreta.')
    }

    // 2. Atualizar a senha do usuário
    await pb.collection('users').update(authUser.id, {
      oldPassword: currentPassword,
      password: newPassword,
      passwordConfirm: newPasswordConfirm,
    })

    // 3. Reautenticar com a nova senha para manter a sessão ativa com o novo tokenKey
    try {
      await pb.collection('users').authWithPassword(email, newPassword)
    } catch (refreshErr) {
      console.warn('Sessão requer novo login após alteração de senha:', refreshErr)
    }

    return {
      success: true,
      message: 'Senha alterada com sucesso!',
    }
  },

  // Helper to build file URL from PocketBase record
  getFileUrl(record: UserRecord, filename: string) {
    if (!filename) return ''
    return pb.files.getURL(record, filename)
  },

  // Sanitização de telemetria de localização
  sanitizeLocationPayload(params: {
    userId: string
    lat: number
    lng: number
    speed?: number | null
    heading?: number | null
    batteryLevel?: number | null
    accuracy?: number | null
    gpsStatus?: string | null
    gpsReason?: string | null
    offlineBuffered?: boolean | null
  }): Partial<LocationRecord> {
    return sanitizeLocationPayload(params)
  },

  // Locations
  // minutesWindow padrão ampliado para 1440 min (24h) para cobrir integralmente lotes auditados do dia
  // Se minutesWindow for 0 ou nulo, busca sem restrição de janela temporal relativa
  async getLatestLocations(filter = '', sort = '-created', minutesWindow = 1440) {
    // Sanitização técnica: a coleção PocketBase 'locations' usa 'user_id', NÃO 'courier_id'
    const sanitizedFilter = (filter || '').replace(/\bcourier_id\b/g, 'user_id')
    let finalFilter = sanitizedFilter
    if (minutesWindow && minutesWindow > 0) {
      const windowStartIso = new Date(Date.now() - minutesWindow * 60 * 1000).toISOString()
      const timeFilter = `created >= '${windowStartIso}'`
      finalFilter = sanitizedFilter ? `(${sanitizedFilter}) && (${timeFilter})` : timeFilter
    }

    return pb.collection<LocationRecord>('locations').getFullList({
      filter: finalFilter,
      sort,
      expand: 'user_id',
      requestKey: null,
    })
  },

  /**
   * FUNÇÃO ÚNICA CANÔNICA DE BUSCA DE PINGS DE TELEMETRIA
   * Filtro estrito em locations por user_id do entregador + janela UTC [route_started_at, route_finished_at].
   * O campo é user_id, NUNCA courier_id (courier_id gera 400).
   */
  async fetchCourierRoutePings(params: {
    courierUserId: string
    routeStartedAt?: string | Date | null
    routeFinishedAt?: string | Date | null
  }): Promise<LocationRecord[]> {
    const cleanUserId = params.courierUserId ? String(params.courierUserId).trim() : ''
    if (!cleanUserId) return []

    const filters: string[] = [`user_id = '${cleanUserId}'`]

    const formatPbDate = (val: string | Date): string => {
      if (typeof val === 'string') {
        const trimmed = val.trim()
        // Converte "2026-10-13T22:34:00.000Z" para "2026-10-13 22:34:00"
        return trimmed
          .replace('T', ' ')
          .replace(/\.\d+Z?$/, '')
          .replace(/Z$/, '')
      }
      return val
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\d+Z?$/, '')
    }

    if (params.routeStartedAt) {
      const startStr = formatPbDate(params.routeStartedAt)
      filters.push(`created >= '${startStr}'`)
    }

    if (params.routeFinishedAt) {
      const endStr = formatPbDate(params.routeFinishedAt)
      filters.push(`created <= '${endStr}'`)
    }

    const combinedFilter = filters.join(' && ')

    try {
      const records = await pb.collection<LocationRecord>('locations').getFullList({
        filter: combinedFilter,
        sort: '+created',
        requestKey: null,
      })
      return records
    } catch (err: any) {
      console.warn('[fetchCourierRoutePings] Erro ao buscar pings por user_id e janela:', err)
      return []
    }
  },

  async getCourierLocations(courierId: string, startDate?: string | Date, endDate?: string | Date) {
    return this.fetchCourierRoutePings({
      courierUserId: courierId,
      routeStartedAt: startDate,
      routeFinishedAt: endDate,
    })
  },

  // Cache de último registro conhecido por usuário para deduplicação em memória
  _lastCourierLocationRecordMap: new Map<
    string,
    { id: string; lat: number; lng: number; accuracy?: number; timestamp: number }
  >(),

  async updateCourierLocation(
    userId: string,
    lat: number,
    lng: number,
    speed = 0,
    heading = 0,
    batteryLevel?: number | null,
    extra?: {
      gps_status?: 'active' | 'disabled' | 'offline' | string
      gps_reason?: string
      offline_buffered?: boolean
      accuracy?: number
    },
  ) {
    const now = Date.now()
    const sanitizedPayload = sanitizeLocationPayload({
      userId,
      lat,
      lng,
      speed,
      heading,
      batteryLevel,
      accuracy: extra?.accuracy,
      gpsStatus: extra?.gps_status,
      gpsReason: extra?.gps_reason,
      offlineBuffered: extra?.offline_buffered,
    })

    // Rejeição de saltos impossíveis (> 300 km/h implícito entre pings consecutivos)
    const prevCached = this._lastCourierLocationRecordMap.get(userId)
    if (prevCached && prevCached.timestamp) {
      const deltaSec = Math.max(1, (now - prevCached.timestamp) / 1000)
      const distMeters = haversineDistanceMeters(
        prevCached.lat,
        prevCached.lng,
        sanitizedPayload.lat!,
        sanitizedPayload.lng!,
      )
      const speedKmh = (distMeters / deltaSec) * 3.6
      if (speedKmh > 300) {
        console.warn('[TELEMETRIA] Salto impossível descartado (>300 km/h):', {
          speedKmh: Math.round(speedKmh),
          distMeters: Math.round(distMeters),
          deltaSec,
          prev: { lat: prevCached.lat, lng: prevCached.lng },
          next: { lat: sanitizedPayload.lat, lng: sanitizedPayload.lng },
        })
        throw new Error(
          `[sanitizeLocationPayload] Salto impossível de telemetria (${Math.round(speedKmh)} km/h)`,
        )
      }
    }

    // Deduplicação defensiva no cliente antes de criar novas linhas:
    // Se a posição mudou menos de ~10m OU a acurácia é >= 500m (sem fix / fallback de 2000m),
    // reutiliza/atualiza o registro recente existente em vez de criar outro registro repetido.
    const cached = this._lastCourierLocationRecordMap.get(userId)
    if (cached && cached.id) {
      const dist = haversineDistanceMeters(
        cached.lat,
        cached.lng,
        sanitizedPayload.lat!,
        sanitizedPayload.lng!,
      )
      const isWeakOrFallback =
        (sanitizedPayload.accuracy ?? 2000) >= 500 || (cached.accuracy ?? 2000) >= 500
      const isSubTenMeters = dist < 10

      if (isSubTenMeters || isWeakOrFallback) {
        try {
          const updated = await pb
            .collection<LocationRecord>('locations')
            .update(cached.id, sanitizedPayload)
          this._lastCourierLocationRecordMap.set(userId, {
            id: updated.id,
            lat: sanitizedPayload.lat!,
            lng: sanitizedPayload.lng!,
            accuracy: sanitizedPayload.accuracy,
            timestamp: now,
          })
          return updated
        } catch (err: any) {
          console.warn('[TELEMETRIA POCKETBASE 400/FAIL]', {
            status: err?.status,
            message: err?.message,
            fieldErrors: err?.data?.data || err?.data,
            payload: sanitizedPayload,
          })
          // Se o update falhar (ex: registro apagado 404 ou 400), limpa o cache e recria
          this._lastCourierLocationRecordMap.delete(userId)
          try {
            const createdFallback = await pb
              .collection<LocationRecord>('locations')
              .create(sanitizedPayload)
            this._lastCourierLocationRecordMap.set(userId, {
              id: createdFallback.id,
              lat: sanitizedPayload.lat!,
              lng: sanitizedPayload.lng!,
              accuracy: sanitizedPayload.accuracy,
              timestamp: now,
            })
            return createdFallback
          } catch (createFallbackErr: any) {
            console.warn('[TELEMETRIA POCKETBASE 400/FAIL]', {
              status: createFallbackErr?.status,
              message: createFallbackErr?.message,
              fieldErrors: createFallbackErr?.data?.data || createFallbackErr?.data,
              payload: sanitizedPayload,
            })
            throw createFallbackErr
          }
        }
      }
    }

    // Caso contrário (deslocamento real >= 10m com fix de GPS aceitável), cria novo ponto
    try {
      const created = await pb.collection<LocationRecord>('locations').create(sanitizedPayload)
      this._lastCourierLocationRecordMap.set(userId, {
        id: created.id,
        lat: sanitizedPayload.lat!,
        lng: sanitizedPayload.lng!,
        accuracy: sanitizedPayload.accuracy,
        timestamp: now,
      })
      return created
    } catch (createErr: any) {
      console.warn('[TELEMETRIA POCKETBASE 400/FAIL]', {
        status: createErr?.status,
        message: createErr?.message,
        fieldErrors: createErr?.data?.data || createErr?.data,
        payload: sanitizedPayload,
      })
      throw createErr
    }
  },

  async getLatestLocationForCourier(courierId: string) {
    try {
      const records = await pb.collection<LocationRecord>('locations').getList(1, 1, {
        filter: `user_id = '${courierId}'`,
        sort: '-created',
        requestKey: null,
      })
      return records.items[0] || null
    } catch {
      return null
    }
  },

  // Notifications
  async getNotifications(userId?: string, limit = 50) {
    const filter = userId ? `user_id = '${userId}' || user_id = ''` : ''
    const res = await pb.collection<NotificationRecord>('notifications').getList(1, limit, {
      filter,
      sort: '-created',
      requestKey: null,
    })
    return res.items
  },

  async markNotificationAsRead(id: string) {
    return pb.collection<NotificationRecord>('notifications').update(id, { read: true })
  },

  async markAllNotificationsAsRead(notifications: NotificationRecord[]) {
    await Promise.all(
      notifications
        .filter((n) => !n.read)
        .map((n) => pb.collection('notifications').update(n.id, { read: true })),
    )
  },

  async createNotification(data: Partial<NotificationRecord>) {
    return pb.collection<NotificationRecord>('notifications').create(data)
  },

  // App Settings (Fuel Price & Consumption)
  async getSettings(): Promise<AppSettingsRecord> {
    try {
      const records = await pb.collection<AppSettingsRecord>('app_settings').getList(1, 1, {
        filter: "key = 'global_settings'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return records.items[0]
      }
    } catch (e) {
      console.warn('Error fetching app_settings:', e)
    }

    // Default fallback
    return {
      id: 'default',
      key: 'global_settings',
      fuel_price_per_liter: 6.49,
      fuel_consumption_kml: 35.0,
      moto_fuel_price: 6.49,
      moto_consumption_kml: 35.0,
      carro_fuel_price: 6.49,
      carro_consumption_kml: 12.0,
      caminhao_fuel_price: 6.49,
      caminhao_consumption_kml: 7.0,
      work_start_time: '08:00',
      lunch_start_time: '12:00',
      lunch_end_time: '13:00',
      work_end_time: '18:30',
      created: '',
      updated: '',
      collectionId: '',
      collectionName: 'app_settings',
    } as AppSettingsRecord
  },

  // Helper para normalizar qualquer veículo para a categoria oficial ('moto' | 'carro' | 'caminhao' | 'bicicleta')
  normalizeVehicleCategory(vehicleType?: string): 'moto' | 'carro' | 'caminhao' | 'bicicleta' {
    if (!vehicleType) return 'moto'
    const lower = vehicleType.toLowerCase().trim()
    if (lower === 'bicycle' || lower === 'bicicleta' || lower === 'bike') return 'bicicleta'
    if (lower === 'carro' || lower === 'car' || lower === 'van') return 'carro'
    if (lower === 'caminhao' || lower === 'caminhão' || lower === 'truck') return 'caminhao'
    return 'moto'
  },

  // Helper para obter parâmetros de combustível de um determinado veículo/categoria
  // Item (I): app_settings permanece global (base única Pilar): leitura tolerante a uma futura chave opcional por base sem quebrar chave global
  getVehicleFuelParams(
    settings?: (Partial<AppSettingsRecord> & { base_key?: string; [k: string]: any }) | null,
    vehicleType?: string,
    baseKey?: string,
  ): {
    pricePerLiter: number
    consumptionKml: number
    category: 'moto' | 'carro' | 'caminhao' | 'bicicleta'
  } {
    const category = this.normalizeVehicleCategory(vehicleType)

    // Resolução tolerante a chave específica por base se existir no futuro (ex.: settings_pilar, base_fuel_price_per_liter)
    const effectiveBaseKey = baseKey || (settings as any)?.base_key
    const baseSpecificPrice = effectiveBaseKey
      ? (settings as any)?.[`price_${effectiveBaseKey}`]
      : undefined
    const baseFallbackPrice = baseSpecificPrice || settings?.fuel_price_per_liter || 6.49

    if (category === 'bicicleta') {
      return {
        category: 'bicicleta',
        pricePerLiter: 0,
        consumptionKml: 0,
      }
    }

    if (category === 'carro') {
      return {
        category: 'carro',
        pricePerLiter:
          (effectiveBaseKey && (settings as any)?.[`carro_fuel_price_${effectiveBaseKey}`]) ||
          settings?.carro_fuel_price ||
          baseFallbackPrice,
        consumptionKml:
          (effectiveBaseKey && (settings as any)?.[`carro_consumption_kml_${effectiveBaseKey}`]) ||
          settings?.carro_consumption_kml ||
          12.0,
      }
    }

    if (category === 'caminhao') {
      return {
        category: 'caminhao',
        pricePerLiter:
          (effectiveBaseKey && (settings as any)?.[`caminhao_fuel_price_${effectiveBaseKey}`]) ||
          settings?.caminhao_fuel_price ||
          baseFallbackPrice,
        consumptionKml:
          (effectiveBaseKey &&
            (settings as any)?.[`caminhao_consumption_kml_${effectiveBaseKey}`]) ||
          settings?.caminhao_consumption_kml ||
          7.0,
      }
    }

    // Default moto: segue app_settings tolerante a base (ou taxa padrão 30 km/L e R$ 6,49 conforme regra do sistema)
    const motoPrice =
      (effectiveBaseKey && (settings as any)?.[`moto_fuel_price_${effectiveBaseKey}`]) ||
      settings?.moto_fuel_price ||
      settings?.fuel_price_per_liter ||
      6.49
    const motoKml =
      (effectiveBaseKey && (settings as any)?.[`moto_consumption_kml_${effectiveBaseKey}`]) ||
      settings?.moto_consumption_kml ||
      settings?.fuel_consumption_kml ||
      30.0

    return {
      category: 'moto',
      pricePerLiter: motoPrice,
      consumptionKml: motoKml,
    }
  },

  // Site Content (Quem Somos e Contato editáveis pelo Admin)
  async getSiteContent(): Promise<SiteContentRecord> {
    const defaultSiteContent: SiteContentRecord = {
      id: 'default',
      key: 'main',
      about_title: 'Tecnologia que move cada entrega',
      about_subtitle:
        'A Rotaly nasceu com um objetivo claro: simplificar a logística urbana de ponta a ponta.',
      about_paragraph_1:
        'Unimos inteligência de rotas viárias, telemetria em tempo real e comprovantes digitais em uma plataforma unificada. Do momento em que o pedido sai do balcão até a assinatura do cliente final, garantimos transparência total, redução de até 40% nos gastos com combustível e previsibilidade para operadores e lojistas.',
      about_paragraph_2:
        'Nossa tecnologia foi desenhada para o dinamismo do dia a dia de farmácias, comércios locais e distribuidoras. Sem atritos, sem planilhas soltas e sem retrabalho, conectamos administradores, gestores de despacho e entregadores de forma intuitiva e eficiente.',
      about_paragraph_3:
        'Com sede no Rio de Janeiro e atendimento em expansão por todo o Brasil, colocamos controle operacional, auditoria de quilometragem e tranquilidade ao alcance de frotas de todos os tamanhos.',
      phone: '(21) 4000-1234',
      whatsapp: '21999999999',
      email: 'contato@rotaly.com.br',
      address: 'Rio de Janeiro - RJ, Brasil',
      opening_hours: 'Segunda a Sábado, das 08:00 às 20:00',
      facebook_url: 'https://facebook.com',
      instagram_url: 'https://instagram.com',
      linkedin_url: 'https://linkedin.com',
      created: '',
      updated: '',
      collectionId: '',
      collectionName: 'site_content',
    }

    try {
      const records = await pb.collection<SiteContentRecord>('site_content').getList(1, 1, {
        filter: "key = 'main'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return {
          ...defaultSiteContent,
          ...records.items[0],
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar site_content:', e)
    }

    return defaultSiteContent
  },

  async updateSiteContent(data: Partial<SiteContentRecord>): Promise<SiteContentRecord> {
    try {
      const records = await pb.collection<SiteContentRecord>('site_content').getList(1, 1, {
        filter: "key = 'main'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return await pb
          .collection<SiteContentRecord>('site_content')
          .update(records.items[0].id, data)
      } else {
        return await pb.collection<SiteContentRecord>('site_content').create({
          key: 'main',
          ...data,
        })
      }
    } catch (e) {
      console.error('Erro ao salvar site_content:', e)
      throw e
    }
  },

  async updateSettings(data: Partial<AppSettingsRecord>) {
    try {
      let existingRecord: AppSettingsRecord | null = null
      try {
        existingRecord = await pb
          .collection<AppSettingsRecord>('app_settings')
          .getFirstListItem("key = 'global_settings'", { requestKey: null })
      } catch {
        existingRecord = null
      }

      if (existingRecord?.id) {
        try {
          return await pb
            .collection<AppSettingsRecord>('app_settings')
            .update(existingRecord.id, data)
        } catch (updateErr: any) {
          if (updateErr?.status === 404 || updateErr?.status === 400) {
            return await pb.collection<AppSettingsRecord>('app_settings').create({
              key: 'global_settings',
              ...data,
            })
          }
          throw updateErr
        }
      } else {
        return await pb.collection<AppSettingsRecord>('app_settings').create({
          key: 'global_settings',
          ...data,
        })
      }
    } catch (e) {
      console.error('Error updating app_settings:', e)
      throw e
    }
  },

  // Cache em memória da base ativa para evitar consultas redundantes e garantir paridade instantânea
  _activeBaseCache: null as { lat: number; lng: number; name?: string; address?: string } | null,
  _activeBaseCacheTime: 0,

  async getActiveBaseCoordinate(
    empresaId?: string,
  ): Promise<{ lat: number; lng: number; name: string; address?: string }> {
    const now = Date.now()
    if (this._activeBaseCache && now - this._activeBaseCacheTime < 60_000) {
      return this._activeBaseCache as { lat: number; lng: number; name: string; address?: string }
    }
    try {
      const bases = await this.getBaseAddresses(empresaId)
      const active = bases.find((b) => b.is_default) || bases[0]
      if (
        active &&
        typeof active.lat === 'number' &&
        typeof active.lng === 'number' &&
        !isNaN(active.lat) &&
        !isNaN(active.lng)
      ) {
        this._activeBaseCache = {
          lat: active.lat,
          lng: active.lng,
          name: active.name || 'Base Operacional',
          address: active.address || '',
        }
        this._activeBaseCacheTime = now
        return this._activeBaseCache as { lat: number; lng: number; name: string; address?: string }
      }
    } catch (err) {
      console.warn('[deliveryService] Falha ao carregar base ativa:', err)
    }
    // Fallback canônico oficial Drogaria Mais Saudável Pilar
    return {
      lat: -22.6977499,
      lng: -43.2936013,
      name: 'Mais Saudável',
      address: 'Pilar',
    }
  },

  // Base Addresses Management (Cadastro de Base da Empresa / Loja e Endereço Final)
  /**
   * Dispara alerta na Central (admin/toast) e registra falha de resequenciamento
   */
  notifyResequenceFailure(detail: { courierId?: string; courierName?: string; error?: string }) {
    if (typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent('rotaly_resequence_failed', {
            detail: {
              ...detail,
              timestamp: new Date().toISOString(),
            },
          }),
        )
      } catch {
        /* ignore */
      }
    }
  },

  async getBaseAddresses(empresaId?: string): Promise<BaseAddressRecord[]> {
    const targetCompanyId = empresaId || this.getActiveCompanyId()
    try {
      const filterClause = this.getCompanyFilterClause('empresa_id', targetCompanyId)
      const records = await pb.collection<BaseAddressRecord>('base_addresses').getFullList({
        filter: filterClause || undefined,
        sort: '-is_default,name',
        requestKey: null,
      })
      if (records.length > 0) return records
    } catch (err) {
      console.warn('Could not fetch base_addresses from pb:', err)
    }

    return [
      {
        id: '811cpvr0g77m9ue',
        name: 'Mais Saudavel',
        type: 'base',
        address: 'Rua da Fortuna, 13 - Pilar, Duque de Caxias (ao lado do Mercado Charuto)',
        street: 'Rua da Fortuna, 13',
        neighborhood: 'Pilar',
        city: 'Duque de Caxias',
        state: 'RJ',
        postal_code: '25230-085',
        lat: -22.6977499,
        lng: -43.2936013,
        is_default: true,
        is_end_default: true,
        empresa_id: (await getMatrizCompanyId()) || '',
        collectionId: 'base_addresses',
        collectionName: 'base_addresses',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    ]
  },

  async createBaseAddress(data: Partial<BaseAddressRecord>): Promise<BaseAddressRecord> {
    const activeCompanyId = this.getActiveCompanyId()
    return pb.collection<BaseAddressRecord>('base_addresses').create({
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
      created_by: pb.authStore.record?.id || '',
    })
  },

  async updateBaseAddress(
    id: string,
    data: Partial<BaseAddressRecord>,
  ): Promise<BaseAddressRecord> {
    return pb.collection<BaseAddressRecord>('base_addresses').update(id, data)
  },

  async deleteBaseAddress(id: string): Promise<boolean> {
    return pb.collection('base_addresses').delete(id)
  },

  // Route Lifecycle (Liberar Rota pelo Vendedor, Iniciar Rota pelo Entregador, Ida e Volta, Desvios)
  async releaseRouteForOrders(
    orderIds: string[],
    courierId?: string,
  ): Promise<{ success: boolean; updatedCount: number }> {
    try {
      const now = new Date().toISOString()
      let ordersToUpdate: OrderRecord[] = []

      if (orderIds && orderIds.length > 0) {
        const filter = orderIds.map((id) => `id='${id}'`).join(' || ')
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter,
          expand: 'customer_id',
          requestKey: null,
        })
      } else if (courierId) {
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && (status='assigned' || status='pending' || status='in_transit')`,
          expand: 'customer_id',
          requestKey: null,
        })
      }

      // Regra de Validação de KM Viário Oficial na Liberação:
      // ANTES de aplicar route_released = true, inspecionar todas as ordens do lote.
      // Se alguma tem distance_km 0 ou nulo, rodar optimizeRouteSequence / resequenceActiveRouteForCourier do lote para preencher.
      // Se o recálculo falhar ou a parada persistir com 0,0, BLOQUEAR a liberação com mensagem clara citando a parada problemática.
      const couriersToValidate = Array.from(
        new Set(
          [courierId, ...ordersToUpdate.map((o) => o.courier_id)].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      )

      for (const targetCourier of couriersToValidate) {
        // Pedidos deste courier no lote a liberar
        const courierBatchOrders = ordersToUpdate.filter((o) => o.courier_id === targetCourier)
        const hasZeroKm = courierBatchOrders.some(
          (o) => !o.distance_km || Number(o.distance_km) <= 0,
        )

        if (hasZeroKm) {
          console.log(
            `[releaseRouteForOrders] Parada com KM viário 0,0 detectada para o entregador ${targetCourier}. Executando recálculo viário oficial antes de liberar...`,
          )
          let reseqSuccess = false
          try {
            const reseqRes = await this.resequenceActiveRouteForCourier(
              targetCourier,
              null,
              false,
              'manual_command',
            )
            reseqSuccess = reseqRes.success && reseqRes.sequencedCount > 0
          } catch (reseqErr) {
            console.error('[releaseRouteForOrders] Falha no recálculo automático:', reseqErr)
            reseqSuccess = false
          }

          // Recarregar os pedidos do lote para verificar se foram preenchidos
          const reloadedOrders = await pb.collection<OrderRecord>('orders').getFullList({
            filter: courierBatchOrders.map((o) => `id='${o.id}'`).join(' || '),
            expand: 'customer_id',
            requestKey: null,
          })

          const stillZero = reloadedOrders.find((o) => !o.distance_km || Number(o.distance_km) <= 0)
          if (stillZero || !reseqSuccess) {
            const problemOrder =
              stillZero ||
              courierBatchOrders.find((o) => !o.distance_km || Number(o.distance_km) <= 0)
            const cust =
              (problemOrder?.expand?.customer_id as CustomerRecord | undefined) ||
              problemOrder?.end_address_name ||
              'Cliente'
            const custName = typeof cust === 'string' ? cust : cust?.name || 'Cliente'
            const code = problemOrder?.tracking_code || problemOrder?.id || 'pedido'
            throw new Error(
              `Não foi possível liberar a rota: a parada ${code} (${custName}) está com KM viário 0,0. O recálculo automático falhou. Verifique o endereço antes de liberar.`,
            )
          }

          // Atualizar a referência de ordersToUpdate com os valores recalculados
          ordersToUpdate = ordersToUpdate.map((orig) => {
            const fresh = reloadedOrders.find((r) => r.id === orig.id)
            return fresh || orig
          })
        }
      }

      // Regra: "ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL"
      // Verificar se algum entregador envolvido possui pedidos em andamento (route_started=true e route_finished!=true)
      const targetCourierIds = Array.from(
        new Set(
          [courierId, ...ordersToUpdate.map((o) => o.courier_id)].filter((id): id is string =>
            Boolean(id),
          ),
        ),
      )

      let updatedCount = 0
      for (const order of ordersToUpdate) {
        // Regra do Usuário: "não precisa bloquear o entregador para vendedor. apenas não deixar a rota entrar no app do entregador enquanto ele estiver na rota atual"
        // O vendedor pode liberar e organizar rotas a qualquer momento. No app do entregador, entra em fila de espera.
        await pb.collection('orders').update(order.id, {
          route_released: true,
          route_released_at: order.route_released_at || now,
        })
        updatedCount++
      }

      // Notificar o entregador se houver
      const targetCourier = courierId || ordersToUpdate[0]?.courier_id
      if (targetCourier && updatedCount > 0) {
        try {
          await this.createNotification({
            user_id: targetCourier,
            title: '🚀 Rota Liberada pelo Vendedor!',
            message: `Sua rota com ${updatedCount} entrega(s) foi liberada e está disponível no seu app.`,
            type: 'order',
            read: false,
          })
        } catch {
          /* intentionally ignored */
        }
      }

      return { success: true, updatedCount }
    } catch (err) {
      console.error('Error releasing route for orders:', err)
      throw err
    }
  },

  async startCourierRoute(
    courierId: string,
    orderIds?: string[],
    odometerData?: {
      odometro_inicial?: number
      foto_odometro_inicial?: File | null
    },
  ): Promise<{ success: boolean; updatedCount: number }> {
    try {
      const now = new Date().toISOString()
      let ordersToUpdate: OrderRecord[] = []

      if (orderIds && orderIds.length > 0) {
        const filter = orderIds.map((id) => `id='${id}'`).join(' || ')
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter,
          requestKey: null,
        })
      } else {
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && (status='assigned' || status='in_transit' || status='picked_up')`,
          requestKey: null,
        })
      }

      // Calcular carimbo canônico unificado para todos os pedidos da rota iniciada,
      // impedindo herança indevida de chave residual de sessão anterior.
      const startedAtIso = now
      const startMin = Math.floor(new Date(startedAtIso).getTime() / 60000)
      const dayKey = startedAtIso.slice(0, 10).replace(/-/g, '')
      const canonicalKey = `rb_${courierId}_${dayKey}_${startMin}`

      let updatedCount = 0
      for (const order of ordersToUpdate) {
        const hasFile = !!odometerData?.foto_odometro_inicial
        const hasOdom =
          typeof odometerData?.odometro_inicial === 'number' && odometerData.odometro_inicial > 0
        if (hasFile || hasOdom) {
          const formData = new FormData()
          formData.append('route_started', 'true')
          formData.append('route_started_at', order.route_started_at || startedAtIso)
          formData.append('route_batch_key', canonicalKey)
          formData.append('status', order.status === 'assigned' ? 'in_transit' : order.status)
          if (hasOdom) {
            formData.append('odometro_inicial', String(odometerData!.odometro_inicial))
          }
          if (hasFile) {
            formData.append('foto_odometro_inicial', odometerData!.foto_odometro_inicial!)
          }
          await pb.collection('orders').update(order.id, formData)
        } else {
          await pb.collection('orders').update(order.id, {
            route_started: true,
            route_started_at: order.route_started_at || startedAtIso,
            route_batch_key: canonicalKey,
            status: order.status === 'assigned' ? 'in_transit' : order.status,
          })
        }
        updatedCount++
      }

      // Marcar o status do entregador como ocupado ('busy')
      try {
        await pb.collection('users').update(courierId, {
          status: 'busy',
        })
      } catch (userErr) {
        console.warn('Não foi possível atualizar status do entregador para busy:', userErr)
      }

      return { success: true, updatedCount }
    } catch (err) {
      console.error('Error starting courier route:', err)
      throw err
    }
  },

  // Finalizar a Rota Inteira ao Retornar à Base
  // Regra: "O APP DO ENTREGADOR PRECISA FINALIZAR CADA ENTREGA E NO FINAL DA BASE PONTO DE CHEGADA ELE FINALIZA ROTA INTEIRA. ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL."
  // Item (G): Antes do fechamento, forçar offlineTelemetryBuffer.flush() com retries determinísticos até confirmar ou esgotar.
  // Se sobrar ping não enviado: flag de pings pendentes no lote + registro em audit_trail (user_id='', actor_name='Sistema', metadata.system_trigger=true).
  async finishCourierRoute(
    courierId: string,
    orderIds?: string[],
    odometerData?: {
      odometro_final?: number
      foto_odometro_final?: File | null
    },
    routeBatchKey?: string,
    options?: {
      origin?: 'manual_com_gps' | 'manual_sem_gps' | 'geofence_automatico' | string
      latitude?: number | null
      longitude?: number | null
      distanceToBaseMeters?: number | null
    },
  ): Promise<{ success: boolean; updatedCount: number; pendingPingsRemaining?: number }> {
    try {
      const now = new Date().toISOString()
      let ordersToUpdate: OrderRecord[] = []

      // (G) FLUSH FORÇADO COM RETRIES DETERMINÍSTICOS (buffer REAL em IndexedDB/400 pings)
      let remainingPings = 0
      try {
        const { offlineTelemetryBuffer } = await import('@/services/offlineTelemetryBuffer')
        let flushSuccess = false
        const maxRetries = 3

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
            const flushResult = await offlineTelemetryBuffer.flush(courierId)
            remainingPings = flushResult.remaining
            if (remainingPings === 0) {
              flushSuccess = true
              break
            }
          } catch (eFlush) {
            console.warn(
              `[deliveryService] Tentativa ${attempt} de flush antes de finalizar lote falhou:`,
              eFlush,
            )
          }
          if (attempt < maxRetries) {
            // Pequeno intervalo determinístico antes da próxima tentativa
            await new Promise((res) => setTimeout(res, 500 * attempt))
          }
        }

        // Se após retries ainda restar pings no buffer offline
        if (!flushSuccess && remainingPings > 0) {
          console.warn(
            `[deliveryService] Finalização de lote com ${remainingPings} pings offline retidos no buffer. Gravando flag e audit_trail.`,
          )
        }
      } catch (eBuffer) {
        console.warn('[deliveryService] Erro ao tentar forçar flush de telemetria:', eBuffer)
      }

      if (orderIds && orderIds.length > 0) {
        const filter = orderIds.map((id) => `id='${id}'`).join(' || ')
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter,
          requestKey: null,
        })
      } else {
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && route_started=true && route_finished!=true`,
          requestKey: null,
        })
      }

      let updatedCount = 0
      for (const order of ordersToUpdate) {
        const isDelivered = order.status === 'delivered'
        const hasFile = !!odometerData?.foto_odometro_final
        const odomFinal = odometerData?.odometro_final
        const hasOdom = typeof odomFinal === 'number' && odomFinal > 0

        // Regra de ouro estrutural: NENHUMA parada não entregue pode ser marcada como delivered.
        // Paradas não confirmadas voltam para pending, courier_id: null, sequence: null,
        // route_released: false, route_started: false (mesma regra de devolução de cancelamento de rota).
        const pendingNote =
          remainingPings > 0
            ? `${order.notes || ''} [pings_offline_pendentes: ${remainingPings}]`.trim()
            : order.notes

        if (!isDelivered) {
          await pb.collection('orders').update(order.id, {
            courier_id: null,
            status: 'pending',
            sequence: null,
            route_released: false,
            route_released_at: null,
            route_started: false,
            route_started_at: null,
            route_finished: false,
            route_finished_at: null,
          })
        } else {
          if (hasFile || hasOdom) {
            const formData = new FormData()
            formData.append('route_finished', 'true')
            formData.append('route_finished_at', now)
            if (pendingNote) {
              formData.append('notes', pendingNote)
            }
            if (hasOdom) {
              formData.append('odometro_final', String(odomFinal))
              const odomInit = order.odometro_inicial || 0
              if (odomInit > 0 && odomFinal! > odomInit) {
                const diff = Number((odomFinal! - odomInit).toFixed(1))
                formData.append('km_odometro', String(diff))
              }
            }
            if (hasFile) {
              formData.append('foto_odometro_final', odometerData!.foto_odometro_final!)
            }
            await pb.collection('orders').update(order.id, formData)
          } else {
            await pb.collection('orders').update(order.id, {
              route_finished: true,
              route_finished_at: now,
              notes: pendingNote,
            })
          }
        }
        updatedCount++
      }

      // (G) Se sobrar ping não enviado: registro em audit_trail com user_id='', actor_name='Sistema', metadata.system_trigger=true
      if (remainingPings > 0) {
        try {
          const bKey =
            routeBatchKey ||
            ordersToUpdate[0]?.route_batch_key ||
            `batch_${courierId}_${now.slice(0, 10)}`
          const firstOrdId = ordersToUpdate[0]?.id || ''
          await pb.collection('audit_trail').create({
            user_id: '',
            collection: 'orders',
            record_id: firstOrdId,
            courier_id: courierId,
            action: 'telemetria_pings_offline_pendentes',
            field: 'telemetria_buffer',
            old_value: `${remainingPings} pings retidos no buffer IndexedDB`,
            new_value: 'Lote concluído com pings pendentes de sincronização',
            timestamp: now,
            metadata: {
              system_trigger: true,
              actor_name: 'Sistema',
              alerta: 'PING OFFLINE PENDENTE',
              route_batch_key: bKey,
              remaining_pings: remainingPings,
              note: 'Buffer de telemetria retido no aparelho do entregador após retries determinísticos',
            },
          })
        } catch (eAudit) {
          console.warn(
            '[deliveryService] Falha ao registrar audit_trail de pings pendentes:',
            eAudit,
          )
        }
      }

      // Registrar encerramento da rota em audit_trail (com origem: manual_com_gps, manual_sem_gps ou geofence_automatico)
      try {
        const bKey =
          routeBatchKey ||
          ordersToUpdate[0]?.route_batch_key ||
          `batch_${courierId}_${now.slice(0, 10)}`
        const firstOrdId = ordersToUpdate[0]?.id || ''
        const closureOrigin = options?.origin || 'manual_sem_gps'
        await pb.collection('audit_trail').create({
          user_id: '',
          collection: 'orders',
          record_id: firstOrdId,
          courier_id: courierId,
          action: 'finalizar_rota',
          field: 'route_finished',
          old_value: 'false',
          new_value: 'true',
          timestamp: now,
          metadata: {
            system_trigger: true,
            actor_name: 'Sistema',
            closure_origin: closureOrigin,
            route_batch_key: bKey,
            orders_count: updatedCount,
            latitude: options?.latitude ?? null,
            longitude: options?.longitude ?? null,
            distance_to_base_meters: options?.distanceToBaseMeters ?? null,
            note:
              closureOrigin === 'manual_sem_gps'
                ? 'Finalização manual de rota realizada sem coordenadas GPS frescas pelo entregador'
                : closureOrigin === 'geofence_automatico'
                  ? 'Finalização automática de rota disparada por geofence ao aproximar da base'
                  : 'Finalização manual de rota com coordenadas GPS registradas',
          },
        })
      } catch (eAuditClose) {
        console.warn(
          '[deliveryService] Falha ao registrar audit_trail de finalização da rota:',
          eAuditClose,
        )
      }

      // Liberar o entregador de volta para disponível ('active')
      try {
        await pb.collection('users').update(courierId, {
          status: 'active',
        })
      } catch (userErr) {
        console.warn('Não foi possível atualizar status do entregador para active:', userErr)
      }

      return { success: true, updatedCount, pendingPingsRemaining: remainingPings }
    } catch (err) {
      console.error('Error finishing courier route:', err)
      throw err
    }
  },

  /**
   * Resequenciar e Otimizar Viariamente a Rota Inteira de um Entregador
   * Executa o motor viário inteligente (Google Directions + trava de mesma rua + 2-Opt)
   * e persiste os valores atualizados de sequence (1, 2, 3...) e métricas viárias
   * recalculadas em cada pedido (distance_km, return_trip_km, total_route_with_return_km, fuel_cost, ETA).
   */
  async resequenceActiveRouteForCourier(
    courierId: string,
    settings?: Partial<AppSettingsRecord> | null,
    isRetry = false,
    origin?: string,
  ): Promise<{
    success: boolean
    reason?: string
    keptCurrent?: boolean
    sequencedCount: number
    totalDistanceKm: number
  }> {
    if (origin !== 'manual_command') {
      return {
        success: false,
        reason: 'unauthorized_auto_trigger',
        sequencedCount: 0,
        totalDistanceKm: 0,
      }
    }

    // Verificação defensiva de papel: entregadores não podem reordenar ou otimizar rotas (decisão de produto soberana)
    const currentAuthRecord = pb.authStore.record as any
    const currentRole = currentAuthRecord?.role || currentAuthRecord?.papel
    if (currentRole === 'courier' || currentRole === 'entregador') {
      console.warn(
        `[deliveryService] resequenceActiveRouteForCourier bloqueado: papel '${currentRole}' não tem permissão para alterar ordem viária.`,
      )
      return { success: false, sequencedCount: 0, totalDistanceKm: 0 }
    }

    try {
      const { optimizeRouteSequence, sequenceStopsWithDeterministicTsp } =
        await import('@/services/intelligentRoadRouter')

      // 1. Obter entregador
      const courier = await pb.collection<UserRecord>('users').getOne(courierId)

      // 2. Obter pedidos ativos desse entregador (nunca mexe no TRK-2026-622)
      const rawCourierOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished!=true && tracking_code!='TRK-2026-622'`,
        sort: 'sequence,created',
        expand: 'customer_id',
        requestKey: null,
      })

      // Desempate determinístico rigoroso por created para eliminar qualquer sequência duplicada pré-existente
      const courierOrders = [...rawCourierOrders].sort((a, b) => {
        const seqA =
          a.sequence !== null && a.sequence !== undefined && a.sequence > 0 ? a.sequence : Infinity
        const seqB =
          b.sequence !== null && b.sequence !== undefined && b.sequence > 0 ? b.sequence : Infinity
        if (seqA !== seqB) return seqA - seqB
        const timeA = new Date(a.created || 0).getTime()
        const timeB = new Date(b.created || 0).getTime()
        if (timeA !== timeB) return timeA - timeB
        return a.id.localeCompare(b.id)
      })

      if (courierOrders.length === 0) {
        return { success: true, sequencedCount: 0, totalDistanceKm: 0 }
      }

      // 3. Obter base ativa padrão ou primeira configurada (autoridade canônica do retorno à base)
      const bases = await this.getBaseAddresses()
      const defaultBase = bases.find((b) => b.is_default) || bases[0]
      // Constante BASE oficial explícita para garantir destino = base oficial soberana
      const OFFICIAL_BASE_COORDS = {
        lat: defaultBase?.lat || -22.6977499,
        lng: defaultBase?.lng || -43.2936013,
      }
      const originPoint = {
        lat: defaultBase?.lat || courierOrders[0]?.start_base_lat || OFFICIAL_BASE_COORDS.lat,
        lng: defaultBase?.lng || courierOrders[0]?.start_base_lng || OFFICIAL_BASE_COORDS.lng,
      }
      // BLINDAGEM: O destino da perna final de retorno é SEMPRE originPoint (base oficial),
      // NUNCA courierOrders[0].end_address ou qualquer endereço de cliente
      const destinationPoint: { lat: number; lng: number } = {
        lat: originPoint.lat,
        lng: originPoint.lng,
      }
      const { pricePerLiter, consumptionKml } = this.getVehicleFuelParams(
        settings,
        courier.vehicle_type,
      )

      // 4. Montar paradas candidatas para o motor viário
      const candidates = courierOrders.map((ord) => {
        const cust = ord.expand?.customer_id as CustomerRecord | undefined
        const lat = cust?.lat || ord.end_address_lat || originPoint.lat
        const lng = cust?.lng || ord.end_address_lng || originPoint.lng
        const address = cust?.address || ord.end_address_text || ''
        const name = cust?.name || ord.end_address_name || 'Cliente'

        return {
          id: ord.id,
          tracking_code: ord.tracking_code,
          priority: ord.priority || 'normal',
          status: ord.status,
          customer_name: name,
          address: address,
          lat: Number(lat),
          lng: Number(lng),
          rawOrder: ord,
          rawCustomer: cust,
          created: ord.created,
        }
      })

      // 5. Executar o motor viário inteligente (Google Directions + mesma rua + fallback 2-Opt)
      let roadResult
      try {
        roadResult = await optimizeRouteSequence({
          origin: originPoint,
          destination: destinationPoint,
          stops: candidates,
          vehicleType: courier.vehicle_type,
          pricePerLiter,
          consumptionKml,
        })
      } catch (optErr) {
        console.warn(
          '[deliveryService] optimizeRouteSequence falhou, acionando fallback determinístico 2-Opt local:',
          optErr,
        )
        // Fallback robusto garantido com sequenceStopsWithDeterministicTsp
        const orderedFallback = sequenceStopsWithDeterministicTsp(
          originPoint,
          destinationPoint,
          candidates,
        )
        let fallbackOutboundMeters = 0
        let prevLat = originPoint.lat
        let prevLng = originPoint.lng
        const stopsWithStep = orderedFallback.map((s, idx) => {
          const direct = Math.sqrt(
            Math.pow((s.lat - prevLat) * 111000, 2) +
              Math.pow((s.lng - prevLng) * 111000 * Math.cos((originPoint.lat * Math.PI) / 180), 2),
          )
          const stepMeters = Math.round(direct)
          fallbackOutboundMeters += stepMeters
          prevLat = s.lat
          prevLng = s.lng
          return {
            ...s,
            sequence: idx + 1,
            step_distance_meters: stepMeters,
            cumulative_distance_meters: fallbackOutboundMeters,
            step_duration_seconds: Math.round((stepMeters / 1000) * 160 + 300),
          }
        })
        const returnMeters = Math.round(
          Math.sqrt(
            Math.pow((prevLat - destinationPoint.lat) * 111000, 2) +
              Math.pow(
                (prevLng - destinationPoint.lng) *
                  111000 *
                  Math.cos((originPoint.lat * Math.PI) / 180),
                2,
              ),
          ),
        )
        const totalDistKm = Number(((fallbackOutboundMeters + returnMeters) / 1000).toFixed(2))
        const returnDistKm = Number((returnMeters / 1000).toFixed(2))
        const isBicycleCourier = this.normalizeVehicleCategory(courier.vehicle_type) === 'bicicleta'
        const effectiveCons = isBicycleCourier
          ? 0
          : consumptionKml > 0
            ? consumptionKml
            : courier.vehicle_type === 'moto'
              ? 32
              : 10
        const totalFuel =
          !isBicycleCourier && effectiveCons > 0 && pricePerLiter > 0
            ? (totalDistKm * pricePerLiter) / effectiveCons
            : 0

        roadResult = {
          stops: stopsWithStep,
          total_distance_km: totalDistKm,
          outbound_distance_km: Number((fallbackOutboundMeters / 1000).toFixed(2)),
          return_distance_km: returnDistKm,
          estimated_duration_minutes: Math.round(totalDistKm * 3.5 + candidates.length * 5),
          estimated_fuel_cost: Number(totalFuel.toFixed(2)),
          isRealStreetRoute: false,
        }
      }

      // (3) PROIBIDO ROTA COM PREJUÍZO:
      // Se proposedTotalDistanceKm > currentRouteTotalDistanceKm (km viário real), abortar e MANTER a sequência atual
      const currentRouteTotalDistanceKm = courierOrders.reduce((max, o) => {
        const val = Number(o.total_route_with_return_km) || 0
        return Math.max(max, val)
      }, 0)

      if (
        currentRouteTotalDistanceKm > 0 &&
        roadResult.total_distance_km > currentRouteTotalDistanceKm
      ) {
        console.warn(
          `[deliveryService] Proibido rota com prejuízo: proposto ${roadResult.total_distance_km} km > atual ${currentRouteTotalDistanceKm} km. Mantendo sequência atual.`,
        )
        return {
          success: false,
          reason: 'prejuizo_km',
          keptCurrent: true,
          sequencedCount: courierOrders.length,
          totalDistanceKm: currentRouteTotalDistanceKm,
        }
      }

      // Regra "linha = cabeçalho":
      // A soma dos combustíveis e distâncias das pernas de cada parada deve coincidir com o total da rota.
      // A última perna ou rateio do retorno é incorporado para garantir que Σ fuel_cost = total_route_fuel_cost.
      const totalStopsCount = roadResult.stops.length
      const totalRouteFuel = roadResult.estimated_fuel_cost
      const totalReturnKm = roadResult.return_distance_km || 0
      const totalOutboundMeters = roadResult.stops.reduce(
        (sum, s) => sum + (s.step_distance_meters || 800),
        0,
      )
      let allocatedReturnSum = 0
      let allocatedFuelSum = 0
      const isBicycle = this.normalizeVehicleCategory(courier.vehicle_type) === 'bicicleta'

      // 6. Persistir novos valores de sequência (1..N, NUNCA 0) e métricas viárias em cada pedido
      const nowIso = new Date().toISOString()
      let cumulativeMins = 0

      for (let i = 0; i < totalStopsCount; i++) {
        const stop = roadResult.stops[i]
        const isLastStop = i === totalStopsCount - 1
        const legDurationMin = Math.max(5, Math.round((stop.step_duration_seconds || 300) / 60))
        cumulativeMins += legDurationMin
        const etaIso = new Date(Date.now() + cumulativeMins * 60 * 1000).toISOString()
        const stepDistKm = Number(((stop.step_distance_meters || 800) / 1000).toFixed(2))

        // Rateio exato do retorno único da rota:
        // cada parada leva sua perna (distance_km) + fração pro-rata do retorno (return_trip_km)
        // para que sum(distance_km + return_trip_km) feche rigorosamente em total_route_with_return_km
        let stopReturnKm = 0
        if (totalStopsCount === 1) {
          stopReturnKm = Number(totalReturnKm.toFixed(2))
          allocatedReturnSum += stopReturnKm
        } else if (!isLastStop) {
          const rawShare =
            totalOutboundMeters > 0
              ? (totalReturnKm * (stop.step_distance_meters || 800)) / totalOutboundMeters
              : totalReturnKm / totalStopsCount
          stopReturnKm = Number(rawShare.toFixed(2))
          allocatedReturnSum += stopReturnKm
        } else {
          stopReturnKm = Number(Math.max(0, totalReturnKm - allocatedReturnSum).toFixed(2))
        }

        // Rateio exato do combustível da rota para cumprir regra "linha = cabeçalho":
        // combustível proporcional à perna + retorno rateado, e última parada fecha resíduo
        let legFuelCost: number
        if (isBicycle || totalRouteFuel <= 0) {
          legFuelCost = 0
        } else if (!isLastStop) {
          legFuelCost =
            consumptionKml > 0 && pricePerLiter > 0
              ? Number((((stepDistKm + stopReturnKm) * pricePerLiter) / consumptionKml).toFixed(2))
              : 0
          allocatedFuelSum += legFuelCost
        } else {
          // Última parada: absorve resíduo garantindo que sum(fuel_cost) == total_route_fuel_cost
          legFuelCost = Number(Math.max(0, totalRouteFuel - allocatedFuelSum).toFixed(2))
        }

        const calculatedSequence = i + 1 // NUNCA ZERO: 1..N

        const updatePayload: Partial<OrderRecord> = {
          sequence: calculatedSequence,
          distance_km: stepDistKm > 0 ? stepDistKm : 0.8,
          return_trip_km: Number(stopReturnKm.toFixed(2)),
          total_route_with_return_km: roadResult.total_distance_km,
          total_route_fuel_cost: roadResult.estimated_fuel_cost,
          fuel_cost: legFuelCost,
          estimated_duration_minutes: legDurationMin,
          estimated_arrival: etaIso,
          start_base_name:
            defaultBase?.name || courierOrders[0]?.start_base_name || 'Mais Saudavel',
          start_base_address: defaultBase?.address || courierOrders[0]?.start_base_address,
          start_base_lat: originPoint.lat,
          start_base_lng: originPoint.lng,
          end_address_name: stop.customer_name,
          end_address_text: stop.address,
          end_address_lat: stop.lat,
          end_address_lng: stop.lng,
          route_released: true,
          route_released_at: courierOrders[0]?.route_released_at || nowIso,
        }

        const isRouteStarted = courierOrders.some((o) => o.route_started === true)
        if (isRouteStarted) {
          updatePayload.route_started = true
          updatePayload.route_started_at = courierOrders[0]?.route_started_at || nowIso
          updatePayload.status = 'in_transit'
        }

        await pb.collection('orders').update(stop.id, updatePayload)
      }

      return {
        success: true,
        sequencedCount: roadResult.stops.length,
        totalDistanceKm: roadResult.total_distance_km,
      }
    } catch (err) {
      console.error('Error resequencing active route for courier:', err)
      // Fallback final: garantir renumeracao 1..N unica estrita por created mesmo em falha grave
      try {
        const fallbackOrders = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished!=true && tracking_code!='TRK-2026-622'`,
          sort: 'created',
          requestKey: null,
        })
        for (let idx = 0; idx < fallbackOrders.length; idx++) {
          await pb.collection('orders').update(fallbackOrders[idx].id, {
            sequence: idx + 1,
          })
        }
      } catch (fallbackSeqErr) {
        console.warn('Erro no fallback de emergência de sequência:', fallbackSeqErr)
      }
      // Retry automático 1x antes de desistir
      if (!isRetry) {
        console.warn(
          `[deliveryService] Primeira tentativa de resequenciamento falhou para courier ${courierId}. Tentando retry automático 1x...`,
        )
        try {
          return await this.resequenceActiveRouteForCourier(courierId, settings, true, origin)
        } catch (retryErr) {
          console.error(
            `[deliveryService] Retry de resequenciamento também falhou para courier ${courierId}:`,
            retryErr,
          )
        }
      }

      // Notificar Central (admin/sistema) e Entregador para que a falha NÃO seja silenciosa
      try {
        await this.createNotification({
          user_id: courierId,
          title: '⚠️ Aviso na Otimização da Rota',
          message:
            'Houve uma instabilidade temporária ao reordenar sua rota viária. As paradas foram mantidas em ordem segura.',
          type: 'order',
          read: false,
        })
      } catch (notifErr) {
        console.warn('Erro ao notificar entregador sobre falha de resequenciamento:', notifErr)
      }

      // Disparar evento global para o frontend (Central / Admin / CourierApp) exibir toast/banner
      if (typeof window !== 'undefined') {
        try {
          window.dispatchEvent(
            new CustomEvent('rotaly_resequence_failed', {
              detail: {
                courierId,
                error: err instanceof Error ? err.message : String(err),
                timestamp: new Date().toISOString(),
              },
            }),
          )
        } catch {
          /* ignore */
        }
      }

      return { success: false, sequencedCount: 0, totalDistanceKm: 0 }
    }
  },

  /**
   * Incluir Cliente / Pedido em Rota Já Iniciada ou Liberada
   * - Atribui courier_id
   * - route_released = true
   * - Se rota já iniciada (route_started=true na rota do entregador), marca route_started=true e status='in_transit'
   * - Dispara RESEQUENCIAMENTO AUTOMÁTICO da rota inteira com motor viário inteligente (Google Directions + mesma rua + 2-Opt)
   * - Garante sequência sempre 1..N no menor trajeto viário possível (NUNCA sequence = 0)
   * - Recalcula os totais da rota (km, combustível, tempo) mantendo a regra linha = cabeçalho
   * - Dispara notificação push/realtime ao entregador
   */
  async addOrderToActiveRoute(params: {
    orderId: string
    courierId: string
    settings?: Partial<AppSettingsRecord> | null
  }): Promise<{ success: boolean; order: OrderRecord }> {
    const { orderId, courierId, settings } = params

    // Verificação defensiva de papel: entregadores não podem incluir pedidos em rotas (apenas vendedor/admin)
    const currentAuthRecord = pb.authStore.record as any
    const currentRole = currentAuthRecord?.role || currentAuthRecord?.papel
    if (currentRole === 'courier' || currentRole === 'entregador') {
      const errMsg = `Usuário com papel '${currentRole}' não tem permissão para incluir pedidos em rotas ativas.`
      console.warn(`[deliveryService] addOrderToActiveRoute bloqueado:`, errMsg)
      throw new Error(errMsg)
    }

    try {
      // 1. Obter entregador para veículo/consumo
      const courier = await pb.collection<UserRecord>('users').getOne(courierId)

      // 2. Obter pedidos atuais atribuídos a esse entregador
      const courierOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled'`,
        sort: 'sequence',
        requestKey: null,
      })

      // Verificar se a rota já está iniciada pelo entregador
      const isRouteStarted = courierOrders.some((o) => o.route_started === true)
      const lastOrder = courierOrders[courierOrders.length - 1]
      const bases = await this.getBaseAddresses()
      const defaultBase = bases.find((b) => b.is_default) || bases[0]
      const now = new Date()

      // Atribui sequence provisória estritamente superior ao maior sequence atual para NUNCA colidir
      const maxExistingSeq = courierOrders.reduce(
        (max, o) => Math.max(max, Number(o.sequence) || 0),
        0,
      )
      const provisionalSequence = Math.max(1, maxExistingSeq + 1, courierOrders.length + 1)

      // 3. Atualizar o pedido para vincular ao entregador e à rota ativa
      const initialUpdateData: Partial<OrderRecord> = {
        courier_id: courierId,
        sequence: provisionalSequence,
        route_released: true,
        route_released_at: now.toISOString(),
        start_base_name: lastOrder?.start_base_name || defaultBase?.name || 'Mais Saudavel',
        start_base_address: lastOrder?.start_base_address || defaultBase?.address,
        start_base_lat: lastOrder?.start_base_lat || defaultBase?.lat || -22.7001402,
        start_base_lng: lastOrder?.start_base_lng || defaultBase?.lng || -43.2982834,
      }

      if (isRouteStarted) {
        initialUpdateData.route_started = true
        initialUpdateData.route_started_at = lastOrder?.route_started_at || now.toISOString()
        initialUpdateData.status = 'in_transit'
      } else {
        initialUpdateData.status = 'assigned'
      }

      await pb.collection<OrderRecord>('orders').update(orderId, initialUpdateData)

      // 4. REGRA ROTA IMUTÁVEL SEM COMANDO:
      // O pedido novo fica com provisionalSequence = maxExistingSeq + 1 (fim da fila pendente, paradas anteriores intocadas).
      // NÃO disparar auto-resequenciamento viário automático aqui — rota só muda por comando explícito de vendedor/admin.

      // 5. Obter pedido atualizado com sua sequência provisória final
      const finalOrder = await pb.collection<OrderRecord>('orders').getOne(orderId, {
        expand: 'customer_id',
      })
      const customer = finalOrder.expand?.customer_id as CustomerRecord | undefined

      // Criar notificação realtime ao entregador informando a nova parada aguardando otimização
      try {
        await this.createNotification({
          user_id: courierId,
          title: '📦 Nova Entrega Adicionada à Rota',
          message: `O pedido ${finalOrder.tracking_code || ''} para ${customer?.name || 'Cliente'} foi adicionado ao fim da sua rota (Parada #${finalOrder.sequence || provisionalSequence}).`,
          type: 'order',
          read: false,
          order_id: orderId,
        })
      } catch (notifErr) {
        console.warn('Erro ao notificar entregador sobre inclusão de cliente:', notifErr)
      }

      return { success: true, order: finalOrder }
    } catch (err) {
      console.error('Error adding order to active route:', err)
      throw err
    }
  },

  /**
   * Cancelar Rota Já Iniciada ou Liberada de um Entregador
   * - Para cada pedido pendente da rota (não entregue e não cancelado):
   *     courier_id = null / ''
   *     status = 'pending'
   *     sequence = null
   *     route_released = false
   *     route_started = false
   *     route_started_at = null
   *     route_released_at = null
   *     route_finished = false
   *     route_finished_at = null
   * - Preserva histórico dos pedidos já entregues (delivered)
   * - Libera o status do entregador de volta para 'active' se não tiver outras rotas em andamento
   * - Notifica o entregador: "⚠️ Rota Cancelada pela Central"
   * - Os pedidos voltam automaticamente para pendingOrders da Etapa 2 via tempo real
   */
  async cancelActiveRoute(courierId: string): Promise<{
    success: boolean
    cancelledOrdersCount: number
    preservedOrdersCount: number
  }> {
    try {
      // 1. Obter todos os pedidos atribuídos a este entregador
      const courierOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}'`,
        requestKey: null,
      })

      // Separar pendentes (a resetar) e entregues/cancelados (a preservar)
      const pendingToReset = courierOrders.filter(
        (o) =>
          o.status !== 'delivered' &&
          o.status !== 'cancelled' &&
          (o.route_finished === false ||
            o.route_finished === null ||
            o.route_finished === undefined),
      )
      const preserved = courierOrders.filter((o) => o.status === 'delivered')

      let cancelledOrdersCount = 0
      for (const order of pendingToReset) {
        // (4) CANCELAMENTO AUTOMÁTICO DE KM:
        // Pedido não visitado (status !== 'delivered', sem visita registrada)
        // recalcular total_route_with_return_km do lote sem a perna dele + audit_trail
        const hadVisit = Boolean(order.delivery_time || order.delivery_lat || order.delivery_lng)
        const orderDistanceKm = Number(order.distance_km) || 0

        await pb.collection('orders').update(order.id, {
          courier_id: null,
          status: 'pending',
          sequence: null,
          route_released: false,
          route_released_at: null,
          route_started: false,
          route_started_at: null,
          route_finished: false,
          route_finished_at: null,
        })
        cancelledOrdersCount++

        if (!hadVisit) {
          try {
            await this.createAuditTrailEntry({
              order_id: order.id,
              user_id: '',
              actor_name: 'Sistema',
              action: 'km_canceled_unvisited',
              old_value: String(orderDistanceKm),
              new_value: '0',
              metadata: {
                system_trigger: true,
                courier_id: courierId,
                tracking_code: order.tracking_code,
                canceled_distance_km: orderDistanceKm,
                reason: 'cancelActiveRoute - pedido não visitado',
              },
            })
          } catch (auditErr) {
            console.warn(
              '[cancelActiveRoute] Falha ao registrar audit_trail km_canceled_unvisited:',
              auditErr,
            )
          }
        }
      }

      // Recalcular total_route_with_return_km dos pedidos preservados (entregues/restantes do lote)
      if (preserved.length > 0) {
        const remainingBatchDistanceKm = preserved.reduce(
          (sum, o) => sum + (Number(o.distance_km) || 0) + (Number(o.return_trip_km) || 0),
          0,
        )
        for (const pres of preserved) {
          try {
            await pb.collection('orders').update(pres.id, {
              total_route_with_return_km: Number(remainingBatchDistanceKm.toFixed(2)),
            })
          } catch (upErr) {
            console.warn(
              '[cancelActiveRoute] Erro ao recalcular total_route_with_return_km do preservado:',
              upErr,
            )
          }
        }
      }

      // 2. Liberar status do entregador para 'active'
      try {
        await pb.collection('users').update(courierId, {
          status: 'active',
        })
      } catch (userErr) {
        console.warn('Não foi possível restaurar status do entregador:', userErr)
      }

      // 3. Notificar o entregador
      try {
        await this.createNotification({
          user_id: courierId,
          title: '⚠️ Rota Cancelada pela Central',
          message: `Sua rota com ${cancelledOrdersCount} parada(s) pendente(s) foi cancelada pela central. Você está livre para novas rotas.`,
          type: 'order',
          read: false,
        })
      } catch (notifErr) {
        console.warn('Erro ao notificar cancelamento de rota:', notifErr)
      }

      return {
        success: true,
        cancelledOrdersCount,
        preservedOrdersCount: preserved.length,
      }
    } catch (err) {
      console.error('Error cancelling active route:', err)
      throw err
    }
  },

  /**
   * Excluir um pedido da rota ativa do entregador
   * - Retorna o pedido para o pool de pendentes:
   *     courier_id = null
   *     status = 'pending'
   *     sequence = null
   *     route_released = false
   *     route_released_at = null
   *     route_started = false
   *     route_started_at = null
   *     route_finished = false
   *     route_finished_at = null
   * - NUNCA permite excluir pedidos já concluídos ('delivered')
   * - Se autoResequence = true, reexecuta o motor viário e salva a nova sequência dos pedidos restantes
   */
  async removeOrderFromActiveRoute(params: {
    orderId: string
    courierId: string
    settings?: Partial<AppSettingsRecord> | null
    autoResequence?: boolean
    origin?: string
  }): Promise<{ success: boolean; remainingCount: number }> {
    const { orderId, courierId, settings, autoResequence = false, origin } = params
    try {
      const order = await pb.collection<OrderRecord>('orders').getOne(orderId)
      if (order.status === 'delivered') {
        throw new Error('Entregas já concluídas não podem ser removidas da rota.')
      }

      const hadVisit = Boolean(order.delivery_time || order.delivery_lat || order.delivery_lng)
      const orderDistanceKm = Number(order.distance_km) || 0

      await pb.collection('orders').update(orderId, {
        courier_id: null,
        status: 'pending',
        sequence: null,
        route_released: false,
        route_released_at: null,
        route_started: false,
        route_started_at: null,
        route_finished: false,
        route_finished_at: null,
      })

      // (4) CANCELAMENTO AUTOMÁTICO DE KM:
      // Pedido não visitado (status !== 'delivered', sem visita registrada) →
      // recalcular total_route_with_return_km do lote sem a perna dele + audit_trail
      if (!hadVisit) {
        try {
          await this.createAuditTrailEntry({
            order_id: orderId,
            user_id: '',
            actor_name: 'Sistema',
            action: 'km_canceled_unvisited',
            old_value: String(orderDistanceKm),
            new_value: '0',
            metadata: {
              system_trigger: true,
              courier_id: courierId,
              tracking_code: order.tracking_code,
              canceled_distance_km: orderDistanceKm,
              reason: 'removeOrderFromActiveRoute - pedido não visitado',
            },
          })
        } catch (auditErr) {
          console.warn(
            '[removeOrderFromActiveRoute] Falha ao registrar audit_trail km_canceled_unvisited:',
            auditErr,
          )
        }
      }

      // Buscar pedidos restantes ativos da rota desse entregador
      const remainingOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}' && status!='cancelled' && route_finished!=true`,
        requestKey: null,
      })

      // Recalcular total_route_with_return_km do lote abatendo a perna do pedido cancelado não visitado
      if (!hadVisit && remainingOrders.length > 0 && orderDistanceKm > 0) {
        for (const rem of remainingOrders) {
          const currentTotal = Number(rem.total_route_with_return_km) || 0
          const newTotal = Math.max(0, Number((currentTotal - orderDistanceKm).toFixed(2)))
          try {
            await pb.collection('orders').update(rem.id, {
              total_route_with_return_km: newTotal,
            })
          } catch (upErr) {
            console.warn(
              '[removeOrderFromActiveRoute] Erro ao abater km do pedido restante:',
              upErr,
            )
          }
        }
      }

      let remainingCount = 0
      if (autoResequence && origin === 'manual_command') {
        const reseqRes = await this.resequenceActiveRouteForCourier(
          courierId,
          settings,
          false,
          origin,
        )
        remainingCount = reseqRes.sequencedCount
      } else {
        const pendingRemaining = remainingOrders.filter((o) => o.status !== 'delivered')
        remainingCount = pendingRemaining.length
      }

      return { success: true, remainingCount }
    } catch (err) {
      console.error('Error removing order from active route:', err)
      throw err
    }
  },

  /**
   * Edita uma rota ativa de um entregador em uma única operação transacional:
   * 1. Remove os pedidos selecionados para exclusão (voltam para pendentes no pool)
   * 2. Inclui novos pedidos selecionados na rota
   * 3. OTIMIZA AUTOMATICAMENTE toda a rota viária (TSP determinístico + 2-Opt)
   * 4. Persiste a nova sequência e métricas viárias nos pedidos
   * 5. Preserva estritamente os pedidos já concluídos
   * 6. Notifica o entregador com as atualizações
   */
  async editActiveRouteAndOptimize(params: {
    courierId: string
    removeOrderIds?: string[]
    addOrderIds?: string[]
    settings?: Partial<AppSettingsRecord> | null
  }): Promise<{
    success: boolean
    removedCount: number
    addedCount: number
    finalCount: number
    totalDistanceKm: number
  }> {
    const { courierId, removeOrderIds = [], addOrderIds = [], settings } = params
    try {
      // 1. Remover pedidos solicitados (garantindo que nenhum entregue seja desfeito)
      let removedCount = 0
      for (const orderId of removeOrderIds) {
        try {
          const ord = await pb.collection<OrderRecord>('orders').getOne(orderId)
          if (ord.status !== 'delivered') {
            await pb.collection('orders').update(orderId, {
              courier_id: null,
              status: 'pending',
              sequence: null,
              route_released: false,
              route_released_at: null,
              route_started: false,
              route_started_at: null,
              route_finished: false,
              route_finished_at: null,
            })
            removedCount++
          }
        } catch (removeErr) {
          console.warn(`Aviso ao remover pedido ${orderId} da rota:`, removeErr)
        }
      }

      // 2. Identificar se a rota do entregador já está iniciada (route_started=true)
      const existingActive = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled'`,
        requestKey: null,
      })
      const isRouteStarted = existingActive.some((o) => o.route_started === true)
      const sampleOrder = existingActive[0]
      const bases = await this.getBaseAddresses()
      const defaultBase = bases.find((b) => b.is_default) || bases[0]
      const nowIso = new Date().toISOString()

      // 3. Adicionar novos pedidos à rota ativa
      let addedCount = 0
      for (const orderId of addOrderIds) {
        try {
          const updatePayload: Partial<OrderRecord> = {
            courier_id: courierId,
            route_released: true,
            route_released_at: sampleOrder?.route_released_at || nowIso,
            start_base_name: sampleOrder?.start_base_name || defaultBase?.name || 'Mais Saudavel',
            start_base_address: sampleOrder?.start_base_address || defaultBase?.address,
            start_base_lat: sampleOrder?.start_base_lat || defaultBase?.lat || -22.7001402,
            start_base_lng: sampleOrder?.start_base_lng || defaultBase?.lng || -43.2982834,
          }

          if (isRouteStarted) {
            updatePayload.route_started = true
            updatePayload.route_started_at = sampleOrder?.route_started_at || nowIso
            updatePayload.status = 'in_transit'
          } else {
            updatePayload.status = 'assigned'
          }

          await pb.collection('orders').update(orderId, updatePayload)
          addedCount++
        } catch (addErr) {
          console.warn(`Aviso ao adicionar pedido ${orderId} na rota:`, addErr)
        }
      }

      // 4. OTIMIZAÇÃO VIÁRIA POR COMANDO EXPLÍCITO E PERSISTÊNCIA DA SEQUÊNCIA
      const reseqRes = await this.resequenceActiveRouteForCourier(
        courierId,
        settings,
        false,
        'manual_command',
      )

      // 5. Notificar o entregador se houver modificações e resequenciamento concluído
      if (reseqRes.success) {
        try {
          await this.createNotification({
            user_id: courierId,
            title: '🔄 Rota Atualizada e Otimizada!',
            message: `Sua rota foi reotimizada pela central (${reseqRes.sequencedCount} parada(s)). A nova sequência viária já está sincronizada no seu app.`,
            type: 'order',
            read: false,
          })
        } catch (notifErr) {
          console.warn('Erro ao enviar notificação de rota atualizada:', notifErr)
        }
      }

      return {
        success: reseqRes.success,
        removedCount,
        addedCount,
        finalCount: reseqRes.sequencedCount,
        totalDistanceKm: reseqRes.totalDistanceKm,
      }
    } catch (err) {
      console.error('Error editing and optimizing active route:', err)
      throw err
    }
  },

  // Calculate Fuel Cost
  // Formula: Distância (km) * Preço do Litro (R$/L) / Consumo (km/L)
  calculateFuelCost(distanceKm: number, fuelPrice = 6.49, consumptionKml = 35.0): number {
    if (consumptionKml <= 0 || fuelPrice <= 0 || distanceKm <= 0) return 0
    return (distanceKm * fuelPrice) / consumptionKml
  },

  calculateFuelCostForVehicle(
    distanceKm: number,
    settings?: Partial<AppSettingsRecord> | null,
    vehicleType?: string,
  ): number {
    const { pricePerLiter, consumptionKml, category } = this.getVehicleFuelParams(
      settings,
      vehicleType,
    )
    if (category === 'bicicleta' || consumptionKml <= 0 || pricePerLiter <= 0) return 0
    return this.calculateFuelCost(distanceKm, pricePerLiter, consumptionKml)
  },

  // Fuel Advances & Current Account
  async getFuelAdvances(
    filter = '',
    sort = '-date,-created',
    expand = 'courier_id,created_by',
    empresaId?: string,
  ) {
    // Saneamento de filtro: a coleção fuel_advances tem courier_id, não user_id
    let finalFilter = filter ? filter.replace(/\buser_id\b/g, 'courier_id') : ''

    // A coleção fuel_advances não possui empresa_id diretamente.
    // O isolamento multiempresa é feito via entregadores da empresa ativa:
    // courier_id IN (ids dos couriers da empresa ativa / união).
    let targetCompanyId = empresaId || this.getActiveCompanyId()
    if (!targetCompanyId) {
      try {
        targetCompanyId = await this.getMatrizCompanyId()
      } catch {
        targetCompanyId = ''
      }
    }

    if (!finalFilter.includes('courier_id')) {
      try {
        let couriers = await this.getCouriers(targetCompanyId)

        // Fallback defensivo: garantir que se couriers for vazio, busca todos os users com role='courier'
        if (!couriers || couriers.length === 0) {
          try {
            const allCouriers = await pb.collection<UserRecord>('users').getFullList({
              filter: "role = 'courier'",
              sort: '-created',
              requestKey: null,
            })
            couriers = allCouriers.map((u) => ({
              ...u,
              vehicle_type: u.vehicle_type || 'moto',
              status: u.status === 'inactive' ? ('inactive' as const) : ('active' as const),
            }))
          } catch (usersErr) {
            console.warn('Erro no fallback de couriers para fuel_advances:', usersErr)
          }
        }

        if (couriers && couriers.length > 0) {
          const courierFilterClause = couriers.map((c) => `courier_id = '${c.id}'`).join(' || ')
          finalFilter = filter
            ? `(${filter}) && (${courierFilterClause})`
            : `(${courierFilterClause})`
        }
      } catch (err) {
        console.warn('Erro ao obter entregadores para isolamento de fuel_advances:', err)
      }
    }

    try {
      return await pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
        filter: finalFilter,
        sort,
        expand,
        requestKey: null,
      })
    } catch (queryErr) {
      console.warn(
        'Erro na consulta filtrada de fuel_advances; executando fallback defensivo:',
        queryErr,
      )
      try {
        // Fallback defensivo: listar adiantamentos e cruzar em memória pelos courier_id permitidos
        const allAdvances = await pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
          sort,
          expand,
          requestKey: null,
        })
        let couriers = await this.getCouriers(targetCompanyId)
        if (!couriers || couriers.length === 0) {
          const allCouriers = await pb.collection<UserRecord>('users').getFullList({
            filter: "role = 'courier'",
            sort: '-created',
            requestKey: null,
          })
          couriers = allCouriers
        }
        const allowedCourierIds = new Set(couriers.map((c) => c.id))
        // Adiciona defensivamente qualquer user com role courier à lista permitida
        try {
          const allUserCouriers = await pb.collection<UserRecord>('users').getFullList({
            filter: "role = 'courier'",
            requestKey: null,
          })
          allUserCouriers.forEach((u) => allowedCourierIds.add(u.id))
        } catch {
          /* ignore */
        }
        return allAdvances.filter((adv) => adv.courier_id && allowedCourierIds.has(adv.courier_id))
      } catch (fallbackErr) {
        console.error('Falha crítica no fallback de fuel_advances:', fallbackErr)
        return []
      }
    }
  },

  async createFuelAdvance(data: Partial<FuelAdvanceRecord> | Record<string, any>) {
    const raw = (data as any) || {}

    // Mapeamento e sanitização estrita para os campos reais da coleção fuel_advances:
    // courier_id, amount (número), date (YYYY-MM-DD), notes, payment_method, created_by,
    // status, entry_type, previous_balance, new_balance
    const courierId = raw.courier_id || raw.user_id || ''
    const amountVal = Number(raw.amount !== undefined ? raw.amount : raw.valor) || 0
    let dateVal = raw.date || raw.data || ''
    if (typeof dateVal === 'string' && dateVal.includes('T')) {
      dateVal = dateVal.split('T')[0]
    }
    if (!dateVal) {
      dateVal = new Date().toISOString().split('T')[0]
    }
    const notesVal = raw.notes !== undefined ? raw.notes : raw.observacao || ''
    const paymentMethodVal = raw.payment_method || 'outro'
    const createdByVal = raw.created_by || pb.authStore.record?.id || ''
    const statusVal = raw.status || 'active'
    const entryTypeVal = raw.entry_type || 'advance'

    const payload: Record<string, any> = {
      courier_id: courierId,
      amount: amountVal,
      date: dateVal,
      notes: notesVal,
      payment_method: paymentMethodVal,
      created_by: createdByVal,
      status: statusVal,
      entry_type: entryTypeVal,
    }

    if (raw.previous_balance !== undefined && raw.previous_balance !== null) {
      payload.previous_balance = Number(raw.previous_balance)
    }
    if (raw.new_balance !== undefined && raw.new_balance !== null) {
      payload.new_balance = Number(raw.new_balance)
    }

    return pb.collection<FuelAdvanceRecord>('fuel_advances').create(payload)
  },

  async cancelFuelAdvance(params: {
    id: string
    cancellationReason: string
    cancelledBy: string
    previousBalance?: number
  }) {
    const record = await pb.collection<FuelAdvanceRecord>('fuel_advances').getOne(params.id)
    const newBal =
      params.previousBalance !== undefined
        ? params.previousBalance - (record.amount || 0)
        : undefined

    return pb.collection<FuelAdvanceRecord>('fuel_advances').update(params.id, {
      status: 'cancelled',
      cancelled_at: new Date().toISOString(),
      cancelled_by: params.cancelledBy,
      cancellation_reason: params.cancellationReason,
      ...(params.previousBalance !== undefined ? { previous_balance: params.previousBalance } : {}),
      ...(newBal !== undefined ? { new_balance: newBal } : {}),
    })
  },

  async createBalanceAdjustment(params: {
    courierId: string
    amountDelta: number // positivo adiciona ao saldo (crédito), negativo subtrai (débito)
    targetBalance: number
    previousBalance: number
    reason: string
    createdBy: string
    date?: string
    paymentMethod?: FuelPaymentMethod
  }) {
    const today = params.date || new Date().toISOString().split('T')[0]
    const delta = Number(Number(params.amountDelta).toFixed(2))
    return pb.collection<FuelAdvanceRecord>('fuel_advances').create({
      courier_id: params.courierId,
      amount: delta, // Suporta negativos (débito) e positivos (crédito)
      date: today,
      status: 'active',
      entry_type: 'balance_adjustment',
      created_by: params.createdBy,
      payment_method: params.paymentMethod || 'outro',
      notes: params.reason,
      previous_balance: Number(Number(params.previousBalance).toFixed(2)),
      new_balance: Number(Number(params.targetBalance).toFixed(2)),
    })
  },

  async deleteFuelAdvance(id: string) {
    return pb.collection<FuelAdvanceRecord>('fuel_advances').delete(id)
  },

  // Motor único oficial de cálculo de KM, combustível e conta corrente de entregadores
  // Delega diretamente para calculateCourierFuelMetrics garantindo pipeline unificado
  calculateCourierFuelMetrics(options: Parameters<typeof calculateCourierFuelMetrics>[0]) {
    return calculateCourierFuelMetrics(options)
  },

  // 6. Obter extrato de conta corrente de combustível de um entregador individual
  // Consome 100% o motor único calculateCourierFuelMetrics eliminando divergências
  getCourierFuelAccount(
    courier: UserRecord,
    advances: FuelAdvanceRecord[],
    orders: OrderRecord[],
    settings: Partial<AppSettingsRecord> | null,
    periodFilter: 'all' | 'month' | 'week' = 'all',
    locations: LocationRecord[] = [],
    offRouteEvents: OffRouteEventRecord[] = [],
  ): CourierFuelAccount {
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
      this.normalizeVehicleCategory(courier.vehicle_type) === 'bicicleta'

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
    }
  },

  // Compute Real-time Courier Current Account
  // Consome o motor único oficial para todos os entregadores
  async getCourierFuelAccounts(empresaId?: string): Promise<CourierFuelAccount[]> {
    let resolvedCompanyId = empresaId || this.getActiveCompanyId()
    if (!resolvedCompanyId) {
      try {
        resolvedCompanyId = await this.getMatrizCompanyId()
      } catch {
        resolvedCompanyId = ''
      }
    }

    const { fuelAccountService } = await import('@/services/fuelAccountService')
    const accounts = await fuelAccountService.getAllCourierFuelAccounts({
      companyId: resolvedCompanyId,
      periodFilter: 'all',
    })
    return accounts.map((a) => ({
      courier: a.courier,
      totalAdvances: a.totalAdvances,
      totalRouteKm: a.totalRouteKm,
      totalSpent: a.totalSpent,
      balance: a.balance,
      advanceCount: a.advanceCount,
      deliveriesCount: a.deliveriesCount,
      calculationSource: a.calculationSource,
    }))
  },

  // Reviews (Avaliação de Entregador e Vendedor no Rastreio Público)
  // NOTA: A coleção 'reviews' NÃO possui coluna empresa_id (apenas order_id, courier_id, seller_id).
  // Consultas com empresa_id resultam em erro HTTP 400.
  async getReviews(
    filter = '',
    sort = '-created',
    expand = 'order_id,courier_id,seller_id',
    limit = 50,
  ) {
    // Sanitizar removendo qualquer cláusula empresa_id (a coleção reviews NÃO tem esse campo — causa 400).
    // Se havia cláusula empresa_id = 'XYZ', isolar por empresa via seller_id in (...) || courier_id in (...)
    let extractedEmpresaId: string | null = null
    const match = (filter || '').match(/\bempresa_id\s*=\s*'([^']+)'/)
    if (match) {
      extractedEmpresaId = match[1]
    }

    // Remove qualquer variação de empresa_id do filtro
    let sanitizedFilter = (filter || '')
      .replace(/\(?\bempresa_id\s*=\s*'[^']*'\s*(&&|\|\|)?\)?/g, '')
      .trim()
      .replace(/^(&&|\|\|\s)+|(&&|\|\|\s)+$/g, '')
      .trim()

    // Se havia empresa_id ou se o contexto atual tem empresa ativa, aplicar isolamento via sellers/couriers da empresa
    const targetEmpresaId = extractedEmpresaId || this.getActiveCompanyId()
    if (targetEmpresaId) {
      try {
        const isMatriz = await this.isMatrizCompany(targetEmpresaId)
        if (!isMatriz) {
          const companyUsers = await this.getAllUsers(targetEmpresaId)
          const userIds = companyUsers.map((u) => u.id).filter(Boolean)
          if (userIds.length === 0) {
            return []
          }
          const userClauses = userIds.map((id) => `'${id}'`).join(',')
          const companyFilter = `(seller_id ?= [${userClauses}] || courier_id ?= [${userClauses}])`
          sanitizedFilter = sanitizedFilter
            ? `(${sanitizedFilter}) && ${companyFilter}`
            : companyFilter
        }
      } catch (err) {
        console.warn('Erro ao resolver isolamento de empresa em getReviews:', err)
      }
    }

    const cleanFilter = sanitizedFilter.replace(/^(&&|\s)+|(&&|\s)+$/g, '').trim()

    const res = await pb.collection<ReviewRecord>('reviews').getList(1, limit, {
      filter: cleanFilter || undefined,
      sort,
      expand,
      requestKey: null,
    })
    return res.items
  },

  async getReviewByOrderId(orderId: string): Promise<ReviewRecord | null> {
    try {
      const records = await pb.collection<ReviewRecord>('reviews').getList(1, 1, {
        filter: `order_id = '${orderId}'`,
        requestKey: null,
      })
      return records.items[0] || null
    } catch {
      return null
    }
  },

  async createReview(data: Partial<ReviewRecord>) {
    return pb.collection<ReviewRecord>('reviews').create(data)
  },

  // Off Route & Unexpected Stop Events
  async getOffRouteEvents(
    filter = '',
    sort = '-created',
    expand = 'courier_id,order_id',
    limit = 50,
  ) {
    // A coleção off_route_events só tem courier_id (sem empresa_id/user_id).
    // Se o filtro contiver empresa_id, converter para courier_id in (ids dos entregadores role=courier da empresa, consultados em users).
    // Se a empresa não tiver entregadores, retornar [] sem chamar a API.
    let extractedEmpresaId: string | null = null
    const match = (filter || '').match(/\bempresa_id\s*=\s*'([^']+)'/)
    if (match) {
      extractedEmpresaId = match[1]
    }

    // Remover qualquer cláusula empresa_id do filtro existente
    let sanitizedFilter = (filter || '')
      .replace(/\(?\bempresa_id\s*=\s*'[^']*'\s*(&&|\|\|)?\)?/g, '')
      .trim()
      .replace(/^(&&|\|\|\s)+|(&&|\|\|\s)+$/g, '')
      .trim()

    if (extractedEmpresaId) {
      try {
        const isMatriz = await this.isMatrizCompany(extractedEmpresaId)
        if (!isMatriz) {
          const couriers = await this.getCouriers(extractedEmpresaId)
          const courierIds = couriers.map((c) => c.id).filter(Boolean)
          if (courierIds.length === 0) {
            // Se a empresa não tiver entregadores, retornar [] sem chamar a API
            return []
          }
          const courierList = courierIds.map((id) => `'${id}'`).join(',')
          const courierFilter = `courier_id ?= [${courierList}]`
          sanitizedFilter = sanitizedFilter
            ? `(${sanitizedFilter}) && ${courierFilter}`
            : courierFilter
        }
      } catch (err) {
        console.warn('Erro ao converter empresa_id em couriers na getOffRouteEvents:', err)
      }
    }

    const cleanFilter = sanitizedFilter.replace(/^(&&|\s)+|(&&|\s)+$/g, '').trim()

    const res = await pb.collection<OffRouteEventRecord>('off_route_events').getList(1, limit, {
      filter: cleanFilter || undefined,
      sort,
      expand,
      requestKey: null,
    })
    return res.items
  },

  async createOffRouteEvent(data: Partial<OffRouteEventRecord>) {
    // A coleção off_route_events não possui o campo empresa_id no schema do PocketBase
    const { empresa_id: _ignoredEmpresaId, ...payloadWithoutEmpresa } = data as any
    return pb.collection<OffRouteEventRecord>('off_route_events').create(payloadWithoutEmpresa)
  },

  // Route optimization with Google Maps Traffic or fallback
  async optimizeRoute(
    orderIds: string[],
    originLat = -22.906847,
    originLng = -43.172896,
  ): Promise<OptimizedRouteResult> {
    return this.clientSideOptimizeRoute(orderIds, originLat, originLng)
  },

  // Alias for compatibility with spec
  async suggestOptimalCourier(params: {
    customerLat: number
    customerLng: number
    priority?: OrderPriority
    timeWindow?: string
  }): Promise<RouteSuggestionDetails | null> {
    return this.suggestBestCourierForOrder(params)
  },

  // Calculate Best Courier & Route Suggestion for a new delivery
  async suggestBestCourierForOrder(params: {
    customerLat: number
    customerLng: number
    priority?: OrderPriority
    timeWindow?: string
  }): Promise<RouteSuggestionDetails | null> {
    const { customerLat, customerLng, priority = 'normal' } = params

    // 1. Get couriers, orders, latest locations and base addresses
    const [couriers, orders, latestLocations, baseAddresses] = await Promise.all([
      this.getCouriers(),
      this.getOrders('status = "pending" || status = "in_transit"'),
      this.getLatestLocations(),
      this.getBaseAddresses().catch(() => []),
    ])

    // Determinar base ativa (padrão) para medição canônica de partida
    const activeBase =
      baseAddresses.find((b) => b.is_default && b.lat && b.lng) ||
      baseAddresses.find((b) => b.lat && b.lng) ||
      null

    // Regra: "ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL"
    // Entregadores com rota ativa não finalizada não devem receber nova atribuição automática
    const activeCouriers = couriers.filter((c) => {
      if (c.status === 'inactive') return false
      const hasUnfinishedRoute = orders.some(
        (o) =>
          o.courier_id === c.id &&
          o.route_started === true &&
          (o.route_finished === false ||
            o.route_finished === null ||
            o.route_finished === undefined),
      )
      return !hasUnfinishedRoute && (c.status === 'active' || c.status === 'idle')
    })
    if (activeCouriers.length === 0) {
      // Regra: "ELE SÓ RECEBE UMA NOVA ROTA QUANDO FINALIZAR A ROTA ATUAL"
      // Se não há entregadores livres de rotas em andamento, não sugerir nenhum
      return null
    }

    const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371 // km
      const φ1 = (lat1 * Math.PI) / 180
      const φ2 = (lat2 * Math.PI) / 180
      const Δφ = ((lat2 - lat1) * Math.PI) / 180
      const Δλ = ((lon2 - lon1) * Math.PI) / 180
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      return R * c
    }

    // Vehicle capacity score / weight
    // moto: fast, lower max items (e.g. up to 10)
    // car: medium capacity (up to 25)
    // van/truck: high capacity (up to 50)
    const getVehicleCapacity = (vType?: VehicleType) => {
      switch (vType) {
        case 'truck':
        case 'van':
          return 50
        case 'car':
          return 25
        case 'motorcycle':
        default:
          return 10
      }
    }

    const scoredCouriers = activeCouriers.map((courier) => {
      // Find latest GPS coordinate for this courier
      const loc = latestLocations.find((l) => l.user_id === courier.id)
      const courierLat = loc?.lat || -22.906847
      const courierLng = loc?.lng || -43.172896

      const distDirectKm = calcDist(courierLat, courierLng, customerLat, customerLng)
      const courierActiveOrders = orders.filter((o) => o.courier_id === courier.id)
      const activeCount = courierActiveOrders.length

      const maxCapacity = getVehicleCapacity(courier.vehicle_type)
      const capacityRatio = activeCount / maxCapacity // 0 to 1+

      // Vehicle speed multiplier
      let speedFactor = 1.0
      if (courier.vehicle_type === 'motorcycle') speedFactor = 0.85 // Faster in city traffic
      if (courier.vehicle_type === 'truck') speedFactor = 1.3 // Slower in city

      // Priority factor: if urgent, favor nearest courier regardless of small route additions
      const priorityWeight = priority === 'urgent' ? 0.6 : 1.0

      // Overall cost score (lower is better)
      const score = distDirectKm * speedFactor * priorityWeight + capacityRatio * 8

      return {
        courier,
        distDirectKm,
        activeOrdersCount: activeCount,
        score,
        courierLat,
        courierLng,
      }
    })

    scoredCouriers.sort((a, b) => a.score - b.score)
    const best = scoredCouriers[0]
    if (!best) return null

    const orderInRoute = best.activeOrdersCount + 1
    const finalDistKm = Math.max(1.2, Number(best.distDirectKm.toFixed(1)))
    // Estimated time in minutes based on distance
    const estMins = Math.round(finalDistKm * 3 + 8 + (orderInRoute - 1) * 7)
    const estTimeText =
      estMins < 60 ? `${estMins} min` : `${Math.floor(estMins / 60)}h ${estMins % 60}m`

    // Medição 'Mais próximo' da base ativa (base_addresses.is_default) até a primeira parada
    const distFromActiveBaseKm = activeBase
      ? calcDist(activeBase.lat, activeBase.lng, customerLat, customerLng)
      : null

    // km_saved real (2-Opt vs manual): diferença real do trajeto otimizado vs pior alocação/ordem manual, sem acréscimo fixo de 2.5
    const worstKm = Math.max(...scoredCouriers.map((c) => c.distDirectKm))
    const rawKmSaved = worstKm - finalDistKm
    // Se a economia for positiva, utiliza a diferença real calculada; senão floor em 0.0
    const kmSaved = Number(Math.max(0, rawKmSaved).toFixed(1))

    const baseLabel =
      distFromActiveBaseKm !== null ? ` | Da base ativa: ${distFromActiveBaseKm.toFixed(1)} km` : ''

    return {
      courier_id: best.courier.id,
      courier_name: best.courier.name || best.courier.email,
      vehicle_type: best.courier.vehicle_type || 'motorcycle',
      order_in_route: orderInRoute,
      estimated_time: estTimeText,
      km_saved: kmSaved,
      distance_km:
        distFromActiveBaseKm !== null ? Number(distFromActiveBaseKm.toFixed(1)) : finalDistKm,
      reason: `Mais próximo (${distFromActiveBaseKm !== null ? distFromActiveBaseKm.toFixed(1) : finalDistKm} km${baseLabel}) com capacidade ideal (${best.activeOrdersCount} entregas ativas)`,
    }
  },

  // Client-side intelligent TSP router using Google Maps Directions with optimize:true and Same-Street Cohesion
  async clientSideOptimizeRoute(
    orderIds: string[],
    originLat = -22.906847,
    originLng = -43.172896,
    destLat?: number,
    destLng?: number,
    vehicleType?: string,
  ): Promise<OptimizedRouteResult> {
    const allOrders = await pb.collection<OrderRecord>('orders').getFullList({
      filter: orderIds.map((id) => `id = '${id}'`).join(' || '),
      expand: 'customer_id,courier_id',
      requestKey: null,
    })

    const settings = await this.getSettings()
    // Determine vehicle type from parameter or from first order's courier
    const effectiveVehicleType =
      vehicleType || allOrders[0]?.expand?.courier_id?.vehicle_type || 'moto'
    const { pricePerLiter, consumptionKml } = this.getVehicleFuelParams(
      settings,
      effectiveVehicleType,
    )

    const finalDestLat = destLat !== undefined ? destLat : originLat
    const finalDestLng = destLng !== undefined ? destLng : originLng

    const items = allOrders.map((o) => {
      const cust = o.expand?.customer_id
      return {
        id: o.id,
        tracking_code: o.tracking_code,
        priority: o.priority || 'normal',
        status: o.status,
        customer_name: cust?.name || 'Cliente',
        address: cust?.address || 'Endereço',
        lat: cust?.lat || originLat,
        lng: cust?.lng || originLng,
      }
    })

    // Importar dinamicamente ou usar o motor inteligente de roteamento viário
    const { optimizeRouteSequence } = await import('@/services/intelligentRoadRouter')

    const roadRouteResult = await optimizeRouteSequence({
      origin: { lat: originLat, lng: originLng },
      destination: { lat: finalDestLat, lng: finalDestLng },
      stops: items,
      vehicleType: effectiveVehicleType,
      pricePerLiter,
      consumptionKml,
    })

    const optimized = roadRouteResult.stops.map((s) => ({
      id: s.id,
      tracking_code: s.tracking_code,
      priority: s.priority || 'normal',
      status: s.status || 'pending',
      customer_name: s.customer_name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      step_distance_meters: s.step_distance_meters,
      cumulative_distance_meters: s.cumulative_distance_meters,
      step_duration_seconds: s.step_duration_seconds,
    }))

    return {
      optimized_orders: optimized,
      total_distance_km: roadRouteResult.total_distance_km.toFixed(2),
      outbound_distance_km: roadRouteResult.outbound_distance_km,
      return_distance_km: roadRouteResult.return_distance_km,
      estimated_duration_minutes: roadRouteResult.estimated_duration_minutes,
      estimated_fuel_cost: roadRouteResult.estimated_fuel_cost,
      stops_count: optimized.length,
    }
  },

  // ==========================================
  // Address Alerts (Endereços Suspeitos)
  // ==========================================

  /**
   * Listar alertas de endereços suspeitos com filtro por empresa e status.
   * Master vê todos se não informado empresa.
   */
  async getAddressAlerts(options?: {
    empresaId?: string
    status?: AddressAlertStatus | 'all'
    limit?: number
  }): Promise<AddressAlertRecord[]> {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'
    const targetCompanyId =
      options?.empresaId || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    const filters: string[] = []
    if (!isMaster || (options?.empresaId && options.empresaId !== 'ALL')) {
      if (targetCompanyId) {
        filters.push(`company = '${targetCompanyId}'`)
      }
    }

    if (options?.status && options.status !== 'all') {
      filters.push(`status = '${options.status}'`)
    }

    const filterStr = filters.join(' && ')

    try {
      return await pb.collection<AddressAlertRecord>('address_alerts').getFullList({
        filter: filterStr,
        sort: '-created',
        expand: 'customer,company,marked_by,reviewed_by',
        requestKey: null,
      })
    } catch (err) {
      console.error('[deliveryService] Erro ao buscar address_alerts:', err)
      return []
    }
  },

  /**
   * Obter a contagem de alertas pendentes para badges de navegação com cache compartilhado (in-flight dedupe + TTL 15s).
   */
  invalidateAddressAlertsCountCache() {
    _alertsCountCache.clear()
    _alertsCountInFlight.clear()
  },

  async getPendingAddressAlertsCount(empresaId?: string): Promise<number> {
    const key = empresaId || 'default'
    const now = Date.now()
    const cached = _alertsCountCache.get(key)
    if (cached && now - cached.timestamp < 15000) {
      return cached.count
    }

    if (_alertsCountInFlight.has(key)) {
      return _alertsCountInFlight.get(key)!
    }

    const promise = (async () => {
      try {
        const alerts = await this.getAddressAlerts({ empresaId, status: 'pendente' })
        const count = alerts.length
        _alertsCountCache.set(key, { count, timestamp: Date.now() })
        return count
      } finally {
        _alertsCountInFlight.delete(key)
      }
    })()

    _alertsCountInFlight.set(key, promise)
    return promise
  },

  /**
   * Verificar se já existe alerta pendente para determinado cliente (prevenção de duplicidade).
   */
  async getPendingAlertForCustomer(customerId: string): Promise<AddressAlertRecord | null> {
    if (!customerId) return null
    try {
      const records = await pb.collection<AddressAlertRecord>('address_alerts').getList(1, 1, {
        filter: `customer = '${customerId}' && status = 'pendente'`,
        sort: '-created',
        requestKey: null,
      })
      return records.items[0] || null
    } catch (err) {
      console.warn('[deliveryService] Erro ao checar alerta pendente do cliente:', err)
      return null
    }
  },

  /**
   * Criar um alerta de endereço suspeito (ex.: via GPS do entregador).
   */
  async createAddressAlert(data: {
    customer: string
    company?: string
    origin: AddressAlertOrigin
    current_address?: Record<string, unknown>
    suggested_address: Record<string, unknown>
    distance_meters?: number
    notes?: string
    order_id?: string
    tracking_code?: string
    is_redirected?: boolean
  }): Promise<AddressAlertRecord | null> {
    const authUser = pb.authStore.record as any
    const activeCompanyId =
      data.company || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    // SUPRESSÃO EM ENTREGA REDIRECIONADA:
    // Se a entrega for redirecionada, NÃO criar alerta de correção de pin.
    // O ponto B já é aprovado pelo fluxo próprio de redirecionamento.
    if (data.is_redirected) {
      console.info(
        `[createAddressAlert] Suprimido: pedido ${data.tracking_code || data.order_id || ''} é entrega redirecionada. Alerta de correção de pin desnecessário.`,
      )
      return null
    }

    if (data.order_id) {
      try {
        const ord = await pb.collection<OrderRecord>('orders').getOne(data.order_id, {
          requestKey: null,
        })
        if (
          ord &&
          (ord.is_redirected ||
            ord.redirection_status === 'completed' ||
            ord.redirection_status === 'initiated' ||
            (ord as any).redirection_status === 'in_progress' ||
            ord.redirection_new_address ||
            ord.redirection_point_a_lat)
        ) {
          console.info(
            `[createAddressAlert] Suprimido: pedido ${ord.tracking_code} possui redirecionamento ativo/concluído. Alerta de pin desnecessário.`,
          )
          return null
        }
      } catch (ordErr) {
        // Ignora erro de leitura do pedido e segue com as demais guardas
      }
    }

    // ITEM A.3 — GUARDAS ANTI-BASE E ANTI-IMPRECISÃO:
    // Descartar a criação se:
    // 1. Coordenada nula/zero/NaN
    // 2. Coordenada dentro de 150m da base oficial (-22.6977499, -43.2936013)
    // 3. Accuracy > 50m
    const OFFICIAL_BASE_LAT = -22.6977499
    const OFFICIAL_BASE_LNG = -43.2936013
    const BASE_GEOFENCE_METERS = 150
    const MAX_ACCURACY_METERS = 50

    const suggested = (data.suggested_address || {}) as Record<string, any>
    const lat = Number(suggested.lat)
    const lng = Number(suggested.lng)
    const accuracy = Number(
      suggested.accuracy ??
        suggested.accuracy_meters ??
        suggested.gps_accuracy ??
        suggested.accuracyMeters ??
        0,
    )

    if (isNaN(lat) || isNaN(lng) || lat === 0 || lng === 0) {
      console.warn(
        `[createAddressAlert] Descartado: coordenadas sugeridas ausentes ou inválidas (lat=${lat}, lng=${lng}).`,
      )
      return null
    }

    const distToBase = haversineDistanceMeters(OFFICIAL_BASE_LAT, OFFICIAL_BASE_LNG, lat, lng)
    if (!isNaN(distToBase) && distToBase <= BASE_GEOFENCE_METERS) {
      console.warn(
        `[createAddressAlert] Descartado: coordenada sugerida (${lat}, ${lng}) está a ${Math.round(distToBase)}m da base oficial (geofence ${BASE_GEOFENCE_METERS}m). Alerta não gerado.`,
      )
      return null
    }

    if (accuracy > MAX_ACCURACY_METERS) {
      console.warn(
        `[createAddressAlert] Descartado: precisão GPS (${Math.round(accuracy)}m) excede teto de ${MAX_ACCURACY_METERS}m. Alerta não gerado.`,
      )
      return null
    }

    // GUARDA DE SANIDADE v0.0.472 (FUTURO):
    // Se o pin sugerido/entrega estiver a <= 150m do pin atual cadastrado do cliente,
    // mas a distância informada for > 300m, trata-se de falsa divergência (medição contra referência errada).
    // NÃO criar alerta! Auditar inconsistência e suprimir.
    if (data.customer) {
      try {
        let custLat: number | null = null
        let custLng: number | null = null
        const currentAddr = data.current_address as any
        if (
          currentAddr &&
          typeof currentAddr.lat === 'number' &&
          typeof currentAddr.lng === 'number' &&
          currentAddr.lat !== 0
        ) {
          custLat = currentAddr.lat
          custLng = currentAddr.lng
        } else {
          const custRec = await pb
            .collection('customers')
            .getOne(data.customer, { requestKey: null })
          if (custRec && typeof custRec.lat === 'number' && custRec.lat !== 0) {
            custLat = custRec.lat
            custLng = custRec.lng
          }
        }

        if (custLat !== null && custLng !== null) {
          const distToCustPinM = Math.round(haversineDistanceMeters(lat, lng, custLat, custLng))
          if (distToCustPinM <= 150) {
            console.warn(
              `[createAddressAlert] [FALSO POSITIVO SUPRIMIDO]: pin sugerido está a ${distToCustPinM}m do pin cadastrado do cliente (tolerância 150m). Distância informada no alerta foi ${data.distance_meters || 0}m. Alerta bloqueado.`,
            )
            return null
          }
        }
      } catch (errCheckCust) {
        console.warn(
          '[createAddressAlert] Falha ao verificar proximidade com pin cadastrado do cliente:',
          errCheckCust,
        )
      }
    }

    // DEDUPLICAÇÃO DE ALERTA:
    // 1 ALERTA POR ENTREGA / POR CLIENTE.
    // Se existir qualquer alerta pendente para o mesmo pedido OU para o mesmo cliente, NÃO criar outro.
    // Atualiza o existente se a nova leitura tiver melhor precisão (menor accuracy).
    if (data.customer || data.order_id || data.tracking_code) {
      try {
        const filterParts: string[] = []
        if (data.customer) {
          filterParts.push(`customer = '${data.customer}'`)
        }
        const trackingFilter = data.tracking_code || (data.notes?.match(/TRK-[0-9-]+/)?.[0] ?? '')
        if (trackingFilter) {
          filterParts.push(`notes ~ '${trackingFilter}'`)
        }

        const existingPendingList = await pb
          .collection<AddressAlertRecord>('address_alerts')
          .getList(1, 10, {
            filter: `(${filterParts.join(' || ')}) && status = 'pendente'`,
            sort: '-created',
            requestKey: null,
          })

        if (existingPendingList.items.length > 0) {
          const existing = existingPendingList.items[0]
          const existingSugg = (existing.suggested_address || {}) as Record<string, any>
          const existingAcc = Number(
            existingSugg.accuracy ??
              existingSugg.accuracy_meters ??
              existingSugg.gps_accuracy ??
              999,
          )
          const newAcc = accuracy > 0 ? accuracy : 999

          console.info(
            `[createAddressAlert] Guarda anti-duplicidade: alerta pendente #${existing.id} já existe para este pedido/cliente.`,
          )

          // Se a nova leitura for mais precisa (menor accuracy), atualiza com a melhor leitura
          if (newAcc < existingAcc) {
            return await pb.collection<AddressAlertRecord>('address_alerts').update(existing.id, {
              suggested_address: data.suggested_address,
              current_address: existing.current_address || data.current_address || {},
              distance_meters: data.distance_meters ?? existing.distance_meters,
              marked_at: new Date().toISOString(),
              notes: data.notes || existing.notes,
            })
          }
          return existing
        }

        // 2. Verificar se já existe alerta recente para o mesmo cliente (últimas 24h ou coordenada muito próxima < 30m)
        const recentList = await pb
          .collection<AddressAlertRecord>('address_alerts')
          .getList(1, 10, {
            filter: `customer = '${data.customer}'`,
            sort: '-created',
            requestKey: null,
          })

        const nowMs = Date.now()
        for (const prevAlert of recentList.items) {
          const prevCreatedMs = new Date(prevAlert.created).getTime()
          const diffMinutes = Math.abs(nowMs - prevCreatedMs) / (60 * 1000)

          const prevSugg = (prevAlert.suggested_address || {}) as Record<string, any>
          const prevLat = Number(prevSugg.lat)
          const prevLng = Number(prevSugg.lng)

          let coordDistM = Infinity
          if (
            !isNaN(prevLat) &&
            !isNaN(prevLng) &&
            prevLat !== 0 &&
            prevLng !== 0 &&
            !isNaN(lat) &&
            !isNaN(lng)
          ) {
            coordDistM = haversineDistanceMeters(prevLat, prevLng, lat, lng)
          }

          // Equivalente: coordenada a menos de ~30m OU disparado na janela recente de 30 minutos com status já aprovado/processado
          if (coordDistM <= 30 || (diffMinutes <= 30 && prevAlert.status === 'aprovado')) {
            console.info(
              `[createAddressAlert] Alerta equivalente detectado (dist=${coordDistM.toFixed(1)}m, delta=${diffMinutes.toFixed(1)}min, status=${prevAlert.status}). Evitando criação de duplicata #${prevAlert.id}.`,
            )
            return prevAlert
          }
        }
      } catch (dedupErr) {
        console.warn('[deliveryService] Erro ao verificar duplicata de alerta pendente:', dedupErr)
      }
    }

    // SNAPSHOT INTELIGENTE: Se current_address não foi passado ou não tem lat/lng, capturar do customer
    let effectiveCurrentAddress = data.current_address || {}
    if (data.customer && (!effectiveCurrentAddress || !(effectiveCurrentAddress as any).lat)) {
      try {
        const cust = await pb.collection<CustomerRecord>('customers').getOne(data.customer, {
          requestKey: null,
        })
        if (cust) {
          effectiveCurrentAddress = {
            address: cust.address || '',
            street: cust.street || '',
            number: cust.number || '',
            neighborhood: cust.neighborhood || '',
            city: cust.city || '',
            state: cust.state || '',
            postal_code: cust.postal_code || '',
            lat: cust.lat ?? null,
            lng: cust.lng ?? null,
          }
        }
      } catch (custErr) {
        console.warn(
          '[deliveryService] Falha ao capturar snapshot do cliente para alerta:',
          custErr,
        )
      }
    }

    const payload: Partial<AddressAlertRecord> = {
      customer: data.customer,
      company: activeCompanyId,
      origin: data.origin,
      status: 'pendente',
      distance_meters: data.distance_meters || 0,
      notes: data.notes || '',
      current_address: effectiveCurrentAddress,
      suggested_address: data.suggested_address,
      marked_by: authUser?.id || undefined,
      marked_at: new Date().toISOString(),
    }

    return await pb.collection<AddressAlertRecord>('address_alerts').create(payload)
  },

  /**
   * Aprovar um alerta de endereço suspeito:
   * 1. Aplica o endereço sugerido (rua, bairro, CEP, lat, lng) no cadastro do cliente respeitando Pino Explícito Soberano.
   * 2. O updateCustomer(id, data) dispara imediatamente a atualização em cascata dos pedidos afetados
   *    e o recálculo viário / resequenciamento com motor viário inteligente nas rotas ativas.
   * 3. Marca o alerta como aprovado com reviewed_by e reviewed_at.
   */
  async approveAddressAlert(
    alertId: string,
    customNotes?: string,
    resolvedUberAddress?: {
      fullAddress?: string
      street?: string
      number?: string
      complement?: string
      neighborhood?: string
      city?: string
      state?: string
      postalCode?: string
      lat?: number
      lng?: number
    },
  ): Promise<{
    success: boolean
    alert: AddressAlertRecord
  }> {
    const authUser = pb.authStore.record as any
    const alert = await pb.collection<AddressAlertRecord>('address_alerts').getOne(alertId, {
      expand: 'customer',
      requestKey: null,
    })

    const suggested = (alert.suggested_address || {}) as Record<string, any>
    const customerId = alert.customer

    // Preparar dados para o cadastro do cliente
    const currentCust = alert.expand?.customer as CustomerRecord | undefined
    const customerUpdate: Partial<CustomerRecord> = {}

    // REGRA DE PROTEÇÃO DEFINITIVA DE PIN:
    // Antes de escrever lat/lng no cliente, verificar se customer.notes contém "[CORREÇÃO DEFINITIVA"
    // Se contiver, NUNCA sobrescrever o pin canonical do cliente com coordenadas geocodificadas ou de alerta.
    // Só permitir atualização de pin quando o alerta carregar pin GPS físico do entregador
    // (alert.courier_lat/courier_lng ou suggested.lat/lng estritamente preenchidos) E o cliente NÃO tiver a nota de correção definitiva.
    const custNotes = currentCust?.notes || ''
    const hasDefinitiveCorrection = custNotes.includes('[CORREÇÃO DEFINITIVA')

    const rawCourierLat = (alert as any).courier_lat ?? suggested.lat
    const rawCourierLng = (alert as any).courier_lng ?? suggested.lng
    const hasValidCourierGps =
      rawCourierLat !== undefined &&
      rawCourierLat !== null &&
      !isNaN(Number(rawCourierLat)) &&
      rawCourierLng !== undefined &&
      rawCourierLng !== null &&
      !isNaN(Number(rawCourierLng))

    const isVarreduraCep = alert.origin === 'varredura_cep'

    // REGRA SOBERANA DE PIN CALIBRADO v0.0.472:
    // Se o pin novo for idêntico ao pin já cadastrado do cliente (tolerância <= 30m),
    // ou se o cliente tiver nota de calibração intocável ("Proibido sobrescrever por geocodificação" / "[CORREÇÃO DEFINITIVA"),
    // É ESTRITAMENTE PROIBIDO reescrever o endereço textual (street, number, neighborhood, CEP) por geocodificação estilo Uber!
    const custLatVal = currentCust?.lat ? Number(currentCust.lat) : null
    const custLngVal = currentCust?.lng ? Number(currentCust.lng) : null
    let isPinIdenticalToCurrent = false
    if (custLatVal !== null && custLngVal !== null && hasValidCourierGps) {
      const dMeters = Math.round(
        haversineDistanceMeters(
          custLatVal,
          custLngVal,
          Number(rawCourierLat),
          Number(rawCourierLng),
        ),
      )
      if (dMeters <= 30) {
        isPinIdenticalToCurrent = true
      }
    }
    const isProtectedByNote =
      custNotes.toLowerCase().includes('proibido sobrescrever') || hasDefinitiveCorrection

    // REGRA SOBERANA DE ENDEREÇO ESTILO UBER NA APROVAÇÃO:
    // Ao aprovar a correção de pin do entregador, o endereço gravado no cliente é o endereço resolvido
    // via reverse geocoding Google na coordenada física do pin (método único do produto),
    // MAS SOMENTE SE o pin novo diferir do pin cadastrado (> 30m) e o cliente não for blindado contra geocodificação.
    let uberData = resolvedUberAddress
    if (
      !isVarreduraCep &&
      !uberData &&
      hasValidCourierGps &&
      !isPinIdenticalToCurrent &&
      !isProtectedByNote
    ) {
      if (suggested.uber_resolved && suggested.address) {
        uberData = {
          fullAddress: suggested.address,
          street: suggested.street,
          number: suggested.number,
          complement: suggested.complement,
          neighborhood: suggested.neighborhood,
          city: suggested.city,
          state: suggested.state,
          postalCode: suggested.postal_code,
        }
      } else {
        try {
          const { MapDataService } = await import('@/lib/mapDataService')
          const enriched = await MapDataService.reverseGeocodePin({
            lat: Number(rawCourierLat),
            lng: Number(rawCourierLng),
            existingAddress: currentCust?.address,
            existingComplement: currentCust?.complement,
          })
          if (enriched && enriched.fullAddress) {
            uberData = {
              fullAddress: enriched.fullAddress,
              street: enriched.street,
              number: enriched.number,
              complement: enriched.complement,
              neighborhood: enriched.neighborhood,
              city: enriched.city,
              state: enriched.state,
              postalCode: enriched.postalCode,
            }
          }
        } catch (enrichErr) {
          console.warn('[approveAddressAlert] Falha ao resolver endereço estilo Uber:', enrichErr)
        }
      }
    }

    if (
      !isVarreduraCep &&
      uberData &&
      uberData.fullAddress &&
      !isPinIdenticalToCurrent &&
      !isProtectedByNote
    ) {
      customerUpdate.address = uberData.fullAddress
      if (uberData.street) customerUpdate.street = uberData.street
      if (uberData.number) (customerUpdate as any).number = uberData.number
      const preservedComplement = uberData.complement || currentCust?.complement || ''
      if (preservedComplement) customerUpdate.complement = preservedComplement
      if (uberData.neighborhood) customerUpdate.neighborhood = uberData.neighborhood
      if (uberData.city) customerUpdate.city = uberData.city
      if (uberData.state) customerUpdate.state = uberData.state
      if (uberData.postalCode) customerUpdate.postal_code = uberData.postalCode
    } else if (isPinIdenticalToCurrent || isProtectedByNote) {
      // Pin idêntico ao cadastrado ou protegido: PRESERVAR rigorosamente o endereço textual cadastrado
      console.info(
        `[approveAddressAlert] Pin idêntico ou protegido para cliente ${customerId}. Endereço textual preservado sem modificação por geocodificação.`,
      )
    } else {
      if (!currentCust?.address && suggested.address) {
        customerUpdate.address = String(suggested.address)
      }
      if (!currentCust?.street && suggested.street) {
        customerUpdate.street = String(suggested.street)
      }
      if (!currentCust?.neighborhood && suggested.neighborhood) {
        customerUpdate.neighborhood = String(suggested.neighborhood)
      }
      if (!currentCust?.city && suggested.city) {
        customerUpdate.city = String(suggested.city)
      }
      if (!currentCust?.state && suggested.state) {
        customerUpdate.state = String(suggested.state)
      }
      if (!currentCust?.postal_code && suggested.postal_code) {
        customerUpdate.postal_code = String(suggested.postal_code)
      }
    }

    if (!isVarreduraCep && !hasDefinitiveCorrection && hasValidCourierGps) {
      customerUpdate.lat = Number(rawCourierLat)
      customerUpdate.lng = Number(rawCourierLng)
    }

    // Adiciona nota no cadastro do cliente registrando a aprovação
    const prevNotes = currentCust?.notes || ''
    const approvalAuditNote = isVarreduraCep
      ? `[ALERTA ANTI-CEP APROVADO ${new Date().toLocaleDateString('pt-BR')}]: CEP/Bairro corrigido para coincidir com o pin real do cliente (alerta #${alertId}). Pin mantido intacto.`
      : `[ALERTA GPS APROVADO ${new Date().toLocaleDateString('pt-BR')}]: Pin calibrado e endereço estilo Uber atualizado via GPS entregador (alerta #${alertId}): ${customerUpdate.address || 'Posição GPS'}.`
    customerUpdate.notes = prevNotes ? `${prevNotes} | ${approvalAuditNote}` : approvalAuditNote

    // 1. Atualizar cliente - dispara automaticamente sincronização de pedidos e resequenciamento viário de rotas!
    await this.updateCustomer(customerId, customerUpdate)

    // 1.1 Registrar na trilha de auditoria (audit_trail) com autor Sistema se automático ou com dados do usuário
    // Regra estrita do projeto: user_id vazio, actor_name 'Sistema' quando automático, relation NUNCA recebe a string 'system'
    try {
      const isSystem = !authUser?.id
      const currentAddrObj = (alert.current_address || {}) as Record<string, any>

      const oldValueAudit = {
        address: currentAddrObj.address || currentCust?.address || '',
        street: currentAddrObj.street || currentCust?.street || '',
        neighborhood: currentAddrObj.neighborhood || currentCust?.neighborhood || '',
        city: currentAddrObj.city || currentCust?.city || '',
        state: currentAddrObj.state || currentCust?.state || '',
        postal_code: currentAddrObj.postal_code || currentCust?.postal_code || '',
        lat: currentAddrObj.lat ?? currentCust?.lat,
        lng: currentAddrObj.lng ?? currentCust?.lng,
      }

      const newValueAudit = {
        address: customerUpdate.address || oldValueAudit.address,
        street: customerUpdate.street || oldValueAudit.street,
        neighborhood: customerUpdate.neighborhood || oldValueAudit.neighborhood,
        city: customerUpdate.city || oldValueAudit.city,
        state: customerUpdate.state || oldValueAudit.state,
        postal_code: customerUpdate.postal_code || oldValueAudit.postal_code,
        lat: !isVarreduraCep ? customerUpdate.lat : oldValueAudit.lat,
        lng: !isVarreduraCep ? customerUpdate.lng : oldValueAudit.lng,
      }

      const auditPayload: any = {
        collection: 'customers',
        record_id: customerId,
        action: isVarreduraCep ? 'anti_cep_correction' : 'pin_entregador_approval',
        field: isVarreduraCep ? 'postal_code_and_neighborhood' : 'address_and_coordinates',
        old_value: JSON.stringify(oldValueAudit),
        new_value: JSON.stringify(newValueAudit),
        timestamp: new Date().toISOString(),
        metadata: {
          alert_id: alertId,
          origin: alert.origin,
          actor_name: isSystem ? 'Sistema' : authUser?.name || authUser?.email || 'Usuário',
          actor_email: isSystem ? 'sistema@rotaly.com' : authUser?.email || '',
          actor_role: isSystem ? 'system' : authUser?.role || 'admin',
          system_trigger: isSystem,
          kept_pin_intact: isVarreduraCep,
          distance_meters: alert.distance_meters,
          accuracy_meters: (suggested as any)?.accuracy_meters,
          suggested_source:
            (suggested as any)?.source || (isVarreduraCep ? 'cep_sweep' : 'gps_reverse'),
        },
      }
      if (authUser?.id) {
        auditPayload.user_id = authUser.id
      }
      await pb.collection('audit_trail').create(auditPayload)
    } catch (auditErr) {
      console.warn(
        '[deliveryService] Aviso ao registrar aprovação de alerta em audit_trail:',
        auditErr,
      )
    }

    // 2. Atualizar o alerta para aprovado
    const reviewedAtIso = new Date().toISOString()
    const reviewedByUserId = authUser?.id || undefined
    const finalReviewNotes = customNotes
      ? `${alert.notes ? alert.notes + ' | ' : ''}Revisão: ${customNotes}`
      : alert.notes

    const updatedAlert = await pb.collection<AddressAlertRecord>('address_alerts').update(alertId, {
      status: 'aprovado',
      reviewed_by: reviewedByUserId,
      reviewed_at: reviewedAtIso,
      notes: finalReviewNotes,
    })

    // Sincronizar outros alertas pendentes do mesmo customer aplicando o mesmo status/reviewed_by/reviewed_at
    if (customerId) {
      try {
        const otherPending = await pb.collection<AddressAlertRecord>('address_alerts').getFullList({
          filter: `customer = '${customerId}' && status = 'pendente' && id != '${alertId}'`,
          requestKey: null,
        })
        for (const other of otherPending) {
          await pb.collection<AddressAlertRecord>('address_alerts').update(other.id, {
            status: 'aprovado',
            reviewed_by: reviewedByUserId,
            reviewed_at: reviewedAtIso,
            notes: `${other.notes ? other.notes + ' | ' : ''}Aprovado em conjunto via alerta #${alertId}`,
          })
        }
      } catch (syncErr) {
        console.warn(
          '[deliveryService] Erro ao sincronizar outros alertas pendentes do cliente:',
          syncErr,
        )
      }
    }

    return { success: true, alert: updatedAlert }
  },

  /**
   * Correção AUTOMÁTICA de pin e endereço pelo entregador (desvio <= 500m):
   * 1. Atualiza diretamente o cadastro do cliente com novo pin (lat/lng) + endereço completo geocodificado
   *    (preservando o número original se o reverso não trouxer número).
   * 2. O updateCustomer(customerId, customerUpdate) atualiza pedidos não finalizados e dispara o hook
   *    customers_recalc_orders_km no backend para recalcular km e combustível sem intervenção manual.
   * 3. Registra na trilha de auditoria (audit_trail) com autor = entregador (user_id real e actor_name do entregador),
   *    motivo "correção automática de pin pelo entregador" e valores antes/depois.
   * 4. NÃO cria card em address_alerts e não requer aprovação de vendedor/admin.
   */
  async applyAddressCorrectionAutomatic(params: {
    customerId: string
    currentCustomer: Partial<CustomerRecord>
    courierUser: { id: string; name?: string; email?: string }
    suggestedAddress: {
      address: string
      street?: string
      number?: string
      neighborhood?: string
      city?: string
      state?: string
      postal_code?: string
      lat: number
      lng: number
      accuracy_meters?: number
      source?: string
    }
    distanceMeters?: number
  }): Promise<{ success: boolean; customer: CustomerRecord }> {
    const { customerId, currentCustomer, courierUser, suggestedAddress, distanceMeters } = params

    const customerUpdate: Partial<CustomerRecord> = {}
    if (suggestedAddress.address) customerUpdate.address = suggestedAddress.address
    if (suggestedAddress.street) customerUpdate.street = suggestedAddress.street
    if (suggestedAddress.neighborhood) customerUpdate.neighborhood = suggestedAddress.neighborhood
    if (suggestedAddress.city) customerUpdate.city = suggestedAddress.city
    if (suggestedAddress.state) customerUpdate.state = suggestedAddress.state
    if (suggestedAddress.postal_code) customerUpdate.postal_code = suggestedAddress.postal_code
    if (
      suggestedAddress.lat !== undefined &&
      suggestedAddress.lat !== null &&
      !isNaN(Number(suggestedAddress.lat))
    ) {
      customerUpdate.lat = Number(suggestedAddress.lat)
    }
    if (
      suggestedAddress.lng !== undefined &&
      suggestedAddress.lng !== null &&
      !isNaN(Number(suggestedAddress.lng))
    ) {
      customerUpdate.lng = Number(suggestedAddress.lng)
    }

    const prevNotes = currentCustomer?.notes || ''
    const autoNote = `[CORREÇÃO AUTOMÁTICA PIN ENTREGADOR ${new Date().toLocaleDateString('pt-BR')}]: Pin e endereço calibrados no local pelo entregador ${courierUser.name || courierUser.email} (desvio: ${distanceMeters !== undefined ? `${distanceMeters}m` : 'desconhecido'}, precisão: ~${suggestedAddress.accuracy_meters || 0}m).`
    customerUpdate.notes = prevNotes ? `${prevNotes} | ${autoNote}` : autoNote

    // 1. Atualizar cliente - dispara sincronização de pedidos e hook de km
    const updatedCustomer = await this.updateCustomer(customerId, customerUpdate)

    // 2. Registrar na trilha de auditoria (audit_trail)
    // Regra do projeto: autor = entregador (user_id real do entregador, actor_name do entregador),
    // motivo 'correção automática de pin pelo entregador', valores antes/depois
    try {
      const oldValueAudit = {
        address: currentCustomer?.address || '',
        street: currentCustomer?.street || '',
        neighborhood: currentCustomer?.neighborhood || '',
        city: currentCustomer?.city || '',
        state: currentCustomer?.state || '',
        postal_code: currentCustomer?.postal_code || '',
        lat: currentCustomer?.lat ?? null,
        lng: currentCustomer?.lng ?? null,
      }

      const newValueAudit = {
        address: customerUpdate.address || oldValueAudit.address,
        street: customerUpdate.street || oldValueAudit.street,
        neighborhood: customerUpdate.neighborhood || oldValueAudit.neighborhood,
        city: customerUpdate.city || oldValueAudit.city,
        state: customerUpdate.state || oldValueAudit.state,
        postal_code: customerUpdate.postal_code || oldValueAudit.postal_code,
        lat: customerUpdate.lat ?? oldValueAudit.lat,
        lng: customerUpdate.lng ?? oldValueAudit.lng,
      }

      const auditPayload: any = {
        collection: 'customers',
        record_id: customerId,
        courier_id: courierUser.id,
        user_id: courierUser.id,
        action: 'pin_entregador_auto',
        field: 'address_and_coordinates',
        old_value: JSON.stringify(oldValueAudit),
        new_value: JSON.stringify(newValueAudit),
        timestamp: new Date().toISOString(),
        metadata: {
          reason: 'correção automática de pin pelo entregador',
          actor_name: courierUser.name || courierUser.email || 'Entregador',
          actor_email: courierUser.email || '',
          actor_role: 'courier',
          system_trigger: false,
          distance_meters: distanceMeters,
          accuracy_meters: suggestedAddress.accuracy_meters,
          suggested_source: suggestedAddress.source || 'gps_reverse',
          auto_applied: true,
        },
      }

      await pb.collection('audit_trail').create(auditPayload)
    } catch (auditErr) {
      console.warn(
        '[deliveryService] Erro ao registrar correção automática de pin em audit_trail:',
        auditErr,
      )
    }

    return { success: true, customer: updatedCustomer }
  },

  /**
   * Reprovar um alerta de endereço suspeito:
   * Marca status = 'reprovado', com reviewed_by e reviewed_at. O cliente sai da fila pendente.
   */
  async rejectAddressAlert(
    alertId: string,
    reason?: string,
  ): Promise<{
    success: boolean
    alert: AddressAlertRecord
  }> {
    const authUser = pb.authStore.record as any
    const alert = await pb.collection<AddressAlertRecord>('address_alerts').getOne(alertId, {
      requestKey: null,
    })

    const reviewedAtIso = new Date().toISOString()
    const reviewedByUserId = authUser?.id || undefined
    const finalRejectNotes = reason
      ? `${alert.notes ? alert.notes + ' | ' : ''}Reprovação: ${reason}`
      : alert.notes

    const updatedAlert = await pb.collection<AddressAlertRecord>('address_alerts').update(alertId, {
      status: 'reprovado',
      reviewed_by: reviewedByUserId,
      reviewed_at: reviewedAtIso,
      notes: finalRejectNotes,
    })

    // Sincronizar outros alertas pendentes do mesmo customer aplicando o mesmo status reprovado
    if (alert.customer) {
      try {
        const otherPending = await pb.collection<AddressAlertRecord>('address_alerts').getFullList({
          filter: `customer = '${alert.customer}' && status = 'pendente' && id != '${alertId}'`,
          requestKey: null,
        })
        for (const other of otherPending) {
          await pb.collection<AddressAlertRecord>('address_alerts').update(other.id, {
            status: 'reprovado',
            reviewed_by: reviewedByUserId,
            reviewed_at: reviewedAtIso,
            notes: `${other.notes ? other.notes + ' | ' : ''}Reprovado em conjunto via alerta #${alertId}`,
          })
        }
      } catch (syncErr) {
        console.warn(
          '[deliveryService] Erro ao sincronizar outros alertas pendentes na reprovação:',
          syncErr,
        )
      }
    }

    return { success: true, alert: updatedAlert }
  },

  /**
   * Alias de compatibilidade para revisão unificada de endereço suspeito
   */
  async reviewAddressAlert(
    alertId: string,
    action: 'approve' | 'reject',
    notesOrReason?: string,
  ): Promise<{ success: boolean; alert: AddressAlertRecord }> {
    if (action === 'approve') {
      return this.approveAddressAlert(alertId, notesOrReason)
    }
    return this.rejectAddressAlert(alertId, notesOrReason)
  },

  /**
   * Registrar evento na trilha de auditoria (audit_trail).
   * Ações automáticas/do sistema devem usar user_id='' (ou omitido), actor_name='Sistema' e metadata.system_trigger=true.
   */
  async logAuditTrail(params: {
    action: string
    user_id?: string
    actor_name?: string
    collection: string
    record_id: string
    field?: string
    old_value?: any
    new_value?: any
    courier_id?: string
    empresa_id?: string
    metadata?: Record<string, any>
  }): Promise<AuditTrailRecord | null> {
    try {
      const isSystem = !params.user_id || params.user_id === '' || params.actor_name === 'Sistema'
      const actorName = params.actor_name || (isSystem ? 'Sistema' : 'Usuário')
      const mergedMetadata = {
        ...(params.metadata || {}),
        actor_name: actorName,
        system_trigger: isSystem ? true : (params.metadata?.system_trigger ?? false),
      }

      const payload: any = {
        action: params.action,
        user_id: isSystem ? '' : params.user_id,
        collection: params.collection,
        record_id: params.record_id,
        field: params.field || '',
        old_value: params.old_value !== undefined ? String(params.old_value) : '',
        new_value: params.new_value !== undefined ? String(params.new_value) : '',
        courier_id: params.courier_id || undefined,
        empresa_id: params.empresa_id || undefined,
        metadata: mergedMetadata,
        timestamp: new Date().toISOString(),
      }

      return await pb.collection<AuditTrailRecord>('audit_trail').create(payload, {
        requestKey: null,
      })
    } catch (err) {
      console.warn('[deliveryService] Erro ao gravar audit_trail:', err)
      return null
    }
  },

  /**
   * Buscar registros da trilha de auditoria (read-only)
   */
  async getAuditTrail(params?: {
    page?: number
    perPage?: number
    courierId?: string
    entity?: string
    filter?: string
  }): Promise<{ items: AuditTrailRecord[]; totalItems: number; totalPages: number }> {
    try {
      const page = params?.page || 1
      const perPage = params?.perPage || 25
      const filters: string[] = []

      if (params?.courierId && params.courierId !== 'all') {
        filters.push(`courier_id = '${params.courierId}'`)
      }
      if (params?.entity && params.entity !== 'all') {
        filters.push(`entity = '${params.entity}'`)
      }
      if (params?.filter) {
        filters.push(params.filter)
      }

      const res = await pb.collection<AuditTrailRecord>('audit_trail').getList(page, perPage, {
        filter: filters.length > 0 ? filters.join(' && ') : '',
        sort: '-created',
        expand: 'actor_id,courier_id,empresa_id',
        requestKey: null,
      })

      return {
        items: res.items,
        totalItems: res.totalItems,
        totalPages: res.totalPages,
      }
    } catch (err) {
      console.warn('[deliveryService] Erro ao carregar audit_trail:', err)
      return { items: [], totalItems: 0, totalPages: 0 }
    }
  },

  /**
   * Buscar aprovações de KM de rota por empresa ou geral,
   * parametrizada opcionalmente com startDate/endDate gerados a partir de getOperationalWindow()
   * (janela operacional de Brasília 05h–23h59, madrugada = dia anterior),
   * garantindo que as telas de auditoria nunca consultem por meia-noite UTC.
   */
  async getRouteKmApprovals(
    empresaId?: string,
    options?: { startDate?: string; endDate?: string },
  ): Promise<RouteKmApprovalRecord[]> {
    try {
      const clauses: string[] = []
      if (empresaId && empresaId !== 'ALL') {
        clauses.push(`empresa_id = '${empresaId}'`)
      }

      // Se fornecido startDate/endDate explícito, respeita
      if (options?.startDate) {
        clauses.push(`created >= '${options.startDate}'`)
      } else {
        const opWindow = getOperationalWindow(new Date())
        clauses.push(`created >= '${opWindow.startPbString}'`)
      }
      if (options?.endDate) {
        clauses.push(`created <= '${options.endDate}'`)
      } else {
        const opWindow = getOperationalWindow(new Date())
        clauses.push(`created <= '${opWindow.endPbString}'`)
      }

      const filter = clauses.join(' && ')
      return await pb.collection<RouteKmApprovalRecord>('route_km_approvals').getFullList({
        filter,
        sort: '-approved_at,-created',
        expand: 'order_id,courier_id,approved_by,empresa_id',
        requestKey: null,
      })
    } catch (err) {
      console.warn('[deliveryService] Erro ao buscar aprovações de KM:', err)
      return []
    }
  },

  /**
   * Aprovar ou Rejeitar ajuste de KM com auditoria completa
   */
  async saveRouteKmApproval(params: {
    orderId: string
    courierId: string
    empresaId?: string
    routeBatchKey?: string
    originalRoadKm: number
    originalGpsKm?: number
    approvedKm: number
    status: 'approved' | 'rejected' | 'pending'
    justification?: string
    approvalType?: 'manual_deviation' | 'redirection_auto' | 'redirection_manual'
    extraKm?: number
    pointALat?: number
    pointALng?: number
    pointBLat?: number
    pointBLng?: number
    newAddress?: string
    calculationMethod?: string
  }): Promise<RouteKmApprovalRecord | null> {
    // REGRA DO DONO: Entregador com vehicle_type 'bicicleta' / 'bike' NÃO pode gerar registros
    // na coleção route_km_approvals (bicicleta não tem pagamento por km).
    if (params.courierId) {
      try {
        const courierUser = await pb.collection<UserRecord>('users').getOne(params.courierId, {
          fields: 'id,vehicle_type',
          requestKey: null,
        })
        const vCat = this.normalizeVehicleCategory(courierUser?.vehicle_type)
        if (vCat === 'bicicleta') {
          return null
        }
      } catch (errCourier) {
        console.warn('[saveRouteKmApproval] Falha ao verificar veículo do entregador:', errCourier)
      }
    }

    const roadKm = Number((params.originalRoadKm ?? 0).toFixed(1))
    const gpsKm =
      params.originalGpsKm !== undefined ? Number(params.originalGpsKm.toFixed(1)) : undefined
    const approvedKmNum = Number((params.approvedKm ?? 0).toFixed(1))

    // REGRA 1.2 (Decisão do dono):
    // Aprovação do menor entre Coluna A (viário) e Coluna B (telemetria) é automática e invisível.
    // approved_km MAIOR que min(A, B) é RECUSADO sem justificativa textual obrigatória (mín 15 caracteres)
    // + audit_trail action 'km_manual_approval_override' com metadata {prev_road_km, telemetry_km, approved_km, justification}.
    const minCanonical = gpsKm !== undefined && gpsKm > 0 ? Math.min(roadKm, gpsKm) : roadKm

    const justificationTrimmed = (params.justification || '').trim()
    const isOverrideAboveMin = approvedKmNum > minCanonical

    if (params.status === 'approved' && isOverrideAboveMin) {
      if (justificationTrimmed.length < 15) {
        throw new Error(
          `Aprovação de KM (${approvedKmNum} km) superior ao menor valor (${minCanonical} km) exige justificativa obrigatória com no mínimo 15 caracteres.`,
        )
      }
    }

    const authUser = pb.authStore.record as any

    // Verificar se já existe aprovação prévia para esta entrega
    const existing = await pb
      .collection<RouteKmApprovalRecord>('route_km_approvals')
      .getList(1, 1, {
        filter: `order_id = '${params.orderId}'`,
        requestKey: null,
      })

    // Resolver empresa_id de forma resiliente:
    // 1. params.empresaId explícito (se diferente de 'ALL')
    // 2. Ou consultar a própria order caso empresaId venha vazio/ausente
    // 3. Ou Matriz como fallback
    let resolvedEmpresaId = params.empresaId && params.empresaId !== 'ALL' ? params.empresaId : ''

    if (!resolvedEmpresaId && params.orderId) {
      try {
        const orderRec = await pb.collection('orders').getOne(params.orderId, {
          fields: 'empresa_id',
          requestKey: null,
        })
        if (orderRec?.empresa_id) {
          resolvedEmpresaId = orderRec.empresa_id
        }
      } catch {
        /* fallback silencioso */
      }
    }

    if (!resolvedEmpresaId) {
      resolvedEmpresaId = (await this.getMatrizCompanyId()) || ''
    }

    const payload: any = {
      order_id: params.orderId,
      courier_id: params.courierId,
      empresa_id: resolvedEmpresaId || undefined,
      route_batch_key: params.routeBatchKey || undefined,
      original_road_km: Number((params.originalRoadKm ?? 0).toFixed(1)),
      original_gps_km:
        params.originalGpsKm !== undefined ? Number(params.originalGpsKm.toFixed(1)) : undefined,
      approved_km: Number((params.approvedKm ?? 0).toFixed(1)),
      status: params.status,
      justification: params.justification || '',
      approved_by: authUser?.id || '',
      approved_at: new Date().toISOString(),
      approval_type: params.approvalType || 'manual_deviation',
      extra_km: params.extraKm !== undefined ? Number(params.extraKm.toFixed(1)) : undefined,
      point_a_lat: params.pointALat,
      point_a_lng: params.pointALng,
      point_b_lat: params.pointBLat,
      point_b_lng: params.pointBLng,
      new_address: params.newAddress || undefined,
      calculation_method: params.calculationMethod || undefined,
    }

    let savedApproval: RouteKmApprovalRecord
    if (existing.items.length > 0) {
      savedApproval = await pb
        .collection<RouteKmApprovalRecord>('route_km_approvals')
        .update(existing.items[0].id, payload, {
          expand: 'order_id,courier_id,approved_by,empresa_id',
        })
    } else {
      savedApproval = await pb
        .collection<RouteKmApprovalRecord>('route_km_approvals')
        .create(payload, {
          expand: 'order_id,courier_id,approved_by,empresa_id',
        })
    }

    // Gravar audit_trail quando houver override manual acima do min(A, B)
    if (params.status === 'approved' && isOverrideAboveMin) {
      try {
        await pb.collection('audit_trail').create({
          user_id: authUser?.id || '',
          actor_name: authUser?.name || 'Administrador',
          actor_role: authUser?.role || 'admin',
          collection: 'route_km_approvals',
          record_id: savedApproval.id,
          courier_id: params.courierId,
          action: 'km_manual_approval_override',
          field: 'approved_km',
          old_value: String(minCanonical),
          new_value: String(approvedKmNum),
          timestamp: new Date().toISOString(),
          metadata: {
            prev_road_km: roadKm,
            telemetry_km: gpsKm ?? null,
            approved_km: approvedKmNum,
            justification: justificationTrimmed,
          },
        })
      } catch (auditErr) {
        console.warn('[saveRouteKmApproval] Falha ao gravar audit_trail de override:', auditErr)
      }
    }

    return savedApproval
  },

  /**
   * FLUXO ENTREGA REDIRECIONADA:
   * 1. Iniciar redirecionamento: grava Ponto A (coordenada GPS atual no endereço original do sistema),
   *    timestamp e marca status 'initiated'.
   */
  async initiateDeliveryRedirection(params: {
    orderId: string
    courierId: string
    pointALat: number
    pointALng: number
    pointAAt?: string
    newAddressText?: string
  }): Promise<OrderRecord> {
    const at = params.pointAAt || new Date().toISOString()
    const updatePayload: Partial<OrderRecord> = {
      redirection_status: 'initiated',
      is_redirected: true,
      redirection_point_a_lat: params.pointALat,
      redirection_point_a_lng: params.pointALng,
      redirection_point_a_at: at,
      redirection_new_address: params.newAddressText || '',
    }
    return await pb.collection<OrderRecord>('orders').update(params.orderId, updatePayload, {
      expand: 'customer_id,courier_id,seller_id',
    })
  },

  /**
   * FLUXO ENTREGA REDIRECIONADA:
   * 2. Confirmar entrega redirecionada: grava Ponto B, calcula KM extra,
   *    atualiza status do pedido para delivered com flag de redirecionamento,
   *    cria registro em route_km_approvals (auto-aprovado se extra_km <= 3.0, pendente se > 3.0),
   *    e opcionalmente atualiza o cadastro oficial do cliente.
   */
  async confirmDeliveryRedirection(params: {
    order: OrderRecord
    courierId: string
    pointBLat: number
    pointBLng: number
    pointBAt?: string
    newAddressText: string
    updateCustomerAddressOfficial: boolean
    proofPhoto?: File | null
    signature?: File | null
    receiverName?: string
    notes?: string
    extraKmCalculated?: number
    calculationMethod?: 'telemetry_gps' | 'haversine_road_factor'
  }): Promise<{ order: OrderRecord; approval: RouteKmApprovalRecord | null; extraKm: number }> {
    const order = params.order
    const authUser = pb.authStore.record as any
    const now = params.pointBAt || new Date().toISOString()

    const orderDestA = MapDataService.getOrderDestination(order)
    const pointALat = order.redirection_point_a_lat ?? orderDestA?.lat ?? 0
    const pointALng = order.redirection_point_a_lng ?? orderDestA?.lng ?? 0
    const pointBLat = params.pointBLat
    const pointBLng = params.pointBLng

    // 1. Calcular KM Extra Líquido: max(0, trecho_real_percorrido − perna_já_contada)
    const pernaJaContada = Number(
      (typeof order.distance_km === 'number' && order.distance_km > 0
        ? order.distance_km
        : 0
      ).toFixed(1),
    )

    let extraKm = params.extraKmCalculated
    let method = params.calculationMethod || 'haversine_road_factor'

    if (extraKm === undefined || isNaN(extraKm) || extraKm < 0) {
      if (pointALat && pointALng && pointBLat && pointBLng) {
        // Fallback: Haversine com fator viário urbano (1.3x)
        const R = 6371
        const φ1 = (pointALat * Math.PI) / 180
        const φ2 = (pointBLat * Math.PI) / 180
        const Δφ = ((pointBLat - pointALat) * Math.PI) / 180
        const Δλ = ((pointBLng - pointALng) * Math.PI) / 180
        const a =
          Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
          Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const distDirect = R * c
        const trechoReal = Number((distDirect * 1.3).toFixed(1))
        // Extra líquido: trecho real percorrido menos a perna já contada no pedido
        extraKm = Number(Math.max(0, trechoReal - pernaJaContada).toFixed(1))
        method = 'haversine_road_factor'
      } else {
        extraKm = 0
      }
    } else {
      extraKm = Number(extraKm.toFixed(1))
    }

    // 2. Determinar status de aprovação avaliado no EXTRA LÍQUIDO: <= 3.0 km = automatic approved; > 3.0 km = pending
    const isAutoApproved = extraKm <= 3.0
    const approvalStatus: RouteKmApprovalStatus = isAutoApproved ? 'approved' : 'pending'
    const approvalType: RouteKmApprovalType = isAutoApproved
      ? 'redirection_auto'
      : 'redirection_manual'

    const originalRoadKm = Number(
      (typeof order.distance_km === 'number' && order.distance_km > 0
        ? order.distance_km
        : 0
      ).toFixed(1),
    )
    const approvedKm = isAutoApproved
      ? Number((originalRoadKm + extraKm).toFixed(1))
      : originalRoadKm

    // 3. Montar FormData para o pedido (com fotos e assinatura se houver)
    const formData = new FormData()
    formData.append('status', 'delivered')
    formData.append('completion_reason', 'delivered')
    formData.append('actual_arrival', now)
    formData.append('redirection_status', 'completed')
    formData.append('is_redirected', 'true')
    formData.append('redirection_point_b_lat', String(pointBLat))
    formData.append('redirection_point_b_lng', String(pointBLng))
    formData.append('redirection_point_b_at', now)
    formData.append('redirection_new_address', params.newAddressText || '')
    formData.append('redirection_extra_km', String(extraKm))
    formData.append(
      'customer_address_updated',
      params.updateCustomerAddressOfficial ? 'true' : 'false',
    )

    // Observações do pedido
    const receiver = params.receiverName?.trim() || order.expand?.customer_id?.name || 'Cliente'
    formData.append('receiver_name', receiver)
    const redirectNote = `[Entregue — Endereço Redirecionado] Ponto B: ${params.newAddressText || 'Novo endereço informado'}. Desvio: +${extraKm.toFixed(1)} km (${isAutoApproved ? 'Aprovado automático ≤3km' : 'Pendente de revisão Central >3km'})`
    const finalNotes = order.notes ? `${order.notes} | ${redirectNote}` : redirectNote
    formData.append('notes', params.notes ? `${finalNotes} - ${params.notes}` : finalNotes)

    if (params.proofPhoto) {
      formData.append('proof_photo', params.proofPhoto)
    }
    if (params.signature) {
      formData.append('signature', params.signature)
    }

    const updatedOrder = await pb.collection<OrderRecord>('orders').update(order.id, formData, {
      expand: 'customer_id,courier_id,seller_id',
    })

    // Registrar no audit_trail a mudança de endereço/redirecionamento pelo entregador
    try {
      await pb.collection('audit_trail').create({
        user_id: authUser?.id || '',
        actor_name: authUser?.name || 'Entregador',
        actor_role: 'courier',
        collection: 'orders',
        record_id: order.id,
        courier_id: params.courierId,
        action: 'customer_address_moved_redirection',
        field: 'redirection_new_address',
        old_value: order.end_address_text || '',
        new_value: `${params.newAddressText || ''} (+${extraKm.toFixed(1)}km)`,
        timestamp: now,
        metadata: {
          point_a: { lat: pointALat, lng: pointALng },
          point_b: { lat: pointBLat, lng: pointBLng },
          extra_km: extraKm,
          is_auto_approved: isAutoApproved,
          tracking_code: order.tracking_code,
          suggested_customer_update: params.updateCustomerAddressOfficial,
        },
      })
    } catch (auditErr) {
      console.warn('[deliveryService] Erro ao gravar audit_trail de redirecionamento:', auditErr)
    }

    // 4. Se o usuário solicitou atualizar o cadastro oficial do cliente
    if (params.updateCustomerAddressOfficial && order.customer_id) {
      try {
        await pb.collection('customers').update(order.customer_id, {
          address: params.newAddressText,
          lat: pointBLat,
          lng: pointBLng,
          notes: `Endereço atualizado via confirmação redirecionada em ${new Date().toLocaleDateString('pt-BR')}`,
        })
      } catch (custErr) {
        console.warn('[deliveryService] Aviso ao atualizar cadastro do cliente:', custErr)
      }
    }

    // 5. Criar registro em route_km_approvals
    // Arredondar timestamps ao minuto para evitar que pedidos da mesma rota com segundos divergentes se separem
    let batchKey = 'single_' + order.id
    if (order.route_started_at && order.route_finished_at) {
      const startMin = Math.floor(new Date(order.route_started_at).getTime() / 60000)
      const finishMin = Math.floor(new Date(order.route_finished_at).getTime() / 60000)
      batchKey = `route_m_${startMin}_${finishMin}`
    } else if (order.route_started_at) {
      batchKey = `batch_${Math.floor(new Date(order.route_started_at).getTime() / (15 * 60 * 1000))}`
    }

    const approval = await this.saveRouteKmApproval({
      orderId: order.id,
      courierId: params.courierId,
      empresaId: order.empresa_id,
      routeBatchKey: batchKey,
      originalRoadKm,
      originalGpsKm: Number((originalRoadKm + extraKm).toFixed(1)),
      approvedKm,
      status: approvalStatus,
      justification: `Redirecionamento informado pelo entregador: ${params.newAddressText || 'novo endereço'} (+${extraKm} km extra). Ponto A: (${pointALat.toFixed(5)}, ${pointALng.toFixed(5)}) → Ponto B: (${pointBLat.toFixed(5)}, ${pointBLng.toFixed(5)}).`,
      approvalType,
      extraKm,
      pointALat,
      pointALng,
      pointBLat,
      pointBLng,
      newAddress: params.newAddressText,
      calculationMethod: method,
    })

    // 6. Criar notificação interna
    try {
      await pb.collection('notifications').create({
        user_id: authUser?.id || undefined,
        title: isAutoApproved
          ? `Entrega Redirecionada Aprovada: ${order.tracking_code}`
          : `Entrega Redirecionada Requer Revisão: ${order.tracking_code}`,
        message: `Entrega redirecionada com +${extraKm.toFixed(1)} km extra para ${receiver}. ${isAutoApproved ? 'Aprovado automaticamente no cálculo oficial.' : 'Desvio >3km aguardando revisão na Auditoria de KM.'}`,
        type: isAutoApproved ? 'order' : 'warning',
        read: false,
        order_id: order.id,
      })
    } catch {
      /* intentionally ignored */
    }

    return { order: updatedOrder, approval, extraKm }
  },

  /**
   * Validação preventiva assíncrona não-bloqueante de coerência entre CEP e Pin do cliente:
   * Se haversineDistanceMeters(pin do cliente, centróide do CEP/bairro via lookupViaCep + geocodeAddressUnified) > 500,
   * cria address_alert via deliveryService.createAddressAlert com origin 'varredura_cep', status 'pendente',
   * current_address (snapshot do pin/endereço), suggested_address (dados do CEP com lat/lng idênticos ao pin original,
   * keep_pin true — pin é soberano, conforme migração 0118).
   * Sem mover pin, sem bloquear criação.
   */
  async checkCustomerCepDivergencePreventive(params: {
    customerId: string
    customerPin: { lat: number; lng: number }
    postalCode?: string
    currentAddressText?: string
    neighborhood?: string
    city?: string
    state?: string
    companyId?: string
  }): Promise<void> {
    try {
      const {
        customerId,
        customerPin,
        postalCode,
        currentAddressText,
        neighborhood,
        city,
        state,
        companyId,
      } = params
      if (!customerId || !customerPin || !customerPin.lat || !customerPin.lng) return

      const cleanCep = (postalCode || '').replace(/\D/g, '')
      if (cleanCep.length !== 8) return

      // Evita duplicar alertas pendentes para o mesmo cliente
      const pendingAlert = await this.getPendingAlertForCustomer(customerId)
      if (pendingAlert) return

      // 1. Obter dados do CEP via lookupViaCep
      const { lookupViaCep, geocodeAddressUnified } = await import('../lib/googleMaps')
      const cepData = await lookupViaCep(cleanCep)
      if (!cepData) return

      // 2. Geocodificar centróide do CEP/bairro
      const queryAddress = [
        cepData.street || '',
        cepData.neighborhood || neighborhood || '',
        cepData.city || city || '',
        cepData.state || state || '',
        cleanCep,
      ]
        .filter(Boolean)
        .join(', ')

      const centroidResult = await geocodeAddressUnified(queryAddress, customerPin)
      if (
        !centroidResult ||
        typeof centroidResult.lat !== 'number' ||
        typeof centroidResult.lng !== 'number'
      ) {
        return
      }

      // 3. Comparar haversineDistanceMeters(pin do cliente, centróide)
      const { haversineDistanceMeters } = await import('../lib/geo')
      const distMeters = haversineDistanceMeters(
        customerPin.lat,
        customerPin.lng,
        centroidResult.lat,
        centroidResult.lng,
      )

      if (distMeters > 500) {
        // Pin diverge do centróide do CEP em mais de 500m.
        // Criar address_alert mantendo o pin vigente soberano (keep_pin: true, lat/lng do pin original)
        await this.createAddressAlert({
          customer: customerId,
          company: companyId,
          origin: 'varredura_cep',
          distance_meters: Math.round(distMeters),
          notes: `Divergência preventiva detectada: pin a ${Math.round(distMeters)}m do centróide do CEP ${cleanCep} (${cepData.neighborhood || 'bairro não informado'}). Pin é soberano e foi mantido intacto.`,
          current_address: {
            address: currentAddressText || '',
            postal_code: cleanCep,
            neighborhood: neighborhood || '',
            lat: customerPin.lat,
            lng: customerPin.lng,
          },
          suggested_address: {
            address: cepData.formattedAddress || queryAddress,
            street: cepData.street || '',
            neighborhood: cepData.neighborhood || neighborhood || '',
            city: cepData.city || city || '',
            state: cepData.state || state || '',
            postal_code: cepData.postalCode || cleanCep,
            // PIN É SOBERANO (migração 0118): lat/lng idênticos ao pin original
            lat: customerPin.lat,
            lng: customerPin.lng,
            keep_pin: true,
          },
        })
      }
    } catch (err) {
      console.warn('[deliveryService] Falha silenciosa na validação preventiva de CEP:', err)
    }
  },

  /**
   * MOTOR CANÔNICO DE TELEMETRIA:
   * Busca o registro canônico de telemetria processado no servidor para o lote (route_batch_key)
   * Coleção: route_batch_telemetry
   */
  async getRouteBatchTelemetry(routeBatchKey: string): Promise<RouteBatchTelemetryRecord | null> {
    if (!routeBatchKey) return null
    try {
      const rec = await pb
        .collection('route_batch_telemetry')
        .getFirstListItem<RouteBatchTelemetryRecord>(`route_batch_key = "${routeBatchKey}"`, {
          expand: 'courier_id,empresa_id',
        })
      return rec
    } catch (err: any) {
      // Se não encontrou (404), retorna null sem estourar exceção
      if (err?.status === 404) {
        return null
      }
      console.warn('[deliveryService] Falha ao buscar route_batch_telemetry:', err)
      return null
    }
  },

  /**
   * MOTOR CANÔNICO DE TELEMETRIA:
   * Dispara o endpoint HTTP backend para reprocessar a telemetria canônica do lote sob demanda
   * POST /backend/v1/telemetria-lote/processar
   */
  async reprocessRouteBatchTelemetry(routeBatchKey: string): Promise<{
    success: boolean
    data?: any
    error?: string
  }> {
    if (!routeBatchKey) {
      return { success: false, error: 'Chave de lote route_batch_key não informada' }
    }
    try {
      const baseUrl = import.meta.env.VITE_POCKETBASE_URL || ''
      const res = await pb.send('/backend/v1/telemetria-lote/processar', {
        method: 'POST',
        body: { route_batch_key: routeBatchKey },
      })
      return { success: true, data: res }
    } catch (err: any) {
      console.warn('[deliveryService] Falha ao acionar endpoint telemetria-lote/processar:', err)
      return {
        success: false,
        error: err?.message || 'Falha ao reprocessar telemetria canônica do lote',
      }
    }
  },

  /**
   * MOTOR CANÔNICO DE TELEMETRIA:
   * Lista todos os registros de telemetria de lotes (ou filtrado por chaves)
   */
  async listRouteBatchTelemetry(batchKeys?: string[]): Promise<RouteBatchTelemetryRecord[]> {
    try {
      let filter = ''
      if (batchKeys && batchKeys.length > 0) {
        filter = batchKeys.map((k) => `route_batch_key = "${k}"`).join(' || ')
      }
      const records = await pb
        .collection('route_batch_telemetry')
        .getFullList<RouteBatchTelemetryRecord>({
          filter: filter || undefined,
          sort: '-created',
          expand: 'courier_id,empresa_id',
        })
      return records
    } catch (err) {
      console.warn('[deliveryService] Falha ao listar route_batch_telemetry:', err)
      return []
    }
  },
}
