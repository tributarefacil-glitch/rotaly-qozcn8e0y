migrate(
  (app) => {
    const usersCol = app.findCollectionByNameOrId('_pb_users_auth_')
    const customersCol = app.findCollectionByNameOrId('customers')
    const ordersCol = app.findCollectionByNameOrId('orders')
    const locationsCol = app.findCollectionByNameOrId('locations')
    const notifCol = app.findCollectionByNameOrId('notifications')

    // 1. Seed Admin
    let adminUser
    try {
      adminUser = app.findAuthRecordByEmail('_pb_users_auth_', 'tributarefacil@gmail.com')
    } catch (_) {
      adminUser = new Record(usersCol)
      adminUser.setEmail('tributarefacil@gmail.com')
      adminUser.setPassword('Skip@Pass')
      adminUser.setVerified(true)
      adminUser.set('name', 'Administrador Principal')
      adminUser.set('role', 'admin')
      adminUser.set('status', 'active')
      app.save(adminUser)
    }

    // 2. Seed Sellers
    let seller1, seller2
    try {
      seller1 = app.findAuthRecordByEmail('_pb_users_auth_', 'vendedor@logistica.com')
    } catch (_) {
      seller1 = new Record(usersCol)
      seller1.setEmail('vendedor@logistica.com')
      seller1.setPassword('Skip@Pass')
      seller1.setVerified(true)
      seller1.set('name', 'Carlos Vendas')
      seller1.set('role', 'seller')
      seller1.set('status', 'active')
      app.save(seller1)
    }

    try {
      seller2 = app.findAuthRecordByEmail('_pb_users_auth_', 'ana.vendas@logistica.com')
    } catch (_) {
      seller2 = new Record(usersCol)
      seller2.setEmail('ana.vendas@logistica.com')
      seller2.setPassword('Skip@Pass')
      seller2.setVerified(true)
      seller2.set('name', 'Ana Silveira')
      seller2.set('role', 'seller')
      seller2.set('status', 'active')
      app.save(seller2)
    }

    // 3. Seed 3 Couriers (Entregadores) - Based in São Paulo central areas
    const courierData = [
      {
        email: 'entregador1@logistica.com',
        name: 'Lucas Motoboy',
        lat: -23.55052,
        lng: -46.633308,
        status: 'busy',
      },
      {
        email: 'entregador2@logistica.com',
        name: 'Marcos Rápido',
        lat: -23.561684,
        lng: -46.655981,
        status: 'active',
      },
      {
        email: 'entregador3@logistica.com',
        name: 'Renato Express',
        lat: -23.543152,
        lng: -46.642197,
        status: 'idle',
      },
    ]

    const couriers = []
    for (const c of courierData) {
      let courier
      try {
        courier = app.findAuthRecordByEmail('_pb_users_auth_', c.email)
      } catch (_) {
        courier = new Record(usersCol)
        courier.setEmail(c.email)
        courier.setPassword('Skip@Pass')
        courier.setVerified(true)
        courier.set('name', c.name)
        courier.set('role', 'courier')
        courier.set('status', c.status)
        app.save(courier)
      }
      couriers.push(courier)

      // Seed initial location
      try {
        const loc = new Record(locationsCol)
        loc.set('user_id', courier.id)
        loc.set('lat', c.lat)
        loc.set('lng', c.lng)
        loc.set('speed', 28.5)
        loc.set('heading', 120)
        app.save(loc)
      } catch (_) {}
    }

    // 4. Seed 5 Dummy Customers in SP
    const dummyCustomers = [
      {
        name: 'Padaria Bella Paulista',
        phone: '(11) 98765-4321',
        address: 'R. Haddock Lobo, 354 - Cerqueira César, São Paulo - SP',
        lat: -23.557492,
        lng: -46.662779,
      },
      {
        name: 'Restaurante Fogo Vivo',
        phone: '(11) 97654-3210',
        address: 'Av. Paulista, 1578 - Bela Vista, São Paulo - SP',
        lat: -23.561414,
        lng: -46.655881,
      },
      {
        name: 'Drogaria Saúde Total',
        phone: '(11) 96543-2109',
        address: 'R. Augusta, 1492 - Consolação, São Paulo - SP',
        lat: -23.553218,
        lng: -46.656829,
      },
      {
        name: 'Mercado Central Jardins',
        phone: '(11) 95432-1098',
        address: 'Alameda Santos, 980 - Jardins, São Paulo - SP',
        lat: -23.568412,
        lng: -46.650119,
      },
      {
        name: 'Tech Solutions SP',
        phone: '(11) 94321-0987',
        address: 'R. da Consolação, 2411 - Centro, São Paulo - SP',
        lat: -23.552102,
        lng: -46.659914,
      },
    ]

    const customerRecords = []
    for (const c of dummyCustomers) {
      let cust
      try {
        cust = app.findFirstRecordByData('customers', 'name', c.name)
      } catch (_) {
        cust = new Record(customersCol)
        cust.set('name', c.name)
        cust.set('phone', c.phone)
        cust.set('address', c.address)
        cust.set('lat', c.lat)
        cust.set('lng', c.lng)
        app.save(cust)
      }
      customerRecords.push(cust)
    }

    // 5. Seed 10 Sample Orders
    const sampleOrders = [
      {
        code: 'TRK-2025-001',
        customerIdx: 0,
        courierIdx: 0,
        status: 'in_transit',
        priority: 'urgent',
        total: 185.5,
        items: [
          { name: 'Farinha Especial 10kg', qty: 2, price: 65.0 },
          { name: 'Fermento Biológico 500g', qty: 3, price: 18.5 },
        ],
        notes: 'Entregar na entrada dos fundos até as 15h',
      },
      {
        code: 'TRK-2025-002',
        customerIdx: 1,
        courierIdx: 0,
        status: 'in_transit',
        priority: 'high',
        total: 420.0,
        items: [
          { name: 'Kit Temperos Nobres', qty: 4, price: 80.0 },
          { name: 'Azeite Extra Virgem 5L', qty: 1, price: 100.0 },
        ],
        notes: 'Falar com o Chef Rodrigo',
      },
      {
        code: 'TRK-2025-003',
        customerIdx: 2,
        courierIdx: 1,
        status: 'in_transit',
        priority: 'urgent',
        total: 95.0,
        items: [{ name: 'Medicamentos Refrigerados', qty: 1, price: 95.0 }],
        notes: 'Manter em bolsa térmica',
      },
      {
        code: 'TRK-2025-004',
        customerIdx: 3,
        courierIdx: null,
        status: 'pending',
        priority: 'normal',
        total: 310.2,
        items: [
          { name: 'Caixas de Frutas Frescas', qty: 3, price: 85.0 },
          { name: 'Sucos Naturais 1L', qty: 5, price: 11.04 },
        ],
        notes: 'Aguardando liberação de rota',
      },
      {
        code: 'TRK-2025-005',
        customerIdx: 4,
        courierIdx: null,
        status: 'pending',
        priority: 'high',
        total: 1250.0,
        items: [{ name: 'Roteador Wi-Fi 6 Enterprise', qty: 1, price: 1250.0 }],
        notes: 'Requer assinatura do TI',
      },
      {
        code: 'TRK-2025-006',
        customerIdx: 0,
        courierIdx: 1,
        status: 'delivered',
        priority: 'normal',
        total: 89.0,
        items: [{ name: 'Embalagens Biodegradáveis', qty: 200, price: 89.0 }],
        notes: 'Entregue com sucesso pela manhã',
      },
      {
        code: 'TRK-2025-007',
        customerIdx: 1,
        courierIdx: 2,
        status: 'delivered',
        priority: 'normal',
        total: 215.0,
        items: [{ name: 'Carnes Premium Corte Bife', qty: 3, price: 71.66 }],
        notes: 'Conferido no ato',
      },
      {
        code: 'TRK-2025-008',
        customerIdx: 2,
        courierIdx: 0,
        status: 'delivered',
        priority: 'high',
        total: 154.3,
        items: [{ name: 'Luvas descartáveis Nitrilo', qty: 5, price: 30.86 }],
        notes: 'Entregue no balcão',
      },
      {
        code: 'TRK-2025-009',
        customerIdx: 3,
        courierIdx: null,
        status: 'pending',
        priority: 'normal',
        total: 78.0,
        items: [{ name: 'Sacos de Gelo Filtrado 5kg', qty: 6, price: 13.0 }],
        notes: 'Prioridade da tarde',
      },
      {
        code: 'TRK-2025-010',
        customerIdx: 4,
        courierIdx: null,
        status: 'cancelled',
        priority: 'normal',
        total: 350.0,
        items: [{ name: 'Cabos Cat6 Blindados 50m', qty: 2, price: 175.0 }],
        notes: 'Cancelado pelo cliente por mudança de endereço',
      },
    ]

    for (const o of sampleOrders) {
      try {
        app.findFirstRecordByData('orders', 'tracking_code', o.code)
      } catch (_) {
        const ord = new Record(ordersCol)
        ord.set('tracking_code', o.code)
        ord.set('seller_id', seller1 ? seller1.id : adminUser.id)
        ord.set('customer_id', customerRecords[o.customerIdx].id)
        if (o.courierIdx !== null && couriers[o.courierIdx]) {
          ord.set('courier_id', couriers[o.courierIdx].id)
        }
        ord.set('status', o.status)
        ord.set('priority', o.priority)
        ord.set('total_price', o.total)
        ord.set('items', o.items)
        ord.set('notes', o.notes)

        const now = new Date()
        if (o.status === 'in_transit') {
          const eta = new Date(now.getTime() + 45 * 60 * 1000)
          ord.set('estimated_arrival', eta.toISOString())
        } else if (o.status === 'delivered') {
          ord.set('actual_arrival', now.toISOString())
        }

        app.save(ord)
      }
    }

    // 6. Seed Sample Notifications
    const sampleNotifications = [
      {
        title: 'Alerta de Desvio de Rota',
        message: 'Entregador Lucas Motoboy desviou mais de 500m do trajeto previsto.',
        type: 'off_route',
        read: false,
      },
      {
        title: 'Pedido em Trânsito',
        message: 'Pedido TRK-2025-001 foi despachado para Padaria Bella Paulista.',
        type: 'order',
        read: false,
      },
      {
        title: 'Alerta de Atraso Potencial',
        message: 'Tráfego intenso na Av. Paulista pode causar 15m de atraso no TRK-2025-002.',
        type: 'delay',
        read: false,
      },
      {
        title: 'Sistema Operacional',
        message: 'Todos os 3 entregadores cadastrados estão com telemetria ativa.',
        type: 'system',
        read: true,
      },
    ]

    for (const n of sampleNotifications) {
      try {
        const notif = new Record(notifCol)
        notif.set('title', n.title)
        notif.set('message', n.message)
        notif.set('type', n.type)
        notif.set('read', n.read)
        notif.set('user_id', adminUser.id)
        app.save(notif)
      } catch (_) {}
    }
  },
  (app) => {
    // rollback
  },
)
