import pb from '@/lib/pocketbase/client'
import { getMatrizCompanyId, resolveMatrizCompany } from '@/lib/companyResolver'
import { haversineDistanceMeters } from '@/lib/geo'
import { calculateCourierFuelMetrics } from '@/hooks/useCourierFuelMetrics'
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
  ColaboradorRecord,
  RotaRecord,
  EntregaRecord,
  RelatorioRecord,
  AddressAlertRecord,
  AddressAlertStatus,
  AddressAlertOrigin,
  FuelPaymentMethod,
} from '@/types/delivery'

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
    const papelMembro =
      params.role === 'courier' || user.role === 'courier'
        ? 'courier'
        : params.role === 'seller' || user.role === 'seller'
          ? 'seller'
          : 'admin'

    // Validar limites de plano da empresa
    const limitCheck = await this.checkUserLimit(targetCompanyId, papelMembro === 'courier')
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
      const courierMembers = currentMembers.filter((m) => m.papel === 'courier')
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

    try {
      // 1. Busca direta exata na coleção orders (com expansão completa)
      // Nota: o query param tracking_code é passado explicitamente para satisfazer a regra @request.query.tracking_code
      const list = await pb.collection<OrderRecord>('orders').getList(1, 1, {
        filter: `tracking_code = '${code}'`,
        expand: 'customer_id,courier_id,seller_id',
        tracking_code: code,
        requestKey: null,
      } as any)
      if (list.items[0]) return list.items[0]
    } catch (err) {
      console.warn('Erro ao buscar pedido com expand por tracking_code na coleção orders:', err)
      // Fallback de resiliência: se a expansão falhar (ex: por regra de RLS em coleção relacionada),
      // busca o pedido puro sem expand para que a tela não quebre.
      try {
        const listPure = await pb.collection<OrderRecord>('orders').getList(1, 1, {
          filter: `tracking_code = '${code}'`,
          tracking_code: code,
          requestKey: null,
        } as any)
        if (listPure.items[0]) {
          const rawOrder = listPure.items[0]
          // Tentar carregar cliente e courier isoladamente de forma tolerante a falhas
          let cust: CustomerRecord | undefined
          let cour: UserRecord | undefined
          let sel: UserRecord | undefined

          if (rawOrder.customer_id) {
            try {
              cust = await pb
                .collection<CustomerRecord>('customers')
                .getOne(rawOrder.customer_id, { requestKey: null })
            } catch {
              /* intentionally ignored */
            }
          }
          if (rawOrder.courier_id) {
            try {
              cour = await pb
                .collection<UserRecord>('users')
                .getOne(rawOrder.courier_id, { requestKey: null })
            } catch {
              /* intentionally ignored */
            }
          }
          if (rawOrder.seller_id) {
            try {
              sel = await pb
                .collection<UserRecord>('users')
                .getOne(rawOrder.seller_id, { requestKey: null })
            } catch {
              /* intentionally ignored */
            }
          }

          rawOrder.expand = {
            ...(rawOrder.expand || {}),
            ...(cust ? { customer_id: cust } : {}),
            ...(cour ? { courier_id: cour } : {}),
            ...(sel ? { seller_id: sel } : {}),
          }
          return rawOrder
        }
      } catch (pureErr) {
        console.warn('Erro na busca de pedido sem expand:', pureErr)
      }
    }

    try {
      // 2. Fallback caso a formatação tenha espaçamento ou case ligeiramente diferente
      const listFuzzy = await pb.collection<OrderRecord>('orders').getList(1, 1, {
        filter: `tracking_code ~ '${code}' || tracking_code = '${code}'`,
        expand: 'customer_id,courier_id,seller_id',
        tracking_code: code,
        requestKey: null,
      } as any)
      if (listFuzzy.items[0]) return listFuzzy.items[0]
    } catch (err) {
      console.warn('Erro na busca aproximada por tracking_code:', err)
      try {
        const listFuzzyPure = await pb.collection<OrderRecord>('orders').getList(1, 1, {
          filter: `tracking_code ~ '${code}' || tracking_code = '${code}'`,
          tracking_code: code,
          requestKey: null,
        } as any)
        if (listFuzzyPure.items[0]) return listFuzzyPure.items[0]
      } catch {
        /* intentionally ignored */
      }
    }

    // 3. Fallback adicional de alta resiliência: se a busca direta por orders falhou,
    // tenta obter o pedido com as informações básicas a partir do endpoint público de rota (/backend/v1/public-track/:code/route)
    try {
      const publicRoute = await this.getPublicTrackingRoute(code)
      if (publicRoute && publicRoute.destination) {
        const orderId = (publicRoute as any).order_id || `pub_${code}`
        const synthesizedOrder: Partial<OrderRecord> = {
          id: orderId,
          tracking_code: code,
          status: (publicRoute.status as any) || 'in_transit',
          sequence: publicRoute.sequence,
          courier_id: publicRoute.courier_id,
          estimated_arrival: (publicRoute as any).estimated_arrival || '',
          route_released: (publicRoute as any).route_released ?? true,
          route_started: (publicRoute as any).route_started ?? true,
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          collectionId: 'orders',
          collectionName: 'orders',
          expand: {
            customer_id: {
              id: `cust_${code}`,
              name: publicRoute.destination.name,
              address: publicRoute.destination.address,
              lat: publicRoute.destination.lat,
              lng: publicRoute.destination.lng,
              phone: '',
              created: '',
              updated: '',
              collectionId: 'customers',
              collectionName: 'customers',
            } as any,
          },
        }

        // Tenta carregar entregador se courier_id existir
        if (publicRoute.courier_id) {
          try {
            const cour = await pb
              .collection<UserRecord>('users')
              .getOne(publicRoute.courier_id, { requestKey: null })
            if (cour && synthesizedOrder.expand) {
              synthesizedOrder.expand.courier_id = cour
            }
          } catch {
            /* intentionally ignored */
          }
        }

        return synthesizedOrder as OrderRecord
      }
    } catch (routeFallbackErr) {
      console.warn('Erro no fallback pelo endpoint público de rota:', routeFallbackErr)
    }

    return null
  },

  /**
   * Obtém detalhes da rota pública (paradas anteriores da ordem de otimização)
   * para cálculo real viário de ETA (+3 min por parada)
   */
  async getPublicTrackingRoute(trackingCode: string) {
    try {
      return await pb.send<{
        tracking_code: string
        status: string
        sequence: number
        courier_id: string
        destination: { name: string; lat: number; lng: number; address: string } | null
        stops_before: { sequence: number; lat: number; lng: number }[]
        total_stops_before: number
      }>(
        `/backend/v1/public-track/${encodeURIComponent(trackingCode.trim().toUpperCase())}/route`,
        {
          method: 'GET',
          requestKey: null,
        },
      )
    } catch (err) {
      console.warn('Erro ao carregar rota pública:', err)
      return null
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

    // Se as coordenadas foram alteradas, sincronizar pedidos afetados não entregues/cancelados
    // e recalcular na hora o trajeto viário oficial de rotas ativas
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
          await pb.collection('orders').update(ord.id, ordUpdate)
          if (ord.courier_id) {
            courierIdsToResequence.add(ord.courier_id)
          }
        }
        for (const courierId of courierIdsToResequence) {
          try {
            await this.resequenceActiveRouteForCourier(courierId)
          } catch (reseqErr) {
            console.warn(
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

        await pb.collection('orders').delete(ord.id)
        deletedOrdersCount++
      }

      // 3. Excluir o cliente
      await pb.collection('customers').delete(customerId)

      return { success: true, deletedOrdersCount }
    }
  },

  // Users / Couriers / Sellers
  // Filtrados pela empresa ativa através dos vínculos da coleção membros (ativo = true)
  async getCouriers(empresaId?: string) {
    const authUser = pb.authStore.record as any
    const isMaster = authUser?.role === 'master'
    const targetCompanyId =
      empresaId || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    // Se for Master e não especificou empresa (ou empresa é ALL), pode ver todos
    if (isMaster && empresaId === 'ALL') {
      const list = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'courier'",
        sort: '-created',
        requestKey: null,
      })
      const couriersMap = new Map<string, UserRecord>()
      for (const u of list) {
        if (u && u.id && !couriersMap.has(u.id)) {
          couriersMap.set(u.id, {
            ...u,
            vehicle_type: u.vehicle_type || 'moto',
            status: u.status === 'inactive' ? ('inactive' as const) : ('active' as const),
          })
        }
      }
      return Array.from(couriersMap.values())
    }

    // Filtrar entregadores membros da empresa ativa e UNIR com a lista de users com role='courier'
    // Garantindo deduplicação por id e nunca descartando entregadores cadastrados em users
    const couriersMap = new Map<string, UserRecord>()

    try {
      const members = await pb.collection<MembroRecord>('membros').getFullList({
        filter: `empresa_id = '${targetCompanyId}' && ativo = true && (papel = 'courier' || papel = 'entregador')`,
        expand: 'user_id',
        sort: '-created',
        requestKey: null,
      })

      for (const m of members) {
        const u = m.expand?.user_id as UserRecord | undefined
        // Ignora vínculos órfãos ou registros inválidos e deduplica por ID de usuário
        if (u && u.id && (u.role === 'courier' || !u.role)) {
          if (!couriersMap.has(u.id)) {
            couriersMap.set(u.id, {
              ...u,
              vehicle_type: u.vehicle_type || 'moto',
              status: u.status === 'inactive' ? ('inactive' as const) : ('active' as const),
            } as UserRecord)
          }
        }
      }
    } catch (e) {
      console.warn('Erro ao filtrar couriers por membros:', e)
    }

    // Sempre buscar couriers da coleção users e UNIR (dedup por id)
    // Se for Matriz ou filial principal, une todos os usuários com role='courier' (excluindo apenas quem for membro exclusivo de outra empresa ativa)
    try {
      const isMatriz = await this.isMatrizCompany(targetCompanyId)
      const usersList = await pb.collection<UserRecord>('users').getFullList({
        filter: "role = 'courier'",
        sort: '-created',
        requestKey: null,
      })

      let otherCompanyMemberUserIds = new Set<string>()
      if (!isMatriz) {
        try {
          const otherMembers = await pb.collection<MembroRecord>('membros').getFullList({
            filter: `empresa_id != '${targetCompanyId}' && ativo = true && (papel = 'courier' || papel = 'entregador')`,
            fields: 'user_id',
            requestKey: null,
          })
          otherCompanyMemberUserIds = new Set(otherMembers.map((m) => m.user_id))
        } catch (mErr) {
          console.warn('Aviso ao consultar membros de outras empresas:', mErr)
        }
      }

      for (const u of usersList) {
        if (u && u.id && !couriersMap.has(u.id)) {
          // Se não for matriz e o courier estiver vinculado exclusivamente a outra empresa, pula
          if (!isMatriz && otherCompanyMemberUserIds.has(u.id)) {
            continue
          }
          couriersMap.set(u.id, {
            ...u,
            vehicle_type: u.vehicle_type || 'moto',
            status: u.status === 'inactive' ? ('inactive' as const) : ('active' as const),
          })
        }
      }
    } catch (usersErr) {
      console.warn('Erro ao unir couriers de users:', usersErr)
    }

    if (couriersMap.size > 0) {
      return Array.from(couriersMap.values())
    }

    return []
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
      if (!data.has('verified')) {
        data.append('verified', 'true')
      }
      // Garantir integridade de password e passwordConfirm
      const rawPassword = data.get('password')
      if (rawPassword && !data.has('passwordConfirm')) {
        data.append('passwordConfirm', rawPassword)
      }
      createdRecord = await pb.collection<UserRecord>('users').create(data)
    } else {
      const { empresa_id: _emp, ...rest } = data
      const rawPassword = String(data.password || '').trim()
      const rawConfirm = String(data.passwordConfirm || data.password || '').trim()
      const payload: Record<string, unknown> = {
        ...rest,
        email: data.email.trim().toLowerCase(),
        password: rawPassword,
        passwordConfirm: rawConfirm || rawPassword,
        verified: data.verified ?? true,
      }

      // Auto-generate username from email if not provided
      if (!payload.username) {
        const emailPrefix = data.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '')
        const randomSuffix = Math.floor(1000 + Math.random() * 9000)
        payload.username = `${emailPrefix || 'user'}_${randomSuffix}`
      }

      createdRecord = await pb.collection<UserRecord>('users').create(payload)
    }

    // Vincular imediatamente o usuário na coleção membros da empresa ativa
    if (createdRecord?.id && activeCompanyId) {
      try {
        const papelMembro =
          createdRecord.role === 'courier'
            ? 'courier'
            : createdRecord.role === 'seller'
              ? 'seller'
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

  // Locations
  async getLatestLocations(filter = '', sort = '-created', minutesWindow = 60) {
    let finalFilter = filter
    if (minutesWindow && minutesWindow > 0) {
      const windowStartIso = new Date(Date.now() - minutesWindow * 60 * 1000).toISOString()
      const timeFilter = `created >= '${windowStartIso}'`
      finalFilter = filter ? `(${filter}) && (${timeFilter})` : timeFilter
    }

    return pb.collection<LocationRecord>('locations').getFullList({
      filter: finalFilter,
      sort,
      expand: 'user_id',
      requestKey: null,
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
    const accuracy =
      typeof extra?.accuracy === 'number' && !isNaN(extra.accuracy)
        ? Math.round(extra.accuracy * 10) / 10
        : undefined

    // Se accuracy >= 500m (sem fix real), marcar o motivo como 'sem-fix' se gps_reason não veio especificado
    let gpsReason = extra?.gps_reason
    if ((accuracy == null || accuracy >= 500) && !gpsReason) {
      gpsReason = 'sem-fix'
    }

    const payload: Partial<LocationRecord> = {
      user_id: userId,
      lat,
      lng,
      speed,
      heading,
    }
    // Bateria real: apenas valores estritamente positivos (> 0) são gravados
    // Valores nulos, indefinidos ou 0 (dispositivos sem Battery API como iOS) não devem poluir o banco como 0%
    if (typeof batteryLevel === 'number' && !isNaN(batteryLevel) && batteryLevel > 0) {
      payload.battery_level = Math.max(1, Math.min(100, Math.round(batteryLevel)))
    }
    if (extra?.gps_status) {
      payload.gps_status = extra.gps_status
    }
    if (gpsReason !== undefined) {
      payload.gps_reason = gpsReason
    }
    if (extra?.offline_buffered !== undefined) {
      payload.offline_buffered = extra.offline_buffered
    }
    if (accuracy !== undefined) {
      payload.accuracy = accuracy
    }

    // Deduplicação defensiva no cliente antes de criar novas linhas:
    // Se a posição mudou menos de ~10m OU a acurácia é >= 500m (sem fix / fallback de 2000m),
    // reutiliza/atualiza o registro recente existente em vez de criar outro registro repetido.
    const cached = this._lastCourierLocationRecordMap.get(userId)
    if (cached && cached.id) {
      const dist = haversineDistanceMeters(cached.lat, cached.lng, lat, lng)
      const isWeakOrFallback = (accuracy ?? 2000) >= 500 || (cached.accuracy ?? 2000) >= 500
      const isSubTenMeters = dist < 10

      if (isSubTenMeters || isWeakOrFallback) {
        try {
          const updated = await pb
            .collection<LocationRecord>('locations')
            .update(cached.id, payload)
          this._lastCourierLocationRecordMap.set(userId, {
            id: updated.id,
            lat,
            lng,
            accuracy,
            timestamp: now,
          })
          return updated
        } catch {
          // Se o update falhar (ex: registro apagado), cai para o create abaixo
        }
      }
    }

    // Caso contrário (deslocamento real >= 10m com fix de GPS aceitável), cria novo ponto
    const created = await pb.collection<LocationRecord>('locations').create(payload)
    this._lastCourierLocationRecordMap.set(userId, {
      id: created.id,
      lat,
      lng,
      accuracy,
      timestamp: now,
    })
    return created
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
  async getNotifications(userId?: string) {
    const filter = userId ? `user_id = '${userId}' || user_id = ''` : ''
    return pb.collection<NotificationRecord>('notifications').getFullList({
      filter,
      sort: '-created',
      requestKey: null,
    })
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
  getVehicleFuelParams(
    settings?: Partial<AppSettingsRecord> | null,
    vehicleType?: string,
  ): {
    pricePerLiter: number
    consumptionKml: number
    category: 'moto' | 'carro' | 'caminhao' | 'bicicleta'
  } {
    const category = this.normalizeVehicleCategory(vehicleType)
    const baseFallbackPrice = settings?.fuel_price_per_liter || 6.49

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
        pricePerLiter: settings?.carro_fuel_price || baseFallbackPrice,
        consumptionKml: settings?.carro_consumption_kml || 12.0,
      }
    }

    if (category === 'caminhao') {
      return {
        category: 'caminhao',
        pricePerLiter: settings?.caminhao_fuel_price || baseFallbackPrice,
        consumptionKml: settings?.caminhao_consumption_kml || 7.0,
      }
    }

    // Default moto
    return {
      category: 'moto',
      pricePerLiter: settings?.moto_fuel_price || baseFallbackPrice,
      consumptionKml: settings?.moto_consumption_kml || settings?.fuel_consumption_kml || 35.0,
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
      const records = await pb.collection<AppSettingsRecord>('app_settings').getList(1, 1, {
        filter: "key = 'global_settings'",
        requestKey: null,
      })
      if (records.items.length > 0) {
        return await pb
          .collection<AppSettingsRecord>('app_settings')
          .update(records.items[0].id, data)
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

  // Base Addresses Management (Cadastro de Base da Empresa / Loja e Endereço Final)
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
        address: 'Rua da Prosperidade, 13 - Pilar, Duque de Caxias - RJ, 25230-085, Brasil',
        street: 'Rua da Prosperidade, 13',
        neighborhood: 'Pilar',
        city: 'Duque de Caxias',
        state: 'RJ',
        postal_code: '25230-085',
        lat: -22.6990563,
        lng: -43.296723,
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
          requestKey: null,
        })
      } else if (courierId) {
        ordersToUpdate = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && (status='assigned' || status='pending' || status='in_transit')`,
          requestKey: null,
        })
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

      let updatedCount = 0
      for (const order of ordersToUpdate) {
        const hasFile = !!odometerData?.foto_odometro_inicial
        const hasOdom =
          typeof odometerData?.odometro_inicial === 'number' && odometerData.odometro_inicial > 0
        if (hasFile || hasOdom) {
          const formData = new FormData()
          formData.append('route_started', 'true')
          formData.append('route_started_at', order.route_started_at || now)
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
            route_started_at: order.route_started_at || now,
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
  async finishCourierRoute(
    courierId: string,
    orderIds?: string[],
    odometerData?: {
      odometro_final?: number
      foto_odometro_final?: File | null
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
            })
          }
        }
        updatedCount++
      }

      // Liberar o entregador de volta para disponível ('active')
      try {
        await pb.collection('users').update(courierId, {
          status: 'active',
        })
      } catch (userErr) {
        console.warn('Não foi possível atualizar status do entregador para active:', userErr)
      }

      return { success: true, updatedCount }
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
  ): Promise<{ success: boolean; sequencedCount: number; totalDistanceKm: number }> {
    try {
      const { optimizeRouteSequence, sequenceStopsWithDeterministicTsp } =
        await import('@/services/intelligentRoadRouter')

      // 1. Obter entregador
      const courier = await pb.collection<UserRecord>('users').getOne(courierId)

      // 2. Obter pedidos ativos desse entregador (nunca mexe no TRK-2026-622)
      const courierOrders = await pb.collection<OrderRecord>('orders').getFullList({
        filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished!=true && tracking_code!='TRK-2026-622'`,
        sort: 'sequence,created',
        expand: 'customer_id',
        requestKey: null,
      })

      if (courierOrders.length === 0) {
        return { success: true, sequencedCount: 0, totalDistanceKm: 0 }
      }

      // 3. Obter base ativa padrão ou primeira configurada
      const bases = await this.getBaseAddresses()
      const defaultBase = bases.find((b) => b.is_default) || bases[0]
      const originPoint = {
        lat: courierOrders[0]?.start_base_lat || defaultBase?.lat || -22.6990563,
        lng: courierOrders[0]?.start_base_lng || defaultBase?.lng || -43.296723,
      }
      const destinationPoint = {
        lat: courierOrders[0]?.end_address_lat || originPoint.lat,
        lng: courierOrders[0]?.end_address_lng || originPoint.lng,
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
      // Fallback final: garantir que nenhum pedido fique com sequence = 0 mesmo em falha grave
      try {
        const fallbackOrders = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished!=true && tracking_code!='TRK-2026-622'`,
          sort: 'created',
          requestKey: null,
        })
        for (let idx = 0; idx < fallbackOrders.length; idx++) {
          if (!fallbackOrders[idx].sequence || fallbackOrders[idx].sequence === 0) {
            await pb.collection('orders').update(fallbackOrders[idx].id, {
              sequence: idx + 1,
            })
          }
        }
      } catch (fallbackSeqErr) {
        console.warn('Erro no fallback de emergência de sequência:', fallbackSeqErr)
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

      // Atribui sequence provisória = courierOrders.length + 1 para NUNCA ter sequence = 0
      const provisionalSequence = Math.max(1, courierOrders.length + 1)

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

      // 4. RESEQUENCIAMENTO AUTOMÁTICO VIÁRIO COMPLETO DA ROTA INTEIRA
      // Roda o motor viário inteligente e persiste sequences 1..N e distâncias viárias em todos os pedidos ativos
      try {
        await this.resequenceActiveRouteForCourier(courierId, settings)
      } catch (reseqErr) {
        console.warn('Erro ao resequenciar rota inteira após inclusão de pedido:', reseqErr)
      }

      // 5. Obter pedido atualizado com sua sequência otimizada final
      const finalOrder = await pb.collection<OrderRecord>('orders').getOne(orderId, {
        expand: 'customer_id',
      })
      const customer = finalOrder.expand?.customer_id as CustomerRecord | undefined

      // Criar notificação realtime ao entregador informando a parada otimizada
      try {
        await this.createNotification({
          user_id: courierId,
          title: '📦 Nova Entrega Otimizada na sua Rota!',
          message: `O pedido ${finalOrder.tracking_code || ''} para ${customer?.name || 'Cliente'} foi incorporado e otimizado na sua rota (Parada #${finalOrder.sequence || 1}).`,
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
  }): Promise<{ success: boolean; remainingCount: number }> {
    const { orderId, courierId, settings, autoResequence = true } = params
    try {
      const order = await pb.collection<OrderRecord>('orders').getOne(orderId)
      if (order.status === 'delivered') {
        throw new Error('Entregas já concluídas não podem ser removidas da rota.')
      }

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

      let remainingCount = 0
      if (autoResequence) {
        const reseqRes = await this.resequenceActiveRouteForCourier(courierId, settings)
        remainingCount = reseqRes.sequencedCount
      } else {
        const remainingOrders = await pb.collection<OrderRecord>('orders').getFullList({
          filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished!=true`,
          requestKey: null,
        })
        remainingCount = remainingOrders.length
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

      // 4. OTIMIZAÇÃO AUTOMÁTICA VIÁRIA E PERSISTÊNCIA DA SEQUÊNCIA
      const reseqRes = await this.resequenceActiveRouteForCourier(courierId, settings)

      // 5. Notificar o entregador se houver modificações
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

      return {
        success: true,
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
    let finalFilter = filter

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

    if (!filter.includes('courier_id')) {
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

  async createFuelAdvance(data: Partial<FuelAdvanceRecord>) {
    // fuel_advances NÃO possui campo empresa_id no schema do PocketBase.
    // Remove qualquer menção a empresa_id para não causar HTTP 400.
    const { empresa_id: _empresaId, ...payloadWithoutEmpresaId } = (data as any) || {}
    const payload = {
      status: 'active',
      entry_type: 'advance',
      ...payloadWithoutEmpresaId,
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
    return pb.collection<FuelAdvanceRecord>('fuel_advances').create({
      courier_id: params.courierId,
      amount: params.amountDelta,
      date: today,
      status: 'active',
      entry_type: 'balance_adjustment',
      created_by: params.createdBy,
      payment_method: params.paymentMethod || 'outro',
      notes: params.reason,
      previous_balance: params.previousBalance,
      new_balance: params.targetBalance,
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
  async getReviews(filter = '', sort = '-created', expand = 'order_id,courier_id,seller_id') {
    let finalFilter = filter
    if (!filter.includes('empresa_id') && !filter.includes('order_id')) {
      const companyClause = this.getCompanyFilterClause('empresa_id')
      if (companyClause) {
        finalFilter = filter ? `(${filter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<ReviewRecord>('reviews').getFullList({
      filter: finalFilter,
      sort,
      expand,
      requestKey: null,
    })
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
  async getOffRouteEvents(filter = '', sort = '-created', expand = 'courier_id,order_id') {
    let finalFilter = filter
    if (!filter.includes('empresa_id')) {
      const companyClause = this.getCompanyFilterClause('empresa_id')
      if (companyClause) {
        finalFilter = filter ? `(${filter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<OffRouteEventRecord>('off_route_events').getFullList({
      filter: finalFilter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async createOffRouteEvent(data: Partial<OffRouteEventRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<OffRouteEventRecord>('off_route_events').create(payload)
  },

  // Route optimization with Google Maps Traffic or fallback
  async optimizeRoute(
    orderIds: string[],
    originLat = -22.906847,
    originLng = -43.172896,
  ): Promise<OptimizedRouteResult> {
    return this.clientSideOptimizeRoute(orderIds, originLat, originLng)
  },

  // Calculate Best Courier & Route Suggestion for a new delivery
  async suggestBestCourierForOrder(params: {
    customerLat: number
    customerLng: number
    priority?: OrderPriority
    timeWindow?: string
  }): Promise<RouteSuggestionDetails | null> {
    const { customerLat, customerLng, priority = 'normal' } = params

    // 1. Get couriers and their latest locations
    const [couriers, orders, latestLocations] = await Promise.all([
      this.getCouriers(),
      this.getOrders('status = "pending" || status = "in_transit"'),
      this.getLatestLocations(),
    ])

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

    // Km saved compared to manual dispatch from furthest base
    const worstKm = Math.max(...scoredCouriers.map((c) => c.distDirectKm))
    const kmSaved = Math.max(1.8, Number((worstKm - finalDistKm + 2.5).toFixed(1)))

    return {
      courier_id: best.courier.id,
      courier_name: best.courier.name || best.courier.email,
      vehicle_type: best.courier.vehicle_type || 'motorcycle',
      order_in_route: orderInRoute,
      estimated_time: estTimeText,
      km_saved: kmSaved,
      distance_km: finalDistKm,
      reason: `Mais próximo (${finalDistKm} km) com capacidade ideal (${best.activeOrdersCount} entregas ativas)`,
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
   * Obter a contagem de alertas pendentes para badges de navegação.
   */
  async getPendingAddressAlertsCount(empresaId?: string): Promise<number> {
    const alerts = await this.getAddressAlerts({ empresaId, status: 'pendente' })
    return alerts.length
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
  }): Promise<AddressAlertRecord> {
    const authUser = pb.authStore.record as any
    const activeCompanyId =
      data.company || this.getActiveCompanyId() || (await this.getMatrizCompanyId())

    const payload: Partial<AddressAlertRecord> = {
      customer: data.customer,
      company: activeCompanyId,
      origin: data.origin,
      status: 'pendente',
      distance_meters: data.distance_meters || 0,
      notes: data.notes || '',
      current_address: data.current_address || {},
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
    const customerUpdate: Partial<CustomerRecord> = {}
    if (suggested.address) customerUpdate.address = String(suggested.address)
    if (suggested.street) customerUpdate.street = String(suggested.street)
    if (suggested.neighborhood) customerUpdate.neighborhood = String(suggested.neighborhood)
    if (suggested.city) customerUpdate.city = String(suggested.city)
    if (suggested.state) customerUpdate.state = String(suggested.state)
    if (suggested.postal_code) customerUpdate.postal_code = String(suggested.postal_code)
    if (suggested.lat !== undefined && suggested.lat !== null && !isNaN(Number(suggested.lat))) {
      customerUpdate.lat = Number(suggested.lat)
    }
    if (suggested.lng !== undefined && suggested.lng !== null && !isNaN(Number(suggested.lng))) {
      customerUpdate.lng = Number(suggested.lng)
    }

    // Adiciona nota no cadastro do cliente registrando a aprovação
    const prevNotes = (alert.expand?.customer as CustomerRecord)?.notes || ''
    const approvalAuditNote = `[ALERTA APROVADO ${new Date().toLocaleDateString('pt-BR')}]: Endereço corrigido via alerta #${alertId} (${alert.origin}).`
    customerUpdate.notes = prevNotes ? `${prevNotes} | ${approvalAuditNote}` : approvalAuditNote

    // 1. Atualizar cliente - dispara automaticamente sincronização de pedidos e resequenciamento viário de rotas!
    await this.updateCustomer(customerId, customerUpdate)

    // 2. Atualizar o alerta para aprovado
    const updatedAlert = await pb.collection<AddressAlertRecord>('address_alerts').update(alertId, {
      status: 'aprovado',
      reviewed_by: authUser?.id || undefined,
      reviewed_at: new Date().toISOString(),
      notes: customNotes
        ? `${alert.notes ? alert.notes + ' | ' : ''}Revisão: ${customNotes}`
        : alert.notes,
    })

    return { success: true, alert: updatedAlert }
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

    const updatedAlert = await pb.collection<AddressAlertRecord>('address_alerts').update(alertId, {
      status: 'reprovado',
      reviewed_by: authUser?.id || undefined,
      reviewed_at: new Date().toISOString(),
      notes: reason
        ? `${alert.notes ? alert.notes + ' | ' : ''}Reprovação: ${reason}`
        : alert.notes,
    })

    return { success: true, alert: updatedAlert }
  },
}
