import pb from '@/lib/pocketbase/client'
import type {
  OrderRecord,
  CustomerRecord,
  LocationRecord,
  NotificationRecord,
  UserRecord,
  OptimizedRouteResult,
  AppSettingsRecord,
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

  async updateMembro(id: string, data: Partial<MembroRecord>) {
    return pb.collection<MembroRecord>('membros').update(id, data)
  },

  async deleteMembro(id: string) {
    return pb.collection<MembroRecord>('membros').delete(id)
  },

  // ID da Empresa Matriz Rotaly (para retrocompatibilidade com dados legados sem empresa_id)
  MATRIZ_EMPRESA_ID: '7wo05iyvfcfh01h',

  /**
   * Helper para montar cláusula multi-tenant consistente:
   * Se a empresa ativa for a Matriz (7wo05iyvfcfh01h), mantém compatibilidade com legados (empresa_id = Matriz || empresa_id = '' || empresa_id = null)
   * Para qualquer outra empresa, aplica filtro estrito `empresa_id = '<id>'`
   */
  getCompanyFilterClause(field = 'empresa_id'): string | null {
    const activeCompanyId = localStorage.getItem('rotaly_active_empresa_id')
    if (!activeCompanyId) return null
    if (activeCompanyId === this.MATRIZ_EMPRESA_ID) {
      return `(${field} = '${this.MATRIZ_EMPRESA_ID}' || ${field} = '' || ${field} = null)`
    }
    return `${field} = '${activeCompanyId}'`
  },

  // Multi-tenant Colaboradores, Rotas, Entregas, Relatórios
  async getColaboradores(empresaId?: string) {
    const filter = empresaId ? `empresa_id = '${empresaId}'` : ''
    return pb.collection<ColaboradorRecord>('colaboradores').getFullList({
      filter,
      sort: 'nome',
      requestKey: null,
    })
  },

  async createColaborador(data: Partial<ColaboradorRecord>) {
    return pb.collection<ColaboradorRecord>('colaboradores').create(data)
  },

  async getRotas(empresaId?: string) {
    const filter = empresaId ? `empresa_id = '${empresaId}'` : ''
    return pb.collection<RotaRecord>('rotas').getFullList({
      filter,
      sort: '-created',
      requestKey: null,
    })
  },

  async createRota(data: Partial<RotaRecord>) {
    return pb.collection<RotaRecord>('rotas').create(data)
  },

  async getEntregas(empresaId?: string) {
    const filter = empresaId ? `empresa_id = '${empresaId}'` : ''
    return pb.collection<EntregaRecord>('entregas').getFullList({
      filter,
      sort: '-created',
      requestKey: null,
    })
  },

  async createEntrega(data: Partial<EntregaRecord>) {
    return pb.collection<EntregaRecord>('entregas').create(data)
  },

  async getRelatorios(empresaId?: string) {
    const filter = empresaId ? `empresa_id = '${empresaId}'` : ''
    return pb.collection<RelatorioRecord>('relatorios').getFullList({
      filter,
      sort: '-created',
      requestKey: null,
    })
  },

  async createRelatorio(data: Partial<RelatorioRecord>) {
    return pb.collection<RelatorioRecord>('relatorios').create(data)
  },

  // Orders
  async getOrders(filter = '', sort = '-created', expand = 'customer_id,courier_id,seller_id') {
    // Injeção automática e segura de empresa_id se disponível no storage e não filtrado explicitamente
    let finalFilter = filter
    if (!filter.includes('empresa_id') && !filter.includes('tracking_code')) {
      const companyClause = this.getCompanyFilterClause('empresa_id')
      if (companyClause) {
        finalFilter = filter ? `(${filter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<OrderRecord>('orders').getFullList({
      filter: finalFilter,
      sort,
      expand,
      requestKey: null,
    })
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
      // 1. Busca direta exata na coleção orders
      const list = await pb.collection<OrderRecord>('orders').getList(1, 1, {
        filter: `tracking_code = '${code}'`,
        expand: 'customer_id,courier_id,seller_id',
        requestKey: null,
      })
      if (list.items[0]) return list.items[0]
    } catch (err) {
      console.warn('Erro ao buscar pedido por tracking_code na coleção orders:', err)
    }

    try {
      // 2. Fallback caso a formatação tenha espaçamento ou case ligeiramente diferente
      const listFuzzy = await pb.collection<OrderRecord>('orders').getList(1, 1, {
        filter: `tracking_code ~ '${code}'`,
        expand: 'customer_id,courier_id,seller_id',
        requestKey: null,
      })
      if (listFuzzy.items[0]) return listFuzzy.items[0]
    } catch (err) {
      console.warn('Erro na busca aproximada por tracking_code:', err)
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
    const activeCompanyId = localStorage.getItem('rotaly_active_empresa_id')
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
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
  async getCustomers(customFilter = '') {
    let finalFilter = customFilter
    if (!customFilter.includes('empresa_id')) {
      const companyClause = this.getCompanyFilterClause('empresa_id')
      if (companyClause) {
        finalFilter = customFilter ? `(${customFilter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<CustomerRecord>('customers').getFullList({
      filter: finalFilter,
      sort: 'name',
      requestKey: null,
    })
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
    const activeCompanyId = localStorage.getItem('rotaly_active_empresa_id')
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<CustomerRecord>('customers').create(payload)
  },

  async updateCustomer(id: string, data: Partial<CustomerRecord>) {
    return pb.collection<CustomerRecord>('customers').update(id, data)
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
    const activeCompanyId = empresaId || localStorage.getItem('rotaly_active_empresa_id')

    // Se há empresa ativa definida, buscar os usuários vinculados como entregador na coleção membros
    if (activeCompanyId) {
      try {
        const membros = await pb.collection<MembroRecord>('membros').getFullList({
          filter: `empresa_id = '${activeCompanyId}' && papel = 'entregador' && ativo = true`,
          expand: 'user_id',
          requestKey: null,
        })
        const usersFromMembers = membros.map((m) => m.expand?.user_id as UserRecord).filter(Boolean)

        if (usersFromMembers.length > 0) {
          return usersFromMembers
        }

        // Se for a Matriz e não houver membros ainda com expand, manter fallback para legados
        if (activeCompanyId === this.MATRIZ_EMPRESA_ID) {
          return pb.collection<UserRecord>('users').getFullList({
            filter: "role = 'courier'",
            sort: '-created',
            requestKey: null,
          })
        }

        return []
      } catch (err) {
        console.warn('Erro ao filtrar couriers por membros da empresa:', err)
      }
    }

    return pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'courier'",
      sort: '-created',
      requestKey: null,
    })
  },

  async getSellers(empresaId?: string) {
    const activeCompanyId = empresaId || localStorage.getItem('rotaly_active_empresa_id')

    if (activeCompanyId) {
      try {
        const membros = await pb.collection<MembroRecord>('membros').getFullList({
          filter: `empresa_id = '${activeCompanyId}' && papel = 'vendedor' && ativo = true`,
          expand: 'user_id',
          requestKey: null,
        })
        const usersFromMembers = membros.map((m) => m.expand?.user_id as UserRecord).filter(Boolean)

        if (usersFromMembers.length > 0) {
          return usersFromMembers
        }

        if (activeCompanyId === this.MATRIZ_EMPRESA_ID) {
          return pb.collection<UserRecord>('users').getFullList({
            filter: "role = 'seller'",
            sort: '-created',
            requestKey: null,
          })
        }

        return []
      } catch (err) {
        console.warn('Erro ao filtrar sellers por membros da empresa:', err)
      }
    }

    return pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'seller'",
      sort: '-created',
      requestKey: null,
    })
  },

  async getAllUsers(empresaId?: string) {
    const activeCompanyId = empresaId || localStorage.getItem('rotaly_active_empresa_id')

    if (activeCompanyId) {
      try {
        const membros = await pb.collection<MembroRecord>('membros').getFullList({
          filter: `empresa_id = '${activeCompanyId}' && ativo = true`,
          expand: 'user_id',
          requestKey: null,
        })
        const usersFromMembers = membros.map((m) => m.expand?.user_id as UserRecord).filter(Boolean)

        if (usersFromMembers.length > 0) {
          return usersFromMembers
        }

        if (activeCompanyId === this.MATRIZ_EMPRESA_ID) {
          return pb.collection<UserRecord>('users').getFullList({
            sort: '-created',
            requestKey: null,
          })
        }

        return []
      } catch (err) {
        console.warn('Erro ao filtrar allUsers por membros da empresa:', err)
      }
    }

    return pb.collection<UserRecord>('users').getFullList({
      sort: '-created',
      requestKey: null,
    })
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
          role?: 'admin' | 'seller' | 'courier'
          status?: 'active' | 'inactive' | 'pending' | 'idle' | 'busy'
          phone?: string
          document?: string
          vehicle_type?: string
          vehicle_model?: string
          vehicle_year?: number
          vehicle_plate?: string
          [key: string]: unknown
        }
      | FormData,
  ) {
    if (data instanceof FormData) {
      return pb.collection<UserRecord>('users').create(data)
    }

    const { verified: _omittedVerified, ...rest } = data
    const payload: Record<string, unknown> = {
      ...rest,
      email: data.email.trim().toLowerCase(),
    }

    // Auto-generate username from email if not provided
    if (!payload.username) {
      const emailPrefix = data.email.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '')
      const randomSuffix = Math.floor(1000 + Math.random() * 9000)
      payload.username = `${emailPrefix || 'user'}_${randomSuffix}`
    }

    return pb.collection<UserRecord>('users').create(payload)
  },

  // Password Reset Native PocketBase
  async requestPasswordReset(email: string) {
    return pb.collection('users').requestPasswordReset(email.trim().toLowerCase())
  },

  async confirmPasswordReset(token: string, password: string, passwordConfirm: string) {
    return pb.collection('users').confirmPasswordReset(token.trim(), password, passwordConfirm)
  },

  // Helper to build file URL from PocketBase record
  getFileUrl(record: UserRecord, filename: string) {
    if (!filename) return ''
    return pb.files.getURL(record, filename)
  },

  // Locations
  async getLatestLocations(filter = '', sort = '-created') {
    return pb.collection<LocationRecord>('locations').getFullList({
      filter,
      sort,
      expand: 'user_id',
      requestKey: null,
    })
  },

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
    const payload: Partial<LocationRecord> = {
      user_id: userId,
      lat,
      lng,
      speed,
      heading,
    }
    if (typeof batteryLevel === 'number' && !isNaN(batteryLevel)) {
      payload.battery_level = Math.max(0, Math.min(100, Math.round(batteryLevel)))
    }
    if (extra?.gps_status) {
      payload.gps_status = extra.gps_status
    }
    if (extra?.gps_reason !== undefined) {
      payload.gps_reason = extra.gps_reason
    }
    if (extra?.offline_buffered !== undefined) {
      payload.offline_buffered = extra.offline_buffered
    }
    if (typeof extra?.accuracy === 'number' && !isNaN(extra.accuracy)) {
      payload.accuracy = Math.round(extra.accuracy * 10) / 10
    }
    return pb.collection<LocationRecord>('locations').create(payload)
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
      fuel_price_per_liter: 5.59,
      fuel_consumption_kml: 35.0,
      moto_fuel_price: 5.59,
      moto_consumption_kml: 35.0,
      carro_fuel_price: 5.59,
      carro_consumption_kml: 12.0,
      caminhao_fuel_price: 5.59,
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
    const baseFallbackPrice = settings?.fuel_price_per_liter || 5.59

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
    const activeCompanyId = empresaId || localStorage.getItem('rotaly_active_empresa_id')
    try {
      let filter = ''
      if (activeCompanyId) {
        if (activeCompanyId === this.MATRIZ_EMPRESA_ID) {
          filter = `(empresa_id = '${this.MATRIZ_EMPRESA_ID}' || empresa_id = '' || empresa_id = null)`
        } else {
          filter = `empresa_id = '${activeCompanyId}'`
        }
      }

      const records = await pb.collection<BaseAddressRecord>('base_addresses').getFullList({
        filter,
        sort: '-is_default,name',
        requestKey: null,
      })
      if (records.length > 0) return records
    } catch (err) {
      console.warn('Could not fetch base_addresses from pb:', err)
    }

    return [
      {
        id: 'default_central_base',
        name: 'Base Central Rotaly (Polo Operacional)',
        type: 'base',
        address: 'Av. Rio Branco, 156 - Centro, Rio de Janeiro - RJ',
        street: 'Av. Rio Branco, 156',
        neighborhood: 'Centro',
        city: 'Rio de Janeiro',
        state: 'RJ',
        postal_code: '20040-003',
        lat: -22.906847,
        lng: -43.172896,
        is_default: true,
        is_end_default: true,
        collectionId: 'base_addresses',
        collectionName: 'base_addresses',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
      {
        id: 'default_endpoint_base',
        name: 'Galpão / Ponto de Apoio Zona Sul',
        type: 'end_point',
        address: 'Rua São Clemente, 185 - Botafogo, Rio de Janeiro - RJ',
        street: 'Rua São Clemente, 185',
        neighborhood: 'Botafogo',
        city: 'Rio de Janeiro',
        state: 'RJ',
        postal_code: '22260-001',
        lat: -22.951917,
        lng: -43.184852,
        is_default: false,
        is_end_default: false,
        collectionId: 'base_addresses',
        collectionName: 'base_addresses',
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
      },
    ]
  },

  async createBaseAddress(data: Partial<BaseAddressRecord>): Promise<BaseAddressRecord> {
    const activeCompanyId = localStorage.getItem('rotaly_active_empresa_id')
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
        await pb.collection('orders').update(order.id, {
          route_started: true,
          route_started_at: order.route_started_at || now,
          status: order.status === 'assigned' ? 'in_transit' : order.status,
        })
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
          filter: `courier_id='${courierId}' && route_started=true && (route_finished=false || route_finished=null)`,
          requestKey: null,
        })
      }

      let updatedCount = 0
      for (const order of ordersToUpdate) {
        await pb.collection('orders').update(order.id, {
          route_finished: true,
          route_finished_at: now,
        })
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
   * Incluir Cliente / Pedido em Rota Já Iniciada ou Liberada
   * - Atribui courier_id
   * - Sequência = max+1
   * - route_released = true
   * - Se rota já iniciada (route_started=true na rota do entregador), marca route_started=true e status='in_transit'
   * - Recalcula distance_km, fuel_cost (consumo do veículo) e ETA
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
      const maxSequence = courierOrders.reduce((max, o) => Math.max(max, o.sequence || 0), 0)
      const nextSequence = maxSequence + 1

      // 3. Obter dados do pedido e cliente para cálculo de distância
      const order = await pb.collection<OrderRecord>('orders').getOne(orderId, {
        expand: 'customer_id',
      })
      const customer = order.expand?.customer_id as CustomerRecord | undefined

      // Referência anterior (última parada da rota ou base)
      const lastOrder = courierOrders[courierOrders.length - 1]
      let prevLat: number | undefined
      let prevLng: number | undefined

      if (lastOrder) {
        const lastCust = lastOrder.expand?.customer_id as CustomerRecord | undefined
        prevLat = lastCust?.lat || lastOrder.end_address_lat || lastOrder.start_base_lat
        prevLng = lastCust?.lng || lastOrder.end_address_lng || lastOrder.start_base_lng
      }

      if (!prevLat || !prevLng) {
        prevLat = lastOrder?.start_base_lat || -22.7001402
        prevLng = lastOrder?.start_base_lng || -43.2982834
      }

      const custLat = customer?.lat || prevLat
      const custLng = customer?.lng || prevLng

      // Distância estimada até o novo cliente
      const R = 6371e3
      const φ1 = (prevLat * Math.PI) / 180
      const φ2 = (custLat * Math.PI) / 180
      const Δφ = ((custLat - prevLat) * Math.PI) / 180
      const Δλ = ((custLng - prevLng) * Math.PI) / 180
      const a =
        Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2)
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
      const stepDistMeters = R * c
      const stepDistKm = Number((stepDistMeters / 1000).toFixed(2))

      // Distância de retorno viária saneada (da parada de volta à base)
      const baseLat = lastOrder?.start_base_lat || -22.7001402
      const baseLng = lastOrder?.start_base_lng || -43.2982834
      const dBaseMeters =
        R *
        2 *
        Math.atan2(
          Math.sqrt(
            Math.sin(((custLat - baseLat) * Math.PI) / 360) ** 2 +
              Math.cos((baseLat * Math.PI) / 180) *
                Math.cos((custLat * Math.PI) / 180) *
                Math.sin(((custLng - baseLng) * Math.PI) / 360) ** 2,
          ),
          Math.sqrt(
            1 -
              (Math.sin(((custLat - baseLat) * Math.PI) / 360) ** 2 +
                Math.cos((baseLat * Math.PI) / 180) *
                  Math.cos((custLat * Math.PI) / 180) *
                  Math.sin(((custLng - baseLng) * Math.PI) / 360) ** 2),
          ),
        )
      const returnTripKm = Number(((dBaseMeters / 1000) * 1.3).toFixed(2))

      const { pricePerLiter, consumptionKml } = this.getVehicleFuelParams(
        settings,
        courier.vehicle_type,
      )
      const totalAllocatedKm = stepDistKm + returnTripKm
      const fuelCost =
        consumptionKml > 0
          ? Number(((totalAllocatedKm * pricePerLiter) / consumptionKml).toFixed(2))
          : 0

      const now = new Date()
      const etaTime = new Date(now.getTime() + (20 + nextSequence * 15) * 60 * 1000).toISOString()

      const updateData: Partial<OrderRecord> = {
        courier_id: courierId,
        sequence: nextSequence,
        route_released: true,
        route_released_at: now.toISOString(),
        distance_km: stepDistKm > 0 ? stepDistKm : 1.5,
        return_trip_km: returnTripKm > 0 ? returnTripKm : 1.5,
        fuel_cost: fuelCost,
        estimated_duration_minutes: Math.round(stepDistKm * 3.5 + 8),
        estimated_arrival: etaTime,
        start_base_name: lastOrder?.start_base_name || 'Base Operacional',
        start_base_address: lastOrder?.start_base_address,
        start_base_lat: lastOrder?.start_base_lat,
        start_base_lng: lastOrder?.start_base_lng,
        end_address_name: lastOrder?.end_address_name,
        end_address_text: lastOrder?.end_address_text,
        end_address_lat: lastOrder?.end_address_lat,
        end_address_lng: lastOrder?.end_address_lng,
      }

      if (isRouteStarted) {
        updateData.route_started = true
        updateData.route_started_at = lastOrder?.route_started_at || now.toISOString()
        updateData.status = 'in_transit'
      } else {
        updateData.status = 'assigned'
      }

      const updated = await pb.collection<OrderRecord>('orders').update(orderId, updateData)

      // Criar notificação realtime ao entregador
      try {
        await this.createNotification({
          user_id: courierId,
          title: '📦 Nova Entrega Incluída na sua Rota!',
          message: `O pedido ${order.tracking_code || ''} para ${customer?.name || 'Cliente'} foi adicionado como parada #${nextSequence} na sua rota!`,
          type: 'order',
          read: false,
          order_id: orderId,
        })
      } catch (notifErr) {
        console.warn('Erro ao notificar entregador sobre inclusão de cliente:', notifErr)
      }

      return { success: true, order: updated }
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

  // Calculate Fuel Cost
  // Formula: Distância (km) * Preço do Litro (R$/L) / Consumo (km/L)
  calculateFuelCost(distanceKm: number, fuelPrice = 5.59, consumptionKml = 35.0): number {
    if (consumptionKml <= 0) return 0
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
    if (category === 'bicicleta' || consumptionKml <= 0) return 0
    return this.calculateFuelCost(distanceKm, pricePerLiter, consumptionKml)
  },

  // Fuel Advances & Current Account
  async getFuelAdvances(filter = '', sort = '-date,-created', expand = 'courier_id,created_by') {
    return pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
      filter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async createFuelAdvance(data: Partial<FuelAdvanceRecord>) {
    return pb.collection<FuelAdvanceRecord>('fuel_advances').create(data)
  },

  async deleteFuelAdvance(id: string) {
    return pb.collection<FuelAdvanceRecord>('fuel_advances').delete(id)
  },

  // 6. Obter extrato de conta corrente de combustível de um entregador individual
  getCourierFuelAccount(
    courier: UserRecord,
    advances: FuelAdvanceRecord[],
    orders: OrderRecord[],
    settings: Partial<AppSettingsRecord> | null,
    periodFilter: 'all' | 'month' | 'week' = 'all',
    locations: LocationRecord[] = [],
    offRouteEvents: OffRouteEventRecord[] = [],
  ): CourierFuelAccount {
    const fuelParams = this.getVehicleFuelParams(settings, courier.vehicle_type)
    const { pricePerLiter, consumptionKml } = fuelParams

    const now = new Date()

    // Filtrar adiantamentos
    const courierAdvances = advances.filter((a) => {
      if (a.courier_id !== courier.id) return false
      if (periodFilter === 'all') return true
      const advDate = new Date(a.date || a.created || Date.now())
      if (periodFilter === 'week') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return advDate >= sevenDaysAgo
      }
      if (periodFilter === 'month') {
        return advDate.getMonth() === now.getMonth() && advDate.getFullYear() === now.getFullYear()
      }
      return true
    })

    const totalAdvances = courierAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

    // Filtrar ordens concluídas ou com rota iniciada
    const courierOrders = orders.filter((o) => {
      if (o.courier_id !== courier.id) return false
      const isStartedOrDelivered =
        o.route_started === true ||
        o.status === 'delivered' ||
        o.status === 'in_transit' ||
        o.status === 'address_error' ||
        o.status === 'client_absent'

      if (!isStartedOrDelivered) return false
      if (periodFilter === 'all') return true

      const oDate = new Date(o.created || Date.now())
      if (periodFilter === 'week') {
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
        return oDate >= sevenDaysAgo
      }
      if (periodFilter === 'month') {
        return oDate.getMonth() === now.getMonth() && oDate.getFullYear() === now.getFullYear()
      }
      return true
    })

    const courierLocations = locations.filter((l) => l.user_id === courier.id)
    const courierEvents = offRouteEvents.filter((ev) => ev.courier_id === courier.id)
    const allCourierOrders = orders.filter((o) => o.courier_id === courier.id)

    // Calcular km oficial real de cada ordem usando motor de telemetria se disponível
    const totalRouteKm = courierOrders.reduce((sum, o) => {
      return (
        sum +
        (typeof o.real_km === 'number' && o.real_km > 0
          ? o.real_km
          : (o.distance_km || 0) + (o.return_trip_km || 0))
      )
    }, 0)

    const totalSpent = consumptionKml > 0 ? (totalRouteKm * pricePerLiter) / consumptionKml : 0
    const balance = totalAdvances - totalSpent

    return {
      courier,
      totalAdvances: Number(totalAdvances.toFixed(2)),
      totalRouteKm: Number(totalRouteKm.toFixed(1)),
      totalSpent: Number(totalSpent.toFixed(2)),
      balance: Number(balance.toFixed(2)),
      advanceCount: courierAdvances.length,
      deliveriesCount: courierOrders.length,
    }
  },

  // Compute Real-time Courier Current Account
  // Regra: Soma dos Adiantamentos - Gasto em Rotas Oficiais (KM Real de GPS quando disponível, descontados desvios e paradas)
  // Usando parâmetros de consumo e preço específicos do tipo de veículo do entregador (moto, carro ou caminhão)
  async getCourierFuelAccounts(): Promise<CourierFuelAccount[]> {
    const [couriers, advances, orders, settings, locations, offRouteEvents] = await Promise.all([
      this.getCouriers(),
      this.getFuelAdvances(),
      this.getOrders(),
      this.getSettings(),
      this.getLatestLocations(),
      this.getOffRouteEvents(),
    ])

    const { calculateRealKmForOrder } = await import('@/lib/telemetryKmEngine')

    return couriers.map((courier) => {
      const courierAdvances = advances.filter((a) => a.courier_id === courier.id)
      const totalAdvances = courierAdvances.reduce((sum, a) => sum + (Number(a.amount) || 0), 0)

      const courierLocations = locations.filter((l) => l.user_id === courier.id)
      const courierEvents = offRouteEvents.filter((ev) => ev.courier_id === courier.id)

      // Regra: Contabilizar km para todo pedido com rota iniciada ou entregue/parcial
      const courierOrders = orders.filter(
        (o) =>
          o.courier_id === courier.id &&
          (o.route_started === true ||
            o.status === 'delivered' ||
            o.status === 'in_transit' ||
            o.status === 'address_error' ||
            o.status === 'client_absent'),
      )

      // Regra do Usuário: "O KM RODADO INICIA NA SAIDA DA BASE, CONTINUA CONTANDO EM TODAS ENTREGAS E FINALIZA NA BASE DE VOLTA"
      // Agrupar pedidos por lote de rota (mesmo route_started_at aproximado)
      const routeBatches = new Map<string, OrderRecord[]>()
      courierOrders.forEach((o) => {
        const key = o.route_started_at
          ? `batch_${Math.floor(new Date(o.route_started_at).getTime() / (10 * 60 * 1000))}`
          : `single_${o.id}`
        const list = routeBatches.get(key) || []
        list.push(o)
        routeBatches.set(key, list)
      })

      let totalRouteKm = 0
      routeBatches.forEach((batchOrders) => {
        const anchorOrder = batchOrders[0]
        const batchTelemetry = calculateRealKmForOrder({
          order: anchorOrder,
          allCourierLocations: courierLocations,
          courierEvents,
          allCourierOrders: batchOrders,
        })
        totalRouteKm += batchTelemetry.officialRealKm
      })

      const { pricePerLiter, consumptionKml } = this.getVehicleFuelParams(
        settings,
        courier.vehicle_type,
      )

      const totalSpent = consumptionKml > 0 ? (totalRouteKm * pricePerLiter) / consumptionKml : 0
      const balance = totalAdvances - totalSpent

      return {
        courier,
        totalAdvances,
        totalRouteKm: Number(totalRouteKm.toFixed(1)),
        totalSpent: Number(totalSpent.toFixed(2)),
        balance: Number(balance.toFixed(2)),
        advanceCount: courierAdvances.length,
        deliveriesCount: courierOrders.length,
      }
    })
  },

  // Reviews (Avaliação de Entregador e Vendedor no Rastreio Público)
  async getReviews(filter = '', sort = '-created', expand = 'order_id,courier_id,seller_id') {
    return pb.collection<ReviewRecord>('reviews').getFullList({
      filter,
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
    return pb.collection<OffRouteEventRecord>('off_route_events').getFullList({
      filter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async createOffRouteEvent(data: Partial<OffRouteEventRecord>) {
    return pb.collection<OffRouteEventRecord>('off_route_events').create(data)
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

  // Client-side intelligent TSP router using Google Maps Directions with trafficModel (departureTime=now)
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

    const calcDist = (lat1: number, lon1: number, lat2: number, lon2: number) => {
      const R = 6371e3
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

    const unvisited = [...items]
    const optimized: Array<{
      id: string
      tracking_code: string
      priority: string
      status: string
      customer_name: string
      address: string
      lat: number
      lng: number
      step_distance_meters: number
      cumulative_distance_meters: number
      step_duration_seconds?: number
    }> = []

    let curLat = originLat
    let curLng = originLng
    let totalDistMeters = 0

    while (unvisited.length > 0) {
      let bestIdx = -1
      let bestScore = Infinity

      for (let i = 0; i < unvisited.length; i++) {
        const item = unvisited[i]
        const d = calcDist(curLat, curLng, item.lat, item.lng)
        let weightMultiplier = 1.0
        if (item.priority === 'urgent') weightMultiplier = 0.4
        else if (item.priority === 'high') weightMultiplier = 0.7

        const score = d * weightMultiplier
        if (score < bestScore) {
          bestScore = score
          bestIdx = i
        }
      }

      if (bestIdx >= 0) {
        const next = unvisited.splice(bestIdx, 1)[0]
        const actualD = calcDist(curLat, curLng, next.lat, next.lng)
        totalDistMeters += actualD
        curLat = next.lat
        curLng = next.lng
        optimized.push({
          ...next,
          step_distance_meters: Math.round(actualD),
          cumulative_distance_meters: Math.round(totalDistMeters),
        })
      } else {
        break
      }
    }

    // Try Google Maps Directions for accurate driving time with live traffic if window.google is loaded
    let durationMins = Math.round((totalDistMeters / 1000) * 3.5 + optimized.length * 5)
    let finalDistMeters = totalDistMeters

    if (typeof window !== 'undefined') {
      const win = window as any
      if (
        win.google &&
        win.google.maps &&
        win.google.maps.DirectionsService &&
        optimized.length > 0
      ) {
        try {
          const directionsService = new win.google.maps.DirectionsService()
          const origin = new win.google.maps.LatLng(originLat, originLng)
          const destination = new win.google.maps.LatLng(
            optimized[optimized.length - 1].lat,
            optimized[optimized.length - 1].lng,
          )

          const waypoints = optimized.slice(0, -1).map((opt) => ({
            location: new win.google.maps.LatLng(opt.lat, opt.lng),
            stopover: true,
          }))

          // Request directions with live traffic (departureTime: now, trafficModel: BEST_GUESS)
          const result = await new Promise<any>((resolve) => {
            directionsService.route(
              {
                origin,
                destination,
                waypoints: waypoints.slice(0, 23), // Google maps limits waypoints to 25
                optimizeWaypoints: false, // Already ordered by our TSP
                travelMode: win.google.maps.TravelMode.DRIVING,
                drivingOptions: {
                  departureTime: new Date(),
                  trafficModel: win.google.maps.TrafficModel.BEST_GUESS,
                },
              },
              (res: any, status: any) => {
                if (status === win.google.maps.DirectionsStatus.OK) {
                  resolve(res)
                } else {
                  resolve(null)
                }
              },
            )
          })

          if (result && result.routes && result.routes[0]) {
            const legs = result.routes[0].legs || []
            let legDistSum = 0
            let legDurationSum = 0

            legs.forEach((leg: any, idx: number) => {
              legDistSum += leg.distance?.value || 0
              const legDur = leg.duration_in_traffic?.value || leg.duration?.value || 0
              legDurationSum += legDur
              if (optimized[idx]) {
                optimized[idx].step_duration_seconds = legDur
                optimized[idx].step_distance_meters =
                  leg.distance?.value || optimized[idx].step_distance_meters
              }
            })

            if (legDistSum > 0) finalDistMeters = legDistSum
            if (legDurationSum > 0) {
              // Duration from traffic + 5 min per stop for delivery interaction
              durationMins = Math.round(legDurationSum / 60 + optimized.length * 5)
            }
          }
        } catch (trafficErr) {
          console.warn('Traffic duration fetch fallback applied:', trafficErr)
        }
      }
    }

    const finalDestLat = destLat !== undefined ? destLat : originLat
    const finalDestLng = destLng !== undefined ? destLng : originLng

    // IDA E VOLTA: calcular percurso de retorno da última parada até a base ou endereço de finalização
    let returnDistMeters = 0
    if (optimized.length > 0) {
      const lastStop = optimized[optimized.length - 1]
      returnDistMeters = calcDist(lastStop.lat, lastStop.lng, finalDestLat, finalDestLng)
    }

    const outboundDistKm = finalDistMeters / 1000
    const returnDistKm = returnDistMeters / 1000
    const totalDistKm = outboundDistKm + returnDistKm

    // Add return drive time
    const returnMins = Math.round((returnDistKm / 25) * 60)
    const totalDurationMins = durationMins + returnMins

    const fuelCost = consumptionKml > 0 ? (totalDistKm * pricePerLiter) / consumptionKml : 0

    return {
      optimized_orders: optimized,
      total_distance_km: totalDistKm.toFixed(2),
      outbound_distance_km: parseFloat(outboundDistKm.toFixed(2)),
      return_distance_km: parseFloat(returnDistKm.toFixed(2)),
      estimated_duration_minutes: totalDurationMins,
      estimated_fuel_cost: Number(fuelCost.toFixed(2)),
      stops_count: optimized.length,
    }
  },
}
