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

  // ID da Empresa Matriz Rotaly (Empresa Única do Sistema)
  MATRIZ_EMPRESA_ID: '7wo05iyvfcfh01h',

  /**
   * Helper para obter o ID da empresa ativa de forma fail-safe.
   * Retorna SEMPRE a Matriz '7wo05iyvfcfh01h' ("Rotaly Operações").
   */
  getActiveCompanyId(): string {
    return this.MATRIZ_EMPRESA_ID
  },

  setActiveCompanyId(empresaId: string): void {
    if (typeof window !== 'undefined' && empresaId) {
      localStorage.setItem('rotaly_active_empresa_id', this.MATRIZ_EMPRESA_ID)
    }
  },

  /**
   * Helper de cláusula de empresa:
   * No modo empresa única, não restringe ou aceita tudo para garantir 100% de visibilidade.
   */
  getCompanyFilterClause(_field = 'empresa_id', _overrideCompanyId?: string): string | null {
    // Retorna null para nunca restringir queries e garantir que TODOS os registros apareçam unificados
    return null
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
    _empresaId?: string,
  ) {
    return pb.collection<OrderRecord>('orders').getFullList({
      filter,
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
    const activeCompanyId = this.getActiveCompanyId()
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
    return pb.collection<CustomerRecord>('customers').getFullList({
      filter: customFilter,
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
    const activeCompanyId = this.getActiveCompanyId()
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
  async getCouriers(_empresaId?: string) {
    // Modo Empresa Única: listar todos os entregadores do sistema cadastrados (sem isolamento)
    const list = await pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'courier'",
      sort: '-created',
      requestKey: null,
    })
    return list.map((u) => ({
      ...u,
      vehicle_type: u.vehicle_type || 'moto',
      status: u.status === 'inactive' ? ('inactive' as const) : ('active' as const),
    }))
  },

  async getSellers(_empresaId?: string) {
    // Modo Empresa Única: listar todos os vendedores do sistema cadastrados (sem isolamento)
    return pb.collection<UserRecord>('users').getFullList({
      filter: "role = 'seller'",
      sort: '-created',
      requestKey: null,
    })
  },

  async getAllUsers(_empresaId?: string) {
    // Modo Empresa Única: listar todos os usuários unificados
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
  async getBaseAddresses(_empresaId?: string): Promise<BaseAddressRecord[]> {
    try {
      const records = await pb.collection<BaseAddressRecord>('base_addresses').getFullList({
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
        lat: -22.7001402,
        lng: -43.2982834,
        is_default: true,
        is_end_default: true,
        empresa_id: this.MATRIZ_EMPRESA_ID,
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
        filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished=false && tracking_code!='TRK-2026-622'`,
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
        lat: courierOrders[0]?.start_base_lat || defaultBase?.lat || -22.7001402,
        lng: courierOrders[0]?.start_base_lng || defaultBase?.lng || -43.2982834,
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
          const stepMeters = Math.max(500, Math.round(direct * 1.3))
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
        const returnMeters = Math.max(
          500,
          Math.round(
            Math.sqrt(
              Math.pow((prevLat - destinationPoint.lat) * 111000, 2) +
                Math.pow(
                  (prevLng - destinationPoint.lng) *
                    111000 *
                    Math.cos((originPoint.lat * Math.PI) / 180),
                  2,
                ),
            ) * 1.3,
          ),
        )
        const totalDistKm = Number(((fallbackOutboundMeters + returnMeters) / 1000).toFixed(2))
        const returnDistKm = Number((returnMeters / 1000).toFixed(2))
        const effectiveCons =
          consumptionKml > 0 ? consumptionKml : courier.vehicle_type === 'moto' ? 32 : 10
        const totalFuel = effectiveCons > 0 ? (totalDistKm * pricePerLiter) / effectiveCons : 0

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
      let allocatedFuelSum = 0

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

        // Rateio exato do combustível da rota para cumprir regra "linha = cabeçalho"
        let legFuelCost: number
        if (!isLastStop) {
          legFuelCost =
            consumptionKml > 0
              ? Number(((stepDistKm * pricePerLiter) / consumptionKml).toFixed(2))
              : 0
          allocatedFuelSum += legFuelCost
        } else {
          // Última parada: absorve o trecho de retorno garantindo que a soma feche exatamente no cabeçalho
          legFuelCost = Number(Math.max(0, totalRouteFuel - allocatedFuelSum).toFixed(2))
        }

        const calculatedSequence = i + 1 // NUNCA ZERO: 1..N

        const updatePayload: Partial<OrderRecord> = {
          sequence: calculatedSequence,
          distance_km: stepDistKm > 0 ? stepDistKm : 0.8,
          return_trip_km: roadResult.return_distance_km,
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
          filter: `courier_id='${courierId}' && status!='delivered' && status!='cancelled' && route_finished=false && tracking_code!='TRK-2026-622'`,
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
    let finalFilter = filter
    if (!filter.includes('empresa_id')) {
      const companyClause = this.getCompanyFilterClause('empresa_id')
      if (companyClause) {
        finalFilter = filter ? `(${filter}) && ${companyClause}` : companyClause
      }
    }

    return pb.collection<FuelAdvanceRecord>('fuel_advances').getFullList({
      filter: finalFilter,
      sort,
      expand,
      requestKey: null,
    })
  },

  async createFuelAdvance(data: Partial<FuelAdvanceRecord>) {
    const activeCompanyId = this.getActiveCompanyId()
    const payload = {
      ...data,
      ...(activeCompanyId && !data.empresa_id ? { empresa_id: activeCompanyId } : {}),
    }
    return pb.collection<FuelAdvanceRecord>('fuel_advances').create(payload)
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
}
